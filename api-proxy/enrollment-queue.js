const XLSX = require("xlsx");

const CACHE_MS = Number(process.env.ENROLLMENT_CACHE_SECONDS || 300) * 1000;
let cached = null;
let graphTokenCache = null;

function normalized(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function number(value) {
  const parsed = Number(String(value ?? "0").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function excelDate(value) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value;
  if (typeof value === "number") {
    const parts = XLSX.SSF.parse_date_code(value);
    if (parts) return new Date(Date.UTC(parts.y, parts.m - 1, parts.d));
  }
  const text = normalized(value);
  const ru = text.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})/);
  if (ru) return new Date(Date.UTC(Number(ru[3]) < 100 ? 2000 + Number(ru[3]) : Number(ru[3]), Number(ru[2]) - 1, Number(ru[1])));
  const date = new Date(text);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function downloadUrl(input) {
  const url = new URL(input);
  url.searchParams.set("download", "1");
  return url.toString();
}

function graphConfigured() {
  return Boolean(process.env.MICROSOFT_TENANT_ID && process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
}

async function graphAccessToken() {
  if (graphTokenCache && graphTokenCache.expiresAt > Date.now() + 60000) return graphTokenCache.token;
  const tenant = process.env.MICROSOFT_TENANT_ID;
  const body = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID,
    client_secret: process.env.MICROSOFT_CLIENT_SECRET,
    scope: process.env.MICROSOFT_SCOPE || "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(30000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(`Microsoft token error: ${payload.error_description || payload.error || response.status}`);
  }
  graphTokenCache = {
    token: payload.access_token,
    expiresAt: Date.now() + Number(payload.expires_in || 3600) * 1000,
  };
  return graphTokenCache.token;
}

function graphShareId(url) {
  return `u!${Buffer.from(url, "utf8").toString("base64url")}`;
}

async function fetchViaGraph(source, signal) {
  const token = await graphAccessToken();
  const response = await fetch(`https://graph.microsoft.com/v1.0/shares/${graphShareId(source)}/driveItem/content`, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "follow",
    signal,
  });
  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`Microsoft Graph HTTP ${response.status}${details ? `: ${details.slice(0, 300)}` : ""}`);
  }
  return response;
}

async function fetchWorkbook() {
  const source = process.env.ENROLLMENT_XLSX_URL;
  if (!source) throw new Error("ENROLLMENT_XLSX_URL is not configured");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const headers = {
      Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream;q=0.9,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
    };
    if (process.env.ENROLLMENT_XLSX_BEARER_TOKEN) headers.Authorization = `Bearer ${process.env.ENROLLMENT_XLSX_BEARER_TOKEN}`;
    const response = graphConfigured()
      ? await fetchViaGraph(source, controller.signal)
      : await fetch(downloadUrl(source), { signal: controller.signal, redirect: "follow", headers });
    if (!response.ok) throw new Error(`SharePoint HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.subarray(0, 2).toString() !== "PK") {
      throw new Error("SharePoint вернул не Excel. Проверьте ссылку и разрешения Microsoft Graph");
    }
    return XLSX.read(buffer, { type: "buffer", cellDates: true });
  } finally {
    clearTimeout(timeout);
  }
}

function rows(workbook, name) {
  const sheet = workbook.Sheets[name];
  if (!sheet) throw new Error(`Лист «${name}» не найден`);
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
}

function findHeader(matrix, words, minimumMatches = 1) {
  for (let row = 0; row < Math.min(matrix.length, 40); row += 1) {
    const values = matrix[row].map((cell) => normalized(cell).toLowerCase());
    const matches = words.filter((word) => values.some((cell) => cell.includes(word))).length;
    if (matches >= minimumMatches) return row;
  }
  return 0;
}

function findColumn(headers, variants, fallback = -1) {
  const clean = headers.map((cell) => normalized(cell).toLowerCase());
  const index = clean.findIndex((cell) => variants.some((variant) => cell.includes(variant)));
  return index >= 0 ? index : fallback;
}

function parsePlan(workbook) {
  const matrix = rows(workbook, "Сводный план");
  const headerRow = findHeader(matrix, ["образовательная программа", "всего план"], 2);
  const headers = matrix[headerRow] || [];
  const programCol = findColumn(headers, ["образовательная программа", "наименование оп", "программа"], 0);
  const planCol = findColumn(headers, ["всего план"], 11);
  const items = [];
  for (const row of matrix.slice(headerRow + 1)) {
    const program = normalized(row[programCol]);
    const plan = number(row[planCol]);
    if (!program || /итого|всего/i.test(program) || plan <= 0) continue;
    items.push({ program, plan });
  }
  if (!items.length) throw new Error("Не удалось прочитать план набора");
  return items;
}

function parseApplicants(workbook) {
  const matrix = rows(workbook, "Основной список");
  const headerRow = findHeader(matrix, ["фио", "дата подачи"], 2);
  const headers = matrix[headerRow] || [];
  const dateCol = findColumn(headers, ["дата подачи", "дата обращения", "дата регистрации"], 1);
  const nameCol = findColumn(headers, ["ф.и.о. поступающего", "фио поступающего", "абитуриент"], 2);
  const consultantCol = findColumn(headers, ["фио консультанта", "консультант", "менеджер"], 3);
  const programCol = findColumn(headers, ["образовательная программа", "программа"], 10);
  const statusCol = findColumn(headers, ["статус", "документ"], -1);
  return matrix.slice(headerRow + 1).map((row) => ({
    date: excelDate(row[dateCol]),
    name: normalized(row[nameCol]),
    consultant: normalized(row[consultantCol]) || "Не указан",
    program: normalized(row[programCol]) || "Не указана",
    status: statusCol >= 0 ? normalized(row[statusCol]) : "",
  })).filter((item) => item.name && item.program !== "Не указана");
}

function matchPlan(program, plans) {
  const key = normalized(program).toLowerCase();
  return plans.find((item) => {
    const candidate = item.program.toLowerCase();
    return candidate === key || candidate.includes(key) || key.includes(candidate);
  });
}

function buildDashboard(workbook) {
  const plans = parsePlan(workbook);
  const applicants = parseApplicants(workbook);
  const totalPlan = plans.reduce((sum, item) => sum + item.plan, 0);
  const actual = applicants.length;
  const dated = applicants.filter((item) => item.date).sort((a, b) => a.date - b.date);
  const firstDate = dated[0]?.date || new Date();
  const now = new Date();
  const target = new Date(`${process.env.ENROLLMENT_TARGET_DATE || "2026-08-25"}T23:59:59+05:00`);
  const elapsedDays = Math.max(1, Math.ceil((now - firstDate) / 86400000));
  const remainingDays = Math.max(0, Math.ceil((target - now) / 86400000));
  const dailyPace = actual / elapsedDays;
  const forecast = Math.min(totalPlan, Math.round(actual + dailyPace * remainingDays));

  const byProgram = plans.map((plan) => {
    const count = applicants.filter((item) => matchPlan(item.program, [plan])).length;
    return { ...plan, actual: count, remaining: Math.max(0, plan.plan - count), progress: plan.plan ? Math.round(count / plan.plan * 1000) / 10 : 0 };
  }).sort((a, b) => b.actual - a.actual || b.plan - a.plan);
  const unmatched = applicants.filter((item) => !matchPlan(item.program, plans));
  if (unmatched.length) byProgram.push({ program: "Другие / не сопоставлены", plan: 0, actual: unmatched.length, remaining: 0, progress: 0 });

  const consultants = new Map();
  applicants.forEach((item) => consultants.set(item.consultant, (consultants.get(item.consultant) || 0) + 1));

  return {
    ok: true,
    fetchedAt: new Date().toISOString(),
    sourceUpdatedAt: workbook.Props?.ModifiedDate || null,
    targetDate: target.toISOString(),
    summary: {
      plan: totalPlan,
      actual,
      remaining: Math.max(0, totalPlan - actual),
      progress: totalPlan ? Math.round(actual / totalPlan * 1000) / 10 : 0,
      dailyPace: Math.round(dailyPace * 10) / 10,
      requiredDailyPace: remainingDays ? Math.round(Math.max(0, totalPlan - actual) / remainingDays * 10) / 10 : 0,
      forecast,
      forecastProgress: totalPlan ? Math.round(forecast / totalPlan * 1000) / 10 : 0,
      remainingDays,
    },
    byProgram,
    consultants: [...consultants].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    recent: [...applicants].filter((item) => item.date).sort((a, b) => b.date - a.date).slice(0, 20).map((item) => ({ ...item, date: item.date.toISOString() })),
  };
}

async function enrollmentDashboard() {
  if (cached && Date.now() - cached.createdAt < CACHE_MS) return { ...cached.payload, cache: "fresh" };
  try {
    const payload = buildDashboard(await fetchWorkbook());
    cached = { createdAt: Date.now(), payload };
    return { ...payload, cache: "updated" };
  } catch (error) {
    if (cached) return { ...cached.payload, cache: "stale", warning: error.message };
    throw error;
  }
}

async function queueStatus() {
  const apiUrl = process.env.QUEUE_API_URL;
  if (!apiUrl) return { ok: false, configured: false, adminUrl: "https://queue.mok.kz/admin", message: "Для живых данных нужен API URL и токен электронной очереди" };
  const headers = { Accept: "application/json" };
  if (process.env.QUEUE_API_TOKEN) headers.Authorization = `Bearer ${process.env.QUEUE_API_TOKEN}`;
  const response = await fetch(apiUrl, { headers, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Queue API HTTP ${response.status}`);
  return { ok: true, configured: true, fetchedAt: new Date().toISOString(), data: await response.json() };
}

module.exports = { enrollmentDashboard, queueStatus, buildDashboard };
