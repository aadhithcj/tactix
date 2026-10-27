"""Gemini-backed commentary with deterministic fallbacks.

Gemini only explains, reads free-text plans and answers questions. Scores and
projections always come from the simulation model, so the app works (with
plainer prose) when no API key is configured or the call fails.
"""

import json
import logging
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from typing import Any

from pydantic import BaseModel, Field

from app.config import settings
from app.services.limits import gemini_budget
from app.services.simulation import NEUTRAL, TacticProfile, profile_from_text

logger = logging.getLogger("tactix.pundit")
_pool = ThreadPoolExecutor(max_workers=4)


class PunditTake(BaseModel):
    headline: str = Field(description="A punchy 4-9 word verdict, like a back-page headline.")
    take: str = Field(description="Two to four sentences of conversational analysis.")


class PlanReading(BaseModel):
    depth: float = Field(ge=0, le=1, description="0 = very deep block, 1 = very high line")
    press: float = Field(ge=0, le=1, description="Pressing intensity")
    marking: float = Field(ge=0, le=1, description="Dedication to man-marking their key threat")
    attack: float = Field(ge=0, le=1, description="Commitment of bodies to attack")
    summary: str = Field(description="The plan restated in under 12 words")


class AnalystAnswer(BaseModel):
    answer: str


def gemini_enabled() -> bool:
    return bool(settings.GEMINI_API_KEY)


def _generate(prompt: str, schema: type[BaseModel], *, use_ai: bool = True) -> BaseModel | None:
    if not (use_ai and gemini_enabled()):
        return None
    # Every call spends from the daily budget, so the free tier can't be drained.
    if not gemini_budget.try_spend():
        return None
    try:
        from google import genai
    except ImportError:
        logger.warning("google-genai not installed; using fallback.")
        return None

    def call() -> BaseModel | None:
        client = genai.Client(api_key=settings.GEMINI_API_KEY)
        response = client.models.generate_content(
            model=settings.GEMINI_MODEL,
            contents=prompt,
            config={
                "response_mime_type": "application/json",
                "response_schema": schema,
                "temperature": 0.7,
            },
        )
        parsed = response.parsed
        if isinstance(parsed, schema):
            return parsed
        return schema.model_validate_json(response.text or "{}")

    try:
        return _pool.submit(call).result(timeout=settings.GEMINI_TIMEOUT_SECONDS)
    except FutureTimeout:
        logger.warning("Gemini timed out; using fallback.")
    except Exception as exc:  # noqa: BLE001 - any SDK failure falls back
        if "RESOURCE_EXHAUSTED" in str(exc) or "429" in str(exc):
            gemini_budget.quota_exhausted()
        logger.warning("Gemini call failed: %s", exc)
    return None


# Public name for other services (hero copy) that need structured Gemini output.
generate_structured = _generate


# ------------------------------------------------------------------ plans
def read_plan(plan: str, team: str, opponent: str, *, use_ai: bool = True) -> tuple[TacticProfile, str]:
    """Turn a free-text plan into tactic dials. Returns (profile, source)."""
    plan = plan.strip()
    if not plan:
        return NEUTRAL, "model"
    reading = _generate(
        (
            f"You are a football coach translating a manager's instruction into tactic dials.\n"
            f"Team: {team}. Opponent: {opponent}.\n"
            f"Instruction: \"{plan}\"\n"
            "Score each dial from 0 to 1. A neutral, balanced plan is depth 0.5, press 0.45, "
            "marking 0.3, attack 0.45."
        ),
        PlanReading,
        use_ai=use_ai,
    )
    if isinstance(reading, PlanReading):
        return (
            TacticProfile(reading.depth, reading.press, reading.marking, reading.attack, "Custom plan"),
            "gemini",
        )
    return profile_from_text(plan), "model"


# ------------------------------------------------------------------ verdict
def pundit_take(
    snapshot: dict[str, Any],
    result: dict[str, Any],
    plan: str | None,
    *,
    use_ai: bool = True,
    live: dict[str, Any] | None = None,
) -> dict[str, str]:
    """`live` is the summary of a match played out in the browser; without it
    the take judges one set-up's projection."""
    side = snapshot["sides"][str(result["team_id"])]
    opp = snapshot["sides"][str(result["opponent_id"])]
    proj = result["projection"]
    facts = {
        "match": f"{snapshot['match']['home']} vs {snapshot['match']['away']}, {snapshot['match']['competition']} {snapshot['match']['season']}",
        "minute": snapshot["minute"],
        "score": snapshot["score"],
        "manager_of": side["name"],
        "opponent": opp["name"],
        "tactic": result["profile"]["label"],
        "custom_plan": plan,
        "gaffer_rating": result["gaffer_rating"],
        "projected_xg_for": proj["xg_for"],
        "projected_xg_against": proj["xg_against"],
        "if_unchanged_xg_for": proj["baseline_xg_for"],
        "if_unchanged_xg_against": proj["baseline_xg_against"],
        "minutes_left": proj["minutes"],
        "metrics": result["metrics"],
        "findings": [f["text"] for f in result["findings"]],
        "substitutions": result["substitutions"],
        "what_really_happened": snapshot["actual"]["goals_after"],
    }
    brief = (
        "Judge the manager's decision using ONLY the facts below. Mention one concrete strength "
        "and one concrete risk. Compare with what really happened only if it adds something."
    )
    if live:
        for key in ("projected_xg_for", "projected_xg_against", "if_unchanged_xg_for", "if_unchanged_xg_against"):
            facts[key.replace("projected", "match")] = facts.pop(key)
        # Two timelines: keep the real match's goals clearly apart from the manager's.
        facts["real_history_not_this_match"] = facts.pop("what_really_happened")
        facts["live_match"] = {
            "final_score_you_vs_them": f"{live['final_score']['for']}-{live['final_score']['against']}",
            "goals": live["goals"],
            "tactical_changes": live["changes"],
            "shots_for": live["shots_for"],
            "shots_against": live["shots_against"],
        }
        brief = (
            "The manager replayed the rest of this match in a simulation and could change tactics "
            "along the way. live_match is what happened in THEIR version: its score and goals are "
            "the only result you may describe as having happened. real_history_not_this_match is "
            "the real game, a different timeline; never say those goals happened here, and if you "
            "mention them, say they were in the real match. Judge how they managed it using ONLY "
            "the facts below: the chances they created and allowed matter more than the scoreline, "
            "which has luck in it. Mention their final score, one thing they got right and one risk."
        )
    take = _generate(
        (
            f"You are a sharp, warm TV football pundit. {brief} Never invent statistics or "
            "percentages, and do not quote the rating number.\n\n"
            f"FACTS:\n{json.dumps(facts, ensure_ascii=False, default=str)}"
        ),
        PunditTake,
        use_ai=use_ai,
    )
    if isinstance(take, PunditTake):
        return {"headline": take.headline, "take": take.take, "source": "gemini"}
    if live:
        return _template_live_take(side, opp, result, live)
    return _template_take(side, opp, result)


def _template_live_take(side: dict[str, Any], opp: dict[str, Any], result: dict[str, Any], live: dict[str, Any]) -> dict[str, str]:
    proj = result["projection"]
    rating = result["gaffer_rating"]
    f, a = live["final_score"]["for"], live["final_score"]["against"]
    outcome = "won" if f > a else "lost" if f < a else "drew"
    lucky = (f - a) - (proj["xg_for"] - proj["xg_against"])
    if rating >= 7:
        headline = f"{side['name']} managed it well" if outcome != "lost" else "Right calls, cruel result"
    elif rating >= 5.5:
        headline = "Steady hands on the touchline"
    elif outcome == "won":
        headline = "Got away with it"
    else:
        headline = f"{opp['name']} were invited on"

    opening = (
        f"{side['name']} {outcome} {f}-{a}. Over the last {proj['minutes']} minutes your set-ups "
        f"created {proj['xg_for']:.2f} xG and allowed {proj['xg_against']:.2f}, against "
        f"{proj['baseline_xg_for']:.2f} and {proj['baseline_xg_against']:.2f} if nothing had changed."
    )
    lines = [opening]
    if lucky >= 0.8:
        lines.append("The scoreline flatters you; the chances were closer than that.")
    elif lucky <= -0.8:
        lines.append("The finishing let you down more than the plan did.")
    changes = live.get("changes") or []
    if changes:
        lines.append(f"You changed things {len(changes)} time{'s' if len(changes) != 1 else ''}, the last on {changes[-1]['minute']} minutes.")
    bads = [x["text"] for x in result["findings"] if x["tone"] == "bad"]
    if bads:
        worry = bads[0].removeprefix("Biggest gap: ")
        lines.append(f"The worry by the end: {worry[0].lower()}{worry[1:]}")
    return {"headline": headline, "take": " ".join(lines), "source": "model"}


def _template_take(side: dict[str, Any], opp: dict[str, Any], result: dict[str, Any]) -> dict[str, str]:
    proj = result["projection"]
    rating = result["gaffer_rating"]
    goods = [f["text"] for f in result["findings"] if f["tone"] == "good"]
    bads = [f["text"] for f in result["findings"] if f["tone"] == "bad"]
    d_against = proj["xg_against"] - proj["baseline_xg_against"]
    d_for = proj["xg_for"] - proj["baseline_xg_for"]

    if rating >= 7:
        headline = f"{side['name']} read it right"
    elif rating >= 5.5:
        headline = "Sensible, if not spectacular"
    elif rating >= 4:
        headline = "A gamble that could backfire"
    else:
        headline = f"{opp['name']} will fancy this"

    swing = []
    if abs(d_against) >= 0.05:
        swing.append(
            f"{'cuts' if d_against < 0 else 'adds to'} what {opp['name']} should create "
            f"({proj['baseline_xg_against']:.2f} to {proj['xg_against']:.2f} xG)"
        )
    if abs(d_for) >= 0.05:
        swing.append(
            f"{'lifts' if d_for > 0 else 'blunts'} your own threat "
            f"({proj['baseline_xg_for']:.2f} to {proj['xg_for']:.2f} xG)"
        )
    opening = {
        "park_bus": "Parking the bus",
        "high_press": "Pressing high",
        "mark_threat": f"Man-marking {(side.get('key_threat') or {}).get('name', 'their danger man')}",
    }.get(result["tactic"], "Your plan")
    lines = [f"{opening} for the last {proj['minutes']} minutes"]
    lines[0] += f" {' and '.join(swing)}." if swing else " barely moves the needle either way."
    if goods:
        lines.append(goods[0])
    if bads:
        worry = bads[0].removeprefix("Biggest gap: ")
        lines.append(f"The worry: {worry[0].lower()}{worry[1:]}")
    return {"headline": headline, "take": " ".join(lines), "source": "model"}


# ------------------------------------------------------------------ analyst
def answer_question(question: str, context: dict[str, Any], *, use_ai: bool = True) -> dict[str, str]:
    reply = _generate(
        (
            "You are a football data analyst. Answer the question in 2-4 sentences using ONLY the "
            "match data below. If the data cannot answer it, say what is missing.\n\n"
            f"DATA:\n{json.dumps(context, ensure_ascii=False, default=str)}\n\nQUESTION: {question}"
        ),
        AnalystAnswer,
        use_ai=use_ai,
    )
    if isinstance(reply, AnalystAnswer):
        return {"answer": reply.answer, "source": "gemini"}
    return {"answer": _fact_answer(question, context), "source": "model"}


def _fact_answer(question: str, ctx: dict[str, Any]) -> str:
    q = question.lower()
    teams = list(ctx.get("teams", {}).values())
    if len(teams) < 2:
        return "There isn't enough data loaded for this match to answer that."
    a, b = teams[0], teams[1]

    def line(metric: str, label: str, suffix: str = "") -> str:
        return f"{a['name']} {a.get(metric, 0)}{suffix} {label}, {b['name']} {b.get(metric, 0)}{suffix}."

    if "xg" in q or "expected" in q or "chance" in q:
        return line("total_xg", "xG") + " xG adds up the quality of every shot, excluding the penalty shootout."
    if "possess" in q or "ball" in q:
        return line("possession_pct", "of the passes", "%") + " Possession here is estimated from share of passes."
    if "pass" in q:
        return f"{a['name']} completed {a.get('successful_passes', 0)} of {a.get('total_passes', 0)} passes ({a.get('pass_accuracy_pct', 0)}%); {b['name']} {b.get('successful_passes', 0)} of {b.get('total_passes', 0)} ({b.get('pass_accuracy_pct', 0)}%)."
    if "shot" in q:
        return line("total_shots", "shots")
    if "momentum" in q or "swing" in q or "pressure" in q:
        peak = ctx.get("momentum_peak")
        if peak:
            return f"The biggest swing came in minutes {peak['interval']}, when {peak['team']} were on top."
    return (
        "Ask about xG, possession, passing, shots or momentum. Connect a Gemini API key "
        "on the server for free-form analysis."
    )
