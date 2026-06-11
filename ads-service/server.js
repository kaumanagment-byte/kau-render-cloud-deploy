const fs = require("fs");
const http = require("http");
const path = require("path");
const crypto = require("crypto");

loadEnv(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 8123);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v24.0";
const META_APP_ID = process.env.META_APP_ID || "";
const META_APP_SECRET = process.env.META_APP_SECRET || "";
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || "";
const META_AD_ACCOUNT_IDS = (process.env.META_AD_ACCOUNT_IDS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean)
  .map((id) => (id.startsWith("act_") ? id : `act_${id}`));
const TIKTOK_ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || "";
const TIKTOK_APP_ID = process.env.TIKTOK_APP_ID || "";
const TIKTOK_APP_SECRET = process.env.TIKTOK_APP_SECRET || "";
const TIKTOK_REDIRECT_URI = process.env.TIKTOK_REDIRECT_URI || "";
const TIKTOK_ADVERTISER_IDS = (process.env.TIKTOK_ADVERTISER_IDS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
const GOOGLE_ADS_DEVELOPER_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "";
const GOOGLE_ADS_ACCESS_TOKEN = process.env.GOOGLE_ADS_ACCESS_TOKEN || "";
const GOOGLE_ADS_LOGIN_CUSTOMER_ID = (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || "").replace(/\D/g, "");
const GOOGLE_ADS_CUSTOMER_IDS = (process.env.GOOGLE_ADS_CUSTOMER_IDS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean)
  .map((id) => id.replace(/\D/g, ""));
const SESSION_FILE = path.join(__dirname, ".meta-session.json");
const META_OAUTH_STATE_FILE = path.join(__dirname, ".meta-oauth-state.json");
const TIKTOK_SESSION_FILE = path.join(__dirname, ".tiktok-session.json");
const UNIFIED_DASHBOARD_DIR = "C:\\Users\\enadi\\Documents\\Codex\\2026-06-09\\http-127-0-0-1-8123\\outputs\\unified-dashboard";
const USD_KZT_FALLBACK_RATE = 486.76;

let cachedUsdKztRate = {
  rate: USD_KZT_FALLBACK_RATE,
  date: "",
  fetchedAt: 0,
  source: "fallback",
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

async function fetchUnifiedJson(url, timeoutMs = 35000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
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

function pickUnifiedTop(items, key, limit = 8) {
  return [...(items || [])]
    .sort((a, b) => Number(b[key] || 0) - Number(a[key] || 0))
    .slice(0, limit);
}

function unifiedNumber(value) {
  return new Intl.NumberFormat("ru-RU").format(Number(value || 0));
}

function buildUnifiedInsights(data) {
  const insights = [];
  const ads = data.ads.payload;
  const crm = data.crm.payload;
  const summary = data.summary.payload;
  const comparison = data.comparison.payload;

  pickUnifiedTop(
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

  const topCompetitor = pickUnifiedTop((comparison?.rows || []).filter((row) => row.type !== "own"), "engagement_rate", 1)[0];
  if (topCompetitor) {
    insights.push({
      kind: "Соцсети",
      title: `Лидер ER: ${topCompetitor.name}`,
      text: `ER ${Number(topCompetitor.engagement_rate || 0).toFixed(2)}%, взаимодействий ${unifiedNumber(topCompetitor.interactions)}. Стоит разобрать контент-паттерны.`,
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
      title: `${unifiedNumber(activeDeals)} новых сделок ждут обработки`,
      text: "Сравни нагрузку менеджеров и приоритетно добери новые заявки до конца дня.",
    });
  }

  return insights.slice(0, 6);
}

async function getUsdKztRate() {
  const now = Date.now();
  if (cachedUsdKztRate.fetchedAt && now - cachedUsdKztRate.fetchedAt < 1000 * 60 * 60) {
    return cachedUsdKztRate;
  }

  try {
    const response = await fetch("https://open.er-api.com/v6/latest/USD");
    const data = await response.json();
    const rate = Number(data?.rates?.KZT);
    if (response.ok && rate > 0) {
      cachedUsdKztRate = {
        rate,
        date: data.time_last_update_utc || new Date().toISOString(),
        fetchedAt: now,
        source: "open.er-api.com",
      };
    }
  } catch {
    cachedUsdKztRate = {
      ...cachedUsdKztRate,
      fetchedAt: now,
      source: "fallback",
    };
  }

  return cachedUsdKztRate;
}

function getSession() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      return JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
    }
  } catch {
    // Fall back to the static token below.
  }

  if (META_ACCESS_TOKEN) {
    return {
      accessToken: META_ACCESS_TOKEN,
      source: "env",
    };
  }

  return null;
}

function saveSession(session) {
  fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));
}

function saveMetaOauthState(state) {
  fs.writeFileSync(
    META_OAUTH_STATE_FILE,
    JSON.stringify(
      {
        state,
        createdAt: Date.now(),
      },
      null,
      2
    )
  );
}

function isValidMetaOauthState(state) {
  if (!state || !fs.existsSync(META_OAUTH_STATE_FILE)) return false;
  try {
    const saved = JSON.parse(fs.readFileSync(META_OAUTH_STATE_FILE, "utf8"));
    const isFresh = Date.now() - Number(saved.createdAt || 0) < 1000 * 60 * 20;
    return isFresh && saved.state === state;
  } catch {
    return false;
  }
}

function clearMetaOauthState() {
  try {
    fs.unlinkSync(META_OAUTH_STATE_FILE);
  } catch {
    // State file is optional.
  }
}

function getTikTokSession() {
  if (TIKTOK_ACCESS_TOKEN) {
    return {
      accessToken: TIKTOK_ACCESS_TOKEN,
      advertiserIds: TIKTOK_ADVERTISER_IDS,
      source: "env",
    };
  }

  if (!fs.existsSync(TIKTOK_SESSION_FILE)) return null;
  try {
    const session = JSON.parse(fs.readFileSync(TIKTOK_SESSION_FILE, "utf8"));
    return {
      accessToken: session.accessToken,
      advertiserIds: session.advertiserIds || TIKTOK_ADVERTISER_IDS,
      source: "oauth",
    };
  } catch {
    return null;
  }
}

function saveTikTokSession(session) {
  fs.writeFileSync(TIKTOK_SESSION_FILE, JSON.stringify(session, null, 2));
}

function requireMetaConfig(res) {
  if (META_APP_ID && META_APP_SECRET) return true;
  sendText(
    res,
    400,
    "Meta OAuth не настроен. Добавь META_APP_ID и META_APP_SECRET в .env или замени истекший META_ACCESS_TOKEN свежим токеном."
  );
  return false;
}

async function graphGet(pathname, params = {}) {
  const session = getSession();
  if (!session?.accessToken) throw new Error("Meta не подключена.");

  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}${pathname}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  url.searchParams.set("access_token", session.accessToken);

  const response = await fetch(url);
  const json = await response.json();
  if (!response.ok) {
    const message = json?.error?.message || `Meta API returned ${response.status}`;
    throw new Error(message);
  }
  return json;
}

async function getConfiguredAdAccounts() {
  if (META_AD_ACCOUNT_IDS.length) {
    const accounts = [];
    for (const id of META_AD_ACCOUNT_IDS) {
      try {
        const account = await graphGet(`/${id}`, {
          fields: "id,account_id,name,currency,account_status,timezone_name",
        });
        accounts.push(account);
      } catch {
        accounts.push({
          id,
          account_id: id.replace("act_", ""),
          name: `Meta ${id}`,
          account_status: 1,
        });
      }
    }
    return accounts;
  }

  const accountResponse = await graphGet("/me/adaccounts", {
    fields: "id,account_id,name,currency,account_status,timezone_name",
    limit: 100,
  });
  return accountResponse.data || [];
}

function dateRange(range) {
  const now = new Date();
  const since = new Date(now);
  if (range === "all") since.setFullYear(now.getFullYear() - 2);
  else if (range === "yesterday") {
    since.setDate(now.getDate() - 1);
    now.setDate(now.getDate() - 1);
  } else if (range === "30d") since.setDate(now.getDate() - 29);
  else if (range === "7d") since.setDate(now.getDate() - 6);

  const format = (date) => date.toISOString().slice(0, 10);
  return { since: format(since), until: format(now) };
}

function getActionValue(actions = [], names) {
  const match = actions.find((item) => names.includes(item.action_type));
  return Number(match?.value || 0);
}

function normalizeCampaign(row, account) {
  const spend = Number(row.spend || 0);
  const impressions = Number(row.impressions || 0);
  const clicks = Number(row.clicks || 0);
  const conversions = getActionValue(row.actions, ["purchase", "lead", "offsite_conversion.fb_pixel_purchase"]);
  const actionValue = getActionValue(row.action_values, [
    "purchase",
    "offsite_conversion.fb_pixel_purchase",
  ]);
  const purchaseRoas = Number(row.purchase_roas?.[0]?.value || 0);
  const revenue = actionValue || spend * purchaseRoas;

  return {
    accountId: account.id,
    name: row.campaign_name || "Кампания Meta",
    platform: "Meta",
    spend,
    impressions,
    clicks,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
    revenue,
    conversions,
    status: spend > 0 && conversions === 0 ? "Watch" : "Live",
  };
}

function summarizeMetaTargeting(targeting = {}) {
  const geo = targeting.geo_locations || {};
  const countries = geo.countries?.join(", ") || "";
  const cities = geo.cities?.map((city) => city.name || city.key).filter(Boolean).join(", ") || "";
  const regions = geo.regions?.map((region) => region.name || region.key).filter(Boolean).join(", ") || "";
  const interests = targeting.flexible_spec
    ?.flatMap((spec) => spec.interests || spec.behaviors || spec.custom_audiences || [])
    .map((item) => item.name || item.id)
    .filter(Boolean)
    .join(", ");
  const placements = [
    ...(targeting.publisher_platforms || []),
    ...(targeting.facebook_positions || []),
    ...(targeting.instagram_positions || []),
    ...(targeting.messenger_positions || []),
    ...(targeting.audience_network_positions || []),
  ].join(", ");

  return {
    geo: [countries, cities, regions].filter(Boolean).join(", ") || "Broad",
    age: `${targeting.age_min || "any"}-${targeting.age_max || "any"}`,
    gender: targeting.genders?.length ? targeting.genders.join(", ") : "all",
    interests: interests || "Broad / Advantage",
    placements: placements || "Automatic",
  };
}

function normalizeMetaTarget(row, account) {
  const targeting = summarizeMetaTargeting(row.targeting || {});
  return {
    accountId: account.id,
    platform: "Meta",
    campaign: row.campaign?.name || row.campaign_id || "Кампания Meta",
    group: row.name || "Meta ad set",
    status: row.status || "UNKNOWN",
    geo: targeting.geo,
    age: targeting.age,
    gender: targeting.gender,
    interests: targeting.interests,
    placements: targeting.placements,
    optimization: row.optimization_goal || "n/a",
    budget: row.daily_budget ? Number(row.daily_budget) / 100 : 0,
  };
}

async function getMetaDashboard(range) {
  const session = getSession();
  if (!session?.accessToken) {
    return {
      metaConfigured: Boolean((META_APP_ID && META_APP_SECRET) || META_ACCESS_TOKEN),
      metaConnected: false,
      accounts: [],
      campaigns: [],
      targets: [],
      trend: [],
    };
  }

  const metaAccounts = await getConfiguredAdAccounts();
  const normalizedAccounts = metaAccounts.map((account) => ({
    id: account.id,
    platform: "Meta",
    name: account.name || `Meta ${account.account_id}`,
    status: account.account_status === 1 ? "good" : "warn",
    budget: 1,
  }));

  const campaigns = [];
  const targets = [];
  const rangeValue = dateRange(range);

  for (const account of metaAccounts) {
    const insights = await graphGet(`/${account.id}/insights`, {
      level: "campaign",
      fields: "campaign_id,campaign_name,spend,impressions,clicks,actions,action_values,purchase_roas,date_start,date_stop",
      time_range: JSON.stringify(rangeValue),
      limit: 100,
    });

    for (const row of insights.data || []) {
      campaigns.push(normalizeCampaign(row, account));
    }

    const adsets = await graphGet(`/${account.id}/adsets`, {
      fields: "id,name,campaign_id,campaign{name},targeting,status,optimization_goal,daily_budget",
      limit: 100,
    });

    for (const row of adsets.data || []) {
      targets.push(normalizeMetaTarget(row, account));
    }
  }

  const totalSpend = campaigns.reduce((sum, campaign) => sum + campaign.spend, 0);
  normalizedAccounts.forEach((account) => {
    const spend = campaigns
      .filter((campaign) => campaign.accountId === account.id)
      .reduce((sum, campaign) => sum + campaign.spend, 0);
    account.budget = Math.max(spend * 1.35, totalSpend || 1);
  });

  return {
    metaConfigured: true,
    metaConnected: true,
    accounts: normalizedAccounts,
    campaigns,
    targets,
    trend: [],
  };
}

async function tiktokGet(pathname, params = {}) {
  const session = getTikTokSession();
  if (!session?.accessToken) throw new Error("TikTok не подключен.");

  const url = new URL(`https://business-api.tiktok.com/open_api/v1.3${pathname}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    headers: {
      "Access-Token": session.accessToken,
    },
  });
  const json = await response.json();
  if (!response.ok || json.code) {
    throw new Error(json.message || `TikTok API returned ${response.status}`);
  }
  return json.data || json;
}

async function tiktokPost(pathname, body = {}) {
  const response = await fetch(`https://business-api.tiktok.com/open_api/v1.3${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok || json.code) {
    throw new Error(json.message || `TikTok API returned ${response.status}`);
  }
  return json.data || json;
}

function normalizeTikTokCampaign(row, advertiserId, campaignNames = {}) {
  const metrics = row.metrics || row;
  const dimensions = row.dimensions || row;
  const campaignId = dimensions.campaign_id || row.campaign_id;
  const spend = Number(metrics.spend || 0);
  const impressions = Number(metrics.impressions || 0);
  const clicks = Number(metrics.clicks || 0);
  const conversions = Number(metrics.conversion || metrics.total_complete_payment || 0);
  const revenue = Number(metrics.total_purchase_value || metrics.total_sales_lead_value || 0);

  return {
    accountId: advertiserId,
    name: dimensions.campaign_name || campaignNames[campaignId] || campaignId || "Кампания TikTok",
    platform: "TikTok",
    spend,
    impressions,
    clicks,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
    revenue,
    conversions,
    status: spend > 0 && conversions === 0 ? "Watch" : "Live",
  };
}

function normalizeTikTokTarget(row, advertiserId) {
  const age = Array.isArray(row.age_groups) ? row.age_groups.join(", ") : row.age_groups || "all";
  const gender = row.gender || "all";
  const geo = [
    ...(row.location_ids || []),
    ...(row.country_codes || []),
  ].join(", ");
  const interests = [
    ...(row.interest_category_ids || []),
    ...(row.behavior_category_ids || []),
    ...(row.audience_ids || []),
  ].join(", ");

  return {
    accountId: advertiserId,
    platform: "TikTok",
    campaign: row.campaign_name || row.campaign_id || "Кампания TikTok",
    group: row.adgroup_name || row.adgroup_id || "TikTok ad group",
    status: row.operation_status || row.secondary_status || "UNKNOWN",
    geo: geo || "Broad",
    age,
    gender,
    interests: interests || "Broad",
    placements: row.placement_type || "TikTok",
    optimization: row.optimization_goal || row.billing_event || "n/a",
    budget: Number(row.budget || 0),
  };
}

async function getTikTokDashboard(range) {
  const session = getTikTokSession();
  if (!session?.accessToken) {
    return {
      tiktokConfigured: Boolean(TIKTOK_APP_ID && TIKTOK_APP_SECRET),
      tiktokConnected: false,
      accounts: [],
      campaigns: [],
      targets: [],
    };
  }

  const advertiserIds = session.advertiserIds || [];
  const rangeValue = dateRange(range);
  const accounts = advertiserIds.map((id) => ({
    id,
    platform: "TikTok",
    name: `TikTok ${id}`,
    status: "good",
    budget: 1,
  }));
  const campaigns = [];
  const targets = [];

  for (const advertiserId of advertiserIds) {
    let campaignNames = {};
    try {
      const campaignList = await tiktokGet("/campaign/get/", {
        advertiser_id: advertiserId,
        page_size: 1000,
      });
      campaignNames = Object.fromEntries(
        (campaignList.list || []).map((campaign) => [
          String(campaign.campaign_id),
          campaign.campaign_name || String(campaign.campaign_id),
        ])
      );
    } catch {
      campaignNames = {};
    }

    try {
      const report = await tiktokGet("/report/integrated/get/", {
        advertiser_id: advertiserId,
        report_type: "BASIC",
        data_level: "AUCTION_CAMPAIGN",
        dimensions: JSON.stringify(["campaign_id"]),
        metrics: JSON.stringify([
          "spend",
          "impressions",
          "clicks",
          "conversion",
          "total_purchase_value",
        ]),
        start_date: rangeValue.since,
        end_date: rangeValue.until,
        page_size: 1000,
      });

      for (const row of report.list || []) {
        campaigns.push(normalizeTikTokCampaign(row, advertiserId, campaignNames));
      }
    } catch (error) {
      campaigns.push({
        accountId: advertiserId,
        name: `Ошибка отчета TikTok: ${error.message}`,
        platform: "TikTok",
        spend: 0,
        revenue: 0,
        conversions: 0,
        status: "Review",
      });
    }

    try {
      const adgroups = await tiktokGet("/adgroup/get/", {
        advertiser_id: advertiserId,
        page_size: 1000,
      });

      for (const row of adgroups.list || []) {
        targets.push(normalizeTikTokTarget(row, advertiserId));
      }
    } catch (error) {
      targets.push({
        accountId: advertiserId,
        platform: "TikTok",
        campaign: "TikTok",
        group: `Ошибка таргетинга: ${error.message}`,
        status: "Review",
        geo: "-",
        age: "-",
        gender: "-",
        interests: "-",
        placements: "-",
        optimization: "-",
        budget: 0,
      });
    }
  }

  const totalSpend = campaigns.reduce((sum, campaign) => sum + campaign.spend, 0);
  accounts.forEach((account) => {
    const spend = campaigns
      .filter((campaign) => campaign.accountId === account.id)
      .reduce((sum, campaign) => sum + campaign.spend, 0);
    account.budget = Math.max(spend * 1.35, totalSpend || 1);
  });

  return {
    tiktokConfigured: true,
    tiktokConnected: true,
    accounts,
    campaigns,
    targets,
  };
}

async function getDashboard(range) {
  const [exchangeRate, meta, tiktok, google] = await Promise.all([
    getUsdKztRate(),
    getMetaDashboard(range).catch((error) => ({
      metaConfigured: Boolean((META_APP_ID && META_APP_SECRET) || META_ACCESS_TOKEN),
      metaConnected: false,
      accounts: [],
      campaigns: [
        {
          accountId: "meta",
          name: `Ошибка Meta API: ${error.message}`,
          platform: "Meta",
          spend: 0,
          revenue: 0,
          conversions: 0,
          status: "Review",
        },
      ],
      targets: [],
      trend: [],
    })),
    getTikTokDashboard(range).catch((error) => ({
      tiktokConfigured: Boolean((TIKTOK_APP_ID && TIKTOK_APP_SECRET) || TIKTOK_ACCESS_TOKEN),
      tiktokConnected: false,
      accounts: [],
      campaigns: [
        {
          accountId: "tiktok",
          name: `Ошибка TikTok API: ${error.message}`,
          platform: "TikTok",
          spend: 0,
          revenue: 0,
          conversions: 0,
          status: "Review",
        },
      ],
      targets: [],
    })),
    getGoogleAdsDashboard(range).catch((error) => ({
      googleConfigured: Boolean(
        GOOGLE_ADS_DEVELOPER_TOKEN && GOOGLE_ADS_ACCESS_TOKEN && GOOGLE_ADS_CUSTOMER_IDS.length
      ),
      googleConnected: false,
      accounts: [],
      campaigns: [
        {
          accountId: "google",
          name: `Ошибка Google API: ${error.message}`,
          platform: "Google",
          spend: 0,
          revenue: 0,
          conversions: 0,
          status: "Review",
        },
      ],
      targets: [],
    })),
  ]);

  return {
    ...meta,
    exchangeRate,
    tiktokConfigured: tiktok.tiktokConfigured,
    tiktokConnected: tiktok.tiktokConnected,
    googleConfigured: google.googleConfigured,
    googleConnected: google.googleConnected,
    accounts: [...(meta.accounts || []), ...(tiktok.accounts || []), ...(google.accounts || [])],
    campaigns: [...(meta.campaigns || []), ...(tiktok.campaigns || []), ...(google.campaigns || [])].filter(
      (campaign) => !(["meta", "tiktok", "google"].includes(campaign.accountId) && campaign.status === "Review")
    ),
    targets: [...(meta.targets || []), ...(tiktok.targets || []), ...(google.targets || [])],
  };
}

async function googleAdsSearch(customerId, query) {
  if (!GOOGLE_ADS_DEVELOPER_TOKEN || !GOOGLE_ADS_ACCESS_TOKEN) {
    throw new Error("Google Ads не подключен.");
  }

  const response = await fetch(
    `https://googleads.googleapis.com/v22/customers/${customerId}/googleAds:searchStream`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GOOGLE_ADS_ACCESS_TOKEN}`,
        "developer-token": GOOGLE_ADS_DEVELOPER_TOKEN,
        ...(GOOGLE_ADS_LOGIN_CUSTOMER_ID
          ? { "login-customer-id": GOOGLE_ADS_LOGIN_CUSTOMER_ID }
          : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    }
  );

  const json = await response.json();
  if (!response.ok) {
    const googleError = json?.error || json?.[0]?.errors?.[0] || {};
    const details = googleError.details
      ?.flatMap((detail) => detail.errors || [])
      ?.map((error) => {
        const location = error.location?.fieldPathElements
          ?.map((item) => item.fieldName)
          .filter(Boolean)
          .join(".");
        return [error.errorCode ? JSON.stringify(error.errorCode) : "", error.message, location]
          .filter(Boolean)
          .join(" | ");
      })
      .join("; ");
    const message = [googleError.message, details, `HTTP ${response.status}`].filter(Boolean).join(" :: ");
    throw new Error(message);
  }

  return Array.isArray(json) ? json.flatMap((chunk) => chunk.results || []) : json.results || [];
}

function normalizeGoogleCampaign(row, customerId) {
  const metrics = row.metrics || {};
  const campaign = row.campaign || {};
  const spend = Number(metrics.costMicros || 0) / 1000000;
  const impressions = Number(metrics.impressions || 0);
  const clicks = Number(metrics.clicks || 0);
  const conversions = Number(metrics.conversions || 0);
  const revenue = Number(metrics.conversionsValue || 0);

  return {
    accountId: customerId,
    name: campaign.name || campaign.id || "Кампания Google",
    platform: "Google",
    spend,
    impressions,
    clicks,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
    revenue,
    conversions,
    status: campaign.status || "UNKNOWN",
  };
}

function normalizeGoogleTarget(row, customerId) {
  const adGroup = row.adGroup || {};
  const criterion = row.adGroupCriterion || {};
  const keyword = criterion.keyword?.text;
  const audience = criterion.userList?.userList || criterion.audience?.audience;
  const topic = criterion.topic?.path?.join(" > ");
  const placement = criterion.placement?.url;
  const criterionText = keyword || audience || topic || placement || criterion.type || "Targeting";

  return {
    accountId: customerId,
    platform: "Google",
    campaign: row.campaign?.name || row.campaign?.id || "Кампания Google",
    group: adGroup.name || adGroup.id || "Google ad group",
    status: criterion.status || adGroup.status || "UNKNOWN",
    geo: "See location criteria",
    age: criterion.ageRange?.type || "all",
    gender: criterion.gender?.type || "all",
    interests: criterionText,
    placements: row.campaign?.advertisingChannelType || "Google Ads",
    optimization: row.campaign?.biddingStrategyType || "n/a",
    budget: 0,
  };
}

async function getGoogleAdsDashboard(range) {
  const configured = Boolean(
    GOOGLE_ADS_DEVELOPER_TOKEN && GOOGLE_ADS_ACCESS_TOKEN && GOOGLE_ADS_CUSTOMER_IDS.length
  );

  if (!configured) {
    return {
      googleConfigured: false,
      googleConnected: false,
      accounts: [],
      campaigns: [],
      targets: [],
    };
  }

  const rangeValue = dateRange(range);
  const accounts = GOOGLE_ADS_CUSTOMER_IDS.map((id) => ({
    id,
    platform: "Google",
    name: `Google Ads ${id}`,
    status: "good",
    budget: 1,
  }));
  const campaigns = [];
  const targets = [];
  let googleHadError = false;

  for (const customerId of GOOGLE_ADS_CUSTOMER_IDS) {
    try {
      const campaignRows = await googleAdsSearch(
        customerId,
        `
          SELECT
            campaign.id,
            campaign.name,
            campaign.status,
            campaign.advertising_channel_type,
            campaign.bidding_strategy_type,
            metrics.cost_micros,
            metrics.conversions,
            metrics.conversions_value,
            metrics.clicks,
            metrics.impressions
          FROM campaign
          WHERE segments.date BETWEEN '${rangeValue.since}' AND '${rangeValue.until}'
          ORDER BY metrics.cost_micros DESC
          LIMIT 100
        `
      );

      for (const row of campaignRows) {
        campaigns.push(normalizeGoogleCampaign(row, customerId));
      }
    } catch (error) {
      googleHadError = true;
      campaigns.push({
        accountId: customerId,
        name: `Ошибка отчета Google: ${error.message}`,
        platform: "Google",
        spend: 0,
        revenue: 0,
        conversions: 0,
        status: "Review",
      });
    }

    try {
      const targetRows = await googleAdsSearch(
        customerId,
        `
          SELECT
            campaign.id,
            campaign.name,
            campaign.status,
            campaign.advertising_channel_type,
            campaign.bidding_strategy_type,
            ad_group.id,
            ad_group.name,
            ad_group.status,
            ad_group_criterion.criterion_id,
            ad_group_criterion.status,
            ad_group_criterion.type,
            ad_group_criterion.keyword.text,
            ad_group_criterion.age_range.type,
            ad_group_criterion.gender.type,
            ad_group_criterion.placement.url,
            ad_group_criterion.topic.path,
            ad_group_criterion.user_list.user_list,
            ad_group_criterion.audience.audience
          FROM ad_group_criterion
          WHERE ad_group_criterion.negative = false
          LIMIT 200
        `
      );

      for (const row of targetRows) {
        targets.push(normalizeGoogleTarget(row, customerId));
      }
    } catch (error) {
      googleHadError = true;
      targets.push({
        accountId: customerId,
        platform: "Google",
        campaign: "Google Ads",
        group: `Ошибка таргетинга: ${error.message}`,
        status: "Review",
        geo: "-",
        age: "-",
        gender: "-",
        interests: "-",
        placements: "-",
        optimization: "-",
        budget: 0,
      });
    }
  }

  const totalSpend = campaigns.reduce((sum, campaign) => sum + campaign.spend, 0);
  accounts.forEach((account) => {
    const spend = campaigns
      .filter((campaign) => campaign.accountId === account.id)
      .reduce((sum, campaign) => sum + campaign.spend, 0);
    account.budget = Math.max(spend * 1.35, totalSpend || 1);
  });

  return {
    googleConfigured: true,
    googleConnected: !googleHadError,
    accounts,
    campaigns,
    targets,
  };
}

function getConnectionSummary() {
  return {
    meta: {
      configured: Boolean((META_APP_ID && META_APP_SECRET) || META_ACCESS_TOKEN),
      connected: Boolean(getSession()?.accessToken),
    },
    tiktok: {
      configured: Boolean((TIKTOK_APP_ID && TIKTOK_APP_SECRET) || TIKTOK_ACCESS_TOKEN),
      connected: Boolean(getTikTokSession()?.accessToken),
    },
    google: {
      configured: Boolean(
        GOOGLE_ADS_DEVELOPER_TOKEN &&
          GOOGLE_ADS_ACCESS_TOKEN &&
          GOOGLE_ADS_CUSTOMER_IDS.length
      ),
      connected: false,
    },
  };
}

function handleTikTokConnect(res) {
  if (!TIKTOK_APP_ID || !TIKTOK_REDIRECT_URI) {
    sendText(res, 400, "TikTok не настроен. Заполни TIKTOK_APP_ID и TIKTOK_REDIRECT_URI в .env.");
    return;
  }

  const authUrl = new URL("https://business-api.tiktok.com/portal/auth");
  authUrl.searchParams.set("app_id", TIKTOK_APP_ID);
  authUrl.searchParams.set("state", "ads_dashboard");
  authUrl.searchParams.set("redirect_uri", TIKTOK_REDIRECT_URI);

  res.writeHead(302, { Location: authUrl.toString() });
  res.end();
}

async function handleTikTokExchange(req, res) {
  if (!TIKTOK_APP_ID || !TIKTOK_APP_SECRET) {
    sendText(res, 400, "TikTok app credentials are missing in .env.");
    return;
  }

  const url = new URL(req.url, BASE_URL);
  const code = url.searchParams.get("code") || url.searchParams.get("auth_code");
  if (!code) {
    sendText(res, 400, "Missing TikTok auth code. Open /api/tiktok/exchange?code=PASTE_CODE");
    return;
  }

  const token = await tiktokPost("/oauth2/access_token/", {
    app_id: TIKTOK_APP_ID,
    secret: TIKTOK_APP_SECRET,
    auth_code: code,
  });

  saveTikTokSession({
    accessToken: token.access_token,
    advertiserIds: token.advertiser_ids || TIKTOK_ADVERTISER_IDS,
    connectedAt: new Date().toISOString(),
  });

  res.writeHead(302, { Location: "/" });
  res.end();
}

async function handleMetaConnect(res) {
  if (!requireMetaConfig(res)) return;

  const oauthState = crypto.randomBytes(18).toString("hex");
  saveMetaOauthState(oauthState);
  const redirectUri = `${BASE_URL}/api/meta/callback`;
  const authUrl = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
  authUrl.searchParams.set("client_id", META_APP_ID);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", oauthState);
  authUrl.searchParams.set("scope", "ads_read");

  res.writeHead(302, { Location: authUrl.toString() });
  res.end();
}

async function handleMetaCallback(req, res) {
  if (!requireMetaConfig(res)) return;

  const url = new URL(req.url, BASE_URL);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !isValidMetaOauthState(state)) {
    sendText(res, 400, "Invalid Meta OAuth callback. Open /api/meta/connect again and complete the newest Meta login tab.");
    return;
  }

  const tokenUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`);
  tokenUrl.searchParams.set("client_id", META_APP_ID);
  tokenUrl.searchParams.set("client_secret", META_APP_SECRET);
  tokenUrl.searchParams.set("redirect_uri", `${BASE_URL}/api/meta/callback`);
  tokenUrl.searchParams.set("code", code);

  const shortResponse = await fetch(tokenUrl);
  const shortToken = await shortResponse.json();
  if (!shortResponse.ok) {
    sendJson(res, 400, shortToken);
    return;
  }

  const longUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`);
  longUrl.searchParams.set("grant_type", "fb_exchange_token");
  longUrl.searchParams.set("client_id", META_APP_ID);
  longUrl.searchParams.set("client_secret", META_APP_SECRET);
  longUrl.searchParams.set("fb_exchange_token", shortToken.access_token);

  const longResponse = await fetch(longUrl);
  const longToken = await longResponse.json();
  if (!longResponse.ok) {
    sendJson(res, 400, longToken);
    return;
  }

  saveSession({
    accessToken: longToken.access_token,
    expiresIn: longToken.expires_in,
    connectedAt: new Date().toISOString(),
  });
  clearMetaOauthState();

  res.writeHead(302, { Location: "/" });
  res.end();
}

function serveStatic(req, res) {
  const url = new URL(req.url, BASE_URL);
  if (url.pathname === "/unified" || url.pathname.startsWith("/unified/")) {
    const unifiedPath = url.pathname === "/unified" || url.pathname === "/unified/"
      ? "/index.html"
      : url.pathname.replace(/^\/unified/, "");
    const safeUnifiedPath = path.normalize(unifiedPath);
    const unifiedFilePath = path.join(UNIFIED_DASHBOARD_DIR, safeUnifiedPath);

    if (
      !unifiedFilePath.startsWith(UNIFIED_DASHBOARD_DIR) ||
      !fs.existsSync(unifiedFilePath) ||
      fs.statSync(unifiedFilePath).isDirectory()
    ) {
      sendText(res, 404, "Not found");
      return;
    }

    const ext = path.extname(unifiedFilePath);
    res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
    fs.createReadStream(unifiedFilePath).pipe(res);
    return;
  }

  const safePath = path.normalize(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.join(__dirname, safePath);

  if (!filePath.startsWith(__dirname) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendText(res, 404, "Not found");
    return;
  }

  const ext = path.extname(filePath);
  res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, BASE_URL);

    if (url.pathname === "/health") {
      sendJson(res, 200, { ok: true, service: "kau-ads-service", fetchedAt: new Date().toISOString() });
      return;
    }

    if (url.pathname === "/api/status") {
      sendJson(res, 200, {
        platforms: getConnectionSummary(),
        metaConfigured: Boolean((META_APP_ID && META_APP_SECRET) || META_ACCESS_TOKEN),
        metaConnected: Boolean(getSession()?.accessToken),
        tokenSource: getSession()?.source || (getSession()?.accessToken ? "oauth" : "none"),
        accountMode: META_AD_ACCOUNT_IDS.length ? "env accounts" : "all accessible accounts",
      });
      return;
    }

    if (url.pathname === "/api/dashboard") {
      sendJson(res, 200, await getDashboard(url.searchParams.get("range") || "today"));
      return;
    }

    if (url.pathname === "/api/unified") {
      const range = url.searchParams.get("range") || "7d";
      const [ads, status, summary, accounts, comparison, trends, digest, mentions, crmConfig, crm] = await Promise.all([
        fetchUnifiedJson(`${BASE_URL}/api/dashboard?range=${encodeURIComponent(range)}`, 25000),
        fetchUnifiedJson("http://127.0.0.1:8899/api/status", 10000),
        fetchUnifiedJson("http://127.0.0.1:8899/api/summary", 12000),
        fetchUnifiedJson("http://127.0.0.1:8899/api/livedune/accounts", 12000),
        fetchUnifiedJson("http://127.0.0.1:8899/api/livedune/comparison", 12000),
        fetchUnifiedJson("http://127.0.0.1:8899/api/trends/university", 12000),
        fetchUnifiedJson("http://127.0.0.1:8899/api/kazakhstan/digest", 12000),
        fetchUnifiedJson("http://127.0.0.1:8899/api/kau/mentions", 12000),
        fetchUnifiedJson("http://localhost:8787/api/config", 12000),
        fetchUnifiedJson(`http://localhost:8787/api/deal-dashboard?range=${encodeURIComponent(range)}`, 45000),
      ]);
      const data = { ads, status, summary, accounts, comparison, trends, digest, mentions, crmConfig, crm };
      sendJson(res, 200, {
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
        insights: buildUnifiedInsights(data),
      });
      return;
    }

    if (url.pathname === "/api/google/test") {
      sendJson(res, 200, await getGoogleAdsDashboard(url.searchParams.get("range") || "today"));
      return;
    }

    if (url.pathname === "/api/meta/connect") {
      await handleMetaConnect(res);
      return;
    }

    if (url.pathname === "/api/meta/callback") {
      await handleMetaCallback(req, res);
      return;
    }

    if (url.pathname === "/api/tiktok/connect") {
      handleTikTokConnect(res);
      return;
    }

    if (url.pathname === "/api/tiktok/exchange") {
      await handleTikTokExchange(req, res);
      return;
    }

    serveStatic(req, res);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`Ads dashboard running at ${BASE_URL}`);
});
