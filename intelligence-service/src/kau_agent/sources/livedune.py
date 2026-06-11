import json
import os
from datetime import date, timedelta
from urllib.error import HTTPError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

from ..models import SocialMetric


class LiveDuneClient:
    """LiveDune API adapter.

    Real API docs use query auth: ?access_token=...
    Main flow:
    - GET /accounts
    - GET /accounts/{accountId}/analytics?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
    """

    def __init__(self, token: str | None = None, base_url: str | None = None):
        self.token = token or os.getenv("LIVEDUNE_API_TOKEN")
        self.base_url = (base_url or os.getenv("LIVEDUNE_BASE_URL") or "https://api.livedune.com").rstrip("/")
        self.accounts_endpoint = os.getenv("LIVEDUNE_ACCOUNTS_ENDPOINT", "/accounts")
        self.stats_endpoint = os.getenv("LIVEDUNE_STATS_ENDPOINT", "/accounts/{account_id}/analytics")
        self.auth_mode = os.getenv("LIVEDUNE_AUTH_MODE", "query")
        self.auth_scheme = os.getenv("LIVEDUNE_AUTH_SCHEME", "Bearer")
        self.token_param = os.getenv("LIVEDUNE_TOKEN_PARAM", "access_token")

    def enabled(self) -> bool:
        return bool(self.token)

    def fetch_competitor_metrics(self, competitors: list[dict]) -> list[SocialMetric]:
        if not self.enabled():
            return []

        dashboard_accounts = self._safe_dashboard_accounts()
        metrics: list[SocialMetric] = []
        for competitor in competitors:
            for account in competitor.get("social_accounts", []):
                matched = self._match_dashboard_account(account, dashboard_accounts)
                account_payload = dict(account)
                if matched and matched.get("id"):
                    account_payload["account_id"] = matched["id"]
                    account_payload["dashboard_account"] = matched
                metrics.extend(self._fetch_account_metrics(competitor=competitor["name"], account=account_payload))
        return metrics

    def fetch_dashboard_accounts(self) -> dict:
        if not self.enabled():
            return {"ok": False, "error": "LIVEDUNE_API_TOKEN is not configured"}
        try:
            return {"ok": True, "payload": self._request_json(self.accounts_endpoint, {})}
        except HTTPError as error:
            return {"ok": False, "status": error.code, "error": str(error)}
        except Exception as error:
            return {"ok": False, "error": str(error)}

    def _safe_dashboard_accounts(self) -> list[dict]:
        result = self.fetch_dashboard_accounts()
        if not result.get("ok"):
            return []
        payload = result.get("payload")
        if isinstance(payload, dict) and isinstance(payload.get("response"), list):
            return payload["response"]
        if isinstance(payload, list):
            return payload
        return []

    def _fetch_account_metrics(self, competitor: str, account: dict) -> list[SocialMetric]:
        platform = account["platform"]
        handle = account["handle"]
        account_id = account.get("account_id") or account.get("id")
        if not account_id:
            return [
                SocialMetric(
                    competitor=competitor,
                    platform=platform,
                    handle=handle,
                    metric="livedune_error",
                    value=404.0,
                    raw={"error": "LiveDune account_id not found. Add account_id or connect/match account on dashboard."},
                )
            ]

        today = date.today()
        path = self.stats_endpoint.format(account_id=account_id, accountId=account_id)
        query_payload = {
            "date_from": os.getenv("LIVEDUNE_DATE_FROM", (today - timedelta(days=30)).isoformat()),
            "date_to": os.getenv("LIVEDUNE_DATE_TO", today.isoformat()),
        }

        try:
            payload = self._request_json(path, query_payload)
        except HTTPError as error:
            return [
                SocialMetric(
                    competitor=competitor,
                    platform=platform,
                    handle=handle,
                    metric="livedune_error",
                    value=float(error.code),
                    raw={"error": str(error), "status": error.code},
                )
            ]

        return _normalize_metrics(competitor, platform, handle, payload)

    def _request_json(self, path: str, query_payload: dict) -> dict:
        query = dict(query_payload)
        headers = {
            "Accept": "application/json",
            "User-Agent": "KAU-Market-Agent/0.1",
        }
        if self.auth_mode == "query":
            query[self.token_param] = self.token
        else:
            headers["Authorization"] = f"{self.auth_scheme} {self.token}"

        encoded = urlencode(query)
        url = f"{self.base_url}{path}"
        if encoded:
            url = f"{url}?{encoded}"
        request = Request(url, headers=headers)
        with urlopen(request, timeout=25) as response:
            return json.loads(response.read().decode("utf-8"))

    def _match_dashboard_account(self, account: dict, dashboard_accounts: list[dict]) -> dict | None:
        handle = _normalize_handle(account.get("handle", ""))
        platform = _normalize_platform(account.get("platform", ""))

        for candidate in dashboard_accounts:
            candidate_type = _normalize_platform(str(candidate.get("type", "")))
            candidate_handle = _normalize_handle(str(candidate.get("short_name") or candidate.get("name") or ""))
            candidate_url_handle = _normalize_handle(_last_url_part(str(candidate.get("url") or "")))
            if platform and platform not in candidate_type:
                continue
            if handle and handle in {candidate_handle, candidate_url_handle}:
                return candidate

        for candidate in dashboard_accounts:
            candidate_text = " ".join(str(candidate.get(key, "")) for key in ("short_name", "name", "url")).lower()
            if handle and handle in candidate_text:
                return candidate
        return None


def _normalize_metrics(competitor: str, platform: str, handle: str, payload: dict) -> list[SocialMetric]:
    data = payload.get("response") if isinstance(payload.get("response"), dict) else payload
    metric_map = {
        "followers": ["followers", "subscribers", "followers_count"],
        "engagement_rate": ["engagement_rate", "er", "er_day"],
        "posts": ["posts", "posts_count"],
        "likes": ["likes", "likes_count"],
        "comments": ["comments", "comments_count"],
        "views": ["views", "views_count"],
        "reposts": ["reposts", "shares"],
    }
    metrics: list[SocialMetric] = []
    for metric_name, aliases in metric_map.items():
        value = _first_number(data, aliases)
        if value is not None:
            metrics.append(
                SocialMetric(
                    competitor=competitor,
                    platform=platform,
                    handle=handle,
                    metric=metric_name,
                    value=value,
                    raw=payload,
                )
            )
    return metrics


def _first_number(payload: dict, aliases: list[str]) -> float | None:
    for alias in aliases:
        value = payload.get(alias)
        if isinstance(value, (int, float)):
            return float(value)
    data = payload.get("data")
    if isinstance(data, dict):
        for alias in aliases:
            value = data.get(alias)
            if isinstance(value, (int, float)):
                return float(value)
    return None


def _normalize_handle(value: str) -> str:
    value = value.strip().lower().lstrip("@")
    return value.replace("https://", "").replace("http://", "").rstrip("/")


def _normalize_platform(value: str) -> str:
    value = value.lower()
    aliases = {
        "inst": "instagram",
        "ig": "instagram",
        "fb": "facebook",
        "tt": "tiktok",
        "yt": "youtube",
    }
    for source, target in aliases.items():
        value = value.replace(source, target)
    return value


def _last_url_part(value: str) -> str:
    if not value:
        return ""
    path = urlparse(value).path.strip("/")
    if not path:
        return value
    return path.split("/")[-1]
