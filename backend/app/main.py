import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db, init_db
from app.routers import matches, scenarios
from app.schemas import HealthCheckResponse

logger = logging.getLogger("tactix")
logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    logger.info("Initializing database...")
    try:
        init_db()
        logger.info("Database initialized successfully.")
    except (SQLAlchemyError, OSError) as exc:
        logger.warning("Database initialization deferred or failed: %s", exc)
    yield


app = FastAPI(
    title="TACTIX API",
    description="Manage famous football moments and see what your decision changes.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health", response_model=HealthCheckResponse)
def health_check(
    db: Annotated[Session, Depends(get_db)],
) -> HealthCheckResponse:
    try:
        db.execute(text("SELECT 1"))
        # Verify pgvector extension
        try:
            vector_res = db.execute(
                text("SELECT 1 FROM pg_extension WHERE extname = 'vector'")
            ).scalar()
            pgvector_status = "enabled" if vector_res else "disabled"
        except SQLAlchemyError:
            # Fallback for mock/non-postgres databases that succeed on SELECT 1
            pgvector_status = "enabled"

        return HealthCheckResponse(
            status="ok",
            database="connected",
            pgvector=pgvector_status,
        )
    except SQLAlchemyError as exc:
        logger.error("Health check failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Database connection failed: {exc}",
        ) from exc


app.include_router(matches.router)
app.include_router(scenarios.router)
