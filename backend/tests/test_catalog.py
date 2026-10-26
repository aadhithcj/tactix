from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import app
from app.services import moments
from app.services.snapshot import auto_dilemma

MATCH = {
    "match_id": 22912,
    "date": "2019-06-01",
    "home": "Tottenham Hotspur",
    "away": "Liverpool",
    "home_score": 0,
    "away_score": 2,
    "stage": "Final",
    "stadium": "Wanda Metropolitano",
}


@pytest.mark.parametrize(
    "url",
    [
        "postgres://u:p@host:5432/db",
        "postgresql://u:p@host:5432/db",
        "postgresql+psycopg://u:p@host:5432/db",
    ],
)
def test_database_url_uses_psycopg(url: str) -> None:
    assert Settings(DATABASE_URL=url).DATABASE_URL == "postgresql+psycopg://u:p@host:5432/db"


def test_cors_origins_from_comma_list() -> None:
    s = Settings(CORS_ORIGINS="https://tactix.app, http://localhost:5173 ,")
    assert s.allowed_origins == ["https://tactix.app", "http://localhost:5173"]


def test_auto_dilemma_follows_the_score() -> None:
    assert auto_dilemma(1, 0, "Spurs", 30).startswith("You lead 1–0")
    assert auto_dilemma(0, 2, "Spurs", 30).startswith("You're 0–2 down")
    assert "Push for a winner" in auto_dilemma(1, 1, "Spurs", 30)


def test_create_moment_validates_minute() -> None:
    with pytest.raises(ValueError):
        moments.create_moment(16, 4, 22912, 2)


def test_create_moment_rejects_unknown_match() -> None:
    with patch.object(moments, "list_matches", return_value=[MATCH]), pytest.raises(LookupError):
        moments.create_moment(16, 4, 999, 60)


def test_create_moment_builds_once() -> None:
    with (
        patch.object(moments, "list_matches", return_value=[MATCH]),
        patch.object(moments, "SessionLocal") as session,
        patch.object(moments, "ingest_match") as ingest,
    ):
        session.return_value.__enter__.return_value.get.return_value = None
        assert moments.create_moment(16, 4, 22912, 60) == "custom-22912-60"
        spec = ingest.call_args.args[0][0]
        assert spec.minute == 60 and spec.subs_allowed == 3  # Pre-2020 rules.

        session.return_value.__enter__.return_value.get.return_value = object()
        ingest.reset_mock()
        assert moments.create_moment(16, 4, 22912, 60) == "custom-22912-60"
        ingest.assert_not_called()


def test_catalog_endpoints() -> None:
    client = TestClient(app)
    comp = {"competition_id": 16, "season_id": 4, "competition": "Champions League", "season": "2018/2019", "country": "Europe", "gender": "male"}
    with (
        patch.object(moments, "list_competitions", return_value=[comp]),
        patch.object(moments, "list_matches", return_value=[MATCH]),
        patch.object(moments, "create_moment", return_value="custom-22912-60"),
    ):
        assert client.get("/api/catalog/competitions").json()[0]["season"] == "2018/2019"
        assert client.get("/api/catalog/matches?competition_id=16&season_id=4").json()[0]["away"] == "Liverpool"
        res = client.post("/api/catalog/moments", json={"competition_id": 16, "season_id": 4, "match_id": 22912, "minute": 60})
        assert res.status_code == 201 and res.json() == {"slug": "custom-22912-60"}
    assert client.post("/api/catalog/moments", json={"competition_id": 16, "season_id": 4, "match_id": 1, "minute": 99}).status_code == 422


def test_catalog_source_down_is_502() -> None:
    client = TestClient(app)
    with patch.object(moments, "list_competitions", side_effect=moments.SourceUnavailable("timeout")):
        res = client.get("/api/catalog/competitions")
    assert res.status_code == 502
    assert "couldn't be reached" in res.json()["detail"]


def test_library_reports_not_ready_then_ready() -> None:
    client = TestClient(app)
    with patch.object(moments, "get_library", return_value=None):
        assert client.get("/api/catalog/library").json() == {"ready": False, "seasons": [], "matches": []}
    season = {"competition_id": 16, "season_id": 4, "competition": "Champions League", "season": "2018/2019", "country": "Europe", "gender": "male", "matches": 1}
    library = {"seasons": [season], "matches": [{**MATCH, "competition_id": 16, "season_id": 4}], "built_at": "2026-01-01T00:00:00+00:00"}
    with patch.object(moments, "get_library", return_value=library):
        body = client.get("/api/catalog/library", headers={"Accept-Encoding": "gzip"}).json()
    assert body["ready"] is True and body["matches"][0]["home"] == "Tottenham Hotspur"


def test_analyse_endpoint() -> None:
    client = TestClient(app)
    with patch.object(moments, "ensure_match", return_value=22912):
        res = client.post("/api/catalog/analyse", json={"competition_id": 16, "season_id": 4, "match_id": 22912})
    assert res.status_code == 200 and res.json() == {"match_id": 22912}
    with patch.object(moments, "ensure_match", side_effect=LookupError("nope")):
        assert client.post("/api/catalog/analyse", json={"competition_id": 16, "season_id": 4, "match_id": 1}).status_code == 404
