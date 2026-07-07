const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { tasksDashboard, reviewsDashboard } = require("./tasks-reviews");
const { enrollmentDashboard, queueStatus } = require("./enrollment-queue");
const { enrollmentForecast } = require("./forecast-enrollment");
const { socialSensations } = require("./social-sensations");
const { kauSignals } = require("./kau-signals");

const PORT = Number(process.env.PORT || 8080);
const TILDA_ORIGIN = process.env.TILDA_ORIGIN || "*";
const ADS_BASE_URL = process.env.ADS_BASE_URL || "https://kau-ads-service.onrender.com";
const INTELLIGENCE_BASE_URL = process.env.INTELLIGENCE_BASE_URL || "https://kau-intelligence-service.onrender.com";
const CRM_BASE_URL = process.env.CRM_BASE_URL || "https://kau-crm-service.onrender.com";
const RESPONSE_CACHE_TTL_MS = Number(process.env.RESPONSE_CACHE_TTL_MS || 5 * 60_000);
const RESPONSE_STALE_TTL_MS = Number(process.env.RESPONSE_STALE_TTL_MS || 15 * 60_000);
const responseCache = new Map();
const inflightRequests = new Map();

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(error) {
  const message = String(error?.message || "");
  return (
    message.includes("HTTP 502") ||
    message.includes("HTTP 503") ||
    message.includes("HTTP 504") ||
    message.includes("HTTP 429") ||
    message.includes("aborted") ||
    message.includes("fetch failed")
  );
}

async function fetchJsonOnce(url, timeoutMs = 35000) {
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

async function fetchJson(url, timeoutMs = 35000, retries = 2) {
  let last = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    last = await fetchJsonOnce(url, timeoutMs);
    if (last.ok) return last;
    if (attempt === retries || !isRetryableError(last.error)) return last;
    await sleep(2500 + attempt * 3500);
  }
  return last || { ok: false, error: "Request failed" };
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
  // Wake sleeping Render services before requesting their heavier dashboards.
  // Free instances often return 429 during the first burst immediately after a deploy.
  await fetchJson(`${ADS_BASE_URL}/health`, 60000);
  await sleep(3000);
  await fetchJson(`${INTELLIGENCE_BASE_URL}/health`, 60000);
  await sleep(3000);
  await fetchJson(`${CRM_BASE_URL}/health`, 60000);
  await sleep(5000);

  // Render's free services throttle a burst of parallel service-to-service calls.
  // A short sequential warm-up keeps the unified dashboard below that limit.
  const request = async (url, timeout) => {
    const result = await fetchJson(url, timeout);
    await sleep(5000);
    return result;
  };
  const ads = await request(`${ADS_BASE_URL}/api/dashboard?range=${encodeURIComponent(range)}`, 60000);
  const status = await request(`${INTELLIGENCE_BASE_URL}/api/status`, 20000);
  const accounts = await request(`${INTELLIGENCE_BASE_URL}/api/livedune/accounts`, 25000);
  const comparison = await request(`${INTELLIGENCE_BASE_URL}/api/livedune/comparison`, 25000);
  const crm = await request(`${CRM_BASE_URL}/api/deal-dashboard?range=${encodeURIComponent(range)}`, 70000);
  let localSignals = null;
  try {
    localSignals = await kauSignals();
  } catch (error) {
    localSignals = { ok: false, error: error.message };
  }
  const summary = localSignals?.ok ? { ok: true, payload: localSignals.summary } : await request(`${INTELLIGENCE_BASE_URL}/api/summary`, 12000);
  const trends = localSignals?.ok ? { ok: true, payload: localSignals.trends } : await request(`${INTELLIGENCE_BASE_URL}/api/trends/university`, 12000);
  const digest = localSignals?.ok ? { ok: true, payload: localSignals.digest } : await request(`${INTELLIGENCE_BASE_URL}/api/kazakhstan/digest`, 12000);
  const mentions = localSignals?.ok ? { ok: true, payload: localSignals.mentions } : await request(`${INTELLIGENCE_BASE_URL}/api/kau/mentions`, 12000);

  const crmConfig = crm.ok
    ? { ok: true, payload: { configured: true, source: "crm-dashboard" } }
    : { ok: false, error: crm.error || "CRM unavailable", payload: null };
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

function countOnlineSources(payload) {
  return Object.values(payload?.sources || {}).filter((source) => source?.ok).length;
}

function allSourcesOnline(payload) {
  const sources = Object.values(payload?.sources || {});
  return sources.length > 0 && sources.every((source) => source?.ok);
}

function bestCachedResponse(key, now) {
  const direct = responseCache.get(key);
  if (direct && now - direct.createdAt < RESPONSE_STALE_TTL_MS) return direct;

  return [...responseCache.values()]
    .filter((entry) => now - entry.createdAt < RESPONSE_STALE_TTL_MS)
    .sort((a, b) => countOnlineSources(b.payload) - countOnlineSources(a.payload) || b.createdAt - a.createdAt)[0];
}

async function unifiedCached(range) {
  const key = String(range || "7d");
  const cached = responseCache.get(key);
  const now = Date.now();

  // A partial response must never block recovery for five minutes. Retry it on the
  // next request so sleeping upstream services can replace 4/10 with a healthy 10/10.
  if (cached && allSourcesOnline(cached.payload) && now - cached.createdAt < RESPONSE_CACHE_TTL_MS) {
    return { ...cached.payload, cache: { status: "fresh", ageSeconds: Math.round((now - cached.createdAt) / 1000) } };
  }

  if (inflightRequests.has(key)) {
    return inflightRequests.get(key);
  }

  const request = (async () => {
    const payload = await unified(key);
    const onlineSources = countOnlineSources(payload);
    const fallback = bestCachedResponse(key, now);
    const fallbackOnlineSources = countOnlineSources(fallback?.payload);

    if (fallback && fallbackOnlineSources > onlineSources) {
      return {
        ...fallback.payload,
        cache: {
          status: "stale",
          ageSeconds: Math.round((now - fallback.createdAt) / 1000),
          reason: `current_response_only_${onlineSources}_online`,
        },
      };
    }

    // Only a complete response is safe to serve as a fresh cache entry. Partial
    // responses are returned to the caller but deliberately remain retryable.
    if (allSourcesOnline(payload)) {
      responseCache.set(key, { payload, createdAt: Date.now() });
      return { ...payload, cache: { status: "updated", ageSeconds: 0 } };
    }

    if (fallback) {
      return {
        ...fallback.payload,
        cache: {
          status: "stale",
          ageSeconds: Math.round((now - fallback.createdAt) / 1000),
          reason: "upstream_rate_limited_or_sleeping",
        },
      };
    }
    return payload;
  })();

  inflightRequests.set(key, request);
  try {
    return await request;
  } finally {
    inflightRequests.delete(key);
  }
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
    send(res, 200, await unifiedCached(url.searchParams.get("range") || "7d"));
    return;
  }

  if (url.pathname === "/api/tasks-dashboard") {
    try { send(res, 200, await tasksDashboard(url.searchParams.get("range") || "7d")); }
    catch (error) { send(res, 500, { ok: false, error: error.message }); }
    return;
  }

  if (url.pathname === "/api/2gis/reviews") {
    try { send(res, 200, await reviewsDashboard()); }
    catch (error) { send(res, 500, { ok: false, error: error.message }); }
    return;
  }

  if (url.pathname === "/api/enrollment-dashboard") {
    try { send(res, 200, await enrollmentDashboard()); }
    catch (error) { send(res, 500, { ok: false, error: error.message }); }
    return;
  }

  if (url.pathname === "/api/enrollment-forecast") {
    try { send(res, 200, await enrollmentForecast()); }
    catch (error) { send(res, 500, { ok: false, error: error.message }); }
    return;
  }

  if (url.pathname === "/api/social-sensations") {
    try { send(res, 200, await socialSensations()); }
    catch (error) { send(res, 500, { ok: false, error: error.message }); }
    return;
  }

  if (url.pathname === "/api/kau-signals") {
    try { send(res, 200, await kauSignals()); }
    catch (error) { send(res, 500, { ok: false, error: error.message }); }
    return;
  }

  if (url.pathname === "/api/queue/status") {
    try { send(res, 200, await queueStatus()); }
    catch (error) { send(res, 500, { ok: false, error: error.message }); }
    return;
  }

  if (["/tasks.html", "/reviews.html", "/enrollment.html", "/forecast.html", "/social-sensations.html"].includes(url.pathname)) {
    const filePath = path.join(__dirname, "public", path.basename(url.pathname));
    try {
      const body = fs.readFileSync(filePath);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(body);
    } catch { send(res, 404, { error: "Not found" }); }
    return;
  }

  send(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`KAU Command Center API listening on ${PORT}`);
});
