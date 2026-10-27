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
    match_rating,
    profile_from_text,
    suggest_shape,
    threat_coverage,
)

FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "frontend/src/data/fixtures/scenario-lusail-2022-71.json"
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
    scenario.slug = "lusail-2022-71"
    scenario.title = "Twenty minutes from glory"
    scenario.tagline = "Tagline"
    scenario.minute = 70
    scenario.match_id = 3869685
    scenario.snapshot = copy.deepcopy(snapshot)
    db = MagicMock()
    db.get.side_effect = lambda model, key: scenario if key == "lusail-2022-71" else None
    app.dependency_overrides[get_db] = lambda: db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_scenario_detail_has_suggested_shapes(scenario_client: TestClient) -> None:
    res = scenario_client.get("/api/scenarios/lusail-2022-71")
    assert res.status_code == 200
    shapes = res.json()["suggested_shapes"][str(ARG)]
    assert set(shapes) == set(PRESETS)
    assert len(shapes["park_bus"]) == 11


def test_simulate_endpoint(scenario_client: TestClient) -> None:
    res = scenario_client.post(
        "/api/scenarios/lusail-2022-71/simulate",
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
        "/api/scenarios/lusail-2022-71/simulate",
        json={"team_id": ARG, "tactic": "park_bus", "substitutions": [{"off_id": MESSI, "on_id": 1}]},
    )
    assert res.status_code == 422
    assert "bench" in res.json()["detail"]


def test_simulate_unknown_scenario(scenario_client: TestClient) -> None:
    res = scenario_client.post("/api/scenarios/nope/simulate", json={"team_id": ARG, "tactic": "park_bus"})
    assert res.status_code == 404


def _live(**overrides) -> dict:
    live = {
        "start_score": {"for": 2, "against": 0},
        "final_score": {"for": 2, "against": 1},
        "xg_for": 0.3,
        "xg_against": 0.2,
        "base_xg_for": 0.38,
        "base_xg_against": 0.36,
        "fit": 0.9,
        "minutes": 27,
        "shots_for": 3,
        "shots_against": 4,
        "goals": [{"minute": 88, "team": "them", "player": "Kylian Mbappé"}],
        "changes": [{"minute": 80, "label": "Parked the bus"}],
    }
    return {**live, **overrides}


def test_report_rates_the_whole_match(scenario_client: TestClient) -> None:
    res = scenario_client.post(
        "/api/scenarios/lusail-2022-71/report",
        json={"team_id": ARG, "tactic": "park_bus", "live": _live()},
    )
    assert res.status_code == 200
    body = res.json()
    # Fewer chances allowed than the real shape while protecting a lead rates well.
    assert body["gaffer_rating"] == match_rating(2, 0.3, 0.2, 0.38, 0.36, 0.9)
    assert body["projection"]["likely_score"] == {"home": 2, "away": 1}
    assert body["live"]["final_score"] == {"for": 2, "against": 1}
    assert body["pundit"]["take"].startswith("Argentina won 2-1")


def test_report_must_start_from_the_real_score(scenario_client: TestClient) -> None:
    res = scenario_client.post(
        "/api/scenarios/lusail-2022-71/report",
        json={"team_id": ARG, "tactic": "park_bus", "live": _live(start_score={"for": 0, "against": 0})},
    )
    assert res.status_code == 422


def test_live_rating_rewards_fewer_chances_allowed() -> None:
    assert match_rating(1, 0.3, 0.2, 0.3, 0.5, 0.8) > match_rating(1, 0.3, 0.8, 0.3, 0.5, 0.8)


def test_new_dials_are_neutral_by_default(snapshot: dict) -> None:
    from dataclasses import replace

    base = evaluate(snapshot, ARG, {}, [], PRESETS["park_bus"], "park_bus")
    explicit = replace(PRESETS["park_bus"], width=0.5, direct=0.4)
    assert evaluate(snapshot, ARG, {}, [], explicit, "park_bus")["projection"] == base["projection"]


def test_style_changes_the_chances(snapshot: dict) -> None:
    side = snapshot["sides"][str(ARG)]
    proj = {}
    for key in ("tiki_taka", "counter", "wing_play", "false_nine"):
        shape = suggest_shape(side["players"], PRESETS[key], side["key_threat"], key)
        placements = {p["player_id"]: (p["x"], p["y"]) for p in shape}
        proj[key] = evaluate(snapshot, ARG, placements, [], PRESETS[key], key)["projection"]
    assert len({(p["xg_for"], p["xg_against"]) for p in proj.values()}) == 4


def test_keeping_the_ball_means_fewer_chances_against(snapshot: dict) -> None:
    from dataclasses import replace

    tiki = PRESETS["tiki_taka"]
    patient = evaluate(snapshot, ARG, {}, [], tiki, "tiki_taka")["projection"]
    direct = evaluate(snapshot, ARG, {}, [], replace(tiki, direct=0.9), "tiki_taka")["projection"]
    assert patient["xg_against"] < direct["xg_against"]
    # France's line sat high, so going direct creates more.
    assert direct["xg_for"] > patient["xg_for"]


def test_false_nine_drops_the_striker(snapshot: dict) -> None:
    side = snapshot["sides"][str(ARG)]
    plain = {p["player_id"]: p for p in suggest_shape(side["players"], PRESETS["false_nine"], None)}
    nine = {p["player_id"]: p for p in suggest_shape(side["players"], PRESETS["false_nine"], None, "false_nine")}
    dropped = [pid for pid in nine if nine[pid]["x"] < plain[pid]["x"] - 10]
    assert len(dropped) == 1


def test_keywords_read_style() -> None:
    assert profile_from_text("play a false 9 and keep the ball").direct < 0.2
    assert profile_from_text("get it wide and cross").width > 0.8
    assert profile_from_text("sit in and counter").direct > 0.7
