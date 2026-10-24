from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.services import moments

router = APIRouter(prefix="/api/catalog", tags=["catalog"])


class Competition(BaseModel):
    competition_id: int
    season_id: int
    competition: str
    season: str
    country: str
    gender: str


class CatalogMatch(BaseModel):
    match_id: int
    date: str
    home: str
    away: str
    home_score: int
    away_score: int
    stage: str
    stadium: str


class MomentRequest(BaseModel):
    competition_id: int
    season_id: int
    match_id: int
    minute: int = Field(ge=moments.MIN_MINUTE, le=moments.MAX_MINUTE)


class MomentCreated(BaseModel):
    slug: str


def _unavailable(exc: Exception) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=f"The match data source couldn't be reached. Try again in a moment. ({exc})",
    )


@router.get("/competitions", response_model=list[Competition])
def competitions() -> list[dict]:
    try:
        return moments.list_competitions()
    except moments.SourceUnavailable as exc:
        raise _unavailable(exc) from exc


@router.get("/matches", response_model=list[CatalogMatch])
def matches(
    competition_id: Annotated[int, Query()],
    season_id: Annotated[int, Query()],
) -> list[dict]:
    try:
        return moments.list_matches(competition_id, season_id)
    except moments.SourceUnavailable as exc:
        raise _unavailable(exc) from exc


@router.post("/moments", response_model=MomentCreated, status_code=status.HTTP_201_CREATED)
def create_moment(body: MomentRequest) -> MomentCreated:
    """Build a playable moment from any open-data match. Takes a few seconds
    the first time a match is used: its events are fetched and stored."""
    try:
        slug = moments.create_moment(body.competition_id, body.season_id, body.match_id, body.minute)
    except moments.SourceUnavailable as exc:
        raise _unavailable(exc) from exc
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return MomentCreated(slug=slug)
