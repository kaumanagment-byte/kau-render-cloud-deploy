const fs = require("node:fs");
const path = require("node:path");

const BITRIX24_WEBHOOK_URL = String(process.env.BITRIX24_WEBHOOK_URL || process.env.BITRIX_WEBHOOK_URL || "").replace(/\/+$/, "");
const WARM_CATEGORY_ID = String(process.env.ENROLLMENT_WARM_CATEGORY_ID || "65");
const INCLUDED_CATEGORY_IDS = String(process.env.ENROLLMENT_INCLUDE_CATEGORY_IDS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const DEFAULT_ADMISSION_CATEGORY_IDS = ["33", "53", "63", "65", "67", "69", "73", "75", "77"];
const TARGET_DATE = process.env.ENROLLMENT_TARGET_DATE || "2026-08-25";
const TOTAL_PLAN = Number(process.env.ENROLLMENT_PLAN_TOTAL || 800);

const PROGRAM_FIELD = process.env.ENROLLMENT_PROGRAM_FIELD || "";
const LANG_FIELD = process.env.ENROLLMENT_LANG_FIELD || "";
const CITY_FIELD = process.env.ENROLLMENT_CITY_FIELD || "";
const LAST_COMM_FIELD = process.env.ENROLLMENT_LAST_COMM_FIELD || "";
const NEXT_ACTION_FIELD = process.env.ENROLLMENT_NEXT_ACTION_FIELD || "";
const FULL_NAME_FIELD = process.env.ENROLLMENT_FULL_NAME_FIELD || "";
const PHONE_FIELD = process.env.ENROLLMENT_PHONE_FIELD || "";
const EMAIL_FIELD = process.env.ENROLLMENT_EMAIL_FIELD || "";
const ENTS_FIELD = process.env.ENROLLMENT_ENT_SUBJECTS_FIELD || "";
const UTM_SOURCE_FIELD = process.env.ENROLLMENT_UTM_SOURCE_FIELD || "";
const UTM_MEDIUM_FIELD = process.env.ENROLLMENT_UTM_MEDIUM_FIELD || "";
const UTM_CAMPAIGN_FIELD = process.env.ENROLLMENT_UTM_CAMPAIGN_FIELD || "";
const UTM_CONTENT_FIELD = process.env.ENROLLMENT_UTM_CONTENT_FIELD || "";
const UTM_TERM_FIELD = process.env.ENROLLMENT_UTM_TERM_FIELD || "";

const CACHE_SECONDS = Number(process.env.ENROLLMENT_FORECAST_CACHE_SECONDS || 3600);
const BITRIX_TIMEOUT_MS = Number(process.env.BITRIX_TIMEOUT_MS || 15000);
const DEAL_LIMIT = Number(process.env.ENROLLMENT_FORECAST_DEAL_LIMIT || 900);
const DEAL_LIMIT_PER_CATEGORY = Number(process.env.ENROLLMENT_FORECAST_DEAL_LIMIT_PER_CATEGORY || 100);
const SNAPSHOT_DIR = path.join(__dirname, "data");
const SNAPSHOT_FILE = path.join(SNAPSHOT_DIR, "enrollment-forecast-snapshots.json");

const PROGRAM_PLANS = [
  { program: "Международные отношения", plan: 130 },
  { program: "Переводческое дело", plan: 120 },
  { program: "Туризм", plan: 90 },
  { program: "Международный бизнес и предпринимательство", plan: 70 },
  { program: "AI в бизнесе и технологиях", plan: 66 },
  { program: "Журналистика", plan: 54 },
  { program: "Финансы", plan: 50 },
  { program: "Юриспруденция", plan: 55 },
  { program: "Цифровой маркетинг", plan: 43 },
  { program: "Креативные индустрии и продюсирование", plan: 34 },
  { program: "Аудит и налоговый консалтинг", plan: 40 },
  { program: "Бизнес-аналитика", plan: 40 },
  { program: "Бизнес и IT", plan: 40 },
  { program: "Финансовые технологии", plan: 34 },
];

function stage(code, categoryId = WARM_CATEGORY_ID) {
  return `C${categoryId}:${code}`;
}

const STAGE_RULES = [
  { key: "submitted", ids: [stage("UC_2ZMVBI")], aliases: ["сдал документы"], conservative: 1, realistic: 1, optimistic: 1, fact: true, hot: true },
  { key: "joining_us", ids: [stage("1")], aliases: ["поступает к нам"], conservative: 0.7, realistic: 0.85, optimistic: 0.95, hot: true },
  { key: "will_submit", ids: [stage("FINAL_INVOICE")], aliases: ["будет подавать документы"], conservative: 0.55, realistic: 0.75, optimistic: 0.9, hot: true },
  { key: "interested_kau", ids: [stage("2"), stage("UC_9BJFKR")], aliases: ["заинтересован в кау", "пришел на консультацию"], conservative: 0.35, realistic: 0.5, optimistic: 0.7, hot: true },
  { key: "interested", ids: [stage("EXECUTING"), stage("3")], aliases: ["заинтересован"], conservative: 0.2, realistic: 0.35, optimistic: 0.5, hot: true },
  { key: "consultation", ids: [stage("UC_B4XOIT")], aliases: ["консультация"], conservative: 0.15, realistic: 0.25, optimistic: 0.36, hot: false },
  { key: "new_application", ids: [stage("NEW")], aliases: ["заявка получена"], conservative: 0.08, realistic: 0.16, optimistic: 0.25, hot: false },
  { key: "event", ids: [], aliases: ["придет", "придет на ивент"], conservative: 0.03, realistic: 0.08, optimistic: 0.15, hot: false },
  { key: "no_answer_1", ids: [stage("PREPARATION")], aliases: ["недозвон"], conservative: 0.0015, realistic: 0.005, optimistic: 0.012, hot: false },
  { key: "no_answer_2", ids: [stage("UC_MM3IOI")], aliases: ["недозвон 2 раз"], conservative: 0.0008, realistic: 0.0025, optimistic: 0.006, hot: false },
  { key: "other_university", ids: [stage("UC_M251NP")], aliases: ["выбирает другой вуз"], conservative: 0.008, realistic: 0.02, optimistic: 0.05, hot: false, negative: true },
  { key: "our_subjects_other_university", ids: [], aliases: ["наши предметы выбрал другой вуз"], conservative: 0.015, realistic: 0.03, optimistic: 0.07, hot: false, negative: true },
  { key: "other_profile_subjects", ids: [stage("UC_9TMMPO")], aliases: ["выбирает другие проф предметы", "другие проф предметы"], conservative: 0.0005, realistic: 0.0015, optimistic: 0.004, hot: false, negative: true },
  { key: "tenth_grade", ids: [stage("PREPAYMENT_INVOIC"), stage("UC_VE22KW")], aliases: ["школьник 10 класс", "не поступает в этом году"], conservative: 0.0002, realistic: 0.0005, optimistic: 0.001, hot: false, negative: true },
  { key: "agreement_signed", ids: [stage("UC_DP5O3Q")], aliases: ["подписал договор"], conservative: 1, realistic: 1, optimistic: 1, fact: true, hot: true },
  { key: "paid", ids: [stage("UC_76TT8Q")], aliases: ["оплатил за обучение"], conservative: 1, realistic: 1, optimistic: 1, fact: true, hot: true },
  { key: "won", ids: [stage("WON")], aliases: ["поступил"], conservative: 1, realistic: 1, optimistic: 1, fact: true, hot: true },
  { key: "lost", ids: [stage("LOSE")], aliases: ["проиграна", "отказ"], conservative: 0, realistic: 0, optimistic: 0, hot: false, negative: true },
];

const FUNNEL_MULTIPLIERS = [
  { name: "Теплая база ПК", multiplier: 1.25, aliases: ["теплая база", "теплая база пк"] },
  { name: "Онлайн заявки на консультацию", multiplier: 1.2, aliases: ["онлайн", "заявки на консультацию", "crm-форма", "веб-сайт", "сайт", "форма"] },
  { name: "Мероприятия", multiplier: 1.1, aliases: ["мероприят", "ивент", "выставка", "event"] },
  { name: "Call Center", multiplier: 0.9, aliases: ["call center", "колл", "callcenter"] },
  { name: "БД Родители", multiplier: 0.8, aliases: ["родител"] },
  { name: "БД от партнёров", multiplier: 0.7, aliases: ["партнер", "партнёр"] },
  { name: "Обход школ / колледжей Алматы", multiplier: 0.6, aliases: ["обход школ", "алматы"] },
  { name: "Обход школ / колледжей командировки", multiplier: 0.55, aliases: ["командировк"] },
  { name: "База для ПК", multiplier: 0.45, aliases: ["база для пк"] },
  { name: "Олимпиада", multiplier: 0.7, aliases: ["олимпиад"] },
];

const SOURCE_MULTIPLIERS = [
  { name: "CRM-форма", multiplier: 1.2, aliases: ["crm", "форма"] },
  { name: "Веб-сайт", multiplier: 1.2, aliases: ["веб", "сайт", "website", "web"] },
  { name: "Реклама", multiplier: 1.2, aliases: ["реклама", "ads", "ad", "google", "yandex"] },
  { name: "TikTok", multiplier: 1.2, aliases: ["tiktok", "тикток"] },
  { name: "Meta", multiplier: 1.2, aliases: ["meta", "facebook", "fb"] },
  { name: "Instagram", multiplier: 1.15, aliases: ["instagram", "insta"] },
  { name: "WhatsApp", multiplier: 1.15, aliases: ["whatsapp", "ватсап", "вацап"] },
  { name: "Звонок", multiplier: 1.1, aliases: ["звонок", "call", "phone"] },
  { name: "Выставка", multiplier: 1.05, aliases: ["выставка", "expo"] },
  { name: "Образовательный центр", multiplier: 0.9, aliases: ["образовательный центр"] },
  { name: "Обход школ", multiplier: 0.8, aliases: ["школ", "school"] },
  { name: "Другое", multiplier: 0.8, aliases: ["другое", "other"] },
];

const STANDARD_FIELDS = [
  "ID",
  "TITLE",
  "CATEGORY_ID",
  "STAGE_ID",
  "SOURCE_ID",
  "SOURCE_DESCRIPTION",
  "ASSIGNED_BY_ID",
  "DATE_CREATE",
  "DATE_MODIFY",
  "LAST_ACTIVITY_TIME",
];

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

function clipProbability(value) {
  return Math.max(0, Math.min(1, Number(value || 0)));
}

function round1(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function pct(part, whole) {
  if (!whole) return 0;
  return round1((Number(part || 0) / Number(whole || 0)) * 100);
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysSince(value) {
  const date = parseDate(value);
  if (!date) return null;
  return Math.floor((Date.now() - date.getTime()) / 86400000);
}

function daysLeft() {
  const target = new Date(`${TARGET_DATE}T23:59:59+05:00`);
  return Math.max(1, Math.ceil((target.getTime() - Date.now()) / 86400000));
}

function academicPeriod() {
  const target = new Date(`${TARGET_DATE}T23:59:59+05:00`);
  const targetYear = target.getUTCFullYear();
  const startYear = target.getUTCMonth() >= 8 ? targetYear : targetYear - 1;
  const start = new Date(Date.UTC(startYear, 8, 1, 0, 0, 0));
  const end = target;
  return { start, end };
}

function isWithinAcademicPeriod(value) {
  const date = parseDate(value);
  if (!date) return false;
  const { start, end } = academicPeriod();
  return date >= start && date <= end;
}

function pickAcademicAnchorDate(deal) {
  return deal?.dateCreate || deal?.dateModify || deal?.lastCommunication || null;
}

function getEnvFields() {
  return [
    PROGRAM_FIELD,
    LANG_FIELD,
    CITY_FIELD,
    LAST_COMM_FIELD,
    NEXT_ACTION_FIELD,
    FULL_NAME_FIELD,
    PHONE_FIELD,
    EMAIL_FIELD,
    ENTS_FIELD,
    UTM_SOURCE_FIELD,
    UTM_MEDIUM_FIELD,
    UTM_CAMPAIGN_FIELD,
    UTM_CONTENT_FIELD,
    UTM_TERM_FIELD,
  ].filter(Boolean);
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
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }
    if (!response.ok || payload.error) throw new Error(payload.error_description || payload.error || `Bitrix HTTP ${response.status}`);
    return payload;
  } catch (error) {
    if (error.name === "AbortError") throw new Error(`Bitrix timeout after ${BITRIX_TIMEOUT_MS}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchDealCategories() {
  const categoryMap = new Map();
  const attempts = [
    ["crm.category.list", { entityTypeId: 2 }],
    ["crm.dealcategory.list", {}],
  ];

  for (const [method, params] of attempts) {
    try {
      const payload = await bitrix(method, params);
      const rows = Array.isArray(payload.result?.categories)
        ? payload.result.categories
        : Array.isArray(payload.result?.items)
          ? payload.result.items
          : Array.isArray(payload.result)
            ? payload.result
            : [];
      if (!rows.length) continue;
      for (const row of rows) {
        const id = String(firstNonEmpty(row.ID, row.id, row.categoryId, row.CATEGORY_ID) || "");
        const name = firstNonEmpty(row.NAME, row.name, row.title, row.TITLE) || `Воронка ${id}`;
        if (id) categoryMap.set(id, name);
      }
      break;
    } catch {}
  }

  if (!categoryMap.has(WARM_CATEGORY_ID)) categoryMap.set(WARM_CATEGORY_ID, "Теплая база");
  return categoryMap;
}

function resolveIncludedCategoryIds(categoryMap = new Map()) {
  if (INCLUDED_CATEGORY_IDS.length) return INCLUDED_CATEGORY_IDS;
  const available = new Set([...categoryMap.keys()]);
  const defaults = DEFAULT_ADMISSION_CATEGORY_IDS.filter((id) => available.has(id));
  if (defaults.length) return defaults;
  return [...categoryMap.keys()];
}

async function fetchStageDictionary(categoryMap = new Map()) {
  const map = new Map();
  const categoryIds = [...new Set([WARM_CATEGORY_ID, ...resolveIncludedCategoryIds(categoryMap)])];

  for (const categoryId of categoryIds) {
    const entityIds = categoryId === "0" ? ["DEAL_STAGE", "DEAL_STAGE_0"] : [`DEAL_STAGE_${categoryId}`];
    for (const entityId of entityIds) {
      try {
        const payload = await bitrix("crm.status.list", { filter: { ENTITY_ID: entityId } });
        const rows = Array.isArray(payload.result) ? payload.result : [];
        for (const row of rows) {
          const id = row.STATUS_ID || row.ID;
          const name = row.NAME || row.STATUS_ID || row.ID;
          if (id) map.set(String(id), { name, semantics: row.SEMANTICS || row.semantics || "" });
        }
      } catch {}
    }
  }

  return map;
}

async function fetchDealsViaItemList(select, categoryIds = []) {
  const deals = [];
  const ids = categoryIds.length ? categoryIds : [WARM_CATEGORY_ID];
  const perCategoryLimit = Math.max(50, Math.min(DEAL_LIMIT, DEAL_LIMIT_PER_CATEGORY || Math.ceil(DEAL_LIMIT / Math.max(1, ids.length))));

  for (const categoryId of ids) {
    let start = 0;
    let categoryCount = 0;
    while (deals.length < DEAL_LIMIT && categoryCount < perCategoryLimit) {
      const payload = await bitrix("crm.item.list", {
        entityTypeId: 2,
        filter: { categoryId: Number(categoryId) },
        order: { id: "desc" },
        select,
        start,
      });
      const rows = Array.isArray(payload.result?.items) ? payload.result.items : Array.isArray(payload.items) ? payload.items : [];
      if (!rows.length) break;
      const slice = rows.slice(0, Math.max(0, perCategoryLimit - categoryCount));
      deals.push(...slice);
      categoryCount += slice.length;
      const next = payload.result?.next ?? payload.next;
      if (typeof next !== "number") break;
      start = next;
    }
  }

  return [...new Map(deals.map((deal) => [String(firstNonEmpty(deal.ID, deal.id)), deal])).values()].slice(0, DEAL_LIMIT);
}

async function fetchDealsViaDealList(select, categoryIds = []) {
  const deals = [];
  const ids = categoryIds.length ? categoryIds : [WARM_CATEGORY_ID];
  const perCategoryLimit = Math.max(50, Math.min(DEAL_LIMIT, DEAL_LIMIT_PER_CATEGORY || Math.ceil(DEAL_LIMIT / Math.max(1, ids.length))));

  for (const categoryId of ids) {
    let start = 0;
    let categoryCount = 0;
    while (deals.length < DEAL_LIMIT && categoryCount < perCategoryLimit) {
      const payload = await bitrix("crm.deal.list", {
        order: { DATE_CREATE: "DESC", ID: "DESC" },
        filter: { "=CATEGORY_ID": Number(categoryId) },
        select,
        start,
      });
      const rows = Array.isArray(payload.result) ? payload.result : [];
      if (!rows.length) break;
      const slice = rows.slice(0, Math.max(0, perCategoryLimit - categoryCount));
      deals.push(...slice);
      categoryCount += slice.length;
      if (typeof payload.next !== "number") break;
      start = payload.next;
    }
  }

  return [...new Map(deals.map((deal) => [String(firstNonEmpty(deal.ID, deal.id)), deal])).values()].slice(0, DEAL_LIMIT);
}

async function fetchDeals(categoryIds = []) {
  const select = [...new Set([...STANDARD_FIELDS, ...getEnvFields()])];
  try {
    const deals = await fetchDealsViaItemList(select, categoryIds);
    if (deals.length) return { deals: deals.map(normalizeDealRecord), method: "crm.item.list" };
  } catch {}
  const deals = await fetchDealsViaDealList(select, categoryIds);
  return { deals: deals.map(normalizeDealRecord), method: "crm.deal.list" };
}

async function fetchDealList(select, filter = {}, order = { ID: "DESC" }, maxItems = Infinity) {
  const rows = [];
  let start = 0;
  while (rows.length < maxItems) {
    const payload = await bitrix("crm.deal.list", {
      order,
      filter,
      select,
      start,
    });
    const chunk = Array.isArray(payload.result) ? payload.result : [];
    if (!chunk.length) break;
    rows.push(...chunk.slice(0, Math.max(0, maxItems - rows.length)));
    if (typeof payload.next !== "number") break;
    start = payload.next;
  }
  return rows;
}

async function fetchDealCount(filter = {}) {
  const payload = await bitrix("crm.deal.list", {
    order: { ID: "DESC" },
    filter,
    select: ["ID"],
    start: 0,
  });
  if (typeof payload.total === "number") return payload.total;
  const rows = Array.isArray(payload.result) ? payload.result : [];
  if (typeof payload.next !== "number") return rows.length;
  const all = await fetchDealList(["ID"], filter, { ID: "DESC" });
  return all.length;
}

async function fetchUsers(ids) {
  const result = new Map();
  const uniqueIds = [...new Set((ids || []).filter(Boolean).map((id) => String(id)))];
  for (const id of uniqueIds) {
    try {
      const payload = await bitrix("user.get", { ID: id });
      const user = Array.isArray(payload.result) ? payload.result[0] : payload.result?.[0];
      const name = [user?.NAME, user?.LAST_NAME].filter(Boolean).join(" ").trim() || [user?.LAST_NAME, user?.NAME].filter(Boolean).join(" ").trim() || `ID ${id}`;
      result.set(id, name);
    } catch {
      result.set(id, `ID ${id}`);
    }
  }
  return result;
}

async function fetchStageHistory() {
  const from7d = new Date(Date.now() - 7 * 86400000).toISOString();
  const attempts = [
    { order: { ID: "DESC" }, filter: { OWNER_TYPE_ID: 2, CATEGORY_ID: Number(WARM_CATEGORY_ID), ">=CREATED_TIME": from7d }, start: 0 },
    { order: { ID: "DESC" }, filter: { OWNER_TYPE_ID: 2, ">=CREATED_TIME": from7d }, start: 0 },
    { order: { ID: "DESC" }, filter: { ">=CREATED_TIME": from7d }, start: 0 },
  ];

  for (const params of attempts) {
    try {
      const payload = await bitrix("crm.stagehistory.list", params);
      const rows = Array.isArray(payload.result) ? payload.result : [];
      if (rows.length) return { rows, mode: "stagehistory" };
    } catch {}
  }
  return { rows: [], mode: "fallback" };
}

function buildStageRuleMaps(stageDict) {
  const byId = new Map();
  const byAlias = new Map();
  for (const rule of STAGE_RULES) {
    for (const id of rule.ids || []) byId.set(id, rule);
    for (const alias of rule.aliases || []) byAlias.set(normalize(alias), rule);
  }
  for (const [id, meta] of stageDict.entries()) {
    const name = meta?.name || meta;
    const norm = normalize(name);
    if (byAlias.has(norm) && !byId.has(id)) byId.set(id, byAlias.get(norm));
  }
  return { byId, byAlias };
}

function detectRuleByStage(id, stageName, maps) {
  if (maps.byId.has(id)) return maps.byId.get(id);
  const normName = normalize(stageName);
  for (const [alias, rule] of maps.byAlias.entries()) {
    if (normName.includes(alias)) return rule;
  }
  return null;
}

function buildExactStageGroups(stageDict) {
  const maps = buildStageRuleMaps(stageDict);
  const groups = new Map();
  const submittedStageIds = [];

  for (const [stageId, meta] of stageDict.entries()) {
    const stageName = meta?.name || meta || stageId;
    const rule = detectRuleByStage(String(stageId), stageName, maps);
    if (!rule) continue;

    if (rule.key === "submitted") {
      submittedStageIds.push(String(stageId));
    }

    if (rule.fact || rule.negative || rule.key === "unknown") continue;

    const existing = groups.get(rule.key) || {
      key: rule.key,
      label: stageName,
      stageIds: [],
      conservative: Number(rule.conservative || 0),
      realistic: Number(rule.realistic || 0),
      optimistic: Number(rule.optimistic || 0),
    };
    existing.stageIds.push(String(stageId));
    groups.set(rule.key, existing);
  }

  return {
    submittedStageIds: [...new Set(submittedStageIds)],
    workingGroups: [...groups.values()],
  };
}

function detectProgram(deal) {
  const direct = rawFieldValue(PROGRAM_FIELD ? deal[PROGRAM_FIELD] : "");
  const haystack = normalize([direct, deal.TITLE, deal.SOURCE_DESCRIPTION].filter(Boolean).join(" "));
  if (!haystack) return "Не указано";
  for (const row of PROGRAM_PLANS) {
    if (haystack.includes(normalize(row.program))) return row.program;
  }
  if (haystack.includes("международ") && haystack.includes("отнош")) return "Международные отношения";
  if (haystack.includes("перевод")) return "Переводческое дело";
  if (haystack.includes("туризм")) return "Туризм";
  if (haystack.includes("предприним")) return "Международный бизнес и предпринимательство";
  if (haystack.includes("журналист")) return "Журналистика";
  if (haystack.includes("финанс")) return "Финансы";
  if (haystack.includes("юрис")) return "Юриспруденция";
  if (haystack.includes("маркет")) return "Цифровой маркетинг";
  if (haystack.includes("аналит")) return "Бизнес-аналитика";
  if (haystack.includes("ai")) return "AI в бизнесе и технологиях";
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

function detectFunnel(text) {
  const haystack = normalize(text);
  if (haystack.includes("теплая база") || haystack.includes("тёплая база")) {
    return { name: "Теплая база ПК", multiplier: 1.25 };
  }
  for (const row of FUNNEL_MULTIPLIERS) {
    if ((row.aliases || []).some((alias) => haystack.includes(normalize(alias)))) return row;
  }
  return { name: "База для ПК", multiplier: 0.45 };
}

function detectSource(text) {
  const haystack = normalize(text);
  if (!haystack) return { name: "Пустой источник", multiplier: 0.85 };
  for (const row of SOURCE_MULTIPLIERS) {
    if ((row.aliases || []).some((alias) => haystack.includes(normalize(alias)))) return row;
  }
  return { name: "Другое", multiplier: 0.8 };
}

function recencyMultiplier(lastCommunication, isWarmStage) {
  const diff = daysSince(lastCommunication);
  if (diff === null) return isWarmStage ? 0.6 : 0.45;
  if (diff <= 1) return 1.35;
  if (diff <= 3) return 1.2;
  if (diff <= 7) return 1.05;
  if (diff <= 14) return 0.9;
  if (diff <= 30) return 0.7;
  if (diff <= 60) return 0.45;
  return 0.25;
}

function toIso(value) {
  const date = parseDate(value);
  return date ? date.toISOString() : null;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const raw = rawFieldValue(value);
    if (String(raw || "").trim()) return raw;
  }
  return "";
}

function normalizeDealRecord(deal) {
  return {
    ...deal,
    ID: firstNonEmpty(deal.ID, deal.id),
    TITLE: firstNonEmpty(deal.TITLE, deal.title),
    CATEGORY_ID: firstNonEmpty(deal.CATEGORY_ID, deal.categoryId, deal.category_id),
    STAGE_ID: firstNonEmpty(deal.STAGE_ID, deal.stageId, deal.stage_id),
    SOURCE_ID: firstNonEmpty(deal.SOURCE_ID, deal.sourceId, deal.source_id),
    SOURCE_DESCRIPTION: firstNonEmpty(deal.SOURCE_DESCRIPTION, deal.sourceDescription, deal.source_description),
    ASSIGNED_BY_ID: firstNonEmpty(deal.ASSIGNED_BY_ID, deal.assignedById, deal.assigned_by_id),
    DATE_CREATE: firstNonEmpty(
      deal.DATE_CREATE,
      deal.CREATED_TIME,
      deal.createdTime,
      deal.created_time,
      deal.dateCreate,
      deal.date_create,
      deal.createdAt,
      deal.created_at
    ),
    DATE_MODIFY: firstNonEmpty(
      deal.DATE_MODIFY,
      deal.UPDATED_TIME,
      deal.updatedTime,
      deal.updated_time,
      deal.dateModify,
      deal.date_modify,
      deal.updatedAt,
      deal.updated_at
    ),
    LAST_ACTIVITY_TIME: firstNonEmpty(
      deal.LAST_ACTIVITY_TIME,
      deal.lastActivityTime,
      deal.last_activity_time,
      deal.lastActivityAt,
      deal.last_activity_at
    ),
  };
}

function getLastCommunication(deal) {
  return firstNonEmpty(
    LAST_COMM_FIELD ? deal[LAST_COMM_FIELD] : "",
    deal.LAST_ACTIVITY_TIME,
    deal.DATE_MODIFY,
  );
}

function getNextActionDate(deal) {
  return firstNonEmpty(NEXT_ACTION_FIELD ? deal[NEXT_ACTION_FIELD] : "");
}

function prepareDeals(rawDeals, stageDict, managerNames, categoryMap = new Map()) {
  const maps = buildStageRuleMaps(stageDict);
  const prepared = [];
  for (const deal of rawDeals) {
    const stageMeta = stageDict.get(deal.STAGE_ID);
    const stageName = stageMeta?.name || stageMeta || deal.STAGE_ID || "Неизвестная стадия";
    const stageSemantics = String(stageMeta?.semantics || "").toUpperCase();
    const rule = detectRuleByStage(String(deal.STAGE_ID || ""), stageName, maps) || {
      key: "unknown",
      conservative: 0,
      realistic: 0,
      optimistic: 0,
      hot: false,
      fact: false,
      negative: false,
    };

    const categoryId = String(deal.CATEGORY_ID || WARM_CATEGORY_ID);
    const categoryName = categoryMap.get(categoryId) || `Воронка ${categoryId}`;
    const sourceText = [deal.SOURCE_DESCRIPTION, deal.SOURCE_ID, rawFieldValue(UTM_SOURCE_FIELD ? deal[UTM_SOURCE_FIELD] : "")].filter(Boolean).join(" ");
    const funnel = detectFunnel([categoryName, sourceText, deal.TITLE].join(" "));
    const source = detectSource(sourceText);
    const lastCommunication = getLastCommunication(deal);
    const isWarmStage = ["joining_us", "will_submit", "interested_kau", "interested", "consultation"].includes(rule.key);
    const recency = recencyMultiplier(lastCommunication, isWarmStage);
    const managerMultiplier = 1;

    const conservative = clipProbability(rule.conservative * funnel.multiplier * source.multiplier * recency * managerMultiplier);
    const realistic = clipProbability(rule.realistic * funnel.multiplier * source.multiplier * recency * managerMultiplier);
    const optimistic = clipProbability(rule.optimistic * funnel.multiplier * source.multiplier * recency * managerMultiplier);

    prepared.push({
      id: String(deal.ID || ""),
      title: deal.TITLE || "",
      categoryId,
      categoryName,
      stageId: String(deal.STAGE_ID || ""),
      stageName,
      stageSemantics,
      stageKey: rule.key,
      sourceId: deal.SOURCE_ID || "",
      sourceDescription: deal.SOURCE_DESCRIPTION || "",
      assignedById: String(deal.ASSIGNED_BY_ID || ""),
      assignedByName: managerNames.get(String(deal.ASSIGNED_BY_ID || "")) || `ID ${deal.ASSIGNED_BY_ID || "?"}`,
      dateCreate: toIso(deal.DATE_CREATE),
      dateModify: toIso(deal.DATE_MODIFY),
      lastCommunication: toIso(lastCommunication),
      nextActionDate: toIso(getNextActionDate(deal)),
      program: detectProgram(deal),
      language: detectLang(deal),
      city: rawFieldValue(CITY_FIELD ? deal[CITY_FIELD] : ""),
      entSubjects: rawFieldValue(ENTS_FIELD ? deal[ENTS_FIELD] : ""),
      phone: rawFieldValue(PHONE_FIELD ? deal[PHONE_FIELD] : ""),
      email: rawFieldValue(EMAIL_FIELD ? deal[EMAIL_FIELD] : ""),
      fullName: rawFieldValue(FULL_NAME_FIELD ? deal[FULL_NAME_FIELD] : ""),
      utmSource: rawFieldValue(UTM_SOURCE_FIELD ? deal[UTM_SOURCE_FIELD] : ""),
      utmMedium: rawFieldValue(UTM_MEDIUM_FIELD ? deal[UTM_MEDIUM_FIELD] : ""),
      utmCampaign: rawFieldValue(UTM_CAMPAIGN_FIELD ? deal[UTM_CAMPAIGN_FIELD] : ""),
      utmContent: rawFieldValue(UTM_CONTENT_FIELD ? deal[UTM_CONTENT_FIELD] : ""),
      utmTerm: rawFieldValue(UTM_TERM_FIELD ? deal[UTM_TERM_FIELD] : ""),
      stageProbability: {
        conservative: rule.conservative,
        realistic: rule.realistic,
        optimistic: rule.optimistic,
      },
      multipliers: {
        funnel: funnel.multiplier,
        funnelName: funnel.name,
        source: source.multiplier,
        sourceName: source.name,
        recency,
        manager: managerMultiplier,
      },
      probability: { conservative, realistic, optimistic },
      flags: {
        fact: Boolean(rule.fact),
        negative: Boolean(rule.negative),
        hot: Boolean(rule.hot),
      },
      noCommDays: daysSince(lastCommunication),
      nextActionMissing: !parseDate(getNextActionDate(deal)),
    });
  }
  return prepared;
}

function summarizeRisk(actual, realistic, optimistic) {
  if (realistic >= TOTAL_PLAN) return { key: "green", label: "Зеленый", text: "Реалистичный прогноз уже закрывает план." };
  if (optimistic >= TOTAL_PLAN) return { key: "yellow", label: "Желтый", text: "План пока не закрыт реалистично, но достижим при сильном дожиме." };
  return { key: "red", label: "Красный", text: "Даже оптимистичный сценарий пока ниже плана." };
}

function buildByStage(deals) {
  const map = new Map();
  for (const deal of deals) {
    const row = map.get(deal.stageName) || {
      stage: deal.stageName,
      count: 0,
      conservative: 0,
      realistic: 0,
      optimistic: 0,
    };
    row.count += 1;
    row.conservative += deal.probability.conservative;
    row.realistic += deal.probability.realistic;
    row.optimistic += deal.probability.optimistic;
    map.set(deal.stageName, row);
  }

  const totalRealistic = [...map.values()].reduce((sum, row) => sum + row.realistic, 0) || 1;
  return [...map.values()]
    .map((row) => ({
      stage: row.stage,
      count: row.count,
      avgProbability: round2(row.realistic / Math.max(1, row.count)),
      forecastContribution: round1(row.realistic),
      forecastShare: pct(row.realistic, totalRealistic),
      conservativeContribution: round1(row.conservative),
      optimisticContribution: round1(row.optimistic),
    }))
    .sort((a, b) => b.forecastContribution - a.forecastContribution);
}

function buildBySource(deals) {
  const map = new Map();
  for (const deal of deals) {
    const key = deal.multipliers.sourceName || "Пустой источник";
    const row = map.get(key) || { source: key, count: 0, submitted: 0, projected: 0 };
    row.count += 1;
    if (deal.flags.fact) row.submitted += 1;
    row.projected += deal.probability.realistic;
    map.set(key, row);
  }
  return [...map.values()]
    .map((row) => ({
      source: row.source,
      count: row.count,
      submitted: row.submitted,
      conversion: pct(row.submitted, row.count),
      projected: round1(row.projected),
      leadCost: null,
      acquiredCost: null,
    }))
    .sort((a, b) => b.projected - a.projected);
}

function buildByManager(deals) {
  const totals = deals.reduce((acc, deal) => {
    const key = deal.assignedByName;
    const row = acc.get(key) || { manager: key, total: 0, submitted: 0, hotDeals: 0, overdueCommunications: 0, projected: 0 };
    row.total += 1;
    if (deal.flags.fact) row.submitted += 1;
    if (deal.flags.hot && !deal.flags.fact) row.hotDeals += 1;
    if ((deal.noCommDays ?? 0) > 7) row.overdueCommunications += 1;
    row.projected += deal.probability.realistic;
    acc.set(key, row);
    return acc;
  }, new Map());

  const rows = [...totals.values()];
  const averageConversion = rows.reduce((sum, row) => sum + (row.total ? row.submitted / row.total : 0), 0) / Math.max(1, rows.length);

  return rows
    .map((row) => {
      const conversion = row.total ? row.submitted / row.total : 0;
      const rating = averageConversion > 0 ? round2(conversion / averageConversion) : 1;
      return {
        manager: row.manager,
        total: row.total,
        submitted: row.submitted,
        hotDeals: row.hotDeals,
        overdueCommunications: row.overdueCommunications,
        projected: round1(row.projected),
        conversion: pct(row.submitted, row.total),
        rating,
      };
    })
    .sort((a, b) => b.projected - a.projected);
}

function buildSubmittedByManager(deals) {
  const totals = deals.reduce((acc, deal) => {
    const key = deal.assignedByName || "Без ответственного";
    const row = acc.get(key) || { manager: key, submitted: 0 };
    row.submitted += 1;
    acc.set(key, row);
    return acc;
  }, new Map());

  return [...totals.values()].sort((a, b) => b.submitted - a.submitted || a.manager.localeCompare(b.manager, "ru"));
}

function buildBySpecialty(deals) {
  const base = new Map(PROGRAM_PLANS.map((row) => [row.program, { specialty: row.program, plan: row.plan, actual: 0, forecast: 0 }]));
  if (!base.has("Не определено")) base.set("Не определено", { specialty: "Не определено", plan: 0, actual: 0, forecast: 0 });
  for (const deal of deals) {
    const row = base.get(deal.program) || base.get("Не определено");
    row.actual += 1;
    row.forecast += 1;
  }
  const totalActual = deals.length || 1;
  return [...base.values()]
    .filter((row) => row.plan > 0 || row.actual > 0 || row.forecast > 0)
    .map((row) => ({
      specialty: row.specialty,
      plan: row.plan,
      actual: row.actual,
      forecast: row.actual,
      delta: round1(row.actual - row.plan),
      share: pct(row.actual, totalActual),
    }))
    .sort((a, b) => b.actual - a.actual);
}

function buildProgramRows(deals) {
  const base = new Map(PROGRAM_PLANS.map((row) => [row.program, { ...row, actual: 0, realistic: 0, conservative: 0, optimistic: 0, langs: { kaz: 0, rus: 0, eng: 0, unknown: 0 } }]));
  if (!base.has("Не определено")) base.set("Не определено", { program: "Не определено", plan: 0, actual: 0, realistic: 0, conservative: 0, optimistic: 0, langs: { kaz: 0, rus: 0, eng: 0, unknown: 0 } });
  for (const deal of deals) {
    const row = base.get(deal.program) || base.get("Не определено");
    if (deal.flags.fact) row.actual += 1;
    row.realistic += deal.probability.realistic;
    row.conservative += deal.probability.conservative;
    row.optimistic += deal.probability.optimistic;
    row.langs[deal.language] = Number(row.langs[deal.language] || 0) + 1;
  }
  return [...base.values()]
    .filter((row) => row.plan > 0 || row.actual > 0 || row.realistic > 0)
    .map((row) => ({
      ...row,
      realistic: round1(row.realistic),
      conservative: round1(row.conservative),
      optimistic: round1(row.optimistic),
      remaining: Math.max(0, Number(row.plan || 0) - Number(row.actual || 0)),
      progress: pct(row.actual, row.plan),
    }))
    .sort((a, b) => b.realistic - a.realistic);
}

function buildSubmittedProgramRows(deals) {
  const base = new Map(PROGRAM_PLANS.map((row) => [row.program, { ...row, actual: 0, realistic: 0, conservative: 0, optimistic: 0, langs: { kaz: 0, rus: 0, eng: 0, unknown: 0 } }]));
  if (!base.has("Не определено")) base.set("Не определено", { program: "Не определено", plan: 0, actual: 0, realistic: 0, conservative: 0, optimistic: 0, langs: { kaz: 0, rus: 0, eng: 0, unknown: 0 } });
  for (const deal of deals) {
    const row = base.get(deal.program) || base.get("Не определено");
    row.actual += 1;
    row.realistic += 1;
    row.conservative += 1;
    row.optimistic += 1;
    row.langs[deal.language] = Number(row.langs[deal.language] || 0) + 1;
  }
  return [...base.values()]
    .filter((row) => row.plan > 0 || row.actual > 0)
    .map((row) => ({
      ...row,
      realistic: row.actual,
      conservative: row.actual,
      optimistic: row.actual,
      remaining: Math.max(0, Number(row.plan || 0) - Number(row.actual || 0)),
      progress: pct(row.actual, row.plan),
    }))
    .sort((a, b) => b.actual - a.actual);
}

function buildRisks(deals) {
  const risks = [];
  for (const deal of deals) {
    const lastDays = deal.noCommDays;
    if ((lastDays ?? -1) > 7) {
      risks.push({ type: "Нет коммуникации > 7 дней", severity: "high", dealId: deal.id, name: deal.fullName || deal.title || `Сделка ${deal.id}`, stage: deal.stageName, manager: deal.assignedByName, days: lastDays });
    }
    if (deal.flags.hot && !deal.flags.fact && deal.nextActionMissing) {
      risks.push({ type: "Горячая сделка без следующего действия", severity: "high", dealId: deal.id, name: deal.fullName || deal.title || `Сделка ${deal.id}`, stage: deal.stageName, manager: deal.assignedByName, days: lastDays });
    }
    if (deal.stageKey === "will_submit" && (lastDays ?? -1) > 2) {
      risks.push({ type: "Будет подавать документы, но нет контакта > 2 дней", severity: "high", dealId: deal.id, name: deal.fullName || deal.title || `Сделка ${deal.id}`, stage: deal.stageName, manager: deal.assignedByName, days: lastDays });
    }
    if (deal.stageKey === "consultation" && (lastDays ?? -1) > 3) {
      risks.push({ type: "Консультация, но нет контакта > 3 дней", severity: "medium", dealId: deal.id, name: deal.fullName || deal.title || `Сделка ${deal.id}`, stage: deal.stageName, manager: deal.assignedByName, days: lastDays });
    }
    if (deal.stageKey === "new_application" && (lastDays ?? -1) > 1) {
      risks.push({ type: "Заявка получена, но нет контакта > 1 дня", severity: "medium", dealId: deal.id, name: deal.fullName || deal.title || `Сделка ${deal.id}`, stage: deal.stageName, manager: deal.assignedByName, days: lastDays });
    }
    if (deal.stageKey === "no_answer_1" || deal.stageKey === "no_answer_2") {
      risks.push({ type: "Недозвон, нужно вернуть", severity: "medium", dealId: deal.id, name: deal.fullName || deal.title || `Сделка ${deal.id}`, stage: deal.stageName, manager: deal.assignedByName, days: lastDays });
    }
  }
  return risks.slice(0, 100);
}

function buildFactVelocity(deals, historyRows) {
  const factStageIds = new Set(deals.filter((deal) => deal.flags.fact).map((deal) => deal.stageId));
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(Date.now() - 7 * 86400000);

  let todayCount = 0;
  let weekCount = 0;
  let mode = "fallback_date_modify";

  if (historyRows.length) {
    mode = "stagehistory";
    for (const row of historyRows) {
      const targetStage = String(row.STAGE_ID || row.TO_STAGE_ID || row.STAGE_SEMANTIC_ID || "");
      const created = parseDate(row.CREATED_TIME || row.DATE_CREATE || row.CREATED);
      if (!created) continue;
      if (!factStageIds.has(targetStage)) continue;
      if (created >= weekStart) weekCount += 1;
      if (created >= todayStart) todayCount += 1;
    }
  } else {
    for (const deal of deals) {
      if (!deal.flags.fact) continue;
      const modified = parseDate(deal.dateModify);
      if (!modified) continue;
      if (modified >= weekStart) weekCount += 1;
      if (modified >= todayStart) todayCount += 1;
    }
  }

  return {
    today: todayCount,
    last7d: weekCount,
    perDay7d: round1(weekCount / 7),
    mode,
  };
}

function readSnapshots() {
  try {
    if (!fs.existsSync(SNAPSHOT_FILE)) return [];
    const raw = fs.readFileSync(SNAPSHOT_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSnapshot(entry) {
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const rows = readSnapshots();
  const day = entry.date;
  const filtered = rows.filter((row) => row.date !== day);
  filtered.push(entry);
  filtered.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(filtered.slice(-90), null, 2), "utf8");
  return filtered.slice(-90);
}

async function buildForecast() {
  const categoryMap = await fetchDealCategories();
  const stageDict = await fetchStageDictionary(categoryMap);
  const categoryIds = resolveIncludedCategoryIds(categoryMap);
  const { rows: historyRows, mode: historyMode } = await fetchStageHistory();
  const exactGroups = buildExactStageGroups(stageDict);
  const submittedSelect = [...new Set([...STANDARD_FIELDS, ...getEnvFields()])];
  const submittedRawDeals = exactGroups.submittedStageIds.length
    ? await fetchDealList(submittedSelect, {
        "=CATEGORY_ID": Number(WARM_CATEGORY_ID),
        "@STAGE_ID": exactGroups.submittedStageIds,
      })
    : [];

  const { deals: rawDeals, method } = await fetchDeals(categoryIds);
  const managerNames = await fetchUsers([
    ...rawDeals.map((deal) => deal.ASSIGNED_BY_ID),
    ...submittedRawDeals.map((deal) => deal.ASSIGNED_BY_ID),
  ]);
  const preparedDeals = prepareDeals(rawDeals, stageDict, managerNames, categoryMap);
  const submittedWarmDeals = prepareDeals(
    submittedRawDeals.map(normalizeDealRecord),
    stageDict,
    managerNames,
    categoryMap,
  ).filter((deal) => String(deal.categoryId) === String(WARM_CATEGORY_ID) && deal.stageKey === "submitted");

  const stageCounts = [];
  for (const group of exactGroups.workingGroups) {
    const count = group.stageIds.length
      ? await fetchDealCount({
          "@CATEGORY_ID": categoryIds.map((id) => Number(id)),
          "@STAGE_ID": group.stageIds,
        })
      : 0;
    stageCounts.push({
      stage: group.label,
      count,
      avgProbability: round2(group.realistic),
      forecastContribution: round1(count * group.realistic),
      forecastShare: 0,
      conservativeContribution: round1(count * group.conservative),
      optimisticContribution: round1(count * group.optimistic),
    });
  }

  const totalForecastRealistic = stageCounts.reduce((sum, row) => sum + row.forecastContribution, 0) || 1;
  const byStage = stageCounts
    .map((row) => ({
      ...row,
      forecastShare: pct(row.forecastContribution, totalForecastRealistic),
    }))
    .sort((a, b) => b.forecastContribution - a.forecastContribution);

  const actual = submittedWarmDeals.length;
  const conservative = round1(stageCounts.reduce((sum, row) => sum + row.conservativeContribution, 0));
  const realistic = round1(stageCounts.reduce((sum, row) => sum + row.forecastContribution, 0));
  const optimistic = round1(stageCounts.reduce((sum, row) => sum + row.optimisticContribution, 0));
  const activeDeals = stageCounts.reduce((sum, row) => sum + row.count, 0);
  const riskDeals = 0;
  const remaining = Math.max(0, TOTAL_PLAN - actual);
  const leftDays = daysLeft();
  const neededPerDay = round1(remaining / leftDays);
  const velocity = buildFactVelocity(submittedWarmDeals, historyRows);
  const risk = summarizeRisk(actual, realistic, optimistic);

  const summary = {
    plan: TOTAL_PLAN,
    actual,
    remaining,
    progress: pct(actual, TOTAL_PLAN),
    actualToday: velocity.today,
    actualLast7d: velocity.last7d,
    actualPerDay7d: velocity.perDay7d,
    neededPerDay,
    daysLeft: leftDays,
    activeDeals,
    totalDeals: activeDeals,
    warmDeals: submittedWarmDeals.length,
    allWarmDeals: activeDeals,
    totalFunnels: categoryIds.length,
    riskDeals,
    risk,
  };

  const snapshotEntry = {
    date: new Date().toISOString().slice(0, 10),
    createdAt: new Date().toISOString(),
    fact: actual,
    conservative,
    realistic,
    optimistic,
    todaySubmissions: velocity.today,
    last7dSubmissions: velocity.last7d,
    stageCounts: byStage.map((row) => ({ stage: row.stage, count: row.count })),
  };
  const snapshots = writeSnapshot(snapshotEntry);

  return {
    ok: true,
    source: "Bitrix24 CRM",
    fetchMethod: method,
    categoryId: WARM_CATEGORY_ID,
    includedCategoryIds: categoryIds,
    categories: [...categoryMap.entries()].map(([id, name]) => ({ id, name })),
    targetDate: TARGET_DATE,
    fetchedAt: new Date().toISOString(),
    summary,
    scenarios: {
      conservative: { label: "Осторожный", value: conservative, progress: pct(conservative, TOTAL_PLAN), remaining: Math.max(0, TOTAL_PLAN - conservative) },
      realistic: { label: "Реалистичный", value: realistic, progress: pct(realistic, TOTAL_PLAN), remaining: Math.max(0, TOTAL_PLAN - realistic) },
      optimistic: { label: "Оптимистичный", value: optimistic, progress: pct(optimistic, TOTAL_PLAN), remaining: Math.max(0, TOTAL_PLAN - optimistic) },
    },
    byStage,
    bySource: [],
    managers: buildSubmittedByManager(submittedWarmDeals),
    risks: [],
    bySpecialty: buildBySpecialty(submittedWarmDeals),
    byProgram: buildSubmittedProgramRows(submittedWarmDeals),
    history: snapshots,
    debug: {
      historyMode,
      factVelocityMode: velocity.mode,
      loadedDeals: preparedDeals.length,
      includedDeals: preparedDeals.filter((deal) => categoryIds.includes(String(deal.categoryId))).length,
      submittedWarmDeals: submittedWarmDeals.length,
      workingDealsAll: activeDeals,
      recognizedDeals: activeDeals,
      dealsWithDateCreate: preparedDeals.filter((deal) => categoryIds.includes(String(deal.categoryId)) && Boolean(deal.dateCreate)).length,
      dealsWithDateModify: preparedDeals.filter((deal) => categoryIds.includes(String(deal.categoryId)) && Boolean(deal.dateModify)).length,
      dealsWithLastCommunication: preparedDeals.filter((deal) => categoryIds.includes(String(deal.categoryId)) && Boolean(deal.lastCommunication)).length,
      createdAcademicPeriodDeals: 0,
      scenarioDeals: activeDeals,
      byCategory: [...new Map(preparedDeals.filter((deal) => categoryIds.includes(String(deal.categoryId))).reduce((acc, deal) => {
        const key = String(deal.categoryId);
        const row = acc.get(key) || { categoryId: key, categoryName: deal.categoryName, count: 0 };
        row.count += 1;
        acc.set(key, row);
        return acc;
      }, new Map())).values()],
      byStageKey: [...new Map(preparedDeals.filter((deal) => categoryIds.includes(String(deal.categoryId))).reduce((acc, deal) => {
        const key = String(deal.stageKey || "unknown");
        acc.set(key, Number(acc.get(key) || 0) + 1);
        return acc;
      }, new Map())).entries()].map(([stageKey, count]) => ({ stageKey, count })),
    },
    fields: {
      programField: PROGRAM_FIELD || null,
      languageField: LANG_FIELD || null,
      cityField: CITY_FIELD || null,
      lastCommunicationField: LAST_COMM_FIELD || "LAST_ACTIVITY_TIME / DATE_MODIFY",
      nextActionField: NEXT_ACTION_FIELD || null,
      method,
      academicPeriodStart: academicPeriod().start.toISOString().slice(0, 10),
      academicPeriodEnd: academicPeriod().end.toISOString().slice(0, 10),
      dealLimit: DEAL_LIMIT,
      dealLimitPerCategory: DEAL_LIMIT_PER_CATEGORY,
      snapshotsFile: SNAPSHOT_FILE,
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
