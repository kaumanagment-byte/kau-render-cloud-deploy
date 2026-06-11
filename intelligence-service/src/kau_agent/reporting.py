from datetime import datetime, timezone
from pathlib import Path

from .analysis import summarize_signals
from .text_utils import clean_text


def write_briefing(news: list[dict], social_metrics: list[dict], output_path: str | Path) -> Path:
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)

    signal_counts = summarize_signals(news)
    lines = [
        "# KAU Market Intelligence Briefing",
        "",
        f"Generated: {datetime.now(timezone.utc).isoformat()}",
        "",
        "## Executive Signals",
        "",
    ]

    if signal_counts:
        for tag, count in signal_counts.items():
            lines.append(f"- {tag}: {count} relevant items")
    else:
        lines.append("- No strong signals yet. Run collection again or add more sources.")

    lines.extend(["", "## Top News And Mentions", ""])
    if news:
        for item in news:
            tags = ", ".join(item["tags"]) if item["tags"] else "untagged"
            title = clean_text(item["title"]) or item["title"]
            source = clean_text(item["source"]) or item["source"]
            summary = clean_text(item.get("summary"))
            lines.extend(
                [
                    f"### {title}",
                    f"- Source: {source}",
                    f"- Relevance: {item['relevance_score']} ({tags})",
                    f"- Published: {item.get('published_at') or 'unknown'}",
                    f"- URL: {item['url']}",
                    "",
                ]
            )
            if summary:
                lines.extend([summary, ""])
    else:
        lines.append("No news items stored yet.")

    lines.extend(["", "## Competitor Social Metrics", ""])
    if social_metrics:
        lines.append("| Competitor | Platform | Handle | Metric | Value | Captured |")
        lines.append("|---|---|---|---|---:|---|")
        for metric in social_metrics:
            lines.append(
                "| {competitor} | {platform} | {handle} | {metric} | {value} | {captured_at} |".format(
                    **metric
                )
            )
    else:
        lines.append("No LiveDune metrics captured yet. Set LIVEDUNE_API_TOKEN and confirm endpoint mapping.")

    lines.extend(
        [
            "",
            "## Suggested Next Actions",
            "",
            "- Review high-relevance KAU mentions for PR response or amplification.",
            "- Compare competitor engagement spikes against their admissions and campaign calendar.",
            "- Add direct RSS feeds for Kazakhstan media and education regulators.",
            "- Connect paid search/news APIs for broader global coverage.",
        ]
    )

    output.write_text("\n".join(lines), encoding="utf-8")
    return output
