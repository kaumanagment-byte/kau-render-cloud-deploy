from .models import NewsItem


KEYWORD_GROUPS = {
    "kazakhstan": ["kazakhstan", "казахстан", "қазақстан", "almaty", "алматы", "astana", "астана"],
    "kau_brand": ["kau kazakh-american", "kazakh-american university", "kazakh american university", "казахско-американ"],
    "education": ["university", "education", "higher education", "университет", "образование", "білім"],
    "ai": ["artificial intelligence", "ai", "искусственный интеллект", "нейросет", "chatgpt"],
    "admissions": ["admission", "enrollment", "абитуриент", "поступление", "приемная комиссия"],
    "labor_market": ["labor market", "jobs", "employment", "рынок труда", "вакансии", "работодател"],
}

KAU_BRAND_VARIANTS = [
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

KEYWORD_GROUPS["kau_brand"] = sorted(set(KEYWORD_GROUPS.get("kau_brand", []) + KAU_BRAND_VARIANTS))


def score_item(item: NewsItem, weights: dict[str, int], competitor_names: list[str]) -> NewsItem:
    text = " ".join([item.title or "", item.summary or ""]).lower()
    tags: list[str] = []
    score = 0

    for group, keywords in KEYWORD_GROUPS.items():
        if any(keyword in text for keyword in keywords):
            tags.append(group)
            score += int(weights.get(group, 1))

    for competitor in competitor_names:
        if competitor.lower() in text:
            tags.append("competitor")
            score += int(weights.get("competitor", 1))
            break

    item.tags = sorted(set(tags))
    item.relevance_score = score
    return item


def summarize_signals(items: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for item in items:
        for tag in item.get("tags", []):
            counts[tag] = counts.get(tag, 0) + 1
    return dict(sorted(counts.items(), key=lambda pair: pair[1], reverse=True))
