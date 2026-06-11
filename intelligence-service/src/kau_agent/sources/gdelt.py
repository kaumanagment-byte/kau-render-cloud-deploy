import json
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from ..models import NewsItem


GDELT_DOC_API = "https://api.gdeltproject.org/api/v2/doc/doc"


def search_gdelt(query: str, max_records: int = 25, timeout: int = 20) -> list[NewsItem]:
    params = urlencode(
        {
            "query": query,
            "mode": "artlist",
            "format": "json",
            "maxrecords": max_records,
            "sort": "hybridrel",
        }
    )
    request = Request(f"{GDELT_DOC_API}?{params}", headers={"User-Agent": "KAU-Market-Agent/0.1"})
    with urlopen(request, timeout=timeout) as response:
        payload = json.loads(response.read().decode("utf-8"))

    items: list[NewsItem] = []
    for article in payload.get("articles", []):
        title = article.get("title")
        url = article.get("url")
        if not title or not url:
            continue
        items.append(
            NewsItem(
                source=f"GDELT: {query}",
                title=title,
                url=url,
                published_at=article.get("seendate"),
                summary=article.get("snippet"),
                language=article.get("language"),
                raw=article,
            )
        )
    return items

