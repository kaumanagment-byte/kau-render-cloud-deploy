import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = resolve(__dirname, "public");
const eventLogPath = resolve(__dirname, "data", "events.ndjson");
const crashLogPath = resolve(__dirname, "data", "crash.log");

loadEnv(resolve(__dirname, ".env"));

const PORT = Number(process.env.PORT || 8787);
const BITRIX24_WEBHOOK_URL = normalizeWebhookUrl(process.env.BITRIX24_WEBHOOK_URL || "");
const POLL_INTERVAL_SECONDS = Number(process.env.POLL_INTERVAL_SECONDS || 15);
const TWOGIS_API_KEY = String(process.env.TWOGIS_API_KEY || "").trim();
const TWOGIS_BRANCH_ID = String(process.env.TWOGIS_BRANCH_ID || "9429940000796152").trim();
const clients = new Set();
const cache = new Map();
const TARGET_MANAGER_IDS = [
  "96709",
  "96925",
  "90317",
  "90511",
  "101479",
  "101481",
  "99145",
  "101511",
  "96621",
  "101489",
  "101493",
  "101497",
  "101499",
  "101503",
  "101521",
  "101527",
  "102581",
];
mkdirSync(resolve(__dirname, "data"), { recursive: true });

process.on("uncaughtException", (error) => {
  appendFileSync(crashLogPath, `${new Date().toISOString()} uncaughtException\n${error.stack || error}\n`, "utf8");
  console.error(error);
});

process.on("unhandledRejection", (error) => {
  appendFileSync(crashLogPath, `${new Date().toISOString()} unhandledRejection\n${error?.stack || error}\n`, "utf8");
  console.error(error);
});

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (url.pathname === "/health") {
      return sendJson(res, {
        ok: true,
        service: "kau-crm-service",
        fetchedAt: new Date().toISOString(),
      });
    }

    if (url.pathname === "/api/config") {
      return sendJson(res, {
        configured: Boolean(BITRIX24_WEBHOOK_URL),
        pollIntervalSeconds: POLL_INTERVAL_SECONDS,
        now: new Date().toISOString(),
      });
    }

    if (url.pathname === "/api/calls") {
      return await handleCalls(url, res);
    }

    if (url.pathname === "/api/deal-dashboard") {
      return await handleDealDashboard(url, res);
    }

    if (url.pathname === "/api/tasks-dashboard") {
      return await handleTasksDashboard(url, res);
    }

    if (url.pathname === "/api/2gis/reviews") {
      return await handleTwoGisReviews(res);
    }

    if (url.pathname === "/api/users") {
      return await handleUsers(res);
    }

    if (url.pathname === "/api/events") {
      return handleEvents(req, res);
    }

    if (url.pathname === "/webhook/bitrix/call-end") {
      return await handleBitrixEvent(req, res);
    }

    return serveStatic(url.pathname, res);
  } catch (error) {
    console.error(error);
    sendJson(res, { error: "server_error", message: error.message }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`Bitrix24 call dashboard: http://localhost:${PORT}`);
  console.log(BITRIX24_WEBHOOK_URL ? "Webhook configured" : "Webhook is not configured; demo data will be shown");
});

async function handleCalls(url, res) {
  const from = url.searchParams.get("from") || startOfTodayIso();
  const to = url.searchParams.get("to") || new Date().toISOString();

  if (!BITRIX24_WEBHOOK_URL) {
    return sendJson(res, {
      mode: "demo",
      calls: buildDemoCalls(from),
      fetchedAt: new Date().toISOString(),
    });
  }

  try {
    const calls = await fetchTelephonyCalls(from, to);
    return sendJson(res, {
      mode: "live",
      source: "telephony",
      calls,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error.code !== "insufficient_scope") {
      throw error;
    }

    const calls = await fetchCrmActivityCalls(from, to);
    return sendJson(res, {
      mode: "live",
      source: "crm_activity",
      warning: "Webhook has no telephony scope; using CRM call activities instead.",
      calls,
      fetchedAt: new Date().toISOString(),
    });
  }
}

async function handleUsers(res) {
  if (!BITRIX24_WEBHOOK_URL) {
    return sendJson(res, {
      mode: "demo",
      users: [
        { id: "1", name: "Анна Смирнова" },
        { id: "2", name: "Илья Корнеев" },
        { id: "3", name: "Мария Волкова" },
      ],
    });
  }

  try {
    const users = [];
    let start = 0;

    do {
      const response = await callBitrix("user.get", { start });
      if (Array.isArray(response.result)) {
        users.push(
          ...response.result.map((user) => ({
            id: String(user.ID),
            name: [user.NAME, user.LAST_NAME].filter(Boolean).join(" ") || `Сотрудник #${user.ID}`,
          })),
        );
      }
      start = typeof response.next === "number" ? response.next : null;
    } while (start !== null && users.length < 1000);

    sendJson(res, { mode: "live", users });
  } catch (error) {
    sendJson(res, { mode: "live", users: [], warning: error.message });
  }
}

const TASK_STATUS_NAMES = {
  1: "Новая",
  2: "Ждёт выполнения",
  3: "Выполняется",
  4: "Ждёт контроля",
  5: "Завершена",
  6: "Отложена",
  7: "Отклонена",
};

async function handleTasksDashboard(url, res) {
  if (!BITRIX24_WEBHOOK_URL) {
    return sendJson(res, { ok: false, mode: "demo", error: "Bitrix24 webhook is not configured" }, 503);
  }

  const rangeName = url.searchParams.get("range") || "7d";
  const responsibleId = url.searchParams.get("responsible") || "";
  const cacheKey = `tasks:${rangeName}:${responsibleId}`;
  const payload = await cached(cacheKey, 20_000, async () => {
    const bounds = getTaskRange(rangeName);
    const baseFilter = responsibleId ? { RESPONSIBLE_ID: responsibleId } : {};
    const [openTasks, createdTasks, closedTasks, users] = await Promise.all([
      fetchBitrixTasks({ ...baseFilter, STATUS: [1, 2, 3, 4, 6, 7] }, 600),
      fetchBitrixTasks({ ...baseFilter, ">=CREATED_DATE": bounds.from, "<=CREATED_DATE": bounds.to }, 600),
      fetchBitrixTasks({ ...baseFilter, ">=CLOSED_DATE": bounds.from, "<=CLOSED_DATE": bounds.to }, 600),
      cached("users", 5 * 60_000, fetchBitrixUsers),
    ]);
    return buildTasksDashboard({ rangeName, bounds, openTasks, createdTasks, closedTasks, users });
  });

  sendJson(res, payload);
}

async function handleTwoGisReviews(res) {
  if (!TWOGIS_API_KEY) {
    return sendJson(res, { ok: false, error: "2GIS API key is not configured" }, 503);
  }

  const params = new URLSearchParams({
    limit: "10",
    offset: "0",
    is_advertiser: "false",
    fields: "meta.providers,meta.branch_rating,meta.branch_reviews_count,meta.total_count,reviews.hiding_reason,reviews.emojis,reviews.trust_factors",
    sort_by: "date_created",
    key: TWOGIS_API_KEY,
    locale: "ru_KZ",
  });
  const response = await fetch(`https://public-api.reviews.2gis.com/3.0/branches/${encodeURIComponent(TWOGIS_BRANCH_ID)}/reviews?${params}`, {
    headers: { Accept: "application/json", "User-Agent": "KAU-Reputation-Monitor/1.0" },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return sendJson(res, { ok: false, error: payload.message || `2GIS HTTP ${response.status}` }, response.status);
  }

  const reviews = (payload.reviews || []).map((review) => {
    const rating = Number(review.rating || 0);
    const hasAnswer = Boolean(review.official_answer);
    return {
      id: String(review.id || ""),
      author: review.user?.name || "Пользователь 2ГИС",
      rating,
      text: review.text || "Без текста",
      createdAt: review.date_created || null,
      url: review.url || "",
      likes: Number(review.likes_count || 0),
      hasAnswer,
      officialAnswer: review.official_answer || null,
      action: reviewAction(rating, hasAnswer),
    };
  });

  sendJson(res, {
    ok: true,
    source: "2gis",
    branchId: TWOGIS_BRANCH_ID,
    fetchedAt: new Date().toISOString(),
    rating: Number(payload.meta?.branch_rating || 0),
    reviewsCount: Number(payload.meta?.branch_reviews_count || 0),
    unansweredCount: reviews.filter((review) => !review.hasAnswer).length,
    negativeCount: reviews.filter((review) => review.rating > 0 && review.rating <= 3).length,
    reviews,
  });
}

function reviewAction(rating, hasAnswer) {
  if (rating <= 2) {
    return { priority: "critical", label: "Срочно", text: hasAnswer ? "Проверить, решена ли проблема, и связаться повторно." : "Ответить сегодня, признать проблему и предложить личный контакт для решения." };
  }
  if (rating === 3) {
    return { priority: "high", label: "Разобрать", text: hasAnswer ? "Проверить результат ответа и зафиксировать причину замечания." : "Уточнить детали, дать конкретный срок исправления и назначить ответственного." };
  }
  if (rating === 4) {
    return { priority: "medium", label: "Ответить", text: hasAnswer ? "Учесть замечание в еженедельной сводке." : "Поблагодарить и отдельно ответить на замечание пользователя." };
  }
  return { priority: "low", label: "Поддержать", text: hasAnswer ? "Можно использовать отзыв как позитивный сигнал в отчёте." : "Поблагодарить за отзыв и пригласить подписаться на новости KAU." };
}

async function fetchBitrixTasks(filter, maxItems = 2500) {
  const tasks = [];
  let start = 0;
  const select = [
    "ID",
    "TITLE",
    "DESCRIPTION",
    "STATUS",
    "PRIORITY",
    "RESPONSIBLE_ID",
    "CREATED_BY",
    "CREATED_DATE",
    "CHANGED_DATE",
    "DEADLINE",
    "CLOSED_DATE",
    "CLOSED_BY",
    "UF_TASK_WEBDAV_FILES",
  ];

  do {
    const response = await callBitrix("tasks.task.list", {
      order: { ID: "DESC" },
      filter,
      select,
      start,
    });
    const batch = Array.isArray(response.result?.tasks) ? response.result.tasks : [];
    tasks.push(...batch);
    start = typeof response.next === "number" ? response.next : null;
  } while (start !== null && tasks.length < maxItems);

  return tasks.slice(0, maxItems);
}

function buildTasksDashboard({ rangeName, bounds, openTasks, createdTasks, closedTasks, users }) {
  const byId = new Map();
  for (const task of [...openTasks, ...createdTasks, ...closedTasks]) {
    byId.set(String(task.id), task);
  }
  const usersById = new Map(users.map((user) => [String(user.id), user.name]));
  const activeUserIds = new Set(usersById.keys());
  const tasks = [...byId.values()].filter((task) => activeUserIds.has(String(task.responsibleId || "")));
  const now = new Date();
  const isClosed = (task) => Number(task.status) === 5 || Boolean(task.closedDate);
  const isOverdue = (task) => !isClosed(task) && task.deadline && new Date(task.deadline) < now;
  const hasFiles = (task) => Array.isArray(task.ufTaskWebdavFiles) && task.ufTaskWebdavFiles.length > 0;
  const currentOpen = tasks.filter((task) => !isClosed(task));
  const periodClosed = tasks.filter((task) => isClosed(task) && isWithin(task.closedDate, bounds));
  const periodCreated = tasks.filter((task) => isWithin(task.createdDate, bounds));
  const overdue = currentOpen.filter(isOverdue);
  const closedOnTime = periodClosed.filter((task) => !task.deadline || new Date(task.closedDate) <= new Date(task.deadline));
  const peopleMap = new Map();

  for (const user of users) {
    peopleMap.set(String(user.id), {
      id: String(user.id),
      name: user.name,
      total: 0,
      created: 0,
      open: 0,
      closed: 0,
      overdue: 0,
      withFiles: 0,
      closedOnTime: 0,
    });
  }

  for (const task of tasks) {
    const id = String(task.responsibleId || "none");
    const person = peopleMap.get(id) || {
      id,
      name: task.responsible?.name || usersById.get(id) || `Сотрудник #${id}`,
      total: 0,
      created: 0,
      open: 0,
      closed: 0,
      overdue: 0,
      withFiles: 0,
      closedOnTime: 0,
    };
    person.total += 1;
    person.created += isWithin(task.createdDate, bounds) ? 1 : 0;
    person.open += isClosed(task) ? 0 : 1;
    person.closed += isClosed(task) && isWithin(task.closedDate, bounds) ? 1 : 0;
    person.overdue += isOverdue(task) ? 1 : 0;
    person.withFiles += hasFiles(task) ? 1 : 0;
    person.closedOnTime += isClosed(task) && isWithin(task.closedDate, bounds) && (!task.deadline || new Date(task.closedDate) <= new Date(task.deadline)) ? 1 : 0;
    peopleMap.set(id, person);
  }

  const people = [...peopleMap.values()]
    .map((person) => ({
      ...person,
      withoutFiles: person.total - person.withFiles,
      closeRate: person.closed + person.open ? Math.round((person.closed / (person.closed + person.open)) * 100) : 0,
      onTimeRate: person.closed ? Math.round((person.closedOnTime / person.closed) * 100) : 0,
    }))
    .sort((a, b) => b.open - a.open || b.closed - a.closed || a.name.localeCompare(b.name, "ru"));

  const rows = tasks
    .map((task) => {
      const closed = isClosed(task);
      const responsible = task.responsible?.name || usersById.get(String(task.responsibleId)) || `Сотрудник #${task.responsibleId}`;
      const creator = task.creator?.name || usersById.get(String(task.createdBy)) || `Сотрудник #${task.createdBy}`;
      const closedBy = task.closedBy ? usersById.get(String(task.closedBy)) || `Сотрудник #${task.closedBy}` : null;
      return {
        id: String(task.id),
        title: task.title || `Задача #${task.id}`,
        statusId: Number(task.status),
        status: TASK_STATUS_NAMES[Number(task.status)] || String(task.status || ""),
        priority: Number(task.priority || 1),
        responsibleId: String(task.responsibleId || ""),
        responsible,
        creator,
        closedBy,
        createdDate: task.createdDate || null,
        changedDate: task.changedDate || null,
        deadline: task.deadline || null,
        closedDate: task.closedDate || null,
        durationHours: closed && task.createdDate && task.closedDate
          ? Math.max(0, Math.round((new Date(task.closedDate) - new Date(task.createdDate)) / 36_000) / 10)
          : null,
        hasFiles: hasFiles(task),
        overdue: Boolean(isOverdue(task)),
        url: `https://kau.bitrix24.kz/company/personal/user/${task.responsibleId}/tasks/task/view/${task.id}/`,
      };
    })
    .sort((a, b) => String(b.changedDate || b.closedDate || b.createdDate || "").localeCompare(String(a.changedDate || a.closedDate || a.createdDate || "")));

  return {
    ok: true,
    mode: "live",
    fetchedAt: new Date().toISOString(),
    range: { name: rangeName, ...bounds },
    summary: {
      total: tasks.length,
      created: periodCreated.length,
      closed: periodClosed.length,
      open: currentOpen.length,
      overdue: overdue.length,
      withFiles: tasks.filter(hasFiles).length,
      withoutFiles: tasks.filter((task) => !hasFiles(task)).length,
      closedOnTime: closedOnTime.length,
      closeRate: periodClosed.length + currentOpen.length ? Math.round((periodClosed.length / (periodClosed.length + currentOpen.length)) * 100) : 0,
      onTimeRate: periodClosed.length ? Math.round((closedOnTime.length / periodClosed.length) * 100) : 0,
    },
    people,
    tasks: rows,
  };
}

function getTaskRange(rangeName) {
  const now = new Date();
  const yekaterinburgNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Yekaterinburg" }));
  const start = new Date(yekaterinburgNow);
  start.setHours(0, 0, 0, 0);
  const end = new Date(yekaterinburgNow);
  end.setHours(23, 59, 59, 999);
  if (rangeName === "yesterday") {
    start.setDate(start.getDate() - 1);
    end.setDate(end.getDate() - 1);
  } else if (rangeName === "7d") {
    start.setDate(start.getDate() - 6);
  } else if (rangeName === "30d") {
    start.setDate(start.getDate() - 29);
  } else if (rangeName === "all") {
    start.setFullYear(2020, 0, 1);
  }
  const offset = "+05:00";
  const localIso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}${offset}`;
  return { from: localIso(start), to: localIso(end) };
}

function isWithin(value, bounds) {
  if (!value) return false;
  const date = new Date(value);
  return date >= new Date(bounds.from) && date <= new Date(bounds.to);
}

async function handleDealDashboard(url, res) {
  if (!BITRIX24_WEBHOOK_URL) {
    return sendJson(res, buildDemoDealDashboard(url.searchParams.get("range") || "today"));
  }

  const range = getServerRange(url.searchParams.get("range") || "today");
  const managerId = url.searchParams.get("manager") || "";
  const [allUsers, stages] = await Promise.all([
    cached("users", 5 * 60_000, fetchBitrixUsers),
    cached("deal-stages", 10 * 60_000, fetchDealStages),
  ]);
  const users = filterTargetUsers(allUsers);
  const dashboard = await buildWorkloadDashboard(range, managerId, users, stages);

  sendJson(res, {
    mode: "live",
    source: "deals_moved_time",
    range,
    users,
    stages,
    summary: dashboard.summary,
    filters: { managerId },
    managers: dashboard.managers,
    stageTotals: dashboard.stageTotals,
    recentMoves: dashboard.recentMoves,
    fetchedAt: new Date().toISOString(),
  });
}

function handleEvents(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(`event: hello\ndata: ${JSON.stringify({ connectedAt: new Date().toISOString() })}\n\n`);
  clients.add(res);
  req.on("close", () => clients.delete(res));
}

async function handleBitrixEvent(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, { error: "method_not_allowed" }, 405);
  }

  const body = await readBody(req);
  const event = {
    receivedAt: new Date().toISOString(),
    headers: {
      "user-agent": req.headers["user-agent"],
      "content-type": req.headers["content-type"],
    },
    payload: parsePayload(body, req.headers["content-type"]),
  };

  appendFileSync(eventLogPath, `${JSON.stringify(event)}\n`, "utf8");
  broadcast("call-end", event);
  sendJson(res, { ok: true });
}

async function callBitrix(method, params) {
  const response = await fetch(`${BITRIX24_WEBHOOK_URL}${method}.json`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error_description || payload.error || `HTTP ${response.status}`);
    error.code = payload.error;
    error.status = response.status;
    throw error;
  }
  if (payload.error) {
    const error = new Error(payload.error_description || payload.error);
    error.code = payload.error;
    throw error;
  }
  return payload;
}

async function cached(key, ttlMs, loader) {
  const now = Date.now();
  const current = cache.get(key);
  if (current && current.expiresAt > now) {
    return current.value;
  }

  const value = await loader();
  cache.set(key, { value, expiresAt: now + ttlMs });
  return value;
}

async function fetchBitrixUsers() {
  const users = [];
  let start = 0;

  do {
    const response = await callBitrix("user.get", { FILTER: { ACTIVE: true }, start });
    if (Array.isArray(response.result)) {
      users.push(
        ...response.result
          .filter((user) => user.ACTIVE !== false && user.USER_TYPE === "employee")
          .filter((user) => String(user.ID) !== "90325" && !/^Интегратор\b/i.test(String(user.NAME || "")))
          .map((user) => ({
            id: String(user.ID),
            name: [user.NAME, user.LAST_NAME].filter(Boolean).join(" ").replace(/\s+/g, " ").trim() || `Employee #${user.ID}`,
          })),
      );
    }
    start = typeof response.next === "number" ? response.next : null;
  } while (start !== null && users.length < 1000);

  return users;
}

function filterTargetUsers(users) {
  const byId = new Map(users.map((user) => [String(user.id), user]));
  return TARGET_MANAGER_IDS.map((id) => byId.get(id)).filter(Boolean);
}

async function fetchDealStages() {
  const response = await callBitrix("crm.status.list", { filter: {} });
  if (!Array.isArray(response.result)) return [];

  return response.result
    .filter((stage) => stage.ENTITY_ID === "DEAL_STAGE" || String(stage.ENTITY_ID || "").startsWith("DEAL_STAGE_"))
    .map((stage) => ({
      id: String(stage.STATUS_ID),
      name: stage.NAME || stage.STATUS_ID,
      color: normalizeColor(stage.COLOR || stage.EXTRA?.COLOR),
      sort: Number(stage.SORT || 0),
      semantics: stage.SEMANTICS || stage.EXTRA?.SEMANTICS || "",
      categoryId: String(stage.CATEGORY_ID || "0"),
    }));
}

async function buildWorkloadDashboard(range, managerId, users, stages) {
  const stageGroups = classifyStageGroups(stages);
  const recentMoves = await fetchDealsByMovedTime(range.current.from, range.current.to, managerId);
  const candidateIds = managerId ? [managerId] : TARGET_MANAGER_IDS;
  const stats = await fetchManagerStats(candidateIds, range, stageGroups);
  const usersById = new Map(users.map((user) => [String(user.id), user.name]));

  const managers = stats
    .map((item) => ({
      userId: item.userId,
      name: usersById.get(item.userId) || `Employee #${item.userId}`,
      totalDeals: item.totalDeals,
      processedAllTime: item.processedAllTime,
      movedCount: item.periodTouched,
      previousMovedCount: item.previousTouched,
      delta: range.name === "all" ? 0 : item.periodTouched - item.previousTouched,
      newLeft: item.newLeft,
      warmBase: item.warmBase,
      consultations: item.consultations,
      noAnswer: item.noAnswer,
      otherSubjects: item.otherSubjects,
      latestMoveAt: recentMoves.find((deal) => deal.assignedById === item.userId)?.movedTime || null,
    }))
    .sort((a, b) => b.newLeft - a.newLeft || b.movedCount - a.movedCount || b.totalDeals - a.totalDeals);

  const summary = {
    movedCount: sum(managers, "movedCount"),
    previousMovedCount: sum(managers, "previousMovedCount"),
    delta: range.name === "all" ? 0 : sum(managers, "movedCount") - sum(managers, "previousMovedCount"),
    activeDeals: sum(managers, "newLeft"),
    activeManagers: managers.filter((item) => item.totalDeals > 0).length,
    movedManagers: managers.filter((item) => item.movedCount > 0).length,
    wonMoves: sum(managers, "warmBase"),
    lostMoves: sum(managers, "noAnswer"),
    totalDeals: sum(managers, "totalDeals"),
    processedAllTime: sum(managers, "processedAllTime"),
    warmBase: sum(managers, "warmBase"),
    consultations: sum(managers, "consultations"),
    noAnswer: sum(managers, "noAnswer"),
    otherSubjects: sum(managers, "otherSubjects"),
  };

  return {
    summary,
    managers,
    stageTotals: [
      { stageId: "new-left", name: "Новые осталось", color: "#39a8ef", count: summary.activeDeals },
      { stageId: "warm-base", name: "Теплая база", color: "#2fb644", count: summary.warmBase },
      { stageId: "consultations", name: "Консультации", color: "#1f66e5", count: summary.consultations },
      { stageId: "no-answer", name: "Недозвон / недозвон 2", color: "#fff55a", count: summary.noAnswer },
      { stageId: "other-subjects", name: "Другие проф предметы", color: "#47d1e2", count: summary.otherSubjects },
    ],
    stageTotals: buildStageTotals(recentMoves, stages),
    recentMoves: recentMoves.slice(0, 40).map((deal) => formatDealMove(deal, users, stages)),
  };
}

async function fetchCandidateManagerIds(range, recentMoves) {
  const ids = new Set(recentMoves.map((deal) => deal.assignedById).filter(Boolean));
  const openSample = await fetchOpenDeals("");
  for (const deal of openSample) {
    ids.add(deal.assignedById);
  }
  if (ids.size === 0) {
    const previous = await fetchDealsByMovedTime(range.previous.from, range.previous.to, "");
    for (const deal of previous) {
      ids.add(deal.assignedById);
    }
  }
  return [...ids].filter((id) => id && id !== "unknown");
}

async function fetchManagerStats(userIds, range, stageGroups) {
  const compareEnabled = range.name !== "all";
  const stats = new Map(userIds.map((userId) => [String(userId), { userId: String(userId) }]));
  const queries = [];

  for (const userId of userIds) {
    queries.push({ userId, metric: "totalDeals", filter: { ASSIGNED_BY_ID: userId } });
    queries.push({ userId, metric: "processedAllTime", filter: { ASSIGNED_BY_ID: userId, "!STAGE_ID": stageGroups.new } });
    queries.push({
      userId,
      metric: "periodTouched",
      filter: movedFilter(range.current.from, range.current.to, userId),
    });
    if (compareEnabled) {
      queries.push({
        userId,
        metric: "previousTouched",
        filter: movedFilter(range.previous.from, range.previous.to, userId),
      });
    }
    queries.push({ userId, metric: "newLeft", filter: { ASSIGNED_BY_ID: userId, STAGE_ID: stageGroups.new } });
    queries.push({ userId, metric: "warmBase", filter: { ASSIGNED_BY_ID: userId, STAGE_ID: stageGroups.warm } });
    queries.push({ userId, metric: "consultations", filter: { ASSIGNED_BY_ID: userId, STAGE_ID: stageGroups.consultations } });
    queries.push({ userId, metric: "noAnswer", filter: { ASSIGNED_BY_ID: userId, STAGE_ID: stageGroups.noAnswer } });
    queries.push({ userId, metric: "otherSubjects", filter: { ASSIGNED_BY_ID: userId, STAGE_ID: stageGroups.otherSubjects } });
  }

  for (let index = 0; index < queries.length; index += 50) {
    const chunk = queries.slice(index, index + 50);
    const cmd = {};
    chunk.forEach((query, queryIndex) => {
      cmd[`q${queryIndex}`] = buildBitrixCommand("crm.deal.list", {
        order: { ID: "DESC" },
        filter: query.filter,
        select: ["ID"],
        start: 0,
      });
    });

    const response = await callBitrix("batch", { halt: 0, cmd });
    const totals = response.result?.result_total || {};
    chunk.forEach((query, queryIndex) => {
      const row = stats.get(String(query.userId));
      row[query.metric] = Number(totals[`q${queryIndex}`] || 0);
    });
  }

  return [...stats.values()].map((item) => ({
    totalDeals: 0,
    processedAllTime: 0,
    periodTouched: 0,
    previousTouched: 0,
    newLeft: 0,
    warmBase: 0,
    consultations: 0,
    noAnswer: 0,
    otherSubjects: 0,
    ...item,
  }));
}

function movedFilter(from, to, userId) {
  const filter = {
    ASSIGNED_BY_ID: userId,
  };
  if (from) filter[">=MOVED_TIME"] = from;
  if (to) filter["<=MOVED_TIME"] = to;
  return filter;
}

function classifyStageGroups(stages) {
  return {
    new: stageIdsByName(stages, [/заявка получена/i]),
    warm: stageIdsByName(stages, [/заинтерес/i, /поступает.*кау/i, /поступает к нам/i, /поступил/i, /будет поступ/i]),
    consultations: stageIdsByName(stages, [/консультац/i]),
    noAnswer: stageIdsByName(stages, [/недозвон/i]),
    otherSubjects: stageIdsByName(stages, [/другие проф/i, /другой вуз/i, /наши предметы выбрал/i]),
  };
}

function stageIdsByName(stages, patterns) {
  return stages.filter((stage) => patterns.some((pattern) => pattern.test(stage.name))).map((stage) => stage.id);
}

function sum(items, key) {
  return items.reduce((total, item) => total + Number(item[key] || 0), 0);
}

async function fetchDealsByMovedTime(from, to, managerId = "") {
  const filter = {};
  if (from) filter[">=MOVED_TIME"] = from;
  if (to) filter["<=MOVED_TIME"] = to;
  if (managerId) {
    filter.ASSIGNED_BY_ID = managerId;
  }

  return fetchDeals({
    order: { MOVED_TIME: "DESC" },
    filter,
    select: dealSelectFields(),
    limit: managerId ? 5000 : 1000,
    precise: Boolean(managerId),
  });
}

async function fetchOpenDeals(managerId = "") {
  const filter = { CLOSED: "N", STAGE_SEMANTIC_ID: "P" };
  if (managerId) {
    filter.ASSIGNED_BY_ID = managerId;
  }

  return fetchDeals({
    order: { MOVED_TIME: "DESC" },
    filter,
    select: dealSelectFields(),
    limit: 500,
  });
}

async function fetchDeals(params) {
  if (params.precise) {
    return fetchDealsPrecise(params);
  }

  const deals = [];
  const limit = params.limit || 2000;
  const pageSize = 50;
  const pageCount = Math.ceil(limit / pageSize);

  for (let chunkStart = 0; chunkStart < pageCount; chunkStart += 50) {
    const cmd = {};
    const chunkEnd = Math.min(chunkStart + 50, pageCount);

    for (let page = chunkStart; page < chunkEnd; page += 1) {
      const start = page * pageSize;
      cmd[`page_${start}`] = buildBitrixCommand("crm.deal.list", { ...params, start });
    }

    const response = await callBitrix("batch", { halt: 0, cmd });
    const results = response.result?.result || {};
    const pages = Object.keys(cmd)
      .map((key) => results[key])
      .filter(Array.isArray);

    for (const page of pages) {
      deals.push(...page.map(normalizeDeal));
    }

    if (pages.some((page) => page.length < pageSize) || deals.length >= limit) {
      break;
    }
  }

  return deals.slice(0, limit);
}

async function fetchDealsPrecise(params) {
  const deals = [];
  const limit = params.limit || 2000;
  let start = 0;

  do {
    const response = await callBitrix("crm.deal.list", { ...params, start });
    if (!Array.isArray(response.result)) {
      throw new Error(response.error_description || response.error || "Unexpected Bitrix24 deal response");
    }

    deals.push(...response.result.map(normalizeDeal));
    start = typeof response.next === "number" ? response.next : null;
  } while (start !== null && deals.length < limit);

  return deals.slice(0, limit);
}

function buildBitrixCommand(method, params) {
  const query = new URLSearchParams();
  appendBitrixParams(query, params);
  return `${method}?${query.toString()}`;
}

function appendBitrixParams(query, value, prefix = "") {
  if (Array.isArray(value)) {
    for (const item of value) {
      query.append(`${prefix}[]`, item);
    }
    return;
  }

  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      appendBitrixParams(query, item, prefix ? `${prefix}[${key}]` : key);
    }
    return;
  }

  if (prefix) {
    query.append(prefix, value ?? "");
  }
}

function dealSelectFields() {
  return [
    "ID",
    "TITLE",
    "STAGE_ID",
    "CATEGORY_ID",
    "STAGE_SEMANTIC_ID",
    "ASSIGNED_BY_ID",
    "MOVED_BY_ID",
    "MOVED_TIME",
    "DATE_MODIFY",
    "OPPORTUNITY",
    "CLOSED",
  ];
}

function normalizeDeal(deal) {
  return {
    id: String(deal.ID || ""),
    title: deal.TITLE || `Deal #${deal.ID}`,
    stageId: String(deal.STAGE_ID || ""),
    categoryId: String(deal.CATEGORY_ID || "0"),
    semanticId: String(deal.STAGE_SEMANTIC_ID || ""),
    assignedById: String(deal.ASSIGNED_BY_ID || "unknown"),
    movedById: String(deal.MOVED_BY_ID || deal.ASSIGNED_BY_ID || "unknown"),
    movedTime: deal.MOVED_TIME || deal.DATE_MODIFY || null,
    dateModify: deal.DATE_MODIFY || null,
    opportunity: Number(deal.OPPORTUNITY || 0),
    closed: deal.CLOSED === "Y",
  };
}

function summarizeDeals(movedDeals, previousMovedDeals, activeDeals, stages) {
  return {
    movedCount: movedDeals.length,
    movedCountCapped: movedDeals.length >= 1000,
    previousMovedCount: previousMovedDeals.length,
    delta: movedDeals.length - previousMovedDeals.length,
    activeDeals: activeDeals.length,
    activeDealsCapped: activeDeals.length >= 500,
    previousMovedCapped: previousMovedDeals.length >= 1000,
    activeManagers: new Set(activeDeals.map((deal) => deal.assignedById)).size,
    movedManagers: new Set(movedDeals.map((deal) => deal.assignedById)).size,
    wonMoves: movedDeals.filter((deal) => stageSemantics(deal.stageId, stages) === "success").length,
    lostMoves: movedDeals.filter((deal) => stageSemantics(deal.stageId, stages) === "failure").length,
  };
}

function buildManagerDealRows(movedDeals, previousMovedDeals, activeDeals, users, stages) {
  const usersById = new Map(users.map((user) => [String(user.id), user.name]));
  const ids = new Set([
    ...movedDeals.map((deal) => deal.assignedById),
    ...previousMovedDeals.map((deal) => deal.assignedById),
    ...activeDeals.map((deal) => deal.assignedById),
  ]);

  return [...ids]
    .map((id) => {
      const moved = movedDeals.filter((deal) => deal.assignedById === id);
      const previous = previousMovedDeals.filter((deal) => deal.assignedById === id);
      const active = activeDeals.filter((deal) => deal.assignedById === id);

      return {
        userId: id,
        name: usersById.get(id) || (id === "unknown" ? "Not assigned" : `Employee #${id}`),
        movedCount: moved.length,
        previousMovedCount: previous.length,
        delta: moved.length - previous.length,
        activeDeals: active.length,
        activeValue: active.reduce((sum, deal) => sum + deal.opportunity, 0),
        statuses: buildStageTotals(active, stages).slice(0, 7),
        latestMoveAt: moved[0]?.movedTime || null,
      };
    })
    .sort((a, b) => b.movedCount - a.movedCount || b.activeDeals - a.activeDeals);
}

function buildStageTotals(deals, stages) {
  const totals = new Map();

  for (const deal of deals) {
    const stage = stageInfo(deal.stageId, stages);
    const item = totals.get(deal.stageId) || {
      stageId: deal.stageId,
      name: stage.name,
      color: stage.color,
      semantics: stage.semantics,
      count: 0,
    };
    item.count += 1;
    totals.set(deal.stageId, item);
  }

  return [...totals.values()].sort((a, b) => b.count - a.count);
}

function formatDealMove(deal, users, stages) {
  const usersById = new Map(users.map((user) => [String(user.id), user.name]));
  const stage = stageInfo(deal.stageId, stages);

  return {
    id: deal.id,
    title: deal.title,
    stageId: deal.stageId,
    stageName: stage.name,
    stageColor: stage.color,
    movedById: deal.movedById,
    movedByName: usersById.get(deal.movedById) || `Employee #${deal.movedById}`,
    assignedById: deal.assignedById,
    assignedByName: usersById.get(deal.assignedById) || `Employee #${deal.assignedById}`,
    movedTime: deal.movedTime,
  };
}

function stageInfo(stageId, stages) {
  return stages.find((stage) => stage.id === stageId) || { name: stageId || "No stage", color: "#dce3ee", semantics: "" };
}

function stageSemantics(stageId, stages) {
  return stageInfo(stageId, stages).semantics;
}

function normalizeColor(color) {
  if (!color || color === "#") return "#dce3ee";
  return color.startsWith("#") ? color : `#${color}`;
}

function getServerRange(rangeName) {
  if (rangeName === "all") {
    return {
      name: rangeName,
      current: { from: "", to: "" },
      previous: { from: "", to: "" },
    };
  }

  const now = new Date();
  const current = rangeToDates(rangeName, now);
  const duration = current.to.getTime() - current.from.getTime();
  const previousTo = rangeName === "all" ? new Date(current.to) : new Date(current.from.getTime() - 1);
  const previousFrom = rangeName === "all" ? new Date(current.to) : new Date(previousTo.getTime() - duration);

  return {
    name: rangeName,
    current: { from: current.from.toISOString(), to: current.to.toISOString() },
    previous: { from: previousFrom.toISOString(), to: previousTo.toISOString() },
  };
}

function rangeToDates(rangeName, now) {
  const from = new Date(now);
  const to = new Date(now);

  if (rangeName === "yesterday") {
    from.setDate(from.getDate() - 1);
    from.setHours(0, 0, 0, 0);
    to.setDate(to.getDate() - 1);
    to.setHours(23, 59, 59, 999);
  } else if (rangeName === "7d") {
    from.setDate(from.getDate() - 7);
  } else if (rangeName === "30d") {
    from.setDate(from.getDate() - 30);
  } else {
    from.setHours(0, 0, 0, 0);
  }

  return { from, to };
}

async function fetchTelephonyCalls(from, to) {
  const calls = [];
  let start = 0;

  do {
    const response = await callBitrix("voximplant.statistic.get", {
      FILTER: {
        ">=CALL_START_DATE": from,
        "<=CALL_START_DATE": to,
      },
      SORT: "CALL_START_DATE",
      ORDER: "DESC",
      start,
    });

    if (!Array.isArray(response.result)) {
      throw new Error(response.error_description || response.error || "Unexpected Bitrix24 response");
    }

    calls.push(...response.result.map(normalizeCall));
    start = typeof response.next === "number" ? response.next : null;
  } while (start !== null && calls.length < 1000);

  return calls;
}

async function fetchCrmActivityCalls(from, to) {
  const calls = [];
  let start = 0;

  do {
    const response = await callBitrix("crm.activity.list", {
      filter: {
        TYPE_ID: 2,
        ">=START_TIME": from,
        "<=START_TIME": to,
      },
      order: {
        START_TIME: "DESC",
      },
      select: [
        "ID",
        "OWNER_ID",
        "OWNER_TYPE_ID",
        "TYPE_ID",
        "PROVIDER_ID",
        "PROVIDER_TYPE_ID",
        "SUBJECT",
        "START_TIME",
        "END_TIME",
        "RESPONSIBLE_ID",
        "COMPLETED",
        "DIRECTION",
        "DESCRIPTION",
      ],
      start,
    });

    if (!Array.isArray(response.result)) {
      throw new Error(response.error_description || response.error || "Unexpected Bitrix24 CRM response");
    }

    calls.push(...response.result.map(normalizeCrmActivityCall));
    start = typeof response.next === "number" ? response.next : null;
  } while (start !== null && calls.length < 1000);

  return calls;
}

function normalizeCall(call) {
  return {
    id: String(call.ID || call.CALL_ID || crypto.randomUUID()),
    callId: String(call.CALL_ID || ""),
    userId: String(call.PORTAL_USER_ID || "unknown"),
    phone: String(call.PHONE_NUMBER || ""),
    type: Number(call.CALL_TYPE || 0),
    duration: Number(call.CALL_DURATION || 0),
    startedAt: call.CALL_START_DATE || null,
    resultCode: String(call.CALL_FAILED_CODE || ""),
    resultReason: call.CALL_FAILED_REASON || "",
    crmEntityType: call.CRM_ENTITY_TYPE || "",
    crmEntityId: call.CRM_ENTITY_ID || "",
    crmActivityId: call.CRM_ACTIVITY_ID || "",
    recordUrl: call.CALL_RECORD_URL || "",
  };
}

function normalizeCrmActivityCall(activity) {
  const duration = secondsBetween(activity.START_TIME, activity.END_TIME);
  const successful = duration > 0;

  return {
    id: String(activity.ID || crypto.randomUUID()),
    callId: String(activity.ID || ""),
    userId: String(activity.RESPONSIBLE_ID || "unknown"),
    phone: extractPhone(activity.SUBJECT || ""),
    type: Number(activity.DIRECTION || 0),
    duration,
    startedAt: activity.START_TIME || null,
    resultCode: successful ? "200" : "304",
    resultReason: successful ? "" : activity.COMPLETED === "Y" ? "No duration" : "Not completed",
    crmEntityType: ownerType(activity.OWNER_TYPE_ID),
    crmEntityId: String(activity.OWNER_ID || ""),
    crmActivityId: String(activity.ID || ""),
    recordUrl: "",
  };
}

function secondsBetween(start, end) {
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
    return 0;
  }
  return Math.round((endTime - startTime) / 1000);
}

function extractPhone(subject) {
  const match = String(subject).match(/(?:на|от)\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function ownerType(id) {
  return (
    {
      1: "LEAD",
      2: "DEAL",
      3: "CONTACT",
      4: "COMPANY",
    }[Number(id)] || String(id || "")
  );
}

async function serveStatic(pathname, res) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = resolve(publicDir, `.${safePath}`);

  if (!filePath.startsWith(publicDir)) {
    return sendJson(res, { error: "not_found" }, 404);
  }

  try {
    const body = await readFile(filePath);
    res.writeHead(200, { "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream" });
    res.end(body);
  } catch {
    sendJson(res, { error: "not_found" }, 404);
  }
}

function sendJson(res, payload, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function normalizeWebhookUrl(value) {
  if (!value) return "";
  return value.endsWith("/") ? value : `${value}/`;
}

function loadEnv(path) {
  if (!existsSync(path)) return;
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    process.env[key] ||= value.replace(/^"|"$/g, "");
  }
}

function startOfTodayIso() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.toISOString();
}

function parsePayload(body, contentType = "") {
  if (contentType.includes("application/json")) {
    return JSON.parse(body || "{}");
  }

  if (contentType.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(body));
  }

  return body;
}

function readBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        rejectBody(new Error("Request body is too large"));
      }
    });
    req.on("end", () => resolveBody(body));
    req.on("error", rejectBody);
  });
}

function broadcast(eventName, payload) {
  for (const client of clients) {
    client.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
  }
}

function buildDemoCalls(from) {
  const names = ["1", "2", "3"];
  const now = Date.now();
  return Array.from({ length: 42 }, (_, index) => {
    const minutesAgo = index * 17 + (index % 5) * 3;
    const successful = index % 6 !== 0;
    return {
      id: `demo-${index + 1}`,
      callId: `demo-call-${index + 1}`,
      userId: names[index % names.length],
      phone: `+7 900 ${String(100 + index).padStart(3, "0")} ${String(2000 + index).slice(1)}`,
      type: index % 4 === 0 ? 2 : 1,
      duration: successful ? 35 + ((index * 29) % 420) : 0,
      startedAt: new Date(Math.max(new Date(from).getTime(), now - minutesAgo * 60_000)).toISOString(),
      resultCode: successful ? "200" : index % 2 === 0 ? "304" : "486",
      resultReason: successful ? "" : index % 2 === 0 ? "Missed" : "Busy",
      crmEntityType: index % 3 === 0 ? "LEAD" : "CONTACT",
      crmEntityId: String(9000 + index),
      crmActivityId: String(12000 + index),
      recordUrl: "",
    };
  });
}

function buildDemoDealDashboard(rangeName) {
  const stages = [
    { id: "demo-new", name: "Заявка получена", color: "#39a8ef", semantics: "process" },
    { id: "demo-no-answer", name: "Недозвон", color: "#fff55a", semantics: "process" },
    { id: "demo-consult", name: "Консультация", color: "#75d900", semantics: "process" },
    { id: "demo-docs", name: "Будет подавать документы", color: "#2fb644", semantics: "process" },
  ];
  const users = [
    { id: "1", name: "Анна Смирнова" },
    { id: "2", name: "Илья Корнеев" },
    { id: "3", name: "Мария Волкова" },
  ];

  return {
    mode: "demo",
    source: "deals_moved_time",
    range: getServerRange(rangeName),
    users,
    stages,
    summary: {
      movedCount: 86,
      previousMovedCount: 73,
      delta: 13,
      activeDeals: 244,
      activeManagers: 3,
      movedManagers: 3,
      wonMoves: 4,
      lostMoves: 9,
    },
    managers: [
      {
        userId: "1",
        name: "Анна Смирнова",
        movedCount: 34,
        previousMovedCount: 29,
        delta: 5,
        activeDeals: 91,
        activeValue: 0,
        statuses: [
          { stageId: "demo-no-answer", name: "Недозвон", color: "#fff55a", count: 38 },
          { stageId: "demo-consult", name: "Консультация", color: "#75d900", count: 22 },
        ],
      },
      {
        userId: "2",
        name: "Илья Корнеев",
        movedCount: 28,
        previousMovedCount: 35,
        delta: -7,
        activeDeals: 78,
        activeValue: 0,
        statuses: [
          { stageId: "demo-new", name: "Заявка получена", color: "#39a8ef", count: 31 },
          { stageId: "demo-docs", name: "Будет подавать документы", color: "#2fb644", count: 14 },
        ],
      },
      {
        userId: "3",
        name: "Мария Волкова",
        movedCount: 24,
        previousMovedCount: 9,
        delta: 15,
        activeDeals: 75,
        activeValue: 0,
        statuses: [
          { stageId: "demo-consult", name: "Консультация", color: "#75d900", count: 26 },
          { stageId: "demo-no-answer", name: "Недозвон", color: "#fff55a", count: 19 },
        ],
      },
    ],
    stageTotals: [
      { stageId: "demo-no-answer", name: "Недозвон", color: "#fff55a", count: 96 },
      { stageId: "demo-consult", name: "Консультация", color: "#75d900", count: 67 },
      { stageId: "demo-new", name: "Заявка получена", color: "#39a8ef", count: 49 },
      { stageId: "demo-docs", name: "Будет подавать документы", color: "#2fb644", count: 32 },
    ],
    recentMoves: [],
    fetchedAt: new Date().toISOString(),
  };
}
