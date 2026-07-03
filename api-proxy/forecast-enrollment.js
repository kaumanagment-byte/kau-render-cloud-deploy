const BITRIX24_WEBHOOK_URL = String(process.env.BITRIX24_WEBHOOK_URL || process.env.BITRIX_WEBHOOK_URL || "").replace(/\/+$/, "");
const WARM_CATEGORY_ID = String(process.env.ENROLLMENT_WARM_CATEGORY_ID || "65");
const TARGET_DATE = process.env.ENROLLMENT_TARGET_DATE || "2026-08-25";
const PROGRAM_FIELD = process.env.ENROLLMENT_PROGRAM_FIELD || "";
const LANG_FIELD = process.env.ENROLLMENT_LANG_FIELD || "";

const CACHE_SECONDS = Number(process.env.ENROLLMENT_FORECAST_CACHE_SECONDS || 180);
const SAMPLE_LIMIT = Number(process.env.ENROLLMENT_FORECAST_SAMPLE_LIMIT || 500);
const BITRIX_TIMEOUT_MS = Number(process.env.BITRIX_TIMEOUT_MS || 8000);

const PROGRAM_PLANS = [
  { program: "Международные отношения", plan: 130, kaz: 80, rus: 40, eng: 10 },
  { program: "Переводческое дело", plan: 120, kaz: 66, rus: 44, eng: 10 },
  { program: "Туризм", plan: 90, kaz: 40, rus: 40, eng: 10 },
  { program: "Международный бизнес и предпринимательство", plan: 70, kaz: 30, rus: 30, eng: 10 },
  { program: "AI в бизнесе и технологиях", plan: 66, kaz: 18, rus: 36, eng: 12 },
  { program: "Журналистика", plan: 54, kaz: 22, rus: 22, eng: 10 },
  { program: "Финансы", plan: 50, kaz: 20, rus: 20, eng: 10 },
  { program: "Юриспруденция", plan: 55, kaz: 30, rus: 15, eng: 10 },
  { program: "Цифровой маркетинг", plan: 43, kaz: 15, rus: 18, eng: 10 },
  { program: "Креативные индустрии и продюсирование", plan: 34, kaz: 12, rus: 12, eng: 10 },
  { program: "Аудит и налоговый консалтинг", plan: 40, kaz: 15, rus: 15, eng: 10 },
  { program: "Бизнес-аналитика", plan: 40, kaz: 15, rus: 15, eng: 10 },
  { program: "Бизнес и ИТ", plan: 40, kaz: 15, rus: 15, eng: 10 },
  { program: "Финансовые технологии", plan: 34, kaz: 12, rus: 12, eng: 10 },
];

const TOTAL_PLAN = PROGRAM_PLANS.reduce((sum, row) => sum + row.plan, 0);

function stage(code) {
  return `C${WARM_CATEGORY_ID}:${code}`;
}

const STAGES = [
  // Верхняя часть воронки / колл-центр
  { id: stage("NEW"), name: "Заявка получена", group: "Новая база", conservative: 0.03, realistic: 0.08, optimistic: 0.15 },
  { id: stage("PREPARATION"), name: "Недозвон", group: "Колл-центр", conservative: 0.01, realistic: 0.04, optimistic: 0.08 },
  { id: stage("UC_MM3IOI"), name: "Недозвон 2 раз", group: "Колл-центр", conservative: 0.005, realistic: 0.02, optimistic: 0.05 },

  // Теплая обработка
  { id: stage("UC_B4XOIT"), name: "Консультация", group: "Теплая база", conservative: 0.12, realistic: 0.25, optimistic: 0.4 },
  { id: stage("UC_9BJFKR"), name: "Пришел на консультацию", group: "Теплая база", conservative: 0.35, realistic: 0.55, optimistic: 0.75 },
  { id: stage("EXECUTING"), name: "Заинтересован", group: "Теплая база", conservative: 0.22, realistic: 0.4, optimistic: 0.58 },
  { id: stage("FINAL_INVOICE"), name: "Будет подавать документы", group: "Горячая база", conservative: 0.55, realistic: 0.72, optimistic: 0.88 },

  // Уже близко к факту / факт
  { id: stage("UC_2ZMVBI"), name: "Сдал документы", group: "Факт", fact: true, conservative: 1, realistic: 1, optimistic: 1 },
  { id: stage("UC_DP5O3Q"), name: "Подписал договор", group: "Факт", fact: true, conservative: 1, realistic: 1, optimistic: 1 },
  { id: stage("UC_76TT8Q"), name: "Оплатил за обучение", group: "Факт", fact: true, conservative: 1, realistic: 1, optimistic: 1 },
  { id: stage("WON"), name: "Поступил(-а)", group: "Факт", fact: true, conservative: 1, realistic: 1, optimistic: 1 },

  // Не включаем в прогноз набора, но показываем в воронке
  { id: stage("PREPAYMENT_INVOIC"), name: "Школьник 10 класс", group: "Отложено", conservative: 0.02, realistic: 0.05, optimistic: 0.1 },
  { id: stage("UC_9TMMPO"), name: "Выбирает другие проф предметы", group: "Риск / не берем", negative: true, conservative: 0, realistic: 0, optimistic: 0 },
  { id: stage("UC_M251NP"), name: "Выбирает другой ВУЗ", group: "Риск / не берем", negative: true, conservative: 0, realistic: 0, optimistic: 0 },
  { id: stage("UC_VE22KW"), name: "Не поступает в этом году", group: "Риск / не берем", negative: true, conservative: 0, realistic: 0, optimistic: 0 },
  { id: stage("LOSE"), name: "Проиграна / отказ", group: "Риск / не берем", negative: true, conservative: 0, realistic: 0, optimistic: 0 },

  // Эти коды были в CRM, но без понятного названия. Пока считаем их нейтрально.
  { id: stage("1"), name: "Статус C65:1", group: "Не размечено", conservative: 0, realistic: 0, optimistic: 0 },
  { id: stage("2"), name: "Статус C65:2", group: "Не размечено", conservative: 0, realistic: 0, optimistic: 0 },
  { id: stage("3"), name: "Статус C65:3", group: "Не размечено", conservative: 0, realistic: 0, optimistic: 0 },
];

let cache = null;

function pct(part, whole) {
  if (!whole) return 0;
  return Math.round((Number(part || 0) / Number(whole || 0)) * 1000) / 10;
}

function daysLeft() {
  const target = new Date(`${TARGET_DATE}T23:59:59+05:00`);
  return Math.max(1, Math.ceil((target.getTime() - Date.now()) / 86400000));
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .trim();
}

function rawFieldValue(value) {
  if (Array.isArray(value)) return rawFieldValue(value[0]);
  if (value && typeof value === "object") return value.VALUE ?? value.value ?? value.TEXT ?? value.text ?? value.NAME ?? value.name ?? "";
  return value ?? "";
}

function detectProgram(deal) {
  const direct = rawFieldValue(PROGRAM_FIELD ? deal[PROGRAM_FIELD] : "");
  const haystack = normalize([direct, deal.TITLE, deal.SOURCE_DESCRIPTION].filter(Boolean).join(" "));
  if (!haystack) return "Не указано";
  for (const row of PROGRAM_PLANS) {
    const full = normalize(row.program);
    if (haystack.includes(full)) return row.program;
  }
  if (haystack.includes("мб") && haystack.includes("предприним")) return "Международный бизнес и предпринимательство";
  if (haystack.includes("международ") && haystack.includes("отнош")) return "Международные отношения";
  if (haystack.includes("перевод")) return "Переводческое дело";
  if (haystack.includes("туризм")) return "Туризм";
  if (haystack.includes("журналист")) return "Журналистика";
  if (haystack.includes("юрис")) return "Юриспруденция";
  if (haystack.includes("финанс")) return "Финансы";
  return "Не указано";
}

function detectLang(deal) {
  const direct = normalize(rawFieldValue(LANG_FIELD ? deal[LANG_FIELD] : ""));
  const haystack = normalize([direct, deal.TITLE, deal.SOURCE_DESCRIPTION].filter(Boolean).join(" "));
  if (haystack.includes("анг") || haystack.includes("eng") || haystack.includes("english")) return "eng";
  if (haystack.includes("рус") || haystack.includes("rus")) return "rus";
  if (haystack.includes("каз") || haystack.includes("kaz")) return "kaz";
  return "unknown";
}

async function bitrix(method, params = {}) {
  if (!BITRIX24_WEBHOOK_URL) throw new Error("BITRIX24_WEBHOOK_URL is not configured");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BITRIX_TIMEOUT_MS);
  try {
    const response = await fetch(`${BITRIX24_WEBHOOK_URL}/${method}.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; }
    catch { payload = { raw: text }; }
    if (!response.ok || payload.error) throw new Error(payload.error_description || payload.error || `Bitrix HTTP ${response.status}`);
    return payload;
  } catch (error) {
    if (error.name === "AbortError") throw new Error(`Bitrix timeout after ${BITRIX_TIMEOUT_MS}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function countDeals(filter) {
  const payload = await bitrix("crm.deal.list", {
    order: { ID: "DESC" },
    filter,
    select: ["ID"],
    start: 0,
  });
  if (typeof payload.total === "number") return payload.total;
  return Array.isArray(payload.result) ? payload.result.length : 0;
}

async function fetchStageCounts() {
  const rows = [];
  for (const item of STAGES) {
    const count = await countDeals({ "=CATEGORY_ID": Number(WARM_CATEGORY_ID), "=STAGE_ID": item.id });
    rows.push({ ...item, count });
  }
  return rows;
}

async function fetchSampleDeals() {
  const select = ["ID", "TITLE", "STAGE_ID", "ASSIGNED_BY_ID", "SOURCE_ID", "SOURCE_DESCRIPTION"];
  if (PROGRAM_FIELD) select.push(PROGRAM_FIELD);
  if (LANG_FIELD) select.push(LANG_FIELD);

  const deals = [];
  let start = 0;
  do {
    const payload = await bitrix("crm.deal.list", {
      order: { ID: "DESC" },
      filter: { "=CATEGORY_ID": Number(WARM_CATEGORY_ID) },
      select,
      start,
    });
    const batch = Array.isArray(payload.result) ? payload.result : [];
    deals.push(...batch);
    start = typeof payload.next === "number" ? payload.next : null;
  } while (start !== null && deals.length < SAMPLE_LIMIT);
  return deals.slice(0, SAMPLE_LIMIT);
}

function add(map, key, amount = 1) {
  const safeKey = key || "Не указано";
  map.set(safeKey, Number(map.get(safeKey) || 0) + amount);
}

function scenarioFromStages(stageRows, scenario) {
  return Math.round(stageRows.reduce((sum, row) => sum + Number(row.count || 0) * Number(row[scenario] || 0), 0));
}

function buildGroups(stageRows) {
  const map = new Map();
  for (const row of stageRows) {
    const current = map.get(row.group) || { name: row.group, count: 0, realistic: 0 };
    current.count += Number(row.count || 0);
    current.realistic += Number(row.count || 0) * Number(row.realistic || 0);
    map.set(row.group, current);
  }
  return [...map.values()].map((row) => ({ ...row, realistic: Math.round(row.realistic) }));
}

function buildProgramRows(sampleDeals) {
  const byProgram = new Map(PROGRAM_PLANS.map((row) => [row.program, { ...row, actual: 0, conservative: 0, realistic: 0, optimistic: 0, langs: { kaz: 0, rus: 0, eng: 0, unknown: 0 } }]));
  const unknown = { program: "Не указано в CRM", plan: 0, kaz: 0, rus: 0, eng: 0, actual: 0, conservative: 0, realistic: 0, optimistic: 0, langs: { kaz: 0, rus: 0, eng: 0, unknown: 0 } };

  const stageMap = new Map(STAGES.map((row) => [row.id, row]));
  for (const deal of sampleDeals) {
    const program = detectProgram(deal);
    const row = byProgram.get(program) || unknown;
    const stageRow = stageMap.get(deal.STAGE_ID) || {};
    const lang = detectLang(deal);
    row.langs[lang] = Number(row.langs[lang] || 0) + 1;
    if (stageRow.fact) row.actual += 1;
    row.conservative += Number(stageRow.conservative || 0);
    row.realistic += Number(stageRow.realistic || 0);
    row.optimistic += Number(stageRow.optimistic || 0);
  }

  const rows = [...byProgram.values()];
  if (unknown.actual || unknown.realistic || unknown.langs.unknown) rows.push(unknown);
  return rows.map((row) => ({
    ...row,
    conservative: Math.round(row.conservative),
    realistic: Math.round(row.realistic),
    optimistic: Math.round(row.optimistic),
    remaining: Math.max(0, Number(row.plan || 0) - Number(row.actual || 0)),
    progress: pct(row.actual, row.plan),
  }));
}

function buildSampleBreakdowns(sampleDeals) {
  const sourceMap = new Map();
  const managerMap = new Map();
  const stageMap = new Map(STAGES.map((row) => [row.id, row]));

  for (const deal of sampleDeals) {
    add(sourceMap, deal.SOURCE_DESCRIPTION || deal.SOURCE_ID || "Не указан");
    const stageRow = stageMap.get(deal.STAGE_ID) || {};
    const managerName = `ID ${deal.ASSIGNED_BY_ID || "?"}`;
    const current = managerMap.get(managerName) || { name: managerName, total: 0, fact: 0, realistic: 0 };
    current.total += 1;
    if (stageRow.fact) current.fact += 1;
    current.realistic += Number(stageRow.realistic || 0);
    managerMap.set(managerName, current);
  }

  return {
    bySource: [...sourceMap.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 20),
    consultants: [...managerMap.values()].map((item) => ({ ...item, realistic: Math.round(item.realistic) })).sort((a, b) => b.realistic - a.realistic).slice(0, 30),
  };
}

async function buildForecast() {
  const stageRows = await fetchStageCounts();
  const sampleDeals = await fetchSampleDeals().catch(() => []);
  const sample = buildSampleBreakdowns(sampleDeals);

  const actual = stageRows.filter((row) => row.fact).reduce((sum, row) => sum + Number(row.count || 0), 0);
  const allWarmDeals = await countDeals({ "=CATEGORY_ID": Number(WARM_CATEGORY_ID) }).catch(() => stageRows.reduce((sum, row) => sum + Number(row.count || 0), 0));
  const riskDeals = stageRows.filter((row) => row.negative).reduce((sum, row) => sum + Number(row.count || 0), 0);
  const activeDeals = Math.max(0, allWarmDeals - riskDeals);
  const left = Math.max(0, TOTAL_PLAN - actual);
  const leftDays = daysLeft();

  const conservative = Math.min(TOTAL_PLAN, scenarioFromStages(stageRows, "conservative"));
  const realistic = Math.min(TOTAL_PLAN, scenarioFromStages(stageRows, "realistic"));
  const optimistic = Math.min(TOTAL_PLAN, scenarioFromStages(stageRows, "optimistic"));

  return {
    ok: true,
    source: "Bitrix24 CRM",
    categoryId: WARM_CATEGORY_ID,
    targetDate: TARGET_DATE,
    fetchedAt: new Date().toISOString(),
    rules: {
      note: "Факт считается точным count-запросом по стадиям теплой базы. Прогноз строится по всем ключевым статусам, а не по ограниченному срезу сделок.",
      factStages: stageRows.filter((row) => row.fact).map((row) => ({ id: row.id, name: row.name, count: row.count })),
      forecastStages: stageRows.filter((row) => !row.negative && Number(row.realistic || 0) > 0).map((row) => ({
        id: row.id,
        name: row.name,
        count: row.count,
        conservativeWeight: row.conservative,
        realisticWeight: row.realistic,
        optimisticWeight: row.optimistic,
      })),
    },
    summary: {
      plan: TOTAL_PLAN,
      actual,
      remaining: left,
      progress: pct(actual, TOTAL_PLAN),
      activeDeals,
      allWarmDeals,
      riskDeals,
      daysLeft: leftDays,
      requiredDailyPace: Math.round((left / leftDays) * 10) / 10,
      sampleDeals: sampleDeals.length,
    },
    scenarios: {
      conservative: { label: "Осторожный", value: conservative, progress: pct(conservative, TOTAL_PLAN), remaining: Math.max(0, TOTAL_PLAN - conservative) },
      realistic: { label: "Реалистичный", value: realistic, progress: pct(realistic, TOTAL_PLAN), remaining: Math.max(0, TOTAL_PLAN - realistic) },
      optimistic: { label: "Оптимистичный", value: optimistic, progress: pct(optimistic, TOTAL_PLAN), remaining: Math.max(0, TOTAL_PLAN - optimistic) },
    },
    forecastGroups: buildGroups(stageRows),
    byStage: stageRows.filter((row) => Number(row.count || 0) > 0).map((row) => ({
      name: row.name,
      id: row.id,
      group: row.group,
      count: row.count,
      realisticImpact: Math.round(Number(row.count || 0) * Number(row.realistic || 0)),
    })).sort((a, b) => b.count - a.count),
    byProgram: buildProgramRows(sampleDeals),
    bySource: sample.bySource,
    consultants: sample.consultants,
    fields: {
      programField: PROGRAM_FIELD || null,
      languageField: LANG_FIELD || null,
      programSplitReady: Boolean(PROGRAM_FIELD),
      languageSplitReady: Boolean(LANG_FIELD),
      sourceAndManagerMode: "sample",
    },
  };
}

async function enrollmentForecast() {
  const now = Date.now();
  if (cache && now - cache.createdAt < CACHE_SECONDS * 1000) return { ...cache.payload, cache: "fresh" };
  const payload = await buildForecast();
  cache = { createdAt: Date.now(), payload };
  return { ...payload, cache: "updated" };
}

module.exports = { enrollmentForecast, buildForecast };
