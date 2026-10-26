import os

# Tests run against a local database only, never the one backend/.env points
# at (which may be production). CI and docker-compose use this same URL; set
# TEST_DATABASE_URL to use another. Tests also never fetch from StatsBomb on
# startup or call Gemini (a real, billable API). Environment variables win over
# .env in the app settings.
os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+psycopg://tactix:tactix_pass@localhost:5432/tactix_db"
)
os.environ["AUTO_SEED"] = "false"
os.environ["GEMINI_API_KEY"] = ""
