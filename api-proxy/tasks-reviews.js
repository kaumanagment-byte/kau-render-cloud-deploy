const BITRIX24_WEBHOOK_URL = normalizeWebhook(process.env.BITRIX24_WEBHOOK_URL || "");
const TWOGIS_API_KEY = String(process.env.TWOGIS_API_KEY || "").trim();
const TWOGIS_BRANCH_ID = String(process.env.TWOGIS_BRANCH_ID || "9429940000796152").trim();
const cache = new Map();

const STATUS_NAMES = { 1: "Новая", 2: "Ждёт выполнения", 3: "Выполняется", 4: "Ждёт контроля", 5: "Завершена", 6: "Отложена", 7: "Отклонена" };

async function tasksDashboard(rangeName = "7d") {
  if (!BITRIX24_WEBHOOK_URL) throw new Error("BITRIX24_WEBHOOK_URL is not configured");
  const cacheKey = `tasks:${rangeName}`;
  const current = cache.get(cacheKey);
  if (current && current.expiresAt > Date.now()) return current.value;

  const bounds = taskRange(rangeName);
  const [openTasks, createdTasks, closedTasks, users] = await Promise.all([
    fetchTasks({ STATUS: [1, 2, 3, 4, 6, 7] }, 600),
    fetchTasks({ ">=CREATED_DATE": bounds.from, "<=CREATED_DATE": bounds.to }, 600),
    fetchTasks({ ">=CLOSED_DATE": bounds.from, "<=CLOSED_DATE": bounds.to }, 600),
    fetchUsers(),
  ]);

  const usersById = new Map(users.map((user) => [user.id, user.name]));
  const activeIds = new Set(usersById.keys());
  const byId = new Map([...openTasks, ...createdTasks, ...closedTasks].map((task) => [String(task.id), task]));
  const tasks = [...byId.values()].filter((task) => activeIds.has(String(task.responsibleId || "")));
  const now = new Date();
  const closed = (task) => Number(task.status) === 5 || Boolean(task.closedDate);
  const overdue = (task) => !closed(task) && task.deadline && new Date(task.deadline) < now;
  const files = (task) => Array.isArray(task.ufTaskWebdavFiles) && task.ufTaskWebdavFiles.length > 0;
  const peopleMap = new Map(users.map((user) => [user.id, { ...user, total: 0, created: 0, open: 0, closed: 0, overdue: 0, withFiles: 0, closedOnTime: 0 }]));

  for (const task of tasks) {
    const person = peopleMap.get(String(task.responsibleId));
    if (!person) continue;
    const isClosed = closed(task);
    const closedInPeriod = isClosed && within(task.closedDate, bounds);
    person.total += 1;
    person.created += within(task.createdDate, bounds) ? 1 : 0;
    person.open += isClosed ? 0 : 1;
    person.closed += closedInPeriod ? 1 : 0;
    person.overdue += overdue(task) ? 1 : 0;
    person.withFiles += files(task) ? 1 : 0;
    person.closedOnTime += closedInPeriod && (!task.deadline || new Date(task.closedDate) <= new Date(task.deadline)) ? 1 : 0;
  }

  const people = [...peopleMap.values()].map((person) => ({
    ...person,
    withoutFiles: person.total - person.withFiles,
    closeRate: person.closed + person.open ? Math.round(person.closed / (person.closed + person.open) * 100) : 0,
    onTimeRate: person.closed ? Math.round(person.closedOnTime / person.closed * 100) : 0,
  })).sort((a, b) => b.open - a.open || b.closed - a.closed || a.name.localeCompare(b.name, "ru"));

  const rows = tasks.map((task) => {
    const isClosed = closed(task);
    return {
      id: String(task.id), title: task.title || `Задача #${task.id}`,
      status: STATUS_NAMES[Number(task.status)] || String(task.status || ""),
      responsible: task.responsible?.name || usersById.get(String(task.responsibleId)) || `Сотрудник #${task.responsibleId}`,
      creator: task.creator?.name || usersById.get(String(task.createdBy)) || `Сотрудник #${task.createdBy}`,
      closedBy: task.closedBy ? usersById.get(String(task.closedBy)) || `Сотрудник #${task.closedBy}` : null,
      createdDate: task.createdDate || null, changedDate: task.changedDate || null, deadline: task.deadline || null, closedDate: task.closedDate || null,
      durationHours: isClosed && task.createdDate && task.closedDate ? Math.max(0, Math.round((new Date(task.closedDate) - new Date(task.createdDate)) / 360000) / 10) : null,
      hasFiles: files(task), overdue: Boolean(overdue(task)),
      url: `https://kau.bitrix24.kz/company/personal/user/${task.responsibleId}/tasks/task/view/${task.id}/`,
    };
  }).sort((a, b) => String(b.changedDate || b.closedDate || b.createdDate || "").localeCompare(String(a.changedDate || a.closedDate || a.createdDate || "")));

  const periodClosed = tasks.filter((task) => closed(task) && within(task.closedDate, bounds));
  const currentOpen = tasks.filter((task) => !closed(task));
  const onTime = periodClosed.filter((task) => !task.deadline || new Date(task.closedDate) <= new Date(task.deadline));
  const result = {
    ok: true, mode: "live", fetchedAt: new Date().toISOString(), range: { name: rangeName, ...bounds },
    summary: {
      total: tasks.length, created: tasks.filter((task) => within(task.createdDate, bounds)).length, closed: periodClosed.length,
      open: currentOpen.length, overdue: currentOpen.filter(overdue).length, withFiles: tasks.filter(files).length,
      withoutFiles: tasks.filter((task) => !files(task)).length, closedOnTime: onTime.length,
      closeRate: periodClosed.length + currentOpen.length ? Math.round(periodClosed.length / (periodClosed.length + currentOpen.length) * 100) : 0,
      onTimeRate: periodClosed.length ? Math.round(onTime.length / periodClosed.length * 100) : 0,
    },
    people, tasks: rows,
  };
  cache.set(cacheKey, { value: result, expiresAt: Date.now() + 20000 });
  return result;
}

async function reviewsDashboard() {
  if (!TWOGIS_API_KEY) throw new Error("TWOGIS_API_KEY is not configured");
  const params = new URLSearchParams({ limit: "10", offset: "0", is_advertiser: "false", fields: "meta.providers,meta.branch_rating,meta.branch_reviews_count,meta.total_count,reviews.hiding_reason,reviews.emojis,reviews.trust_factors", sort_by: "date_created", key: TWOGIS_API_KEY, locale: "ru_KZ" });
  const response = await fetch(`https://public-api.reviews.2gis.com/3.0/branches/${encodeURIComponent(TWOGIS_BRANCH_ID)}/reviews?${params}`, { headers: { Accept: "application/json", "User-Agent": "KAU-Reputation-Monitor/1.0" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || `2GIS HTTP ${response.status}`);
  const reviews = (payload.reviews || []).map((review) => {
    const rating = Number(review.rating || 0), hasAnswer = Boolean(review.official_answer);
    return { id: String(review.id || ""), author: review.user?.name || "Пользователь 2ГИС", rating, text: review.text || "Без текста", createdAt: review.date_created || null, url: review.url || "", likes: Number(review.likes_count || 0), hasAnswer, officialAnswer: review.official_answer || null, action: reviewAction(rating, hasAnswer) };
  });
  return { ok: true, source: "2gis", branchId: TWOGIS_BRANCH_ID, fetchedAt: new Date().toISOString(), rating: Number(payload.meta?.branch_rating || 0), reviewsCount: Number(payload.meta?.branch_reviews_count || 0), unansweredCount: reviews.filter((review) => !review.hasAnswer).length, negativeCount: reviews.filter((review) => review.rating > 0 && review.rating <= 3).length, reviews };
}

async function fetchTasks(filter, maxItems) {
  const tasks = []; let start = 0;
  do {
    const payload = await bitrix("tasks.task.list", { order: { ID: "DESC" }, filter, select: ["ID", "TITLE", "STATUS", "RESPONSIBLE_ID", "CREATED_BY", "CREATED_DATE", "CHANGED_DATE", "DEADLINE", "CLOSED_DATE", "CLOSED_BY", "UF_TASK_WEBDAV_FILES"], start });
    const batch = Array.isArray(payload.result?.tasks) ? payload.result.tasks : [];
    tasks.push(...batch); start = typeof payload.next === "number" ? payload.next : null;
  } while (start !== null && tasks.length < maxItems);
  return tasks.slice(0, maxItems);
}

async function fetchUsers() {
  const cached = cache.get("users"); if (cached && cached.expiresAt > Date.now()) return cached.value;
  const users = []; let start = 0;
  do {
    const payload = await bitrix("user.get", { FILTER: { ACTIVE: true }, start });
    users.push(...(payload.result || []).filter((user) => user.ACTIVE !== false && user.USER_TYPE === "employee").filter((user) => String(user.ID) !== "90325" && !/^Интегратор\b/i.test(String(user.NAME || ""))).map((user) => ({ id: String(user.ID), name: [user.NAME, user.LAST_NAME].filter(Boolean).join(" ").replace(/\s+/g, " ").trim() })));
    start = typeof payload.next === "number" ? payload.next : null;
  } while (start !== null && users.length < 1000);
  cache.set("users", { value: users, expiresAt: Date.now() + 300000 }); return users;
}

async function bitrix(method, params) {
  const response = await fetch(`${BITRIX24_WEBHOOK_URL}${method}.json`, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(params) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) throw new Error(payload.error_description || payload.error || `Bitrix HTTP ${response.status}`);
  return payload;
}

function normalizeWebhook(value) { if (!value) return ""; return value.endsWith("/") ? value : `${value}/`; }
function within(value, bounds) { if (!value) return false; const date = new Date(value); return date >= new Date(bounds.from) && date <= new Date(bounds.to); }
function taskRange(name) { const now = new Date(); const start = new Date(now), end = new Date(now); start.setHours(0,0,0,0); end.setHours(23,59,59,999); if(name === "yesterday"){start.setDate(start.getDate()-1);end.setDate(end.getDate()-1)} else if(name === "7d") start.setDate(start.getDate()-6); else if(name === "30d") start.setDate(start.getDate()-29); else if(name === "all") start.setFullYear(2020,0,1); const iso = (date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}T${String(date.getHours()).padStart(2,"0")}:${String(date.getMinutes()).padStart(2,"0")}:${String(date.getSeconds()).padStart(2,"0")}+05:00`; return { from: iso(start), to: iso(end) }; }
function reviewAction(rating, answered) { if(rating <= 2) return { priority:"critical",label:"Срочно",text:answered?"Проверить, решена ли проблема, и связаться повторно.":"Ответить сегодня, признать проблему и предложить личный контакт для решения."}; if(rating === 3) return {priority:"high",label:"Разобрать",text:answered?"Проверить результат ответа и зафиксировать причину замечания.":"Уточнить детали, дать конкретный срок исправления и назначить ответственного."}; if(rating === 4) return {priority:"medium",label:"Ответить",text:answered?"Учесть замечание в еженедельной сводке.":"Поблагодарить и отдельно ответить на замечание пользователя."}; return {priority:"low",label:"Поддержать",text:answered?"Можно использовать отзыв как позитивный сигнал в отчёте.":"Поблагодарить за отзыв и пригласить подписаться на новости KAU."}; }

module.exports = { tasksDashboard, reviewsDashboard };
