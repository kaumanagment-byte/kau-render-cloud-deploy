const state = {
  timer: null,
  config: null,
  dashboard: null,
  sortKey: "newLeft",
  sortDirection: "desc",
};

const els = {
  connectionDot: document.querySelector("#connection-dot"),
  connectionText: document.querySelector("#connection-text"),
  range: document.querySelector("#range"),
  managerFilter: document.querySelector("#manager-filter"),
  polling: document.querySelector("#polling"),
  refresh: document.querySelector("#refresh"),
  movedCount: document.querySelector("#moved-count"),
  movedDelta: document.querySelector("#moved-delta"),
  managerCount: document.querySelector("#manager-count"),
  movedManagers: document.querySelector("#moved-managers"),
  activeDeals: document.querySelector("#active-deals"),
  wonLost: document.querySelector("#won-lost"),
  lastUpdated: document.querySelector("#last-updated"),
  managersTable: document.querySelector("#managers-table"),
  sortButtons: document.querySelectorAll("[data-sort]"),
  stageTotal: document.querySelector("#stage-total"),
  stageList: document.querySelector("#stage-list"),
  recentList: document.querySelector("#recent-list"),
  rangeLabel: document.querySelector("#range-label"),
};

bootstrap();

async function bootstrap() {
  els.refresh.addEventListener("click", refresh);
  els.range.addEventListener("change", refresh);
  els.managerFilter.addEventListener("change", refresh);
  els.polling.addEventListener("change", schedule);
  els.sortButtons.forEach((button) => button.addEventListener("click", () => sortManagers(button.dataset.sort)));

  await loadConfig();
  await refresh();
  schedule();
}

async function loadConfig() {
  const config = await fetchJson("/api/config");
  state.config = config;
  els.polling.value = String(config.pollIntervalSeconds || 15);
  setConnection(config.configured ? "live" : "demo", config.configured ? "Webhook настроен" : "Демо-режим");
}

async function refresh() {
  try {
    const params = new URLSearchParams({ range: els.range.value });
    if (els.managerFilter.value) params.set("manager", els.managerFilter.value);

    const payload = await fetchJson(`/api/deal-dashboard?${params.toString()}`);
    state.dashboard = payload;
    syncManagerFilter(payload.users || [], payload.filters?.managerId || "");
    render(payload);
    setConnection(payload.mode === "live" ? "live" : "demo", "Сделки по дате изменения стадии");
  } catch (error) {
    console.error(error);
    setConnection("error", "Ошибка загрузки");
    els.lastUpdated.textContent = error.message;
  }
}

function schedule() {
  window.clearInterval(state.timer);
  state.timer = window.setInterval(refresh, Number(els.polling.value) * 1000);
}

function render(payload) {
  const summary = payload.summary || {};
  const delta = Number(summary.delta || 0);

  els.movedCount.textContent = formatNumber(summary.movedCount || 0);
  els.movedDelta.textContent = `${formatDelta(delta)} к прошлому периоду`;
  els.movedDelta.className = deltaClass(delta);
  els.managerCount.textContent = formatNumber(summary.totalDeals || 0);
  els.movedManagers.textContent = `${formatNumber(summary.activeManagers || 0)} ответственных`;
  els.activeDeals.textContent = formatNumber(summary.activeDeals || 0);
  els.wonLost.textContent = `${formatNumber(summary.warmBase || 0)} / ${formatNumber(summary.consultations || 0)}`;
  els.lastUpdated.textContent = payload.fetchedAt ? `Обновлено ${formatTime(payload.fetchedAt)}` : "Нет данных";
  els.stageTotal.textContent = `${formatNumber(summary.processedAllTime || 0)} обработано`;
  els.rangeLabel.textContent = rangeLabel(els.range.value);

  renderManagers(payload.managers || []);
  renderStages(payload.stageTotals || []);
  renderRecent(payload.recentMoves || []);
}

function syncManagerFilter(users, selectedId) {
  const current = selectedId || els.managerFilter.value;
  const options = [
    `<option value="">Все менеджеры</option>`,
    ...[...users]
      .sort((a, b) => String(a.name).localeCompare(String(b.name), "ru"))
      .map((user) => `<option value="${escapeAttr(user.id)}">${escapeHtml(user.name)}</option>`),
  ];

  const nextHtml = options.join("");
  if (els.managerFilter.innerHTML !== nextHtml) els.managerFilter.innerHTML = nextHtml;
  els.managerFilter.value = current;
}

function renderManagers(managers) {
  const sortedManagers = sortManagerRows(managers);
  updateSortButtons();

  els.managersTable.innerHTML = sortedManagers.length
    ? sortedManagers
        .map((manager) => {
          const delta = Number(manager.delta || 0);
          return `
            <tr>
              <td>
                <strong>${escapeHtml(manager.name)}</strong>
                <small>${manager.latestMoveAt ? `последнее ${formatDateTime(manager.latestMoveAt)}` : "нет изменений"}</small>
              </td>
              <td><strong class="number">${formatNumber(manager.totalDeals)}</strong></td>
              <td><strong class="number processed">${formatNumber(manager.processedAllTime)}</strong></td>
              <td><strong class="number">${formatNumber(manager.movedCount)}</strong></td>
              <td><span class="trend ${deltaClass(delta)}">${formatDelta(delta)}</span></td>
              <td><strong class="number new-left">${formatNumber(manager.newLeft)}</strong></td>
              <td><strong class="number warm">${formatNumber(manager.warmBase)}</strong></td>
              <td><strong class="number consultations">${formatNumber(manager.consultations)}</strong></td>
              <td><strong class="number no-answer">${formatNumber(manager.noAnswer)}</strong></td>
              <td><strong class="number other-subjects">${formatNumber(manager.otherSubjects)}</strong></td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td colspan="10" class="empty">За выбранный период данных нет.</td></tr>`;
}

function sortManagers(key) {
  if (state.sortKey === key) {
    state.sortDirection = state.sortDirection === "desc" ? "asc" : "desc";
  } else {
    state.sortKey = key;
    state.sortDirection = "desc";
  }
  renderManagers(state.dashboard?.managers || []);
}

function sortManagerRows(managers) {
  const direction = state.sortDirection === "asc" ? 1 : -1;
  return [...managers].sort((a, b) => {
    if (state.sortKey === "name") {
      return String(a.name || "").localeCompare(String(b.name || ""), "ru") * direction;
    }
    const left = Number(a[state.sortKey] || 0);
    const right = Number(b[state.sortKey] || 0);
    return (left - right) * direction || String(a.name || "").localeCompare(String(b.name || ""), "ru");
  });
}

function updateSortButtons() {
  els.sortButtons.forEach((button) => {
    const active = button.dataset.sort === state.sortKey;
    button.classList.toggle("active", active);
    button.dataset.direction = active ? state.sortDirection : "";
  });
}

function renderStages(stages) {
  const max = Math.max(...stages.map((stage) => stage.count), 1);
  els.stageList.innerHTML = stages.length
    ? stages
        .map(
          (stage) => `
            <div class="stage-row">
              <div class="stage-title">
                <span class="swatch" style="background:${escapeAttr(stage.color)}"></span>
                <strong>${escapeHtml(stage.name)}</strong>
                <b>${formatNumber(stage.count)}</b>
              </div>
              <div class="bar"><span style="width:${(stage.count / max) * 100}%; background:${escapeAttr(stage.color)}"></span></div>
            </div>
          `,
        )
        .join("")
    : `<div class="empty">Данных по блокам нет.</div>`;
}

function renderRecent(items) {
  els.recentList.innerHTML = items.length
    ? items
        .map(
          (item) => `
            <div class="recent-item">
              <div>
                <strong>${escapeHtml(item.title)}</strong>
                <span>${escapeHtml(item.assignedByName)} -> ${escapeHtml(item.stageName)}</span>
              </div>
              <time>${formatDateTime(item.movedTime)}</time>
            </div>
          `,
        )
        .join("")
    : `<div class="empty">За выбранный период изменений нет.</div>`;
}

async function fetchJson(url) {
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message || payload.error || "Request failed");
  return payload;
}

function setConnection(kind, text) {
  els.connectionDot.className = `dot ${kind === "live" ? "live" : kind === "error" ? "error" : ""}`;
  els.connectionText.textContent = text;
}

function formatNumber(value) {
  return new Intl.NumberFormat("ru-RU").format(Number(value || 0));
}

function formatDelta(value) {
  const number = Number(value || 0);
  if (number > 0) return `+${formatNumber(number)}`;
  return formatNumber(number);
}

function deltaClass(value) {
  const number = Number(value || 0);
  if (number > 0) return "up";
  if (number < 0) return "down";
  return "flat";
}

function formatTime(value) {
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function rangeLabel(value) {
  return { today: "Сегодня", yesterday: "Вчера", "7d": "7 дней", "30d": "30 дней", all: "За все время" }[value];
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char];
  });
}

function escapeAttr(value) {
  return escapeHtml(value || "#dce3ee");
}
