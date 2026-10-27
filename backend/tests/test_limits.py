from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app
from app.services import limits, moments
from app.services.limits import GeminiBudget, RateLimiter


def test_budget_stops_at_daily_limit() -> None:
    budget = GeminiBudget(daily_limit=2)
    assert budget.try_spend() and budget.try_spend()
    assert not budget.try_spend()


def test_budget_cools_off_after_quota_error() -> None:
    budget = GeminiBudget(daily_limit=10)
    budget.quota_exhausted()
    assert not budget.try_spend()
    assert budget.status()["cooling_off"] is True


def test_rate_limiter_window() -> None:
    limiter = RateLimiter()
    assert all(limiter.allow("s", "1.2.3.4", 3, 60) for _ in range(3))
    assert not limiter.allow("s", "1.2.3.4", 3, 60)
    assert limiter.allow("s", "5.6.7.8", 3, 60)  # Other visitors are unaffected.


def test_match_fetches_are_capped_per_visitor() -> None:
    client = TestClient(app)
    body = {"competition_id": 16, "season_id": 4, "match_id": 22912}
    with (
        patch.object(limits, "rate_limiter", RateLimiter()),
        patch.object(limits.settings, "FETCHES_PER_HOUR", 2),
        patch.object(moments, "ensure_match", return_value=22912),
    ):
        codes = [client.post("/api/catalog/analyse", json=body).status_code for _ in range(3)]
    assert codes == [200, 200, 429]
