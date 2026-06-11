from email.utils import parsedate_to_datetime
import re
from urllib.request import Request, urlopen
from xml.etree import ElementTree

from ..models import NewsItem
from ..text_utils import clean_text


def fetch_rss(feed_name: str, url: str, timeout: int = 20) -> list[NewsItem]:
    request = Request(url, headers={"User-Agent": "KAU-Market-Agent/0.1"})
    with urlopen(request, timeout=timeout) as response:
        payload = response.read()

    try:
        root = ElementTree.fromstring(payload)
    except ElementTree.ParseError:
        return _fetch_rss_loose(feed_name, url, payload)
    items: list[NewsItem] = []

    for node in root.findall(".//item"):
        title = clean_text(_text(node, "title"))
        link = _text(node, "link")
        published = _text(node, "pubDate")
        summary = clean_text(_text(node, "description"))
        published_at = None
        if published:
            try:
                published_at = parsedate_to_datetime(published).isoformat()
            except (TypeError, ValueError):
                published_at = published

        if title and link:
            items.append(
                NewsItem(
                    source=feed_name,
                    title=title,
                    url=link,
                    published_at=published_at,
                    summary=summary,
                    raw={"feed_url": url},
                )
            )
    return items


def _text(node: ElementTree.Element, tag: str) -> str | None:
    child = node.find(tag)
    if child is None or child.text is None:
        return None
    return child.text.strip()


def _fetch_rss_loose(feed_name: str, url: str, payload: bytes) -> list[NewsItem]:
    text = payload.decode("utf-8", errors="replace")
    items: list[NewsItem] = []
    for match in re.finditer(r"<item\b.*?</item>", text, flags=re.IGNORECASE | re.DOTALL):
        block = match.group(0)
        title = clean_text(_tag_text(block, "title"))
        link = clean_text(_tag_text(block, "link"))
        published = clean_text(_tag_text(block, "pubDate"))
        summary = clean_text(_tag_text(block, "description"))
        published_at = None
        if published:
            try:
                published_at = parsedate_to_datetime(published).isoformat()
            except (TypeError, ValueError):
                published_at = published
        if title and link:
            items.append(
                NewsItem(
                    source=feed_name,
                    title=title,
                    url=link,
                    published_at=published_at,
                    summary=summary,
                    raw={"feed_url": url, "parser": "loose"},
                )
            )
    return items


def _tag_text(block: str, tag: str) -> str | None:
    match = re.search(rf"<{tag}\b[^>]*>(.*?)</{tag}>", block, flags=re.IGNORECASE | re.DOTALL)
    if not match:
        return None
    value = match.group(1)
    value = re.sub(r"<!\[CDATA\[(.*?)\]\]>", r"\1", value, flags=re.DOTALL)
    return value.strip()
