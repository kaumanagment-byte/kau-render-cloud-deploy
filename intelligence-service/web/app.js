const state = {
  tag: "",
  q: "",
  view: "livedune",
  summary: null,
  livedune: null,
  comparison: null,
  trends: null,
  digest: null,
};

const tagLabels = {
  education: "Образование",
  kazakhstan: "Казахстан",
  ai: "AI",
  kau_brand: "KAU",
  admissions: "Admissions",
  labor_market: "Рынок труда",
  competitor: "Конкуренты",
};

const viewMeta = {
  livedune: {
    title: "LiveDune дашборд KAU",
    eyebrow: "Social analytics desk",
    mode: "livedune",
  },
  own: {
    title: "Мои аккаунты",
    eyebrow: "Own account dashboards",
    mode: "livedune",
  },
  compare: {
    title: "Сравнение из аналитики",
    eyebrow: "Competitor comparison",
    mode: "livedune",
  },
  universityTrends: {
    title: "Тренды соцсетей для университетов",
    eyebrow: "AI trend agent",
    mode: "trends",
  },
  kazakhstanDigest: {
    title: "Казахстан СМИ",
    eyebrow: "Kazakhstan media digest",
    mode: "digest",
  },
  signals: {
    title: "Рынок и новости",
    eyebrow: "Real-time signal desk",
    mode: "signals",
    tag: "",
  },
  mentions: {
    title: "Упоминания KAU",
    eyebrow: "Reputation monitor",
    mode: "signals",
    tag: "kau_brand",
  },
};

const $ = (id) => document.getElementById(id);

async function api(path, options) {
  const response = await fetch(path, options);
  if (!response.ok) throw new Error(`API error ${response.status}`);
  return response.json();
}

function formatDate(value) {
  if (!value) return "-";
  const normalized = String(value).replace(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
    "$1-$2-$3T$4:$5:$6Z"
  );
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" });
}

function compactNumber(value) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function percent(value) {
  if (value === null || value === undefined) return "—";
  return `${Number(value).toFixed(2)}%`;
}

function labelTag(tag) {
  return tagLabels[tag] || tag;
}

async function loadStatus() {
  const status = await api("/api/status");
  $("statusDot").classList.toggle("ok", status.livedune_configured);
  $("statusText").textContent = status.livedune_configured
    ? "LiveDune подключен скрыто"
    : "LiveDune ждет .env";
  return status;
}

async function loadSummary() {
  const summary = await api("/api/summary");
  state.summary = summary;
  renderTagTabs(summary.tag_counts || {});
  renderBars(summary.tag_counts || {});
  renderSources(summary.source_counts || {});
  return summary;
}

async function loadLiveDune() {
  const [accounts, comparison] = await Promise.all([
    api("/api/livedune/accounts"),
    api("/api/livedune/comparison"),
  ]);
  state.livedune = accounts;
  state.comparison = comparison;
  renderLiveDune(accounts, comparison);
}

async function loadTrends() {
  state.trends = await api("/api/trends/university");
  renderTrends(state.trends);
}

async function loadDigest() {
  state.digest = await api("/api/kazakhstan/digest");
  renderDigest(state.digest);
}

function renderMetrics() {
  const own = state.livedune?.own_accounts || [];
  const competitors = state.livedune?.competitors || [];
  const allAccounts = [...own, ...competitors];
  const connectedRows = allAccounts.filter((account) => account.has_live_data).length;

  if (viewMeta[state.view].mode === "signals") {
    $("metricOneLabel").textContent = "Всего сигналов";
    $("metricOne").textContent = state.summary?.total_news || 0;
    $("metricTwoLabel").textContent = "Упоминания KAU";
    $("metricTwo").textContent = state.summary?.kau_mentions || 0;
    $("metricThreeLabel").textContent = "Средняя релевантность";
    $("metricThree").textContent = state.summary?.average_relevance || 0;
    $("metricFourLabel").textContent = "Последний сигнал";
    $("metricFour").textContent = formatDate(state.summary?.latest_signal);
    return;
  }

  if (viewMeta[state.view].mode === "trends") {
    const high = (state.trends?.topics || []).filter((topic) => topic.potential === "high").length;
    const rising = (state.trends?.topics || []).filter((topic) => topic.trend === "rising").length;
    $("metricOneLabel").textContent = "Темы в мониторинге";
    $("metricOne").textContent = state.trends?.topics?.length || 0;
    $("metricTwoLabel").textContent = "Высокий потенциал";
    $("metricTwo").textContent = high;
    $("metricThreeLabel").textContent = "Восходящие";
    $("metricThree").textContent = rising;
    $("metricFourLabel").textContent = "Платформы live";
    $("metricFour").textContent = (state.trends?.platforms || []).filter((platform) => platform.status === "live").length;
    return;
  }

  if (viewMeta[state.view].mode === "digest") {
    $("metricOneLabel").textContent = "Материалов СМИ";
    $("metricOne").textContent = state.digest?.total || 0;
    $("metricTwoLabel").textContent = "Источников";
    $("metricTwo").textContent = state.digest?.sources?.length || 0;
    $("metricThreeLabel").textContent = "Тем";
    $("metricThree").textContent = state.digest?.themes?.length || 0;
    $("metricFourLabel").textContent = "Топ источник";
    $("metricFour").textContent = state.digest?.sources?.[0]?.source || "—";
    return;
  }

  const ownHandles = own.reduce((sum, account) => sum + account.social_accounts.length, 0);
  const competitorHandles = competitors.reduce((sum, account) => sum + account.social_accounts.length, 0);
  $("metricOneLabel").textContent = "Мои аккаунты";
  $("metricOne").textContent = ownHandles;
  $("metricTwoLabel").textContent = "Конкурентные аккаунты";
  $("metricTwo").textContent = competitorHandles;
  $("metricThreeLabel").textContent = "LiveDune метрики";
  $("metricThree").textContent = connectedRows ? connectedRows : "—";
  $("metricFourLabel").textContent = "Статус";
  $("metricFour").textContent = connectedRows ? "Live" : "Setup";
}

function renderLiveDune(accounts, comparison) {
  const own = accounts.own_accounts || [];
  const competitors = accounts.competitors || [];
  $("ownCount").textContent = `${own.length} брендов`;
  $("comparisonCount").textContent = `${comparison.rows.length} строк`;

  $("ownAccounts").innerHTML = own.length
    ? own.map((account) => renderAccountCard(account, true)).join("")
    : `<div class="empty">Добавьте свои аккаунты в config.example.json</div>`;

  $("competitorAccounts").innerHTML = competitors.length
    ? competitors.map((account) => renderMiniAccount(account)).join("")
    : `<div class="empty">Конкуренты не настроены</div>`;

  $("comparisonRows").innerHTML = comparison.rows.length
    ? comparison.rows.map(renderComparisonRow).join("")
    : `<tr><td colspan="8" class="table-empty">Нет строк для сравнения</td></tr>`;
}

function renderTrends(data) {
  $("trendUpdated").textContent = `обновлено ${formatDate(data.updated_at)}`;
  $("trendGrid").innerHTML = data.topics.length
    ? data.topics.map(renderTrendCard).join("")
    : `<div class="empty">Тренды пока не найдены</div>`;
  $("platformGrid").innerHTML = data.platforms.map(renderPlatform).join("");
}

function renderDigest(data) {
  $("digestUpdated").textContent = `обновлено ${formatDate(data.updated_at)}`;
  $("digestSources").innerHTML = data.sources.length
    ? data.sources.map(renderDigestSource).join("")
    : `<div class="empty">Пока нет материалов из казахстанских СМИ. Запустите сбор данных.</div>`;
  $("digestThemes").innerHTML = data.themes.length
    ? data.themes.map(renderDigestTheme).join("")
    : `<div class="empty">Темы пока не распознаны</div>`;
  $("digestTop").innerHTML = data.top.length
    ? data.top.map(renderNewsItem).join("")
    : `<div class="empty">Нет материалов</div>`;
}

function renderDigestSource(source) {
  const links = source.top
    .slice(0, 3)
    .map((item) => `<a href="${item.url}" target="_blank" rel="noreferrer">${escapeHtml(item.title)}</a>`)
    .join("");
  return `
    <article class="digest-card">
      <div class="digest-card-head">
        <h3>${escapeHtml(source.source)}</h3>
        <strong>${source.count}</strong>
      </div>
      <p>${escapeHtml(source.summary)}</p>
      <div class="digest-links">${links}</div>
    </article>
  `;
}

function renderDigestTheme(theme) {
  return `
    <article class="digest-theme">
      <div>
        <strong>${escapeHtml(theme.theme)}</strong>
        <span>${theme.count} материалов · релевантность ${theme.relevance}</span>
      </div>
      <p>${escapeHtml(theme.recommendation)}</p>
    </article>
  `;
}

function renderTrendCard(topic) {
  return `
    <article class="trend-card">
      <div class="trend-head">
        <div>
          <span class="status-pill ${topic.trend === "rising" ? "connected" : ""}">${trendLabel(topic.trend)}</span>
          <h3>${escapeHtml(topic.topic)}</h3>
        </div>
        <strong>${topic.mentions}</strong>
      </div>
      <div class="trend-stats">
        <span>релевантность ${topic.relevance}</span>
        <span>ER конкурентов ${percent(topic.avg_competitor_er)}</span>
        <span>потенциал ${potentialLabel(topic.potential)}</span>
      </div>
      <p>${escapeHtml(topic.why)}</p>
      <dl>
        <div><dt>Кто обсуждает</dt><dd>${escapeHtml(topic.who)}</dd></div>
        <div><dt>Прогноз</dt><dd>${escapeHtml(topic.forecast)}</dd></div>
        <div><dt>Что делать</dt><dd>${escapeHtml(topic.action)}</dd></div>
      </dl>
    </article>
  `;
}

function renderPlatform(platform) {
  return `
    <div class="platform-row">
      <strong>${escapeHtml(platform.name)}</strong>
      <span>${escapeHtml(platform.source)}</span>
      <em class="${platform.status === "live" ? "live" : ""}">${platform.status}</em>
    </div>
  `;
}

function renderAccountCard(account) {
  const summary = account.summary;
  const statusLabel = account.has_live_data ? "Live" : account.last_error ? "API 403" : "Setup";
  const handles = account.social_accounts
    .map(
      (item) => `
        <div class="handle-row">
          <span>${platformLabel(item.platform)}</span>
          <strong>@${escapeHtml(item.handle)}</strong>
          <em>${item.error ? `API ${item.error.status}` : item.captured_at ? formatDate(item.captured_at) : "ожидает LiveDune"}</em>
        </div>
      `
    )
    .join("");
  const error = account.last_error
    ? `<div class="api-warning">${escapeHtml(account.last_error.message)}</div>`
    : "";

  return `
    <article class="account-card ${account.has_live_data ? "live" : ""}">
      <div class="account-head">
        <div>
          <p class="eyebrow">${account.type === "own" ? "Own account" : "Competitor"}</p>
          <h3>${escapeHtml(account.name)}</h3>
        </div>
        <span class="live-badge ${account.last_error ? "error" : ""}">${statusLabel}</span>
      </div>
      <div class="social-metrics">
        <div><span>Подписчики</span><strong>${compactNumber(summary.followers)}</strong></div>
        <div><span>ER</span><strong>${percent(summary.engagement_rate)}</strong></div>
        <div><span>Посты</span><strong>${compactNumber(summary.posts)}</strong></div>
        <div><span>Взаимодействия</span><strong>${compactNumber(summary.interactions)}</strong></div>
      </div>
      ${error}
      <div class="handle-list">${handles}</div>
    </article>
  `;
}

function renderMiniAccount(account) {
  return `
    <article class="mini-account">
      <div>
        <strong>${escapeHtml(account.name)}</strong>
        <span>${account.social_accounts.map((item) => `${platformLabel(item.platform)} @${item.handle}`).join(" · ")}</span>
      </div>
      <em>${account.has_live_data ? "Live" : account.last_error ? `API ${account.last_error.status}` : "ожидает данные"}</em>
    </article>
  `;
}

function renderComparisonRow(row) {
  return `
    <tr>
      <td><strong>${escapeHtml(row.name)}</strong></td>
      <td>${row.type === "own" ? "Свой" : "Конкурент"}</td>
      <td>${row.accounts}</td>
      <td>${compactNumber(row.followers)}</td>
      <td>${percent(row.engagement_rate)}</td>
      <td>${compactNumber(row.posts)}</td>
      <td>${compactNumber(row.interactions)}</td>
      <td><span class="status-pill ${row.status === "connected" ? "connected" : row.status === "api_error" ? "error" : ""}">${row.status === "connected" ? "Live" : row.status === "api_error" ? `API ${row.error?.status || ""}` : "Setup"}</span></td>
    </tr>
  `;
}

function renderTagTabs(tags) {
  const html = [
    `<button class="tab ${state.tag === "" ? "active" : ""}" data-tag="">Все</button>`,
    ...Object.keys(tags).map(
      (tag) => `<button class="tab ${state.tag === tag ? "active" : ""}" data-tag="${tag}">${labelTag(tag)}</button>`
    ),
  ].join("");
  $("tagTabs").innerHTML = html;
  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.tag = button.dataset.tag;
      loadNews();
    });
  });
}

function renderBars(tags) {
  const entries = Object.entries(tags);
  if (!entries.length) {
    $("tagBars").innerHTML = `<div class="empty">Нет тегов</div>`;
    return;
  }
  const max = Math.max(...entries.map(([, count]) => count));
  $("tagBars").innerHTML = entries
    .map(([tag, count]) => {
      const width = Math.max(8, Math.round((count / max) * 100));
      return `
        <div class="bar-row">
          <span class="bar-label">${labelTag(tag)}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${width}%"></span></span>
          <span>${count}</span>
        </div>
      `;
    })
    .join("");
}

function renderSources(sources) {
  const entries = Object.entries(sources).slice(0, 8);
  if (!entries.length) {
    $("sourceList").innerHTML = `<div class="empty">Источники пока пустые</div>`;
    return;
  }
  $("sourceList").innerHTML = entries
    .map(
      ([source, count]) => `
        <div class="source-row">
          <span class="source-label" title="${escapeHtml(source)}">${escapeHtml(source)}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${Math.min(100, count * 18)}%"></span></span>
          <span>${count}</span>
        </div>
      `
    )
    .join("");
}

async function loadNews() {
  const params = new URLSearchParams();
  if (state.tag) params.set("tag", state.tag);
  if (state.q) params.set("q", state.q);
  const news = await api(`/api/news?${params.toString()}`);
  $("feedTitle").textContent = state.view === "mentions" ? "Упоминания KAU" : "Рыночные сигналы";
  $("feedCount").textContent = `${news.length} материалов`;
  $("newsList").innerHTML = news.length ? news.map(renderNewsItem).join("") : `<div class="empty">Ничего не найдено</div>`;
}

function renderNewsItem(item) {
  const tags = (item.tags || []).map((tag) => `<span class="chip">${labelTag(tag)}</span>`).join("");
  const summary = item.summary ? `<p class="summary">${escapeHtml(item.summary)}</p>` : "";
  return `
    <article class="news-item">
      <div class="news-meta">
        <span class="score">${item.relevance_score}</span>
        <span>${escapeHtml(item.source || "unknown")}</span>
        <span>${formatDate(item.published_at)}</span>
      </div>
      <a class="news-title" href="${item.url}" target="_blank" rel="noreferrer">${escapeHtml(item.title)}</a>
      ${summary}
      <div class="chip-row">${tags}</div>
    </article>
  `;
}

async function refreshAll() {
  await loadStatus();
  await Promise.all([loadSummary(), loadLiveDune(), loadTrends(), loadDigest()]);
  renderCurrentView();
}

function renderCurrentView() {
  const meta = viewMeta[state.view];
  $("pageTitle").textContent = meta.title;
  $("sectionEyebrow").textContent = meta.eyebrow;
  $("liveduneView").classList.toggle("hidden", meta.mode !== "livedune");
  $("signalsView").classList.toggle("hidden", meta.mode !== "signals");
  $("trendView").classList.toggle("hidden", meta.mode !== "trends");
  $("digestView").classList.toggle("hidden", meta.mode !== "digest");
  if (state.view === "own") {
    $("liveduneView").classList.add("focus-own");
    $("liveduneView").classList.remove("focus-compare");
  } else if (state.view === "compare") {
    $("liveduneView").classList.add("focus-compare");
    $("liveduneView").classList.remove("focus-own");
  } else {
    $("liveduneView").classList.remove("focus-own", "focus-compare");
  }
  if (meta.mode === "signals") {
    state.tag = meta.tag;
    loadNews();
  }
  renderMetrics();
}

function wireEvents() {
  $("refreshBtn").addEventListener("click", refreshAll);
  $("collectBtn").addEventListener("click", async () => {
    $("collectBtn").disabled = true;
    $("collectBtn").textContent = "Сбор идет";
    try {
      await api("/api/collect", { method: "POST" });
      await refreshAll();
    } finally {
      $("collectBtn").disabled = false;
      $("collectBtn").textContent = "Собрать данные";
    }
  });

  $("searchInput").addEventListener("input", (event) => {
    state.q = event.target.value.trim();
    window.clearTimeout(window.searchTimer);
    window.searchTimer = window.setTimeout(loadNews, 180);
  });

  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      state.view = button.dataset.view;
      renderCurrentView();
    });
  });
}

function platformLabel(platform) {
  const labels = {
    instagram: "Instagram",
    facebook: "Facebook",
    tiktok: "TikTok",
    youtube: "YouTube",
    telegram: "Telegram",
  };
  return labels[platform] || platform;
}

function trendLabel(value) {
  return {
    rising: "Восходящий",
    stable: "Стабильный",
    emerging: "Наблюдать",
  }[value] || value;
}

function potentialLabel(value) {
  return {
    high: "высокий",
    medium: "средний",
    watch: "наблюдать",
  }[value] || value;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

wireEvents();
refreshAll();
