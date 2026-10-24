from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+psycopg://tactix:tactix_pass@localhost:5432/tactix_db"
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-2.5-flash"
    GEMINI_TIMEOUT_SECONDS: float = 20.0
    ENVIRONMENT: str = "development"
    # Comma-separated list of exact origins allowed to call the API.
    CORS_ORIGINS: str = "http://localhost:3000,http://localhost:5173,http://localhost:4173"
    # Regex for extra origins, e.g. every Vercel preview deployment.
    CORS_ORIGIN_REGEX: str = r"https://.*\.vercel\.app"
    # Seed the curated moments in the background when the database is empty.
    AUTO_SEED: bool = True

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @field_validator("DATABASE_URL")
    @classmethod
    def use_psycopg_driver(cls, url: str) -> str:
        # Supabase and Render hand out postgres:// or postgresql:// URLs;
        # SQLAlchemy needs the psycopg 3 driver named explicitly.
        for prefix in ("postgres://", "postgresql://"):
            if url.startswith(prefix):
                return "postgresql+psycopg://" + url[len(prefix) :]
        return url

    @property
    def allowed_origins(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


settings = Settings()
