from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen
from html.parser import HTMLParser

from ..models import NewsItem
from ..text_utils import clean_text


class LinkExtractor(HTMLParser):
    def __init__(self, base_url: str):
        super().__init__()
        self.base_url = base_url
        self.links: list[tuple[str, str]] = []
        self._href: str | None = None
        self._parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "a":
            return
        attrs_map = dict(attrs)
        href = attrs_map.get("href")
        if href:
            self._href = urljoin(self.base_url, href)
            self._parts = []

    def handle_data(self, data: str) -> None:
        if self._href:
            self._parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag != "a" or not self._href:
            return
        title = clean_text(" ".join(self._parts))
        if title and len(title) >= 24:
            self.links.append((title, self._href))
        self._href = None
        self._parts = []


def fetch_html_news(source_name: str, url: str, timeout: int = 20, limit: int = 20) -> list[NewsItem]:
    request = Request(url, headers={"User-Agent": "KAU-Market-Agent/0.1"})
    with urlopen(request, timeout=timeout) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        html = response.read().decode(charset, errors="replace")

    parser = LinkExtractor(url)
    parser.feed(html)
    host = urlparse(url).netloc
    seen: set[str] = set()
    items: list[NewsItem] = []
    for title, link in parser.links:
        parsed = urlparse(link)
        if parsed.netloc and parsed.netloc != host:
            continue
        if link in seen or _looks_like_nav(title, link):
            continue
        seen.add(link)
        items.append(
            NewsItem(
                source=source_name,
                title=title,
                url=link,
                summary=None,
                raw={"html_source_url": url},
            )
        )
        if len(items) >= limit:
            break
    return items


def _looks_like_nav(title: str, link: str) -> bool:
    text = title.lower()
    blocked = ["facebook", "instagram", "telegram", "whatsapp", "подпис", "реклама", "войти", "регистрация"]
    if any(word in text for word in blocked):
        return True
    path = urlparse(link).path.strip("/")
    return not path or path in {"ru", "kz", "en"}
