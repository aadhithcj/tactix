import logging
import time
from collections.abc import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings

logger = logging.getLogger("tactix")


class Base(DeclarativeBase):
    pass


engine = create_engine(
    settings.DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# Columns added after the first release. create_all() never alters existing
# tables, so older databases get them via idempotent ALTER statements.
_LATE_COLUMNS = (
    "ALTER TABLE players ADD COLUMN IF NOT EXISTS nickname VARCHAR(120)",
    "ALTER TABLE players ADD COLUMN IF NOT EXISTS jersey_number INTEGER",
)


def _add_missing_columns() -> None:
    with engine.begin() as conn:
        for stmt in _LATE_COLUMNS:
            conn.execute(text(stmt))


def init_db(max_retries: int = 5, retry_delay: float = 2.0) -> None:
    # Ensure all models are imported so Base.metadata knows about tables
    import app.models  # noqa: F401

    last_error: Exception | None = None
    for attempt in range(1, max_retries + 1):
        try:
            logger.info("Connecting to database (attempt %d/%d)...", attempt, max_retries)
            with engine.begin() as conn:
                conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector;"))
            Base.metadata.create_all(bind=engine)
            _add_missing_columns()
            logger.info("Database initialized successfully.")
            return
        except (OperationalError, OSError) as exc:
            last_error = exc
            logger.warning(
                "Database connection attempt %d/%d failed: %s. Retrying in %ss...",
                attempt,
                max_retries,
                exc,
                retry_delay,
            )
            if attempt < max_retries:
                time.sleep(retry_delay)

    if last_error:
        raise last_error
