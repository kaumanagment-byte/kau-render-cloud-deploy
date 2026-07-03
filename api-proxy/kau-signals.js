const fs = require("node:fs");
const path = require("node:path");

const CACHE_SECONDS = Number(process.env.KAU_SIGNALS_CACHE_SECONDS || 14400);
const REQUEST_TIMEOUT_MS = Number(process.env.KAU_SIGNALS_TIMEOUT_MS || 20000);
const HISTORY_DIR = path.join(__dirname, "data");
const HISTORY_FILE = path.join(HISTORY_DIR, "kau-signals-history.json");

const KEYWORD_GROUPS = {
  brand_ru: [
    "Казахско-Американский Университет",
    "Казахско-Американский университет",
    "Казахско Американский Университет",
    "Казахско Американский университет",
    "Казахстанско-Американский университет",
    "Казахстанский Американский университет",
    "Казахско-Американский университет в Алматы",
    "Казахстанско-Американский университет в Алматы",
  ],
  brand_en: [
    "Kazakh American University",
    "Kazakh-American University",
    "Kazakh American University Almaty",
    "Kazakh-American University Almaty",
    "Kazakh American University Kazakhstan",
    "Kazakh-American University Kazakhstan",
  ],
  brand_kz: [
    "Қазақ-Америка университеті",
    "Қазақ Америка университеті",
    "Қазақ-Американ университеті",
    "Қазақ Американ университеті",
    "Қазақ-Американдық университеті",
    "Қазақ Американдық университеті",
    "Қазақ-Америка университеті Алматы",
    "Қазақ-Американдық университеті Алматы",
  ],
  short: ["KAU", "КАУ", "ҚАУ", "kau.kz", "kau.edu.kz", "@kau.kz"],
  admission: [
    "КАУ прием",
    "КАУ приемная комиссия",
    "КАУ поступление",
    "КАУ абитуриент",
    "ҚАУ қабылдау",
    "ҚАУ қабылдау комиссиясы",
    "ҚАУ талапкер",
    "KAU admission",
    "KAU admissions",
    "KAU admission 2026",
    "Kazakh American University admissions",
    "Kazakh-American University admissions",
    "Қазақ-Америка университеті қабылдау",
    "Қазақ-Американдық университеті қабылдау",
  ],
  leaders: [
    "Исахов Асылбек",
    "Асылбек Исахов",
    "Исахов Асылбек Абдиашимович",
    "Асылбек Абдиашимович Исахов",
    "Isakhov Asylbek",
    "Asylbek Isakhov",
    "Asylbek Abdishimovich Isakhov",
    "Амирлан Кусаинов",
    "Кусаинов Амирлан",
    "Amirlan Kussainov",
    "Amirlan Kusainov",
    "Kussainov Amirlan",
    "Kusainov Amirlan",
  ],
  related_orgs: [
    "Международная Образовательная Корпорация",
    "МОК",
    "IEC",
    "International Educational Corporation",
    "KazGASA",
    "КазГАСА",
    "ҚазБСҚА",
    "KAU IEC",
    "КАУ МОК",
    "Kazakh American University IEC",
    "Казахско-Американский Университет МОК",
  ],
};

const CONTEXT_WORDS = [
  "Almaty", "Алматы", "Kazakhstan", "Казахстан", "университет", "university",
  "қабылдау", "admission", "admissions", "student", "студент", "талапкер",
  "абитуриент", "kau.kz", "kazakh",
];

const EXCLUDED_WORDS = [
  "King Abdulaziz University",
  "King Abdulaziz",
  "Saudi",
  "Jeddah",
  "KAUST",
  "Korea Aerospace University",
  "Karnavati University",
  "Kerala Agricultural University",
];

const ALERT_WORDS = [
  "скандал", "жалоба", "проблема", "суд", "лицензия", "проверка", "штраф", "недовольны", "обман", "негатив",
  "рейдерство", "закрытие", "отказ", "талап", "шағым", "мәселе", "сот", "тексеру", "айыппұл",
  "complaint", "scandal", "lawsuit", "license", "problem", "negative", "fraud", "investigation",
];

const RSS_QUERIES = [
  { key: "brand", label: "Бренд KAU", q: `"Kazakh American University" OR "Kazakh-American University" OR "Казахско-Американский Университет" OR "Қазақ-Америка университеті" OR "kau.edu.kz"` },
  { key: "abbr", label: "KAU / КАУ", q: `"KAU" OR "КАУ" OR "ҚАУ" OR "kau.kz" OR "@kau.kz"` },
  { key: "admission", label: "Прием / admissions", q: `"KAU admission" OR "КАУ поступление" OR "КАУ приемная комиссия" OR "ҚАУ қабылдау" OR "Kazakh American University admissions"` },
  { key: "leaders", label: "Руководство", q: `"Исахов Асылбек" OR "Asylbek Isakhov" OR "Амирлан Кусаинов" OR "Amirlan Kussainov"` },
  { key: "related", label: "Связанные организации", q: `"KAU IEC" OR "КАУ МОК" OR "International Educational Corporation" OR "KazGASA" OR "КазГАСА"` },
];

let cache = null;

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeXml(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(value, limit = 320) {
  const text = String(value || "").trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function fetchText(url, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "KAU-Signals/1.0",
        "Accept-Language": "ru,en;q=0.8",
      },
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function parseRssItems(xml, sourceLabel) {
  const items = [];
  const matches = xml.match(/<item>([\s\S]*?)<\/item>/gi) || [];
  for (const raw of matches) {
    const title = decodeXml((raw.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || "");
    const link = decodeXml((raw.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || "");
    const description = stripHtml(decodeXml((raw.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || ""));
    const pubDate = decodeXml((raw.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || "");
    const source = decodeXml((raw.match(/<source[^>]*>([\s\S]*?)<\/source>/i) || [])[1] || sourceLabel || "Google News");
    if (!title || !link) continue;
    items.push({
      title: stripHtml(title),
      url: link,
      summary: clip(description, 400),
      published_at: parseDate(pubDate)?.toISOString() || null,
      source,
      sourceLabel,
    });
  }
  return items;
}

function findMatchedKeywords(text) {
  const normalized = normalize(text);
  const matched = [];
  for (const words of Object.values(KEYWORD_GROUPS)) {
    for (const word of words) {
      if (normalized.includes(normalize(word))) matched.push(word);
    }
  }
  return [...new Set(matched)];
}

function detectLanguage(text) {
  const value = String(text || "");
  if (/[ҚқҒғӘәІіҢңҰұҮүҺһ]/.test(value)) return "KZ";
  if (/[А-Яа-я]/.test(value)) return "RU";
  return "EN";
}

function categorize(text, matchedKeywords, alertMatched) {
  const normalized = normalize(text);
  if (alertMatched.length) return "Негатив / риск";
  if (matchedKeywords.some((word) => KEYWORD_GROUPS.admission.includes(word))) return "Приемная комиссия / набор";
  if (matchedKeywords.some((word) => KEYWORD_GROUPS.leaders.includes(word))) return "Руководство";
  if (matchedKeywords.some((word) => KEYWORD_GROUPS.related_orgs.includes(word))) return "Партнерства";
  if (normalized.includes("event") || normalized.includes("мероприят") || normalized.includes("форум") || normalized.includes("конференц")) return "Мероприятия";
  if (normalized.includes("international") || normalized.includes("международ")) return "Международка";
  if (normalized.includes("pr") || normalized.includes("сми") || normalized.includes("news")) return "СМИ / PR";
  if (normalized.includes("university") || normalized.includes("университет")) return "Бренд КАУ";
  return "Другое";
}

function computeScore(item) {
  const haystack = `${item.title} ${item.summary} ${item.url} ${item.source}`.trim();
  const normalized = normalize(haystack);
  const matchedKeywords = findMatchedKeywords(haystack);
  const alertMatched = ALERT_WORDS.filter((word) => normalized.includes(normalize(word)));
  let score = 0;

  if (
    normalized.includes(normalize("Kazakh American University")) ||
    normalized.includes(normalize("Kazakh-American University")) ||
    normalized.includes(normalize("Казахско-Американский Университет")) ||
    normalized.includes(normalize("Қазақ-Америка университеті"))
  ) score += 80;

  if (normalized.includes("kau.kz") || normalized.includes("kau.edu.kz")) score += 90;

  if (matchedKeywords.some((word) => ["KAU", "КАУ", "ҚАУ"].includes(word))) score += 30;

  if (CONTEXT_WORDS.some((word) => normalized.includes(normalize(word)))) score += 25;

  if (["университет", "university", "қабылдау", "admission"].some((word) => normalized.includes(normalize(word)))) score += 20;

  if (matchedKeywords.some((word) => KEYWORD_GROUPS.leaders.includes(word))) score += 20;

  if (EXCLUDED_WORDS.some((word) => normalized.includes(normalize(word)))) score -= 100;

  if (
    matchedKeywords.length === 1 &&
    ["KAU", "КАУ", "ҚАУ"].includes(matchedKeywords[0]) &&
    !CONTEXT_WORDS.some((word) => normalized.includes(normalize(word)))
  ) score = Math.min(score, 20);

  score = Math.max(0, Math.min(100, score));
  const category = categorize(haystack, matchedKeywords, alertMatched);
  const priority = alertMatched.length && score >= 40 ? "Высокий риск" : score >= 70 ? "Высокая релевантность" : score >= 40 ? "Проверить вручную" : "Мусор";

  return {
    score,
    matchedKeywords,
    alertMatched,
    language: detectLanguage(haystack),
    category,
    priority,
  };
}

function buildSummary(item, meta) {
  const pieces = [];
  if (meta.category) pieces.push(`Категория: ${meta.category}.`);
  if (meta.matchedKeywords.length) pieces.push(`Найдены теги: ${meta.matchedKeywords.slice(0, 4).join(", ")}.`);
  if (meta.alertMatched.length) pieces.push(`Тревожные слова: ${meta.alertMatched.join(", ")}.`);
  pieces.push(clip(item.summary || item.title, 180));
  return pieces.join(" ");
}

function buildTrends(items) {
  const categoryMap = new Map();
  for (const item of items) {
    const key = item.category;
    const row = categoryMap.get(key) || { topic: key, mentions: 0, relevance: 0, risk: 0 };
    row.mentions += 1;
    row.relevance += Number(item.relevance_score || 0);
    if (item.priority === "Высокий риск") row.risk += 1;
    categoryMap.set(key, row);
  }
  return [...categoryMap.values()]
    .map((row) => ({
      topic: row.topic,
      mentions: row.mentions,
      trend: row.risk > 0 ? "risk" : row.mentions >= 3 ? "hot" : "watch",
      relevance: Math.round(row.relevance / Math.max(1, row.mentions)),
      potential: row.risk > 0 ? "high" : row.mentions >= 3 ? "medium" : "low",
      action: row.risk > 0
        ? "Проверить вручную и уведомить команду сразу."
        : row.mentions >= 3
          ? "Вынести в приоритет на мониторинг и контент."
          : "Оставить в наблюдении.",
    }))
    .sort((a, b) => b.mentions - a.mentions || b.relevance - a.relevance);
}

function buildDigest(items) {
  const sourceMap = new Map();
  for (const item of items) {
    const row = sourceMap.get(item.source) || { source: item.source, count: 0, score: 0 };
    row.count += 1;
    row.score += Number(item.relevance_score || 0);
    sourceMap.set(item.source, row);
  }
  return [...sourceMap.values()]
    .map((row) => ({
      source: row.source,
      count: row.count,
      summary: `Средняя релевантность ${Math.round(row.score / Math.max(1, row.count))}`,
    }))
    .sort((a, b) => b.count - a.count);
}

function readHistory() {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return [];
    const raw = fs.readFileSync(HISTORY_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeHistory(items) {
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
  const oldItems = readHistory();
  const merged = new Map();
  for (const item of [...oldItems, ...items]) {
    const key = item.url || item.title;
    if (!key) continue;
    merged.set(key, item);
  }
  const rows = [...merged.values()]
    .sort((a, b) => String(b.found_at || "").localeCompare(String(a.found_at || "")))
    .slice(0, 500);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(rows, null, 2), "utf8");
  return rows;
}

async function fetchSignalsRaw() {
  const items = [];
  for (const query of RSS_QUERIES) {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query.q)}&hl=ru&gl=KZ&ceid=KZ:ru`;
    try {
      const xml = await fetchText(url);
      items.push(...parseRssItems(xml, query.label));
    } catch {}
  }
  const unique = new Map();
  for (const item of items) {
    unique.set(item.url, item);
  }
  return [...unique.values()];
}

async function kauSignals() {
  const now = Date.now();
  if (cache && now - cache.createdAt < CACHE_SECONDS * 1000) {
    return { ...cache.payload, cache: "fresh" };
  }

  const rawItems = await fetchSignalsRaw();
  const scored = rawItems.map((item) => {
    const meta = computeScore(item);
    return {
      ...item,
      found_at: new Date().toISOString(),
      language: meta.language,
      relevance_score: meta.score,
      category: meta.category,
      priority: meta.priority,
      matched_keywords: meta.matchedKeywords,
      alert_keywords: meta.alertMatched,
      status: meta.score >= 70 ? "новый" : meta.score >= 40 ? "проверить" : "мусор",
      summary: buildSummary(item, meta),
    };
  });

  const relevant = scored.filter((item) => item.relevance_score >= 40);
  const allHistory = writeHistory(scored);

  const summary = {
    total_news: scored.length,
    kau_mentions: relevant.length,
    average_relevance: relevant.length ? Math.round(relevant.reduce((sum, item) => sum + item.relevance_score, 0) / relevant.length) : 0,
    tag_counts: Object.fromEntries(Object.entries(KEYWORD_GROUPS).map(([key, list]) => [key, scored.filter((item) => item.matched_keywords.some((tag) => list.includes(tag))).length])),
    alert_count: relevant.filter((item) => item.priority === "Высокий риск").length,
  };

  const mentions = {
    total: relevant.length,
    updated_at: new Date().toISOString(),
    items: relevant
      .sort((a, b) => (b.relevance_score - a.relevance_score) || String(b.published_at || "").localeCompare(String(a.published_at || "")))
      .slice(0, 100),
  };

  const trends = {
    updated_at: new Date().toISOString(),
    topics: buildTrends(relevant).slice(0, 12),
  };

  const digest = {
    updated_at: new Date().toISOString(),
    sources: buildDigest(relevant).slice(0, 20),
  };

  const payload = {
    ok: true,
    source: "kau-signals-local",
    updated_at: new Date().toISOString(),
    summary,
    mentions,
    trends,
    digest,
    history_count: allHistory.length,
  };

  cache = { createdAt: Date.now(), payload };
  return { ...payload, cache: "updated" };
}

module.exports = { kauSignals };
