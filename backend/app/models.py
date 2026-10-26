from datetime import date, datetime
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import JSON, Date, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Team(Base):
    __tablename__ = "teams"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, index=True)

    players: Mapped[list["Player"]] = relationship("Player", back_populates="team")


class Player(Base):
    __tablename__ = "players"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(150), index=True)
    team_id: Mapped[int | None] = mapped_column(ForeignKey("teams.id"), nullable=True)
    position: Mapped[str | None] = mapped_column(String(80), nullable=True)
    nickname: Mapped[str | None] = mapped_column(String(120), nullable=True)
    jersey_number: Mapped[int | None] = mapped_column(Integer, nullable=True)

    team: Mapped[Team | None] = relationship("Team", back_populates="players")


class Match(Base):
    __tablename__ = "matches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    competition: Mapped[str] = mapped_column(String(120))
    season: Mapped[str] = mapped_column(String(60))
    match_date: Mapped[date] = mapped_column(Date)
    home_team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"))
    away_team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"))
    home_score: Mapped[int] = mapped_column(Integer)
    away_score: Mapped[int] = mapped_column(Integer)
    home_xg: Mapped[float] = mapped_column(Float, default=0.0)
    away_xg: Mapped[float] = mapped_column(Float, default=0.0)
    stats_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    ai_tactical_report: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)

    home_team: Mapped[Team] = relationship("Team", foreign_keys=[home_team_id])
    away_team: Mapped[Team] = relationship("Team", foreign_keys=[away_team_id])
    events: Mapped[list["MatchEvent"]] = relationship(
        "MatchEvent", back_populates="match", cascade="all, delete-orphan"
    )
    tactical_documents: Mapped[list["TacticalDocument"]] = relationship(
        "TacticalDocument", back_populates="match", cascade="all, delete-orphan"
    )
    scenarios: Mapped[list["Scenario"]] = relationship(
        "Scenario", back_populates="match", cascade="all, delete-orphan"
    )


class MatchEvent(Base):
    __tablename__ = "match_events"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), index=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), index=True)
    player_id: Mapped[int | None] = mapped_column(ForeignKey("players.id"), nullable=True, index=True)
    minute: Mapped[int] = mapped_column(Integer)
    second: Mapped[int] = mapped_column(Integer)
    event_type: Mapped[str] = mapped_column(String(60), index=True)
    location_x: Mapped[float | None] = mapped_column(Float, nullable=True)
    location_y: Mapped[float | None] = mapped_column(Float, nullable=True)
    end_location_x: Mapped[float | None] = mapped_column(Float, nullable=True)
    end_location_y: Mapped[float | None] = mapped_column(Float, nullable=True)
    xg: Mapped[float | None] = mapped_column(Float, nullable=True)
    outcome: Mapped[str | None] = mapped_column(String(60), nullable=True)
    raw_metadata: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)

    match: Mapped[Match] = relationship("Match", back_populates="events")


class TacticalDocument(Base):
    __tablename__ = "tactical_documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    match_id: Mapped[int | None] = mapped_column(
        ForeignKey("matches.id", ondelete="CASCADE"), nullable=True, index=True
    )
    doc_type: Mapped[str] = mapped_column(String(50))
    content: Mapped[str] = mapped_column(Text)
    embedding: Mapped[Any | None] = mapped_column(Vector(768), nullable=True)

    match: Mapped[Match | None] = relationship("Match", back_populates="tactical_documents")


class Scenario(Base):
    """A playable moment: a match frozen at a minute, with both sides' snapshots."""

    __tablename__ = "scenarios"

    slug: Mapped[str] = mapped_column(String(80), primary_key=True)
    match_id: Mapped[int] = mapped_column(
        ForeignKey("matches.id", ondelete="CASCADE"), index=True
    )
    minute: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(160))
    tagline: Mapped[str] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSON)

    match: Mapped[Match] = relationship("Match", back_populates="scenarios")


class CatalogCache(Base):
    """Cached copies of slow upstream lookups, such as the open-data match library."""

    __tablename__ = "catalog_cache"

    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    data: Mapped[dict[str, Any]] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
