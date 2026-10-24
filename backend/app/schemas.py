from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class TeamRead(BaseModel):
    id: int
    name: str

    model_config = ConfigDict(from_attributes=True, arbitrary_types_allowed=True)


class MatchSummaryRead(BaseModel):
    id: int
    competition: str
    season: str
    match_date: date
    home_team_id: int
    away_team_id: int
    home_score: int
    away_score: int
    home_xg: float
    away_xg: float
    home_team: TeamRead | None = None
    away_team: TeamRead | None = None

    model_config = ConfigDict(from_attributes=True, arbitrary_types_allowed=True)


class MatchDetailRead(MatchSummaryRead):
    stats: dict[str, Any] = Field(default_factory=dict)
    scenario_slugs: list[str] = Field(default_factory=list)


class EventRead(BaseModel):
    id: str
    minute: int
    second: int
    period: int | None = None
    team_id: int
    player_id: int | None = None
    player_name: str | None = None
    event_type: str
    x: float | None = None
    y: float | None = None
    end_x: float | None = None
    end_y: float | None = None
    xg: float | None = None
    outcome: str | None = None
    play_pattern: str | None = None


class HealthCheckResponse(BaseModel):
    status: str
    database: str
    pgvector: str

    model_config = ConfigDict(from_attributes=True, arbitrary_types_allowed=True)


# ---------------------------------------------------------------- scenarios
class ScenarioSide(BaseModel):
    team_id: int
    name: str
    code: str
    dilemma: str


class ScenarioSummary(BaseModel):
    slug: str
    title: str
    tagline: str
    minute: int
    match_id: int
    competition: str
    season: str
    date: str
    venue: str
    home: str
    away: str
    score: dict[str, int]
    final_score: dict[str, int]
    sides: list[ScenarioSide]


class ScenarioDetail(BaseModel):
    slug: str
    title: str
    tagline: str
    minute: int
    snapshot: dict[str, Any]
    # {team_id: {tactic: [{player_id, x, y}]}}: where each preset moves the real shape.
    suggested_shapes: dict[str, dict[str, list[dict[str, float]]]] = Field(default_factory=dict)


class Placement(BaseModel):
    player_id: int
    x: float = Field(ge=0, le=120)
    y: float = Field(ge=0, le=80)


class SubstitutionIn(BaseModel):
    off_id: int
    on_id: int


TacticKey = Literal["park_bus", "high_press", "mark_threat", "custom"]


class SimulationRequest(BaseModel):
    team_id: int
    tactic: TacticKey
    custom_plan: str | None = Field(default=None, max_length=600)
    placements: list[Placement] = Field(default_factory=list, max_length=11)
    substitutions: list[SubstitutionIn] = Field(default_factory=list, max_length=5)


class Projection(BaseModel):
    minutes: int
    xg_for: float
    xg_against: float
    baseline_xg_for: float
    baseline_xg_against: float
    likely_score: dict[str, int]


class Metric(BaseModel):
    key: str
    label: str
    value: float
    baseline: float
    unit: str
    better: Literal["higher", "lower", "context"]


class ExposedZone(BaseModel):
    x: float
    y: float
    w: float
    h: float
    share: float
    label: str


class Finding(BaseModel):
    tone: Literal["good", "bad", "neutral"]
    text: str


class PunditRead(BaseModel):
    headline: str
    take: str
    source: Literal["gemini", "model"]


class SimulationResponse(BaseModel):
    scenario: str
    team_id: int
    opponent_id: int
    tactic: TacticKey
    profile: dict[str, Any]
    plan_source: Literal["gemini", "model", "preset"]
    gaffer_rating: float
    rating_label: str
    structure_fit: float
    projection: Projection
    metrics: list[Metric]
    exposed_zones: list[ExposedZone]
    findings: list[Finding]
    lineup: list[dict[str, Any]]
    substitutions: list[dict[str, str]]
    pundit: PunditRead
    actual: dict[str, Any]
    model_note: str


class AskRequest(BaseModel):
    question: str = Field(min_length=2, max_length=400)


class AskResponse(BaseModel):
    answer: str
    source: Literal["gemini", "model"]
