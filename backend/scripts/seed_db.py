import argparse
import logging
import sys
from pathlib import Path

# Ensure backend root is on sys.path
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from app.database import init_db
from app.services.seeding import seed_catalog

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("tactix.seed_db")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed TACTIX with StatsBomb open data.")
    parser.add_argument("slugs", nargs="*", help="Only seed these scenario slugs.")
    args = parser.parse_args()
    init_db()
    count = seed_catalog(args.slugs or None)
    logger.info("Database seeding completed: %d match(es).", count)
