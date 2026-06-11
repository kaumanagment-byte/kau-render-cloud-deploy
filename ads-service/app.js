const platforms = ["Meta", "Google", "TikTok"];
const demoAccounts = [
  { id: "meta-1", platform: "Meta", name: "Meta - Казахстан", status: "good", budget: 18000 },
  { id: "meta-2", platform: "Meta", name: "Meta - Ретаргетинг", status: "warn", budget: 8200 },
  { id: "google-1", platform: "Google", name: "Google Ads - Поиск", status: "good", budget: 24000 },
  { id: "google-2", platform: "Google", name: "Google Ads - Performance Max", status: "good", budget: 16000 },
  { id: "tiktok-1", platform: "TikTok", name: "TikTok - Видео тесты", status: "warn", budget: 10500 },
];

const demoCampaigns = [
  { accountId: "meta-1", name: "Лиды - широкий таргетинг Advantage+", platform: "Meta", spend: 1840, revenue: 6120, conversions: 74, status: "Scaling" },
  { accountId: "meta-2", name: "Ретаргетинг - посетители 14 дней", platform: "Meta", spend: 640, revenue: 2040, conversions: 31, status: "Watch" },
  { accountId: "google-1", name: "Поиск - высокий спрос", platform: "Google", spend: 2260, revenue: 9180, conversions: 88, status: "Scaling" },
  { accountId: "google-2", name: "PMax - каталог", platform: "Google", spend: 1320, revenue: 4310, conversions: 46, status: "Stable" },
  { accountId: "tiktok-1", name: "Spark Ads - UGC тесты", platform: "TikTok", spend: 980, revenue: 2430, conversions: 29, status: "Testing" },
];

const demoTargets = [
  {
    accountId: "meta-1",
    platform: "Meta",
    campaign: "Лиды - широкий таргетинг Advantage+",
    group: "Широкая 25-45 KZ",
    status: "ACTIVE",
    geo: "Казахстан, Алматы",
    age: "25-45",
    gender: "все",
    interests: "Широкая / Advantage",
    placements: "Автоматические",
    optimization: "LEADS",
    budget: 120,
  },
  {
    accountId: "meta-2",
    platform: "Meta",
    campaign: "Ретаргетинг - посетители 14 дней",
    group: "Посетители сайта 14 дней",
    status: "ACTIVE",
    geo: "Казахстан",
    age: "18-65",
    gender: "все",
    interests: "Пользовательская аудитория",
    placements: "Facebook, Instagram",
    optimization: "CONVERSIONS",
    budget: 55,
  },
  {
    accountId: "google-1",
    platform: "Google",
    campaign: "Поиск - высокий спрос",
    group: "Бренд + сервисные ключи",
    status: "ENABLED",
    geo: "Казахстан",
    age: "все",
    gender: "все",
    interests: "Ключи: купить, цена, услуга",
    placements: "Поиск",
    optimization: "Конверсии",
    budget: 180,
  },
  {
    accountId: "tiktok-1",
    platform: "TikTok",
    campaign: "Spark Ads - UGC тесты",
    group: "Тест интересов 18-34",
    status: "ENABLE",
    geo: "Казахстан",
    age: "18-34",
    gender: "все",
    interests: "Вовлечение в видео, покупательское поведение",
    placements: "TikTok",
    optimization: "Conversion",
    budget: 90,
  },
];

let accounts = [...demoAccounts];
let campaigns = [...demoCampaigns];
let targets = [...demoTargets];
let trend = Array.from({ length: 16 }, (_, index) => ({
  label: `${index + 7}:00`,
  spend: 420 + index * 38 + Math.random() * 90,
  revenue: 880 + index * 91 + Math.random() * 220,
}));

let selectedPlatform = "all";
let searchQuery = "";
let selectedStatus = "all";
let selectedSpend = "all";
let activeView = "overview";
let syncCount = 0;
let apiMode = "demo";
let lastLiveFetchAt = 0;
const LIVE_REFRESH_MS = 5 * 60 * 1000;
let connectionState = {
  meta: { configured: false, connected: false },
  tiktok: { configured: false, connected: false },
  google: { configured: false, connected: false },
};
let usdKztRate = 486.76;
let exchangeRateMeta = { source: "fallback", date: "" };

const formatKzt = (value) =>
  new Intl.NumberFormat("ru-KZ", {
    style: "currency",
    currency: "KZT",
    maximumFractionDigits: 0,
  }).format(value);

const formatUsd = (value) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value < 10 ? 2 : 0,
  }).format(value);

const formatNumber = (value, digits = 1) =>
  new Intl.NumberFormat("ru-KZ", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);

const priorityClassMap = {
  Высокий: "high",
  Средний: "medium",
  Настройка: "setup",
  Инфо: "info",
};

function isUsdPlatform(platform) {
  return platform === "Meta" || platform === "Google";
}

function amountToKzt(value, platform) {
  return isUsdPlatform(platform) ? value * usdKztRate : value;
}

function formatPlatformMoney(value, platform) {
  if (isUsdPlatform(platform)) {
    return `${formatUsd(value)} (${formatKzt(value * usdKztRate)})`;
  }
  return formatKzt(value);
}

function formatMixedKzt(value) {
  return formatKzt(value);
}

function formatCurrentViewMoney(value, platformOverride = selectedPlatform) {
  if (platformOverride !== "all") return formatPlatformMoney(value, platformOverride);
  return formatMixedKzt(value);
}

function renderRateBadge() {
  const badge = document.querySelector("#rateBadge");
  if (!badge) return;
  const rate = new Intl.NumberFormat("ru-KZ", { maximumFractionDigits: 2 }).format(usdKztRate);
  badge.textContent = `USD/KZT ${rate}`;
  badge.title = `Источник курса: ${exchangeRateMeta.source || "резервный курс"}`;
}

function isLiveStatus(status) {
  return /active|enable|enabled|live|scaling|stable|testing/i.test(String(status || ""));
}

function isReviewStatus(status) {
  return /watch|review|error|limited|needs/i.test(String(status || ""));
}

function isPausedStatus(status) {
  return /pause|paused|removed|deleted|inactive|disabled/i.test(String(status || ""));
}

function formatStatus(status) {
  const value = String(status || "");
  if (/watch|review|error|limited|needs/i.test(value)) return "Проверить";
  if (/live|active|enable|enabled|scaling|stable|testing/i.test(value)) return "Активно";
  if (/pause|paused|removed|deleted|inactive|disabled/i.test(value)) return "На паузе";
  if (value === "UNKNOWN") return "Неизвестно";
  return value;
}

function matchesStatus(status) {
  if (selectedStatus === "all") return true;
  if (selectedStatus === "active") return isLiveStatus(status);
  if (selectedStatus === "watch") return isReviewStatus(status);
  if (selectedStatus === "paused") return isPausedStatus(status);
  return true;
}

function includesSearch(...values) {
  if (!searchQuery) return true;
  return values
    .filter((value) => value !== undefined && value !== null)
    .some((value) => String(value).toLowerCase().includes(searchQuery));
}

function getVisibleCampaigns() {
  return campaigns.filter((campaign) => {
    const platformMatches = selectedPlatform === "all" || campaign.platform === selectedPlatform;
    const spendMatches =
      selectedSpend === "all" ||
      (selectedSpend === "with_spend" && Number(campaign.spend || 0) > 0) ||
      (selectedSpend === "no_spend" && Number(campaign.spend || 0) === 0);
    return (
      platformMatches &&
      spendMatches &&
      matchesStatus(campaign.status) &&
      includesSearch(campaign.name, campaign.platform, campaign.status, campaign.accountId)
    );
  });
}

function calculateSummary() {
  const visible = getVisibleCampaigns();
  const visibleTargets = getVisibleTargets();
  const spendKzt = visible.reduce((total, campaign) => total + amountToKzt(campaign.spend, campaign.platform), 0);
  const revenueKzt = visible.reduce((total, campaign) => total + amountToKzt(campaign.revenue, campaign.platform), 0);
  const spendRaw = visible.reduce((total, campaign) => total + campaign.spend, 0);
  const revenueRaw = visible.reduce((total, campaign) => total + campaign.revenue, 0);
  const conversions = visible.reduce((total, campaign) => total + campaign.conversions, 0);
  const activeTargets = visibleTargets.filter((target) => isLiveStatus(target.status)).length;
  return {
    spend: selectedPlatform === "all" ? spendKzt : spendRaw,
    revenue: selectedPlatform === "all" ? revenueKzt : revenueRaw,
    conversions,
    cpl: conversions > 0 ? (selectedPlatform === "all" ? spendKzt : spendRaw) / conversions : 0,
    activeTargets,
  };
}

function setNote(element, text, className = "positive") {
  element.textContent = text;
  element.className = className;
}

function renderMetrics() {
  const summary = calculateSummary();
  const visibleCampaigns = getVisibleCampaigns();
  const visibleTargets = getVisibleTargets();
  document.querySelector("#spendMetric").textContent = formatCurrentViewMoney(summary.spend);
  document.querySelector("#revenueMetric").textContent = formatNumber(summary.conversions, 0);
  document.querySelector("#roasMetric").textContent = summary.conversions ? formatCurrentViewMoney(summary.cpl) : "-";
  document.querySelector("#cpaMetric").textContent = formatNumber(summary.activeTargets, 0);

  setNote(document.querySelector("#spendDelta"), `${visibleCampaigns.length} кампаний`);
  setNote(document.querySelector("#revenueDelta"), "Лиды / конверсии из кабинетов");
  setNote(
    document.querySelector("#roasDelta"),
    summary.conversions ? "Цена за результат" : "Нет отслеженных результатов",
    summary.conversions ? "positive" : "negative"
  );
  setNote(document.querySelector("#cpaDelta"), `${visibleTargets.length} групп таргетинга`);
}

function renderAccounts() {
  const grid = document.querySelector("#accountGrid");
  const visibleAccounts = selectedPlatform === "all"
    ? accounts
    : accounts.filter((account) => account.platform === selectedPlatform);

  grid.innerHTML = visibleAccounts
    .map((account) => {
      const accountCampaigns = campaigns.filter((campaign) => campaign.accountId === account.id);
      const spend = accountCampaigns.reduce((total, campaign) => total + campaign.spend, 0);
      const conversions = accountCampaigns.reduce((total, campaign) => total + campaign.conversions, 0);
      const pacing = Math.min(100, Math.round((spend / account.budget) * 100));
      const cpl = conversions ? spend / conversions : 0;
      return `
        <article class="account-card">
          <div class="account-top">
            <div>
              <span class="platform-pill">${account.platform}</span>
              <h3>${account.name}</h3>
            </div>
            <span class="status-pill ${account.status}">${account.status === "good" ? "В норме" : "Проверить"}</span>
          </div>
          <div class="mini-metrics">
            <div><span>Расход</span><strong>${formatPlatformMoney(spend, account.platform)}</strong></div>
            <div><span>CPL</span><strong>${conversions ? formatPlatformMoney(cpl, account.platform) : "-"}</strong></div>
            <div><span>Конв.</span><strong>${conversions}</strong></div>
          </div>
          <div class="progress" title="Темп расхода бюджета"><span style="width:${pacing}%"></span></div>
        </article>
      `;
    })
    .join("");
}

function renderHealth() {
  const list = document.querySelector("#healthList");
  const items = accounts
    .filter((account) => selectedPlatform === "all" || account.platform === selectedPlatform)
    .map((account) => {
      const spend = campaigns
        .filter((campaign) => campaign.accountId === account.id)
        .reduce((total, campaign) => total + campaign.spend, 0);
      const pacing = Math.min(100, Math.round((spend / account.budget) * 100));
      return `
        <div class="health-item">
          <div class="health-top">
            <span>${account.name}</span>
            <span>${pacing}%</span>
          </div>
          <div class="progress"><span style="width:${pacing}%; background:${pacing > 85 ? "var(--amber)" : "var(--accent)"}"></span></div>
        </div>
      `;
    });
  list.innerHTML = items.join("");
}

function renderIntegrationStatus() {
  const statusMap = {
    metaStatus: connectionState.meta,
    tiktokStatus: connectionState.tiktok,
    googleStatus: connectionState.google,
  };

  Object.entries(statusMap).forEach(([id, state]) => {
    const element = document.querySelector(`#${id}`);
    if (!element) return;
    const hasGoogleApiError =
      id === "googleStatus" &&
      campaigns.some((campaign) => campaign.platform === "Google" && /error|ошибка|not approved|permission|access|HTTP 403/i.test(campaign.name));
    const hasMetaExpiredToken =
      id === "metaStatus" &&
      campaigns.some((campaign) => campaign.platform === "Meta" && /expired|истек|validating access token|OAuthException/i.test(campaign.name));
    const hasMetaRateLimit =
      id === "metaStatus" &&
      campaigns.some((campaign) => campaign.platform === "Meta" && /request limit|лимит|too many/i.test(campaign.name));
    if (hasMetaRateLimit) {
      element.textContent = "Лимит API";
      element.className = "warning";
      return;
    }
    if (hasMetaExpiredToken) {
      element.textContent = "Токен истек";
      element.className = "warning";
      return;
    }
    if (hasGoogleApiError) {
      element.textContent = "Нужно одобрение";
      element.className = "warning";
      return;
    }
    if (state.connected) {
      element.textContent = "Подключено";
      element.className = "connected";
    } else if (state.configured) {
      element.textContent = "Нужна авторизация";
      element.className = "warning";
    } else {
      element.textContent = "Не настроено";
      element.className = "muted";
    }
  });
}

function buildRecommendations() {
  const visibleCampaigns = getVisibleCampaigns();
  const visibleTargets = getVisibleTargets();
  const recommendations = [];
  const spendByPlatform = visibleCampaigns.reduce((result, campaign) => {
    result[campaign.platform] = (result[campaign.platform] || 0) + campaign.spend;
    return result;
  }, {});

  visibleCampaigns
    .filter((campaign) => campaign.spend > 0 && campaign.conversions === 0)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 4)
    .forEach((campaign) => {
      recommendations.push({
        priority: "Высокий",
        title: `Проверить расход без конверсий: ${campaign.name}`,
        body: `${campaign.platform}: расход ${formatPlatformMoney(campaign.spend, campaign.platform)}, но конверсии не пришли. Проверь события, цель кампании и путь посадочной страницы перед масштабированием.`,
      });
    });

  visibleTargets
    .filter((target) => String(target.status).toLowerCase().includes("active") && target.budget === 0)
    .slice(0, 3)
    .forEach((target) => {
      recommendations.push({
        priority: "Средний",
        title: `Проверить бюджет активной группы: ${target.group}`,
        body: `${target.platform}: активная группа без дневного бюджета в ответе API. Проверь, бюджет стоит на уровне кампании или группа не откручивается.`,
      });
    });

  visibleTargets
    .filter((target) => /Broad|Advantage|all/i.test(`${target.geo} ${target.interests}`))
    .slice(0, 3)
    .forEach((target) => {
      recommendations.push({
        priority: "Средний",
        title: `Разделить широкий таргетинг: ${target.group}`,
        body: `${target.platform}: используется широкий таргетинг. Раздели по возрасту родителей/абитуриентов или по городам, чтобы сравнить CPA и качество заявок.`,
      });
    });

  Object.entries(spendByPlatform)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 1)
    .forEach(([platform, spend]) => {
      if (spend > 0) {
        recommendations.push({
          priority: "Инфо",
          title: `${platform}: основной расход`,
          body: `${platform} дает самый большой расход в текущем срезе: ${formatPlatformMoney(spend, platform)}. Сначала проверь слабые кампании и группы через фильтр платформы.`,
        });
      }
    });

  if (!connectionState.google.connected) {
    recommendations.push({
      priority: "Настройка",
      title: "Завершить одобрение Google Ads API",
      body: "Коннектор Google Ads готов, но developer token должен получить Basic или Standard access, прежде чем реальные данные аккаунта загрузятся.",
    });
  }

  if (
    visibleCampaigns.some(
      (campaign) => campaign.platform === "Meta" && /expired|истек|validating access token|OAuthException/i.test(campaign.name)
    )
  ) {
    recommendations.unshift({
      priority: "Настройка",
      title: "Обновить токен Meta",
      body: "Токен Meta в .env истек. Используй OAuth-подключение или замени META_ACCESS_TOKEN на свежий токен с ads_read.",
    });
  }

  if (
    visibleCampaigns.some(
      (campaign) => campaign.platform === "Meta" && /request limit|лимит|too many/i.test(campaign.name)
    )
  ) {
    recommendations.unshift({
      priority: "Настройка",
      title: "Meta временно ограничила запросы",
      body: "Авторизация Meta работает, но API вернул лимит запросов. Я уменьшил автообновление до одного раза в 5 минут; подожди немного и обнови вручную позже.",
    });
  }

  return recommendations.slice(0, activeView === "alerts" ? 8 : 4);
}

function renderRecommendations() {
  const list = document.querySelector("#recommendationList");
  if (!list) return;
  const recommendations = buildRecommendations();

  list.innerHTML = recommendations
    .map(
      (item) => `
        <article class="recommendation-card">
          <span class="priority-pill ${priorityClassMap[item.priority] || "info"}">${item.priority}</span>
          <div>
            <strong>${item.title}</strong>
            <p>${item.body}</p>
          </div>
        </article>
      `
    )
    .join("");
}

function renderCampaignTable() {
  const tbody = document.querySelector("#campaignTable");
  const visibleCampaigns = getVisibleCampaigns();
  tbody.innerHTML = visibleCampaigns.length
    ? visibleCampaigns
    .map((campaign) => {
      const cpa = campaign.spend / Math.max(campaign.conversions, 1);
      return `
        <tr>
          <td><strong>${campaign.name}</strong></td>
          <td>${campaign.platform}</td>
          <td>${formatPlatformMoney(campaign.spend, campaign.platform)}</td>
          <td>${campaign.conversions}</td>
          <td>${formatPlatformMoney(cpa, campaign.platform)}</td>
          <td>${campaign.revenue ? formatPlatformMoney(campaign.revenue, campaign.platform) : "-"}</td>
          <td><span class="status-pill ${isReviewStatus(campaign.status) ? "warn" : "good"}">${formatStatus(campaign.status)}</span></td>
        </tr>
      `;
    })
    .join("")
    : `<tr><td colspan="7">По текущим фильтрам кампаний нет.</td></tr>`;
}

function getVisibleTargets() {
  return targets.filter((target) => {
    const platformMatches = selectedPlatform === "all" || target.platform === selectedPlatform;
    const spendMatches =
      selectedSpend === "all" ||
      (selectedSpend === "with_spend" && Number(target.budget || 0) > 0) ||
      (selectedSpend === "no_spend" && Number(target.budget || 0) === 0);
    return (
      platformMatches &&
      spendMatches &&
      matchesStatus(target.status) &&
      includesSearch(
        target.group,
        target.campaign,
        target.platform,
        target.geo,
        target.age,
        target.gender,
        target.interests,
        target.placements,
        target.optimization,
        target.status
      )
    );
  });
}

function renderTargetTable() {
  const tbody = document.querySelector("#targetTable");
  if (!tbody) return;

  const visibleTargets = getVisibleTargets();
  tbody.innerHTML = visibleTargets.length
    ? visibleTargets
    .map(
      (target) => `
        <tr>
          <td><strong>${target.group}</strong><span>${target.campaign}</span></td>
          <td>${target.platform}</td>
          <td>${target.geo}</td>
          <td>${target.age}</td>
          <td>${target.gender}</td>
          <td class="wrap-cell">${target.interests}</td>
          <td class="wrap-cell">${target.placements}</td>
          <td>${target.optimization}</td>
          <td>${target.budget ? formatPlatformMoney(target.budget, target.platform) : "-"}</td>
          <td><span class="status-pill ${String(target.status).toLowerCase().includes("active") || String(target.status).toLowerCase().includes("enable") ? "good" : "warn"}">${formatStatus(target.status)}</span></td>
        </tr>
      `
    )
    .join("")
    : `<tr><td colspan="10">По текущим фильтрам групп таргетинга нет.</td></tr>`;
}

function drawTrendChart() {
  const canvas = document.querySelector("#trendChart");
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const padding = 42;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 1.7;
  const visibleTrend = trend.map((point) => {
    const platformMultiplier = selectedPlatform === "all" ? 1 : 0.28 + platforms.indexOf(selectedPlatform) * 0.11;
    return {
      ...point,
      spend: point.spend * platformMultiplier,
      revenue: point.revenue * platformMultiplier,
    };
  });
  const maxValue = Math.max(...visibleTrend.flatMap((point) => [point.spend, point.revenue])) * 1.12;
  const maxSafeValue = Math.max(maxValue, 1);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "#d9e2e4";
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i += 1) {
    const y = padding + (chartHeight / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(width - padding, y);
    ctx.stroke();
  }

  function pointsFor(key) {
    return visibleTrend.map((point, index) => ({
      x: padding + (chartWidth / (visibleTrend.length - 1)) * index,
      y: padding + chartHeight - (point[key] / maxSafeValue) * chartHeight,
    }));
  }

  function drawLine(points, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();

    ctx.fillStyle = color;
    points.forEach((point) => {
      ctx.beginPath();
      ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  drawLine(pointsFor("spend"), "#3157a4");
  drawLine(pointsFor("revenue"), "#127c7a");

  ctx.fillStyle = "#657276";
  ctx.font = "13px Inter, sans-serif";
  ctx.fillText(visibleTrend[0].label, padding, height - 12);
  ctx.fillText(visibleTrend[visibleTrend.length - 1].label, width - padding - 42, height - 12);
}

function renderAll() {
  renderIntegrationStatus();
  renderRateBadge();
  renderMetrics();
  renderAccounts();
  renderHealth();
  renderCampaignTable();
  renderTargetTable();
  renderRecommendations();
  drawTrendChart();
}

function setActiveView(view) {
  activeView = view;
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });

  document.querySelectorAll("[data-views]").forEach((section) => {
    const views = String(section.dataset.views || "").split(/\s+/);
    section.hidden = !views.includes(view);
  });

  renderRecommendations();

  if (view === "charts") {
    drawTrendChart();
  }
}

function mergeApiData(payload) {
  const livePlatforms = new Set([
    ...(payload.accounts || []).map((item) => item.platform),
    ...(payload.campaigns || []).map((item) => item.platform),
    ...(payload.targets || []).map((item) => item.platform),
  ]);

  const demoAccountsToKeep = demoAccounts.filter((account) => !livePlatforms.has(account.platform));
  const demoCampaignsToKeep = demoCampaigns.filter((campaign) => !livePlatforms.has(campaign.platform));
  const demoTargetsToKeep = demoTargets.filter((target) => !livePlatforms.has(target.platform));

  accounts = [...(payload.accounts || []), ...demoAccountsToKeep];
  campaigns = [...(payload.campaigns || []), ...demoCampaignsToKeep];
  targets = [...(payload.targets || []), ...demoTargetsToKeep];

  if (payload.trend?.length) {
    trend = payload.trend;
  }
}

async function loadDashboardData() {
  if (!window.location.protocol.startsWith("http")) {
    apiMode = "demo";
    renderAll();
    return;
  }

  try {
    const range = document.querySelector("#rangeSelect").value;
    const response = await fetch(`/api/dashboard?range=${encodeURIComponent(range)}`);
    if (!response.ok) throw new Error(`API returned ${response.status}`);
    const payload = await response.json();
    lastLiveFetchAt = Date.now();
    connectionState = {
      meta: { configured: Boolean(payload.metaConfigured), connected: Boolean(payload.metaConnected) },
      tiktok: { configured: Boolean(payload.tiktokConfigured), connected: Boolean(payload.tiktokConnected) },
      google: { configured: Boolean(payload.googleConfigured), connected: Boolean(payload.googleConnected) },
    };
    if (payload.exchangeRate?.rate) {
      usdKztRate = Number(payload.exchangeRate.rate);
      exchangeRateMeta = payload.exchangeRate;
    }

    const hasAnyLiveData =
      (payload.metaConnected || payload.tiktokConnected || payload.googleConnected) &&
      ((payload.accounts || []).length || (payload.campaigns || []).length || (payload.targets || []).length);

    if (hasAnyLiveData) {
      mergeApiData(payload);
      apiMode = "live";
      document.querySelector("#syncText").textContent = "Реальные данные подключены";
    } else {
      apiMode = payload.metaConfigured || payload.tiktokConfigured || payload.googleConfigured ? "ready" : "demo";
      accounts = [...demoAccounts];
      campaigns = [...demoCampaigns];
      targets = [...demoTargets];
      document.querySelector("#syncText").textContent = apiMode === "ready"
        ? "API готов к подключению"
        : "Демо-режим";
    }
  } catch (error) {
    apiMode = "demo";
    accounts = [...demoAccounts];
    campaigns = [...demoCampaigns];
    targets = [...demoTargets];
    document.querySelector("#syncText").textContent = "Демо-режим";
  }

  renderAll();
}

function simulateRealtimeTick() {
  if (apiMode === "live") {
    const secondsAgo = Math.max(1, Math.round((Date.now() - lastLiveFetchAt) / 1000));
    document.querySelector("#syncText").textContent = `Обновлено ${secondsAgo} сек. назад`;
    if (Date.now() - lastLiveFetchAt >= LIVE_REFRESH_MS) {
      loadDashboardData();
    }
    return;
  }

  campaigns.forEach((campaign) => {
    const spendLift = 9 + Math.random() * 34;
    const roas = campaign.revenue / Math.max(campaign.spend, 1);
    campaign.spend += spendLift;
    campaign.revenue += spendLift * (roas + (Math.random() - 0.42));
    if (Math.random() > 0.62) campaign.conversions += 1;
  });

  trend.shift();
  const previous = trend[trend.length - 1];
  trend.push({
    label: "now",
    spend: previous.spend + 28 + Math.random() * 80,
    revenue: previous.revenue + 70 + Math.random() * 190,
  });

  syncCount += 1;
  document.querySelector("#syncText").textContent = `Обновлено ${syncCount * 5} сек. назад`;
  renderAll();
}

document.querySelectorAll(".filter-chip").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".filter-chip").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    selectedPlatform = button.dataset.platform;
    renderAll();
  });
});

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => {
    setActiveView(button.dataset.view || "overview");
  });
});

document.querySelector("#refreshButton").addEventListener("click", () => {
  syncCount = 0;
  document.querySelector("#syncText").textContent = "Только что обновлено";
  loadDashboardData();
});

document.querySelector("#connectButton").addEventListener("click", () => {
  if (window.location.protocol.startsWith("http")) {
    window.location.href = "/api/meta/connect";
    return;
  }

  document.querySelector("#connectDialog").showModal();
});

document.querySelector("#openMetaConnect").addEventListener("click", () => {
  if (window.location.protocol.startsWith("http")) {
    window.location.href = "/api/meta/connect";
    return;
  }

  document.querySelector("#connectDialog").showModal();
});

document.querySelector("#saveConnection").addEventListener("click", () => {
  localStorage.setItem("ads-dashboard-connection-draft", new Date().toISOString());
});

document.querySelector("#rangeSelect").addEventListener("change", loadDashboardData);

document.querySelector("#searchInput").addEventListener("input", (event) => {
  searchQuery = event.target.value.trim().toLowerCase();
  renderAll();
});

document.querySelector("#statusSelect").addEventListener("change", (event) => {
  selectedStatus = event.target.value;
  renderAll();
});

document.querySelector("#spendSelect").addEventListener("change", (event) => {
  selectedSpend = event.target.value;
  renderAll();
});

loadDashboardData();
setActiveView(activeView);
setInterval(simulateRealtimeTick, 5000);
