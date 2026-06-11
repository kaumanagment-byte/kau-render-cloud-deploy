import argparse
from pathlib import Path
from urllib.parse import quote_plus

from .analysis import score_item
from .config import load_config, load_dotenv, project_root
from .reporting import write_briefing
from .sources.gdelt import search_gdelt
from .sources.html_news import fetch_html_news
from .sources.livedune import LiveDuneClient
from .sources.rss import fetch_rss
from .storage import Store


KAU_BRAND_QUERIES = [
    '"KAU Kazakh-American University"',
    '"KAU Kazakh American University"',
    '"Kazakh-American University"',
    '"Kazakh American University"',
    '"Kazakh-American University" "Almaty"',
    '"Kazakh American University" "Almaty"',
    '"Kazakh-American University" "Kazakhstan"',
    '"Kazakh American University" "Kazakhstan"',
    '"KAU" "Kazakhstan" "University"',
    '"KAU" "Almaty" "University"',
    '"kau.kz"',
    '"КАУ" "Казахско-Американский"',
    '"КАУ" "Казахско Американский"',
    '"Казахско-Американский университет"',
    '"Казахско Американский университет"',
    '"Казахско-Американский университет" "Алматы"',
    '"Қазақ-Американ университеті"',
    '"Қазақ Американ университеті"',
    '"Қазақстан-Американ университеті"',
    '"Қазақстан Американ университеті"',
]


def collect(config_path: str) -> None:
    config = load_config(config_path)
    root = project_root()
    load_dotenv(root)
    store = Store(root / "data.sqlite")
    competitors = config.get("competitors", [])
    own_accounts = config.get("own_accounts", [])
    competitor_names = [competitor["name"] for competitor in competitors]
    weights = config.get("relevance_weights", {})
    collection = config.get("collection", {})
    rss_timeout = int(collection.get("rss_timeout_seconds", 8))
    gdelt_timeout = int(collection.get("gdelt_timeout_seconds", 8))
    gdelt_max_records = int(collection.get("gdelt_max_records_per_query", 5))
    gdelt_max_queries = int(collection.get("gdelt_max_queries_per_run", 8))

    news_items = []

    for feed in config.get("rss_feeds", []):
        try:
            news_items.extend(fetch_rss(feed["name"], feed["url"], timeout=rss_timeout))
        except Exception as error:
            print(f"RSS failed for {feed['name']}: {str(error).encode('utf-8', 'replace').decode('utf-8')}")

    for query in KAU_BRAND_QUERIES:
        try:
            url = f"https://news.google.com/rss/search?q={quote_plus(query)}&hl=ru&gl=KZ&ceid=KZ:ru"
            news_items.extend(fetch_rss(f"Google News - KAU - {query}", url, timeout=rss_timeout))
        except Exception as error:
            print(f"Google News KAU failed for {query}: {str(error).encode('utf-8', 'replace').decode('utf-8')}")

    for source in config.get("html_sources", []):
        try:
            news_items.extend(fetch_html_news(source["name"], source["url"], timeout=rss_timeout, limit=int(source.get("limit", 20))))
        except Exception as error:
            print(f"HTML source failed for {source['name']}: {str(error).encode('utf-8', 'replace').decode('utf-8')}")

    brand_queries = list(dict.fromkeys(config.get("brand_queries", []) + KAU_BRAND_QUERIES))
    market_queries = config.get("market", {}).get("priority_keywords", [])[:gdelt_max_queries]
    for query in brand_queries + market_queries:
        try:
            news_items.extend(search_gdelt(query, max_records=gdelt_max_records, timeout=gdelt_timeout))
        except Exception as error:
            print(f"GDELT failed for {query}: {str(error).encode('utf-8', 'replace').decode('utf-8')}")

    scored = [score_item(item, weights, competitor_names) for item in news_items]
    saved_news = store.save_news(scored)

    livedune = LiveDuneClient()
    social_metrics = livedune.fetch_competitor_metrics(own_accounts + competitors)
    saved_metrics = store.save_social_metrics(social_metrics)

    print(f"Collected {len(scored)} news items, saved {saved_news} new items.")
    print(f"Saved {saved_metrics} LiveDune social metrics.")


def report(config_path: str) -> None:
    _ = load_config(config_path)
    root = project_root()
    store = Store(root / "data.sqlite")
    output = write_briefing(
        news=store.top_news(limit=30),
        social_metrics=store.recent_social_metrics(limit=100),
        output_path=root / "reports" / "latest-briefing.md",
    )
    print(f"Report written to {output}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="KAU market intelligence agent")
    subparsers = parser.add_subparsers(dest="command", required=True)

    collect_parser = subparsers.add_parser("collect", help="Collect news, mentions, and social metrics")
    collect_parser.add_argument("--config", default=str(Path("config.example.json")))

    report_parser = subparsers.add_parser("report", help="Generate latest briefing")
    report_parser.add_argument("--config", default=str(Path("config.example.json")))

    return parser


def main() -> None:
    args = build_parser().parse_args()
    if args.command == "collect":
        collect(args.config)
    elif args.command == "report":
        report(args.config)


if __name__ == "__main__":
    main()
