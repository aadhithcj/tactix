"""Freeze a match at a minute and describe it from both sides.

All coordinates use StatsBomb's 120 x 80 pitch in the *team's own frame*:
x = 0 is the team's own goal line, x = 120 the goal it attacks, and y = 80 is
the team's right touchline. StatsBomb already records every event in the
acting team's attacking direction, so opponents are mirrored into this frame.
"""

import logging
from typing import Any

import numpy as np
import pandas as pd

from app.scenarios_catalog import ScenarioSpec

logger = logging.getLogger("tactix.snapshot")

PITCH_X = 120.0
PITCH_Y = 80.0
GRID_COLS = 12
GRID_ROWS = 8
POSITION_WINDOW_MINUTES = 25
LEAGUE_XG_PER_MIN = 1.35 / 90  # Prior used to stabilise small samples.

TEAM_CODES = {
    "Argentina": "ARG",
    "France": "FRA",
    "Croatia": "CRO",
    "Italy": "ITA",
    "England": "ENG",
    "Spain": "ESP",
    "Germany": "GER",
    "Brazil": "BRA",
    "Portugal": "POR",
    "Netherlands": "NED",
    "Belgium": "BEL",
    "United States": "USA",
    "Morocco": "MAR",
    "Japan": "JPN",
    "Real Madrid": "RMA",
    "Barcelona": "BAR",
    "Atlético Madrid": "ATM",
    "Manchester United": "MUN",
    "Manchester City": "MCI",
    "Liverpool": "LIV",
    "Chelsea": "CHE",
    "Arsenal": "ARS",
    "Tottenham Hotspur": "TOT",
    "Bayern Munich": "BAY",
    "Borussia Dortmund": "BVB",
    "Bayer Leverkusen": "B04",
    "Juventus": "JUV",
    "AC Milan": "MIL",
    "Inter Milan": "INT",
    "Paris Saint-Germain": "PSG",
    "Ajax": "AJA",
}

# StatsBomb nicknames that differ from how the player is commonly known.
NAME_OVERRIDES = {"Randal Kolo": "Kolo Muani"}

# Typical spots per StatsBomb position, in the team's own frame.
POSITION_TEMPLATE: dict[str, tuple[float, float]] = {
    "Goalkeeper": (6, 40),
    "Right Back": (32, 70),
    "Left Back": (32, 10),
    "Right Center Back": (24, 52),
    "Left Center Back": (24, 28),
    "Center Back": (22, 40),
    "Right Wing Back": (44, 72),
    "Left Wing Back": (44, 8),
    "Right Defensive Midfield": (40, 48),
    "Left Defensive Midfield": (40, 32),
    "Center Defensive Midfield": (40, 40),
    "Right Center Midfield": (54, 50),
    "Left Center Midfield": (54, 30),
    "Center Midfield": (54, 40),
    "Right Midfield": (58, 70),
    "Left Midfield": (58, 10),
    "Right Attacking Midfield": (72, 52),
    "Center Attacking Midfield": (72, 40),
    "Left Attacking Midfield": (72, 28),
    "Right Wing": (82, 68),
    "Left Wing": (82, 12),
    "Right Center Forward": (92, 48),
    "Left Center Forward": (92, 32),
    "Center Forward": (94, 40),
    "Secondary Striker": (86, 40),
}


def role_for(position: str | None) -> str:
    if not position:
        return "MID"
    if position == "Goalkeeper":
        return "GK"
    if "Back" in position:
        return "DEF"
    if "Forward" in position or position.endswith("Wing") or "Striker" in position:
        return "FWD"
    return "MID"


def team_code(name: str) -> str:
    return TEAM_CODES.get(name, name[:3].upper())


def _loc(val: Any) -> tuple[float, float] | None:
    if isinstance(val, (list, np.ndarray)) and len(val) >= 2:
        return float(val[0]), float(val[1])
    return None


def _clock(row: pd.Series) -> float:
    return float(row["minute"]) * 60 + float(row.get("second") or 0)


def _mirror(x: float, y: float) -> tuple[float, float]:
    return PITCH_X - x, PITCH_Y - y


def auto_dilemma(goals_for: int, goals_against: int, opponent: str, horizon: int) -> str:
    """Plain framing for moments without hand-written copy."""
    mins = f"{horizon} minutes"
    if goals_for > goals_against:
        return (
            f"You lead {goals_for}–{goals_against} with about {mins} to play. "
            f"Shut {opponent} out, or go for the goal that ends it?"
        )
    if goals_for < goals_against:
        return (
            f"You're {goals_for}–{goals_against} down with about {mins} left. "
            f"Something has to change before {opponent} see it out."
        )
    return (
        f"It's {goals_for}–{goals_against} with about {mins} left. "
        f"Push for a winner against {opponent}, or make sure you don't lose it?"
    )


class SnapshotBuilder:
    def __init__(
        self,
        events: pd.DataFrame,
        lineups: dict[str, pd.DataFrame],
        metadata: dict[str, Any],
        spec: ScenarioSpec,
    ) -> None:
        self.events = events.copy()
        self.events["_clock"] = self.events.apply(_clock, axis=1)
        self.lineups = lineups
        self.meta = metadata
        self.spec = spec
        self.cutoff = spec.minute * 60.0 + spec.second
        self.before = self.events[
            (self.events["_clock"] < self.cutoff) & (self.events["period"] <= 4)
        ]
        self.people = self._people_index()

    # ------------------------------------------------------------------ people
    def _people_index(self) -> dict[int, dict[str, Any]]:
        people: dict[int, dict[str, Any]] = {}
        for team_name, df in self.lineups.items():
            for _, row in df.iterrows():
                nickname = row.get("player_nickname")
                name = nickname if isinstance(nickname, str) and nickname else row["player_name"]
                name = NAME_OVERRIDES.get(str(name), str(name))
                positions = row.get("positions") or []
                preferred = positions[0]["position"] if positions else None
                people[int(row["player_id"])] = {
                    "id": int(row["player_id"]),
                    "name": str(name),
                    "full_name": str(row["player_name"]),
                    "number": int(row["jersey_number"]) if pd.notna(row.get("jersey_number")) else None,
                    "team": team_name,
                    "preferred_position": preferred,
                }
        return people

    def _person(self, player_id: int, fallback_name: str = "") -> dict[str, Any]:
        return self.people.get(
            player_id,
            {"id": player_id, "name": fallback_name, "number": None, "preferred_position": None},
        )

    # --------------------------------------------------------------- on pitch
    def _on_pitch(self, team: str) -> tuple[dict[int, str], str, int]:
        """Return {player_id: position}, formation, and substitutions used."""
        team_ev = self.before[self.before["team"] == team]
        shape_ev = team_ev[team_ev["type"].isin(["Starting XI", "Tactical Shift"])]
        if shape_ev.empty:
            shape_ev = self.events[
                (self.events["team"] == team) & (self.events["type"] == "Starting XI")
            ]
        last_shape = shape_ev.sort_values("_clock").iloc[-1]
        tactics = last_shape["tactics"]
        lineup = {
            int(p["player"]["id"]): p["position"]["name"] for p in tactics["lineup"]
        }
        formation = "-".join(str(tactics.get("formation", "")))

        subs = team_ev[team_ev["type"] == "Substitution"].sort_values("_clock")
        for _, sub in subs.iterrows():
            if sub["_clock"] < last_shape["_clock"]:
                continue
            off_id = int(sub["player_id"])
            on_id = int(sub["substitution_replacement_id"])
            position = lineup.pop(off_id, sub.get("position"))
            lineup[on_id] = position

        # Red cards remove a player outright.
        for col in ("foul_committed_card", "bad_behaviour_card"):
            if col in team_ev.columns:
                reds = team_ev[team_ev[col].isin(["Red Card", "Second Yellow"])]
                for _, red in reds.iterrows():
                    lineup.pop(int(red["player_id"]), None)

        return lineup, formation, len(subs)

    def _used_players(self, team: str) -> set[int]:
        """Starters plus anyone subbed on before the cutoff."""
        used: set[int] = set()
        xi = self.events[(self.events["team"] == team) & (self.events["type"] == "Starting XI")]
        for _, row in xi.iterrows():
            used.update(int(p["player"]["id"]) for p in row["tactics"]["lineup"])
        subs = self.before[(self.before["team"] == team) & (self.before["type"] == "Substitution")]
        used.update(int(v) for v in subs["substitution_replacement_id"].dropna())
        return used

    def _player_spot(self, team: str, player_id: int, position: str) -> tuple[float, float, int]:
        window = self.before[
            (self.before["team"] == team)
            & (self.before["player_id"] == player_id)
            & (self.before["_clock"] >= self.cutoff - POSITION_WINDOW_MINUTES * 60)
            & (self.before["type"] != "Substitution")
        ]
        locs = [loc for loc in (_loc(v) for v in window["location"]) if loc]
        tx, ty = POSITION_TEMPLATE.get(position, (55.0, 40.0))
        if not locs:
            return tx, ty, 0
        arr = np.array(locs)
        mx, my = float(np.median(arr[:, 0])), float(np.median(arr[:, 1]))
        # On-ball medians drift towards where a player receives the ball, so
        # blend with the role template; trust the data more with more touches.
        w = min(0.8, len(locs) / 25)
        if position == "Goalkeeper":
            w = min(w, 0.3)
        return (
            round(w * mx + (1 - w) * tx, 1),
            round(w * my + (1 - w) * ty, 1),
            len(locs),
        )

    # ----------------------------------------------------------------- threat
    def _threat_against(self, team: str, opponent: str) -> tuple[list[list[float]], dict[str, Any] | None]:
        """Where the opponent hurts this team, gridded in this team's frame."""
        grid = np.zeros((GRID_ROWS, GRID_COLS))
        opp = self.before[self.before["team"] == opponent]
        per_player: dict[int, dict[str, float]] = {}

        def add(x: float, y: float, weight: float, pid: Any) -> None:
            fx, fy = _mirror(x, y)
            dist = np.hypot(fx - 0, fy - 40)
            value = weight * np.exp(-dist / 30)
            col = min(GRID_COLS - 1, max(0, int(fx / (PITCH_X / GRID_COLS))))
            row = min(GRID_ROWS - 1, max(0, int(fy / (PITCH_Y / GRID_ROWS))))
            grid[row, col] += value
            if pd.notna(pid):
                stats = per_player.setdefault(int(pid), {"threat": 0.0, "xg": 0.0, "shots": 0, "final_third": 0, "xs": [], "ys": []})
                stats["threat"] += value
                stats["xs"].append(fx)
                stats["ys"].append(fy)

        for _, ev in opp.iterrows():
            kind = ev["type"]
            start = _loc(ev.get("location"))
            if kind == "Pass" and pd.isna(ev.get("pass_outcome")):
                end = _loc(ev.get("pass_end_location"))
                if end:
                    add(*end, 1.0, ev.get("pass_recipient_id"))
                    if end[0] >= 80 and pd.notna(ev.get("player_id")):
                        s = per_player.setdefault(int(ev["player_id"]), {"threat": 0.0, "xg": 0.0, "shots": 0, "final_third": 0, "xs": [], "ys": []})
                        s["final_third"] += 1
            elif kind == "Carry":
                end = _loc(ev.get("carry_end_location"))
                if end and end[0] >= 60:
                    add(*end, 0.8, ev.get("player_id"))
            elif kind == "Dribble" and start:
                add(*start, 1.2, ev.get("player_id"))
            elif kind == "Shot" and start:
                xg = float(ev.get("shot_statsbomb_xg") or 0)
                add(*start, 2.0 + 20 * xg, ev.get("player_id"))
                if pd.notna(ev.get("player_id")):
                    s = per_player[int(ev["player_id"])]
                    s["xg"] += xg
                    s["shots"] += 1

        total = grid.sum()
        if total > 0:
            grid = grid / total

        key: dict[str, Any] | None = None
        if per_player:
            pid, stats = max(
                per_player.items(),
                key=lambda kv: kv[1]["threat"] + 8 * kv[1]["xg"] + 0.6 * kv[1]["final_third"],
            )
            person = self._person(pid)
            threat_sum = sum(s["threat"] for s in per_player.values()) or 1
            key = {
                "player_id": pid,
                "name": person["name"],
                "number": person["number"],
                "x": round(float(np.median(stats["xs"])), 1),
                "y": round(float(np.median(stats["ys"])), 1),
                "xg": round(stats["xg"], 2),
                "shots": int(stats["shots"]),
                "final_third_passes": int(stats["final_third"]),
                "threat_share": round(float(stats["threat"] / threat_sum), 3),
            }
        return [[round(float(v), 4) for v in row] for row in grid], key

    # ------------------------------------------------------------------ rates
    def _xg_before(self, team: str) -> float:
        shots = self.before[(self.before["team"] == team) & (self.before["type"] == "Shot")]
        return float(shots["shot_statsbomb_xg"].fillna(0).sum())

    def _baseline_rate(self, team: str) -> float:
        xg = self._xg_before(team)
        prior_minutes = 30
        return (xg + LEAGUE_XG_PER_MIN * prior_minutes) / (self.spec.minute + prior_minutes)

    def _goals(self) -> list[dict[str, Any]]:
        goals: list[dict[str, Any]] = []
        ev = self.events[self.events["period"] <= 4]
        for _, row in ev.iterrows():
            if row["type"] == "Shot" and row.get("shot_outcome") == "Goal":
                goals.append({"minute": int(row["minute"]) + 1, "period": int(row["period"]), "_clock": row["_clock"], "team": row["team"], "player": self._person(int(row["player_id"]), str(row["player"]))["name"]})
            elif row["type"] == "Own Goal For":
                goals.append({"minute": int(row["minute"]) + 1, "period": int(row["period"]), "_clock": row["_clock"], "team": row["team"], "player": "Own goal"})
        goals.sort(key=lambda g: g["_clock"])
        return goals

    def _shootout(self) -> dict[str, int] | None:
        pens = self.events[(self.events["period"] == 5) & (self.events["type"] == "Shot")]
        if pens.empty:
            return None
        scored = pens[pens["shot_outcome"] == "Goal"]
        return {team: int((scored["team"] == team).sum()) for team in pens["team"].unique()}

    # ------------------------------------------------------------------ build
    def build(self) -> dict[str, Any]:
        home, away = self.meta["home_team"], self.meta["away_team"]
        goals = self._goals()
        before_goals = [g for g in goals if g["_clock"] < self.cutoff]
        after_goals = [g for g in goals if g["_clock"] >= self.cutoff]
        score = {
            "home": sum(1 for g in before_goals if g["team"] == home),
            "away": sum(1 for g in before_goals if g["team"] == away),
        }

        period2 = self.events[self.events["period"] == 2]
        full_time = int(period2["minute"].max()) if not period2.empty else 90
        horizon = max(5, full_time - self.spec.minute)

        after_reg = self.events[
            (self.events["_clock"] >= self.cutoff)
            & (self.events["period"] <= 2)
            & (self.events["type"] == "Shot")
        ]
        sides: dict[str, Any] = {}
        for team, opponent in ((home, away), (away, home)):
            lineup, formation, subs_used = self._on_pitch(team)
            players = []
            for pid, position in lineup.items():
                x, y, touches = self._player_spot(team, pid, position)
                person = self._person(pid)
                players.append({
                    "id": pid,
                    "name": person["name"],
                    "number": person["number"],
                    "position": position,
                    "role": role_for(position),
                    "x": x,
                    "y": y,
                    "touches": touches,
                })
            players.sort(key=lambda p: (p["x"], p["y"]))

            appeared = self._used_players(team)
            bench = []
            for person in self.people.values():
                if person["team"] != team or person["id"] in lineup or person["id"] in appeared:
                    continue
                bench.append({
                    "id": person["id"],
                    "name": person["name"],
                    "number": person["number"],
                    "position": person["preferred_position"],
                    "role": role_for(person["preferred_position"]) if person["preferred_position"] else None,
                })
            # Players who actually came on later are the most relevant options.
            bench.sort(key=lambda b: (b["position"] is None, b["number"] or 99))

            threat_grid, key_threat = self._threat_against(team, opponent)
            team_id = int(self.meta["home_team_id"] if team == home else self.meta["away_team_id"])
            sides[str(team_id)] = {
                "team_id": team_id,
                "name": team,
                "code": team_code(team),
                "is_home": team == home,
                "formation": formation,
                "dilemma": self.spec.dilemmas.get(team)
                or auto_dilemma(
                    score["home"] if team == home else score["away"],
                    score["away"] if team == home else score["home"],
                    opponent,
                    horizon,
                ),
                "players": players,
                "bench": bench,
                "subs_used": subs_used,
                "subs_allowed": self.spec.subs_allowed,
                "threat_grid": threat_grid,
                "key_threat": key_threat,
                "baseline": {
                    "xg_for_per_min": round(self._baseline_rate(team), 5),
                    "xg_against_per_min": round(self._baseline_rate(opponent), 5),
                    "xg_for_so_far": round(self._xg_before(team), 2),
                    "xg_against_so_far": round(self._xg_before(opponent), 2),
                },
                "actual_after": {
                    "xg_for": round(float(after_reg[after_reg["team"] == team]["shot_statsbomb_xg"].fillna(0).sum()), 2),
                    "xg_against": round(float(after_reg[after_reg["team"] == opponent]["shot_statsbomb_xg"].fillna(0).sum()), 2),
                },
            }

        regulation = {
            "home": sum(1 for g in goals if g["team"] == home and g["period"] <= 2),
            "away": sum(1 for g in goals if g["team"] == away and g["period"] <= 2),
        }
        return {
            "match": {
                "id": int(self.meta["match_id"]),
                "competition": self.meta["competition"],
                "season": self.meta["season"],
                "date": self.meta["match_date"],
                "venue": self.spec.venue or str(self.meta.get("stadium") or ""),
                "home_team_id": int(self.meta["home_team_id"]),
                "away_team_id": int(self.meta["away_team_id"]),
                "home": home,
                "away": away,
            },
            "minute": self.spec.minute,
            "second": self.spec.second,
            "horizon_minutes": horizon,
            "full_time_minute": full_time,
            "score": score,
            "sides": sides,
            "actual": {
                "goals_after": [{k: v for k, v in g.items() if k != "_clock"} for g in after_goals],
                "score_at_full_time": regulation,
                "final_score": {"home": int(self.meta["home_score"]), "away": int(self.meta["away_score"])},
                "went_to_extra_time": bool((self.events["period"] >= 3).any()),
                "shootout": self._shootout(),
            },
        }
