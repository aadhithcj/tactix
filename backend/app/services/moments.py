"""Build a playable moment from any StatsBomb open-data match, on demand.

The curated catalog has hand-written copy; these moments get generated titles
and dilemmas from the scoreline and time left. Swapping StatsBomb's open data
for a licensed feed later only changes where the events come from.
"""

import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime, timedelta
from functools import lru_cache
from typing import Any

import pandas as pd
import requests
from statsbombpy import sb

from app import models
from app.database import SessionLocal
from app.scenarios_catalog import ScenarioSpec
from app.services.ingest import ingest_match

logger = logging.getLogger("tactix.moments")

CUSTOM_PREFIX = "custom-"
MIN_MINUTE = 5
MAX_MINUTE = 85

LIBRARY_KEY = "open-data-library-v1"
LIBRARY_MAX_AGE = timedelta(days=7)


class SourceUnavailable(RuntimeError):
    """The upstream data source could not be reached."""


def _clean(val: Any) -> Any:
    return None if val is None or (isinstance(val, float) and pd.isna(val)) else val


@lru_cache(maxsize=1)
def list_competitions() -> list[dict[str, Any]]:
    try:
        df = sb.competitions()
    except (requests.RequestException, ValueError) as exc:
        raise SourceUnavailable(str(exc)) from exc
    rows = [
        {
            "competition_id": int(r["competition_id"]),
            "season_id": int(r["season_id"]),
            "competition": str(r["competition_name"]),
            "season": str(r["season_name"]),
            "country": str(r["country_name"]),
            "gender": str(r.get("competition_gender") or ""),
        }
        for _, r in df.iterrows()
    ]
    rows.sort(key=lambda r: (r["competition"], r["season"]), reverse=False)
    return rows


@lru_cache(maxsize=128)
def list_matches(competition_id: int, season_id: int) -> list[dict[str, Any]]:
    try:
        df = sb.matches(competition_id=competition_id, season_id=season_id)
    except (requests.RequestException, ValueError) as exc:
        raise SourceUnavailable(str(exc)) from exc
    rows = []
    for _, r in df.iterrows():
        rows.append(
            {
                "match_id": int(r["match_id"]),
                "date": str(r["match_date"]),
                "home": str(r["home_team"]),
                "away": str(r["away_team"]),
                "home_score": int(r["home_score"]),
                "away_score": int(r["away_score"]),
                "stage": str(_clean(r.get("competition_stage")) or ""),
                "stadium": str(_clean(r.get("stadium")) or ""),
            }
        )
    rows.sort(key=lambda r: r["date"], reverse=True)
    return rows


def custom_slug(match_id: int, minute: int) -> str:
    return f"{CUSTOM_PREFIX}{match_id}-{minute}"


def create_moment(competition_id: int, season_id: int, match_id: int, minute: int) -> str:
    """Return the slug of a playable moment, building it if needed."""
    if not MIN_MINUTE <= minute <= MAX_MINUTE:
        raise ValueError(f"Pick a minute between {MIN_MINUTE} and {MAX_MINUTE}.")
    match = next((m for m in list_matches(competition_id, season_id) if m["match_id"] == match_id), None)
    if match is None:
        raise LookupError("That match isn't in this competition's open data.")

    slug = custom_slug(match_id, minute)
    with SessionLocal() as db:
        if db.get(models.Scenario, slug):
            return slug

    played = date.fromisoformat(match["date"])
    spec = ScenarioSpec(
        slug=slug,
        match_id=match_id,
        competition_id=competition_id,
        season_id=season_id,
        minute=minute,
        title="",
        tagline="",
        venue=match["stadium"],
        # Five substitutions became the norm in 2020; three before.
        subs_allowed=5 if played.year >= 2020 else 3,
    )
    try:
        ingest_match([spec])
    except requests.RequestException as exc:
        raise SourceUnavailable(str(exc)) from exc
    return slug


def ensure_match(competition_id: int, season_id: int, match_id: int) -> int:
    """Make sure a match is stored for Analyst Mode, fetching it if needed."""
    if next((m for m in list_matches(competition_id, season_id) if m["match_id"] == match_id), None) is None:
        raise LookupError("That match isn't in this competition's open data.")
    with SessionLocal() as db:
        if db.get(models.Match, match_id):
            return match_id
    try:
        ingest_match([], source=(competition_id, season_id, match_id))
    except requests.RequestException as exc:
        raise SourceUnavailable(str(exc)) from exc
    return match_id


# ---------------------------------------------------------------- library
# Every open-data match in one list, so the picker can search and filter
# instantly in the browser. Building it takes ~80 upstream requests, so it is
# kept in memory and in the database, and refreshed weekly.

_library: dict[str, Any] | None = None
_library_lock = threading.Lock()
_library_thread: threading.Thread | None = None


def _fetch_library() -> dict[str, Any]:
    competitions = list_competitions()

    def season_matches(c: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        try:
            return c, list_matches(c["competition_id"], c["season_id"])
        except SourceUnavailable:
            logger.warning("Skipping %s %s: source unavailable", c["competition"], c["season"])
            return c, []

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(season_matches, competitions))

    seasons: list[dict[str, Any]] = []
    matches: list[dict[str, Any]] = []
    for c, rows in results:
        seasons.append({**c, "matches": len(rows)})
        for m in rows:
            matches.append({**m, "competition_id": c["competition_id"], "season_id": c["season_id"]})
    matches.sort(key=lambda m: m["date"], reverse=True)
    return {
        "seasons": seasons,
        "matches": matches,
        "built_at": datetime.now(UTC).isoformat(),
    }


def _load_cached_library() -> dict[str, Any] | None:
    with SessionLocal() as db:
        row = db.get(models.CatalogCache, LIBRARY_KEY)
        if row is None:
            return None
        updated = row.updated_at if row.updated_at.tzinfo else row.updated_at.replace(tzinfo=UTC)
        if datetime.now(UTC) - updated > LIBRARY_MAX_AGE:
            return None
        return row.data


def _save_library(library: dict[str, Any]) -> None:
    with SessionLocal() as db:
        db.merge(models.CatalogCache(key=LIBRARY_KEY, data=library, updated_at=datetime.now(UTC)))
        db.commit()


def _warm_library() -> None:
    global _library
    try:
        cached = _load_cached_library()
        if cached is not None:
            _library = cached
            logger.info("Match library loaded from cache: %d matches.", len(cached["matches"]))
            return
        library = _fetch_library()
        _library = library
        _save_library(library)
        logger.info("Match library built: %d matches.", len(library["matches"]))
    except Exception:
        logger.exception("Building the match library failed")


def warm_library_in_background() -> None:
    """Start loading the library if it isn't loaded or loading already."""
    global _library_thread
    with _library_lock:
        if _library is not None or (_library_thread is not None and _library_thread.is_alive()):
            return
        _library_thread = threading.Thread(target=_warm_library, name="tactix-library", daemon=True)
        _library_thread.start()


def get_library() -> dict[str, Any] | None:
    """The library if it's ready; otherwise starts loading it and returns None."""
    if _library is None:
        warm_library_in_background()
    return _library
