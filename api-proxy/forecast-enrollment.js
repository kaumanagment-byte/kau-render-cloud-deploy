const BITRIX24_WEBHOOK_URL = String(process.env.BITRIX24_WEBHOOK_URL || process.env.BITRIX_WEBHOOK_URL || "").replace(/\/+$/, "");
const WARM_CATEGORY_ID = String(process.env.ENROLLMENT_WARM_CATEGORY_ID || "65");
const TARGET_DATE = process.env.ENROLLMENT_TARGET_DATE || "2026-08-25";
const PROGRAM_FIELD = process.env.ENROLLMENT_PROGRAM_FIELD || "";
const LANG_FIELD = process.env.ENROLLMENT_LANG_FIELD || "";
const CACHE_SECONDS = Number(process.env.ENROLLMENT_FORECAST_CACHE_SECONDS || 180);

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

const TOTAL_PLAN = PROGRAM_PLANS.reduce((sum, item) => sum + item.plan, 0);

const STAGE_LABELS = {
  [`C${WARM_CATEGORY_ID}:NEW`]: "Заявка получена",
  [`C${WARM_CATEGORY_ID}:PREPARATION`]: "Недозвон",
  [`C${WARM_CATEGORY_ID}:UC_MM3IOI`]: "Недозвон 2 раз",
  [`C${WARM_CATEGORY_ID}:UC_B4XOIT`]: "Консультация",
  [`C${WARM_CATEGORY_ID}:PREPAYMENT_INVOIC`]: "Школьник 10 класс",
  [`C${WARM_CATEGORY_ID}:EXECUTING`]: "Заинтересован",
  [`C${WARM_CATEGORY_ID}:UC_9TMMPO`]: "Выбирает другие проф предметы",
  [`C${WARM_CATEGORY_ID}:UC_M251NP`]: "Выбирает другой ВУЗ",
  [`C${WARM_CATEGORY_ID}:UC_VE22KW`]: "Не поступает в этом году",
  [`C${WARM_CATEGORY_ID}:UC_9BJFKR`]: "Пришел на консультацию",
  [`C${WARM_CATEGORY_ID}:FINAL_INVOICE`]: "Будет подавать документы",
  [`C${WARM_CATEGORY_ID}:UC_2ZMVBI`]: "Сдал документы",
  [`C${WARM_CATEGORY_ID}:UC_DP5O3Q`]: "Подписал договор",
  [`C${WARM_CATEGORY_ID}:UC_76TT8Q`]: "Оплатил за обучение",
  [`C${WARM_CATEGORY_ID}:WON`]: "Поступил(-а)",
};

const FACT_STAGES = new Set([
  `C${WARM_CATEGORY_ID}:UC_2ZMVBI`,
  `C${WARM_CATEGORY_ID}:UC_DP5O3Q`,
  `C${WARM_CATEGORY_ID}:UC_76TT8Q`,
  `C${WARM_CATEGORY_ID}:WON`,
]);

const STAGE_WEIGHTS = {
  [`C${WARM_CATEGORY_ID}:WON`]: { conservative: 1, realistic: 1, optimistic: 1 },
  [`C${WARM_CATEGORY_ID}:UC_76TT8Q`]: { conservative: 1, realistic: 1, optimistic: 1 },
  [`C${WARM_CATEGORY_ID}:UC_DP5O3Q`]: { conservative: 0.95, realistic: 1, optimistic: 1 },
  [`C${WARM_CATEGORY_ID}:UC_2ZMVBI`]: { conservative: 0.85, realistic: 0.95, optimistic: 1 },
  [`C${WARM_CATEGORY_ID}:FINAL_INVOICE`]: { conservative: 0.45, realistic: 0.65, optimistic: 0.8 },
  [`C${WARM_CATEGORY_ID}:UC_9BJFKR`]: { conservative: 0.3, realistic: 0.5, optimistic: 0.65 },
  [`C${WARM_CATEGORY_ID}:EXECUTING`]: { conservative: 0.18, realistic: 0.35, optimistic: 0.5 },
  [`C${WARM_CATEGORY_ID}:UC_B4XOIT`]: { conservative: 0.12, realistic: 0.25, optimistic: 0.4 },
  [`C${WARM_CATEGORY_ID}:NEW`]: { conservative: 0.03, realistic: 0.08, optimistic: 0.15 },
  [`C${WARM_CATEGORY_ID}:PREPARATION`]: { conservative: 0.01, realistic: 0.04, optimistic: 0.08 },
  [`C${WARM_CATEGORY_ID}:UC_MM3IOI`]: { conservative: 0.005, realistic: 0.02, optimistic: 0.05 },
  [`C${WARM_CATEGORY_ID}:PREPAYMENT_INVOIC`]: { conservative: 0.02, realistic: 0.05, optimistic: 0.1 },
};

const NEGATIVE_STAGES = new Set([
  `C${WARM_CATEGORY_ID}:UC_9TMMPO`,
  `C${WARM_CATEGORY_ID}:UC_M251NP`,
  `C${WARM_CATEGORY_ID}:UC_VE22KW`,
]);

let cache = null;

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
  const haystack = normalize([direct, deal.TITLE, deal.OPPORTUNITY, deal.SOURCE_DESCRIPTION].filter(Boolean).join(" "));
  if (!haystack) return "Не указано";

  for (const row of PROGRAM_PLANS) {
    const name = normalize(row.program);
    const shortName = name.replace("международный бизнес и предпринимательство", "мб и предпринимательство");
    if (haystack.includes(name) || haystack.includes(shortName)) return row.program;
  }

  if (haystack.includes("мб") && haystack.includes("предприним")) return "Международный бизнес и предпринимательство";
  if (haystack.includes("журналист")) return "Журналистика";
  if (haystack.includes("туризм")) return "Туризм";
  if (haystack.includes("юрис")) return "Юриспруденция";
  if (haystack.includes("финанс")) return "Финансы";
  if (haystack.includes("перевод")) return "Переводческое дело";
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

function pct(part, whole) {
  if (!whole) return 0;
  return Math.round((Number(part || 0) / Number(whole || 0)) * 1000) / 10;
}

function daysLeft() {
  const target = new Date(`${TARGET_DATE}T23:59:59+05:00`);
  const diff = target.getTime() - Date.now();
  return Math.max(1, Math.ceil(diff / 86400000));
}

async function bitrix(method, params = {}) {
  if (!BITRIX24_WEBHOOK_URL) throw new Error("BITRIX24_WEBHOOK_URL is not configured");
  const response = await fetch(`${BITRIX24_WEBHOOK_URL}/${method}.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) {
    throw new Error(payload.error_description || payload.error || `Bitrix HTTP ${response.status}`);
  }
  return payload;
}

async function fetchAllDeals() {
  const select = [
    "ID",
    "TITLE",
    "CATEGORY_ID",
    "STAGE_ID",
    "ASSIGNED_BY_ID",
    "SOURCE_ID",
    "SOURCE_DESCRIPTION",
    "DATE_CREATE",
    "DATE_MODIFY",
  ];
  if (PROGRAM_FIELD) select.push(PROGRAM_FIELD);
  if (LANG_FIELD) select.push(LANG_FIELD);

  const deals = [];
  let start = 0;
  do {
    const payload = await bitrix("crm.deal.list", {
      order: { ID: "DESC" },
      filter: { CATEGORY_ID: WARM_CATEGORY_ID },
      select,
      start,
    });
    const batch = Array.isArray(payload.result) ? payload.result : [];
    deals.push(...batch);
    start = typeof payload.next === "number" ? payload.next : null;
  } while (start !== null && deals.length < 20000);
  return deals;
}

async function fetchUsers(ids) {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  const users = new Map();
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    try {
      const payload = await bitrix("user.get", { ID: chunk });
      for (const user of payload.result || []) {
        const name = [user.NAME, user.LAST_NAME].filter(Boolean).join(" ").trim() || `ID ${user.ID}`;
        users.set(String(user.ID), name);
      }
    } catch {
      chunk.forEach((id) => users.set(String(id), `ID ${id}`));
    }
  }
  return users;
}

function add(map, key, amount = 1) {
  const safeKey = key || "Не указано";
  map.set(safeKey, Number(map.get(safeKey) || 0) + amount);
}

function scenarioValue(deals, scenario) {
  return Math.round(
    deals.reduce((sum, deal) => {
      if (NEGATIVE_STAGES.has(deal.STAGE_ID)) return sum;
      const weights = STAGE_WEIGHTS[deal.STAGE_ID] || { conservative: 0, realistic: 0, optimistic: 0 };
      return sum + Number(weights[scenario] || 0);
    }, 0)
  );
}

function buildProgramRows(deals) {
  const byProgram = new Map(PROGRAM_PLANS.map((row) => [row.program, { ...row, actual: 0, conservative: 0, realistic: 0, optimistic: 0, langs: { kaz: 0, rus: 0, eng: 0, unknown: 0 } }]));
  const unknown = { program: "Не указано в CRM", plan: 0, kaz: 0, rus: 0, eng: 0, actual: 0, conservative: 0, realistic: 0, optimistic: 0, langs: { kaz: 0, rus: 0, eng: 0, unknown: 0 } };

  for (const deal of deals) {
    const program = detectProgram(deal);
    const row = byProgram.get(program) || unknown;
    const lang = detectLang(deal);
    row.langs[lang] = Number(row.langs[lang] || 0) + 1;
    if (FACT_STAGES.has(deal.STAGE_ID)) row.actual += 1;
    if (!NEGATIVE_STAGES.has(deal.STAGE_ID)) {
      const weights = STAGE_WEIGHTS[deal.STAGE_ID] || {};
      row.conservative += Number(weights.conservative || 0);
      row.realistic += Number(weights.realistic || 0);
      row.optimistic += Number(weights.optimistic || 0);
    }
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

async function buildForecast() {
  const deals = await fetchAllDeals();
  const userMap = await fetchUsers(deals.map((deal) => deal.ASSIGNED_BY_ID));

  const activeDeals = deals.filter((deal) => !NEGATIVE_STAGES.has(deal.STAGE_ID));
  const factDeals = deals.filter((deal) => FACT_STAGES.has(deal.STAGE_ID));
  const stageMap = new Map();
  const sourceMap = new Map();
  const managerMap = new Map();

  for (const deal of deals) {
    add(stageMap, STAGE_LABELS[deal.STAGE_ID] || deal.STAGE_ID);
    add(sourceMap, deal.SOURCE_DESCRIPTION || deal.SOURCE_ID || "Не указан");
    const managerName = userMap.get(String(deal.ASSIGNED_BY_ID || "")) || `ID ${deal.ASSIGNED_BY_ID || "?"}`;
    const current = managerMap.get(managerName) || { name: managerName, total: 0, fact: 0, realistic: 0 };
    current.total += 1;
    if (FACT_STAGES.has(deal.STAGE_ID)) current.fact += 1;
    current.realistic += Number((STAGE_WEIGHTS[deal.STAGE_ID] || {}).realistic || 0);
    managerMap.set(managerName, current);
  }

  const conservative = Math.min(TOTAL_PLAN, scenarioValue(deals, "conservative"));
  const realistic = Math.min(TOTAL_PLAN, scenarioValue(deals, "realistic"));
  const optimistic = Math.min(TOTAL_PLAN, scenarioValue(deals, "optimistic"));
  const actual = factDeals.length;
  const left = Math.max(0, TOTAL_PLAN - actual);
  const leftDays = daysLeft();

  return {
    ok: true,
    source: "Bitrix24 CRM",
    categoryId: WARM_CATEGORY_ID,
    targetDate: TARGET_DATE,
    fetchedAt: new Date().toISOString(),
    rules: {
      factStages: [...FACT_STAGES].map((id) => ({ id, name: STAGE_LABELS[id] || id })),
      note: "Факт берется из теплой базы: Сдал документы и все следующие стадии.",
    },
    summary: {
      plan: TOTAL_PLAN,
      actual,
      remaining: left,
      progress: pct(actual, TOTAL_PLAN),
      activeDeals: activeDeals.length,
      allWarmDeals: deals.length,
      daysLeft: leftDays,
      requiredDailyPace: Math.round((left / leftDays) * 10) / 10,
    },
    scenarios: {
      conservative: { label: "Осторожный", value: conservative, progress: pct(conservative, TOTAL_PLAN), remaining: Math.max(0, TOTAL_PLAN - conservative) },
      realistic: { label: "Реалистичный", value: realistic, progress: pct(realistic, TOTAL_PLAN), remaining: Math.max(0, TOTAL_PLAN - realistic) },
      optimistic: { label: "Оптимистичный", value: optimistic, progress: pct(optimistic, TOTAL_PLAN), remaining: Math.max(0, TOTAL_PLAN - optimistic) },
    },
    byProgram: buildProgramRows(deals),
    byStage: [...stageMap.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    bySource: [...sourceMap.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 20),
    consultants: [...managerMap.values()].map((item) => ({ ...item, realistic: Math.round(item.realistic) })).sort((a, b) => b.realistic - a.realistic).slice(0, 30),
    fields: {
      programField: PROGRAM_FIELD || null,
      languageField: LANG_FIELD || null,
      programSplitReady: Boolean(PROGRAM_FIELD),
      languageSplitReady: Boolean(LANG_FIELD),
    },
  };
}

async function enrollmentForecast() {
  const now = Date.now();
  if (cache && now - cache.createdAt < CACHE_SECONDS * 1000) {
    return { ...cache.payload, cache: "fresh" };
  }
  const payload = await buildForecast();
  cache = { createdAt: Date.now(), payload };
  return { ...payload, cache: "updated" };
}

module.exports = { enrollmentForecast, buildForecast };
