import html
import re


TAG_RE = re.compile(r"<[^>]+>")


def clean_text(value: str | None) -> str | None:
    if value is None:
        return None
    text = html.unescape(value)
    text = TAG_RE.sub(" ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return repair_mojibake(text)


def repair_mojibake(value: str) -> str:
    markers = ("Р", "С", "вЂ", "В«", "В»")
    if not any(marker in value for marker in markers):
        return value

    candidates = [value]
    for encoding in ("cp1251", "latin1"):
        try:
            candidates.append(value.encode(encoding).decode("utf-8"))
        except UnicodeError:
            continue

    return min(candidates, key=_mojibake_score)


def _mojibake_score(value: str) -> int:
    return sum(value.count(marker) for marker in ("Р", "С", "вЂ", "В«", "В»", "�"))

