from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


@dataclass
class NewsItem:
    source: str
    title: str
    url: str
    published_at: str | None = None
    summary: str | None = None
    language: str | None = None
    tags: list[str] = field(default_factory=list)
    relevance_score: int = 0
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass
class SocialMetric:
    competitor: str
    platform: str
    handle: str
    metric: str
    value: float
    captured_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    raw: dict[str, Any] = field(default_factory=dict)

