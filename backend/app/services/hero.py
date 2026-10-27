"""Home page hero copy for curated moments.

Written once per moment (when it is seeded) and stored with the snapshot, so
the home page never waits on a model. Hand-written copy in the catalog wins;
otherwise Gemini writes it from the moment's facts; otherwise a template does.
"""

import logging
import re
from typing import Any

from pydantic import BaseModel, Field

from app.scenarios_catalog import ScenarioSpec
from app.services.pundit import generate_structured

logger = logging.getLogger("tactix.hero")

MAX_HEADLINE = 70
MAX_HOOK = 130
MAX_ASK = 50


class HeroLines(BaseModel):
    team: str = Field(description="Exactly one of the team names given")
    headline: str = Field(description="Max 9 words, second person, punchy")
    hook: str = Field(description="One sentence, max 18 words, a concrete detail from the facts")
    ask: str = Field(description="A short question about the decision, max 7 words")


class HeroCopy(BaseModel):
    teams: list[HeroLines]


def _short(name: str) -> str:
    parts = name.split()
    return parts[-1] if len(parts) > 1 else name


def _template(spec: ScenarioSpec, gf: int, ga: int) -> dict[str, str]:
    occasion = spec.occasion or "big match"
    if gf > ga:
        return {
            "headline": f"{gf}–{ga} up in a {occasion}. Don’t blow it.",
            "hook": "",
            "ask": "How do you protect the lead?",
        }
    if gf < ga:
        return {
            "headline": f"{ga}–{gf} down in a {occasion}. Save it.",
            "hook": "",
            "ask": "How do you get back into it?",
        }
    return {
        "headline": f"{gf}–{ga} in a {occasion}. Win it.",
        "hook": "",
        "ask": "How do you win it?",
    }


def _tidy(text: str) -> str:
    """Repair scores the model splits or hyphenates ("3\\n-0", "3-0") into an en dash."""
    text = re.sub(r"(\d)\s*[\r\n]+\s*[-\u2013\u2014]?\s*(\d)", "\\1\u2013\\2", text)
    text = re.sub(r"(\d)\s?[-\u2014]\s?(\d)", "\\1\u2013\\2", text)
    return " ".join(text.split())


def _valid(lines: HeroLines) -> bool:
    return (
        0 < len(lines.headline) <= MAX_HEADLINE
        and 0 < len(lines.hook) <= MAX_HOOK
        and 0 < len(lines.ask) <= MAX_ASK
        and lines.ask.rstrip().endswith("?")
    )


def _facts(spec: ScenarioSpec, snapshot: dict[str, Any]) -> dict[str, Any]:
    m = snapshot["match"]
    score = snapshot["score"]
    # Goals before the frozen minute only: the copy must not spoil what follows.
    cutoff = spec.minute + spec.second / 60
    goals = [
        {"minute": g["minute"], "team": g["team"], "scorer": _short(g["player"])}
        for g in snapshot.get("goals_before", [])
        if g["minute"] <= cutoff + 1
    ]
    return {
        "occasion": spec.occasion,
        "venue": spec.venue,
        "date": m["date"],
        "minute": f"{spec.minute}:{spec.second:02d}",
        "score": {m["home"]: score["home"], m["away"]: score["away"]},
        "goals_so_far": goals,
        "minutes_left_roughly": snapshot["horizon_minutes"],
        "sides": {
            side["name"]: {
                "situation": spec.dilemmas.get(side["name"], side.get("dilemma", "")),
                "their_main_threat": (side.get("key_threat") or {}).get("name"),
            }
            for side in snapshot["sides"].values()
        },
    }


def build_hero(spec: ScenarioSpec, snapshot: dict[str, Any]) -> dict[str, Any]:
    """Hero copy for both sides, plus which side the home page starts on."""
    sides = list(snapshot["sides"].values())
    name_to_id = {s["name"]: s["team_id"] for s in sides}
    first = next(iter(spec.dilemmas), None)
    default_id = name_to_id.get(first, sides[0]["team_id"]) if first else sides[0]["team_id"]

    by_team: dict[str, dict[str, str]] = {}
    sources: set[str] = set()
    for side in sides:
        hand = spec.hero.get(side["name"])
        if hand:
            by_team[str(side["team_id"])] = dict(hand)
            sources.add("hand")

    missing = [s for s in sides if str(s["team_id"]) not in by_team]
    if missing:
        written = generate_structured(
            (
                "You write the home page hero for TACTIX, a football tactics game where the visitor "
                "manages one side from a frozen moment of a real match. Write copy for each team "
                "listed, addressed to that team's manager (second person).\n"
                "Style: like \"It's 2–0 in a World Cup final. Don't blow it.\" Short, confident, "
                "no hype words, no emoji, use an en dash in scores.\n"
                "Rules: use ONLY the facts below. Never reveal, hint at or foreshadow anything after "
                "the frozen minute (no comebacks, no late goals, no final result). Write scores the "
                "way football commentators do, bigger number first: '3–1 up', '3–1 down', "
                "'1–1'. Don't mention the clock time or the minute number in the hook. "
                "Single lines only.\n\n"
                f"TEAMS: {[s['name'] for s in missing]}\n"
                f"FACTS: {_facts(spec, snapshot)}"
            ),
            HeroCopy,
        )
        if isinstance(written, HeroCopy):
            for raw in written.teams:
                lines = HeroLines(team=raw.team, headline=_tidy(raw.headline), hook=_tidy(raw.hook), ask=_tidy(raw.ask))
                tid = name_to_id.get(lines.team)
                if tid is not None and str(tid) not in by_team and _valid(lines):
                    by_team[str(tid)] = {"headline": lines.headline.strip(), "hook": lines.hook.strip(), "ask": lines.ask.strip()}
                    sources.add("gemini")

    for side in sides:
        if str(side["team_id"]) in by_team:
            continue
        home = side["is_home"]
        gf = snapshot["score"]["home" if home else "away"]
        ga = snapshot["score"]["away" if home else "home"]
        lines = _template(spec, gf, ga)
        # The template has no hook of its own; the hand-written dilemma's first sentence works.
        dilemma = spec.dilemmas.get(side["name"], side.get("dilemma", ""))
        lines["hook"] = dilemma.split(". ")[0].rstrip(".") + "." if dilemma else ""
        by_team[str(side["team_id"])] = lines
        sources.add("template")

    venue_short = spec.venue.split(",")[0]
    return {
        "default_team_id": default_id,
        "caption": f"{spec.occasion[:1].upper()}{spec.occasion[1:]}, {venue_short}" if spec.occasion else venue_short,
        "by_team": by_team,
        "source": "gemini" if "gemini" in sources else "hand" if sources == {"hand"} else "template",
    }
