const http = require("node:http");

const PORT = Number(process.env.PORT || 8080);
const TILDA_ORIGIN = process.env.TILDA_ORIGIN || "*";
const ADS_BASE_URL = process.env.ADS_BASE_URL || "https://kau-ads-service.onrender.com";
const INTELLIGENCE_BASE_URL = process.env.INTELLIGENCE_BASE_URL || "https://kau-intelligence-service.onrender.com";
const CRM_BASE_URL = process.env.CRM_BASE_URL || "https://kau-crm-service.onrender.com";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": TILDA_ORIGIN,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  };
}

function send(res, status, payload) {
  res.writeHead(status, corsHeaders());
  res.end(JSON.stringify(payload));
}

async function fetchJson(url, timeoutMs = 35000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "ngrok-skip-browser-warning": "true",
      },
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { raw: text };
    }
    if (!response.ok) throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
    return { ok: true, payload };
  } catch (error) {
    return { ok: false, error: error.message || "Request failed" };
  } finally {
    clearTimeout(timeout);
  }
}

function formatNumber(value) {
  return new Intl.NumberFormat("ru-RU").format(Number(value || 0));
}

function pickTop(items, key, limit = 8) {
  return [...(items || [])]
    .sort((a, b) => Number(b[key] || 0) - Number(a[key] || 0))
    .slice(0, limit);
}

function buildInsights(data) {
  const insights = [];
  const ads = data.ads.payload;
  const crm = data.crm.payload;
  const summary = data.summary.payload;
  const comparison = data.comparison.payload;

  pickTop(
    (ads?.campaigns || []).filter((item) => Number(item.spend || 0) > 0 && Number(item.conversions || 0) === 0),
    "spend",
    3
  ).forEach((item) => {
    insights.push({
      kind: "Реклама",
      title: `${item.platform}: расход без заявок`,
      text: `${item.name} тратит бюджет, но конверсий нет. Проверь цель, события и посадочную страницу.`,
    });
  });

  const topCompetitor = pickTop((comparison?.rows || []).filter((row) => row.type !== "own"), "engagement_rate", 1)[0];
  if (topCompetitor) {
    insights.push({
      kind: "Соцсети",
      title: `Лидер ER: ${topCompetitor.name}`,
      text: `ER ${Number(topCompetitor.engagement_rate || 0).toFixed(2)}%, взаимодействий ${formatNumber(topCompetitor.interactions)}. Стоит разобрать контент-паттерны.`,
    });
  }

  if (summary?.kau_mentions) {
    insights.push({
      kind: "Репутация",
      title: `Есть ${summary.kau_mentions} упоминания KAU`,
      text: "Проверь тональность и используй сильные инфоповоды в рекламных креативах.",
    });
  }

  const activeDeals = Number(crm?.summary?.activeDeals || 0);
  if (activeDeals > 0) {
    insights.push({
      kind: "CRM",
      title: `${formatNumber(activeDeals)} новых сделок ждут обработки`,
      text: "Сравни нагрузку менеджеров и приоритетно добери новые заявки до конца дня.",
    });
  }

  return insights.slice(0, 6);
}

async function unified(range) {
  const [ads, status, summary, accounts, comparison, trends, digest, mentions, crmConfig, crm] = await Promise.all([
    fetchJson(`${ADS_BASE_URL}/api/dashboard?range=${encodeURIComponent(range)}`, 25000),
    fetchJson(`${INTELLIGENCE_BASE_URL}/api/status`, 10000),
    fetchJson(`${INTELLIGENCE_BASE_URL}/api/summary`, 12000),
    fetchJson(`${INTELLIGENCE_BASE_URL}/api/livedune/accounts`, 12000),
    fetchJson(`${INTELLIGENCE_BASE_URL}/api/livedune/comparison`, 12000),
    fetchJson(`${INTELLIGENCE_BASE_URL}/api/trends/university`, 12000),
    fetchJson(`${INTELLIGENCE_BASE_URL}/api/kazakhstan/digest`, 12000),
    fetchJson(`${INTELLIGENCE_BASE_URL}/api/kau/mentions`, 12000),
    fetchJson(`${CRM_BASE_URL}/api/config`, 12000),
    fetchJson(`${CRM_BASE_URL}/api/deal-dashboard?range=${encodeURIComponent(range)}`, 45000),
  ]);

  const data = { ads, status, summary, accounts, comparison, trends, digest, mentions, crmConfig, crm };
  return {
    fetchedAt: new Date().toISOString(),
    range,
    sources: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, { ok: value.ok, error: value.error || null }])),
    ads: ads.payload || null,
    intelligence: {
      status: status.payload || null,
      summary: summary.payload || null,
      accounts: accounts.payload || null,
      comparison: comparison.payload || null,
      trends: trends.payload || null,
      digest: digest.payload || null,
      mentions: mentions.payload || null,
    },
    crm: {
      config: crmConfig.payload || null,
      dashboard: crm.payload || null,
    },
    insights: buildInsights(data),
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (url.pathname === "/health") {
    send(res, 200, { ok: true, fetchedAt: new Date().toISOString() });
    return;
  }

  if (url.pathname === "/api/unified") {
    send(res, 200, await unified(url.searchParams.get("range") || "7d"));
    return;
  }

  send(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`KAU Command Center API listening on ${PORT}`);
});
