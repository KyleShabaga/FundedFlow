"""Per-firm fetch budget and run deadline. robots.txt requests do not count; everything else does."""

from __future__ import annotations

from fundedflow_collector.clock import Clock


class RunBudget:
    def __init__(self, limit: int, deadline_minutes: int, clock: Clock) -> None:
        self.limit = limit
        self.used = 0
        self._clock = clock
        self._deadline = clock.monotonic() + deadline_minutes * 60

    @property
    def remaining(self) -> int:
        return max(0, self.limit - self.used)

    @property
    def exhausted(self) -> bool:
        return self.used >= self.limit

    @property
    def deadline_passed(self) -> bool:
        return self._clock.monotonic() >= self._deadline

    def spend(self, count: int = 1) -> None:
        self.used += count
