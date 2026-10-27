from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app import models
from app.database import get_db
from app.schemas import (
    AskRequest,
    AskResponse,
    EventRead,
    MatchDetailRead,
    MatchSummaryRead,
)
from app.services.limits import ai_allowed
from app.services.pundit import answer_question

router = APIRouter(prefix="/api/matches", tags=["matches"])

DbSession = Annotated[Session, Depends(get_db)]

_ask_cache: dict[tuple[int, str], AskResponse] = {}


def _get_match(db: Session, match_id: int) -> models.Match:
    match = db.get(models.Match, match_id)
    if not match:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Match with ID {match_id} not found",
        )
    return match


@router.get("", response_model=list[MatchSummaryRead])
def get_matches(db: DbSession) -> list[MatchSummaryRead]:
    stmt = (
        select(models.Match)
        .options(
            joinedload(models.Match.home_team),
            joinedload(models.Match.away_team),
        )
        .order_by(models.Match.match_date.desc())
    )
    matches = db.execute(stmt).scalars().all()
    return list(matches)


@router.get("/{match_id}", response_model=MatchDetailRead)
def get_match(match_id: int, db: DbSession) -> MatchDetailRead:
    match = _get_match(db, match_id)
    summary = MatchSummaryRead.model_validate(match)
    stats = dict(match.stats_json or {})

    # Network nodes carry jersey numbers so the frontend can draw them as tokens.
    networks = stats.get("pass_networks") or {}
    node_ids = {n["id"] for net in networks.values() for n in net.get("nodes", [])}
    if node_ids:
        numbers = dict(
            db.execute(
                select(models.Player.id, models.Player.jersey_number).where(
                    models.Player.id.in_(node_ids)
                )
            ).all()
        )
        stats["pass_networks"] = {
            team_id: {
                **net,
                "nodes": [{**n, "number": numbers.get(n["id"])} for n in net.get("nodes", [])],
            }
            for team_id, net in networks.items()
        }

    return MatchDetailRead(
        **summary.model_dump(),
        stats=stats,
        scenario_slugs=[s.slug for s in match.scenarios],
    )


@router.get("/{match_id}/stats", response_model=dict[str, Any])
def get_match_stats(match_id: int, db: DbSession) -> dict[str, Any]:
    return _get_match(db, match_id).stats_json or {}


@router.get("/{match_id}/events", response_model=list[EventRead])
def get_match_events(
    match_id: int,
    db: DbSession,
    event_type: Annotated[list[str] | None, Query()] = None,
    team_id: int | None = None,
    player_id: int | None = None,
    minute_from: Annotated[int, Query(ge=0)] = 0,
    minute_to: Annotated[int, Query(ge=0)] = 130,
    limit: Annotated[int, Query(ge=1, le=5000)] = 500,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[EventRead]:
    _get_match(db, match_id)
    stmt = (
        select(models.MatchEvent, models.Player)
        .outerjoin(models.Player, models.Player.id == models.MatchEvent.player_id)
        .where(models.MatchEvent.match_id == match_id)
        .where(models.MatchEvent.minute >= minute_from)
        .where(models.MatchEvent.minute <= minute_to)
    )
    if event_type:
        stmt = stmt.where(models.MatchEvent.event_type.in_(event_type))
    if team_id is not None:
        stmt = stmt.where(models.MatchEvent.team_id == team_id)
    if player_id is not None:
        stmt = stmt.where(models.MatchEvent.player_id == player_id)
    stmt = (
        stmt.order_by(models.MatchEvent.minute, models.MatchEvent.second)
        .offset(offset)
        .limit(limit)
    )

    events: list[EventRead] = []
    for ev, player in db.execute(stmt).all():
        meta = ev.raw_metadata or {}
        period = meta.get("period")
        events.append(
            EventRead(
                id=ev.id,
                minute=ev.minute,
                second=ev.second,
                period=int(float(period)) if period is not None else None,
                team_id=ev.team_id,
                player_id=ev.player_id,
                player_name=(player.nickname or player.name) if player else None,
                event_type=ev.event_type,
                x=ev.location_x,
                y=ev.location_y,
                end_x=ev.end_location_x,
                end_y=ev.end_location_y,
                xg=ev.xg,
                outcome=ev.outcome,
                play_pattern=meta.get("play_pattern"),
            )
        )
    return events


@router.post("/{match_id}/ask", response_model=AskResponse)
def ask_about_match(match_id: int, body: AskRequest, db: DbSession, request: Request) -> AskResponse:
    match = _get_match(db, match_id)
    # Repeated questions are answered from memory and never reach Gemini.
    cache_key = (match_id, " ".join(body.question.lower().split()))
    if cache_key in _ask_cache:
        return _ask_cache[cache_key]
    stats = match.stats_json or {}
    teams = stats.get("team_stats", {}).get("teams", {})
    timeline = stats.get("momentum_timeline", [])
    peak = None
    if timeline:
        top = max(timeline, key=lambda b: abs(b.get("momentum", 0)))
        peak = {
            "interval": top["interval"],
            "team": top["team_home"] if top["momentum"] > 0 else top["team_away"],
        }

    shots = db.execute(
        select(models.MatchEvent, models.Player)
        .outerjoin(models.Player, models.Player.id == models.MatchEvent.player_id)
        .where(models.MatchEvent.match_id == match_id)
        .where(models.MatchEvent.event_type == "Shot")
        .order_by(models.MatchEvent.xg.desc().nullslast())
        .limit(12)
    ).all()
    context = {
        "match": f"{match.home_team.name} {match.home_score}-{match.away_score} {match.away_team.name}",
        "competition": f"{match.competition} {match.season}",
        "teams": teams,
        "momentum_peak": peak,
        "momentum_timeline": timeline,
        "biggest_chances": [
            {
                "minute": ev.minute + 1,
                "player": (p.nickname or p.name) if p else None,
                "xg": ev.xg,
                "outcome": ev.outcome,
            }
            for ev, p in shots
        ],
    }
    answer = AskResponse(**answer_question(body.question, context, use_ai=ai_allowed(request)))
    if answer.source == "gemini":
        if len(_ask_cache) >= 500:
            _ask_cache.pop(next(iter(_ask_cache)))
        _ask_cache[cache_key] = answer
    return answer
