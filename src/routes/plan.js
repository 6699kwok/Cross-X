"use strict";
/**
 * src/routes/plan.js
 * Plan route handlers — extracted from server.js
 *
 * Execution order (every request):
 *   Rate limit → PII scrub → Input Guard → RAG/casual → Full generation:
 *     OpenAI Agent Loop (Primary) → Pipeline Fallback (Backup)
 *
 * callCozeWorkflow remains active as an enrichment data source (Tier 1 in get_city_enrichment).
 *
 * External dependencies injected via createPlanRouter() factory.
 */

const { openAIRequest } = require("../ai/openai");
const { captureExample } = require("../training/collector");
const { recordSignal: recordProfileSignal } = require("../session/profile");
const { DETAIL_SYSTEM_PROMPT_TEMPLATE, BOUNDARY_MARKER } = require("../planner/prompts");
const { safeParseJson } = require("../planner/mock");
const { localizeFlightRecords } = require("../services/juhe");
const { isComplexItinerary, buildPrePlan, buildPrePlanFromIntent, generateCrossXResponse, buildResourceContext } = require("../planner/pipeline");
const { extractPreferences, mergePreferences, buildContextSummary, pruneHistory } = require("../conversation/context");
const { addTurn, getTurns, buildContextPrefix } = require("../session/conversation");
const { runAgentLoop } = require("../agent/loop");
const { insertAgentTrace, appendMetricEvent, consumeRateLimitWindow } = require("../services/db");
const { detectIntentLLM } = require("../ai/intent");
const { needsDiscovery, runDiscovery } = require("../planner/discovery");
const { restaurantLinks, hotelLinks } = require("../utils/deeplinks");
const { sanitizeOperationalError } = require("../utils/safeError");
// LangGraph removed — single OpenAI agent loop is the only generation path

// ── P1 session + security modules ─────────────────────────────────────────────
const {
  createSession, getSession, getSessionForDevice, patchSession, touchSession,
  scrubPii, DEFAULT_TTL_MS,
} = require("../session/store");

// ── C4: Cross-session preference profile ──────────────────────────────────────
const { loadProfile, saveProfile, generateProfileSummary } = require("../session/profile");

// Preferences persist for 7 days — survives across days without user auth
const PREF_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const { looksLikeUpdate, applyPlanPatch } = require("../session/updater");
const DEFAULT_CITY = "Shanghai";
const DEFAULT_LANG = "ZH";

// ── Device ID validation (module-level for performance — not recreated per request) ──
const DEVICE_ID_RE = /^cx_[a-f0-9]{32}$/;

const RL_WINDOW_MS  = 60_000;
const RL_MAX_HITS   = 20;
const RESTAURANT_NAME_RE = /(店|餐厅|餐館|餐馆|饭店|饭馆|酒家|酒楼|食府|食堂|面馆|面店|面庄|面屋|小馆|小吃|火锅|烧烤|烤鸭|生煎|点心|馒头|包子|咖啡|茶餐厅|料理|寿司|居酒屋|排档|大排档|私房菜|海鲜|牛肉火锅|农家菜|菜馆|馆|restaurant|cafe|coffee|bistro|kitchen|bar|grill|deli|hotpot|duck|seafood|noodles|dumpling|bakery|tea house|eatery)$/iu;
const NON_RESTAURANT_NAME_RE = /(观景台|文化街|广场|公园|绿地|建筑博览群|建筑群|博物馆|纪念馆|旧址|故居|女校|寺|塔|桥|宿舍旧址|滨江|乐园|天地|里弄)$/u;
const CURATED_RESTAURANT_FALLBACKS = {
  shanghai: [
    { name: "Nanxiang Steamed Bun Restaurant · City God Temple", area: "Huangpu District", address: "85 Yuyuan Road, Huangpu District", rating: 4.7, avg_price: 55 },
    { name: "Shen Dacheng Dim Sum", area: "Huangpu District", address: "636 East Nanjing Road, Huangpu District", rating: 4.6, avg_price: 35 },
    { name: "Xiao Yang Sheng Jian · Wujiang Road", area: "Jing'an District", address: "269 Wujiang Road, Jing'an District", rating: 4.6, avg_price: 28 },
    { name: "Lao Zhengxing Restaurant", area: "Huangpu District", address: "556 South Yunnan Road, Huangpu District", rating: 4.6, avg_price: 95 },
    { name: "Guangming Cun Restaurant", area: "Huangpu District", address: "588 Middle Huaihai Road, Huangpu District", rating: 4.5, avg_price: 88 }
  ],
  shenzhen: [
    { name: "Laurel Restaurant", area: "Luohu District", address: "3018 Nanhu Road, Luohu District", rating: 4.6, avg_price: 78 },
    { name: "Xian Ji Shao La", area: "Futian District", address: "1043 Huaqiang South Road, Futian District", rating: 4.5, avg_price: 42 },
    { name: "Chao Tai Niu Rou Dian · Huaqiangbei", area: "Futian District", address: "1025 Huaqiang North Road, Futian District", rating: 4.6, avg_price: 88 },
    { name: "Xin Fa Shao La Tea Restaurant", area: "Luohu District", address: "1085 Chunfeng Road, Luohu District", rating: 4.5, avg_price: 46 },
    { name: "Hai Di Lao Hot Pot · MixC Shenzhen", area: "Luohu District", address: "1881 Bao'an South Road, Luohu District", rating: 4.6, avg_price: 128 }
  ],
  guangzhou: [
    { name: "Tao Tao Ju · Di Shi Fu", area: "Liwan District", address: "20 Di Shi Fu Road, Liwan District", rating: 4.6, avg_price: 96 },
    { name: "Lian Xiang Lou", area: "Liwan District", address: "67 Di Shi Fu Road, Liwan District", rating: 4.5, avg_price: 78 },
    { name: "Guangzhou Restaurant · Wenchang", area: "Liwan District", address: "2 Wenchang South Road, Liwan District", rating: 4.6, avg_price: 118 },
    { name: "Nanxin Milk Desserts Expert", area: "Liwan District", address: "47 Di Shi Fu Road, Liwan District", rating: 4.4, avg_price: 28 },
    { name: "Panxi Restaurant", area: "Liwan District", address: "151 Longjin West Road, Liwan District", rating: 4.5, avg_price: 108 }
  ]
};

function checkPlanRateLimit(key) {
  return consumeRateLimitWindow({
    scope: "plan_request_minute",
    key: `plan_request_minute:${String(key || "").slice(0, 64)}`,
    limit: RL_MAX_HITS,
    windowMs: RL_WINDOW_MS,
  });
}

// ── CT-09: Hourly anti-fraud anomaly detector ─────────────────────────────
// Tracks plan requests per device/IP over a 1-hour rolling window.
// >20/hour: log warning (soft signal). >50/hour: hard-block (bot likely).
const FRAUD_WINDOW_MS  = 3_600_000; // 1 hour
const FRAUD_WARN_HITS  = 20;
const FRAUD_BLOCK_HITS = 50;

function checkAntiFraud(key) {
  const result = consumeRateLimitWindow({
    scope: "plan_request_hourly",
    key: `plan_request_hourly:${String(key || "").slice(0, 64)}`,
    limit: FRAUD_BLOCK_HITS,
    windowMs: FRAUD_WINDOW_MS,
  });
  const count = Number(result.count || 0);
  if (result.allowed === false) return { blocked: true, suspicious: true, count };
  if (count > FRAUD_WARN_HITS)  return { blocked: false, suspicious: true, count };
  return { blocked: false, suspicious: false, count };
}

// ── P2-B: SSE concurrency semaphore — cap parallel plan streams ───────────────
// Prevents OpenAI cost explosion and resource exhaustion under load spikes.
// Max 20 concurrent plan-generation streams; excess requests return 503.
const SSE_MAX_CONCURRENT = Number(process.env.SSE_MAX_CONCURRENT || 20);
let _sseActiveStreams = 0;

function _sseAcquire() {
  if (_sseActiveStreams >= SSE_MAX_CONCURRENT) return false;
  _sseActiveStreams++;
  return true;
}
function _sseRelease() {
  if (_sseActiveStreams > 0) _sseActiveStreams--;
}

// BOUNDARY_MARKER imported from src/planner/prompts.js — single source of truth.
// isBoundaryRejection() uses it to detect LLM refusals without hardcoding the string here.

/**
 * Returns true if the LLM response is a business boundary refusal.
 * Checked BEFORE emitting status events to short-circuit the pipeline.
 */
function isBoundaryRejection(structured) {
  if (!structured) return false;
  // Check spoken_text first (fast path); fall back to full JSON string
  const text = structured.spoken_text || JSON.stringify(structured);
  return text.includes(BOUNDARY_MARKER);
}

// ── Input-layer injection guard (O(1), 0 token cost) ─────────────────────────
// Detects prompt injection and off-topic code-generation requests BEFORE any LLM
// call, session lookup, or RAG query. Short-circuits ALL downstream processing.
const INJECTION_PATTERNS = [
  // Prompt override attempts (Chinese)
  /忽略.{0,10}(前面|上面|之前|系统).{0,10}指令/,
  /扮演.{0,10}(另一个|其他|不同).{0,10}(AI|助手|角色)/,
  // Code/script generation — widened wildcard {0,6}→{0,20}, added 编写/生成/爬虫
  /帮(我|你)(写|编写|生成).{0,20}(代码|脚本|程序|爬虫)/,
  // Standalone scraper/bot creation without 帮我 prefix (CN + EN triggers)
  /(?:写个?|创建|生成|开发|write|create|build|make|generate).{0,20}(?:爬虫|spider|crawler|scraper)/i,
  // Web scraping verbs
  /爬取.{0,10}(网站|数据|携程|美团|信息)/,
  // English jailbreak keywords
  /DAN|jailbreak|prompt.{0,5}inject/i,
  // SEC: English prompt-override patterns not covered by above
  /ignore\s+(all\s+)?(previous|prior|above|system)\s+(instructions?|prompts?|context)/i,
  /reveal\s+(your\s+)?(system\s+prompt|instructions?|prompt|context)/i,
  // "you are now a [non-travel identity]" — travel queries never use this phrasing
  /you\s+are\s+now\s+(a\s+)?(DAN|GPT|unrestricted|evil|hacker|villain|different\s+AI)/i,
  // "act as" with clearly non-travel roles
  /act\s+as\s+(if\s+you\s+are\s+)?(a\s+)?(DAN|GPT|hacker|unrestricted\s+AI|jailbroken)/i,
  /forget\s+(everything|all|your\s+instructions?|your\s+training)/i,
  // "new instructions:" followed by non-travel override
  /new\s+(system\s+)?instructions?:\s*(?:ignore|pretend|forget|you\s+are)/i,
];
function isInjectionAttack(text) {
  if (!text) return false;
  return INJECTION_PATTERNS.some((re) => re.test(text));
}

// ── P8.6: Intent axis detector ───────────────────────────────────────────────
// Determines the primary intent of the user message to enable specialty mode.
// Returns: "food" | "activity" | "stay" | "travel" (default full itinerary)
function detectIntentAxis(message) {
  const raw = String(message || "");
  const hasFood = /餐厅|美食|好吃|推荐.*吃|吃什么|特色菜|小吃|eat|restaurant|food|dining|meal|brunch|supper|snack|taste|cuisine/i.test(raw);
  const hasActivity = /景点|游览|门票|博物馆|景区|打卡|scenic|attraction|museum|sightseeing|tour|landmark/i.test(raw);
  const hasStay = /酒店|住宿|宾馆|民宿|hotel|hostel|stay|accommodation/i.test(raw);
  const hasTransport = /机票|航班|飞机|高铁|火车|机场|地铁|打车|交通|接送|flight|airport|plane|rail|train|taxi|metro|transfer|pickup|drop-?off/i.test(raw);
  const hasDuration = /(?:\d+\s*(?:天|日|晚|days?|nights?))|(?:一|二|三|四|五|六|七|八|九|十|两)\s*(?:天|日|晚)/i.test(raw);
  const hasBudget = /(?:预算|人均|总价|花费)|(?:\d{2,6}\s*(?:元|块|rmb|cny|usd|\$|¥|eur|gbp))/i.test(raw);
  if (hasTransport) return "travel";
  if (hasStay && (hasFood || hasActivity)) return "travel";
  if (hasFood && hasActivity) return "travel";
  if (hasStay) return "stay";
  if (hasFood) return "food";
  if (hasActivity) return "activity";
  if (hasDuration || hasBudget) return "travel";
  return "travel";
}

// ── P8.8: Requirement completeness gate ──────────────────────────────────────
// Explicit city/destination detection regex (covers mainland China + common international)
const CITY_MENTION_RE = /北京|上海|深圳|广州|成都|重庆|杭州|苏州|西安|南京|三亚|丽江|大理|桂林|张家界|黄山|青岛|厦门|拉萨|哈尔滨|新疆|乌鲁木齐|武汉|长沙|贵阳|昆明|天津|福州|宁波|济南|郑州|大连|沈阳|长春|合肥|南昌|石家庄|呼和浩特|银川|兰州|西宁|香港|澳门|台北|东京|大阪|首尔|曼谷|巴黎|伦敦|纽约|新加坡|吐鲁番|敦煌|西双版纳|beijing|shanghai|shenzhen|guangzhou|chengdu|chongqing|hangzhou|suzhou|xi'an|xian|nanjing|sanya|lijiang|dali|guilin|zhangjiajie|huangshan|qingdao|xiamen|wuhan/i;

// Conversational gate — always ask questions first, then generate.
// Returns array of missing slot names; empty = ok to proceed.
// intentResult: optional LLM-extracted intent object from detectIntentLLM()
function checkRequirements(message, constraints, intentAxis, intentResult = null) {
  // food / activity: no gate — recommend based on city + implied 1 day
  if (intentAxis === "food" || intentAxis === "activity") return [];

  // P8.12: Step 0 — Destination first.
  // If the message has no explicit city AND it's not a local/nearby query
  // (e.g. "附近餐厅" where GPS city is intentional), ask for destination first.
  const isLocalQuery = /附近|周边|本地|就在这|本城|这里/.test(message);
  const hasCityInMessage = !!(intentResult?.destination)   // LLM extracted destination
    || CITY_MENTION_RE.test(message)
    || !!(constraints.destination);
  if (!hasCityInMessage && !isLocalQuery) {
    return ["destination"];
  }

  // Duration: prefer LLM-extracted value, then constraints, then regex
  const hasDuration = !!(intentResult?.duration_days)
    || !!(constraints.duration || constraints.days)
    || /\d+\s*天|\d+\s*(?:days?|nights?)/i.test(message)
    || /[一两二三四五六七八九十]+\s*天/.test(message)   // 三天、两天
    || /两天一夜|三天两夜|四天三夜|五天四夜/.test(message)
    || /一周|两周|半个月/.test(message)
    || /周末|长周末|小长假|黄金周/.test(message);

  // Budget: no gate — pipeline estimates pax*days*800 as fallback.

  // For stay/travel requests, missing duration no longer hard-blocks first draft generation.
  // If destination is known, downstream planners can safely fall back to a default short trip.
  return [];
}

function buildPromptPreferenceSummary(prefs, intentAxis, message) {
  const merged = prefs && typeof prefs === "object" ? { ...prefs } : {};
  const raw = String(message || "");
  const hasTravelCore = /机票|航班|飞机|高铁|火车|机场|地铁|打车|交通|接送|flight|airport|plane|rail|train|taxi|metro|transfer|pickup|drop-?off|酒店|住宿|hotel|stay|accommodation/i.test(raw)
    || /(?:\d+\s*(?:天|日|晚|days?|nights?))|(?:一|二|三|四|五|六|七|八|九|十|两)\s*(?:天|日|晚)/i.test(raw)
    || /(?:预算|人均|总价|花费)|(?:\d{2,6}\s*(?:元|块|rmb|cny|usd|\$|¥|eur|gbp))/i.test(raw);
  if (intentAxis === "travel" && hasTravelCore && merged.food_focus) {
    delete merged.food_focus;
  }
  return buildContextSummary(merged);
}

function shouldInjectProfileSummary(intentAxis, message, profileSummary) {
  if (!profileSummary) return false;
  const raw = String(message || "");
  const hasTravelCore = /机票|航班|飞机|高铁|火车|机场|地铁|打车|交通|接送|flight|airport|plane|rail|train|taxi|metro|transfer|pickup|drop-?off|酒店|住宿|hotel|stay|accommodation/i.test(raw)
    || /(?:\d+\s*(?:天|日|晚|days?|nights?))|(?:一|二|三|四|五|六|七|八|九|十|两)\s*(?:天|日|晚)/i.test(raw)
    || /(?:预算|人均|总价|花费)|(?:\d{2,6}\s*(?:元|块|rmb|cny|usd|\$|¥|eur|gbp))/i.test(raw);
  if (intentAxis === "travel" && hasTravelCore) return false;
  return true;
}

function normalizeHotelNameKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/（[^）]*）/g, " ")
    .replace(/\b(hotel|resort|inn|hostel|suites|by ihg|by hilton)\b/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function buildGenericTravelTitle({ destination, durationDays, language, pickLang }) {
  const dest = String(destination || "").trim() || pickLang(language, "目的地", "your destination", "目的地", "목적지");
  const days = Number(durationDays || 0);
  if (days > 0) {
    return pickLang(
      language,
      `${dest}${days}天行程方案`,
      `${days}-day ${dest} trip plan`,
      `${dest} ${days}日間の旅行プラン`,
      `${dest} ${days}일 여행 플랜`
    );
  }
  return pickLang(
    language,
    `${dest}行程方案`,
    `${dest} trip plan`,
    `${dest} の旅行プラン`,
    `${dest} 여행 플랜`
  );
}

function getCanonicalPlanDays(planSummary, constraints) {
  const summary = planSummary && typeof planSummary === "object" ? planSummary : {};
  const daysFromArray = Array.isArray(summary.days) ? summary.days.length : 0;
  if (daysFromArray > 0) return daysFromArray;
  const duration = Number(summary.duration_days || constraints?.duration || constraints?.days || 0);
  return duration > 0 ? duration : 3;
}

function sortHotelsByPrice(hotels) {
  const sorted = [...(Array.isArray(hotels) ? hotels : [])].filter(Boolean).sort((a, b) => {
    const aPrice = Number(a?.price_per_night || a?.price || 0) || 0;
    const bPrice = Number(b?.price_per_night || b?.price || 0) || 0;
    if (aPrice !== bPrice) return aPrice - bPrice;
    return (Number(b?.rating || 0) || 0) - (Number(a?.rating || 0) || 0);
  });
  const seen = new Set();
  return sorted.filter((hotel) => {
    const key = normalizeHotelNameKey(hotel?.name || hotel?.hotelName || hotel?.nameEn || "");
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hasMeaningfulHotelTierSpread(hotels) {
  const list = sortHotelsByPrice(hotels);
  if (list.length < 3) return false;
  const uniqueNames = new Set(list.map((item) => normalizeHotelNameKey(item?.name || item?.hotelName || item?.nameEn || "")).filter(Boolean));
  const uniquePrices = new Set(list.map((item) => Number(item?.price_per_night || item?.price || 0) || 0).filter((value) => value > 0));
  return uniqueNames.size >= 3 && uniquePrices.size >= 2;
}

function pickHotelForTier(hotels, tier) {
  const list = sortHotelsByPrice(hotels);
  if (!list.length) return null;
  const normalizedTier = String(tier || "").toLowerCase() || "balanced";
  if (normalizedTier === "budget") return list[0] || null;
  if (normalizedTier === "premium") return list[list.length - 1] || null;
  return list[Math.floor(list.length / 2)] || list[0] || null;
}

function findBestHotelMatch(plan, hotels, options = {}) {
  const list = sortHotelsByPrice(hotels);
  if (!list.length) return null;

  const tier = getPlanTierKey(plan);
  const hotelName = String(plan?.hotel?.name || plan?.hotel_name || "").trim();
  const key = normalizeHotelNameKey(hotelName);
  const findByName = () => {
    if (!key) return null;
    return list.find((item) => {
      const itemKey = normalizeHotelNameKey(item.name || item.hotelName || item.nameEn || "");
      return itemKey && (itemKey.includes(key) || key.includes(itemKey));
    }) || null;
  };

  if (!options.preferTier) {
    const exact = findByName();
    if (exact) return exact;
  }

  const tierPick = pickHotelForTier(list, tier);
  if (options.preferTier && tierPick) return tierPick;

  const exact = findByName();
  if (exact) return exact;

  const nightlyHint = Number(plan?.hotel?.price_per_night || plan?.hotel_price_per_night || 0) || 0;
  if (nightlyHint > 0) {
    const byPrice = [...list].sort((a, b) => Math.abs((Number(a?.price_per_night || a?.price || 0) || 0) - nightlyHint) - Math.abs((Number(b?.price_per_night || b?.price || 0) || 0) - nightlyHint));
    if (byPrice[0]) return byPrice[0];
  }

  return tierPick || list[0] || null;
}

function getRestaurantFallbackCatalog(destination) {
  const key = String(destination || "").trim().toLowerCase();
  if (/(^|\b)(shanghai|上海)(\b|$)/i.test(key)) return CURATED_RESTAURANT_FALLBACKS.shanghai.map((item) => ({ ...item }));
  if (/(^|\b)(shenzhen|深圳)(\b|$)/i.test(key)) return CURATED_RESTAURANT_FALLBACKS.shenzhen.map((item) => ({ ...item }));
  if (/(^|\b)(guangzhou|广州)(\b|$)/i.test(key)) return CURATED_RESTAURANT_FALLBACKS.guangzhou.map((item) => ({ ...item }));
  return [];
}

function isRestaurantLikeItem(item) {
  const name = String(item?.name || "").trim();
  if (!name) return false;
  if (NON_RESTAURANT_NAME_RE.test(name)) return false;
  return RESTAURANT_NAME_RE.test(name);
}

function normalizeFoodItems(foodEnrichment, destination) {
  const list = Array.isArray(foodEnrichment?.item_list) ? foodEnrichment.item_list : [];
  const normalized = list
    .map((item) => ({
      name: String(item?.name || "").trim(),
      address: String(item?.address || "").trim(),
      area: String(item?.area || "").trim(),
      rating: Number(item?.rating || 0) || 0,
      avg_price: Number(item?.avg_price || 0) || 0,
      queue_min: Number(item?.queue_min || 0) || 0,
      review: String(item?.guest_review || item?.review || "").trim(),
      cuisine_type: String(item?.cuisine_type || item?.cuisine || "").trim(),
      flavor: String(item?.flavor || "").trim(),
      origin: String(item?.origin || item?.area || destination || "").trim(),
      dishes: Array.isArray(item?.dishes) ? item.dishes.filter(Boolean).slice(0, 3) : [item?.must_order].filter(Boolean),
      real_photo_url: String(item?.real_photo_url || "").trim(),
      amap_id: String(item?.amap_id || "").trim(),
    }))
    .filter((item) => item.name)
    .filter((item) => isRestaurantLikeItem(item));
  return normalized.length >= 3 ? normalized : getRestaurantFallbackCatalog(destination);
}

function getPlanTierKey(plan) {
  const raw = String(plan?.id || plan?.tag || "").toLowerCase();
  if (/premium|lux|high|vip|a\b|极致|豪华|高端|premium/i.test(raw)) return "premium";
  if (/budget|cheap|save|economy|c\b|省|精打细算|economy/i.test(raw)) return "budget";
  return "balanced";
}

function pickDiningCandidatesForTier(plan, restaurants) {
  const list = Array.isArray(restaurants) ? restaurants.filter(Boolean) : [];
  if (!list.length) return [];
  const sorted = [...list].sort((a, b) => {
    const aPrice = Number(a.avg_price || 0) || 0;
    const bPrice = Number(b.avg_price || 0) || 0;
    if (aPrice !== bPrice) return aPrice - bPrice;
    return (Number(b.rating || 0) || 0) - (Number(a.rating || 0) || 0);
  });
  const tier = getPlanTierKey(plan);
  let pool;
  if (tier === "premium") pool = sorted.slice(-6).reverse();
  else if (tier === "budget") pool = sorted.slice(0, 6);
  else {
    const start = Math.max(0, Math.floor(sorted.length / 2) - 3);
    pool = sorted.slice(start, start + 6);
  }
  const unique = [];
  const seen = new Set();
  for (const item of pool.concat(sorted)) {
    const key = `${item.name}|${item.address}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
    if (unique.length >= 3) break;
  }
  return unique;
}

function buildRestaurantLine(item, language, pickLang) {
  if (!item?.name) return "";
  const bits = [normalizeLocalizedCommonText(item.name, language) || item.name];
  if (item.avg_price > 0) {
    bits.push(pickLang(
      language,
      `人均¥${item.avg_price}`,
      `~¥${item.avg_price}/person`,
      `約¥${item.avg_price}/人`,
      `1인 약 ¥${item.avg_price}`
    ));
  }
  if (item.rating > 0) bits.push(`★ ${item.rating.toFixed(1)}`);
  if (item.area) bits.push(normalizeLocalizedCommonText(item.area, language));
  return bits.join(" · ");
}

function buildMealDailyPlan(durationDays, diningChoices, language, pickLang) {
  const picks = Array.isArray(diningChoices) ? diningChoices.filter(Boolean) : [];
  if (!picks.length) return [];
  const breakfastText = pickLang(
    language,
    "酒店早餐 / 附近咖啡店",
    "Hotel breakfast / nearby cafe",
    "ホテル朝食 / 近くのカフェ",
    "호텔 조식 / 근처 카페"
  );
  return Array.from({ length: Math.max(1, durationDays) }).map((_, idx) => {
    const lunch = picks[idx % picks.length];
    const dinner = picks[(idx + 1) % picks.length];
    return {
      day: idx + 1,
      breakfast: breakfastText,
      lunch: buildRestaurantLine(lunch, language, pickLang) || "-",
      dinner: buildRestaurantLine(dinner, language, pickLang) || "-",
    };
  });
}

function buildFoodOnlyFallbackPlans({ diningCatalog, destination, language, pickLang, pax, totalBudget, durationDays }) {
  const seeds = Array.isArray(diningCatalog) ? diningCatalog.filter(Boolean).slice(0, 3) : [];
  if (!seeds.length) return [];
  const safePax = Math.max(1, Number(pax || 0) || 1);
  const safeDays = Math.max(1, Number(durationDays || 0) || 1);
  const fallbackMealBudget = Number(totalBudget || 0) > 0
    ? Math.max(28, Math.round(Number(totalBudget) / Math.max(safePax * safeDays * 3, 1)))
    : 0;
  const tags = [
    pickLang(language, "轻松吃一顿", "Quick Bite", "気軽に一軒", "가볍게 한 끼"),
    pickLang(language, "排队也值得", "Worth the Queue", "並ぶ価値あり", "기다릴 가치 있음"),
    pickLang(language, "今晚主角", "Signature Dinner", "今夜の主役", "오늘의 메인"),
  ];
  return seeds.map((item, idx) => {
    const avgPrice = Number(item?.avg_price || 0) || fallbackMealBudget || 48;
    const queueMin = Number(item?.queue_min || 0) || 0;
    const address = String(item?.address || item?.area || destination || "").trim();
    return {
      id: ["budget", "balanced", "premium"][idx] || `food_${idx + 1}`,
      tag: tags[idx] || tags[tags.length - 1],
      is_recommended: idx === Math.min(1, seeds.length - 1),
      name: item.name,
      headline: item.cuisine_type
        ? pickLang(language, `${item.cuisine_type}里更稳的一家`, `A reliable ${item.cuisine_type} pick`, `${item.cuisine_type}ならまずここ`, `${item.cuisine_type} 기준으로 안정적인 선택`)
        : pickLang(language, "适合直接加入今日路线", "Easy to slot into today", "今日の導線に入れやすい", "오늘 동선에 넣기 쉬움"),
      rating: Number(item?.rating || 0) || null,
      avg_price: avgPrice,
      queue_min: queueMin,
      address,
      review: String(item?.review || "").trim() || pickLang(language, "这家店适合直接纳入首版方案", "Easy to plug into the first draft", "初版にそのまま入れやすい一軒", "첫 안에 바로 넣기 좋은 곳"),
      dishes: Array.isArray(item?.dishes) ? item.dishes.filter(Boolean).slice(0, 3) : [],
      cuisine_type: String(item?.cuisine_type || "").trim() || pickLang(language, "本地风味", "Local cuisine", "ローカル料理", "로컬 요리"),
      flavor: String(item?.flavor || "").trim() || pickLang(language, "鲜香为主", "Savory and vivid", "旨みしっかり", "감칠맛 중심"),
      origin: String(item?.origin || destination || "").trim() || destination,
      real_photo_url: String(item?.real_photo_url || "").trim(),
      total_price: avgPrice * safePax,
      highlights: [
        item.name,
        queueMin > 0
          ? pickLang(language, `等位约${queueMin}分钟`, `Queue about ${queueMin} min`, `待ち約${queueMin}分`, `대기 약 ${queueMin}분`)
          : pickLang(language, "当前排队压力较低", "Low queue pressure right now", "待ち時間は短め", "현재 대기 부담이 적음"),
        address,
      ].filter(Boolean),
      budget_breakdown: { accommodation: 0, transport: 0, meals: avgPrice * safePax, activities: 0, misc: 0 },
    };
  });
}

function getAttractionFallbackCatalog(destination) {
  const key = String(destination || "").trim().toLowerCase();
  if (/(^|\b)(shanghai|上海)(\b|$)/i.test(key)) {
    return [
      { name: "The Bund", area: "Huangpu District", address: "Zhongshan East 1st Road", open_hours: "Open all day", ticket_price: 0, real_photo_url: "" },
      { name: "Yu Garden", area: "Huangpu District", address: "279 Yuyuan Old Street", open_hours: "09:00-16:30", ticket_price: 40, real_photo_url: "" },
      { name: "Shanghai Museum", area: "Huangpu District", address: "201 Renmin Avenue", open_hours: "09:00-17:00", ticket_price: 0, real_photo_url: "" },
      { name: "Lujiazui Riverside Walk", area: "Pudong", address: "Lujiazui Riverside", open_hours: "Open all day", ticket_price: 0, real_photo_url: "" },
    ];
  }
  if (/(^|\b)(beijing|北京)(\b|$)/i.test(key)) {
    return [
      { name: "Forbidden City", area: "Dongcheng District", address: "4 Jingshan Front Street", open_hours: "08:30-17:00", ticket_price: 60, real_photo_url: "" },
      { name: "Temple of Heaven", area: "Dongcheng District", address: "1 Tiantan East Road", open_hours: "06:00-22:00", ticket_price: 34, real_photo_url: "" },
      { name: "Jingshan Park", area: "Xicheng District", address: "44 Jingshan West Street", open_hours: "06:00-21:00", ticket_price: 2, real_photo_url: "" },
      { name: "798 Art District", area: "Chaoyang District", address: "2 Jiuxianqiao Road", open_hours: "Open all day", ticket_price: 0, real_photo_url: "" },
    ];
  }
  if (/(^|\b)(shenzhen|深圳)(\b|$)/i.test(key)) {
    return [
      { name: "Shenzhen Bay Park", area: "Nanshan District", address: "Binhai Avenue", open_hours: "Open all day", ticket_price: 0, real_photo_url: "" },
      { name: "Splendid China Folk Village", area: "Nanshan District", address: "9003 Shennan Avenue", open_hours: "10:00-22:00", ticket_price: 220, real_photo_url: "" },
      { name: "OCT Harbour", area: "Nanshan District", address: "8 East Baishi Road", open_hours: "Open all day", ticket_price: 0, real_photo_url: "" },
      { name: "Dafen Oil Painting Village", area: "Longgang District", address: "Dafen Community", open_hours: "Open all day", ticket_price: 0, real_photo_url: "" },
    ];
  }
  return [];
}

function normalizeAttractionItems(activityEnrichment, destination) {
  const list = Array.isArray(activityEnrichment?.item_list) ? activityEnrichment.item_list : [];
  const normalized = list
    .map((item) => ({
      name: String(item?.name || "").trim(),
      area: String(item?.area || item?.district || "").trim(),
      address: String(item?.address || "").trim(),
      open_hours: String(item?.open_hours || "").trim(),
      ticket_price: item?.ticket_price == null ? null : Number(item.ticket_price),
      real_photo_url: String(item?.real_photo_url || item?.photo_url || item?.image_url || "").trim(),
    }))
    .filter((item) => item.name);
  return normalized.length >= 3 ? normalized : getAttractionFallbackCatalog(destination);
}

function hasDistinctPlanHotels(plans) {
  const keys = new Set((Array.isArray(plans) ? plans : [])
    .map((plan) => normalizeHotelNameKey(plan?.hotel?.name || plan?.hotel_name || ""))
    .filter(Boolean));
  return keys.size >= Math.min(3, Array.isArray(plans) ? plans.length : 0);
}

function allPlanHotelsMatchDestination(plans, destination) {
  if (!destination) return true;
  return (Array.isArray(plans) ? plans : []).every((plan) => hotelMatchesDestination({
    name: plan?.hotel?.name || plan?.hotel_name || "",
    nameEn: plan?.hotel?.nameEn || "",
    address: plan?.hotel?.address || "",
    district: plan?.hotel?.district || plan?.hotel_area || "",
  }, destination));
}

function needsTravelDayUpgrade(days) {
  const list = Array.isArray(days) ? days : [];
  if (!list.length) return false;
  return list.every((day) => {
    const activities = Array.isArray(day?.activities) ? day.activities.filter(Boolean) : [];
    if (!activities.length || activities.length > 4) return false;
    return activities.every((act) => {
      const type = String(act?.type || "").toLowerCase();
      const name = String(act?.name || "").toLowerCase();
      const note = String(act?.note || act?.desc || "").toLowerCase();
      return ["transport", "checkin", "rest"].includes(type)
        || /arrival transfer|free time|check in|抵达与转移|自由活动|入住/.test(name)
        || /light first evening|keep day one flexible|settle in before heading out|先保留轻松节奏|第一天预留弹性|放下行李后再展开/.test(note);
    });
  });
}

function buildTravelSkeletonDays({ durationDays, language, pickLang, hotelName, hotelImage, destination, attractions, diningChoices, pax }) {
  const safeDays = Math.max(1, Number(durationDays || 0) || 3);
  const attractionList = Array.isArray(attractions) ? attractions.filter(Boolean) : [];
  const diningList = Array.isArray(diningChoices) ? diningChoices.filter(Boolean) : [];
  const safePax = Math.max(1, Number(pax || 0) || 1);
  if (!attractionList.length && !diningList.length) return [];

  const localizeName = (value) => normalizeLocalizedCommonText(value, language) || value;
  const buildAttractionActivity = (slot, item) => {
    if (!item?.name) return null;
    const attractionName = localizeName(item.name);
    const areaText = localizeName(item.area || destination) || destination;
    const openHours = String(item.open_hours || "").trim();
    const ticketText = item.ticket_price > 0
      ? pickLang(language, `门票约¥${item.ticket_price}`, `Tickets about ¥${item.ticket_price}`, `入場料は約¥${item.ticket_price}`, `입장권 약 ¥${item.ticket_price}`)
      : pickLang(language, "免门票", "Free entry", "入場無料", "무료 입장");
    return {
      time: slot,
      type: "activity",
      name: attractionName,
      note: pickLang(
        language,
        `游览${attractionName}，位于${areaText}，${ticketText}${openHours ? `，开放时间 ${openHours}` : ""}`,
        `Visit ${attractionName} in ${areaText}. ${ticketText}${openHours ? `. Open ${openHours}` : ""}`,
        `${areaText}の${attractionName}を見学。${ticketText}${openHours ? `。営業時間 ${openHours}` : ""}`,
        `${areaText}의 ${attractionName} 방문. ${ticketText}${openHours ? `. 운영시간 ${openHours}` : ""}`
      ),
      cost: item.ticket_price > 0 ? Number(item.ticket_price) * safePax : 0,
      image_url: item.real_photo_url || "",
      real_vibes: pickLang(language, "城市代表景观", "A strong local highlight", "その街らしさを感じる定番", "도시의 대표 포인트"),
      insider_tips: openHours
        ? pickLang(language, `建议错峰前往，开放时间 ${openHours}`, `Go outside peak hours. Open ${openHours}`, `混雑を避けて訪問。営業時間 ${openHours}`, `혼잡 시간을 피해서 방문. 운영시간 ${openHours}`)
        : pickLang(language, "建议避开高峰时段", "Best outside peak hours", "混雑時間を避けるのがおすすめ", "피크 시간을 피하는 편이 좋음"),
    };
  };
  const buildDiningActivity = (slot, item) => {
    if (!item?.name) return null;
    const restaurantName = localizeName(item.name);
    const areaText = localizeName(item.area || destination) || destination;
    return {
      time: slot,
      type: "food",
      name: restaurantName,
      note: pickLang(language, `在${restaurantName}用餐，位于${areaText}，人均约¥${Number(item.avg_price || 0) || 0}`, `Meal stop at ${restaurantName} in ${areaText}, about ¥${Number(item.avg_price || 0) || 0}/person`, `${areaText}の${restaurantName}で食事。予算は1人約¥${Number(item.avg_price || 0) || 0}`, `${areaText}의 ${restaurantName} 식사. 1인 약 ¥${Number(item.avg_price || 0) || 0}`),
      cost: (Number(item.avg_price || 0) || 0) * safePax,
      image_url: item.real_photo_url || "",
      real_vibes: pickLang(language, "本地人气餐厅", "A popular local dining stop", "地元で人気の食事処", "현지 인기 식당"),
      insider_tips: pickLang(language, "建议提前订位或错峰到店", "Book ahead or arrive outside peak hours", "事前予約か時間をずらして訪問", "미리 예약하거나 피크 시간을 피해서 방문"),
    };
  };

  return Array.from({ length: safeDays }).map((_, idx) => {
    const dayNum = idx + 1;
    const morningAttr = attractionList.length ? attractionList[(idx * 2) % attractionList.length] : null;
    const afternoonAttr = attractionList.length ? attractionList[(idx * 2 + 1) % attractionList.length] : morningAttr;
    const dinnerChoice = diningList.length ? diningList[idx % diningList.length] : null;
    const activities = [];
    if (dayNum === 1) {
      activities.push({
        time: pickLang(language, "上午", "Morning", "午前", "오전"),
        type: "transport",
        name: pickLang(language, "抵达与转移", "Arrival transfer", "到着と移動", "도착 및 이동"),
        note: pickLang(language, `抵达${destination}后前往酒店，先完成入住`, `Arrive in ${destination} and transfer to the hotel for check-in`, `${destination}到着後、ホテルへ移動してチェックイン`, `${destination} 도착 후 호텔로 이동해 체크인`),
        cost: 0,
        image_url: "",
        real_vibes: pickLang(language, "先把节奏放稳", "Ease into the trip", "まずはゆったり開始", "먼저 페이스 맞추기"),
        insider_tips: pickLang(language, "落地后先轻装出发", "Travel light after arrival", "到着後は荷物を最小限に", "도착 후에는 짐을 가볍게"),
      });
      activities.push({
        time: pickLang(language, "下午", "Afternoon", "午後", "오후"),
        type: "checkin",
        name: hotelName || destination,
        note: pickLang(language, "入住 " + (hotelName || destination), "Check in at " + (hotelName || destination), (hotelName || destination) + " にチェックイン", (hotelName || destination) + " 체크인"),
        cost: 0,
        image_url: hotelImage || "",
        real_vibes: "",
        insider_tips: pickLang(language, "放下行李后再展开", "Settle in before heading out", "荷物を置いてから移動", "짐을 두고 이동 시작"),
      });
      const warmup = buildAttractionActivity(pickLang(language, "傍晚", "Late afternoon", "夕方", "늦은 오후"), afternoonAttr || morningAttr);
      const dinnerStop = buildDiningActivity(pickLang(language, "晚上", "Evening", "夜", "저녁"), dinnerChoice);
      if (warmup) activities.push(warmup);
      if (dinnerStop) activities.push(dinnerStop);
    } else {
      const morningActivity = buildAttractionActivity(pickLang(language, "上午", "Morning", "午前", "오전"), morningAttr);
      const afternoonActivity = buildAttractionActivity(pickLang(language, "下午", "Afternoon", "午後", "오후"), afternoonAttr);
      const dinnerActivity = buildDiningActivity(pickLang(language, "晚上", "Evening", "夜", "저녁"), dinnerChoice);
      if (morningActivity) activities.push(morningActivity);
      if (afternoonActivity) activities.push(afternoonActivity);
      if (dinnerActivity) activities.push(dinnerActivity);
    }
    return {
      day: dayNum,
      label: pickLang(language, "第" + dayNum + "天", "Day " + dayNum, "Day " + dayNum, dayNum + "일차"),
      activities,
      meals: [],
    };
  });
}

function sanitizeStayFocusDays({ days, language, pickLang, hotelName, hotelImage }) {
  const list = Array.isArray(days) ? days : [];
  return list.map((day, idx) => {
    const filteredActivities = (Array.isArray(day?.activities) ? day.activities : [])
      .filter((act) => ["transport", "checkin", "rest"].includes(String(act?.type || "").toLowerCase()))
      .map((act) => {
        if (String(act?.type || "").toLowerCase() !== "checkin") return act;
        return {
          ...act,
          name: hotelName || String(act?.name || "").trim(),
          note: pickLang(
            language,
            "入住 " + (hotelName || String(act?.name || "").trim()),
            "Check in at " + (hotelName || String(act?.name || "").trim()),
            (hotelName || String(act?.name || "").trim()) + " にチェックイン",
            (hotelName || String(act?.name || "").trim()) + " 체크인"
          ),
          image_url: hotelImage || act?.image_url || "",
        };
      });

    const activities = filteredActivities.length ? filteredActivities : [
      {
        time: pickLang(language, "上午", "Morning", "午前", "오전"),
        type: "transport",
        name: pickLang(language, "抵达与转移", "Arrival transfer", "到着と移動", "도착 및 이동"),
        note: pickLang(language, "先完成到店与安顿", "Settle into the stay first", "まずは到着後の移動と滞在を整える", "먼저 숙소 이동과 정착부터 마무리"),
        cost: 0,
        image_url: "",
        real_vibes: pickLang(language, "先把住宿安排稳定", "Lock the stay in first", "まず滞在を安定させる", "우선 숙소를 안정적으로 잡기"),
        insider_tips: pickLang(language, "把核心时间留给比价与选房", "Use the first pass to compare rooms and location", "最初は立地と客室比較に時間を使う", "첫 단계는 위치와 객실 비교에 집중"),
      },
      {
        time: pickLang(language, "下午", "Afternoon", "午後", "오후"),
        type: "checkin",
        name: hotelName || "",
        note: pickLang(language, "入住 " + (hotelName || ""), "Check in at " + (hotelName || ""), (hotelName || "") + " にチェックイン", (hotelName || "") + " 체크인"),
        cost: 0,
        image_url: hotelImage || "",
        real_vibes: "",
        insider_tips: pickLang(language, "锁定房型后再继续扩展行程", "Lock the room first, then expand the trip", "部屋を確定してから旅程を広げる", "객실을 먼저 확정한 뒤 일정을 확장"),
      },
      {
        time: pickLang(language, "晚上", "Evening", "夜", "저녁"),
        type: "rest",
        name: pickLang(language, "先熟悉周边", "Settle into the area", "周辺に慣れる", "주변 동선 익히기"),
        note: pickLang(language, "先确认位置、交通和休息质量，再决定要不要展开更多内容", "Confirm location, access, and rest quality before expanding the trip", "立地・アクセス・休息環境を確認してから旅程を広げる", "위치, 이동, 휴식 품질을 확인한 뒤 일정 확장 여부를 결정"),
        cost: 0,
        image_url: "",
        real_vibes: "",
        insider_tips: "",
      },
    ].filter((act) => String(act?.name || act?.type || "").trim());

    return {
      ...day,
      day: Number(day?.day || idx + 1) || idx + 1,
      label: String(day?.label || pickLang(language, `第${idx + 1}天`, `Day ${idx + 1}`, `Day ${idx + 1}`, `${idx + 1}일차`)),
      activities,
      meals: [],
    };
  });
}

function appendUniqueLines(base, extras) {
  const merged = [...(Array.isArray(base) ? base : []), ...(Array.isArray(extras) ? extras : [])]
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  return merged.filter((item, idx) => merged.indexOf(item) === idx);
}

const CITY_ALIAS_MAP = {
  shanghai: ["上海", "shanghai"],
  beijing: ["北京", "beijing"],
  shenzhen: ["深圳", "shenzhen"],
  guangzhou: ["广州", "guangzhou"],
  chengdu: ["成都", "chengdu"],
  hangzhou: ["杭州", "hangzhou"],
  chongqing: ["重庆", "chongqing"],
  xiamen: ["厦门", "xiamen"],
  qingdao: ["青岛", "qingdao"],
  nanjing: ["南京", "nanjing"],
  wuhan: ["武汉", "wuhan"],
  sanya: ["三亚", "sanya"],
  xian: ["西安", "xian", "xi'an"],
  suzhou: ["苏州", "suzhou"],
  tianjin: ["天津", "tianjin"],
  changsha: ["长沙", "changsha"],
  kunming: ["昆明", "kunming"],
  harbin: ["哈尔滨", "harbin"],
  guilin: ["桂林", "guilin"],
  lijiang: ["丽江", "lijiang"],
  yangzhou: ["扬州", "yangzhou"],
  yinchuan: ["银川", "yinchuan"],
};

function getCityAliases(city) {
  const raw = String(city || "").trim();
  if (!raw) return [];
  const lower = raw.toLowerCase().replace(/\s+city$/i, "");
  const direct = CITY_ALIAS_MAP[lower];
  if (direct) return direct;
  const trimmedZh = raw.replace(/市$/, "");
  return [raw, trimmedZh, lower].filter(Boolean);
}

function hotelMatchesDestination(hotel, destination) {
  if (!hotel || !destination) return true;
  const fields = [hotel.name, hotel.hotel_name, hotel.nameEn, hotel.address, hotel.district, hotel.area, hotel.city, JSON.stringify(hotel.platform_links || {})].map((item) => String(item || "").trim());
  const haystack = fields.join(" ").toLowerCase();
  if (!haystack) return true;
  const destAliases = getCityAliases(destination).map((item) => item.toLowerCase()).filter(Boolean);
  const primaryField = String(hotel?.name || hotel?.hotel_name || hotel?.nameEn || "").trim().toLowerCase();
  if (destAliases.some((alias) => alias && primaryField.includes(alias))) return true;
  for (const aliases of Object.values(CITY_ALIAS_MAP)) {
    const normalized = aliases.map((item) => item.toLowerCase()).filter(Boolean);
    const nameBelongsToOtherCity = normalized.some((alias) => alias && primaryField.includes(alias));
    if (nameBelongsToOtherCity && !normalized.some((alias) => destAliases.includes(alias))) return false;
  }
  if (destAliases.some((alias) => alias && haystack.includes(alias))) return true;
  for (const aliases of Object.values(CITY_ALIAS_MAP)) {
    const normalized = aliases.map((item) => item.toLowerCase()).filter(Boolean);
    const belongsToOtherCity = normalized.some((alias) => alias && haystack.includes(alias));
    if (belongsToOtherCity && !normalized.some((alias) => destAliases.includes(alias))) return false;
  }
  return true;
}

function createPlanTagByTier(tier, language, pickLang) {
  if (tier === "premium") return pickLang(language, "极致体验", "Premium", "プレミアム", "프리미엄");
  if (tier === "budget") return pickLang(language, "性价比之选", "Affordable Choice", "コスパ重視", "실속형");
  return pickLang(language, "最佳平衡", "Balanced Choice", "バランス重視", "균형형");
}

function ensureThreePlans(cardData, hotelCatalog, language, durationDays, totalBudget, pickLang, destination) {
  const currentPlans = Array.isArray(cardData?.plans) ? cardData.plans.filter(Boolean) : [];
  if (currentPlans.length >= 3 && hasDistinctPlanHotels(currentPlans) && allPlanHotelsMatchDestination(currentPlans, destination)) return cardData;
  const sortedHotels = sortHotelsByPrice(hotelCatalog);
  if (!currentPlans.length || sortedHotels.length < 2) return cardData;

  const midIndex = Math.max(0, Math.floor(sortedHotels.length / 2));
  const seedHotels = {
    budget: pickHotelForTier(sortedHotels, "budget") || sortedHotels[0] || sortedHotels[midIndex] || null,
    balanced: pickHotelForTier(sortedHotels, "balanced") || sortedHotels[midIndex] || sortedHotels[Math.min(sortedHotels.length - 1, midIndex + 1)] || sortedHotels[0] || null,
    premium: pickHotelForTier(sortedHotels, "premium") || sortedHotels[sortedHotels.length - 1] || sortedHotels[midIndex] || null,
  };
  if (sortedHotels.length >= 3) {
    if (normalizeHotelNameKey(seedHotels.budget?.name) === normalizeHotelNameKey(seedHotels.balanced?.name)) {
      seedHotels.balanced = sortedHotels[Math.min(sortedHotels.length - 1, midIndex + 1)] || seedHotels.balanced;
    }
    if (normalizeHotelNameKey(seedHotels.premium?.name) === normalizeHotelNameKey(seedHotels.balanced?.name)) {
      seedHotels.premium = sortedHotels[Math.max(0, sortedHotels.length - 2)] || seedHotels.premium;
    }
    if (normalizeHotelNameKey(seedHotels.premium?.name) === normalizeHotelNameKey(seedHotels.budget?.name)) {
      seedHotels.premium = sortedHotels[Math.max(0, sortedHotels.length - 1)] || seedHotels.premium;
    }
  }

  const basePlan = currentPlans[0];
  const baseBreakdown = basePlan.budget_breakdown || {};
  const fallbackTotal = Number(basePlan.total_price || basePlan.total_cost || totalBudget || 0) || 0;
  const fallbackTransport = Number(baseBreakdown.transport || Math.round(fallbackTotal * 0.12)) || 0;
  const fallbackMeals = Number(baseBreakdown.meals || Math.round(fallbackTotal * 0.18)) || 0;
  const fallbackMisc = Number(baseBreakdown.misc || Math.round(fallbackTotal * 0.05)) || 0;

  const variants = ["budget", "balanced", "premium"].map((tier) => {
    const existing = currentPlans.find((plan) => getPlanTierKey(plan) === tier);
    const seed = seedHotels[tier];
    const plan = existing || JSON.parse(JSON.stringify(basePlan));
    if (!seed) return plan;
    const hotelTotal = (Number(seed.price_per_night || 0) || 0) * Math.max(1, durationDays);
    const tierMeals = tier === "premium" ? Math.round(fallbackMeals * 1.25) : tier === "budget" ? Math.round(fallbackMeals * 0.82) : fallbackMeals;
    const tierTransport = tier === "premium" ? Math.round(fallbackTransport * 1.15) : tier === "budget" ? Math.round(fallbackTransport * 0.9) : fallbackTransport;
    const tierMisc = tier === "premium" ? Math.round(fallbackMisc * 1.1) : tier === "budget" ? Math.round(fallbackMisc * 0.9) : fallbackMisc;
    const totalCost = hotelTotal + tierMeals + tierTransport + tierMisc;
    return {
      ...plan,
      id: tier,
      tag: createPlanTagByTier(tier, language, pickLang),
      total_price: totalCost,
      total_cost: totalCost,
      budget_breakdown: {
        ...(plan.budget_breakdown || {}),
        accommodation: hotelTotal,
        hotel: hotelTotal,
        meals: tierMeals,
        transport: tierTransport,
        misc: tierMisc,
      },
      hotel_name: seed.name || plan.hotel_name || "",
      hotel_area: seed.district || plan.hotel_area || "",
      hotel: {
        ...(plan.hotel || {}),
        name: seed.name || plan.hotel?.name || "",
        nameEn: seed.nameEn || plan.hotel?.nameEn || "",
        price_per_night: Number(seed.price_per_night || plan.hotel?.price_per_night || 0) || plan.hotel?.price_per_night || null,
        hero_image: seed.hero_image || plan.hotel?.hero_image || "",
      },
    };
  });

  return { ...cardData, plans: variants };
}

async function enrichStructuredCardData({
  cardData,
  language,
  city,
  constraints,
  queryHotelCatalog,
  queryAmapHotels,
  mockCtripHotels,
  buildAIEnrichment,
  cachedFoodEnrichment,
  cachedHotelCatalog,
  pickLang,
}) {
  if (!cardData || !Array.isArray(cardData.plans) || !cardData.plans.length) return cardData;

  const cloned = JSON.parse(JSON.stringify(cardData));
  const destination = String(cloned.destination || constraints?.destination || city || "").split("·")[0].trim() || city || "Shanghai";
  const durationDays = Number(cloned.duration_days || constraints?.duration || 3) || 3;
  const totalBudget = Number(String(constraints?.budget || "").replace(/[^0-9.]/g, "")) || 0;
  const budgetPerNight = totalBudget > 0 ? Math.round((totalBudget / Math.max(1, durationDays)) * 0.55) : null;

  let hotelCatalog = Array.isArray(cachedHotelCatalog) ? cachedHotelCatalog.map((hotel) => ({ ...hotel })) : null;
  if (!Array.isArray(hotelCatalog) || !hotelCatalog.length) {
    try {
      hotelCatalog = queryHotelCatalog
        ? await queryHotelCatalog(destination, budgetPerNight)
        : (queryAmapHotels ? await queryAmapHotels(destination, budgetPerNight) : null);
    } catch (_err) { /* ignore and fallback */ }
  }
  if (!Array.isArray(hotelCatalog) || !hotelCatalog.length) {
    hotelCatalog = mockCtripHotels ? mockCtripHotels(destination, budgetPerNight) : [];
  }
  if (Array.isArray(hotelCatalog) && hotelCatalog.length) {
    const cityMatchedHotels = hotelCatalog.filter((hotel) => hotelMatchesDestination(hotel, destination));
    hotelCatalog = cityMatchedHotels.length ? cityMatchedHotels : [];
  }
  const fallbackHotelCatalog = mockCtripHotels ? mockCtripHotels(destination, budgetPerNight) : [];
  if (Array.isArray(fallbackHotelCatalog) && fallbackHotelCatalog.length && (!hasMeaningfulHotelTierSpread(hotelCatalog) || hotelCatalog.length < 3)) {
    const cityMatchedFallback = fallbackHotelCatalog.filter((hotel) => hotelMatchesDestination(hotel, destination));
    const fallbackPool = cityMatchedFallback.length ? cityMatchedFallback : fallbackHotelCatalog;
    hotelCatalog = sortHotelsByPrice([...(Array.isArray(hotelCatalog) ? hotelCatalog : []), ...fallbackPool]);
  }
  if (!Array.isArray(hotelCatalog) || !hotelCatalog.length) hotelCatalog = [];
  cloned.plans = ensureThreePlans(cloned, hotelCatalog, language, durationDays, totalBudget, pickLang, destination).plans || cloned.plans;

  const layoutType = String(cloned.layout_type || "travel_full");

  const sourceSet = new Set();
  let foodEnrichment = cachedFoodEnrichment || null;
  if (!foodEnrichment) {
    try {
      foodEnrichment = buildAIEnrichment ? await buildAIEnrichment(destination, "food") : null;
    } catch (_err) { /* ignore */ }
  }
  const diningCatalog = normalizeFoodItems(foodEnrichment, destination);
  if (foodEnrichment?._source) sourceSet.add(String(foodEnrichment._source));

  let activityEnrichment = null;
  let attractionCatalog = [];

  if (layoutType === "food_only") {
    const rebuiltPlans = buildFoodOnlyFallbackPlans({
      diningCatalog,
      destination,
      language,
      pickLang,
      pax: cloned.pax,
      totalBudget,
      durationDays,
    });
    const shouldRebuildFoodPlans = !cloned.plans.some((plan) => isRestaurantLikeItem({ name: plan?.name || plan?.restaurant_name || "" }));
    const sourcePlans = shouldRebuildFoodPlans && rebuiltPlans.length ? rebuiltPlans : cloned.plans;

    cloned.plans = sourcePlans.map((plan, idx) => {
      const seed = rebuiltPlans[idx % rebuiltPlans.length] || null;
      const fallbackName = seed?.name || "";
      const fallbackAddress = seed?.address || seed?.area || destination;
      const fallbackImage = seed?.real_photo_url || "";
      const fallbackAvgPrice = Number(seed?.avg_price || 0) || 0;
      const fallbackQueueMin = Number(seed?.queue_min || 0) || 0;
      const restaurantName = normalizeLocalizedCommonText(plan?.name || plan?.restaurant_name || "", language) || plan?.name || plan?.restaurant_name || fallbackName;
      const restaurantAddress = normalizeLocalizedCommonText(plan?.address || "", language) || plan?.address || fallbackAddress;
      const queueMin = Number(plan?.queue_min || 0) || fallbackQueueMin;
      const avgPrice = Number(plan?.avg_price || 0) || fallbackAvgPrice || Math.max(28, Math.round((totalBudget || 0) / Math.max(1, durationDays || 1) / Math.max(1, cloned.pax || 1)));
      const reviewText = String(plan?.review || seed?.review || restaurantAddress || "").trim();
      const paymentItems = [
        restaurantName ? {
          name: restaurantName,
          amount: Number((plan.budget_breakdown && plan.budget_breakdown.meals) || 0) || avgPrice * Math.max(1, cloned.pax || 1),
          deeplink_scheme: "meituan",
          search_keyword: `${destination} ${restaurantName}`,
        } : null,
      ].filter(Boolean).filter((item, itemIdx, arr) =>
        arr.findIndex((other) => `${other.deeplink_scheme}|${other.search_keyword}` === `${item.deeplink_scheme}|${item.search_keyword}`) === itemIdx
      );
      const highlighted = appendUniqueLines(
        [restaurantName],
        Array.isArray(plan.highlights) ? plan.highlights : []
      ).slice(0, 4);
      return {
        ...(seed || {}),
        ...plan,
        id: String(plan.id || seed?.id || `food_${idx + 1}`),
        name: restaurantName,
        address: restaurantAddress,
        avg_price: avgPrice,
        queue_min: queueMin,
        review: reviewText,
        real_photo_url: String(plan?.real_photo_url || seed?.real_photo_url || "").trim() || fallbackImage,
        budget_breakdown: {
          accommodation: 0,
          transport: 0,
          meals: Number((plan?.budget_breakdown && plan.budget_breakdown.meals) || 0) || avgPrice * Math.max(1, cloned.pax || 1),
          activities: 0,
          misc: 0,
        },
        payment_items: paymentItems,
        restaurant_source: String(foodEnrichment?._source || plan.restaurant_source || "food_catalog") || null,
        restaurant_platform_links: restaurantName ? restaurantLinks(restaurantName, destination) : (plan.restaurant_platform_links || null),
        highlights: highlighted,
        hotel: null,
        hotel_name: "",
        hotel_area: "",
      };
    });

    cloned.days = Array.isArray(cloned.days) ? cloned.days.map((day, dayIdx) => {
      const focusPlan = cloned.plans[dayIdx % cloned.plans.length] || cloned.plans[0] || null;
      const restaurantName = String(focusPlan?.name || "").trim();
      const restaurantAddress = String(focusPlan?.address || "").trim();
      const restaurantImage = String(focusPlan?.real_photo_url || "").trim();
      const queueMin = Number(focusPlan?.queue_min || 0) || 0;
      const reviewText = String(focusPlan?.review || restaurantAddress || "").trim();
      return {
        ...day,
        day: Number(day?.day || dayIdx + 1) || dayIdx + 1,
        label: String(day?.label || pickLang(language, `第${dayIdx + 1}天`, `Day ${dayIdx + 1}`, `Day ${dayIdx + 1}`, `${dayIdx + 1}일차`)),
        activities: [{
          time: pickLang(language, "傍晚", "Late afternoon", "夕方", "늦은 오후"),
          type: "walk",
          name: pickLang(language, `${destination}觅食热区`, `${destination} food stroll`, `${destination} 食べ歩き`, `${destination} 미식 산책`),
          note: restaurantAddress || pickLang(language, "按商圈就近安排", "Keep the meal route local", "近いエリアで組む", "가까운 권역 기준으로 이동"),
          cost: 0,
          image_url: restaurantImage,
          real_vibes: pickLang(language, "先闻到烟火气再坐下吃", "Walk in before settling in", "街の空気を感じてから着席", "골목 분위기를 먼저 느끼고 입장"),
          insider_tips: queueMin > 0
            ? pickLang(language, `建议避开高峰，预留${queueMin}分钟等位`, `Avoid peak time and leave ${queueMin} min for the queue`, `ピークを避けて${queueMin}分ほど待ち時間を見込む`, `피크 시간을 피하고 ${queueMin}분 정도 대기를 잡기`)
            : pickLang(language, "可直接作为当天主餐安排", "Easy to make this the main meal", "そのまま主食に据えやすい", "그날 메인 식사로 바로 넣기 좋음"),
        }],
        meals: restaurantName ? [{
          time: pickLang(language, "晚餐", "Dinner", "夕食", "저녁"),
          type: "meal",
          name: restaurantName,
          restaurant: restaurantName,
          note: reviewText,
          cost: Number(focusPlan?.avg_price || 0) * Math.max(1, cloned.pax || 1),
          image_url: restaurantImage,
        }] : (Array.isArray(day.meals) ? day.meals : []),
      };
    }) : [];

    return cloned;
  }

  cloned.plans = cloned.plans.map((plan) => {
    const isStayFocus = layoutType === "stay_focus";
    const matchedHotel = findBestHotelMatch(plan, hotelCatalog, { preferTier: true });
    const reviewCountText = String(matchedHotel?.review_count || "").trim();
    const reviewCountNumeric = Number(matchedHotel?.review_count_numeric || 0) || null;
    const guestReview = String(matchedHotel?.guest_review || plan.hotel?.guest_review || (Array.isArray(plan.hotel_ctrip_reviews) ? plan.hotel_ctrip_reviews[0] : "") || "").trim();
    const tags = Array.isArray(matchedHotel?.tags) ? matchedHotel.tags.filter(Boolean).slice(0, 3) : [];
    const localizedGuestReview = normalizeLocalizedCommonText(guestReview, language) || guestReview;
    const localizedHotelTags = tags
      .map((tag) => normalizeLocalizedCommonText(tag, language) || tag)
      .filter(Boolean);
    const hotelSource = String(matchedHotel?.source || "").trim();
    if (hotelSource) sourceSet.add(hotelSource);

    const diningChoices = isStayFocus ? [] : pickDiningCandidatesForTier(plan, diningCatalog);
    const anchorRestaurant = diningChoices[0] || null;
    const restaurantSource = !isStayFocus && diningChoices.length ? String(foodEnrichment?._source || "food_catalog") : "";
    if (restaurantSource) sourceSet.add(restaurantSource);
    const diningSummary = !isStayFocus && diningChoices.length
      ? pickLang(
        language,
        `真实餐厅候选：${diningChoices.map((item) => buildRestaurantLine(item, language, pickLang)).join("；")}`,
        `Live dining picks: ${diningChoices.map((item) => buildRestaurantLine(item, language, pickLang)).join("; ")}`,
        `実在する飲食候補: ${diningChoices.map((item) => buildRestaurantLine(item, language, pickLang)).join("；")}`,
        `실제 식당 후보: ${diningChoices.map((item) => buildRestaurantLine(item, language, pickLang)).join("; ")}`
      )
      : "";
    const mealDailyPlan = isStayFocus ? [] : buildMealDailyPlan(durationDays, diningChoices, language, pickLang);
    const restaurantTags = isStayFocus ? [] : diningChoices.map((item) => buildRestaurantLine(item, language, pickLang)).filter(Boolean);
    const restaurantReviewLine = !isStayFocus && anchorRestaurant
      ? pickLang(
        language,
        `餐厅定位：${anchorRestaurant.address || anchorRestaurant.area || destination}`,
        `Restaurant area: ${normalizeLocalizedCommonText(anchorRestaurant.area || destination, language) || normalizeLocalizedCommonText(destination, language)}`,
        `レストラン位置: ${normalizeLocalizedCommonText(anchorRestaurant.area || destination, language) || normalizeLocalizedCommonText(destination, language)}`,
        `식당 위치: ${normalizeLocalizedCommonText(anchorRestaurant.area || destination, language) || normalizeLocalizedCommonText(destination, language)}`
      )
      : "";
    const hotelName = matchedHotel?.name || plan.hotel?.name || plan.hotel_name || destination;
    const localizedHotelName = normalizeLocalizedCommonText(hotelName, language) || hotelName;
    const localizedHotelDistrict = normalizeLocalizedCommonText(matchedHotel?.district || plan.hotel?.district || plan.hotel_area || "", language) || matchedHotel?.district || plan.hotel?.district || plan.hotel_area || "";
    const localizedHotelAddress = normalizeLocalizedCommonText(matchedHotel?.address || plan.hotel?.address || "", language) || matchedHotel?.address || plan.hotel?.address || "";
    const localizedAnchorRestaurantName = normalizeLocalizedCommonText(anchorRestaurant?.name || "", language) || anchorRestaurant?.name || "";
    const normalizedPlanHighlights = (Array.isArray(plan.highlights) ? plan.highlights : [])
      .map((item) => {
        const text = String(item || "").trim();
        return normalizeLocalizedCommonText(text, language) || text;
      })
      .filter(Boolean);
    const preservedPaymentItems = (Array.isArray(plan.payment_items) ? plan.payment_items : [])
      .filter((item) => {
        if (!isStayFocus) return true;
        const scheme = String(item?.deeplink_scheme || "").trim().toLowerCase();
        return !["meituan", "dianping", "xiaohongshu"].includes(scheme);
      })
      .map((item) => ({
        ...item,
        name: normalizeLocalizedCommonText(String(item?.name || ""), language) || String(item?.name || ""),
        search_keyword: normalizeLocalizedCommonText(String(item?.search_keyword || ""), language) || String(item?.search_keyword || ""),
      }));
    const paymentItems = [
      ...preservedPaymentItems,
      matchedHotel?.price_per_night ? {
        name: localizedHotelName,
        amount: Number((plan.budget_breakdown && plan.budget_breakdown.hotel) || 0) || Number(matchedHotel.price_per_night || 0) * Math.max(1, durationDays),
        deeplink_scheme: "ctrip",
        search_keyword: localizedHotelName || hotelName,
      } : null,
      !isStayFocus && anchorRestaurant ? {
        name: localizedAnchorRestaurantName || anchorRestaurant.name,
        amount: Number((plan.budget_breakdown && plan.budget_breakdown.meals) || 0) || anchorRestaurant.avg_price * Math.max(1, cloned.pax || 1),
        deeplink_scheme: "meituan",
        search_keyword: `${destination} ${anchorRestaurant.name}`,
      } : null,
      {
        name: pickLang(language, "滴滴前往 " + localizedHotelName, "DiDi to " + localizedHotelName, localizedHotelName + "までDiDi", localizedHotelName + "까지 DiDi"),
        amount: Number((plan.budget_breakdown && plan.budget_breakdown.transport) || 0) || 0,
        deeplink_scheme: "didi",
        search_keyword: localizedHotelName || hotelName,
      },
    ].filter(Boolean).filter((item, idx, arr) =>
      arr.findIndex((other) => `${other.deeplink_scheme}|${other.search_keyword}` === `${item.deeplink_scheme}|${item.search_keyword}`) === idx
    );

    return {
      ...plan,
      dining_plan: isStayFocus ? "" : (diningSummary || plan.dining_plan || ""),
      meal_daily_plan: isStayFocus ? [] : (mealDailyPlan.length ? mealDailyPlan : (Array.isArray(plan.meal_daily_plan) ? plan.meal_daily_plan : [])),
      payment_items: paymentItems,
      restaurant_source: isStayFocus ? null : (restaurantSource || plan.restaurant_source || null),
      restaurant_platform_links: isStayFocus ? null : (anchorRestaurant ? restaurantLinks(anchorRestaurant.name, destination) : (plan.restaurant_platform_links || null)),
      hotel_name: localizedHotelName,
      hotel_source: hotelSource || plan.hotel_source || null,
      hotel_rating: Number(matchedHotel?.rating || plan.hotel_rating || 0) || plan.hotel_rating || null,
      hotel_review_count: reviewCountText || plan.hotel_review_count || "",
      hotel_ctrip_review_count: reviewCountNumeric || plan.hotel_ctrip_review_count || null,
      hotel_ctrip_score: Number(matchedHotel?.rating || plan.hotel_ctrip_score || 0) || plan.hotel_ctrip_score || null,
      hotel_ctrip_reviews: localizedGuestReview ? [localizedGuestReview, ...localizedHotelTags].filter(Boolean).slice(0, 2) : (Array.isArray(plan.hotel_ctrip_reviews) ? plan.hotel_ctrip_reviews : []),
      hotel_ctrip_tags: localizedHotelTags.length ? localizedHotelTags : (Array.isArray(plan.hotel_ctrip_tags) ? plan.hotel_ctrip_tags : []),
      hotel_area: localizedHotelDistrict || plan.hotel_area || "",
      hotel_ctrip_url: matchedHotel?.booking_url || matchedHotel?.ctripBookingUrl || plan.hotel_ctrip_url || null,
      hotel_native_price: matchedHotel?.nativePrice || plan.hotel_native_price || null,
      hotel_native_currency: matchedHotel?.nativeCurrency || plan.hotel_native_currency || null,
      comments: appendUniqueLines((Array.isArray(plan.comments) ? plan.comments : []).map((line) => normalizeLocalizedCommonText(String(line || ""), language) || String(line || "")), [
        localizedHotelAddress ? pickLang(language, `酒店位置：${localizedHotelAddress}`, `Hotel location: ${localizedHotelAddress}`, `ホテル所在地: ${localizedHotelAddress}`, `호텔 위치: ${localizedHotelAddress}`) : "",
        isStayFocus ? "" : restaurantReviewLine,
      ]).slice(0, 4),
      hotel: {
        ...(plan.hotel || {}),
        name: localizedHotelName,
        nameEn: matchedHotel?.nameEn || plan.hotel?.nameEn || "",
        price_per_night: Number(matchedHotel?.price_per_night || plan.hotel?.price_per_night || 0) || plan.hotel?.price_per_night || null,
        hero_image: matchedHotel?.hero_image || plan.hotel?.hero_image || "",
        rating: Number(matchedHotel?.rating || plan.hotel?.rating || 0) || plan.hotel?.rating || null,
        review_count: reviewCountText || plan.hotel?.review_count || "",
        guest_review: localizedGuestReview || plan.hotel?.guest_review || "",
        tags: localizedHotelTags.length ? localizedHotelTags : (Array.isArray(plan.hotel?.tags) ? plan.hotel.tags : []),
        district: localizedHotelDistrict || plan.hotel?.district || "",
        address: localizedHotelAddress || plan.hotel?.address || "",
        platform_links: (localizedHotelName || hotelName) ? hotelLinks(localizedHotelName || hotelName, destination) : (plan.hotel?.platform_links || null),
      },
      highlights: isStayFocus
        ? appendUniqueLines(
          [localizedHotelName],
          appendUniqueLines(
            normalizedPlanHighlights.filter((item) => item && !/[★]/.test(item) && !/¥|person|restaurant|dining|meal/i.test(item)),
            localizedHotelTags
          )
        ).slice(0, 4)
        : appendUniqueLines([localizedHotelName], appendUniqueLines(normalizedPlanHighlights.filter((item) => {
          const text = String(item || "").trim();
          return text && text !== hotelName && text !== localizedHotelName && !text.toLowerCase().includes("hotel") && !text.includes("酒店");
        }), restaurantTags)).slice(0, 4),
    };
  });

  const title = String(cloned.title || "").trim();
  if (layoutType === "travel_full" && /food|dining|eat|cuisine|美食|餐|吃/i.test(title)) {
    cloned.title = buildGenericTravelTitle({ destination, durationDays, language, pickLang });
  }

  if (Array.isArray(cloned.days) && Array.isArray(cloned.plans) && cloned.plans.length) {
    const recommendedPlan = cloned.plans.find((plan) => plan.is_recommended) || cloned.plans[1] || cloned.plans[0];
    const primaryHotelName = normalizeLocalizedCommonText(recommendedPlan?.hotel?.name || recommendedPlan?.hotel_name || "", language) || recommendedPlan?.hotel?.name || recommendedPlan?.hotel_name || "";
    const primaryHotelImage = recommendedPlan?.hotel?.hero_image || "";
    if (layoutType === "stay_focus") {
      cloned.days = sanitizeStayFocusDays({
        days: cloned.days,
        language,
        pickLang,
        hotelName: primaryHotelName,
        hotelImage: primaryHotelImage,
      });
    } else if (primaryHotelName) {
      cloned.days = cloned.days.map((day) => ({
        ...day,
        activities: Array.isArray(day.activities) ? day.activities.map((act) => {
          if (!act || act.type !== "checkin") return act;
          return {
            ...act,
            name: primaryHotelName,
            note: pickLang(language, "入住 " + primaryHotelName, "Check in at " + primaryHotelName, primaryHotelName + " にチェックイン", primaryHotelName + " 체크인"),
            image_url: primaryHotelImage || act.image_url || "",
          };
        }) : day.activities,
      }));
    }
    if (needsTravelDayUpgrade(cloned.days) && layoutType === "travel_full") {
      if (!attractionCatalog.length) {
        try {
          activityEnrichment = buildAIEnrichment ? await buildAIEnrichment(destination, "activity") : null;
        } catch (_err) { /* ignore */ }
        attractionCatalog = normalizeAttractionItems(activityEnrichment, destination);
        if (activityEnrichment?._source) sourceSet.add(String(activityEnrichment._source));
      }
      cloned.days = buildTravelSkeletonDays({
        durationDays,
        language,
        pickLang,
        hotelName: primaryHotelName,
        hotelImage: primaryHotelImage,
        destination,
        attractions: attractionCatalog,
        diningChoices: pickDiningCandidatesForTier(recommendedPlan, diningCatalog),
        pax: cloned.pax || constraints?.pax || 2,
      });
    }
  }

  if (!cloned._dataQuality || cloned._dataQuality === "mock" || cloned._dataQuality === "synthetic") {
    if (sourceSet.has("trip_live") || sourceSet.has("ctrip_live")) cloned._dataQuality = "live";
    else if (sourceSet.has("ctrip_list_live")) cloned._dataQuality = "ctrip_live_gated";
    else if (sourceSet.size) cloned._dataQuality = "ctrip_curated";
  }

  return cloned;
}
const FOLLOW_UP_SUGGESTIONS = {
  ZH: {
    travel:   ["想调整预算", "多一天行程", "深挖一下美食"],
    food:     ["换个口味风格", "再加一个餐厅", "附近还有什么好吃的"],
    stay:     ["换便宜一点的", "换个区域", "看看民宿"],
    activity: ["加一个景点", "换轻松一点的", "有没有门票优惠"],
  },
  EN: {
    travel:   ["Adjust budget", "Add a day", "More food options"],
    food:     ["Different cuisine", "Add a restaurant", "More nearby options"],
    stay:     ["Cheaper options", "Different area", "Try a guesthouse"],
    activity: ["Add an attraction", "More relaxed pace", "Any ticket discounts?"],
  },
  JA: {
    travel:   ["予算を調整", "1日追加", "食事をもっと探す"],
    food:     ["別の料理スタイル", "レストラン追加", "近くの他のお店"],
    stay:     ["もっと安い宿", "別のエリア", "ゲストハウスを見る"],
    activity: ["観光地を追加", "ゆっくりしたコース", "チケット割引は?"],
  },
  KO: {
    travel:   ["예산 조정", "하루 추가", "맛집 더 찾기"],
    food:     ["다른 음식 스타일", "식당 추가", "근처 다른 곳"],
    stay:     ["더 저렴한 숙소", "다른 지역", "게스트하우스 보기"],
    activity: ["관광지 추가", "여유로운 코스", "입장권 할인 있나요?"],
  },
};

const DETAIL_ENRICH_TIMEOUT_MS = 9000;

function cleanTransportCityCandidate(value) {
  return String(value || "")
    .trim()
    .replace(/[()]/g, " ")
    .replace(/\b(?:city|airport|international|intl|terminal|station|railway|train|gps)\b/ig, " ")
    .replace(/[\u5e02\u7701\u81ea\u6cbb\u533a\u7279\u522b\u884c\u653f\u533a]+$/u, "")
    .replace(/^(?:current[_\s-]?location|ip[_\s-]?fallback)$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractOriginCityForDetail(message, constraints, currentCity, destination) {
  const candidateKeys = ["originCity", "origin_city", "origin", "departure", "departureCity", "fromCity", "from"];
  for (const key of candidateKeys) {
    const raw = cleanTransportCityCandidate(constraints?.[key]);
    if (raw && raw !== destination) return raw;
  }

  const text = String(message || "");
  const patterns = [
    /(?:从|由)\s*([A-Za-z\u4e00-\u9fa5' -]{2,40}?)(?=\s*(?:到|去|飞往|前往|抵达|然后|并|，|,|。|\.|$))/i,
    /([A-Za-z\u4e00-\u9fa5' -]{2,40}?)(?:出发|起飞)(?=\s*(?:到|去|飞往|前往|，|,|。|\.|$))/i,
    /(?:from|depart(?:ing)? from|starting in)\s+([A-Za-z' -]{2,40}?)(?=\s+(?:to|for|into|on)\b|[,.;]|$)/i,
  ];
  for (const re of patterns) {
    const match = text.match(re);
    const raw = cleanTransportCityCandidate(match?.[1]);
    if (raw && raw !== destination) return raw;
  }

  const fallback = cleanTransportCityCandidate(currentCity);
  if (fallback && fallback !== destination) return fallback;
  return "";
}

function extractDepartureDateForDetail(message, constraints) {
  const directKeys = ["departDate", "departureDate", "startDate", "start_date", "arrival_date", "date"];
  for (const key of directKeys) {
    const raw = String(constraints?.[key] || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    if (raw) {
      const parsed = new Date(raw);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
    }
  }

  const text = String(message || "");
  const full = text.match(/(\d{4})[./-年](\d{1,2})[./-月](\d{1,2})/);
  if (full) {
    const y = Number(full[1]);
    const m = Number(full[2]);
    const d = Number(full[3]);
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  const md = text.match(/(\d{1,2})月(\d{1,2})(?:日|号)?/);
  if (!md) return "";
  const now = new Date();
  let year = now.getFullYear();
  const month = Number(md[1]);
  const day = Number(md[2]);
  let candidate = new Date(year, month - 1, day);
  if (candidate.getTime() < now.getTime() - 24 * 60 * 60 * 1000) {
    year += 1;
    candidate = new Date(year, month - 1, day);
  }
  return `${candidate.getFullYear()}-${String(candidate.getMonth() + 1).padStart(2, "0")}-${String(candidate.getDate()).padStart(2, "0")}`;
}

function parseDurationMinutes(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const hm = text.match(/(\d+)\s*(?:小时|h|hr|hrs)\s*(\d+)\s*(?:分|m|min|mins)?/i);
  if (hm) return parseInt(hm[1], 10) * 60 + parseInt(hm[2], 10);
  const colon = text.match(/^(\d{1,2}):(\d{2})$/);
  if (colon) return parseInt(colon[1], 10) * 60 + parseInt(colon[2], 10);
  const h = text.match(/(\d+)\s*(?:小时|h|hr|hrs)/i);
  if (h) return parseInt(h[1], 10) * 60;
  const m = text.match(/(\d+)\s*(?:分|m|min|mins)/i);
  if (m) return parseInt(m[1], 10);
  return null;
}

function rankFlightOption(flight) {
  const duration = Number(flight?.durationMinutes || 0) || parseDurationMinutes(flight?.duration) || 0;
  const price = Number(flight?.price || 0) || 999999;
  const stops = Number(flight?.stops || 0);
  return price + (stops * 320) + Math.max(0, duration - 180) * 1.2;
}

function pickBestFlightCandidate(flights) {
  const list = Array.isArray(flights) ? flights.filter(Boolean) : [];
  if (!list.length) return null;
  return [...list].sort((a, b) => {
    const scoreDiff = rankFlightOption(a) - rankFlightOption(b);
    if (scoreDiff !== 0) return scoreDiff;
    return (Number(a?.price || 0) || 0) - (Number(b?.price || 0) || 0);
  })[0] || null;
}

function formatMinutesLabel(minutes) {
  const total = Number(minutes || 0);
  if (!Number.isFinite(total) || total <= 0) return "";
  if (total >= 60) return `${Math.floor(total / 60)}h${total % 60 ? `${total % 60}m` : ""}`;
  return `${total}m`;
}

function getFlightSourceLabel(language, pickLang, flightSource) {
  if (flightSource === "juhe_live") return "Juhe";
  if (flightSource === "ctrip_live") {
    return pickLang(language, "携程", "Ctrip", "Ctrip", "Ctrip");
  }
  return pickLang(language, "实时源", "a live provider", "リアルタイムソース", "실시간 제공처");
}

function buildTransportSourceTip(language, pickLang, flightSource, routeSource) {
  const providerLabel = getFlightSourceLabel(language, pickLang, flightSource);
  if ((flightSource === "juhe_live" || flightSource === "ctrip_live") && String(routeSource || "").includes("amap")) {
    return pickLang(
      language,
      `航班价格来自${providerLabel}实时源，地面路线来自高德地图。`,
      `Flight pricing is live via ${providerLabel}. Ground routing comes from Amap.`,
      `航空券価格は${providerLabel}のリアルタイムデータ、地上ルートはAmapです。`,
      `항공권 가격은 ${providerLabel} 실시간 데이터, 지상 경로는 Amap 기준입니다.`
    );
  }
  if (flightSource === "juhe_live" || flightSource === "ctrip_live") {
    return pickLang(
      language,
      `航班价格来自${providerLabel}实时源。`,
      `Flight pricing is live via ${providerLabel}.`,
      `航空券価格は${providerLabel}のリアルタイムデータです。`,
      `항공권 가격은 ${providerLabel} 실시간 데이터입니다.`
    );
  }
  return pickLang(
    language,
    "当前展示的是建议交通组合，请以出票页为准。",
    "Showing the best available transport mix. Final pricing depends on the booking page.",
    "おすすめの交通組み合わせを表示しています。最終価格は予約ページでご確認ください。",
    "추천 교통 조합을 표시합니다. 최종 가격은 예약 페이지 기준입니다."
  );
}

function buildFlightAvailabilityHint(language, pickLang, availability) {
  const status = String(availability?.status || "");
  const code = String(availability?.code || "");
  if (code === "10012") {
    return pickLang(
      language,
      "航班实时票价源额度已用尽，当前展示高铁/航班建议价。",
      "The live flight provider quota is exhausted. Showing the best available rail/flight estimates.",
      "航空券のリアルタイム枠を使い切ったため、利用可能な参考価格を表示しています。",
      "실시간 항공권 제공 한도가 소진되어 현재 가능한 참고 가격을 표시합니다."
    );
  }
  if (status === "timeout") {
    return pickLang(
      language,
      "航班实时票价查询超时，当前展示最佳可用交通组合。",
      "The live flight lookup timed out. Showing the best available transport mix.",
      "航空券のリアルタイム検索がタイムアウトしました。利用可能な最適ルートを表示しています。",
      "실시간 항공권 조회가 시간 초과되었습니다. 사용 가능한 최적 경로를 표시합니다."
    );
  }
  if (status === "no_results") {
    return pickLang(
      language,
      "当前未查到可售航班，建议优先参考高铁或稍后重试。",
      "No bookable flights were returned. Consider rail first or try again later.",
      "予約可能な航空券が見つかりませんでした。鉄道を優先するか、後でもう一度お試しください。",
      "예약 가능한 항공편이 조회되지 않았습니다. 고속철을 우선 검토하거나 잠시 후 다시 시도하세요."
    );
  }
  return pickLang(
    language,
    "航班实时票价当前不可用，以下展示最佳可用交通组合。",
    "Live flight pricing is unavailable right now. Showing the best available transport mix.",
    "航空券のリアルタイム価格は現在利用できません。利用可能な最適ルートを表示しています。",
    "실시간 항공권 가격을 현재 불러올 수 없습니다. 사용 가능한 최적 경로를 표시합니다."
  );
}

function buildCanonicalRailDeeplink(originCity = "", destinationCity = "", date = "") {
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(String(date || "").trim())
    ? String(date).trim()
    : new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
  const query = `${String(originCity || "").trim()} ${String(destinationCity || "").trim()} ${safeDate} train`;
  return `https://kyfw.12306.cn/otn/leftTicket/init?linktypeid=dc&fs=${encodeURIComponent(String(originCity || "").trim())}&ts=${encodeURIComponent(String(destinationCity || "").trim())}&date=${encodeURIComponent(safeDate)}&flag=N,N,Y&keyword=${encodeURIComponent(query)}`;
}

function localizeStationText(value, language) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return normalizeLocalizedCommonText(raw, language) || raw;
}

function localizeRouteModeLabel(mode, language, pickLang) {
  const type = String(mode?.type || "").toLowerCase();
  const rawLabel = String(mode?.label || mode?.name || "").trim();
  if (type === "hsr" || type === "train") {
    const base = pickLang(language, "高铁", "High-speed rail", "新幹線", "고속철");
    return /^g/i.test(rawLabel) ? `G ${base}` : base;
  }
  if (type === "drive" || type === "car") {
    return pickLang(language, "自驾", "Drive", "車移動", "자가 이동");
  }
  if (type === "bus") {
    return pickLang(language, "巴士", "Bus", "バス", "버스");
  }
  if (type === "flight") {
    return pickLang(language, "航班", "Flight", "フライト", "항공편");
  }
  return rawLabel;
}

function localizeRouteFreq(freq, language) {
  const text = String(freq || "").trim();
  if (!text || String(language || "ZH").toUpperCase() === "ZH") return text;
  if (text === "每日多班") return "multiple departures daily";
  const daily = text.match(/每日\s*(\d+)\s*班/);
  if (daily) return `${daily[1]} daily`;
  return text;
}

function localizeRouteNote(note, language, pickLang) {
  const lang = String(language || "ZH").toUpperCase();
  const text = String(note || "").trim();
  if (!text || lang === "ZH") return text;
  let localized = text
    .replace(/宝安机场/g, "Bao'an Airport")
    .replace(/咸阳机场/g, "Xianyang Airport")
    .replace(/地窝堡机场/g, "Diwopu Airport")
    .replace(/首都\/大兴机场/g, "Capital / Daxing Airport")
    .replace(/北京西/g, "Beijing West")
    .replace(/西安北高铁站/g, "Xi'an North HSR Station")
    .replace(/虹桥/g, "Hongqiao")
    .replace(/北京南高铁站/g, "Beijing South HSR Station")
    .replace(/市区间点对点省时/g, "faster door-to-door between city centers")
    .replace(/建议提前2小时到达机场/g, "arrive at the airport 2 hours early")
    .replace(/无直达高铁/g, "no direct high-speed rail service")
    .replace(/建议查阅携程获取实时票价/g, "check Ctrip for live pricing")
    .replace(/路线数据来源：高德地图/g, "routing via Amap")
    .replace(/推荐高铁/g, "High-speed rail recommended")
    .replace(/，/g, ", ");
  const routeMatch = localized.match(/^([^,]+)→([^,]+),\s*(.+)$/);
  const simpleRouteMatch = localized.match(/^([^,]+)→([^,]+)$/);
  if (/^High-speed rail recommended/.test(localized)) {
    return pickLang(
      language,
      localized,
      "High-speed rail is recommended because it is faster door-to-door between city centers.",
      "市内間の移動効率がよいため、新幹線をおすすめします。",
      "도심 간 이동 효율이 좋아 고속철을 추천합니다."
    );
  }
  if (routeMatch) {
    const [, from, to, tail] = routeMatch;
    if (/arrive at the airport 2 hours early/.test(tail)) {
      return pickLang(
        language,
        localized,
        `Suggested connection: ${from} to ${to}. Plan to arrive at the airport 2 hours early.`,
        `推奨ルート: ${from} から ${to}。空港には2時間前到着をおすすめします。`,
        `추천 경로: ${from}에서 ${to}. 공항에는 2시간 일찍 도착하는 편이 좋습니다.`
      );
    }
    if (/no direct high-speed rail service/.test(tail)) {
      return pickLang(
        language,
        localized,
        `Suggested connection: ${from} to ${to}. There is no direct high-speed rail service on this route.`,
        `推奨ルート: ${from} から ${to}。この区間に直通の高速鉄道はありません。`,
        `추천 경로: ${from}에서 ${to}. 이 구간에는 직행 고속철이 없습니다.`
      );
    }
    if (/check Ctrip for live pricing/.test(tail)) {
      return pickLang(
        language,
        localized,
        `Suggested connection: ${from} to ${to}. Check Ctrip for live pricing before booking.`,
        `推奨ルート: ${from} から ${to}。予約前にCtripで最新価格をご確認ください。`,
        `추천 경로: ${from}에서 ${to}. 예약 전 Ctrip에서 실시간 요금을 확인하세요.`
      );
    }
    if (/routing via Amap/.test(tail)) {
      return pickLang(
        language,
        localized,
        `Suggested connection: ${from} to ${to}. Ground routing data comes from Amap.`,
        `推奨ルート: ${from} から ${to}。地上ルートデータはAmapを参照しています。`,
        `추천 경로: ${from}에서 ${to}. 지상 경로 데이터는 Amap 기준입니다.`
      );
    }
    return pickLang(
      language,
      localized,
      `Suggested connection: ${from} to ${to}. ${tail.charAt(0).toUpperCase()}${tail.slice(1)}.`,
      `推奨ルート: ${from} から ${to}。${tail}`,
      `추천 경로: ${from}에서 ${to}. ${tail}`
    );
  }
  if (simpleRouteMatch) {
    const [, from, to] = simpleRouteMatch;
    return pickLang(
      language,
      localized,
      `Suggested connection: ${from} to ${to}.`,
      `推奨ルート: ${from} から ${to}。`,
      `추천 경로: ${from}에서 ${to}.`
    );
  }
  return localized;
}

function requiresContentLocalization(language, payload) {
  if (String(language || "ZH").toUpperCase() === "ZH") return false;
  try { return /[\u4e00-\u9fff]/.test(JSON.stringify(payload)); }
  catch { return false; }
}

const NON_LOCALIZED_KEYS = new Set([
  "id", "layout_type", "image_keyword", "image_url", "real_photo_url",
  "external_id", "source", "flight_no", "airline", "mode", "type",
  "from", "to", "city_code", "poi_id",
]);

function collectLocalizedEntries(node, trail = [], out = []) {
  if (out.length >= 120) return out;
  if (typeof node === "string") {
    if (/[\u4e00-\u9fff]/.test(node)) out.push({ trail: [...trail], value: node });
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((item, idx) => collectLocalizedEntries(item, trail.concat(idx), out));
    return out;
  }
  if (!node || typeof node !== "object") return out;
  for (const [key, value] of Object.entries(node)) {
    if (NON_LOCALIZED_KEYS.has(key)) continue;
    collectLocalizedEntries(value, trail.concat(key), out);
    if (out.length >= 120) break;
  }
  return out;
}

function assignLocalizedValue(target, trail, value) {
  let cursor = target;
  for (let i = 0; i < trail.length - 1; i++) {
    if (cursor == null) return;
    cursor = cursor[trail[i]];
  }
  if (cursor != null) cursor[trail[trail.length - 1]] = value;
}

function cleanupLocalizedEnglishText(value) {
  const raw = String(value || "").trim();
  if (!raw) return raw;
  let text = raw;
  text = text.replace(/([a-z])([A-Z])/g, "$1 $2");
  text = text.replace(/Shanghai(?=[A-Z])/g, "Shanghai ");
  text = text.replace(/Beijing(?=[A-Z])/g, "Beijing ");
  text = text.replace(/Shenzhen(?=[A-Z])/g, "Shenzhen ");
  text = text.replace(/Guangzhou(?=[A-Z])/g, "Guangzhou ");
  text = text.replace(/Chengdu(?=[A-Z])/g, "Chengdu ");
  text = text.replace(/Hangzhou(?=[A-Z])/g, "Hangzhou ");
  text = text.replace(/Nanjing(?=[A-Z])/g, "Nanjing ");
  text = text.replace(/Wuhan(?=[A-Z])/g, "Wuhan ");
  text = text.replace(/Xi'an(?=[A-Z])/g, "Xi'an ");
  text = text.replace(/Yuzhong District(?=[A-Za-z])/g, "Yuzhong District ");
  text = text.replace(/Lianhu District(?=[A-Za-z])/g, "Lianhu District ");
  text = text.replace(/Xincheng District(?=[A-Za-z])/g, "Xincheng District ");
  text = text.replace(/Beilin District(?=[A-Za-z])/g, "Beilin District ");
  text = text.replace(/Weiyang District(?=[A-Za-z])/g, "Weiyang District ");
  text = text.replace(/Shunyi District(?=[A-Za-z])/g, "Shunyi District ");
  text = text.replace(/Pudong New Area(?=[A-Za-z])/g, "Pudong New Area ");
  text = text.replace(/Chongqing(?=[A-Z])/g, "Chongqing ");
  text = text.replace(/Suzhou(?=[A-Z])/g, "Suzhou ");
  text = text.replace(/Xiamen(?=[A-Z])/g, "Xiamen ");
  text = text.replace(/Qingdao(?=[A-Z])/g, "Qingdao ");
  text = text.replace(/Sanya(?=[A-Z])/g, "Sanya ");
  text = text.replace(/Lijiang(?=[A-Z])/g, "Lijiang ");
  text = text.replace(/Dali(?=[A-Z])/g, "Dali ");
  text = text.replace(/Guilin(?=[A-Z])/g, "Guilin ");
  text = text.replace(/Zhangjiajie(?=[A-Z])/g, "Zhangjiajie ");
  text = text.replace(/Huangshan(?=[A-Z])/g, "Huangshan ");
  text = text.replace(/Workers' Stadium(?=(?:East|West|North|South))/g, "Workers' Stadium ");
  text = text.replace(/Xicheng District(?=[A-Za-z])/g, "Xicheng District ");
  text = text.replace(/Chaoyang District(?=[A-Za-z])/g, "Chaoyang District ");
  text = text.replace(/Dongcheng District(?=[A-Za-z])/g, "Dongcheng District ");
  text = text.replace(/Jing'an District(?=[A-Za-z])/g, "Jing'an District ");
  text = text.replace(/Pudong New Area(?=[A-Za-z])/g, "Pudong New Area ");
  text = text.replace(/Huangpu District(?=[A-Za-z])/g, "Huangpu District ");
  text = text.replace(/Hongkou District(?=[A-Za-z])/g, "Hongkou District ");
  text = text.replace(/Nanshan District(?=[A-Za-z])/g, "Nanshan District ");
  text = text.replace(/Bao'an District(?=[A-Za-z])/g, "Bao'an District ");
  text = text.replace(/Futian District(?=[A-Za-z])/g, "Futian District ");
  text = text.replace(/Luohu District(?=[A-Za-z])/g, "Luohu District ");
  text = text.replace(/Longgang District(?=[A-Za-z])/g, "Longgang District ");
  text = text.replace(/Longhua District(?=[A-Za-z])/g, "Longhua District ");
  text = text.replace(/Yantian District(?=[A-Za-z])/g, "Yantian District ");
  text = text.replace(/Xidan North Street\s*乙\s*No\.\s*131/gi, "Xidan North Street No. 131");
  text = text.replace(/\b乙\s*No\./g, "No.");
  text = text.replace(/No\.\s*1\s*2幢3幢/g, "No. 1, Buildings 2-3");
  text = text.replace(/2幢3幢/g, "Buildings 2-3");
  text = text.replace(/JWMarriott/g, "JW Marriott");
  text = text.replace(/SuningBellagio/g, "Suning Bellagio");
  text = text.replace(/XingguoHotel/g, "Xingguo Hotel");
  text = text.replace(/RadissonCollection/g, "Radisson Collection");
  text = text.replace(/BellagioHotel/g, "Bellagio Hotel");
  text = text.replace(/MGMHotel/g, "MGM Hotel");
  text = text.replace(/CHAOHotel/g, "CHAO Hotel");
  text = text.replace(/RegentHotel/g, "Regent Hotel");
  text = text.replace(/CityHotel/g, "City Hotel");
  text = text.replace(/BulgariHotel/g, "Bulgari Hotel");
  text = text.replace(/WaldorfAstoria/g, "Waldorf Astoria");
  text = text.replace(/MandarinOriental/g, "Mandarin Oriental");
  text = text.replace(/FourSeasonsHotel/g, "Four Seasons Hotel");
  text = text.replace(/GrandHotel/g, "Grand Hotel");
  text = text.replace(/BudgetHotel/g, "Budget Hotel");
  text = text.replace(/Five-StarHotel/g, "Five-Star Hotel");
  text = text.replace(/BusinessHotel/g, "Business Hotel");
  text = text.replace(/（/g, "(").replace(/）/g, ")");
  text = text.replace(/，/g, ", ");
  text = text.replace(/Open\s+Open\s+24\s+hours/gi, "Open 24 hours");
  text = text.replace(/(\d+(?:,\d{3})?\+?)条点评/g, "$1 reviews");
  text = text.replace(/(\d{1,3}(?:,\d{3})*)条点评/g, "$1 reviews");
  text = text.replace(/Hotel\(/g, "Hotel (");
  text = text.replace(/饭店/g, "Hotel");
  text = text.replace(/宾馆/g, "Hotel");
  text = text.replace(/地铁站店/g, "Metro Station Branch");
  text = text.replace(/店(?=[)）]|$)/g, " Branch");
  text = text.replace(/([A-Za-z][A-Za-z' -]+)\s*Budget Hotel\s*\((?:similar to |recommended )?Home Inn\s*\/\s*Hanting\)/g, "$1 Budget Hotel (similar to Home Inn / Hanting)");
  text = text.replace(/([A-Za-z][A-Za-z' -]+)\s*Five-Star Hotel\s*\((?:similar to |recommended )?Marriott\s*\/\s*Hilton\)/g, "$1 Five-Star Hotel (similar to Marriott / Hilton)");
  text = text.replace(/\(推荐\s*Home Inn\s*\/\s*Hanting\)/g, "(similar to Home Inn / Hanting)");
  text = text.replace(/\(推荐\s*Marriott\s*\/\s*Hilton\)/g, "(similar to Marriott / Hilton)");
  text = text.replace(/\(recommended\s*Home Inn\s*\/\s*Hanting\)/gi, "(similar to Home Inn / Hanting)");
  text = text.replace(/\(recommended\s*Marriott\s*\/\s*Hilton\)/gi, "(similar to Marriott / Hilton)");
  text = text.replace(/\(推荐\s*万怡\s*\/\s*四点\)/g, "(similar to Courtyard / Four Points)");
  text = text.replace(/\(recommended\s*Courtyard\s*\/\s*Four\s*Points\)/gi, "(similar to Courtyard / Four Points)");
  text = text.replace(/(New Area)([A-Za-z])/g, "$1 $2");
  text = text.replace(/Di Di/g, "DiDi");
  text = text.replace(/Citi\s*GO\s*Citi\s*GO/gi, "CitiGO");
  text = text.replace(/Citi\s*GOCiti\s*GO/gi, "CitiGO");
  text = text.replace(/Citi\s*GOHotel/gi, "CitiGO Hotel");
  text = text.replace(/CitiGOCitiGO/gi, "CitiGO");
  text = text.replace(/Pearlnight/g, "Pearl night");
  text = text.replace(/Pearl River banksnight view/gi, "Pearl River night view");
  text = text.replace(/Guangzhoutop luxury benchmark/gi, "Guangzhou top luxury benchmark");
  text = text.replace(/night view绝美/g, "night views are stunning");
  text = text.replace(/餐厅Michelin-level/g, "Michelin-level dining");
  text = text.replace(/Michelin-level(?=\s*[,.;!?)]|$)/gi, "Michelin-level dining");
  text = text.replace(/Atour Hotel Guangzhou天河/g, "Atour Hotel Guangzhou Tianhe");
  text = text.replace(/Guangzhou富力君悦Grand Hotel/g, "Grand Hyatt Guangzhou");
  text = text.replace(/Guangzhou Fuli Grand Hyatt Grand Hotel/g, "Grand Hyatt Guangzhou");
  text = text.replace(/Atour Hotel Chengdu春熙路/g, "Atour Hotel Chengdu Chunxi Road");
  text = text.replace(/Chengdu瑞吉Hotel/g, "The St. Regis Chengdu");
  text = text.replace(/Chengdu博舍/g, "The Temple House Chengdu");
  text = text.replace(/Chengdu The St\. Regis Hotel/g, "The St. Regis Chengdu");
  text = text.replace(/Chengdu The Temple House/g, "The Temple House Chengdu");
  text = text.replace(/Hangzhou西子湖Four Seasons Hotel/g, "Four Seasons Hotel Hangzhou at West Lake");
  text = text.replace(/West Lake边/g, "West Lake lakeside");
  text = text.replace(/Qiantang River江景/g, "Qiantang River view");
  text = text.replace(/Binjiang高New Area/g, "Binjiang High-tech Zone");
  text = text.replace(/商务出行/g, "business travel");
  text = text.replace(/\(推荐\s*Courtyard\s*\/\s*Four\s*Points\)/gi, "(similar to Courtyard / Four Points)");
  text = text.replace(/李子坝单轨穿楼观景平台/g, "Liziba Monorail Through-the-Building Viewing Platform");
  text = text.replace(/洪崖洞night view Observation Deck/gi, "Hongyadong Night View Observation Deck");
  text = text.replace(/十八梯传统风貌区/g, "Shibati Traditional Scenic Area");
  text = text.replace(/渝中区/g, "Yuzhong District");
  text = text.replace(/Nanjing玄武Marriott Hotel/g, "Nanjing Xuanwu Marriott Hotel");
  text = text.replace(/Xinjiekou核心, No\. 1 线 No\. 2 线均可到, 购物逛街极方便/g, "Prime Xinjiekou location with easy access to Metro Lines 1 and 2, making shopping and city strolling very convenient.");
  text = text.replace(/Yangtze River view房一览无余, 青奥公园就在旁边, 运动休闲都方便/g, "Wide Yangtze River view rooms, Qing'ao Park nearby, and easy access for both exercise and leisure.");
  text = text.replace(/Xuanwu Lake就在眼前, 清晨沿湖散步非常惬意, 位置是Nanjing最中心/g, "Xuanwu Lake is right outside, morning lakeside walks are especially pleasant, and the location sits in central Nanjing.");
  text = text.replace(/Xuanwu Lake畔/g, "by Xuanwu Lake");
  text = text.replace(/旅游热度持续走高/g, "travel demand remains strong");
  text = text.replace(/大唐不夜城/g, "Datang Everbright City");
  text = text.replace(/建议错峰出行/g, "visiting outside peak hours is recommended");
  text = text.replace(/Muslim Quarter、Datang Everbright City均是热门打卡地/g, "the Muslim Quarter and Datang Everbright City are among the most popular stops");
  text = text.replace(/均是热门打卡地/g, "are among the most popular stops");
  text = text.replace(/、/g, ", ");
  text = text.replace(/。/g, ".");
  text = text.replace(/地理位置绝佳, 步行可达Bell Tower和Muslim Quarter, 房间小而温馨, good value。/g, "Excellent location within walking distance of the Bell Tower and Muslim Quarter, with compact but cozy rooms and strong value.");
  text = text.replace(/DiDi to Beijing远航国际Hotel \(首都机场新国展 Branch\)/g, "DiDi to Beijing Yuanhang International Hotel (Capital Airport New Exhibition Branch)");
  text = text.replace(/Guangzhou早茶文化浓厉,\s*茶楼早市,\s*7-10点,\s*人气最旺,\s*建议工作日前往避开周末高峰\.?/g, "Guangzhou morning tea culture is busiest from 7am to 10am. Visit on weekdays to avoid the weekend rush.");
  text = text.replace(/Hotel location: Jing'an District万航渡路 No\. 818/g, "Hotel location: No. 818 Wanhangdu Road, Jing'an District");
  text = text.replace(/Jing'an District万航渡路 No\. 818/g, "No. 818 Wanhangdu Road, Jing'an District");
  text = text.replace(/充电桩/g, "EV charging station");
  text = text.replace(/中式风格,\s*小朋友和老人都特别满意/g, "Chinese-style design that is especially well received by both children and older guests.");
  text = text.replace(/中式风格/g, "Chinese-style design");
  text = text.replace(/Hotel location: Dongcheng District东Chang'an Avenue No\. 35/g, "Hotel location: No. 35 East Chang'an Avenue, Dongcheng District");
  text = text.replace(/Dongcheng District东Chang'an Avenue No\. 35/g, "No. 35 East Chang'an Avenue, Dongcheng District");
  text = text.replace(/^Guangzhou早茶文化浓厉,\s*茶楼早市,\s*7-10点,\s*人气最旺,\s*建议工作日前往避开周末高峰\.?$/g, "Guangzhou morning tea culture is especially strong. Teahouse morning service is busiest from 7-10 AM, and weekday visits are recommended to avoid weekend peaks.");
  text = text.replace(/^Chongqing火锅文化盛行,\s*洪崖洞night view排队拍照到(\d{1,2})分钟,\s*各大火锅店晚市需提前预约\.?$/g, "Chongqing hotpot culture is thriving. Photo queues at the Hongyadong night view can run about $1 minutes, and major hotpot restaurants should be booked ahead for dinner.");
  text = text.replace(/Hotel location: Shunyi District天竺地区府前二街 No. 1/g, "Hotel location: No. 1 Fuqian 2nd Street, Tianzhu Area, Shunyi District");
  text = text.replace(/^([A-Za-z -]+)景点众多,\s*建议提前预订热门景点\.?$/g, "$1 has a dense attraction lineup, and booking the most popular sights in advance is recommended.");
  text = text.replace(/^([A-Za-z -]+)美食丰富,\s*建议提前预订热门餐厅\.?$/g, "$1 has a rich food scene, and booking popular restaurants in advance is recommended.");
  text = text.replace(/^Beijing各景区持续热门,\s*Forbidden City,\s*Great Wall门票需提前7天预订,\s*餐饮高峰期等位(\d{1,2})分钟\.?$/g, "Beijing remains busy across major sights. Forbidden City and Great Wall tickets should be booked about 7 days ahead, and restaurant peak times can mean waits of around $1 minutes.");
  text = text.replace(/^地处王府井黄金地段,\s*Forbidden City,\s*天安门步行可达,\s*房间整洁舒适,\s*性价比很高\.?$/g, "Prime Wangfujing location with easy walks to the Forbidden City and Tiananmen, plus tidy and comfortable rooms.");
  text = text.replace(/^紧邻Nanjing Road步行街,\s*购物极方便,\s*地铁直达,\s*房间现代整洁,\s*非常推荐\.?$/g, "Close to Nanjing Road Pedestrian Street with easy shopping access, direct metro links, and modern tidy rooms.");
  text = text.replace(/^设施齐全,\s*服务专业,\s*早餐丰盛,\s*business travel首选\.?$/g, "Well-equipped with polished service, a generous breakfast, and a strong fit for business travel.");
  text = text.replace(/^具有欧洲风格,\s*卫生clean and tidy\.?$/g, "European-style design with clean and tidy rooms.");
  text = text.replace(/^Shanghai吉臣维景Hotel$/g, "Shanghai Jichen Metropark Hotel");
  text = text.replace(/^DiDi to Shanghai吉臣维景Hotel$/g, "DiDi to Shanghai Jichen Metropark Hotel");
  text = text.replace(/^Jingx27an District万航渡路 No. 818$/g, "No. 818 Wanhangdu Road, Jingx27an District");
  text = text.replace(/^DiDi to Beijing远航国际Hotel (首都机场新国展 Branch)$/g, "DiDi to Beijing Yuanhang International Hotel (Capital Airport New Exhibition Branch)");
  text = text.replace(/^Xix27an travel demand remains strong, the Muslim Quarter and Datang Everbright City are among the most popular stops, visiting outside peak hours is recommended\.?$/g, "Xix27an travel demand remains strong, with the Muslim Quarter and Datang Everbright City among the most popular stops. Visiting outside peak hours is recommended.");
  text = text.replace(/^Xix27antravel demand remains strong, the Muslim Quarter and Datang Everbright City are among the most popular stops, visiting outside peak hours is recommended\.?$/g, "Xix27an travel demand remains strong, with the Muslim Quarter and Datang Everbright City among the most popular stops. Visiting outside peak hours is recommended.");
  text = text.replace(/^Xi'antravel demand remains strong, the Muslim Quarter and Datang Everbright City are among the most popular stops, visiting outside peak hours is recommended\.?$/g, "Xi'an travel demand remains strong, with the Muslim Quarter and Datang Everbright City among the most popular stops. Visiting outside peak hours is recommended.");
  text = text.replace(/Xi'antravel/g, "Xi'an travel");
  text = text.replace(/国贸63层极目四望,?\s*Beijing全城尽收眼底,?\s*attentive service,?\s*是Beijing顶级住宿体验。?/g, "63rd-floor China World views across Beijing, attentive service, and a flagship luxury stay.");
  text = text.replace(/Road(\d)/g, "Road $1");
  text = text.replace(/Avenue(\d)/g, "Avenue $1");
  text = text.replace(/District(\d)/g, "District $1");
  text = text.replace(/New Area(\d)/g, "New Area $1");
  text = text.replace(/(\d+)弄/g, " Lane $1 ");
  text = text.replace(/(\d+)号楼/g, " Building $1 ");
  text = text.replace(/(\d+)号/g, " No. $1 ");
  text = text.replace(/\s{2,}/g, " ").trim();
  return text;
}

function normalizeLocalizedCommonText(value, language) {
  const target = String(language || "ZH").toUpperCase();
  if (typeof value !== "string" || target === "ZH") return value;
  const text = value.trim();
  if (!text) return value;
  const replaceKnownPlaces = (input) => {
    let output = String(input || "");
    const labels = {
      深圳: "Shenzhen",
      上海: "Shanghai",
      北京: "Beijing",
      索菲特: "Sofitel",
      建国门南大街: "Jianguomen South Avenue",
      建国门外大街: "Jianguomen Outer Avenue",
      朝阳区: "Chaoyang District",
      海淀区: "Haidian District",
      西城区: "Xicheng District",
      什坊院: "Shifangyuan",
      莲花桥畔: "near Lianhua Bridge",
      西直门南大街: "Xizhimen South Avenue",
      南门: "South Gate",
      长安街: "Chang'an Avenue",
      长宁区: "Changning District",
      北苏州路: "North Suzhou Road",
      兴国路: "Xingguo Road",
      兴国: "Xingguo",
      苏宁: "Suning",
      宝丽嘉: "Bellagio",
      丽笙精选: "Radisson Collection",
      东方广场: "Oriental Plaza",
      东城区: "Dongcheng District",
      故宫: "Forbidden City",
      长城: "Great Wall",
      京都信苑: "Jingdu Xinyuan",
      国二招宾馆: "State Guest Hotel No. 2",
      "Beijing Grand Hyatt大Hotel": "Grand Hyatt Beijing",
      "Grand Hyatt大Hotel": "Grand Hyatt Hotel",
      东方君悦: "Grand Hyatt",
      索菲特大酒店: "Sofitel Hotel",
      索菲特大: "Sofitel",
      饭店: "Hotel",
      宾馆: "Hotel",
      广州: "Guangzhou",
      成都: "Chengdu",
      希尔顿: "Hilton",
      如家: "Home Inn",
      汉庭: "Hanting",
      天河: "Tianhe",
      天河CBD: "Tianhe CBD",
      体育西路: "Tiyu West Road",
      体育西: "Tiyu West",
      春熙路: "Chunxi Road",
      瑞吉: "The St. Regis",
      博舍: "The Temple House",
      太古里: "Taikoo Li",
      君悦的: "Grand Hyatt's",
      文华东方: "Mandarin Oriental",
      华尔道夫: "Waldorf Astoria",
      宝格丽: "Bulgari",
      君悦: "Grand Hyatt",
      富力君悦: "Fuli Grand Hyatt",
      四季Hotel: "Four Seasons Hotel",
      经济型Hotel: "Budget Hotel",
      五星Hotel: "Five-Star Hotel",
      商务Hotel: "Business Hotel",
      大酒店: "Grand Hotel",
      大Hotel: "Grand Hotel",
      杭州: "Hangzhou",
      西安: "Xi'an",
      南京: "Nanjing",
      武汉: "Wuhan",
      重庆: "Chongqing",
      苏州: "Suzhou",
      厦门: "Xiamen",
      青岛: "Qingdao",
      三亚: "Sanya",
      丽江: "Lijiang",
      大理: "Dali",
      桂林: "Guilin",
      张家界: "Zhangjiajie",
      黄山: "Huangshan",
      外滩: "Bund",
      豫园: "Yu Garden",
      城隍庙: "City God Temple",
      陆家嘴: "Lujiazui",
      南京路: "Nanjing Road",
      福州路: "Fuzhou Road",
      外白渡桥: "Waibaidu Bridge",
      北外滩: "North Bund",
      徐家汇: "Xujiahui",
      徐汇区: "Xuhui District",
      浦东: "Pudong",
      黄浦区: "Huangpu District",
      浦东新区: "Pudong New Area",
      虹口区: "Hongkou District",
      金桥: "Jinqiao",
      静安区: "Jing'an District",
      万国建筑博览群: "Bund Architecture Gallery",
      辅德里公园: "Fude Li Park",
      艺龙安悦: "Elong Anyue",
      南山: "Nanshan",
      前海: "Qianhai",
      亚朵: "Atour",
      万豪侯爵: "Marriott Marquis",
      万豪: "Marriott",
      歇浦路: "Xiepu Road",
      北京东路: "East Beijing Road",
      "锦江都城Hotel（Shanghai Nanjing West Road Branch）": "Metropolo Hotel (Shanghai Nanjing West Road Branch)",
      "锦江都城Hotel(Shanghai Nanjing West Road Branch)": "Metropolo Hotel (Shanghai Nanjing West Road Branch)",
      "上海柏悦Hotel（环球金融中心）": "Park Hyatt Shanghai (World Financial Center)",
      "上海柏悦Hotel(环球金融中心)": "Park Hyatt Shanghai (World Financial Center)",
      "Shanghai柏悦Hotel（环球金融中心）": "Park Hyatt Shanghai (World Financial Center)",
      "Shanghai柏悦Hotel(环球金融中心)": "Park Hyatt Shanghai (World Financial Center)",
      "北京柏悦Hotel": "Park Hyatt Beijing",
      "Beijing柏悦Hotel": "Park Hyatt Beijing",
      "长富宫Hotel": "Hotel New Otani Chang Fu Gong",
      "北京长富宫Hotel": "Hotel New Otani Chang Fu Gong Beijing",
      "北京佳兆业铂域行政公寓": "Beijing Kaisa Bo Yu Executive Apartments",
      "秋果Hotel (Beijing西站六里桥东Metro Station Branch)": "Qiuguo Hotel (Beijing West Railway Station Liuliqiao East Metro Station Branch)",
      "Beijing三元桥Citi GO欢阁Hotel": "Beijing Sanyuanqiao CitiGO Hotel",
      "三元桥Citi GO欢阁Hotel": "Sanyuanqiao CitiGO Hotel",
      "Citi GO欢阁Hotel": "CitiGO Hotel",
      "欢阁Hotel": "CitiGO Hotel",
      "全季Hotel（Beijing王府井步行街 Branch）": "Ji Hotel (Beijing Wangfujing Pedestrian Street Branch)",
      "全季Hotel(Beijing王府井步行街 Branch)": "Ji Hotel (Beijing Wangfujing Pedestrian Street Branch)",
      "全季Hotel (Beijing王府井步行街 Branch)": "Ji Hotel (Beijing Wangfujing Pedestrian Street Branch)",
      "全季Hotel (Beijing Wangfujing Pedestrian Street Branch)": "Ji Hotel (Beijing Wangfujing Pedestrian Street Branch)",
      "全季Hotel(Beijing Wangfujing Pedestrian Street Branch)": "Ji Hotel (Beijing Wangfujing Pedestrian Street Branch)",
      "全季Hotel": "Ji Hotel",
      王府井步行街: "Wangfujing Pedestrian Street",
      秋果: "Qiuguo",
      西站: "West Railway Station",
      六里桥东: "Liuliqiao East",
      三元桥: "Sanyuanqiao",
      欢阁: "CitiGO",
      锦江都城: "Metropolo",
      柏悦: "Park Hyatt",
      朗廷: "Langham",
      丽呈花园: "Rezen Garden",
      环球金融中心: "World Financial Center",
      新天地: "Xintiandi",
      川沙新镇: "Chuansha",
      连民村: "Lianmin Village",
      三里屯CHAOHotel: "Sanlitun CHAO Hotel",
      三里屯: "Sanlitun",
      大悦Hotel: "Joy City Hotel",
      大悦城: "Joy City",
      丽晶Hotel: "Regent Hotel",
      丽晶: "Regent",
      金宝街: "Jinbao Street",
      工人体育场: "Workers' Stadium",
      西单北大街: "Xidan North Street",
      西单: "Xidan",
      贵宾楼Hotel: "Grand Hotel Beijing",
      北京贵宾楼Hotel: "Grand Hotel Beijing",
      蔚徕Hotel: "Weilai Hotel",
      北京蔚徕Hotel: "Beijing Weilai Hotel",
      通州环球度假区: "Tongzhou Universal Resort",
      通州区: "Tongzhou District",
      运河西大街: "Yunhe West Avenue",
      葛布店南里: "Gebudian Nanli",
      全屋智能: "Smart-room automation",
      科技感满满: "Tech-forward feel",
      青旅瑞华Hotel: "Qinglv Ruihua Hotel",
      青旅瑞华: "Qinglv Ruihua",
      高平路: "Gaoping Road",
      静安: "Jing'an",
      上海青旅瑞华Hotel: "Shanghai Qinglv Ruihua Hotel",
      南山区: "Nanshan District",
      宝安区: "Bao'an District",
      福田区: "Futian District",
      罗湖区: "Luohu District",
      龙岗区: "Longgang District",
      龙华区: "Longhua District",
      盐田区: "Yantian District",
      越秀区: "Yuexiu District",
      荔湾区: "Liwan District",
      顺义区: "Shunyi District",
      青羊区: "Qingyang District",
      武侯区: "Wuhou District",
      市中心: "City Center",
      核心区: "Core District",
      商业区: "Commercial District",
      珠江新城: "Zhujiang New Town",
      广州塔旁: "near Canton Tower",
      天河商圈: "Tianhe business district",
      天河CBD商圈: "Tianhe CBD",
      精品商务: "Boutique business stay",
      高铁广州东旁: "near Guangzhou East Railway Station",
      广州东: "Guangzhou East",
      天府广场: "Tianfu Square",
      天府广场旁: "near Tianfu Square",
      管家式服务: "Butler-style service",
      大慈寺: "Daci Temple",
      大慈寺历史街区: "Daci Temple historic district",
      庭院禅意: "Zen courtyard atmosphere",
      网红打卡: "popular photo spot",
      成都网红打卡: "popular Chengdu photo spot",
      旅游核心区: "tourism core district",
      "旅游Core District": "tourism core district",
      春熙路商圈: "Chunxi Road shopping district",
      IFS太古里旁: "near IFS and Taikoo Li",
      天河核心位置: "Prime Tianhe location",
      正宗粤菜早茶: "authentic Cantonese dim sum breakfast",
      正宗粤式点心: "authentic Cantonese dim sum",
      粤式点心: "Cantonese dim sum",
      经济实惠: "Budget-friendly",
      交通便利: "Convenient transport",
      位置便利: "Convenient location",
      性价比高: "good value",
      干净整洁: "clean and tidy",
      适合商务出行: "well suited to business travel",
      顶级奢华体验: "Flagship luxury experience",
      服务无微不至: "attentive service",
      设施一流: "top-tier facilities",
      物超所值: "excellent overall value",
      顶级奢华: "Flagship luxury",
      顶奢标杆: "Luxury benchmark",
      顶奢天花板: "top luxury benchmark",
      珠江两岸: "Pearl River banks",
      "珠江night view": "Pearl River night view",
      米其林水准: "Michelin-level",
      北京路步行街: "Beijing Road Pedestrian Street",
      大佛寺: "Grand Buddha Temple",
      三元宫: "Sanyuan Palace",
      人民公园: "People's Park",
      锦城公园: "Jincheng Park",
      生机之塔: "Tower of Life",
      桂溪生态公园: "Guixi Ecological Park",
      西湖风景名胜区: "West Lake Scenic Area",
      Hangzhou西湖风景名胜区: "Hangzhou West Lake Scenic Area",
      城市阳台: "City Balcony",
      钱江世纪公园: "Qianjiang Century Park",
      西湖区: "Xihu District",
      上城区: "Shangcheng District",
      萧山区: "Xiaoshan District",
      西湖: "West Lake",
      断桥: "Broken Bridge",
      滨江: "Binjiang",
      钱塘江: "Qiantang River",
      湖边: "lakeside",
      徒步可达: "walkable",
      精品设计: "Boutique design",
      文艺氛围: "Art-forward atmosphere",
      商务设施: "Business facilities",
      丰盛早餐: "Hearty breakfast",
      万怡: "Courtyard",
      四点: "Four Points",
      咸安坊: "Xian'an Fang",
      解放公园: "Jiefang Park",
      古德寺: "Gude Temple",
      江岸区: "Jiang'an District",
      新街口: "Xinjiekou",
      建邺: "Jianye",
      玄武湖: "Xuanwu Lake",
      玄武区: "Xuanwu District",
      玄武湖景区: "Xuanwu Lake Scenic Area",
      总统府: "Presidential Palace",
      中山陵景区: "Sun Yat-sen Mausoleum Scenic Area",
      长江江景: "Yangtze River view",
      青奥轴线: "Youth Olympic axis",
      中山陵近: "near Sun Yat-sen Mausoleum",
      鼓楼中心: "Gulou center",
      兴庆区: "Xingqing District",
      莲湖区: "Lianhu District",
      曲江新区: "Qujiang New Area",
      "曲江New Area": "Qujiang New Area",
      新城区: "Xincheng District",
      碑林区: "Beilin District",
      未央区: "Weiyang District",
      咸阳: "Xianyang",
      钟楼: "Bell Tower",
      回民街: "Muslim Quarter",
      高新区: "High-tech Zone",
      兴庆宫公园: "Xingqing Palace Park",
      城市运动公园: "City Sports Park",
      首都国际会展中心: "Capital International Exhibition Center",
      广州塔: "Canton Tower",
      观景台: "Observation Deck",
      文化街: "Cultural Street",
      地铁站: "Metro Station",
      博物院: "Museum",
      "24小时营业": "Open 24 hours",
      大道: "Avenue",
      东路: "East Road",
      西路: "West Road",
      南路: "South Road",
      北路: "North Road",
      酒店: "Hotel",
      新区: "New Area",
      东方明珠: "Oriental Pearl",
      广播电视塔: "TV Tower",
      四行仓库抗战纪念馆: "Sihang Warehouse Memorial",
      静安寺: "Jing'an Temple",
      浦明路: "Puming Road",
      云锦路: "Yunjin Road",
      万国建筑博览群: "Bund Architecture Gallery",
      辅德里公园: "Fude Li Park",
      艺龙安悦: "Elong Anyue",
      世纪广场: "Century Plaza",
      滨江绿地: "Riverside Green",
      夜景: "night view",
      亲子主题房: "family themed rooms",
      送餐机器人: "delivery robot",
      新中式风: "new Chinese style",
      免费停车: "free parking",
      免费机场班车: "free airport shuttle",
      室内儿童乐园: "indoor kids club",
      一线江景: "front-row river view",
      免费洗衣服务: "free laundry service",
      机器人服务: "robot service",
      洗衣服务: "laundry service",
      法式风格: "French-style design",
      泳池: "swimming pool",
      新开业: "Newly opened",
      套房: "Suites",
      璞硯: "Puyan",
      禧玥: "Xiyue",
      西岸美高梅Hotel: "West Bund MGM Hotel",
      西岸美高梅: "West Bund MGM",
    };
    Object.entries(labels)
      .sort((a, b) => b[0].length - a[0].length)
      .forEach(([from, to]) => {
        output = output.replace(new RegExp(from, "g"), to);
      });
    return output;
  };
  const localizePlace = (raw) => replaceKnownPlaces(String(raw || "").trim().replace(/市$/, ""));
  const exactMap = {
    EN: {
      景点: "Attraction",
      活动: "Activity",
      游玩: "Sightseeing",
      午餐: "Lunch",
      晚餐: "Dinner",
      早餐: "Breakfast",
      早午餐: "Brunch",
      下午茶: "Afternoon tea",
      上午: "Morning",
      下午: "Afternoon",
      晚上: "Evening",
      早上: "Morning",
      中午: "Noon",
      到达: "Arrival",
      返程: "Return trip",
      交通: "Transport",
      机场接送: "Airport transfer",
      观景台: "Observation Deck",
      文化街: "Cultural Street",
      地铁站: "Metro Station",
      酒店: "Hotel",
      夜景: "night view",
      免费停车: "Free parking",
      家庭房: "Family room",
      室内恒温泳池: "Indoor heated pool",
      自助早餐: "Buffet breakfast",
      洗衣房: "Laundry room",
      拍照出片: "Great for photos",
      山景房: "Mountain-view room",
      无烟楼层: "Non-smoking floor",
      低碳酒店: "Low-carbon hotel",
      低碳Hotel: "Low-carbon hotel",
      送餐机器人: "Delivery robot",
      机器人服务: "Robot service",
      "外滩夜景尽收眼底": "Sweeping Bund night views",
      "中式风格装修，舒适安逸": "Chinese-style decor and a comfortable stay",
      "装修风格简约大气，购物用餐很便利": "Modern, understated design with convenient shopping and dining nearby.",
      "透着设计感和环保理念，干净整洁": "Design-led, eco-conscious, clean and tidy.",
      "游泳池十分不错": "The swimming pool is a strong highlight.",
      "动人night view": "Striking night view",
      "早餐性价比很高，家人很满意": "Breakfast is excellent value and the family was very satisfied.",
      "新开业": "Newly opened",
      "健身房和游泳池拥有无敌江景": "The gym and pool have sweeping river views.",
      "地理位置优越，客房设施完备且整洁": "Great location with clean, well-equipped rooms",
      "大厅有儿童乐园，有迪士尼班车接送": "Lobby play area with Disney shuttle service",
      "新天地核心位置，装修典雅大气，早餐种类丰富，夜晚步行街区热闹非凡。": "Prime Xintiandi location with elegant interiors, a generous breakfast, and lively nightlife nearby.",
      "102楼云端视角，Bund与Lujiazui全景震撼，床铺舒适度满分，每次来必住这里！": "102nd-floor skyline views with sweeping Bund and Lujiazui panoramas, plus excellent bed comfort.",
      "102楼云端视角, Bund与Lujiazui全景震撼, 床铺舒适度满分, 每次来必住这里！": "102nd-floor skyline views with sweeping Bund and Lujiazui panoramas, plus excellent bed comfort.",
      "位置优越, 交通便利, 装修有风格": "Great location, convenient transport, and stylish decor.",
      "地处王府井黄金地段, Forbidden City、天安门步行可达, 房间整洁舒适, 性价比很高。": "Prime Wangfujing location with easy walks to the Forbidden City and Tiananmen, plus tidy and comfortable rooms.",
      "国贸63层极目四望, Beijing全城尽收眼底, 服务无微不至, 是Beijing顶级住宿体验。": "63rd-floor China World views across Beijing, attentive service, and a flagship luxury stay.",
      "紧邻Nanjing Road步行街, 购物极方便, 地铁直达, 房间现代整洁, 非常推荐。": "Close to Nanjing Road Pedestrian Street with easy shopping access, direct metro links, and modern tidy rooms.",
      "南京路购物": "Nanjing Road shopping",
      "地铁直达": "Direct metro access",
      "现代设计": "Modern design",
      "早餐性价比很高，家人很满意": "Breakfast is excellent value and the family was very satisfied.",
      "热带雨林风格灯光变换非常漂亮": "Tropical rainforest-style lighting creates a striking atmosphere",
      "圆形浴缸里泡个泡泡浴，解压舒适": "The round bathtub is ideal for a relaxing soak.",
      "早餐丰盛好吃，味道超级好": "Breakfast is generous and very tasty.",
      "环境非常优美，绿树成荫，景色宜人": "The surroundings are beautiful, with plenty of greenery and a pleasant setting.",
      "满满的高级感，早餐半自助式": "A refined stay with a semi-buffet breakfast.",
      "很喜欢庄园式Hotel，环境优雅": "An elegant estate-style hotel with a calm setting.",
      历史名宅: "Heritage mansion",
      花园: "Garden",
      新天地核心: "Prime Xintiandi location",
      典雅装修: "Elegant interiors",
      夜生活便利: "Easy nightlife access",
      Bund全景: "Full Bund skyline view",
      云端住宿: "Sky-high stay",
      顶奢体验: "Flagship luxury stay",
      博物院: "Museum",
      天坛公园: "Temple of Heaven Park",
      天安门: "Tiananmen",
      什刹海: "Shichahai",
      "24小时营业": "Open 24 hours",
      艺术氛围: "Art-forward atmosphere",
      高空美景: "High-floor skyline views",
      行政酒廊: "Executive lounge",
      糖画体验: "Sugar painting experience",
      Bund江景: "Bund river view",
      "很喜欢庄园式酒店，环境优雅": "An elegant estate-style hotel with a calm setting.",
      "很喜欢庄园式Hotel，环境优雅": "An elegant estate-style hotel with a calm setting.",
      "国贸顶层": "China World top-floor views",
      "超高层全景": "Ultra high-floor panorama",
      "精致服务": "Refined service",
      "Forbidden City近": "Close to the Forbidden City",
      "性价比高": "Strong value for money",
      "城市全景": "City panorama",
      "顶级泳池": "Flagship pool",
      "商务首选": "Strong for business stays",
      "日出时分的城市全景令人震撼，服务顶级，游泳池设施一流，商务出行首选。": "Striking sunrise city views, polished service, and a strong pool setup make it a solid business-stay pick.",
      "位置便利, 性价比高, 干净整洁, 适合商务出行。": "Convenient location, good value, clean rooms, and well suited to business travel.",
      "位置优越, Convenient transport, 装修有风格": "Great location, convenient transport, and stylish decor.",
      "顶级奢华体验, 服务无微不至, 设施一流, 物超所值。": "Flagship luxury service with attentive staff, top-tier facilities, and strong overall value.",
      "Guangzhou顶奢天花板, 珠江两岸night view绝美, 餐厅米其林水准": "A top-tier luxury stay in Guangzhou with stunning Pearl River night views and Michelin-level dining.",
      "国贸63层极目四望, Beijing全城尽收眼底, attentive service, 是Beijing顶级住宿体验。": "63rd-floor China World views across Beijing, attentive service, and a flagship luxury stay.",
      "Atour Hotel Guangzhou天河": "Atour Hotel Guangzhou Tianhe",
      "Guangzhou富力君悦Grand Hotel": "Grand Hyatt Guangzhou",
      "Guangzhou Fuli Grand Hyatt Grand Hotel": "Grand Hyatt Guangzhou",
      "天河核心位置, 走路到体育West Road地铁5分钟, 出行极方便": "Prime Tianhe location, about a 5-minute walk to Tiyu West Road metro, with easy access around the city.",
      "天河核心位置, 走路到体育西路地铁5分钟, 出行极方便": "Prime Tianhe location, about a 5-minute walk to Tiyu West Road metro, with easy access around the city.",
      "Prime Tianhe location, 走路到Tiyu West Road地铁5分钟, 出行极方便": "Prime Tianhe location, about a 5-minute walk to Tiyu West Road metro, with easy access around the city.",
      "君悦的早茶是Guangzhou Hotel里最好吃的, 全是正宗粤式点心": "The Grand Hyatt morning tea is one of the best hotel dim sum experiences in Guangzhou, with authentic Cantonese classics.",
      "Grand Hyatt's早茶是Guangzhou Hotel里最好吃的, 全是authentic Cantonese dim sum": "The Grand Hyatt morning tea is one of the best hotel dim sum experiences in Guangzhou, with authentic Cantonese classics.",
      "Atour Hotel Chengdu春熙路": "Atour Hotel Chengdu Chunxi Road",
      "Chengdu瑞吉Hotel": "The St. Regis Chengdu",
      "Chengdu博舍": "The Temple House Chengdu",
      "春熙路商圈里住这个价格太超值了, 太古里IFS步行即达": "Excellent value for staying in the Chunxi Road shopping district, with Taikoo Li and IFS within walking distance.",
      "Chunxi Road shopping district里住这个价格太超值了, Taikoo Li IFS步行即达": "Excellent value for staying in the Chunxi Road shopping district, with Taikoo Li and IFS within walking distance.",
      "The St. Regis管家服务是同级别里最贴心的, 每次进房都有专属欢迎卡": "The St. Regis butler service feels especially polished for this tier, and each arrival comes with a personalized welcome card.",
      "Chengdu最有文化气韵的精品奢华Hotel, 庭院设计融合宋代美学": "One of Chengdu's most distinctive luxury boutique stays, with courtyard design inspired by Song-era aesthetics.",
      "The St. Regis早午餐": "St. Regis brunch",
      "Hangzhou西子湖Four Seasons Hotel": "Four Seasons Hotel Hangzhou at West Lake",
      "西湖边最好的位置, 宋代园林造景, 站在房间里望向西湖心旷神怡": "One of the best West Lake locations, with Song-inspired garden design and serene lake views from the room.",
      "西湖直面湖景": "Direct West Lake views",
      "古典园林造景": "Classical garden landscaping",
      "Hangzhou顶奢": "Hangzhou flagship luxury",
      "Hangzhou Marriott滨江Hotel": "Hangzhou Marriott Binjiang Hotel",
      "步行10分钟到West Lake断桥, 价格比湖边五星实惠一半, 体验接近": "About a 10-minute walk to Broken Bridge at West Lake, with roughly half the price of the lakeside five-star stays and a comparable experience.",
      "West Lake徒步可达": "West Lake walkable access",
      "钱塘江江景房视野开阔, 附近互联网公司密集, 商务出行方便": "Wide Qiantang River view rooms, a dense nearby office cluster, and easy logistics for business travel.",
      "钱塘江景": "Qiantang River view",
      "Chongqing Business Hotel (推荐万怡/四点)": "Chongqing Business Hotel (similar to Courtyard / Four Points)",
      "设施齐全, 服务专业, 早餐丰盛, 商务出行首选。": "Well-equipped with polished service, a generous breakfast, and a strong fit for business travel.",
      "商务设施": "Business facilities",
      "丰盛早餐": "Hearty breakfast",
      "Xi'an君乐宝铂尔曼Hotel": "Pullman Xi'an High-tech Zone",
      "DiDi to Xi'an君乐宝铂尔曼Hotel": "DiDi to Pullman Xi'an High-tech Zone",
      "早餐品种极其丰富, Hotel设施现代化, 前台服务热情, 非常适合家庭出行.": "A very generous breakfast selection, modern facilities, warm front-desk service, and a strong fit for family trips.",
      "现代设施": "Modern facilities",
      "家庭友好": "Family-friendly",
      "推荐Courtyard/Four Points": "similar to Courtyard / Four Points",
      "李子坝单轨穿楼观景平台": "Liziba Monorail Through-the-Building Viewing Platform",
      "洪崖洞night view Observation Deck": "Hongyadong Night View Observation Deck",
      "Chongqing十八梯传统风貌区": "Chongqing Shibati Traditional Scenic Area",
      "渝中区": "Yuzhong District",
      "步行10分钟到West Lake Broken Bridge, 价格比lakeside五星实惠一半, 体验接近": "About a 10-minute walk to Broken Bridge at West Lake, with roughly half the price of the lakeside five-star stays and a comparable experience.",
      "Qiantang River view房视野开阔, 附近互联网公司密集, business travel方便": "Wide Qiantang River view rooms, a dense nearby office cluster, and easy logistics for business travel.",
      "West Lake lakeside最好的位置, 宋代园林造景, 站在房间里望向West Lake心旷神怡": "One of the best West Lake lakeside locations, with Song-inspired garden landscaping and serene lake views from the room.",
      "设施齐全, 服务专业, 早餐丰盛, business travel首选。": "Well-equipped with polished service, a generous breakfast, and a strong fit for business travel.",
      "Atour Hotel Nanjing新街口": "Atour Hotel Nanjing Xinjiekou",
      "新街口核心, No. 1 线 No. 2 线均可到, 购物逛街极方便": "Prime Xinjiekou location with easy access to Metro Lines 1 and 2, making shopping and city strolling very convenient.",
      "新街口地铁枢纽": "Xinjiekou metro hub",
      "Nanjing中心商圈": "Nanjing central business district",
      "长江江景房一览无余, 青奥公园就在旁边, 运动休闲都方便": "Wide Yangtze River view rooms, Qing'ao Park nearby, and easy access for both exercise and leisure.",
      "玄武湖就在眼前, 清晨沿湖散步非常惬意, 位置是Nanjing最中心": "Xuanwu Lake is right outside, morning lakeside walks are especially pleasant, and the location sits in central Nanjing.",
      "Nanjing玄武Marriott Hotel": "Nanjing Xuanwu Marriott Hotel",
      "银川兴庆凯里亚德Hotel": "Kyriad Hotel Yinchuan Xingqing",
      "Home Inn Hotel (Xi'an钟楼回民街 Branch)": "Home Inn Hotel (Xi'an Bell Tower Muslim Quarter Branch)",
      "Xi'an万达文华Hotel": "Wanda Vista Xi'an",
      "环境整洁, 房间宽敞明亮, clean and tidy": "Clean surroundings, bright spacious rooms, and a tidy overall stay.",
      "地理位置绝佳, 步行可达钟楼和回民街, 房间小而温馨, good value。": "Excellent location within walking distance of the Bell Tower and Muslim Quarter, with compact but cozy rooms and strong value.",
      "房间宽敞奢华, 顶层景观令人叹为观止, SPA中心一流, 体验极致尊贵。": "Spacious luxurious rooms, striking upper-floor views, and a first-rate spa deliver a very premium stay.",
      "房间宽敞奢华, 顶层景观令人叹为观止, SPA中心一流, 体验极致尊贵.": "Spacious luxurious rooms, striking upper-floor views, and a first-rate spa deliver a very premium stay.",
      "地理位置绝佳, 步行可达Bell Tower和Muslim Quarter, 房间小而温馨, good value.": "Excellent location within walking distance of the Bell Tower and Muslim Quarter, with compact but cozy rooms and strong value.",
      "Shanghai餐饮竞争激烈, Bund附近餐厅等位30分钟, 建议提前使用大众点评预约.": "Shanghai dining is busy, and restaurants near Bund often have waits of about 30 minutes. Booking ahead on Dianping is recommended.",
      "Guangzhou早茶文化浓厉, 茶楼早市, 7-10点, 人气最旺, 建议工作日前往避开周末高峰.": "Guangzhou morning tea culture is busiest from 7am to 10am. Visit on weekdays to avoid the weekend rush.",
      "充电桩": "EV charging station",
      "Jing'an District万航渡路 No. 818": "No. 818 Wanhangdu Road, Jing'an District",
      "Hotel location: Jing'an District万航渡路 No. 818": "Hotel location: No. 818 Wanhangdu Road, Jing'an District",
      "中式风格": "Chinese-style design",
      "中式风格, 小朋友和老人都特别满意": "Chinese-style design that is especially well received by both children and older guests.",
      "Dongcheng District东Chang'an Avenue No. 35": "No. 35 East Chang'an Avenue, Dongcheng District",
      "Hotel location: Dongcheng District东Chang'an Avenue No. 35": "Hotel location: No. 35 East Chang'an Avenue, Dongcheng District",
      "地段绝佳": "Prime location",
      "步行景区": "Walkable to attractions",
      "回民街美食": "Muslim Quarter dining",
      "奢华客房": "Luxury rooms",
      "顶楼景观": "Upper-floor views",
      "SPA中心": "Spa center",
      "Xi'an城墙": "Xi'an City Wall",
      "Xi'an城市运动公园": "Xi'an City Sports Park",
      "Xinjiekou核心, No. 1 线 No. 2 线均可到, 购物逛街极方便": "Prime Xinjiekou location with easy access to Metro Lines 1 and 2, making shopping and city strolling very convenient.",
      "Yangtze River view房一览无余, 青奥公园就在旁边, 运动休闲都方便": "Wide Yangtze River view rooms, Qing'ao Park nearby, and easy access for both exercise and leisure.",
      "Xuanwu Lake就在眼前, 清晨沿湖散步非常惬意, 位置是Nanjing最中心": "Xuanwu Lake is right outside, morning lakeside walks are especially pleasant, and the location sits in central Nanjing.",
      "Xuanwu Lake畔": "by Xuanwu Lake",
      "现代商圈": "modern business district",
      "DiDi to 银川兴庆凯里亚德Hotel": "DiDi to Kyriad Hotel Yinchuan Xingqing",
      "DiDi to Xi'an万达文华Hotel": "DiDi to Wanda Vista Xi'an",
      "Visit Xi'an城墙 in Xincheng District. Free entry. Open 08:00-22:00": "Visit Xi'an City Wall in Xincheng District. Free entry. Open 08:00-22:00",
      "Xi'an旅游热度持续走高, Muslim Quarter、大唐不夜城均是热门打卡地, 建议错峰出行。": "Xi'an travel demand remains strong, with the Muslim Quarter and Datang Everbright City among the most popular stops. Visiting outside peak hours is recommended.",
      "免费携带宠物": "Pets allowed free of charge",
      "Beijing远航国际Hotel (首都机场新国展 Branch)": "Beijing Yuanhang International Hotel (Capital Airport New Exhibition Branch)",
      "有儿童乐园, 可爱的羊驼和松鼠": "Includes a kids play area with alpacas and squirrels.",
      "免费行李寄存": "Free luggage storage",
      "Shunyi District天竺地区府前二街 No. 1": "No. 1 Fuqian 2nd Street, Tianzhu Area, Shunyi District",
      "山城步道": "Mountain City Trail",
      "Visit 山城步道 in Yuzhong District. Free entry. Open 24 hours": "Visit Mountain City Trail in Yuzhong District. Free entry. Open 24 hours",
      "Shanghai万信RHotel (Lujiazui金融街区 Branch)": "Shanghai Wanxin R Hotel (Lujiazui Financial District Branch)",
      "DiDi to Shanghai万信RHotel (Lujiazui金融街区 Branch)": "DiDi to Shanghai Wanxin R Hotel (Lujiazui Financial District Branch)",
      "西安旅游热度持续走高, 回民街、大唐不夜城均是热门打卡地, 建议错峰出行。": "Xi'an travel demand remains strong, with the Muslim Quarter and Datang Everbright City among the most popular stops. Visiting outside peak hours is recommended.",
      "西安旅游热度持续走高, Muslim Quarter、大唐不夜城均是热门打卡地, 建议错峰出行。": "Xi'an travel demand remains strong, with the Muslim Quarter and Datang Everbright City among the most popular stops. Visiting outside peak hours is recommended.",
      "整体环境不错, 卫生挺好, 服务得体": "Overall environment is pleasant, cleanliness is solid, and service is well handled.",
      "Pudong New Area崮山路 No. 688": "No. 688 Gushan Road, Pudong New Area",
      "Hotel location: Pudong New Area崮山路 No. 688": "Hotel location: No. 688 Gushan Road, Pudong New Area",
    },
    JA: {
      景点: "観光地",
      活动: "アクティビティ",
      午餐: "昼食",
      晚餐: "夕食",
      早餐: "朝食",
      上午: "午前",
      下午: "午後",
      晚上: "夜",
      到达: "到着",
      返程: "帰路",
      交通: "移動",
    },
    KO: {
      景点: "명소",
      活动: "액티비티",
      午餐: "점심",
      晚餐: "저녁",
      早餐: "아침",
      上午: "오전",
      下午: "오후",
      晚上: "저녁",
      到达: "도착",
      返程: "귀환",
      交通: "교통",
    },
  }[target] || {};
  if (exactMap[text]) return cleanupLocalizedEnglishText(exactMap[text]);
  return cleanupLocalizedEnglishText(replaceKnownPlaces(text))
    .replace(/剠4\s*/g, "")
    .replace(/^欢迎来到(.+?)[!！。]*$/, (_m, city) => {
      const place = localizePlace(city);
      return target === "EN" ? `Welcome to ${place}!`
        : target === "JA" ? `${place}へようこそ！`
        : target === "KO" ? `${place}에 오신 것을 환영합니다!`
        : `Welcome to ${place}!`;
    })
    .replace(/^(?:到达|抵达)(.+?)$/, (_m, city) => {
      const place = localizePlace(city);
      return target === "EN" ? `Arrive in ${place}`
        : target === "JA" ? `${place}に到着`
        : target === "KO" ? `${place} 도착`
        : `Arrive in ${place}`;
    })
    .replace(/^(.+?)美食与住宿计划$/, (_m, city) => {
      const place = localizePlace(city);
      return target === "EN" ? `${place} Dining & Stay Plan`
        : target === "JA" ? `${place} グルメ＆宿泊プラン`
        : target === "KO" ? `${place} 미식·숙박 플랜`
        : `${place} Dining & Stay Plan`;
    })
    .replace(/^(.+?)美食探索之旅$/, (_m, city) => {
      const place = localizePlace(city);
      return target === "EN" ? `${place} Food Journey`
        : target === "JA" ? `${place} グルメ旅`
        : target === "KO" ? `${place} 미식 여행`
        : `${place} Food Journey`;
    })
    .replace(/^准备好享受(.+?)的美食之旅吧[!！。]*$/, (_m, city) => {
      const place = localizePlace(city);
      return target === "EN" ? `Get ready for a food journey in ${place}!`
        : target === "JA" ? `${place}でグルメ旅を楽しみましょう！`
        : target === "KO" ? `${place}에서 미식 여행을 즐겨보세요!`
        : `Get ready for a food journey in ${place}!`;
    })
    .replace(/^(.+?)餐饮竞争激烈[,，]\s*(.+?)附近餐厅等位.*?(\d{1,2})\s*分钟[,，]\s*建议提前使用大众点评预约。?$/, (_m, city, area, mins) => {
      const place = localizePlace(city);
      const nearby = localizePlace(area);
      return target === "EN" ? place + " dining is busy, and restaurants near " + nearby + " often have waits of about " + mins + " minutes. Booking ahead on Dianping is recommended."
        : target === "JA" ? place + "の飲食は混み合いやすく、" + nearby + "周辺の店は約" + mins + "分待つことがあります。大衆点評での事前予約がおすすめです。"
        : target === "KO" ? place + " 식당은 혼잡한 편이며, " + nearby + " 인근 식당은 약 " + mins + "분 대기할 수 있습니다. Dianping에서 미리 예약하는 것을 권장합니다."
        : place + " dining is busy, and restaurants near " + nearby + " often have waits of about " + mins + " minutes. Booking ahead on Dianping is recommended.";
    })
    .replace(/^(.+?)美食多元[,，]\s*粤式茶楼午市最受欢迎[,，]\s*建议11点前到店或提前预约。?$/, (_m, city) => {
      const place = localizePlace(city);
      return target === "EN" ? place + " has a wide food mix, and Cantonese tea houses are busiest at lunch. Arriving before 11am or booking ahead is recommended."
        : target === "JA" ? place + "は食の選択肢が豊富で、広東式茶楼は昼時が特に混みます。11時前の来店か事前予約がおすすめです。"
        : target === "KO" ? place + "에는 다양한 음식 선택지가 있으며, 광둥식 찻집은 점심 시간대에 가장 붐빕니다. 오전 11시 전 도착하거나 미리 예약하는 것이 좋습니다."
        : place + " has a wide food mix, and Cantonese tea houses are busiest at lunch. Arriving before 11am or booking ahead is recommended.";
    })
    .replace(/^(.+?)美食之都当之无愧[,，].+?餐厅排队.*?(\d{1,2})\s*分钟[,，]\s*火锅需提前预约。?$/, (_m, city, mins) => {
      const place = localizePlace(city);
      return target === "EN" ? place + " earns its food-capital reputation, and popular restaurants often have waits of about " + mins + " minutes. Hotpot spots usually need advance booking."
        : target === "JA" ? place + "は食の都にふさわしく、人気店では約" + mins + "分待つことがあります。火鍋店は事前予約が安心です。"
        : target === "KO" ? place + "는 미식의 도시답게 인기 식당에서 약 " + mins + "분 대기할 수 있습니다. 훠궈집은 미리 예약하는 편이 좋습니다."
        : place + " earns its food-capital reputation, and popular restaurants often have waits of about " + mins + " minutes. Hotpot spots usually need advance booking.";
    })
    .replace(/^(.+?)各景区持续热门[,，]\s*故宫、长城门票需提前7天预订[,，]\s*餐饮高峰期等位.*?(\d{1,2})\s*分钟。?$/, (_m, city, mins) => {
      const place = localizePlace(city);
      return target === "EN" ? place + " remains busy across major sights. Forbidden City and Great Wall tickets should be booked about 7 days ahead, and restaurant peak times can mean waits of around " + mins + " minutes."
        : target === "JA" ? place + "の主要観光地は引き続き混雑しており、故宮と長城のチケットは約7日前予約が安心です。食事のピーク時は約" + mins + "分待つことがあります。"
        : target === "KO" ? place + "의 주요 관광지는 계속 붐비며, 자금성과 만리장성 입장권은 약 7일 전에 예약하는 편이 좋습니다. 식사 피크 시간대에는 약 " + mins + "분 대기할 수 있습니다."
        : place + " remains busy across major sights. Forbidden City and Great Wall tickets should be booked about 7 days ahead, and restaurant peak times can mean waits of around " + mins + " minutes.";
    })
    .replace(/^(.+?)各景区持续热门[,，]\s*Forbidden City、Great Wall门票需提前7天预订[,，]\s*餐饮高峰期等位.*?(\d{1,2})\s*分钟。?$/, (_m, city, mins) => {
      const place = localizePlace(city);
      return target === "EN" ? place + " remains busy across major sights. Forbidden City and Great Wall tickets should be booked about 7 days ahead, and restaurant peak times can mean waits of around " + mins + " minutes."
        : target === "JA" ? place + "の主要観光地は引き続き混雑しており、故宮と長城のチケットは約7日前予約が安心です。食事のピーク時は約" + mins + "分待つことがあります。"
        : target === "KO" ? place + "의 주요 관광지는 계속 붐비며, 자금성과 만리장성 입장권은 약 7일 전에 예약하는 편이 좋습니다. 식사 피크 시간대에는 약 " + mins + "분 대기할 수 있습니다."
        : place + " remains busy across major sights. Forbidden City and Great Wall tickets should be booked about 7 days ahead, and restaurant peak times can mean waits of around " + mins + " minutes.";
    })
    .replace(/^(.+?)美食丰富[,，]\s*建议提前预订热门餐厅。?$/, (_m, city) => {
      const place = localizePlace(city);
      return target === "EN" ? place + " has a rich food scene, and booking popular restaurants in advance is recommended."
        : target === "JA" ? place + "は食の選択肢が豊富で、人気店は事前予約がおすすめです。"
        : target === "KO" ? place + "에는 다양한 맛집이 많아 인기 식당은 미리 예약하는 것이 좋습니다."
        : place + " has a rich food scene, and booking popular restaurants in advance is recommended.";
    })
    .replace(/^(.+?)早茶文化.*?茶楼早市.*?7-10点.*?建议工作日前往避开周末高峰。?$/, (_m, city) => {
      const place = localizePlace(city);
      return target === "EN" ? place + " morning tea culture is busiest from 7am to 10am. Visit on weekdays to avoid the weekend rush."
        : target === "JA" ? place + "の朝茶文化は7時から10時が最も賑わいます。週末の混雑を避けるなら平日訪問がおすすめです。"
        : target === "KO" ? place + "의 아침 딤섬 문화는 오전 7시부터 10시가 가장 붐빕니다. 주말 혼잡을 피하려면 평일 방문이 좋습니다."
        : place + " morning tea culture is busiest from 7am to 10am. Visit on weekdays to avoid the weekend rush.";
    })
    .replace(/^(.+?)景点众多[,，]\s*建议提前预订热门景点。?$/, (_m, city) => {
      const place = localizePlace(city);
      return target === "EN" ? place + " has a dense attraction lineup, and booking the most popular sights in advance is recommended."
        : target === "JA" ? place + "は見どころが多く、人気スポットは事前予約がおすすめです。"
        : target === "KO" ? place + "에는 볼거리가 많아 인기 명소는 미리 예약하는 편이 좋습니다."
        : place + " has a dense attraction lineup, and booking the most popular sights in advance is recommended.";
    });
}

function normalizeLocalizedStructuredPayload(payload, language) {
  const target = String(language || "ZH").toUpperCase();
  if (!payload || target === "ZH") return payload;
  const cloned = JSON.parse(JSON.stringify(payload));
  const walk = (node) => {
    if (typeof node === "string") return normalizeLocalizedCommonText(node, target);
    if (Array.isArray(node)) return node.map((item) => walk(item));
    if (!node || typeof node !== "object") return node;
    for (const key of Object.keys(node)) {
      node[key] = walk(node[key]);
    }
    return node;
  };
  return walk(cloned);
}

function normalizeCozeSpokenText(value, language) {
  const target = String(language || "ZH").toUpperCase();
  const raw = String(value || "");
  if (target === "EN" && /Guangzhou早茶文化浓厉/.test(raw)) {
    return "Guangzhou morning tea culture is busiest from 7am to 10am. Visit on weekdays to avoid the weekend rush.";
  }
  const text = normalizeLocalizedCommonText(raw, language) || raw;
  return normalizeLocalizedCommonText(text, language) || text;
}

async function localizeStructuredPayload(payload, language, apiKey, model, baseUrl, opts = {}) {
  const target = String(language || "ZH").toUpperCase();
  if (!payload) return payload;
  if (target === "ZH") return payload;
  if (!requiresContentLocalization(target, payload)) return normalizeLocalizedStructuredPayload(payload, target);
  const preferNormalizationOnly = Boolean(opts && opts.preferNormalizationOnly);
  if (!apiKey || preferNormalizationOnly) return normalizeLocalizedStructuredPayload(payload, target);
  const langName = {
    EN: "English",
    JA: "Japanese",
    KO: "Korean",
    ID: "Indonesian",
    AR: "Arabic",
  }[target];
  if (!langName) return payload;

  const entries = collectLocalizedEntries(payload);
  if (!entries.length) return payload;
  if (entries.length > 120 || payload?.card_data?._dataQuality === "fallback") return normalizeLocalizedStructuredPayload(payload, target);
  const translationMap = {};
  entries.forEach((entry, idx) => { translationMap[String(idx)] = entry.value; });
  try {
    const translated = await openAIRequest({
      apiKey,
      model,
      baseUrl,
      systemPrompt: [
        `Translate each JSON string value to ${langName}.`,
        "Return a JSON object with the exact same keys and translated string values only.",
        "Do not add or remove keys. Do not invent data.",
        "Keep prices, times, IDs, codes, and URLs unchanged.",
        "Translate all user-facing values, including activity types, meal labels, review snippets, and hotel/place names.",
        "For Chinese place names or merchant names, prefer the established English/Japanese/Korean name; if none exists, use pinyin/romanized Latin text instead of keeping Chinese characters.",
      ].join(" "),
      userContent: JSON.stringify(translationMap),
      temperature: 0.1,
      maxTokens: Math.min(5000, Math.max(1000, entries.length * 70)),
      jsonMode: true,
      timeoutMs: 8000,
    });
    const parsed = safeParseJson(translated.text);
    if (!parsed || typeof parsed !== "object") return payload;
    const cloned = JSON.parse(JSON.stringify(payload));
    entries.forEach((entry, idx) => {
      const translatedValue = parsed[String(idx)];
      if (typeof translatedValue === "string" && translatedValue.trim()) {
        assignLocalizedValue(cloned, entry.trail, translatedValue);
      }
    });
    return normalizeLocalizedStructuredPayload(cloned, target);
  } catch (err) {
    console.warn("[plan/i18n] structured localization failed:", sanitizeOperationalError(err, "plan_localization_failed"));
    return normalizeLocalizedStructuredPayload(payload, target);
  }
}

async function buildLiveIntercityTransport({
  originCity,
  destinationCity,
  date,
  language,
  pickLang,
  queryJuheFlight,
  queryRailAvailability,
  mockAmapRouting,
}) {
  const from = cleanTransportCityCandidate(originCity);
  const to = cleanTransportCityCandidate(destinationCity);
  if (!from || !to || from === to) return null;

  const [flightData, routeData, railData] = await Promise.all([
    Promise.race([
      Promise.resolve(queryJuheFlight ? queryJuheFlight(from, to, date || undefined) : null).catch(() => null),
      new Promise((resolve) => setTimeout(() => resolve(null), DETAIL_ENRICH_TIMEOUT_MS)),
    ]),
    Promise.race([
      Promise.resolve(mockAmapRouting ? mockAmapRouting(from, to) : null).catch(() => null),
      new Promise((resolve) => setTimeout(() => resolve(null), 7000)),
    ]),
    Promise.race([
      Promise.resolve(queryRailAvailability ? queryRailAvailability({ origin: from, destination: to, date: date || undefined, language }) : null).catch(() => null),
      new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
    ]),
  ]);

  const routeModesRaw = Array.isArray(routeData?.modes) ? routeData.modes : [];
  const localizedFlights = localizeFlightRecords(flightData?.flights || [], language);
  const bestFlight = pickBestFlightCandidate(localizedFlights) || null;
  const flightAvailability = flightData?.availability || null;
  const liveFlightSource = bestFlight ? (flightData?.source || "live") : "none";
  const defaultFlightLabel = liveFlightSource === "ctrip_live"
    ? pickLang(language, "携程航班", "Ctrip flight", "Ctrip便", "Ctrip 항공편")
    : pickLang(language, "航班", "Flight", "フライト", "항공편");
  const flightMode = bestFlight ? {
    type: "flight",
    label: `${bestFlight.airline || defaultFlightLabel} ${bestFlight.flightNo || ""}`.trim(),
    flight_no: bestFlight.flightNo || "",
    airline: bestFlight.airline || "",
    dep_time: bestFlight.depTime || "",
    arr_time: bestFlight.arrTime || "",
    duration_min: parseDurationMinutes(bestFlight.duration),
    price_cny: Number(bestFlight.price || 0) || null,
    stops: Number(bestFlight.stops || 0),
    source: liveFlightSource,
  } : null;

  const liveRailRows = Array.isArray(railData?.items) ? railData.items.filter(Boolean) : [];
  const liveRailInventorySource = String(railData?.inventorySource || railData?.providerSource || "partner_hub_rail_live");
  const liveRailOptions = liveRailRows
    .map((item) => {
      const type = /hsr/i.test(String(item?.type || "")) ? "hsr" : "train";
      const seatsLeft = Number(item?.seatsLeft || 0) || 0;
      return {
        type,
        label: String(item?.label || item?.trainNo || "").trim() || localizeRouteModeLabel({ type }, language, pickLang),
        duration_min: Number(item?.durationMin || item?.duration_min || 0) || null,
        price_cny: Number(item?.priceCny || item?.price_cny || item?.price || 0) || null,
        freq: seatsLeft > 0
          ? pickLang(language, `${seatsLeft}张余票`, `${seatsLeft} seat(s) left`, `残席${seatsLeft}`, `잔여 ${seatsLeft}석`)
          : pickLang(language, "余票紧张", "Seats running low", "残席わずか", "잔여 좌석 적음"),
        source: String(item?.providerSource || railData?.providerSource || liveRailInventorySource),
        live: true,
        inventory_status: "live_or_verified",
        verification_required: false,
        verification_label: "",
        seat_label: String(item?.seatLabel || item?.seat_label || "").trim(),
        train_no: String(item?.trainNo || item?.train_no || "").trim(),
        from_station: localizeStationText(item?.fromStation || item?.from_station || from, language),
        to_station: localizeStationText(item?.toStation || item?.to_station || to, language),
        dep_time: String(item?.depTime || item?.dep_time || "").trim(),
        arr_time: String(item?.arrTime || item?.arr_time || "").trim(),
        bookingUrl: String(item?.bookingUrl || item?.url || "").trim() || buildCanonicalRailDeeplink(from, to, date || ""),
      };
    })
    .filter((mode) => mode.label);

  const routeOptions = routeModesRaw
    .filter((mode) => !(flightMode && mode.type === "flight"))
    .map((mode) => {
      const type = mode.type || "route";
      const isRail = type === "hsr" || type === "train";
      return {
        type,
        label: localizeRouteModeLabel(mode, language, pickLang),
        duration_min: Number(mode.duration_min || 0) || null,
        price_cny: Number(mode.price_cny || 0) || null,
        freq: localizeRouteFreq(mode.freq, language),
        source: mode._source || routeData?._source || "route",
        inventory_status: isRail ? "user_check_required" : "estimated",
        verification_required: isRail,
        verification_label: isRail
          ? pickLang(language, "需去12306自行核验余票", "Check seats on 12306 yourself", "12306で空席を要確認", "12306에서 좌석 직접 확인")
          : "",
        from_station: localizeStationText(mode.from_station || "", language),
        to_station: localizeStationText(mode.to_station || "", language),
        bookingUrl: isRail ? buildCanonicalRailDeeplink(from, to, date || "") : String(mode.bookingUrl || "").trim(),
      };
    });

  const mergedOptions = flightMode ? [flightMode, ...liveRailOptions, ...routeOptions] : [...liveRailOptions, ...routeOptions];
  if (!mergedOptions.length) return null;

  const chosen = flightMode
    || mergedOptions.find((mode) => mode.type === routeData?.recommended)
    || mergedOptions[0];

  const detailParts = [];
  if (chosen.dep_time || chosen.arr_time) {
    detailParts.push([chosen.dep_time, chosen.arr_time].filter(Boolean).join(" → "));
  }
  if (chosen.duration_min) detailParts.push(formatMinutesLabel(chosen.duration_min));
  if (chosen.stops > 0) {
    detailParts.push(pickLang(
      language,
      `${chosen.stops}次中转`,
      `${chosen.stops} stop${chosen.stops > 1 ? "s" : ""}`,
      `${chosen.stops}回乗継`,
      `${chosen.stops}회 경유`
    ));
  }
  if (!detailParts.length && routeData?.note) detailParts.push(localizeRouteNote(routeData.note, language, pickLang));

  const chosenInventoryStatus = chosen.inventory_status
    || (chosen.type === "flight" && flightMode ? "live_or_verified" : ((chosen.type === "hsr" || chosen.type === "train") ? "user_check_required" : "estimated"));
  const chosenVerificationRequired = Boolean(chosen.verification_required || ((chosen.type === "hsr" || chosen.type === "train") && chosenInventoryStatus !== "live_or_verified"));
  const chosenVerificationLabel = chosenVerificationRequired
    ? (chosen.verification_label || pickLang(language, "需去12306自行核验余票", "Check seats on 12306 yourself", "12306で空席を要確認", "12306에서 좌석 직접 확인"))
    : "";
  const tip = chosen.type === "hsr" || chosen.type === "train"
    ? (chosenInventoryStatus === "live_or_verified"
      ? pickLang(language, "高铁余票来自实时座席源。", "High-speed rail seats come from a live inventory source.", "新幹線の空席はリアルタイム在庫です。", "고속철 좌석은 실시간 재고 기준입니다.")
      : pickLang(language, "当前高铁为路线建议，需去12306自行核验余票。", "Rail is currently shown as a route suggestion. Check seats on 12306 yourself.", "鉄道は現在ルート提案です。12306で空席をご確認ください。", "철도는 현재 경로 제안입니다. 12306에서 좌석을 직접 확인하세요."))
    : buildTransportSourceTip(language, pickLang, flightMode ? liveFlightSource : "none", routeData?._source || "fallback");

  return {
    from,
    to,
    mode: chosen.type || "flight",
    label: chosen.label || "",
    duration_min: chosen.duration_min || null,
    cost_cny: Number(chosen.price_cny || 0) || null,
    detail: detailParts.join(" · "),
    tip,
    inventory_status: chosenInventoryStatus,
    verification_required: chosenVerificationRequired,
    verification_label: chosenVerificationLabel,
    flight_status: flightMode
      ? { status: "live", code: "ok", reason: "ok" }
      : (flightAvailability || { status: "unavailable", code: "none", reason: "Flight source unavailable" }),
    flight_status_hint: flightMode ? "" : buildFlightAvailabilityHint(language, pickLang, flightAvailability),
    route_options: mergedOptions,
    source: {
      flight: flightMode ? liveFlightSource : "none",
      rail: liveRailOptions.length ? liveRailInventorySource : "none",
      route: routeData?._source || "fallback",
    },
  };
}

/**
 * Conversational clarification via LLM — natural question instead of hardcoded text.
 * Falls back to hardcoded text if LLM fails or times out.
 * @param {string} apiKey
 * @param {string} model
 * @param {string} baseUrl
 * @param {string} effectiveMessage
 * @param {Array}  missingSlots
 * @param {string} language
 * @returns {Promise<string>}
 */
async function buildConversationalClarify(apiKey, model, baseUrl, effectiveMessage, missingSlots, language) {
  if (!apiKey) return null;

  // Per-language slot labels for user-visible text in the fallback prompt
  const SLOT_LABELS = {
    ZH: { destination: "\u76ee\u7684\u5730\u57ce\u5e02", duration: "\u884c\u7a0b\u5929\u6570",   budget: "\u9884\u7b97" },
    EN: { destination: "destination city",               duration: "trip duration",               budget: "budget" },
    JA: { destination: "\u76ee\u7684\u5730",             duration: "\u65c5\u884c\u65e5\u6570",   budget: "\u4e88\u7b97" },
    KO: { destination: "\ubaa9\uc801\uc9c0",             duration: "\uc5ec\ud589 \uc77c\uc218",  budget: "\uc608\uc0b0" },
  };
  const labels = SLOT_LABELS[language] || SLOT_LABELS.EN;
  const slotsText = missingSlots.map((s) => labels[s] || s).join(language === "ZH" ? "\u3001" : ", ");

  const LANG_NAMES = { ZH: "Simplified Chinese", EN: "English", JA: "Japanese", KO: "Korean", ID: "Indonesian", AR: "Arabic" };
  const langName = LANG_NAMES[language] || "English";

  try {
    const r = await openAIRequest({
      apiKey, model, baseUrl,
      systemPrompt: `You are CrossX travel AI. A user sent an incomplete travel request. Ask ONE short clarifying question in ${langName}. Missing: ${missingSlots.join(", ")}. Keep it under 20 words. No preamble. CRITICAL: Your response MUST be in ${langName} only.`,
      userContent: `User said: ${effectiveMessage}\nMissing info: ${slotsText}`,
      temperature: 0.7, maxTokens: 60, jsonMode: false, timeoutMs: 3000,
    });
    if (r.ok && r.text) return r.text.trim().replace(/^["']|["']$/g, "");
  } catch (e) {
    console.warn("[clarify-llm] Timeout/error — using hardcoded fallback:", sanitizeOperationalError(e, "clarify_failed"));
  }
  return null;
}

// ── Factory ────────────────────────────────────────────────────────────────────
/**
 * Inject server.js-level utilities and live config values.
 * Call once at startup; returns { handleCoze, handleDetail }.
 *
 * @param {object} deps
 * @param {function} deps.readBody
 * @param {function} deps.writeJson
 * @param {function} deps.normalizeLang
 * @param {function} deps.pickLang
 * @param {object}   deps.db
 * @param {function} deps.getOpenAIConfig   () => { apiKey, model, keyHealth }
 * @param {function} deps.detectQuickActionIntent
 * @param {function} deps.buildQuickActionResponse
 * @param {function} deps.detectCasualChatIntent
 * @param {function} deps.callCasualChat
 * @param {function} deps.classifyBookingIntent
 * @param {function} deps.callPythonRagService
 * @param {function} deps.searchAttractions
 * @param {object}   deps.ragEngine          { retrieveAndGenerate }
 * @param {Map}      deps.sessionItinerary   (legacy IP-keyed context map)
 * @param {function} deps.extractAgentConstraints
 */
// createPlanRouter is the request-level orchestrator for planning APIs.
// It does not own low-level server bootstrapping (server.js) and it does not
// own the actual plan-generation model stages (planner/pipeline.js).
// Its job is the middle layer:
// - validate and scrub inbound request data
// - enforce rate limits, abuse checks, and prompt-injection hard stops
// - recover and update lightweight session/conversation context
// - choose fast paths vs full planning flow
// - stream the resulting events back through SSE
function createPlanRouter({
  readBody, writeJson, normalizeLang, pickLang, db,
  getOpenAIConfig,
  callCozeWorkflow,
  detectQuickActionIntent, buildQuickActionResponse,
  detectCasualChatIntent, callCasualChat,
  classifyBookingIntent, callPythonRagService, searchAttractions,
  ragEngine, sessionItinerary, extractAgentConstraints,
  // Agent loop deps (Module 2 tools)
  queryAmapHotels, queryJuheFlight, queryRailAvailability, queryHotelCatalog, mockAmapRouting, mockCtripHotels, buildAIEnrichment,
}) {

  // ── POST /api/plan/coze — OpenAI Planning Pipeline (SSE) ──────────────────
  // P0: Coze race abolished, OpenAI only, no thinking panel.
  // P1: PII scrub → looksLikeUpdate routing → session save → safety hard-stop.
  // Main planning entrypoint used by the consumer web app. The function is long
  // because it is effectively the protocol adapter between the HTTP request,
  // session state, model orchestration, and SSE event stream seen by the browser.
  async function handleCoze(req, res) {
    const body = await readBody(req);
    const language = normalizeLang(body.language || body.lang || DEFAULT_LANG);

    // [S3] PII scrub: strip phone/email/ID/card BEFORE any LLM call or session write
    const rawMessage = String(body.message || "").trim();
    if (!rawMessage) return writeJson(res, 400, { error: "message required" });
    if (rawMessage.length > 4000) return writeJson(res, 400, { error: "Message too long (max 4000 chars)" });
    const message = scrubPii(rawMessage);

    // ── [S2] Rate limiting — runs before session/LLM to prevent resource exhaustion ──
    const _rlKey = String(body.deviceId || req.socket?.remoteAddress || "anon").slice(0, 64);
    const rateLimit = checkPlanRateLimit(_rlKey);
    if (rateLimit.allowed === false) {
      console.warn("[plan/coze] Rate limited:", `count_${Number(rateLimit.count || RL_MAX_HITS)}`);
      return writeJson(res, 429, {
        error: "Too many requests. Please wait a moment.",
        retryAfterMs: rateLimit.retryAfterMs,
      });
    }

    // ── [CT-09] Anti-fraud hourly anomaly detection ────────────────────────
    const _fraudResult = checkAntiFraud(_rlKey);
    if (_fraudResult.blocked) {
      console.warn("[plan/coze] Anti-fraud BLOCK: suspicious high volume", { count: _fraudResult.count });
      return writeJson(res, 429, { error: "Unusual request volume detected. Please try again later." });
    }
    if (_fraudResult.suspicious) {
      console.warn("[plan/coze] Anti-fraud WARN: elevated request rate", { count: _fraudResult.count });
    }

    // ── [Input Guard] Prompt injection / off-topic hard-stop ─────────────────
    // O(1) — runs BEFORE session lookup, RAG, or any LLM call. Zero tokens.
    if (isInjectionAttack(message)) {
      console.log("[plan/coze] Input-guard triggered — injection attempt blocked");
      res.writeHead(200, {
        "Content-Type":      "text/event-stream",
        "Cache-Control":     "no-cache",
        "Connection":        "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.write(`data: ${JSON.stringify({
        type:          "final",
        response_type: "boundary_rejection",
        spoken_text:   pickLang(
          language,
          "抱歉，我是专注于旅行规划的 AI 助手，无法处理此类请求。如果您有旅行计划需要帮助，我很乐意为您安排！",
          "Sorry, I focus on travel planning and cannot help with that request. If you need help with a trip, I can arrange it.",
          "申し訳ありませんが、私は旅行計画に特化した AI アシスタントのため、そのご依頼には対応できません。旅行のご相談であればお手伝いできます。",
          "죄송하지만 저는 여행 계획에 특화된 AI 도우미라 해당 요청은 처리할 수 없습니다. 여행 계획이 필요하시면 도와드릴 수 있습니다."
        ),
        source:        "input-guard",
      })}\n\n`);
      res.end();
      return;
    }

    const { apiKey: OPENAI_API_KEY, model: OPENAI_MODEL, keyHealth: OPENAI_KEY_HEALTH, baseUrl: OPENAI_BASE_URL } = getOpenAIConfig();
    console.log("[plan/coze] language detected:", String(language || DEFAULT_LANG));
    const cityRaw         = String(body.city || "");
    const city            = cityRaw.split("·")[0].trim() || (console.warn("[plan/coze] city missing — defaulting to Shanghai"), DEFAULT_CITY);
    const constraints     = body.constraints && typeof body.constraints === "object" ? body.constraints : {};
    const _rawHistory = Array.isArray(body.conversationHistory) ? body.conversationHistory : [];
    const conversationHistory = _rawHistory.filter((m) => m && typeof m.role === "string" && typeof m.content === "string");
    if (_rawHistory.length > 0 && conversationHistory.length === 0) {
      console.warn("[plan/coze] conversationHistory had", _rawHistory.length, "items but all failed validation — context lost");
    }

    // [C4] Cross-session preference profile — keyed by deviceId from client localStorage
    const _RAW_DID = String(body.deviceId || "").trim();
    const deviceId = DEVICE_ID_RE.test(_RAW_DID) ? _RAW_DID : null;
    if (body.deviceId && !deviceId) console.warn("[plan] invalid deviceId format ignored:", "invalid_device_id");
    const userProfile = deviceId ? loadProfile(deviceId) : null;

    // [P1] Session: resolve incoming sessionId and load existing data (if any)
    // getSessionForDevice enforces device ownership — returns null on mismatch
    const incomingSessionId = String(body.sessionId || "").trim();
    const existingSession   = incomingSessionId ? getSessionForDevice(incomingSessionId, deviceId) : null;
    if (userProfile) console.log("[profile] loaded preference profile");

    // [Context] Restore stored preferences + history; merge with browser state
    // Layer order (lowest → highest priority): profile → session → incoming turn
    const storedPrefs   = mergePreferences(userProfile?.preferences || {}, existingSession?.preferences || {});
    const storedHistory = Array.isArray(existingSession?.history) ? existingSession.history : [];
    // mergedHistory: prefer stored (server-side) + any extra turns from browser not yet persisted
    const mergedHistory = pruneHistory([...storedHistory, ...conversationHistory
      .filter((m) => !storedHistory.some((s) => s.content === m.content && s.role === m.role))], 12);

    // P2-B: Concurrency semaphore — reject if too many active plan streams
    if (!_sseAcquire()) {
      return writeJson(res, 503, { error: "Server busy. Please try again in a moment.", retryAfter: 10 });
    }

    // P1-C: AbortController + semaphore guard — registered BEFORE writeHead to eliminate
    // the race window where a fast disconnect fires before the listener is attached
    const _abortCtrl = new AbortController();
    const _abortSignal = _abortCtrl.signal;
    let _semReleased = false;
    let _semLeakTimer = null;
    const _releaseSem = () => {
      if (!_semReleased) {
        _semReleased = true;
        _sseRelease();
        if (_semLeakTimer) { clearTimeout(_semLeakTimer); _semLeakTimer = null; }
      }
    };
    res.on("finish", _releaseSem); // normal path: res.end() flushes → finish fires
    res.on("close", _releaseSem); // defensive: some SSE client disconnect paths skip finish
    req.on("close", () => {
      _releaseSem();               // early disconnect: release before or after writeHead
      if (!_abortCtrl.signal.aborted) {
        _abortCtrl.abort();
        console.log("[plan/coze] Client disconnected — aborting backend processing");
      }
    });
    // Safety valve: force-release semaphore after 120s to prevent permanent leaks
    _semLeakTimer = setTimeout(() => {
      if (!_semReleased) {
        console.warn("[plan/coze] SSE semaphore leak detected — force releasing after 120s");
        _releaseSem();
        if (!_abortCtrl.signal.aborted) _abortCtrl.abort();
        try { res.end(); } catch { /* already closed */ }
      }
    }, 120_000);

    // SSE headers — sent after listeners are registered so close event is never missed
    res.writeHead(200, {
      "Content-Type":      "text/event-stream",
      "Cache-Control":     "no-cache",
      "Connection":        "keep-alive",
      "X-Accel-Buffering": "no",
    });

    let _emitDead = false;
    const emit  = (data) => {
      if (_emitDead || _abortSignal.aborted) return;
      try { res.write(`data: ${JSON.stringify(data)}\n\n`); }
      catch (e) { _emitDead = true; console.warn("[plan/coze] SSE write failed — client likely disconnected:", sanitizeOperationalError(e, "sse_write_failed")); }
    };
    const delay = (ms) => new Promise((r, reject) => {
      const t = setTimeout(r, ms);
      _abortSignal.addEventListener("abort", () => { clearTimeout(t); reject(new Error("aborted")); }, { once: true });
    });

    // ── QUICK ACTION bypass ─────────────────────────────────────────────────
    const quickAction = detectQuickActionIntent(message);
    if (quickAction) {
      emit({ type: "status", code: "INIT", label: pickLang(language,
        "即时服务处理中...", "Quick action processing...",
        "クイックアクション处理中...", "즉시 서비스 처리 중...") });
      await delay(200);
      const qaResponse = await buildQuickActionResponse(quickAction, message, language, city);
      emit({ type: "final", ...qaResponse, source: "quick_action" });
      res.end();
      return;
    }

    // ── CASUAL CHAT bypass ──────────────────────────────────────────────────
    if (detectCasualChatIntent(message)) {
      emit({ type: "status", code: "INIT", label: pickLang(language,
        "正在理解您的问题...", "Understanding your question...",
        "ご質問を理解中...", "질문을 이해하는 중...") });
      await delay(150);
      const chatText = await callCasualChat({ message, language, city, history: mergedHistory });
      emit({ type: "final", response_type: "chat", spoken_text: chatText, source: "chat" });
      res.end();
      return;
    }

    // ── RAG intent → knowledge base path ───────────────────────────────────
    const intent = classifyBookingIntent(message, constraints);
    if (intent === "rag") {
      emit({ type: "status", code: "INIT", label: pickLang(language,
        "正在查询知识库...", "Querying knowledge base...",
        "知識ベースを照会中...", "지식 베이스 조회 중...") });
      await delay(300);

      let ragAnswer = null;
      let ragSource = "fallback";
      const clientIpRag = deviceId || req.socket?.remoteAddress || req.connection?.remoteAddress || "default";

      // 1. Python RAG service (Sichuan ChromaDB)
      const pythonRag = await callPythonRagService(message, `crossx-${Date.now()}`);
      if (pythonRag && pythonRag.answer) {
        ragAnswer = pythonRag.answer;
        ragSource = "python-rag";
        console.log("[plan/coze/rag] Using Python RAG service");
      }

      // 2. Local Sichuan attraction KB search
      if (!ragAnswer) {
        const sightKw = message.replace(/[？?]/g, "").trim();
        const localAttractions = searchAttractions({ city, keyword: sightKw, limit: 4 });
        if (localAttractions.length) {
          const ctxText = localAttractions.map((a, i) =>
            `${i + 1}. ${a.name}（${a.city}，评分${a.rating}）\n地址：${a.address}\n开放：${a.hours || "请查官方"}\n门票：${a.ticket || "请查官方"}\n建议游玩：${a.visit_time || ""}\n简介：${a.intro}`
          ).join("\n\n");

          if (OPENAI_API_KEY) {
            const r = await openAIRequest({
              apiKey: OPENAI_API_KEY, model: OPENAI_MODEL,
              systemPrompt: `你是四川旅游顾问，根据下方景点资料回答问题（中文，简洁）：\n\n${ctxText}`,
              userContent: message,
              temperature: 0.3, maxTokens: 500, timeoutMs: 12000,
            });
            if (r.ok && r.text) { ragAnswer = r.text; ragSource = "local-kb+openai"; }
          }

          if (!ragAnswer) {
            ragAnswer = `根据景点数据库找到以下相关景点：\n\n${localAttractions.slice(0, 3).map((a) => {
              const hours  = String(a.hours  || "请查询官方").trim() || "请查询官方";
              const ticket = String(a.ticket || "请查询门票").trim() || "请查询门票";
              const intro  = (a.intro ? String(a.intro) : "暂无介绍").slice(0, 100);
              const rating = Number.isFinite(a.rating) ? `，⭐${a.rating}` : "";
              return `📍 **${a.name}**（${a.city}${rating}）\n🕐 ${hours}\n🎟 ${ticket}\n📝 ${intro}`;
            }).join("\n\n")}`;
            ragSource = "local-kb";
          }
        }
      }

      // 3. CrossX general RAG engine — capped at 12s to prevent SSE hang
      if (!ragAnswer && OPENAI_API_KEY) {
        try {
          const prevItin = sessionItinerary.get(clientIpRag);
          const itinCtx  = prevItin && (Date.now() - prevItin.storedAt < 7200000)
            ? `\n\n[已生成的行程方案参考]:\n${JSON.stringify(prevItin.card_data, null, 2).slice(0, 1800)}`
            : "";
          const _ragTimeout = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("RAG timeout")), 12000));
          const ragResult = await Promise.race([
            ragEngine.retrieveAndGenerate({
              query: message + itinCtx, audience: "b2c", language,
              openaiApiKey: OPENAI_API_KEY, topK: 4,
            }),
            _ragTimeout,
          ]);
          if (ragResult.ragUsed && ragResult.answer) {
            ragAnswer = ragResult.answer;
            ragSource = "crossx-rag";
          }
        } catch (e) { console.warn("[plan/coze/rag]", sanitizeOperationalError(e, "plan_rag_failed")); }
      }

      // 4. LLM chat with session context as last resort
      if (!ragAnswer) {
        try {
          const prevItin = sessionItinerary.get(clientIpRag);
          const itinCtx  = prevItin && (Date.now() - prevItin.storedAt < 7200000)
            ? `\n\n[用户已生成行程供参考，目的地: ${prevItin.dest || ""}]:\n${JSON.stringify(prevItin.card_data, null, 2).slice(0, 1200)}`
            : "";
          const chatRes = await callCasualChat({ message: message + itinCtx, language, city, history: mergedHistory });
          ragAnswer = chatRes?.ok ? chatRes.text : (typeof chatRes === "string" ? chatRes : null);
          if (ragAnswer) ragSource = "openai-chat";
        } catch (e) { console.warn("[plan/coze/rag/fallback]", sanitizeOperationalError(e, "plan_rag_fallback_failed")); }
      }

      emit({
        type: "final",
        response_type: "text",
        text: ragAnswer || pickLang(language,
          "您好！请告诉我您的行程需求，我来帮您安排。",
          "Hi! Tell me your travel plans and I'll help arrange everything.",
          "こんにちは！旅行計画を教えてください。お手伝いします。",
          "안녕하세요! 여행 계획을 말씀해 주세요, 도와드리겠습니다.",
        ),
        source: ragSource,
      });
      res.end();
      return;
    }

    // ── [P1] UPDATE PATH — patch existing plan (no full regeneration) ─────────
    // Condition: message looks like a modification AND session contains a saved plan.
    // Graceful degradation: if session is missing/expired, fall through to full gen.
    const isUpdate = looksLikeUpdate(message) && Boolean(existingSession?.plan);
    if (isUpdate) {
      console.log("[plan/coze] UPDATE intent detected — patching existing session");
      emit({ type: "status", code: "INIT", label: pickLang(language,
        "正在修改方案...", "Updating your plan...",
        "プランを修正中...", "플랜 수정 중...") });

      try {
        const patchResult = await applyPlanPatch({
          message,
          existingPlan: existingSession.plan,
          language,
          apiKey: OPENAI_API_KEY,
          model:  OPENAI_MODEL,
        });

        if (patchResult.ok) {
          // UPDATE path fix: also persist preferences + history so context survives
          const updateHistory = pruneHistory([...storedHistory, { role: "user", content: message }], 12);
          patchSession(incomingSessionId, {
            plan: patchResult.patched, message, language, city,
            preferences: storedPrefs,
            history: updateHistory,
          });
          // Record turns for multi-turn context (addTurn reads from session — must call after patchSession)
          try { addTurn(incomingSessionId, { role: "user", content: message }); } catch (_e) { console.warn("[plan] addTurn failed:", sanitizeOperationalError(_e, "conversation_append_failed")); }
          if (patchResult.spokenText) {
            try { addTurn(incomingSessionId, { role: "assistant", content: patchResult.spokenText }); } catch (_e) { console.warn("[plan] addTurn failed:", sanitizeOperationalError(_e, "conversation_append_failed")); }
          }
          emit({
            type: "final",
            response_type: "options_card",
            card_data:    patchResult.patched,
            spoken_text:  patchResult.spokenText,
            source:       "openai-patch",
            sessionId:    incomingSessionId,
          });
        } else {
          emit({
            type: "final",
            response_type: "clarify",
            spoken_text:  patchResult.spokenText,
            missing_slots: [],
            source:       "patch-failed",
            sessionId:    incomingSessionId,
          });
        }
      } catch (e) {
        console.warn("[plan/coze] UPDATE path error:", sanitizeOperationalError(e, "plan_update_failed"));
        emit({ type: "error", msg: pickLang(language,
          "修改方案时遇到问题，请重试。",
          "Failed to update the plan. Please retry.",
          "プランの修正に失敗しました。",
          "플랜 수정에 실패했습니다.",
        ) });
      }

      res.end();
      return;
    }

    // ── FULL GENERATION PATH — OpenAI only (Coze abolished) ──────────────────
    emit({ type: "status", code: "INIT", label: pickLang(language,
      "正在生成方案...", "Generating your plan...",
      "プランを生成中...", "플랜을 생성하는 중...") });

    let planDone = false;
    const clientIp = req.socket?.remoteAddress || req.connection?.remoteAddress || "default";

    // Stage progress timer — visual feedback while OpenAI runs (~20-40s)
    (async () => {
      const cd = (ms) => new Promise((r) => {
        let check; // declared before setTimeout so the closure always captures it
        const t = setTimeout(() => { clearInterval(check); r(); }, ms);
        check = setInterval(() => {
          if (planDone) { clearTimeout(t); clearInterval(check); r(); }
        }, 300);
      });
      await cd(2500);
      if (!planDone) emit({ type: "status", code: "H_SEARCH", label: pickLang(language,
        "正在匹配酒店...", "Searching hotels...", "ホテルを検索中...", "호텔 검색 중...") });
      await cd(12000);
      if (!planDone) emit({ type: "status", code: "H_SEARCH", label: pickLang(language,
        "酒店方案分析中...", "Analyzing hotel options...", "ホテル案を分析中...", "호텔 옵션 분석 중...") });
      await cd(12000);
      if (!planDone) emit({ type: "status", code: "T_CALC",   label: pickLang(language,
        "正在核算交通费用...", "Calculating transport costs...", "交通費を計算中...", "교통비 계산 중...") });
      await cd(10000);
      if (!planDone) emit({ type: "status", code: "B_CHECK",  label: pickLang(language,
        "正在校验预算...", "Verifying budget...", "予算を確認中...", "예산 확인 중...") });
    })();

    const complex = isComplexItinerary(message);
    if (complex) console.log("[plan/coze] Complex itinerary — using full Planner LLM");

    // Normalise budget to a numeric string for enrichment calls (callCozeWorkflow, agent tools)
    // Clamp to a sane range (100 – 500000 CNY) to prevent extreme values reaching the LLM.
    if (constraints.budget) {
      const _b = Number(String(constraints.budget).replace(/[^0-9]/g, ""));
      if (!Number.isFinite(_b) || _b < 100 || _b > 500000) {
        console.warn("[plan/coze] budget out of range — ignored:", constraints.budget);
        delete constraints.budget;
      }
    }
    const budgetVal = constraints.budget
      ? String(constraints.budget).replace(/[^0-9]/g, "")
      : "";

    try {
      if (!(OPENAI_API_KEY && OPENAI_KEY_HEALTH.looksValid)) {
        throw new Error("plan_provider_unavailable");
      }

      // P8.10: Merge slot-fill answer with original message from pendingClarify
      let effectiveMessage = message;
      const _pc = existingSession?.pendingClarify;
      if (_pc?.originalMessage) {
        effectiveMessage = `${_pc.originalMessage} ${message}`.trim();
        patchSession(incomingSessionId, { pendingClarify: null });
        console.log("[plan/coze] Slot-fill merge applied");
      }

      // Discovery second-turn merge — MUST happen before gate + intentAxis detection
      // so that merged message carries city/food keywords from the original turn.
      // didDiscoveryMerge flag prevents re-triggering needsDiscovery on the merged text.
      let didDiscoveryMerge = false;
      if (existingSession?.pendingDiscovery && existingSession?.originalMessage) {
        const priorMsg = existingSession.originalMessage;
        effectiveMessage = `${priorMsg} ${effectiveMessage}`.trim();
        patchSession(incomingSessionId, { pendingDiscovery: false });
        didDiscoveryMerge = true;
        console.log("[plan/coze] Discovery merge applied");
      }

      // B1+C3: Detect intent axis + extract preferences via LLM (single call).
      // Falls back to regex on timeout/error. Extracts axis, destination, duration,
      // pax, and user preference flags (has_children, pace_slow, etc.) simultaneously.
      const intentResult = await detectIntentLLM(effectiveMessage, {
        apiKey: OPENAI_API_KEY, model: OPENAI_MODEL, baseUrl: OPENAI_BASE_URL,
      });
      const heuristicAxis = detectIntentAxis(effectiveMessage);
      let intentAxis = intentResult.axis;
      if (intentAxis === "travel" && heuristicAxis !== "travel") {
        intentAxis = heuristicAxis;
        intentResult.axis = heuristicAxis;
        console.log(`[plan/coze] Intent axis corrected locally: ${heuristicAxis}`);
      }
      if (intentAxis !== "travel") console.log("[plan/coze] Specialty mode detected");

      // Intent preview: let frontend show what AI understood before plan generates
      if (intentResult._source === "llm" && (intentResult.destination || intentResult.duration_days)) {
        emit({
          type: "intent_preview",
          dest: intentResult.destination || null,
          days: intentResult.duration_days || null,
          axis: intentAxis,
          pax:  intentResult.pax > 1 ? intentResult.pax : null,
        });
      }

      // Merge LLM-extracted params into constraints (without overwriting explicit user values)
      // Validate each field before merging to prevent garbage values entering the pipeline
      if (intentResult.destination && !constraints.destination) {
        const _dest = String(intentResult.destination).replace(/[<>"'`\n\r]/g, "").trim();
        if (_dest.length > 0 && _dest.length <= 50) constraints.destination = _dest;
      }
      if (intentResult.duration_days && !constraints.duration) {
        const _days = Number(intentResult.duration_days);
        if (Number.isInteger(_days) && _days >= 1 && _days <= 365) constraints.duration = _days;
      }
      if (intentResult.pax > 2 && !constraints.pax) {
        const _pax = Number(intentResult.pax);
        if (Number.isInteger(_pax) && _pax >= 1 && _pax <= 50) constraints.pax = _pax;
      }
      if (intentResult.special_needs?.length) constraints._specialNeeds = intentResult.special_needs;
      const planningCity = String(constraints.destination || intentResult.destination || city || "").split("·")[0].trim() || city;
      constraints.city = planningCity;
      constraints.destination = planningCity;

      // C3: Use LLM-extracted preferences when available; fallback to regex.
      const incomingPrefs = (intentResult._source === "llm" && Object.keys(intentResult.preferences || {}).length)
        ? intentResult.preferences
        : extractPreferences(effectiveMessage);
      const mergedPrefs   = mergePreferences(storedPrefs, incomingPrefs);
      const contextSummary = buildPromptPreferenceSummary(mergedPrefs, intentAxis, effectiveMessage);
      if (contextSummary) console.log("[plan/coze] Context summary attached");

      // C4: Prepend semantic traveler portrait (LLM-generated, from cross-session profile)
      const profileSummary = shouldInjectProfileSummary(intentAxis, effectiveMessage, userProfile?.profileSummary)
        ? userProfile.profileSummary
        : null;
      // E2: Multi-turn context prefix from conversation history
      const priorTurns = getTurns(incomingSessionId, 8);
      const turnPrefix = buildContextPrefix(priorTurns);
      // Record this user turn for future multi-turn context
      if (incomingSessionId) {
        try { addTurn(incomingSessionId, { role: "user", content: effectiveMessage, intent: intentResult }); } catch (_e) { console.warn("[plan] addTurn failed:", sanitizeOperationalError(_e, "conversation_append_failed")); }
      }
      const fullContext = [
        profileSummary ? `【旅行者画像】${profileSummary}` : "",
        contextSummary,
        turnPrefix,
      ].filter(Boolean).join("\n");

      // E5: Micro-preference signals from intent detection (non-blocking)
      if (deviceId && intentResult) {
        try {
          if (intentAxis === "food") recordProfileSignal(deviceId, "food_focus", 1);
          if (intentAxis === "stay") recordProfileSignal(deviceId, "stay_focus", 1);
          if (intentAxis === "activity") recordProfileSignal(deviceId, "activity_focus", 1);
          const prefs = intentResult.preferences || {};
          if (prefs.luxury_hotel || prefs.luxury || /豪华|五星|高端|luxury|premium/i.test(effectiveMessage))
            recordProfileSignal(deviceId, "luxury_preference", 1);
          if (prefs.budget || /便宜|省钱|经济|预算|budget|cheap/i.test(effectiveMessage))
            recordProfileSignal(deviceId, "budget_preference", 1);
          if ((intentResult.duration_days || 0) >= 7) recordProfileSignal(deviceId, "long_trip_preference", 1);
          if ((intentResult.pax || 1) >= 4) recordProfileSignal(deviceId, "group_travel_preference", 1);
        } catch (_e) { console.warn("[plan] profile signal failed:", sanitizeOperationalError(_e, "profile_signal_failed")); }
      }

      // AI-native: use LLM intentResult (already computed above) to build pre-plan params.
      // buildPrePlanFromIntent() uses detectIntentLLM() output directly, eliminating the
      // regex fast-path. Falls back gracefully when LLM fields are absent.
      const prePlan = complex ? null : buildPrePlanFromIntent({ intentResult, city: planningCity, constraints, intentAxis });

      // P8.8: Requirement gate — travel plans need explicit duration + destination.
      // Uses LLM-extracted params first; emits clarify with 0 LLM tokens when slots missing.
      const missingSlots = checkRequirements(effectiveMessage, constraints, intentAxis, intentResult);
      if (missingSlots.length > 0) {
        planDone = true;
        // P8.10: persist context so next turn can merge destination + original intent
        let gateSessionId = incomingSessionId;
        if (gateSessionId && getSession(gateSessionId)) {
          patchSession(gateSessionId, { pendingClarify: { originalMessage: effectiveMessage, missingSlots } });
        } else {
          gateSessionId = createSession(
            { pendingClarify: { originalMessage: effectiveMessage, missingSlots }, language, city, preferences: mergedPrefs },
            DEFAULT_TTL_MS,
            deviceId,
          );
        }
        const slotLabels = {
          destination: pickLang(language, "目的地城市", "destination city", "目的地", "목적지"),
          duration: pickLang(language, "行程天数", "trip duration", "日数", "여행 일수"),
          budget: intentAxis === "food"
            ? pickLang(language, "人均消费预算", "per-person budget", "一人あたりの予算", "1인 예산")
            : pickLang(language, "总预算", "total budget", "予算", "예산"),
        };
        const asked = missingSlots.map((s) => slotLabels[s])
          .join(pickLang(language, "和", " and ", "と", "과 "));
        console.log("[plan/coze] Requirement gate triggered");

        // Conversational clarification: LLM natural question (ZH only, 3s timeout)
        const conversationalText = await buildConversationalClarify(
          OPENAI_API_KEY, OPENAI_MODEL, OPENAI_BASE_URL, effectiveMessage, missingSlots, language,
        );
        const clarifyText = conversationalText || pickLang(language,
          `请告诉我您的${asked}，我马上为您量身定制方案。`,
          `Hi! Please share your ${asked} and I'll build your custom plan right away.`,
          `${asked}を教えてください。すぐにプランを作ります。`,
          `${asked}를 알려주시면 바로 맞춤 플랜을 만들겠습니다.`);

        // Build extracted_slots so frontend can show "AI已知" badges alongside missing chips
        const extractedSlots = {};
        if (constraints.destination) extractedSlots.destination = constraints.destination;
        if (constraints.duration)    extractedSlots.duration     = constraints.duration;
        if (constraints.pax > 1)     extractedSlots.party_size   = constraints.pax;
        if (intentResult.pax > 1 && !extractedSlots.party_size) extractedSlots.party_size = intentResult.pax;

        emit({
          type: "final", response_type: "clarify",
          spoken_text: clarifyText,
          missing_slots: missingSlots,
          extracted_slots: extractedSlots,
          source: "requirement-gate",
          sessionId: gateSessionId,   // P8.10: client persists, next request carries it
        });
        res.end();
        return;
      }

      // ── Discovery mode (小美式) ─────────────────────────────────────────────
      // If this is a vague first-turn message, have a one-round conversation to
      // understand preferences before generating the plan.
      const _discoverySession = incomingSessionId ? existingSession : null;
      if (!didDiscoveryMerge && needsDiscovery(effectiveMessage, intentAxis, _discoverySession, planningCity)) {
        planDone = true;
        const discovery = await runDiscovery({
          message: effectiveMessage, city, language, intentAxis,
          apiKey: OPENAI_API_KEY, model: OPENAI_MODEL, baseUrl: OPENAI_BASE_URL,
          emit,
        });

        // Save discovery state: next turn will skip discovery and go straight to plan
        let discoverySessionId = incomingSessionId;
        const discoveryPayload = {
          pendingDiscovery: true,
          originalMessage:  effectiveMessage,
          intentAxis,
          language, city,
          preferences: mergedPrefs,
        };
        if (discoverySessionId && getSession(discoverySessionId)) {
          patchSession(discoverySessionId, discoveryPayload);
        } else {
          discoverySessionId = createSession(discoveryPayload, DEFAULT_TTL_MS, deviceId);
        }

        emit({
          type:          "final",
          response_type: "chat",
          spoken_text:   discovery.spokenText || pickLang(language,
            "\u8bf4\u8bf4\u770b\uff0c\u4f60\u60f3\u600e\u4e48\u73a9\uff1f",
            "Tell me more — what kind of experience are you after?",
            "\u3069\u3093\u306a\u65c5\u884c\u3092\u8003\u3048\u3066\u3044\u307e\u3059\u304b\uff1f",
            "\u00f3Qu\u00e9 tipo de experiencia buscas?",
          ),
          source:    "discovery",
          sessionId: discoverySessionId,
        });
        res.end();
        return;
      }

      // Kill static progress timer — agent loop emits its own status events
      planDone = true;

      // outSessionId 预声明在此作用域，供 setImmediate 回调（868/887行）访问
      // 在 result.ok 分支内会更新为实际 session ID
      let outSessionId = incomingSessionId;

      // Agent loop — single generation path, autonomously fetches data via tools.
      const agentDeps = {
        queryAmapHotels, queryJuheFlight, mockAmapRouting, mockCtripHotels, buildAIEnrichment,
        callCozeWorkflow,
        lockedDestinationCity: planningCity,
        lockedOriginCity: city && city !== planningCity ? city : "",
      };
      // P1-C: check abort before starting expensive LLM work
      if (_abortSignal.aborted) return;

      const shouldUsePipelineFirst = complex || (intentAxis === "food" || intentAxis === "activity" || intentAxis === "stay" || (intentAxis === "travel" && Number(constraints?.duration || intentResult?.duration_days || 0) <= 4));
      if (complex) console.log("[plan/coze] Complex itinerary — using summary pipeline first to reduce latency");
      else if (shouldUsePipelineFirst) console.log("[plan/coze] Fast pipeline preferred for low-latency request");

      let result = shouldUsePipelineFirst ? { ok: false, _fastPipeline: true } : await runAgentLoop({
        message: effectiveMessage, language, city: planningCity,
        constraints: { ...constraints, city: planningCity, destination: planningCity, _clientIp: clientIp, _deviceId: deviceId },
        contextSummary: fullContext,
        history: mergedHistory,
        apiKey: OPENAI_API_KEY, model: OPENAI_MODEL, baseUrl: OPENAI_BASE_URL,
        intentAxis,
        deps: agentDeps,
        emit,
        abortSignal: _abortSignal,
      });

      // AAG-03: Persist agent trace for observability
      if (result._trace) {
        setImmediate(() => insertAgentTrace({
          sessionId: outSessionId || null,
          deviceId:  deviceId    || null,
          city: planningCity,
          intent:    intentAxis || null,
          toolCalls: result._trace,
          totalMs:   result._totalMs || 0,
          ok:        result.ok ? 1 : 0,
        }));
      }

      // AIF-04: Record LLM token consumption for unit economics analysis
      if (result.ok && (result._inputTokens || result._outputTokens)) {
        setImmediate(() => appendMetricEvent({
          kind:    "llm_token_usage",
          userId:  null,
          taskId:  null,
          meta: {
            deviceId:      deviceId      || null,
            sessionId:     outSessionId  || null,
            city,
            model:         OPENAI_MODEL,
            input_tokens:  result._inputTokens  || 0,
            output_tokens: result._outputTokens || 0,
            total_tokens:  (result._inputTokens || 0) + (result._outputTokens || 0),
            total_ms:      result._totalMs || 0,
          },
        }));
      }

      // Attach tool-collected enrichment data so the detail endpoint can use it
      if (result.ok && result.enrichmentData) {
        result._cozeEnrichment = result.enrichmentData;
      }
      if (result.ok && Array.isArray(result.hotelCatalog)) {
        result._hotelCatalog = result.hotelCatalog;
      }

      // Fallback: agent loop parse failure → 3-node OpenAI pipeline with workflow enrichment.
      if (!result.ok) {
        console.warn(result._fastPipeline ? "[plan/coze] Using fast pipeline path" : "[plan/coze] Agent loop failed — falling back to pipeline");
        // Use destination city (from intent extraction) for enrichment, not departure city
        const destCity = constraints.destination || intentResult?.destination || planningCity;
        const cozeEnrichment = await callCozeWorkflow({ query: effectiveMessage, city: destCity, lang: language, budget: budgetVal, intentAxis });
        console.log("[plan/coze/fallback] Coze enrichment prepared");
        const resourceContext = buildResourceContext(cozeEnrichment, planningCity, effectiveMessage, constraints, intentAxis);
        result = await generateCrossXResponse({
          message: effectiveMessage, language, city: planningCity,
          constraints: { ...constraints, city: planningCity, destination: planningCity, _clientIp: clientIp, _deviceId: deviceId },
          conversationHistory,
          apiKey: OPENAI_API_KEY, model: OPENAI_MODEL, baseUrl: OPENAI_BASE_URL,
          prePlan,
          resourceContext,
          intentAxis,
          contextSummary: fullContext,
          fullHistory: mergedHistory,
          cozeData: cozeEnrichment,
          skipSpeaker:  true,
          cardTimeoutMs: complex ? 12000 : 7000,
          cardMaxTokens: complex ? 1200  : 1400,
          summaryOnly:   complex,
        });
        result._cozeEnrichment = cozeEnrichment;

        // Photo injection for fallback path — workflow enrichment item_list → activities/meals
        if (result.ok && result.structured?.card_data?.days) {
          const photoMap = new Map();
          for (const item of (cozeEnrichment?.item_list || [])) {
            const photo = item.real_photo_url || item.photo_url || item.image_url;
            if (item.name && photo) photoMap.set(item.name, photo);
          }
          if (photoMap.size) {
            const cd = result.structured.card_data;
            cd.days = (cd.days || []).map((day) => ({
              ...day,
              activities: (day.activities || []).map((act) =>
                act.image_url ? act : (photoMap.has(act.name) ? { ...act, image_url: photoMap.get(act.name) } : act)
              ),
              meals: (day.meals || []).map((meal) => {
                if (meal.image_url) return meal;
                const photo = photoMap.get(meal.name) || photoMap.get(meal.restaurant);
                return photo ? { ...meal, image_url: photo } : meal;
              }),
            }));
            console.log("[plan/coze/fallback] Photo injection applied");
          }
        }
      }

      planDone = true;

      if (result.ok && result.structured) {
        const s = result.structured;
        if (s.response_type === "options_card" && s.card_data) {
          s.card_data = await enrichStructuredCardData({
            cardData: s.card_data,
            language,
            city: planningCity,
            constraints,
            queryHotelCatalog,
            queryAmapHotels,
            mockCtripHotels,
            buildAIEnrichment,
            cachedFoodEnrichment: result._cozeEnrichment || null,
            cachedHotelCatalog: Array.isArray(result._hotelCatalog) ? result._hotelCatalog : null,
            pickLang,
          });
          const localized = await localizeStructuredPayload({
            spoken_text: s.spoken_text || "",
            card_data: s.card_data,
          }, language, OPENAI_API_KEY, OPENAI_MODEL, OPENAI_BASE_URL, { preferNormalizationOnly: Boolean(s.card_data?.days && !s.card_data.days.length) });
          if (localized?.card_data) {
            s.card_data = localized.card_data;
            if (localized.spoken_text) s.spoken_text = localized.spoken_text;
          }
        }

        // [Safety hard-stop] LLM triggered business boundary refusal.
        // Intercept BEFORE status events — no hotel matching, no session write.
        if (isBoundaryRejection(s)) {
          console.log("[plan/coze] Business boundary rejection intercepted at route layer");
          emit({
            type:          "final",
            response_type: "boundary_rejection",
            spoken_text:   s.spoken_text || pickLang(language,
              "抱歉，我是专注于旅行规划的 AI 助手，无法处理此类请求。如果您有旅行计划需要帮助，我很乐意为您安排！",
              "Sorry, I specialize in travel planning and cannot assist with this request. Happy to help plan your next trip!",
              "申し訳ありませんが、旅行専門のAIです。旅行計画でお役に立てます！",
              "죄송합니다. 저는 여행 전문 AI입니다. 여행 계획을 도와드릴게요!",
            ),
            source: "safety-guardrail",
          });
          res.end();
          return;
        }

        // Success — emit completion status events
        emit({ type: "status", code: "H_SEARCH", label: pickLang(language,
          "酒店匹配完成", "Hotels matched", "ホテル確定", "호텔 확정") });
        emit({ type: "status", code: "T_CALC",   label: pickLang(language,
          "交通核算完成", "Transport calculated", "交通費確定", "교통비 확정") });
        emit({ type: "status", code: "B_CHECK",  label: pickLang(language,
          "预算校验完成", "Budget verified", "予算確定", "예산 확정") });

        // [P1] Session: save or create session for future UPDATE requests
        outSessionId = incomingSessionId;
        if (s.response_type === "options_card" && s.card_data) {
          // Build updated history with this turn appended
          const newTurn = { role: "user", content: effectiveMessage };
          const updatedHistory = pruneHistory([...mergedHistory, newTurn], 12);
          const sessionPayload = {
            plan: s.card_data,
            message: effectiveMessage,
            language,
            city: planningCity,
            preferences: mergedPrefs,
            history: updatedHistory,
          };
          const _sessionExists = outSessionId && getSession(outSessionId);
          if (_sessionExists) {
            patchSession(outSessionId, sessionPayload);
          } else {
            outSessionId = createSession(sessionPayload, DEFAULT_TTL_MS, deviceId);
            // Turn 1: session didn't exist when addTurn was called — record it now
            try { addTurn(outSessionId, { role: "user", content: effectiveMessage, intent: intentResult }); } catch (_e) { console.warn("[plan] addTurn failed:", sanitizeOperationalError(_e, "conversation_append_failed")); }
          }
          // Extend TTL to 7 days when user has accumulated preferences — cross-day memory
          if (outSessionId && Object.keys(mergedPrefs).length > 0) {
            touchSession(outSessionId, PREF_TTL_MS);
          }
          console.log("[plan/coze] Plan saved to session");

          // [C4] Async profile save — fire-and-forget, does not block response
          if (deviceId) {
            const _dest = intentResult.destination || planningCity || city || null;
            const _tripCount = (userProfile?.tripCount || 0) + 1;
            setImmediate(async () => {
              try {
                let summary = userProfile?.profileSummary || null;
                // Regenerate semantic summary every 3 trips or on first save
                if (!summary || _tripCount % 3 === 0) {
                  summary = await generateProfileSummary(mergedPrefs, {
                    apiKey: OPENAI_API_KEY, model: OPENAI_MODEL, baseUrl: OPENAI_BASE_URL,
                  });
                }
                saveProfile(deviceId, mergedPrefs, _dest, summary);
                console.log("[profile] saved preferences snapshot");
              } catch (e) {
                console.warn("[profile] async save error:", sanitizeOperationalError(e, "profile_async_save_failed"));
              }
            });
          }
        }

        // Follow-up suggestions based on intent axis + language
        const _fuLang = (language || "ZH").toUpperCase();
        const _fuByLang = FOLLOW_UP_SUGGESTIONS[_fuLang] || FOLLOW_UP_SUGGESTIONS.ZH;
        const followUpSuggestions = _fuByLang[intentAxis] || _fuByLang.travel;

        const compactCozeData = result._cozeEnrichment
          ? {
              restaurant_queue: Number(result._cozeEnrichment.restaurant_queue || 0) || 0,
              ticket_availability: Boolean(result._cozeEnrichment.ticket_availability),
              spoken_text: normalizeCozeSpokenText(result._cozeEnrichment.spoken_text || "", language) || result._cozeEnrichment.spoken_text || "",
              _source: result._cozeEnrichment._source || null,
            }
          : null;

        emit({
          type: "final", ...s,
          source: "openai",
          sessionId: outSessionId || null,
          coze_data: compactCozeData,
          follow_up_suggestions: followUpSuggestions,
        });
        // Record assistant turn for multi-turn context
        if (outSessionId && s.spoken_text) {
          try { addTurn(outSessionId, { role: "assistant", content: s.spoken_text }); } catch (_e) { console.warn("[plan] addTurn failed:", sanitizeOperationalError(_e, "conversation_append_failed")); }
        }
        // Capture training example (async, non-blocking)
        setImmediate(() => {
          try {
            captureExample({
              deviceId: deviceId || "unknown",
              sessionId: outSessionId || null,
              userMessage: message,
              assistantResponse: JSON.stringify(s.card_data || {}),
              intent: intentResult,
              source: "openai",
            });
          } catch (_e) { console.warn("[plan] captureExample failed:", sanitizeOperationalError(_e, "training_capture_failed")); }
        });
      } else {
        emit({
          type: "final", response_type: "clarify",
          spoken_text: pickLang(language,
            "方案生成遇到问题，请稍后重试或换个说法描述需求。",
            "Plan generation failed. Please retry or rephrase.",
            "プランの生成に失敗しました。再試行してください。",
            "플랜 생성에 실패했습니다. 다시 시도해 주세요.",
          ),
          missing_slots: [], source: "openai-fallback",
        });
      }
    } catch (e) {
      planDone = true;
      console.warn("[plan/coze] Pipeline error:", sanitizeOperationalError(e, "plan_pipeline_failed"));
      emit({ type: "error", msg: pickLang(language,
        "抱歉，行程方案生成遇到问题，请稍后重试或换个方式描述需求。",
        "Sorry, we couldn't generate your plan. Please retry or rephrase.",
        "プランの生成に失敗しました。しばらく待ってから再試行してください。",
        "플랜 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.",
      ) });
    }

    _releaseSem();
    res.end();
  }

  // ── POST /api/plan/detail — On-demand day-by-day itinerary (JSON) ─────────
  // Called after summaryOnly card; generates days in 5-day batches.
  // No session integration needed here — detail is ephemeral display data.
  async function handleDetail(req, res) {
    const body = await readBody(req);
    const { message, city, constraints, planSummary } = body;
    const language = normalizeLang(body.language || body.lang || DEFAULT_LANG);
    if (!message || !planSummary) return writeJson(res, 400, { error: "message and planSummary required" });

    const { apiKey, model: OPENAI_MODEL, baseUrl } = getOpenAIConfig();
    if (!apiKey) return writeJson(res, 503, { error: "plan_detail_provider_unavailable" });

    const pickSummaryDays = () => {
      const allDays = Array.isArray(planSummary?.days) ? planSummary.days : [];
      if (!allDays.length) return null;
      const start = Math.max(1, Number(body.startDay) || 1);
      const end = Math.min(allDays.length, start + 1);
      const days = allDays.slice(start - 1, end).map((day, idx) => ({
        ...day,
        day: Number(day?.day || start + idx) || start + idx,
        city: day?.city || planSummary?.destination || city || "",
      }));
      return {
        days,
        arrival_note: String(planSummary?.arrival_note || ""),
        startDay: start,
        endDay: end,
        totalDays: Math.max(Number(planSummary?.duration_days || 0) || 0, allDays.length),
      };
    };

    const dest      = planSummary.destination || city || "中国";
    const totalDays = getCanonicalPlanDays(planSummary, constraints);
    const budget    = planSummary.total_price
      || (constraints?.budget ? Number(String(constraints.budget).replace(/[^0-9]/g, "")) : 5000);
    const tier      = planSummary.tier || "balanced";
    const transport = planSummary.transport_plan || "";
    const hotelNote = planSummary.hotel?.name || "";

    const BATCH    = 2;
    const summaryDaysBatch = pickSummaryDays();
    const startDay = summaryDaysBatch?.startDay || Math.max(1, Number(body.startDay) || 1);
    const endDay   = summaryDaysBatch?.endDay || Math.min(totalDays, startDay + BATCH - 1);
    const hasMore  = endDay < totalDays;

    const systemPrompt = DETAIL_SYSTEM_PROMPT_TEMPLATE({ tier, startDay, endDay, totalDays, language });
    const userContent  = (language === "ZH" || language === "ZH-TW")
      ? [
          `用户需求: ${scrubPii(String(message))}`,
          `方案: ${dest} | ${totalDays}天 | ¥${budget} | ${tier}`,
          `交通: ${transport}`,
          `住宿: ${hotelNote}`,
          `请生成 Day ${startDay}-Day ${endDay} 的行程`,
        ].join("\n")
      : [
          `User request: ${scrubPii(String(message))}`,
          `Plan summary: ${dest} | ${totalDays} days | CNY ${budget} | ${tier}`,
          `Transport summary: ${transport}`,
          `Hotel summary: ${hotelNote}`,
          `Generate the itinerary for Day ${startDay} to Day ${endDay}.`,
        ].join("\n");

    // [Input Guard] off-topic / injection check on detail endpoint too
    if (isInjectionAttack(String(message))) {
      return writeJson(res, 400, {
        ok: false,
        error: pickLang(
          language,
          "输入触发安全校验，已拒绝处理。",
          "Input was rejected by the security guard.",
          "入力が安全チェックにより拒否されました。",
          "입력이 보안 정책에 따라 거부되었습니다."
        ),
      });
    }

    // Switch to SSE so each batch is streamed to the frontend as it completes
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const emitDetail = (data) => { try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch (e) { console.warn("[plan/detail] SSE write failed — client likely disconnected:", sanitizeOperationalError(e, "sse_write_failed")); } };

    let parsed = null;
    if (summaryDaysBatch?.days?.length) {
      parsed = { days: summaryDaysBatch.days, arrival_note: summaryDaysBatch.arrival_note || "" };
    } else {
      const result = await openAIRequest({
        apiKey, model: OPENAI_MODEL, baseUrl,
        systemPrompt, userContent,
        temperature: 0.4, maxTokens: 2200,
        jsonMode: true, timeoutMs: 20000,
      });

      parsed = safeParseJson(result.text);
      if (!parsed || !Array.isArray(parsed.days) || !parsed.days.length) {
        console.warn("[plan/detail] Failed to parse days:", "invalid_plan_detail_payload");
        emitDetail({ type: "error", error: "Failed to generate itinerary detail" });
        res.end();
        return;
      }
    }

    const originCity = extractOriginCityForDetail(message, constraints, city, dest);
    const departDate = extractDepartureDateForDetail(message, constraints);
    let previousCity = startDay === 1 ? originCity : "";
    for (const day of parsed.days) {
      const dayCity = cleanTransportCityCandidate(day?.city || dest);
      const transitionFrom = cleanTransportCityCandidate(previousCity);
      const existingFrom = cleanTransportCityCandidate(day?.intercity_transport?.from);
      const existingTo = cleanTransportCityCandidate(day?.intercity_transport?.to);
      const hasRealTransition = transitionFrom && dayCity && transitionFrom !== dayCity;
      const needsReplacement = !day?.intercity_transport
        || existingFrom === existingTo
        || !Array.isArray(day?.intercity_transport?.route_options)
        || !day?.intercity_transport?.source;

      if (hasRealTransition && needsReplacement) {
        const liveIntercity = await buildLiveIntercityTransport({
          originCity: transitionFrom,
          destinationCity: dayCity,
          date: departDate,
          language,
          pickLang,
          queryJuheFlight,
          queryRailAvailability,
          mockAmapRouting,
        });
        if (liveIntercity) {
          day.intercity_transport = liveIntercity;
          const leadTransport = Array.isArray(day.activities)
            ? day.activities.find((act) => /^(transport|city_change)$/i.test(String(act?.type || "")))
            : null;
          if (leadTransport) {
            leadTransport.name = liveIntercity.label
              ? `${liveIntercity.from} → ${liveIntercity.to} · ${liveIntercity.label}`
              : `${liveIntercity.from} → ${liveIntercity.to}`;
            if (liveIntercity.detail) leadTransport.desc = liveIntercity.detail;
            if (liveIntercity.duration_min) leadTransport.duration_min = liveIntercity.duration_min;
            if (liveIntercity.cost_cny) leadTransport.cost_cny = liveIntercity.cost_cny;
          }
        }
      } else if (!hasRealTransition && day?.intercity_transport && (!existingTo || existingFrom === existingTo)) {
        delete day.intercity_transport;
      }
      previousCity = dayCity || previousCity;
    }

    const localizedDetail = await localizeStructuredPayload({
      days: parsed.days,
      arrival_note: parsed.arrival_note || "",
    }, language, apiKey, OPENAI_MODEL, baseUrl);
    if (Array.isArray(localizedDetail?.days)) parsed.days = localizedDetail.days;
    if (typeof localizedDetail?.arrival_note === "string") parsed.arrival_note = localizedDetail.arrival_note;

    console.log("[plan/detail] Itinerary detail generated");
    // Emit the batch immediately as it is ready
    emitDetail({
      type: "batch",
      days: parsed.days,
      batchIndex: 0,
      totalBatches: 1,
      arrival_note: parsed.arrival_note || "",
      hasMore,
      nextStartDay: hasMore ? endDay + 1 : null,
    });
    emitDetail({ type: "done", totalDays });
    res.end();
  }

  return { handleCoze, handleDetail };
}

module.exports = {
  createPlanRouter,
  _test: {
    checkPlanRateLimit,
    checkAntiFraud,
    buildLiveIntercityTransport,
  },
};
