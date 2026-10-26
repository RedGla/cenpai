"""Runtime limits. Defaults are PROPOSED starting caps (PRD FR01) pending the AC05 benchmark."""
from __future__ import annotations

import os
from dataclasses import dataclass, fields


@dataclass(frozen=True)
class Limits:
    image_max_mb: float = 20
    image_max_pixels: int = 20_000_000
    video_max_mb: float = 100
    video_max_seconds: float = 60.0
    video_max_long_side: int = 1920
    video_max_short_side: int = 1080
    video_max_fps: float = 30.0
    retention_s: int = 3300      # hard maximum is 3600 (FR07); sweeper adds up to sweep_interval_s
    sweep_interval_s: int = 60
    job_timeout_s: int = 900
    queue_max: int = 8
    concurrency: int = 1
    rate_per_ip_per_hour: int = 20

    def __post_init__(self):
        if self.sweep_interval_s > 300:
            raise ValueError("sweep_interval_s must be <= 300 (FR07: deletion within 5 minutes)")
        # framework-cache entries are aged from when the sweeper first sees them (<= 1 tick late),
        # and are removed on a later tick (<= 1 tick late): retention + 2 ticks is the worst case.
        if self.retention_s + 2 * self.sweep_interval_s > 3600:
            raise ValueError("retention_s + 2*sweep_interval_s must be <= 3600 (FR07: one hour maximum)")
        if self.job_timeout_s >= self.retention_s:
            raise ValueError("job_timeout_s must be < retention_s")
        if self.concurrency < 1 or self.queue_max < 1:
            raise ValueError("concurrency and queue_max must be >= 1")

    @property
    def image_max_bytes(self) -> int:
        return int(self.image_max_mb * 2**20)

    @property
    def video_max_bytes(self) -> int:
        return int(self.video_max_mb * 2**20)


def load_limits(env=os.environ) -> Limits:
    """Override any field with CENPAI_<FIELD_NAME>, e.g. CENPAI_VIDEO_MAX_SECONDS=30."""
    kw = {}
    for f in fields(Limits):
        raw = env.get("CENPAI_" + f.name.upper())
        if raw not in (None, ""):
            kw[f.name] = type(getattr(Limits, f.name))(raw)
    return Limits(**kw)
