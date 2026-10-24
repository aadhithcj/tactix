import os

# Tests must never reach out to StatsBomb on app startup.
os.environ.setdefault("AUTO_SEED", "false")
