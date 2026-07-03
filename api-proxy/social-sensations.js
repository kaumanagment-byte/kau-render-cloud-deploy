const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
const GEMINI_MODEL_CANDIDATES = [
  process.env.GEMINI_MODEL || "gemini-2.5-flash",
  "gemini-2.0-flash",
];
const CACHE_SECONDS = Number(process.env.SOCIAL_RADAR_CACHE_SECONDS || 1800);
const REQUEST_TIMEOUT_MS = Number(process.env.SOCIAL_RADAR_TIMEOUT_MS || 25000);

const KAU_URLS = [
  "https://kau.edu.kz/",
  "https://kau.edu.kz/programmy-bakalavriata/",
  "https://kau.edu.kz/skidki-i-granty/",
  "https://kau.edu.kz/vozmozhnosti-postupleniya/",
];

const TREND_FEEDS = [
  "https://news.google.com/rss/search?q=site:tiktok.com+viral+trend+OR+site:instagram.com+reels+OR+site:youtube.com+shorts&hl=ru&gl=KZ&ceid=KZ:ru",
  "https://news.google.com/rss/search?q=Gen+Z+social+media+trend+students&hl=ru&gl=KZ&ceid=KZ:ru",
  "https://news.google.com/rss/search?q=AI+education+trend+students&hl=ru&gl=KZ&ceid=KZ:ru",
  "https://news.google.com/rss/search?q=Kazakhstan+education+news+university&hl=ru&gl=KZ&ceid=KZ:ru",
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
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

async function fetchText(url, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "KAU-Content-Radar/1.0",
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
        text: clip(stripHtml(html), 2500),
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

function parseRssItems(xml, limit = 4) {
  const items = [];
  const matches = xml.match(/<item>([\s\S]*?)<\/item>/gi) || [];
  for (const raw of matches.slice(0, limit)) {
    const title = decodeXml((raw.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || "");
    const link = decodeXml((raw.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || "");
    const description = stripHtml(decodeXml((raw.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || ""));
    if (!title) continue;
    items.push({ title, link, description: clip(description, 500) });
  }
  return items;
}

async function fetchTrendSources() {
  const items = [];
  for (const url of TREND_FEEDS) {
    try {
      const xml = await fetchText(url);
      items.push(...parseRssItems(xml, 4).map((item) => ({ type: "trend", ...item })));
    } catch (error) {
      items.push({
        type: "trend",
        title: "Ошибка загрузки тренд-ленты",
        link: url,
        description: error.message,
      });
    }
  }
  return items.slice(0, 12);
}

function buildPrompt(kauSources, trendSources) {
  return `
Ты — senior PR strategist и social strategist для бренда KAU.

Важная оговорка:
- Используй фактический контент только из предоставленных ниже источников.
- Если сайт описывает бренд иначе, чем в исходной задаче пользователя, опирайся на сайт.
- Нельзя придумывать несуществующие программы, события, рейтинги, партнерства или цифры.

Задача:
1. Проанализируй страницы KAU и внешние трендовые сигналы из интернета.
2. Найди 4-6 самых сильных инфоповодов, которые можно адаптировать под бренд KAU.
3. Для каждого инфоповода предложи:
   - PR angle
   - why_it_resonates
   - target_audience
   - 3 идеи для Instagram
   - 3 идеи для TikTok
   - 3 идеи для LinkedIn
4. Для каждой идеи укажи:
   - message
   - audience
   - format
   - sample_post
   - hashtags
   - visual_notes
5. Создай 1 полноценный пресс-релиз на русском языке для KAU на основе самого сильного инфоповода.

Требования:
- Пиши профессионально, но живо.
- Адаптируй язык под аудитории: абитуриенты, родители, партнеры, работодатели, профессионалы.
- Делай упор на практическую ценность, карьерный результат, международность, digital/AI/бизнес/креатив, если это подтверждается источниками.
- Не используй аграрный контекст, если его нет в источниках.
- Ответ верни строго в JSON.

Источники KAU:
${kauSources.map((item, index) => `KAU_SOURCE_${index + 1}
URL: ${item.url}
TITLE: ${item.title}
TEXT: ${item.text}`).join("\n\n")}

Внешние трендовые сигналы:
${trendSources.map((item, index) => `TREND_${index + 1}
TITLE: ${item.title}
URL: ${item.link}
TEXT: ${item.description}`).join("\n\n")}
`.trim();
}

async function callGemini(prompt) {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.7,
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
          opportunities: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                title: { type: "STRING" },
                source_title: { type: "STRING" },
                pr_angle: { type: "STRING" },
                why_it_resonates: { type: "STRING" },
                target_audience: { type: "ARRAY", items: { type: "STRING" } },
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
              required: ["title", "source_title", "pr_angle", "why_it_resonates", "target_audience", "instagram", "tiktok", "linkedin"],
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
        required: ["brand_summary", "strategic_takeaway", "analyzed_sources", "opportunities", "press_release"],
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
    brandSummary: data.brand_summary,
    strategicTakeaway: data.strategic_takeaway,
    analyzedSources: data.analyzed_sources || [],
    opportunities: data.opportunities || [],
    pressRelease: data.press_release || null,
    rawSources: {
      kau: kauSources.map((item) => ({ title: item.title, url: item.url })),
      trends: trendSources.map((item) => ({ title: item.title, url: item.link })),
    },
  };

  cache = { createdAt: Date.now(), payload };
  return { ...payload, cache: "updated" };
}

module.exports = { socialSensations };
