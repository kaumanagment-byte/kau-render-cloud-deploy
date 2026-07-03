const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
const GEMINI_MODEL_CANDIDATES = [
  process.env.GEMINI_MODEL || "gemini-2.5-flash",
  "gemini-2.0-flash",
];
const CACHE_SECONDS = Number(process.env.SOCIAL_RADAR_CACHE_SECONDS || 1800);
const REQUEST_TIMEOUT_MS = Number(process.env.SOCIAL_RADAR_TIMEOUT_MS || 25000);
const TREND_WINDOW_DAYS = Number(process.env.SOCIAL_RADAR_TREND_DAYS || 7);
const MAX_TREND_ITEMS = Number(process.env.SOCIAL_RADAR_MAX_TRENDS || 18);
const DAILY_PRESS_RELEASES = Number(process.env.SOCIAL_RADAR_PRESS_RELEASES || 10);

const KAU_URLS = [
  "https://kau.edu.kz/",
  "https://kau.edu.kz/programmy-bakalavriata/",
  "https://kau.edu.kz/skidki-i-granty/",
  "https://kau.edu.kz/vozmozhnosti-postupleniya/",
  "https://kau.edu.kz/novosti/",
  "https://kau.edu.kz/mezhdunarodnoe-sotrudnichestvo/",
];

const TREND_FEEDS = [
  "https://news.google.com/rss/search?q=(viral+trend+OR+social+media+trend)+students+when:7d&hl=ru&gl=KZ&ceid=KZ:ru",
  "https://news.google.com/rss/search?q=(TikTok+trend+OR+Instagram+Reels+trend+OR+YouTube+Shorts+trend)+when:7d&hl=ru&gl=KZ&ceid=KZ:ru",
  "https://news.google.com/rss/search?q=(university+campaign+OR+campus+activation+OR+brand+stunt)+when:7d&hl=ru&gl=US&ceid=US:en",
  "https://news.google.com/rss/search?q=(Gen+Z+trend+OR+student+trend)+when:7d&hl=ru&gl=US&ceid=US:en",
  "https://news.google.com/rss/search?q=(AI+education+trend+OR+university+innovation)+when:7d&hl=ru&gl=US&ceid=US:en",
  "https://news.google.com/rss/search?q=(Kazakhstan+education+news+OR+university+news)+when:7d&hl=ru&gl=KZ&ceid=KZ:ru",
];

let cache = null;

function stripHtml(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
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

function clip(value, limit = 1800) {
  const text = String(value || "").trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function toIsoDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function isRecentEnough(isoDate, days = TREND_WINDOW_DAYS) {
  if (!isoDate) return true;
  const diff = Date.now() - new Date(isoDate).getTime();
  return diff <= days * 24 * 60 * 60 * 1000;
}

async function fetchText(url, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "KAU-Content-Radar/3.0",
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

async function fetchKauSources() {
  const sources = [];
  for (const url of KAU_URLS) {
    try {
      const html = await fetchText(url);
      const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
      const headingMatch = html.match(/<h1[^>]*>(.*?)<\/h1>/i);
      sources.push({
        type: "kau",
        url,
        title: stripHtml(headingMatch?.[1] || titleMatch?.[1] || url),
        text: clip(stripHtml(html), 3200),
      });
    } catch (error) {
      sources.push({
        type: "kau",
        url,
        title: url,
        text: `Ошибка загрузки: ${error.message}`,
      });
    }
  }
  return sources;
}

function parseRssItems(xml, limit = 6) {
  const items = [];
  const matches = xml.match(/<item>([\s\S]*?)<\/item>/gi) || [];
  for (const raw of matches.slice(0, limit)) {
    const title = decodeXml((raw.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || "");
    const link = decodeXml((raw.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || "");
    const description = stripHtml(decodeXml((raw.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || ""));
    const pubDate = toIsoDate(decodeXml((raw.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || ""));
    if (!title) continue;
    items.push({
      title,
      link,
      description: clip(description, 700),
      pubDate,
    });
  }
  return items;
}

async function fetchTrendSources() {
  const items = [];
  for (const url of TREND_FEEDS) {
    try {
      const xml = await fetchText(url);
      items.push(
        ...parseRssItems(xml, 6)
          .filter((item) => isRecentEnough(item.pubDate))
          .map((item) => ({ type: "trend", feed: url, ...item })),
      );
    } catch (error) {
      items.push({
        type: "trend",
        title: "Ошибка загрузки тренд-ленты",
        link: url,
        description: error.message,
        pubDate: null,
      });
    }
  }

  const unique = [];
  const seen = new Set();
  for (const item of items) {
    const key = `${item.title}__${item.link}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }

  unique.sort((a, b) => {
    const aTime = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const bTime = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    return bTime - aTime;
  });

  return unique.slice(0, MAX_TREND_ITEMS);
}

function buildPrompt(kauSources, trendSources) {
  return `
Ты — senior PR strategist, social strategist, newsroom editor и trend-adaptation editor для бренда KAU.

Работаешь в 3 слоя:
1. Изучаешь KAU: кто мы, что предлагаем, какие программы, возможности, преимущества, международность, гранты, новости и карьерные смыслы есть на сайте.
2. Анализируешь внешние тренды за последние ${TREND_WINDOW_DAYS} дней: что шумит в новостях, какие форматы собирают самый большой охват, какие механики залетают в соцсетях.
3. Превращаешь это в контент и PR-поводы именно для KAU.

Критически важно:
- Используй только факты из источников ниже.
- Если в задаче пользователя и на сайте есть расхождение, доверяй сайту KAU.
- Не придумывай несуществующие программы, рейтинги, партнерства, кампусы, цифры или события.
- Если внешний тренд похож на крупный stunt, pop-up, public activation, visual spectacle, projection show, city stunt или viral performance, не копируй его буквально. Объясни механику и предложи реалистичную адаптацию под KAU.
- Приоритет: последние ${TREND_WINDOW_DAYS} дней, максимальный охват, высокий новостной шум, молодежные форматы, быстро запускаемые идеи.

Что нужно вернуть:
1. brand_summary — кто такой KAU и какие сильные стороны у бренда.
2. strategic_takeaway — какие тренды и форматы стоит забирать прямо сейчас.
3. analyzed_sources — какие сигналы реально повлияли на вывод.
4. newsroom_summary:
   - what_is_loud_now
   - highest_reach_theme
   - fastest_content_move
5. opportunities — от 8 до 12 сильных инфоповодов.

Для каждого opportunity обязательно верни:
- title
- source_title
- source_type
- source_date
- trend_mechanic
- kau_adaptation
- pr_angle
- why_it_resonates
- target_audience (массив)
- priority (high / medium)
- reach_potential (high / medium / low)
- reach_reason
- news_noise_score (0-100)
- viral_score (0-100)
- recommended_speed (сегодня / 24 часа / 3 дня)
- press_hook
- instagram — 3 идеи
- tiktok — 3 идеи
- linkedin — 3 идеи

Для каждой идеи в instagram / tiktok / linkedin укажи:
- message
- audience
- format
- sample_post
- hashtags
- visual_notes

6. daily_press_releases — массив из ${DAILY_PRESS_RELEASES} пресс-релизов на день.
Для каждого daily_press_release верни:
- headline
- subheadline
- body
- based_on
- angle
- urgency (high / medium)

7. press_release — один главный флагманский пресс-релиз:
- headline
- subheadline
- body

Требования к стилю:
- Пиши по-русски.
- Тон профессиональный, но живой и читаемый.
- Нужны конкретные адаптации под KAU.
- Отдельно подчеркивай темы с максимальным потенциалом охвата.
- Отдельно выделяй, что именно шумит в новостях.
- Покажи, как тренд из сети превращается в контент, PR-повод, mini-campaign, Reels/TikTok, серию постов, спецпроект или media story.

Источники KAU:
${kauSources.map((item, index) => `KAU_SOURCE_${index + 1}
URL: ${item.url}
TITLE: ${item.title}
TEXT: ${item.text}`).join("\n\n")}

Внешние тренды за последние ${TREND_WINDOW_DAYS} дней:
${trendSources.map((item, index) => `TREND_${index + 1}
TITLE: ${item.title}
URL: ${item.link}
DATE: ${item.pubDate || "unknown"}
TEXT: ${item.description}`).join("\n\n")}
`.trim();
}

async function callGemini(prompt) {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.8,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          brand_summary: { type: "STRING" },
          strategic_takeaway: { type: "STRING" },
          analyzed_sources: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                title: { type: "STRING" },
                type: { type: "STRING" },
                angle: { type: "STRING" },
              },
              required: ["title", "type", "angle"],
            },
          },
          newsroom_summary: {
            type: "OBJECT",
            properties: {
              what_is_loud_now: { type: "STRING" },
              highest_reach_theme: { type: "STRING" },
              fastest_content_move: { type: "STRING" },
            },
            required: ["what_is_loud_now", "highest_reach_theme", "fastest_content_move"],
          },
          opportunities: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                title: { type: "STRING" },
                source_title: { type: "STRING" },
                source_type: { type: "STRING" },
                source_date: { type: "STRING" },
                trend_mechanic: { type: "STRING" },
                kau_adaptation: { type: "STRING" },
                pr_angle: { type: "STRING" },
                why_it_resonates: { type: "STRING" },
                target_audience: { type: "ARRAY", items: { type: "STRING" } },
                priority: { type: "STRING" },
                reach_potential: { type: "STRING" },
                reach_reason: { type: "STRING" },
                news_noise_score: { type: "NUMBER" },
                viral_score: { type: "NUMBER" },
                recommended_speed: { type: "STRING" },
                press_hook: { type: "STRING" },
                instagram: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      message: { type: "STRING" },
                      audience: { type: "STRING" },
                      format: { type: "STRING" },
                      sample_post: { type: "STRING" },
                      hashtags: { type: "ARRAY", items: { type: "STRING" } },
                      visual_notes: { type: "STRING" },
                    },
                    required: ["message", "audience", "format", "sample_post", "hashtags", "visual_notes"],
                  },
                },
                tiktok: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      message: { type: "STRING" },
                      audience: { type: "STRING" },
                      format: { type: "STRING" },
                      sample_post: { type: "STRING" },
                      hashtags: { type: "ARRAY", items: { type: "STRING" } },
                      visual_notes: { type: "STRING" },
                    },
                    required: ["message", "audience", "format", "sample_post", "hashtags", "visual_notes"],
                  },
                },
                linkedin: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      message: { type: "STRING" },
                      audience: { type: "STRING" },
                      format: { type: "STRING" },
                      sample_post: { type: "STRING" },
                      hashtags: { type: "ARRAY", items: { type: "STRING" } },
                      visual_notes: { type: "STRING" },
                    },
                    required: ["message", "audience", "format", "sample_post", "hashtags", "visual_notes"],
                  },
                },
              },
              required: [
                "title",
                "source_title",
                "source_type",
                "source_date",
                "trend_mechanic",
                "kau_adaptation",
                "pr_angle",
                "why_it_resonates",
                "target_audience",
                "priority",
                "reach_potential",
                "reach_reason",
                "news_noise_score",
                "viral_score",
                "recommended_speed",
                "press_hook",
                "instagram",
                "tiktok",
                "linkedin",
              ],
            },
          },
          daily_press_releases: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                headline: { type: "STRING" },
                subheadline: { type: "STRING" },
                body: { type: "STRING" },
                based_on: { type: "STRING" },
                angle: { type: "STRING" },
                urgency: { type: "STRING" },
              },
              required: ["headline", "subheadline", "body", "based_on", "angle", "urgency"],
            },
          },
          press_release: {
            type: "OBJECT",
            properties: {
              headline: { type: "STRING" },
              subheadline: { type: "STRING" },
              body: { type: "STRING" },
            },
            required: ["headline", "subheadline", "body"],
          },
        },
        required: [
          "brand_summary",
          "strategic_takeaway",
          "analyzed_sources",
          "newsroom_summary",
          "opportunities",
          "daily_press_releases",
          "press_release",
        ],
      },
    },
  };

  let lastError = null;
  for (const model of GEMINI_MODEL_CANDIDATES) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error?.message || `Gemini HTTP ${response.status}`);
      const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
      if (!text) throw new Error("Gemini returned empty content");
      return { model, data: JSON.parse(text) };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Gemini request failed");
}

async function socialSensations() {
  const now = Date.now();
  if (cache && now - cache.createdAt < CACHE_SECONDS * 1000) {
    return { ...cache.payload, cache: "fresh" };
  }

  const kauSources = await fetchKauSources();
  const trendSources = await fetchTrendSources();
  const prompt = buildPrompt(kauSources, trendSources);
  const { model, data } = await callGemini(prompt);

  const payload = {
    ok: true,
    source: "gemini-content-radar",
    model,
    updatedAt: new Date().toISOString(),
    siteBase: "https://kau.edu.kz/",
    trendWindowDays: TREND_WINDOW_DAYS,
    brandSummary: data.brand_summary,
    strategicTakeaway: data.strategic_takeaway,
    analyzedSources: data.analyzed_sources || [],
    newsroomSummary: data.newsroom_summary || null,
    opportunities: data.opportunities || [],
    dailyPressReleases: data.daily_press_releases || [],
    pressRelease: data.press_release || null,
    rawSources: {
      kau: kauSources.map((item) => ({ title: item.title, url: item.url })),
      trends: trendSources.map((item) => ({ title: item.title, url: item.link, date: item.pubDate })),
    },
  };

  cache = { createdAt: Date.now(), payload };
  return { ...payload, cache: "updated" };
}

module.exports = { socialSensations };
