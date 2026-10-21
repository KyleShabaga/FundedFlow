"""Per-host pacing (research addendum §2): one host at a time, at least the minimum delay between requests,
slower when responses get slow. Jitter only avoids lockstep timing; it never imitates a person.
"""

from __future__ import annotations

import random

from fundedflow_collector.clock import Clock
from fundedflow_collector.config import Settings


class HostPacer:
    def __init__(self, clock: Clock, settings: Settings, rng: random.Random | None = None) -> None:
        self._clock = clock
        self._settings = settings
        self._rng = rng or random.Random()  # noqa: S311 - jitter, not security
        self._last: dict[str, float] = {}
        self._adaptive: dict[str, float] = {}

    def delay_for(self, host: str, min_delay: float) -> float:
        return max(min_delay, self._adaptive.get(host, 0.0))

    def wait(self, host: str, min_delay: float) -> float:
        """Sleep until this host may be requested again. Returns the seconds slept."""
        last = self._last.get(host)
        if last is None:
            return 0.0
        jitter = self._rng.uniform(0, self._settings.pacing.jitter_ms / 1000.0)
        due = last + self.delay_for(host, min_delay) + jitter
        remaining = due - self._clock.monotonic()
        if remaining > 0:
            self._clock.sleep(remaining)
            return remaining
        return 0.0

    def record(self, host: str, response_seconds: float) -> None:
        """Note a finished request; a slow response raises this host's delay for the rest of the run."""
        self._last[host] = self._clock.monotonic()
        pacing = self._settings.pacing
        if response_seconds > pacing.slow_response_seconds:
            self._adaptive[host] = min(
                max(self._adaptive.get(host, 0.0), 2 * response_seconds), pacing.max_adaptive_delay_seconds
            )
