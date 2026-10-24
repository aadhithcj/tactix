"""Seed the curated catalog: from the CLI script or on first start of the API."""

import logging
import threading

from sqlalchemy import delete, select

from app import models
from app.database import SessionLocal
from app.scenarios_catalog import CATALOG, ScenarioSpec
from app.services.ingest import ingest_match
from app.services.moments import CUSTOM_PREFIX

logger = logging.getLogger("tactix.seeding")


def prune_retired_scenarios() -> None:
    """Drop curated scenarios no longer in the catalog (for example after a
    moment's minute changes). Moments users built are kept."""
    keep = [spec.slug for spec in CATALOG]
    with SessionLocal() as db:
        result = db.execute(
            delete(models.Scenario)
            .where(models.Scenario.slug.not_in(keep))
            .where(models.Scenario.slug.not_like(f"{CUSTOM_PREFIX}%"))
        )
        db.commit()
        if result.rowcount:
            logger.info("Removed %d retired scenario(s).", result.rowcount)


def seed_catalog(only: list[str] | None = None) -> int:
    """Ingest every catalog match (or only the given slugs). Returns matches seeded."""
    by_match: dict[int, list[ScenarioSpec]] = {}
    for spec in CATALOG:
        if only and spec.slug not in only:
            continue
        by_match.setdefault(spec.match_id, []).append(spec)

    order = {spec.slug: i for i, spec in enumerate(CATALOG)}
    for specs in by_match.values():
        ingest_match(specs, order)
    if not only:
        prune_retired_scenarios()
    return len(by_match)


def missing_catalog_slugs() -> list[str]:
    with SessionLocal() as db:
        have = set(db.execute(select(models.Scenario.slug)).scalars())
    return [spec.slug for spec in CATALOG if spec.slug not in have]


def seed_missing_in_background() -> threading.Thread | None:
    """On an empty or outdated database, fetch the missing curated moments
    without blocking startup. Requests for them 404 until this finishes."""
    missing = missing_catalog_slugs()
    if not missing:
        return None
    logger.info("Seeding %d missing curated moment(s) in the background: %s", len(missing), missing)

    def run() -> None:
        try:
            seed_catalog(missing)
            prune_retired_scenarios()
            logger.info("Background seeding finished.")
        except Exception:
            logger.exception("Background seeding failed")

    thread = threading.Thread(target=run, name="tactix-seed", daemon=True)
    thread.start()
    return thread
