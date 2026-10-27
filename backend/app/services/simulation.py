"""Deterministic tactical evaluation.

The model compares the user's set-up with how the team really lined up at the
frozen minute. Spatial measures (threat coverage, line height, marking, bodies
forward) and a tactic profile scale each side's real chance-creation rate over
the rest of normal time. Outputs are projected expected goals, never win
probabilities: the model is a structured estimate, not a validated forecaster.
"""

import math
import re
from dataclasses import dataclass
from typing import Any

from app.services.snapshot import GRID_COLS, GRID_ROWS, PITCH_X, PITCH_Y

COVER_SIGMA = 9.0  # Yards of influence around a player.
MARK_SIGMA = 8.0
FINAL_THIRD_X = 80.0


@dataclass(frozen=True)
class TacticProfile:
    """0..1 dials. depth: how high the block sits; press: pressing intensity;
    marking: dedication to the key threat; attack: commitment going forward;
    width: through the middle (0) or round the outside (1); direct: patient
    possession (0) or straight at them (1). Width and directness default to
    neutral, where they change nothing."""

    depth: float
    press: float
    marking: float
    attack: float
    label: str
    width: float = 0.5
    direct: float = 0.4

    def as_dict(self) -> dict[str, Any]:
        return {
            "depth": round(self.depth, 2),
            "press": round(self.press, 2),
            "marking": round(self.marking, 2),
            "attack": round(self.attack, 2),
            "width": round(self.width, 2),
            "direct": round(self.direct, 2),
            "label": self.label,
        }


PRESETS: dict[str, TacticProfile] = {
    "park_bus": TacticProfile(0.10, 0.15, 0.30, 0.15, "Park the bus"),
    "high_press": TacticProfile(0.85, 0.95, 0.30, 0.65, "High press"),
    "mark_threat": TacticProfile(0.45, 0.45, 1.00, 0.40, "Mark the threat"),
    "false_nine": TacticProfile(0.55, 0.55, 0.30, 0.50, "False 9", width=0.40, direct=0.20),
    "counter": TacticProfile(0.20, 0.30, 0.35, 0.35, "Counter-attack", width=0.50, direct=0.90),
    "tiki_taka": TacticProfile(0.60, 0.60, 0.30, 0.50, "Tiki-taka", width=0.45, direct=0.05),
    "wing_play": TacticProfile(0.50, 0.45, 0.30, 0.55, "Wing play", width=0.95, direct=0.50),
}
NEUTRAL = TacticProfile(0.50, 0.45, 0.30, 0.45, "Custom plan")

_KEYWORDS: tuple[tuple[str, dict[str, float]], ...] = (
    (r"\b(park|bus|low block|deep|sit (back|deep|tight)|defend|protect|drop)\b", {"depth": -0.3, "attack": -0.2, "press": -0.15}),
    (r"\b(press|squeeze|high line|push (up|high)|aggressive|front foot)\b", {"depth": 0.3, "press": 0.35}),
    (r"\b(mark|man[- ]?mark|shadow|follow|double[- ]?team|tight on)\b", {"marking": 0.5}),
    (r"\b(attack|all out|go for|chase|throw|more bodies|overload|winner|equali[sz]er)\b", {"attack": 0.35, "depth": 0.1}),
    (r"\b(counter|break|transition|long ball|in behind)\b", {"attack": 0.15, "depth": -0.15, "direct": 0.35}),
    (r"\b(keep (the )?ball|possession|patient|control|rest defen[cs]e)\b", {"attack": 0.05, "press": 0.05, "direct": -0.25}),
    (r"\b(tiki[- ]?taka|short pass(es|ing)?|one[- ]?touch|pass(ing)? it out)\b", {"direct": -0.3}),
    (r"\b(false (9|nine)|drop(ping)? striker|striker drops)\b", {"direct": -0.2, "width": -0.1}),
    (r"\b(wide|width|wing(s|ers)?|cross(es|ing)?|flanks?|stretch)\b", {"width": 0.35}),
    (r"\b(narrow|through the middle|central(ly)?|half[- ]?spaces?)\b", {"width": -0.3}),
    (r"\b(waste time|time[- ]?waste|slow (it|the game) down|manage)\b", {"attack": -0.15, "press": -0.1}),
)


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def profile_from_text(plan: str) -> TacticProfile:
    """Keyword reading of a free-text plan; used when no LLM is configured."""
    dials = {
        "depth": NEUTRAL.depth,
        "press": NEUTRAL.press,
        "marking": NEUTRAL.marking,
        "attack": NEUTRAL.attack,
        "width": NEUTRAL.width,
        "direct": NEUTRAL.direct,
    }
    text = plan.lower()
    for pattern, deltas in _KEYWORDS:
        if re.search(pattern, text):
            for key, delta in deltas.items():
                dials[key] = _clamp(dials[key] + delta)
    return TacticProfile(label="Custom plan", **dials)


# ------------------------------------------------------------------ geometry
def _zone_centres() -> list[tuple[int, int, float, float]]:
    w, h = PITCH_X / GRID_COLS, PITCH_Y / GRID_ROWS
    return [
        (r, c, (c + 0.5) * w, (r + 0.5) * h)
        for r in range(GRID_ROWS)
        for c in range(GRID_COLS)
    ]


def zone_cover(players: list[dict[str, Any]], zx: float, zy: float) -> float:
    miss = 1.0
    for p in players:
        d2 = (p["x"] - zx) ** 2 + (p["y"] - zy) ** 2
        miss *= 1 - math.exp(-d2 / (2 * COVER_SIGMA**2))
    return 1 - miss


def threat_coverage(players: list[dict[str, Any]], grid: list[list[float]]) -> tuple[float, list[dict[str, Any]]]:
    total = sum(sum(row) for row in grid) or 1.0
    covered = 0.0
    exposure: list[dict[str, Any]] = []
    for r, c, zx, zy in _zone_centres():
        threat = grid[r][c]
        cov = zone_cover(players, zx, zy)
        covered += threat * cov
        exposure.append({"row": r, "col": c, "x": zx, "y": zy, "open": threat * (1 - cov) / total})
    return covered / total, exposure


def _outfield(players: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [p for p in players if p.get("role") != "GK"]


def shape_metrics(players: list[dict[str, Any]], side: dict[str, Any]) -> dict[str, float]:
    out = _outfield(players)
    xs = sorted(p["x"] for p in out)
    ys = [p["y"] for p in out]
    back = xs[:4] if len(xs) >= 4 else xs
    front = xs[-3:] if len(xs) >= 3 else xs
    coverage, _ = threat_coverage(players, side["threat_grid"])

    key = side.get("key_threat")
    mark_dist = 30.0
    if key:
        mark_dist = min(math.hypot(p["x"] - key["x"], p["y"] - key["y"]) for p in out)
    return {
        "line_height": sum(back) / len(back),
        "front_height": sum(front) / len(front),
        "length": (sum(front) / len(front)) - (sum(back) / len(back)),
        "width": max(ys) - min(ys),
        "coverage": coverage,
        "mark_distance": mark_dist,
        "mark_quality": math.exp(-(mark_dist**2) / (2 * MARK_SIGMA**2)),
        "bodies_forward": float(sum(1 for x in xs if x >= FINAL_THIRD_X)),
        "behind_risk": 1 / (1 + math.exp(-((sum(back) / len(back)) - 38) / 5)),
    }


def structure_fit(m: dict[str, float], profile: TacticProfile) -> float:
    """How well the drawn shape matches the chosen plan (0..1)."""
    target_line = 18 + 32 * profile.depth
    target_length = 32 + 22 * profile.attack
    line_fit = 1 - min(1.0, abs(m["line_height"] - target_line) / 22)
    length_fit = 1 - min(1.0, abs(m["length"] - target_length) / 30)
    mark_fit = m["mark_quality"] if profile.marking > 0.6 else 1.0
    return _clamp(0.45 * line_fit + 0.3 * length_fit + 0.25 * mark_fit)


# ------------------------------------------------------------------ zones
def zone_label(x: float, y: float) -> str:
    central = 18 <= y <= 62  # The width of the penalty area.
    if x < 18:
        depth = "inside your box" if central else "by your corner flag"
    elif x < 36:
        depth = "at the edge of your box" if central else "wide of your box"
    elif x < 60:
        depth = "in your half"
    elif x < 84:
        depth = "in midfield"
    else:
        depth = "in their half"
    if y >= 62:
        lane = "Right flank"
    elif y >= 48:
        lane = "Right half-space"
    elif y > 32:
        lane = "Centre"
    elif y > 18:
        lane = "Left half-space"
    else:
        lane = "Left flank"
    return f"{lane}, {depth}"


def exposed_zones(exposure: list[dict[str, Any]], limit: int = 3) -> list[dict[str, Any]]:
    w, h = PITCH_X / GRID_COLS, PITCH_Y / GRID_ROWS
    ranked = sorted(exposure, key=lambda z: z["open"], reverse=True)
    zones: list[dict[str, Any]] = []
    for z in ranked:
        if z["open"] < 0.025 or len(zones) >= limit:
            break
        zones.append({
            "x": round(z["x"] - w / 2, 1),
            "y": round(z["y"] - h / 2, 1),
            "w": round(w, 1),
            "h": round(h, 1),
            "share": round(z["open"], 3),
            "label": zone_label(z["x"], z["y"]),
        })
    return zones


# ------------------------------------------------------------------ main
def rating_label(rating: float) -> str:
    if rating >= 8.5:
        return "Masterclass"
    if rating >= 7.0:
        return "Shrewd call"
    if rating >= 5.5:
        return "Did a job"
    if rating >= 4.0:
        return "Questions to answer"
    return "Sack race"


def baseline_rate(observed_per_min: float, minute: int, deficit: int) -> float:
    """Regress the observed chance rate towards a typical one and apply score
    effects: sides chasing a game create more, sides protecting a lead less."""
    prior_minutes = 20
    typical = 1.35 / 90
    rate = (observed_per_min * minute + typical * prior_minutes) / (minute + prior_minutes)
    if deficit > 0:
        rate *= 1 + 0.35 * min(deficit, 2)
    elif deficit < 0:
        rate *= 1 - 0.12 * min(-deficit, 2)
    return rate


def suggest_shape(
    players: list[dict[str, Any]],
    profile: TacticProfile,
    key_threat: dict[str, Any] | None,
    tactic: str | None = None,
) -> list[dict[str, Any]]:
    """Move the real shape towards what a plan needs, as a starting point."""
    out = _outfield(players)
    if not out:
        return []
    xs = sorted(p["x"] for p in out)
    line = sum(xs[:4]) / min(4, len(xs))
    front = sum(xs[-3:]) / min(3, len(xs))
    length = max(10.0, front - line)
    target_line = 18 + 32 * profile.depth
    target_length = 30 + 24 * profile.attack
    stretch = target_length / length
    narrow = 0.8 + 0.25 * profile.attack + 0.5 * (profile.width - 0.5)

    moved: dict[int, tuple[float, float]] = {}
    for p in players:
        if p.get("role") == "GK":
            moved[p["id"]] = (p["x"], p["y"])
            continue
        x = target_line + (p["x"] - line) * stretch
        y = 40 + (p["y"] - 40) * narrow
        moved[p["id"]] = (_clamp(x, 8, 112), _clamp(y, 3, 77))

    if key_threat and profile.marking >= 0.6:
        kx, ky = key_threat["x"], key_threat["y"]
        candidates = [p for p in out if p.get("role") in ("DEF", "MID")] or out
        marker = min(candidates, key=lambda p: math.hypot(moved[p["id"]][0] - kx, moved[p["id"]][1] - ky))
        # Goal-side and touch-tight.
        moved[marker["id"]] = (_clamp(kx - 3, 6, 112), _clamp(ky, 3, 77))

    attackers = sorted((p for p in out if p.get("role") == "FWD"), key=lambda p: -moved[p["id"]][0])
    if tactic == "false_nine" and attackers:
        # The centre-forward drops into the space between their lines.
        nine = min(attackers[:2], key=lambda p: abs(moved[p["id"]][1] - 40))
        x, y = moved[nine["id"]]
        moved[nine["id"]] = (_clamp(x - 16, 50, 100), _clamp(40 + (y - 40) * 0.4, 3, 77))
    elif tactic == "counter":
        # One or two stay high to break onto.
        for p in attackers[:2]:
            x, y = moved[p["id"]]
            moved[p["id"]] = (max(x, 72.0), y)
    elif tactic == "wing_play":
        # Wide men hug the touchline.
        for p in out:
            x, y = moved[p["id"]]
            if p.get("role") in ("MID", "FWD") and x > 55 and abs(y - 40) > 12:
                moved[p["id"]] = (x, _clamp(40 + math.copysign(min(37.0, abs(y - 40) * 1.3), y - 40), 3, 77))

    return [{"player_id": pid, "x": round(x, 1), "y": round(y, 1)} for pid, (x, y) in moved.items()]


def match_rating(
    lead: int, xg_for: float, xg_against: float, base_for: float, base_against: float, fit: float
) -> float:
    """Gaffer Rating: did the decisions move the expected goals the right way
    for the game state? Used for one set-up and for a whole live match
    (totals across every tactical change)."""
    if lead >= 2:
        w_for, w_against = 0.35, 1.6
    elif lead == 1:
        w_for, w_against = 0.6, 1.4
    elif lead == 0:
        w_for, w_against = 1.0, 1.0
    elif lead == -1:
        w_for, w_against = 1.4, 0.7
    else:
        w_for, w_against = 1.7, 0.4
    utility = w_for * (xg_for - base_for) - w_against * (xg_against - base_against)
    scale = max(0.25, base_for + base_against)
    raw = 6.0 * (utility / scale) + 2.2 * (fit - 0.55)
    # Soft ceiling: a 10 should be rare, and so should a 1.
    return round(_clamp(5.8 + 4.2 * math.tanh(raw / 4.0), 1.0, 10.0), 1)


def _poisson_mode(lam: float) -> int:
    return math.floor(lam)


def evaluate(
    snapshot: dict[str, Any],
    team_id: int,
    placements: dict[int, tuple[float, float]],
    substitutions: list[tuple[int, int]],
    profile: TacticProfile,
    tactic_key: str,
) -> dict[str, Any]:
    side = snapshot["sides"][str(team_id)]
    opp_id = next(k for k in snapshot["sides"] if k != str(team_id))
    opp = snapshot["sides"][opp_id]
    minute = snapshot["minute"]
    horizon = snapshot["horizon_minutes"]

    base_players = side["players"]
    bench = {b["id"]: b for b in side["bench"]}
    on_pitch = {p["id"]: dict(p) for p in base_players}
    sub_notes: list[dict[str, Any]] = []
    for off_id, on_id in substitutions:
        off = on_pitch.pop(off_id)
        incoming = bench[on_id]
        on_pitch[on_id] = {
            **incoming,
            "role": incoming.get("role") or off["role"],
            "position": incoming.get("position") or off["position"],
            "x": off["x"],
            "y": off["y"],
        }
        sub_notes.append({"off": off, "on": on_pitch[on_id]})
    for pid, (x, y) in placements.items():
        if pid in on_pitch:
            on_pitch[pid]["x"] = _clamp(x, 0, PITCH_X)
            on_pitch[pid]["y"] = _clamp(y, 0, PITCH_Y)
    players = list(on_pitch.values())

    base_m = shape_metrics(base_players, side)
    user_m = shape_metrics(players, side)
    fit = structure_fit(user_m, profile)

    # ---- multipliers on the real chance rates
    against = 1.0
    against *= 1 - 0.56 * (0.5 - profile.depth)  # deeper block, fewer clear looks
    against *= 1 - 0.18 * (profile.press - 0.45)  # pressing disrupts their build-up
    late = max(0.0, minute - 60) / 60
    against *= 1 + max(0.0, profile.press - 0.5) * late * 0.6  # tired legs behind a press
    key = side.get("key_threat") or {}
    key_share = key.get("threat_share", 0.15)
    against *= 1 - 0.9 * profile.marking * key_share * user_m["mark_quality"]
    against *= math.exp(-1.6 * (user_m["coverage"] - base_m["coverage"]))
    against *= 1 + 0.45 * (user_m["behind_risk"] - base_m["behind_risk"])
    against *= math.exp(0.05 * (user_m["bodies_forward"] - base_m["bodies_forward"]))
    against *= 1 + 0.3 * (0.6 - fit)

    # How you attack, against how they defend: counters punish a high line,
    # width stretches a deep block, and direct play gives the ball back sooner.
    # All of these are zero for a neutral plan.
    their_line = shape_metrics(opp["players"], opp)["behind_risk"]
    against *= 1 + 0.25 * (profile.direct - 0.4)
    against *= 1 + 0.1 * (profile.width - 0.5)

    for_mult = 0.5 + 1.1 * profile.attack
    for_mult *= 1 + 0.15 * (profile.depth - 0.5)
    for_mult *= 1 + 0.5 * (profile.direct - 0.4) * (their_line - 0.4)
    for_mult *= 1 + 0.5 * (profile.width - 0.5) * (0.4 - their_line)
    for_mult *= math.exp(0.1 * (user_m["bodies_forward"] - base_m["bodies_forward"]))
    for_mult *= 1 + 0.15 * (fit - 0.6)

    for note in sub_notes:
        role = note["on"].get("role")
        if role == "FWD" and profile.attack >= 0.4:
            for_mult *= 1.06
        elif role in ("DEF", "MID") and profile.depth <= 0.5:
            against *= 0.96
        else:
            for_mult *= 1.02

    against = _clamp(against, 0.3, 2.5)
    for_mult = _clamp(for_mult, 0.25, 2.5)

    is_home = side["is_home"]
    score = snapshot["score"]
    goals_for = score["home"] if is_home else score["away"]
    goals_against = score["away"] if is_home else score["home"]
    lead = goals_for - goals_against

    base_for = baseline_rate(side["baseline"]["xg_for_per_min"], minute, -lead) * horizon
    base_against = baseline_rate(side["baseline"]["xg_against_per_min"], minute, lead) * horizon
    proj_for = base_for * for_mult
    proj_against = base_against * against

    rating = match_rating(lead, proj_for, proj_against, base_for, base_against, fit)

    final_for = goals_for + _poisson_mode(proj_for)
    final_against = goals_against + _poisson_mode(proj_against)
    likely = (
        {"home": final_for, "away": final_against}
        if is_home
        else {"home": final_against, "away": final_for}
    )

    _, exposure = threat_coverage(players, side["threat_grid"])
    zones = exposed_zones(exposure)

    metrics = [
        {
            "key": "coverage",
            "label": f"Cover of {opp['name']}'s danger areas",
            "value": round(user_m["coverage"] * 100),
            "baseline": round(base_m["coverage"] * 100),
            "unit": "%",
            "better": "higher",
        },
        {
            "key": "line_height",
            "label": "Defensive line, from your goal",
            "value": round(user_m["line_height"]),
            "baseline": round(base_m["line_height"]),
            "unit": "yd",
            "better": "context",
        },
        {
            "key": "length",
            "label": "Distance from back line to front line",
            "value": round(user_m["length"]),
            "baseline": round(base_m["length"]),
            "unit": "yd",
            "better": "lower",
        },
        {
            "key": "bodies_forward",
            "label": "Players in the final third",
            "value": int(user_m["bodies_forward"]),
            "baseline": int(base_m["bodies_forward"]),
            "unit": "",
            "better": "context",
        },
    ]
    if key:
        metrics.append({
            "key": "mark_distance",
            "label": f"Nearest man to {key['name']}",
            "value": round(user_m["mark_distance"]),
            "baseline": round(base_m["mark_distance"]),
            "unit": "yd",
            "better": "lower",
        })

    findings = _findings(
        side, opp, profile, tactic_key, base_m, user_m, fit, zones, sub_notes, lead, horizon
    )

    return {
        "team_id": team_id,
        "opponent_id": int(opp_id),
        "tactic": tactic_key,
        "profile": profile.as_dict(),
        "gaffer_rating": rating,
        "rating_label": rating_label(rating),
        "structure_fit": round(fit, 2),
        "projection": {
            "minutes": horizon,
            "xg_for": round(proj_for, 2),
            "xg_against": round(proj_against, 2),
            "baseline_xg_for": round(base_for, 2),
            "baseline_xg_against": round(base_against, 2),
            "likely_score": likely,
        },
        "metrics": metrics,
        "exposed_zones": zones,
        "findings": findings,
        "lineup": [
            {k: p.get(k) for k in ("id", "name", "number", "position", "role", "x", "y")}
            for p in players
        ],
        "substitutions": [
            {"off": n["off"]["name"], "on": n["on"]["name"]} for n in sub_notes
        ],
    }


def _findings(
    side: dict[str, Any],
    opp: dict[str, Any],
    profile: TacticProfile,
    tactic_key: str,
    base_m: dict[str, float],
    user_m: dict[str, float],
    fit: float,
    zones: list[dict[str, Any]],
    sub_notes: list[dict[str, Any]],
    lead: int,
    horizon: int,
) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    cov_delta = user_m["coverage"] - base_m["coverage"]
    if cov_delta >= 0.03:
        out.append({"tone": "good", "text": f"You cover more of the ground {opp['name']} actually attacked through: {round(user_m['coverage'] * 100)}% against {round(base_m['coverage'] * 100)}% in the real shape."})
    elif cov_delta <= -0.03:
        out.append({"tone": "bad", "text": f"Your shape leaves more of {opp['name']}'s favourite ground uncovered than the real one did ({round(user_m['coverage'] * 100)}% vs {round(base_m['coverage'] * 100)}%)."})

    if zones:
        z = zones[0]
        out.append({"tone": "bad", "text": f"Biggest gap: {z['label'].lower()}. About {round(z['share'] * 100)}% of their threat ends up there with nobody close."})

    key = side.get("key_threat")
    if key:
        if user_m["mark_distance"] <= 8:
            out.append({"tone": "good", "text": f"{key['name']} has company. Your nearest player starts {round(user_m['mark_distance'])} yards from his usual patch."})
        elif profile.marking > 0.6:
            out.append({"tone": "bad", "text": f"You asked for {key['name']} to be marked, but nobody is within {round(user_m['mark_distance'])} yards of where he plays. Drag a defender over."})

    if user_m["behind_risk"] > 0.6 and profile.press < 0.7:
        out.append({"tone": "bad", "text": f"A back line {round(user_m['line_height'])} yards from goal without a press is an invitation to run in behind."})
    elif profile.press >= 0.7 and user_m["line_height"] < 32:
        out.append({"tone": "bad", "text": "The front line is pressing but the defence stayed deep. That gap in midfield is where a press dies."})

    plan_name = "your plan" if tactic_key == "custom" else f"a {profile.label.lower()}"
    if fit >= 0.75:
        out.append({"tone": "good", "text": f"The shape matches the plan. Players are where {plan_name} needs them."})
    elif fit < 0.45:
        out.append({"tone": "bad", "text": f"The shape and the plan disagree. {plan_name[0].upper()}{plan_name[1:]} needs a different line height and spacing than the one you drew."})

    if lead > 0 and profile.attack >= 0.6:
        out.append({"tone": "neutral", "text": f"Chasing more goals while ahead with {horizon} minutes left is brave. It raises your threat and theirs."})
    if lead < 0 and profile.attack <= 0.25:
        out.append({"tone": "bad", "text": "Trailing and sitting deep runs the clock down for them."})

    for note in sub_notes:
        out.append({"tone": "neutral", "text": f"{note['on']['name']} on for {note['off']['name']}: fresh legs in {note['on'].get('position') or 'the same role'}."})
    return out[:7]
