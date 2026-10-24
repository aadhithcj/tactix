"""Load a StatsBomb match into the database and build its playable moments.

Used by scripts/seed_db.py for the curated catalog and by the API to build a
moment from any open-data match on demand.
"""

import logging
from datetime import datetime
from typing import Any

import numpy as np
import pandas as pd
from sqlalchemy import delete, insert
from statsbombpy import sb

from app import models
from app.database import SessionLocal
from app.scenarios_catalog import ScenarioSpec
from app.services.data_engine import StatsBombProcessor
from app.services.snapshot import SnapshotBuilder

logger = logging.getLogger("tactix.ingest")

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


def _describe(spec: ScenarioSpec, snapshot: dict[str, Any]) -> tuple[str, str]:
    """Title and tagline for moments without hand-written copy."""
    if spec.title and spec.tagline:
        return spec.title, spec.tagline
    m = snapshot["match"]
    score = snapshot["score"]
    # StatsBomb names competitions like "Europe - Champions League".
    competition = m["competition"].split(" - ", 1)[-1]
    title = f"{m['home']} v {m['away']}, {spec.minute}'"
    tagline = (
        f"{competition} {m['season']}. {m['home']} {score['home']}–{score['away']} "
        f"{m['away']} after {spec.minute} minutes, with about {snapshot['horizon_minutes']} to go."
    )
    return spec.title or title, spec.tagline or tagline


def ingest_match(specs: list[ScenarioSpec], sort_orders: dict[str, int] | None = None) -> list[str]:
    """Fetch one match, store it with its events and players, and build a
    scenario for each spec (all specs must share the match). Returns slugs."""
    spec = specs[0]
    match_id = spec.match_id
    logger.info("Ingesting match_id=%d...", match_id)
    processor = StatsBombProcessor()

    events_df, metadata = processor.fetch_match_data(match_id, spec.competition_id, spec.season_id)
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

    snapshots = [(s, SnapshotBuilder(events_df, lineups, metadata, s).build()) for s in specs]

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

            db.execute(delete(models.MatchEvent).where(models.MatchEvent.match_id == match_id))
            if events_to_insert:
                db.execute(insert(models.MatchEvent), events_to_insert)

            for s, snapshot in snapshots:
                title, tagline = _describe(s, snapshot)
                db.merge(
                    models.Scenario(
                        slug=s.slug,
                        match_id=match_id,
                        minute=s.minute,
                        title=title,
                        tagline=tagline,
                        sort_order=(sort_orders or {}).get(s.slug, 1000),
                        snapshot=snapshot,
                    )
                )
            db.commit()
            logger.info(
                "Stored match %d: %d players, %d events, %d scenario(s).",
                match_id,
                len(players),
                len(events_to_insert),
                len(snapshots),
            )
        except Exception:
            db.rollback()
            logger.exception("Ingesting match %d failed", match_id)
            raise
    return [s.slug for s in specs]
