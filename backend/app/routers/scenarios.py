from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.schemas import (
    ScenarioDetail,
    ScenarioSide,
    ScenarioSummary,
    SimulationRequest,
    SimulationResponse,
)
from app.services.pundit import pundit_take, read_plan
from app.services.simulation import PRESETS, evaluate, suggest_shape

router = APIRouter(prefix="/api/scenarios", tags=["scenarios"])

DbSession = Annotated[Session, Depends(get_db)]

MODEL_NOTE = (
    "Projections scale each side's real chance rate from this match by how your shape and "
    "plan change coverage, line height, marking and bodies forward. They are model "
    "estimates of expected goals, not predictions of the result."
)


def _get_scenario(db: Session, slug: str) -> models.Scenario:
    scenario = db.get(models.Scenario, slug)
    if not scenario:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Scenario '{slug}' not found",
        )
    return scenario


def _summary(s: models.Scenario) -> ScenarioSummary:
    snap = s.snapshot
    match = snap["match"]
    return ScenarioSummary(
        slug=s.slug,
        title=s.title,
        tagline=s.tagline,
        minute=s.minute,
        match_id=s.match_id,
        competition=match["competition"],
        season=match["season"],
        date=match["date"],
        venue=match["venue"],
        home=match["home"],
        away=match["away"],
        score=snap["score"],
        final_score=snap["actual"]["final_score"],
        sides=[
            ScenarioSide(
                team_id=side["team_id"],
                name=side["name"],
                code=side["code"],
                dilemma=side["dilemma"],
            )
            for side in sorted(snap["sides"].values(), key=lambda x: not x["is_home"])
        ],
    )


@router.get("", response_model=list[ScenarioSummary])
def list_scenarios(db: DbSession) -> list[ScenarioSummary]:
    rows = db.execute(select(models.Scenario).order_by(models.Scenario.sort_order)).scalars()
    return [_summary(s) for s in rows]


@router.get("/{slug}", response_model=ScenarioDetail)
def get_scenario(slug: str, db: DbSession) -> ScenarioDetail:
    s = _get_scenario(db, slug)
    shapes = {
        team_id: {
            key: suggest_shape(side["players"], profile, side.get("key_threat"))
            for key, profile in PRESETS.items()
        }
        for team_id, side in s.snapshot["sides"].items()
    }
    return ScenarioDetail(
        slug=s.slug,
        title=s.title,
        tagline=s.tagline,
        minute=s.minute,
        snapshot=s.snapshot,
        suggested_shapes=shapes,
    )


def _bad_request(detail: str) -> HTTPException:
    return HTTPException(status_code=422, detail=detail)


@router.post("/{slug}/simulate", response_model=SimulationResponse)
def simulate(slug: str, body: SimulationRequest, db: DbSession) -> SimulationResponse:
    scenario = _get_scenario(db, slug)
    snap = scenario.snapshot
    side = snap["sides"].get(str(body.team_id))
    if not side:
        raise _bad_request(f"Team {body.team_id} is not in this scenario")
    opponent = next(s for k, s in snap["sides"].items() if k != str(body.team_id))

    # Validate substitutions against who is actually available.
    on_pitch = {p["id"] for p in side["players"]}
    bench = {b["id"] for b in side["bench"]}
    remaining = side["subs_allowed"] - side["subs_used"]
    if len(body.substitutions) > remaining:
        raise _bad_request(f"Only {remaining} substitutions left")
    subs: list[tuple[int, int]] = []
    for sub in body.substitutions:
        if sub.off_id not in on_pitch:
            raise _bad_request(f"Player {sub.off_id} is not on the pitch")
        if sub.on_id not in bench:
            raise _bad_request(f"Player {sub.on_id} is not available on the bench")
        on_pitch.remove(sub.off_id)
        on_pitch.add(sub.on_id)
        bench.remove(sub.on_id)
        subs.append((sub.off_id, sub.on_id))

    placements = {}
    for p in body.placements:
        if p.player_id not in on_pitch:
            raise _bad_request(f"Player {p.player_id} is not on the pitch")
        placements[p.player_id] = (p.x, p.y)

    plan = (body.custom_plan or "").strip() or None
    if body.tactic == "custom":
        profile, plan_source = read_plan(plan or "", side["name"], opponent["name"])
    else:
        profile, plan_source = PRESETS[body.tactic], "preset"

    result = evaluate(snap, body.team_id, placements, subs, profile, body.tactic)
    pundit = pundit_take(snap, result, plan)

    actual = snap["actual"]
    return SimulationResponse(
        scenario=slug,
        plan_source=plan_source,
        pundit=pundit,
        actual={
            **actual,
            "xg_for_after": side["actual_after"]["xg_for"],
            "xg_against_after": side["actual_after"]["xg_against"],
        },
        model_note=MODEL_NOTE,
        **result,
    )
