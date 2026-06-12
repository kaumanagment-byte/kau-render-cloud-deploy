import json
import os
import sqlite3
import subprocess
import sys
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from src.kau_agent.text_utils import clean_text
from src.kau_agent.sources.livedune import LiveDuneClient


ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "web"
DB_PATH = ROOT / "data.sqlite"
CONFIG_PATH = ROOT / "config.example.json"

KAU_MENTION_VARIANTS = [
    "kau kazakh-american",
    "kau kazakh american",
    "kazakh-american university",
    "kazakh american university",
    "kazakh-american university of almaty",
    "kazakh american university of almaty",
    "kazakh-american university kazakhstan",
    "kazakh american university kazakhstan",
    "kau.kz",
    "kau official",
    "казахско-американ",
    "казахско американ",
    "казахско-американский университет",
    "казахско американский университет",
    "казахско-американский университет алматы",
    "казахско американский университет алматы",
    "қазақ-американ",
    "қазақ американ",
    "қазақ-американ университеті",
    "қазақ американ университеті",
    "қазақстан-американ университеті",
    "қазақстан американ университеті",
    "kazakh-american",
    "kazakh american",
]


def load_env() -> None:
    env_path = ROOT / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"'))


def connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def read_config() -> dict:
    if not CONFIG_PATH.exists():
        return {}
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def decode_tags(value: str | None) -> list[str]:
    if not value:
        return []
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return []


def is_kau_mention(title: str | None, summary: str | None, source: str | None, tags: list[str] | None = None) -> bool:
    haystack = " ".join([title or "", summary or ""]).casefold()
    return any(variant.casefold() in haystack for variant in KAU_MENTION_VARIANTS)


class DashboardHandler(BaseHTTPRequestHandler):
    server_version = "KAUDashboard/0.1"

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            self.send_json({"ok": True, "service": "kau-intelligence-service"})
            return
        if parsed.path == "/":
            self.serve_static("index.html")
            return
        if parsed.path.startswith("/api/"):
            self.serve_api(parsed.path, parse_qs(parsed.query))
            return
        self.serve_static(parsed.path.lstrip("/"))

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/collect":
            self.run_collect()
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def serve_api(self, path: str, query: dict[str, list[str]]) -> None:
        routes = {
            "/api/summary": self.api_summary,
            "/api/news": lambda: self.api_news(query),
            "/api/social": self.api_social,
            "/api/livedune/accounts": self.api_livedune_accounts,
            "/api/livedune/comparison": self.api_livedune_comparison,
            "/api/livedune/remote-accounts": self.api_livedune_remote_accounts,
            "/api/trends/university": self.api_university_trends,
            "/api/kazakhstan/digest": self.api_kazakhstan_digest,
            "/api/kau/mentions": self.api_kau_mentions,
            "/api/competitors": self.api_competitors,
            "/api/status": self.api_status,
        }
        handler = routes.get(path)
        if handler is None:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        self.send_json(handler())

    def api_status(self) -> dict:
        return {
            "database_exists": DB_PATH.exists(),
            "livedune_configured": bool(os.getenv("LIVEDUNE_API_TOKEN")),
            "config_path": str(CONFIG_PATH),
        }

    def api_summary(self) -> dict:
        if not DB_PATH.exists():
            return {"total_news": 0, "kau_mentions": 0, "tag_counts": {}, "source_counts": {}}

        with connect() as connection:
            rows = connection.execute(
                """
                SELECT source, title, summary, tags, relevance_score, published_at, created_at
                FROM news_items
                """
            ).fetchall()

        tag_counts: dict[str, int] = {}
        source_counts: dict[str, int] = {}
        total_score = 0
        latest = None
        kau_mentions = 0

        for row in rows:
            source_counts[row["source"]] = source_counts.get(row["source"], 0) + 1
            tags = decode_tags(row["tags"])
            total_score += int(row["relevance_score"] or 0)
            latest_candidate = row["published_at"] or row["created_at"]
            if latest_candidate and (latest is None or latest_candidate > latest):
                latest = latest_candidate
            if is_kau_mention(row["title"], row["summary"], row["source"], tags):
                kau_mentions += 1
            for tag in tags:
                tag_counts[tag] = tag_counts.get(tag, 0) + 1

        return {
            "total_news": len(rows),
            "kau_mentions": kau_mentions,
            "average_relevance": round(total_score / len(rows), 1) if rows else 0,
            "latest_signal": latest,
            "tag_counts": dict(sorted(tag_counts.items(), key=lambda item: item[1], reverse=True)),
            "source_counts": dict(sorted(source_counts.items(), key=lambda item: item[1], reverse=True)),
        }

    def api_news(self, query: dict[str, list[str]]) -> list[dict]:
        if not DB_PATH.exists():
            return []

        tag_filter = first(query, "tag")
        search = (first(query, "q") or "").lower()
        limit = int(first(query, "limit") or 80)

        with connect() as connection:
            rows = connection.execute(
                """
                SELECT source, title, url, published_at, summary, tags, relevance_score
                FROM news_items
                ORDER BY relevance_score DESC, COALESCE(published_at, created_at) DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()

        items = []
        for row in rows:
            tags = decode_tags(row["tags"])
            haystack = " ".join([row["title"] or "", row["summary"] or "", row["source"] or ""]).lower()
            if tag_filter and tag_filter not in tags:
                continue
            if search and search not in haystack:
                continue
            items.append(
                {
                    "source": clean_text(row["source"]),
                    "title": clean_text(row["title"]),
                    "url": row["url"],
                    "published_at": row["published_at"],
                    "summary": clean_text(row["summary"]),
                    "tags": tags,
                    "relevance_score": row["relevance_score"],
                }
            )
        return items

    def api_kau_mentions(self) -> dict:
        items = [
            item
            for item in self.api_news({"limit": ["500"]})
            if is_kau_mention(item.get("title"), item.get("summary"), item.get("source"), item.get("tags"))
        ]
        return {
            "updated_at": _now_label(),
            "variants": KAU_MENTION_VARIANTS,
            "total": len(items),
            "items": items[:80],
        }

    def api_social(self) -> list[dict]:
        if not DB_PATH.exists():
            return []
        with connect() as connection:
            rows = connection.execute(
                """
                SELECT competitor, platform, handle, metric, value, captured_at
                FROM social_metrics
                ORDER BY captured_at DESC
                LIMIT 200
                """
            ).fetchall()
        return [dict(row) for row in rows]

    def api_livedune_accounts(self) -> dict:
        config = read_config()
        own_accounts = config.get("own_accounts", [])
        competitors = config.get("competitors", [])
        metrics = self._latest_metric_index()
        return {
            "own_accounts": [self._account_payload(account, "own", metrics) for account in own_accounts],
            "competitors": [self._account_payload(account, "competitor", metrics) for account in competitors],
        }

    def api_livedune_comparison(self) -> dict:
        config = read_config()
        rows = []
        metrics = self._latest_metric_index()
        for account in config.get("own_accounts", []):
            rows.extend(self._own_account_comparison_rows(account, metrics))
        for account in config.get("competitors", []):
            rows.append(self._comparison_row(account, "competitor", metrics))
        return {"rows": rows}

    def api_livedune_remote_accounts(self) -> dict:
        load_env()
        return LiveDuneClient().fetch_dashboard_accounts()

    def api_university_trends(self) -> dict:
        news = self.api_news({"limit": ["200"]})
        social = self.api_livedune_comparison().get("rows", [])
        return {
            "updated_at": _now_label(),
            "topics": _build_university_trends(news, social),
            "platforms": [
                {"name": "Instagram", "status": "live", "source": "LiveDune"},
                {"name": "TikTok", "status": "live", "source": "LiveDune"},
                {"name": "LinkedIn", "status": "live", "source": "LiveDune"},
                {"name": "Telegram", "status": "planned", "source": "Bot/API parser"},
                {"name": "VK", "status": "planned", "source": "VK API"},
                {"name": "Twitter/X", "status": "planned", "source": "X API / search provider"},
            ],
        }

    def api_kazakhstan_digest(self) -> dict:
        items = [item for item in self.api_news({"limit": ["300"]}) if (item.get("source") or "").startswith("Kazakhstan Media -")]
        by_source: dict[str, list[dict]] = {}
        for item in items:
            by_source.setdefault(item["source"], []).append(item)
        source_cards = []
        for source, source_items in sorted(by_source.items()):
            top_items = source_items[:5]
            source_cards.append(
                {
                    "source": source.replace("Kazakhstan Media - ", ""),
                    "count": len(source_items),
                    "top": top_items,
                    "summary": _digest_summary(top_items),
                }
            )
        return {
            "updated_at": _now_label(),
            "total": len(items),
            "sources": source_cards,
            "themes": _digest_themes(items),
            "top": items[:20],
        }

    def _latest_error_index(self) -> dict[tuple[str, str, str], dict]:
        index: dict[tuple[str, str, str], dict] = {}
        if not DB_PATH.exists():
            return index
        with connect() as connection:
            rows = connection.execute(
                """
                SELECT competitor, platform, handle, value, captured_at, raw
                FROM social_metrics
                WHERE metric = 'livedune_error'
                ORDER BY captured_at DESC
                """
            ).fetchall()
        for row in rows:
            key = (row["competitor"], row["platform"], row["handle"])
            if key not in index:
                raw = json.loads(row["raw"])
                index[key] = {
                    "status": int(row["value"]),
                    "captured_at": row["captured_at"],
                    "message": _friendly_livedune_error(int(row["value"]), raw),
                }
        return index

    def _latest_metric_index(self) -> dict[tuple[str, str, str], dict]:
        index: dict[tuple[str, str, str], dict] = {}
        for row in self.api_social():
            key = (row["competitor"], row["platform"], row["handle"])
            index.setdefault(key, {})[row["metric"]] = row
        return index

    def _account_payload(self, account: dict, account_type: str, metrics: dict) -> dict:
        errors = self._latest_error_index()
        social_accounts = []
        totals = {"followers": 0.0, "posts": 0.0, "likes": 0.0, "comments": 0.0}
        er_values = []
        has_live_data = False

        for social in account.get("social_accounts", []):
            key = (account["name"], social["platform"], social["handle"])
            metric_map = metrics.get(key, {})
            meaningful_metrics = {
                name: metric_map.get(name, {}).get("value")
                for name in ["followers", "engagement_rate", "posts", "likes", "comments"]
            }
            if any(isinstance(value, (int, float)) for value in meaningful_metrics.values()):
                has_live_data = True
            social_payload = {
                "platform": social["platform"],
                "handle": social["handle"],
                "account_id": social.get("account_id"),
                "metrics": meaningful_metrics,
                "error": errors.get(key),
                "captured_at": next((value.get("captured_at") for value in metric_map.values()), None),
            }
            social_accounts.append(social_payload)
            for name in totals:
                value = social_payload["metrics"].get(name)
                if isinstance(value, (int, float)):
                    totals[name] += value
            er = social_payload["metrics"].get("engagement_rate")
            if isinstance(er, (int, float)):
                er_values.append(er)

        return {
            "name": account["name"],
            "type": account_type,
            "website": account.get("website"),
            "has_live_data": has_live_data,
            "social_accounts": social_accounts,
            "summary": {
                "followers": totals["followers"] if has_live_data else None,
                "engagement_rate": round(sum(er_values) / len(er_values), 2) if er_values else None,
                "posts": totals["posts"] if has_live_data else None,
                "interactions": totals["likes"] + totals["comments"] if has_live_data else None,
            },
            "last_error": None if has_live_data else next((item["error"] for item in social_accounts if item.get("error")), None),
        }

    def _comparison_row(self, account: dict, account_type: str, metrics: dict) -> dict:
        payload = self._account_payload(account, account_type, metrics)
        summary = payload["summary"]
        return {
            "name": payload["name"],
            "type": account_type,
            "accounts": len(payload["social_accounts"]),
            "followers": summary["followers"],
            "engagement_rate": summary["engagement_rate"],
            "posts": summary["posts"],
            "interactions": summary["interactions"],
            "status": "connected" if payload["has_live_data"] else "api_error" if payload.get("last_error") else "waiting_for_livedune_data",
            "error": payload.get("last_error"),
        }

    def _own_account_comparison_rows(self, account: dict, metrics: dict) -> list[dict]:
        rows = []
        errors = self._latest_error_index()
        for social in account.get("social_accounts", []):
            key = (account["name"], social["platform"], social["handle"])
            metric_map = metrics.get(key, {})
            metric_values = {
                name: metric_map.get(name, {}).get("value")
                for name in ["followers", "engagement_rate", "posts", "likes", "comments"]
            }
            has_live_data = any(isinstance(value, (int, float)) for value in metric_values.values())
            error = errors.get(key)
            platform = str(social.get("platform") or "").title()
            handle = social.get("handle") or social.get("account_id") or "account"
            rows.append(
                {
                    "name": f"{account['name']} · {platform} @{handle}",
                    "brand": account["name"],
                    "platform": social.get("platform"),
                    "handle": social.get("handle"),
                    "account_id": social.get("account_id"),
                    "type": "own",
                    "accounts": 1,
                    "followers": metric_values["followers"] if has_live_data else None,
                    "engagement_rate": metric_values["engagement_rate"] if has_live_data else None,
                    "posts": metric_values["posts"] if has_live_data else None,
                    "interactions": None,
                    "status": "connected" if has_live_data else "api_error" if error else "waiting_for_livedune_data",
                    "error": error,
                }
            )
            if has_live_data:
                likes = metric_values["likes"] if isinstance(metric_values["likes"], (int, float)) else 0
                comments = metric_values["comments"] if isinstance(metric_values["comments"], (int, float)) else 0
                rows[-1]["interactions"] = likes + comments
        return rows

    def api_competitors(self) -> list[dict]:
        return read_config().get("competitors", [])

    def run_collect(self) -> None:
        load_env()
        try:
            result = subprocess.run(
                [sys.executable, "-m", "src.kau_agent.main", "collect", "--config", str(CONFIG_PATH)],
                cwd=ROOT,
                text=True,
                capture_output=True,
                timeout=100,
                check=False,
            )
            self.send_json(
                {
                    "ok": result.returncode == 0,
                    "returncode": result.returncode,
                    "stdout": result.stdout,
                    "stderr": result.stderr,
                }
            )
        except subprocess.TimeoutExpired as error:
            self.send_json({"ok": False, "error": f"Collection timed out: {error}"}, status=HTTPStatus.REQUEST_TIMEOUT)

    def serve_static(self, relative_path: str) -> None:
        safe_path = (STATIC_DIR / relative_path).resolve()
        if not str(safe_path).startswith(str(STATIC_DIR.resolve())) or not safe_path.exists():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        content_type = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
        }.get(safe_path.suffix, "application/octet-stream")
        payload = safe_path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def send_json(self, payload: object, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        print(f"{self.address_string()} - {format % args}")


def first(query: dict[str, list[str]], key: str) -> str | None:
    values = query.get(key)
    if not values:
        return None
    return values[0]


def _friendly_livedune_error(status: int, raw: dict) -> str:
    if status == 401:
        return "401: токен не принят LiveDune."
    if status == 403:
        return "403: API запретил доступ. Проверьте права API/тариф или точный метод из Swagger."
    if status == 404:
        return "404: endpoint или account_id не найден."
    if status == 429:
        return "429: превышен лимит API-запросов."
    return raw.get("error") or f"LiveDune API вернул {status}."


UNIVERSITY_TOPICS = {
    "AI в образовании": {
        "keywords": ["ai", "artificial intelligence", "chatgpt", "искусственный интеллект", "нейросет"],
        "audience": "абитуриенты, преподаватели, IT-программы, руководство",
        "opportunity": "контент про AI-компетенции, новые программы, карьерные траектории",
    },
    "Поступление и admissions": {
        "keywords": ["admission", "admissions", "enrollment", "entrance", "поступление", "ент", "прием"],
        "audience": "абитуриенты и родители",
        "opportunity": "лендинги, FAQ, short-video объяснения, прямые эфиры приемной комиссии",
    },
    "Карьера и рынок труда": {
        "keywords": ["career", "jobs", "employment", "labor", "рынок труда", "карьера", "работодател"],
        "audience": "старшекурсники, выпускники, работодатели",
        "opportunity": "истории выпускников, партнерства с компаниями, career center контент",
    },
    "Наука и исследования": {
        "keywords": ["research", "science", "исследован", "наука", "лаборатор"],
        "audience": "академическое сообщество, партнеры, грантодатели",
        "opportunity": "PR научных проектов, экспертные комментарии, публикации преподавателей",
    },
    "Студенческая жизнь": {
        "keywords": ["student", "campus", "club", "студен", "кампус", "клуб"],
        "audience": "абитуриенты, студенты, родители",
        "opportunity": "UGC, Reels/TikTok, день из жизни студента, кампусные события",
    },
    "Международные партнерства": {
        "keywords": ["international", "partnership", "exchange", "malaysia", "hong kong", "международ", "партнер"],
        "audience": "абитуриенты, родители, партнерские университеты",
        "opportunity": "показывать глобальную сеть KAU и международные возможности",
    },
}


def _build_university_trends(news: list[dict], social_rows: list[dict]) -> list[dict]:
    connected_competitors = [row for row in social_rows if row.get("status") == "connected" and row.get("type") == "competitor"]
    er_values = [row.get("engagement_rate") for row in connected_competitors if isinstance(row.get("engagement_rate"), (int, float))]
    avg_er = sum(er_values) / len(er_values) if er_values else 0

    topics = []
    for topic, meta in UNIVERSITY_TOPICS.items():
        matched = []
        for item in news:
            text = " ".join([item.get("title") or "", item.get("summary") or "", " ".join(item.get("tags") or [])]).lower()
            if any(keyword in text for keyword in meta["keywords"]):
                matched.append(item)
        mentions = len(matched)
        relevance = sum(int(item.get("relevance_score") or 0) for item in matched)
        signal = mentions + relevance / 10 + avg_er
        trend = "rising" if signal >= 14 else "stable" if signal >= 5 else "emerging"
        potential = "high" if trend == "rising" or mentions >= 5 else "medium" if trend == "stable" else "watch"
        topics.append(
            {
                "topic": topic,
                "trend": trend,
                "potential": potential,
                "mentions": mentions,
                "relevance": round(relevance, 1),
                "avg_competitor_er": round(avg_er, 2),
                "why": _trend_reason(mentions, relevance, avg_er),
                "who": meta["audience"],
                "forecast": _trend_forecast(trend),
                "action": meta["opportunity"],
            }
        )
    return sorted(topics, key=lambda item: (item["potential"] == "high", item["mentions"], item["relevance"]), reverse=True)


def _trend_reason(mentions: int, relevance: float, avg_er: float) -> str:
    if mentions:
        return f"Тема обнаружена в {mentions} релевантных материалах; суммарная релевантность {relevance}. Средний ER конкурентов: {avg_er:.2f}%."
    return "Пока мало прямых упоминаний, но тема входит в стратегическую карту университетского контента."


def _trend_forecast(trend: str) -> str:
    if trend == "rising":
        return "Вероятен рост обсуждений в ближайшие 1-2 недели; стоит готовить контент и PR-поводы."
    if trend == "stable":
        return "Тема держится в стабильном спросе; полезна для регулярного контент-плана."
    return "Следить за первыми сигналами и включать в мониторинг."


def _now_label() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


def _digest_summary(items: list[dict]) -> str:
    if not items:
        return "Нет новых материалов в выбранном источнике."
    titles = [item.get("title", "") for item in items[:3]]
    joined = "; ".join(title for title in titles if title)
    if not joined:
        return "Источник обновился, но заголовки не распознаны."
    return f"Главное: {joined}."


def _digest_themes(items: list[dict]) -> list[dict]:
    theme_keywords = {
        "Образование": ["образован", "университет", "школ", "студент", "education", "university"],
        "Карьера": ["работ", "вакан", "рынок труда", "career", "employment"],
        "Наука и технологии": ["наука", "ai", "технолог", "искусственный интеллект", "digital"],
        "Город и общество": ["алматы", "астана", "общество", "город", "акимат"],
        "Экономика": ["эконом", "бизнес", "тенге", "рынок", "капитал"],
        "Инциденты": ["происшеств", "дтп", "суд", "полици", "incidents"],
    }
    result = []
    for theme, keywords in theme_keywords.items():
        matched = []
        for item in items:
            text = " ".join([item.get("title") or "", item.get("summary") or ""]).lower()
            if any(keyword in text for keyword in keywords):
                matched.append(item)
        if matched:
            result.append(
                {
                    "theme": theme,
                    "count": len(matched),
                    "relevance": sum(int(item.get("relevance_score") or 0) for item in matched),
                    "recommendation": _theme_recommendation(theme),
                }
            )
    return sorted(result, key=lambda item: (item["count"], item["relevance"]), reverse=True)


def _theme_recommendation(theme: str) -> str:
    recommendations = {
        "Образование": "Использовать как повод для экспертного комментария KAU и admissions-контента.",
        "Карьера": "Связать с программами, выпускниками и career center.",
        "Наука и технологии": "Подготовить позицию KAU по AI/tech и показать релевантные программы.",
        "Город и общество": "Искать локальные поводы для кампусной и студенческой повестки.",
        "Экономика": "Связать с бизнес-образованием, предпринимательством и рынком труда.",
        "Инциденты": "Мониторить репутационные риски и избегать неуместной коммуникации.",
    }
    return recommendations.get(theme, "Отслеживать динамику и оценить релевантность для контент-плана.")


def main() -> None:
    load_env()
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT") or os.getenv("KAU_DASHBOARD_PORT", "8899"))
    server = ThreadingHTTPServer((host, port), DashboardHandler)
    print(f"KAU dashboard running at http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
