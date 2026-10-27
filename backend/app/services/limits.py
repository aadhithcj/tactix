"""Protect the Gemini free tier and the upstream data source from abuse.

Two layers:
- A global daily Gemini budget kept below Google's free quota, with a
  cool-off when Google reports the quota is gone. When it's spent, features
  fall back to the model's own text instead of failing.
- Per-visitor rate limits (by client IP) on endpoints that call Gemini or
  fetch whole matches.

State is in memory: the API runs as a single instance, and a restart only
ever makes the limits stricter in practice (Google's own quota still holds).
"""

import logging
import threading
import time
from collections import defaultdict, deque
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, Request, status

from app.config import settings

logger = logging.getLogger("tactix.limits")


class GeminiBudget:
    """Counts Gemini calls per UTC day and stops before the free quota."""

    def __init__(self, daily_limit: int) -> None:
        self.daily_limit = daily_limit
        self._lock = threading.Lock()
        self._day = datetime.now(UTC).date()
        self._used = 0
        self._blocked_until: datetime | None = None

    def _roll(self) -> None:
        today = datetime.now(UTC).date()
        if today != self._day:
            self._day, self._used = today, 0

    def try_spend(self) -> bool:
        """Reserve one call; False when the budget or a cool-off says no."""
        with self._lock:
            self._roll()
            now = datetime.now(UTC)
            if self._blocked_until and now < self._blocked_until:
                return False
            if self._used >= self.daily_limit:
                return False
            self._used += 1
            return True

    def quota_exhausted(self) -> None:
        """Google said the quota is gone: stop calling until the next UTC day."""
        with self._lock:
            tomorrow = datetime.combine(datetime.now(UTC).date() + timedelta(days=1), datetime.min.time(), UTC)
            self._blocked_until = tomorrow
            logger.warning("Gemini quota exhausted; using fallback text until %s.", tomorrow.isoformat())

    def status(self) -> dict[str, object]:
        with self._lock:
            self._roll()
            return {"used_today": self._used, "daily_limit": self.daily_limit, "cooling_off": bool(self._blocked_until and datetime.now(UTC) < self._blocked_until)}


gemini_budget = GeminiBudget(settings.GEMINI_DAILY_BUDGET)


class RateLimiter:
    """Sliding-window limit per key (client IP) per scope."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._hits: dict[tuple[str, str], deque[float]] = defaultdict(deque)

    def allow(self, scope: str, key: str, limit: int, window_seconds: int) -> bool:
        now = time.monotonic()
        with self._lock:
            hits = self._hits[(scope, key)]
            while hits and now - hits[0] > window_seconds:
                hits.popleft()
            if len(hits) >= limit:
                return False
            hits.append(now)
            # Keep memory bounded if many visitors pass through.
            if len(self._hits) > 20_000:
                self._hits = defaultdict(deque, {k: v for k, v in self._hits.items() if v})
            return True


rate_limiter = RateLimiter()


def client_key(request: Request) -> str:
    # uvicorn runs with --proxy-headers, so this is the visitor, not Render's proxy.
    return request.client.host if request.client else "unknown"


def ai_allowed(request: Request) -> bool:
    """Whether this visitor may trigger Gemini right now (otherwise: fallback text)."""
    key = client_key(request)
    return rate_limiter.allow("ai-minute", key, settings.AI_PER_MINUTE, 60) and rate_limiter.allow(
        "ai-day", key, settings.AI_PER_DAY, 86_400
    )


def require_fetch_allowance(request: Request) -> None:
    """Building or analysing a match fetches a whole match upstream; cap it per visitor."""
    if not rate_limiter.allow("fetch-hour", client_key(request), settings.FETCHES_PER_HOUR, 3_600):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="You've opened a lot of new matches in the last hour. Try again in a little while.",
        )
