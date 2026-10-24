import argparse
import asyncio
import logging
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sqlalchemy import delete, insert

# Ensure backend root is on sys.path
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from statsbombpy import sb

from app import models
from app.database import SessionLocal, init_db
from app.scenarios_catalog import CATALOG, ScenarioSpec
from app.services.data_engine import StatsBombProcessor
from app.services.snapshot import SnapshotBuilder

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("tactix.seed_db")

TARGET_EVENT_TYPES = {
    "Pass",
    "Shot",
    "Pressure",
    "Duel",
    "Interception",
    "Block",
    "Clearance",
    "Dribble",
    "Ball Recovery",
    "Foul Committed",
    "Foul Won",
}

END_LOCATION_COLUMN = {
    "Pass": "pass_end_location",
    "Shot": "shot_end_location",
    "Carry": "carry_end_location",
}


def _extract_outcome(row: pd.Series) -> str | None:
    for col in (
        "pass_outcome",
        "shot_outcome",
        "duel_outcome",
        "dribble_outcome",
        "interception_outcome",
    ):
        if pd.notna(row.get(col)):
            return str(row[col])
    if row.get("type") == "Pass":
        return "Complete"
    return None


def _clean_metadata(row: pd.Series) -> dict[str, Any]:
    raw: dict[str, Any] = {}
    for col in (
        "period",
        "play_pattern",
        "under_pressure",
        "counterpress",
        "duration",
        "pass_body_part",
        "pass_height",
        "pass_length",
        "shot_technique",
        "shot_type",
        "shot_body_part",
    ):
        val = row.get(col)
        if pd.notna(val):
            raw[col] = (
                bool(val)
                if isinstance(val, (bool, np.bool_))
                else float(val)
                if isinstance(val, (float, np.floating, int, np.integer))
                else str(val)
            )
    return raw


def _xy(val: Any) -> tuple[float | None, float | None]:
    if isinstance(val, (list, np.ndarray)) and len(val) >= 2:
        return float(val[0]), float(val[1])
    return None, None


def _players(lineups: dict[str, pd.DataFrame], team_ids: dict[str, int]) -> dict[int, models.Player]:
    players: dict[int, models.Player] = {}
    for team_name, df in lineups.items():
        for _, row in df.iterrows():
            pid = int(row["player_id"])
            positions = row.get("positions") or []
            nickname = row.get("player_nickname")
            players[pid] = models.Player(
                id=pid,
                name=str(row["player_name"]),
                nickname=str(nickname) if isinstance(nickname, str) and nickname else None,
                jersey_number=int(row["jersey_number"]) if pd.notna(row.get("jersey_number")) else None,
                team_id=team_ids.get(team_name),
                position=positions[0]["position"] if positions else None,
            )
    return players


def seed_match(specs: list[ScenarioSpec]) -> None:
    spec = specs[0]
    match_id = spec.match_id
    logger.info("Seeding match_id=%d...", match_id)
    processor = StatsBombProcessor()

    events_df, metadata = processor.fetch_match_data(
        match_id, spec.competition_id, spec.season_id
    )
    lineups = sb.lineups(match_id=match_id)
    logger.info(
        "Fetched %d events for %s vs %s",
        len(events_df),
        metadata.get("home_team", "Home"),
        metadata.get("away_team", "Away"),
    )

    team_ids = {
        metadata["home_team"]: metadata["home_team_id"],
        metadata["away_team"]: metadata["away_team_id"],
    }
    players = _players(lineups, team_ids)
    display_names = {pid: p.nickname or p.name for pid, p in players.items()}

    team_stats = processor.compute_team_stats(events_df)
    stats_json = {
        "team_stats": team_stats,
        "pass_networks": {
            str(metadata[f"{side}_team_id"]): {
                "team_name": metadata[f"{side}_team"],
                "edges": processor.extract_pass_network(events_df, metadata[f"{side}_team_id"]),
                "nodes": processor.extract_pass_network_nodes(
                    events_df, metadata[f"{side}_team_id"], display_names
                ),
            }
            for side in ("home", "away")
        },
        "momentum_timeline": processor.extract_momentum_timeline(events_df),
    }

    home_stats = team_stats.get("teams", {}).get(str(metadata["home_team_id"]), {})
    away_stats = team_stats.get("teams", {}).get(str(metadata["away_team_id"]), {})
    match_date = datetime.strptime(metadata["match_date"], "%Y-%m-%d").date()

    snapshots = [
        (s, SnapshotBuilder(events_df, lineups, metadata, s).build()) for s in specs
    ]

    events_to_insert: list[dict[str, Any]] = []
    action_df = events_df[events_df["type"].isin(TARGET_EVENT_TYPES)]
    for _, row in action_df.iterrows():
        loc_x, loc_y = _xy(row.get("location"))
        end_col = END_LOCATION_COLUMN.get(str(row["type"]))
        end_x, end_y = _xy(row.get(end_col)) if end_col else (None, None)
        events_to_insert.append(
            {
                "id": str(row["id"]),
                "match_id": match_id,
                "team_id": int(row["team_id"]),
                "player_id": int(row["player_id"]) if pd.notna(row.get("player_id")) else None,
                "minute": int(row["minute"]),
                "second": int(row["second"]) if pd.notna(row.get("second")) else 0,
                "event_type": str(row["type"]),
                "location_x": loc_x,
                "location_y": loc_y,
                "end_location_x": end_x,
                "end_location_y": end_y,
                "xg": float(row["shot_statsbomb_xg"]) if pd.notna(row.get("shot_statsbomb_xg")) else None,
                "outcome": _extract_outcome(row),
                "raw_metadata": _clean_metadata(row),
            }
        )

    with SessionLocal() as db:
        try:
            for name, tid in team_ids.items():
                db.merge(models.Team(id=tid, name=name))
            db.flush()

            db.merge(
                models.Match(
                    id=match_id,
                    competition=metadata["competition"],
                    season=metadata["season"],
                    match_date=match_date,
                    home_team_id=metadata["home_team_id"],
                    away_team_id=metadata["away_team_id"],
                    home_score=metadata["home_score"],
                    away_score=metadata["away_score"],
                    home_xg=float(home_stats.get("total_xg", 0.0)),
                    away_xg=float(away_stats.get("total_xg", 0.0)),
                    stats_json=stats_json,
                )
            )
            db.flush()

            for player in players.values():
                db.merge(player)
            db.flush()
            logger.info("Upserted %d players.", len(players))

            db.execute(delete(models.MatchEvent).where(models.MatchEvent.match_id == match_id))
            if events_to_insert:
                db.execute(insert(models.MatchEvent), events_to_insert)
            logger.info("Inserted %d events.", len(events_to_insert))

            for s, snapshot in snapshots:
                db.merge(
                    models.Scenario(
                        slug=s.slug,
                        match_id=match_id,
                        minute=s.minute,
                        title=s.title,
                        tagline=s.tagline,
                        sort_order=CATALOG.index(s),
                        snapshot=snapshot,
                    )
                )
            db.commit()
            logger.info("Seeded %d scenario(s) for match %d.", len(snapshots), match_id)
        except Exception as exc:
            db.rollback()
            logger.error("Seeding match %d failed: %s", match_id, exc)
            raise


async def seed_database(only: list[str] | None = None) -> None:
    """Fetch StatsBomb data for every catalog scenario and populate PostgreSQL."""
    init_db()
    by_match: dict[int, list[ScenarioSpec]] = {}
    for spec in CATALOG:
        if only and spec.slug not in only:
            continue
        by_match.setdefault(spec.match_id, []).append(spec)

    for specs in by_match.values():
        await asyncio.to_thread(seed_match, specs)
    logger.info("Database seeding completed: %d match(es).", len(by_match))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed TACTIX with StatsBomb open data.")
    parser.add_argument("slugs", nargs="*", help="Only seed these scenario slugs.")
    args = parser.parse_args()
    asyncio.run(seed_database(args.slugs or None))
