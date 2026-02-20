from __future__ import annotations

import random
from dataclasses import dataclass


@dataclass
class AdaptiveRateController:
    base_interval: float
    min_interval: float
    max_interval: float
    healthy_streak_for_recovery: int = 4
    jitter_ratio: float = 0.1

    def __post_init__(self) -> None:
        self.current_interval = self.base_interval
        self._healthy_streak = 0

    def on_success(self) -> float:
        self._healthy_streak += 1
        if self._healthy_streak >= self.healthy_streak_for_recovery:
            self.current_interval = max(self.min_interval, self.current_interval * 0.85)
            self._healthy_streak = 0
        return self.current_interval

    def on_error(self) -> float:
        self._healthy_streak = 0
        self.current_interval = min(self.max_interval, self.current_interval * 1.6)
        return self.current_interval

    def on_throttled(self) -> float:
        self._healthy_streak = 0
        self.current_interval = min(self.max_interval, self.current_interval * 2.0)
        return self.current_interval

    def with_jitter(self) -> float:
        jitter = self.current_interval * self.jitter_ratio
        return max(self.min_interval, self.current_interval + random.uniform(-jitter, jitter))
