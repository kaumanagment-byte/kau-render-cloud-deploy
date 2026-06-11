import json
import sqlite3
from pathlib import Path

from .models import NewsItem, SocialMetric


SCHEMA = """
CREATE TABLE IF NOT EXISTS news_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    published_at TEXT,
    summary TEXT,
    language TEXT,
    tags TEXT NOT NULL,
    relevance_score INTEGER NOT NULL,
    raw TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS social_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    competitor TEXT NOT NULL,
    platform TEXT NOT NULL,
    handle TEXT NOT NULL,
    metric TEXT NOT NULL,
    value REAL NOT NULL,
    captured_at TEXT NOT NULL,
    raw TEXT NOT NULL
);
"""


class Store:
    def __init__(self, db_path: str | Path):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(self.db_path)
        self.connection.executescript(SCHEMA)

    def save_news(self, items: list[NewsItem]) -> int:
        saved = 0
        for item in items:
            try:
                self.connection.execute(
                    """
                    INSERT INTO news_items
                    (source, title, url, published_at, summary, language, tags, relevance_score, raw)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        item.source,
                        item.title,
                        item.url,
                        item.published_at,
                        item.summary,
                        item.language,
                        json.dumps(item.tags, ensure_ascii=False),
                        item.relevance_score,
                        json.dumps(item.raw, ensure_ascii=False),
                    ),
                )
                saved += 1
            except sqlite3.IntegrityError:
                continue
        self.connection.commit()
        return saved

    def save_social_metrics(self, metrics: list[SocialMetric]) -> int:
        for metric in metrics:
            self.connection.execute(
                """
                INSERT INTO social_metrics
                (competitor, platform, handle, metric, value, captured_at, raw)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    metric.competitor,
                    metric.platform,
                    metric.handle,
                    metric.metric,
                    metric.value,
                    metric.captured_at,
                    json.dumps(metric.raw, ensure_ascii=False),
                ),
            )
        self.connection.commit()
        return len(metrics)

    def top_news(self, limit: int = 25) -> list[dict]:
        cursor = self.connection.execute(
            """
            SELECT source, title, url, published_at, summary, tags, relevance_score
            FROM news_items
            ORDER BY relevance_score DESC, COALESCE(published_at, created_at) DESC
            LIMIT ?
            """,
            (limit,),
        )
        columns = [column[0] for column in cursor.description]
        rows = []
        for row in cursor.fetchall():
            item = dict(zip(columns, row))
            item["tags"] = json.loads(item["tags"])
            rows.append(item)
        return rows

    def recent_social_metrics(self, limit: int = 100) -> list[dict]:
        cursor = self.connection.execute(
            """
            SELECT competitor, platform, handle, metric, value, captured_at
            FROM social_metrics
            ORDER BY captured_at DESC
            LIMIT ?
            """,
            (limit,),
        )
        columns = [column[0] for column in cursor.description]
        return [dict(zip(columns, row)) for row in cursor.fetchall()]

