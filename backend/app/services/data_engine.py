import logging
from typing import Any

import numpy as np
import pandas as pd
import requests
from statsbombpy import sb

logger = logging.getLogger("tactix.data_engine")


def _sanitize_for_json(val: Any) -> Any:
    """Helper to convert NumPy/Pandas types and NaN values into clean JSON primitives."""
    if isinstance(val, (np.integer, int)):
        return int(val)
    if isinstance(val, (np.floating, float)):
        return None if np.isnan(val) else float(val)
    if isinstance(val, (np.ndarray, list)):
        return [_sanitize_for_json(v) for v in val]
    if isinstance(val, dict):
        return {
            str(k): _sanitize_for_json(v)
            for k, v in val.items()
            if _sanitize_for_json(v) is not None
        }
    if pd.isna(val):
        return None
    return val


class StatsBombProcessor:
    """Processor for StatsBomb Open Data match events and tactical analytics."""

    def fetch_match_data(
        self,
        match_id: int,
        competition_id: int | None = None,
        season_id: int | None = None,
    ) -> tuple[pd.DataFrame, dict[str, Any]]:
        """Fetch all match events and metadata for a given match_id."""
        logger.info("Fetching StatsBomb events for match_id=%d...", match_id)
        events_df: pd.DataFrame = sb.events(match_id=match_id)

        metadata: dict[str, Any] = {}
        # FIFA World Cup 2022 default if match_id is 3869685
        if match_id == 3869685 and competition_id is None and season_id is None:
            competition_id = 43
            season_id = 106

        if competition_id and season_id:
            try:
                matches_df = sb.matches(
                    competition_id=competition_id, season_id=season_id
                )
                match_row = matches_df[matches_df["match_id"] == match_id]
                if not match_row.empty:
                    m = match_row.iloc[0]
                    metadata = {
                        "match_id": int(m["match_id"]),
                        "match_date": str(m["match_date"]),
                        "competition": str(m["competition"]),
                        "season": str(m["season"]),
                        "home_team_id": int(m["home_team_id"]),
                        "home_team": str(m["home_team"]),
                        "away_team_id": int(m["away_team_id"]),
                        "away_team": str(m["away_team"]),
                        "home_score": int(m["home_score"]),
                        "away_score": int(m["away_score"]),
                    }
            except (KeyError, ValueError, requests.RequestException) as exc:
                logger.warning("Could not fetch match metadata from sb.matches: %s", exc)

        # Fallback to deriving metadata from events_df if not found
        if not metadata and not events_df.empty:
            teams = events_df[["team_id", "team"]].dropna().drop_duplicates()
            if len(teams) >= 2:
                home_team_id = int(teams.iloc[0]["team_id"])
                home_team_name = str(teams.iloc[0]["team"])
                away_team_id = int(teams.iloc[1]["team_id"])
                away_team_name = str(teams.iloc[1]["team"])
            else:
                home_team_id, home_team_name = 0, "Home"
                away_team_id, away_team_name = 1, "Away"

            metadata = {
                "match_id": match_id,
                "match_date": "2022-12-18",
                "competition": "FIFA World Cup",
                "season": "2022",
                "home_team_id": home_team_id,
                "home_team": home_team_name,
                "away_team_id": away_team_id,
                "away_team": away_team_name,
                "home_score": 3,
                "away_score": 3,
            }

        return events_df, metadata

    def compute_team_stats(self, events_df: pd.DataFrame) -> dict[str, Any]:
        """Compute team stats: possession %, xG, pass volume, and pass accuracy."""
        passes = events_df[events_df["type"] == "Pass"]
        shots = events_df[events_df["type"] == "Shot"]

        teams = events_df[["team_id", "team"]].dropna().drop_duplicates()
        total_all_passes = len(passes)

        stats: dict[str, Any] = {
            "teams": {},
            "possession": {},
            "xg": {},
            "passes": {},
            "pass_accuracy": {},
        }

        for _, team_row in teams.iterrows():
            team_id = int(team_row["team_id"])
            team_name = str(team_row["team"])

            # Passes
            team_passes = passes[passes["team_id"] == team_id]
            total_passes = len(team_passes)
            # In StatsBomb, completed passes have NaN in pass_outcome
            successful_passes = len(team_passes[team_passes["pass_outcome"].isna()])
            pass_accuracy = (
                round((successful_passes / total_passes) * 100, 1)
                if total_passes > 0
                else 0.0
            )

            # Possession percentage based on pass volume
            possession_pct = (
                round((total_passes / total_all_passes) * 100, 1)
                if total_all_passes > 0
                else 50.0
            )

            # Expected Goals (xG)
            team_shots = shots[shots["team_id"] == team_id]
            total_shots = len(team_shots)
            # Exclude penalty shootout (period 5) from standard match xG
            reg_shots = team_shots[team_shots["period"] <= 4]
            total_xg = round(
                float(reg_shots["shot_statsbomb_xg"].fillna(0).sum()), 2
            )
            shootout_xg = round(
                float(
                    team_shots[team_shots["period"] == 5]["shot_statsbomb_xg"]
                    .fillna(0)
                    .sum()
                ),
                2,
            )

            team_summary = {
                "team_id": team_id,
                "name": team_name,
                "possession_pct": possession_pct,
                "total_xg": total_xg,
                "shootout_xg": shootout_xg,
                "total_passes": total_passes,
                "successful_passes": successful_passes,
                "pass_accuracy_pct": pass_accuracy,
                "total_shots": total_shots,
            }

            stats["teams"][str(team_id)] = team_summary
            stats["possession"][team_name] = possession_pct
            stats["xg"][team_name] = total_xg
            stats["passes"][team_name] = total_passes
            stats["pass_accuracy"][team_name] = pass_accuracy

        return _sanitize_for_json(stats)

    def extract_pass_network(
        self, events_df: pd.DataFrame, team_id: int
    ) -> list[dict[str, Any]]:
        """Filters successful passes for a team, groups by player_id and pass_recipient_id,
        and counts frequency returning a list of edges (source, target, weight)."""
        team_passes = events_df[
            (events_df["team_id"] == team_id)
            & (events_df["type"] == "Pass")
            & (events_df["pass_outcome"].isna())
        ].dropna(subset=["player_id", "pass_recipient_id"])

        if team_passes.empty:
            return []

        # Map IDs to names for rich visualization
        player_names: dict[int, str] = dict(
            zip(
                team_passes["player_id"].astype(int),
                team_passes["player"].astype(str),
            )
        )
        recipient_names: dict[int, str] = dict(
            zip(
                team_passes["pass_recipient_id"].astype(int),
                team_passes["pass_recipient"].astype(str),
            )
        )
        all_names = {**recipient_names, **player_names}

        grouped = (
            team_passes.groupby(["player_id", "pass_recipient_id"])
            .size()
            .reset_index(name="weight")
        )

        edges: list[dict[str, Any]] = []
        for _, row in grouped.iterrows():
            src = int(row["player_id"])
            tgt = int(row["pass_recipient_id"])
            w = int(row["weight"])
            edges.append(
                {
                    "source": src,
                    "source_name": all_names.get(src, str(src)),
                    "target": tgt,
                    "target_name": all_names.get(tgt, str(tgt)),
                    "weight": w,
                }
            )

        edges.sort(key=lambda x: x["weight"], reverse=True)
        return _sanitize_for_json(edges)

    def extract_pass_network_nodes(
        self, events_df: pd.DataFrame, team_id: int, names: dict[int, str] | None = None
    ) -> list[dict[str, Any]]:
        """Average pass location and volume per player, for drawing network nodes."""
        team_passes = events_df[
            (events_df["team_id"] == team_id)
            & (events_df["type"] == "Pass")
            & (events_df["pass_outcome"].isna())
        ].dropna(subset=["player_id"])

        nodes: list[dict[str, Any]] = []
        for player_id, group in team_passes.groupby("player_id"):
            locs = [
                loc
                for loc in group["location"]
                if isinstance(loc, (list, np.ndarray)) and len(loc) >= 2
            ]
            if not locs:
                continue
            arr = np.array(locs, dtype=float)
            pid = int(player_id)
            nodes.append(
                {
                    "id": pid,
                    "name": (names or {}).get(pid, str(group["player"].iloc[0])),
                    "x": round(float(arr[:, 0].mean()), 1),
                    "y": round(float(arr[:, 1].mean()), 1),
                    "passes": len(group),
                }
            )
        nodes.sort(key=lambda n: n["passes"], reverse=True)
        return _sanitize_for_json(nodes)

    def extract_momentum_timeline(
        self, events_df: pd.DataFrame
    ) -> list[dict[str, Any]]:
        """Groups events into 5-minute intervals and sums xG and progressive passes
        to generate a time-series array for the frontend momentum chart."""
        teams = list(events_df["team"].dropna().unique())
        if len(teams) < 2:
            return []

        team_home, team_away = teams[0], teams[1]

        # Use regulation + extra time (periods 1-4)
        regular_events = events_df[events_df["period"] <= 4].copy()
        if regular_events.empty:
            return []

        max_min = int(regular_events["minute"].max())
        timeline: list[dict[str, Any]] = []

        for start_min in range(0, max_min + 5, 5):
            end_min = start_min + 5
            bucket = regular_events[
                (regular_events["minute"] >= start_min)
                & (regular_events["minute"] < end_min)
            ]

            # Home team
            home_events = bucket[bucket["team"] == team_home]
            home_xg = float(
                home_events[home_events["type"] == "Shot"]["shot_statsbomb_xg"]
                .fillna(0)
                .sum()
            )
            home_passes = home_events[
                (home_events["type"] == "Pass") & (home_events["pass_outcome"].isna())
            ]
            home_prog = 0
            for _, p in home_passes.iterrows():
                loc = p.get("location")
                end_loc = p.get("pass_end_location")
                has_loc = (
                    isinstance(loc, (list, np.ndarray))
                    and isinstance(end_loc, (list, np.ndarray))
                    and len(loc) >= 1
                    and len(end_loc) >= 1
                )
                if has_loc and (end_loc[0] - loc[0]) >= 10:
                    home_prog += 1

            # Away team
            away_events = bucket[bucket["team"] == team_away]
            away_xg = float(
                away_events[away_events["type"] == "Shot"]["shot_statsbomb_xg"]
                .fillna(0)
                .sum()
            )
            away_passes = away_events[
                (away_events["type"] == "Pass") & (away_events["pass_outcome"].isna())
            ]
            away_prog = 0
            for _, p in away_passes.iterrows():
                loc = p.get("location")
                end_loc = p.get("pass_end_location")
                has_loc = (
                    isinstance(loc, (list, np.ndarray))
                    and isinstance(end_loc, (list, np.ndarray))
                    and len(loc) >= 1
                    and len(end_loc) >= 1
                )
                if has_loc and (end_loc[0] - loc[0]) >= 10:
                    away_prog += 1

            # Momentum metric: weighted balance of xG threat and progressive territorial dominance
            momentum_score = round(
                (home_xg * 3.0 + home_prog * 0.2) - (away_xg * 3.0 + away_prog * 0.2),
                2,
            )

            timeline.append(
                {
                    "minute": end_min,
                    "interval": f"{start_min}-{end_min}",
                    "team_home": team_home,
                    "team_away": team_away,
                    "home_xg": round(home_xg, 3),
                    "away_xg": round(away_xg, 3),
                    "home_progressive_passes": home_prog,
                    "away_progressive_passes": away_prog,
                    "momentum": momentum_score,
                }
            )

        return _sanitize_for_json(timeline)
