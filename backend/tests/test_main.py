from collections.abc import Generator
from datetime import date
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app import models
from app.database import SessionLocal, engine, get_db, init_db
from app.main import app


def _is_db_connected() -> bool:
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except (SQLAlchemyError, OSError):
        return False


@pytest.fixture(autouse=True, scope="session")
def setup_database() -> None:
    if _is_db_connected():
        init_db()


@pytest.fixture
def client() -> Generator[TestClient, None, None]:
    if not _is_db_connected():
        mock_db = MagicMock()
        mock_db.execute.return_value.scalar.return_value = 1
        mock_db.execute.return_value.scalars.return_value.all.return_value = []
        mock_db.get.return_value = None
        app.dependency_overrides[get_db] = lambda: mock_db
        try:
            with TestClient(app) as test_c:
                yield test_c
        finally:
            app.dependency_overrides.pop(get_db, None)
    else:
        with TestClient(app) as test_c:
            yield test_c


def test_health_check(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["database"] == "connected"
    assert data["pgvector"] == "enabled"


def test_get_matches(client: TestClient) -> None:
    response = client.get("/api/matches")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)


def test_get_match_stats_not_found(client: TestClient) -> None:
    response = client.get("/api/matches/999999999/stats")
    assert response.status_code == 404


def test_get_match_stats_success(client: TestClient) -> None:
    if _is_db_connected():
        with SessionLocal() as db:
            home = models.Team(id=991, name="Test Home")
            away = models.Team(id=992, name="Test Away")
            db.merge(home)
            db.merge(away)
            match_obj = models.Match(
                id=99999,
                competition="Test Cup",
                season="2022",
                match_date=date(2022, 12, 18),
                home_team_id=991,
                away_team_id=992,
                home_score=1,
                away_score=0,
                stats_json={
                    "team_stats": {"possession": {"Test Home": 60, "Test Away": 40}},
                    "pass_networks": {},
                    "momentum_timeline": [],
                },
            )
            db.merge(match_obj)
            db.commit()

        response = client.get("/api/matches/99999/stats")
        assert response.status_code == 200
        data = response.json()
        assert "team_stats" in data
        assert "pass_networks" in data
        assert "momentum_timeline" in data
    else:
        mock_match = MagicMock()
        mock_match.stats_json = {
            "team_stats": {},
            "pass_networks": {},
            "momentum_timeline": [],
        }
        app.dependency_overrides[get_db] = lambda: MagicMock(
            get=MagicMock(return_value=mock_match)
        )
        try:
            response = client.get("/api/matches/99999/stats")
            assert response.status_code == 200
            data = response.json()
            assert "team_stats" in data
        finally:
            app.dependency_overrides.pop(get_db, None)
