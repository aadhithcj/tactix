import copy
import json
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.main import app
from app.services.pundit import pundit_take
from app.services.simulation import (
    PRESETS,
    evaluate,
    profile_from_text,
    suggest_shape,
    threat_coverage,
)

FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "frontend/src/data/fixtures/scenario-lusail-2022-70.json"
)
ARG, MESSI, MONTIEL = 779, 5503, 28263


@pytest.fixture(scope="module")
def snapshot() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))["snapshot"]


def test_unchanged_shape_keeps_baseline(snapshot: dict) -> None:
    from app.services.simulation import NEUTRAL

    result = evaluate(snapshot, ARG, {}, [], NEUTRAL, "custom")
    proj = result["projection"]
    # A neutral plan on the real shape shouldn't swing the game much.
    assert abs(proj["xg_against"] - proj["baseline_xg_against"]) < 0.1
    assert 1 <= result["gaffer_rating"] <= 10


def test_protecting_a_lead_beats_chasing_it(snapshot: dict) -> None:
    side = snapshot["sides"][str(ARG)]
    ratings = {}
    for key in ("park_bus", "high_press"):
        shape = suggest_shape(side["players"], PRESETS[key], side["key_threat"])
        placements = {p["player_id"]: (p["x"], p["y"]) for p in shape}
        ratings[key] = evaluate(snapshot, ARG, placements, [], PRESETS[key], key)["gaffer_rating"]
    assert ratings["park_bus"] > ratings["high_press"]


def test_substitution_puts_new_player_in_lineup(snapshot: dict) -> None:
    result = evaluate(snapshot, ARG, {}, [(MESSI, MONTIEL)], PRESETS["park_bus"], "park_bus")
    ids = {p["id"] for p in result["lineup"]}
    assert MONTIEL in ids and MESSI not in ids
    assert result["substitutions"][0]["on"] == "Gonzalo Montiel"


def test_coverage_drops_when_shape_abandons_threat(snapshot: dict) -> None:
    side = snapshot["sides"][str(ARG)]
    real, _ = threat_coverage(side["players"], side["threat_grid"])
    huddled = [{**p, "x": 110.0, "y": 40.0} for p in side["players"]]
    worse, _ = threat_coverage(huddled, side["threat_grid"])
    assert worse < real


def test_custom_plan_keywords() -> None:
    deep = profile_from_text("Sit deep, defend the box and counter")
    press = profile_from_text("Press high and push up")
    assert deep.depth < press.depth
    assert press.press > deep.press


def test_template_take_without_gemini(snapshot: dict) -> None:
    result = evaluate(snapshot, ARG, {}, [], PRESETS["park_bus"], "park_bus")
    take = pundit_take(snapshot, result, None)
    assert take["source"] == "model"
    assert take["take"].startswith("Parking the bus")


# ------------------------------------------------------------------ endpoints
@pytest.fixture
def scenario_client(snapshot: dict):
    scenario = MagicMock()
    scenario.slug = "lusail-2022-70"
    scenario.title = "Twenty minutes from glory"
    scenario.tagline = "Tagline"
    scenario.minute = 70
    scenario.match_id = 3869685
    scenario.snapshot = copy.deepcopy(snapshot)
    db = MagicMock()
    db.get.side_effect = lambda model, key: scenario if key == "lusail-2022-70" else None
    app.dependency_overrides[get_db] = lambda: db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_scenario_detail_has_suggested_shapes(scenario_client: TestClient) -> None:
    res = scenario_client.get("/api/scenarios/lusail-2022-70")
    assert res.status_code == 200
    shapes = res.json()["suggested_shapes"][str(ARG)]
    assert set(shapes) == {"park_bus", "high_press", "mark_threat"}
    assert len(shapes["park_bus"]) == 11


def test_simulate_endpoint(scenario_client: TestClient) -> None:
    res = scenario_client.post(
        "/api/scenarios/lusail-2022-70/simulate",
        json={
            "team_id": ARG,
            "tactic": "park_bus",
            "substitutions": [{"off_id": MESSI, "on_id": MONTIEL}],
            "placements": [{"player_id": MONTIEL, "x": 40, "y": 60}],
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["plan_source"] == "preset"
    assert body["actual"]["went_to_extra_time"] is True
    assert body["pundit"]["take"]


def test_simulate_rejects_unavailable_sub(scenario_client: TestClient) -> None:
    res = scenario_client.post(
        "/api/scenarios/lusail-2022-70/simulate",
        json={"team_id": ARG, "tactic": "park_bus", "substitutions": [{"off_id": MESSI, "on_id": 1}]},
    )
    assert res.status_code == 422
    assert "bench" in res.json()["detail"]


def test_simulate_unknown_scenario(scenario_client: TestClient) -> None:
    res = scenario_client.post("/api/scenarios/nope/simulate", json={"team_id": ARG, "tactic": "park_bus"})
    assert res.status_code == 404
