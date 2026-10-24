"""Build a playable moment from any StatsBomb open-data match, on demand.

The curated catalog has hand-written copy; these moments get generated titles
and dilemmas from the scoreline and time left. Swapping StatsBomb's open data
for a licensed feed later only changes where the events come from.
"""

import logging
from datetime import date
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
