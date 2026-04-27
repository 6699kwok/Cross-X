"use strict";
/**
 * src/ai/intent.js
 * LLM-based intent + preference detection — B1/C3 AI Native upgrade.
 *
 * detectIntentLLM() extracts axis + travel params + user preferences in
 * a single ~200-token LLM call, replacing both detectIntentAxis() (regex)
 * and extractPreferences() (15-rule regex) in one shot.
 * Falls back to regex on timeout or parse error.
 */

// intent.js is the intent-extraction bridge between raw user language and the rest
// of the planning pipeline. It sits between cheap regex heuristics and the heavier
// planner stages, providing a small structured summary of what the user seems to want.
const { openAIRequest } = require("./openai");
const { sanitizeOperationalError } = require("../utils/safeError");

// ── Regex fallback (original detectIntentAxis logic) ──────────────────────────
function _detectIntentAxisRegex(message) {
  const text = String(message || "");
  const hasTravelFrame = /\b(plan|trip|itinerary|travel)\b|(?:\d+\s*(?:day|days|night|nights))|行程|旅行|旅游|玩\d+天|\d+天/i.test(text);
  const hasStay = /酒店|住宿|宾馆|民宿|\bhotel\b|\bhostel\b|\bstay\b|accommodation/i.test(text);
  const hasFood = /餐厅|美食|好吃|推荐.*吃|吃什么|特色菜|小吃|\beat\b|restaurant|food|dining|meal|brunch|supper|snack|taste|cuisine/i.test(text);
  const hasActivity = /景点|游览|门票|博物馆|景区|打卡|scenic|attraction|museum|sightseeing|tour|landmark/i.test(text);
  const hasTransport = /机票|航班|飞机|高铁|火车|机场|地铁|打车|交通|接送|flight|airport|plane|rail|train|taxi|metro|transfer|pickup|drop-?off/i.test(text);
  if (hasTransport) return "travel";
  if ((hasFood && hasStay) || (hasFood && hasActivity) || (hasStay && hasActivity)) return "travel";
  if (hasStay) return "stay";
  if (hasFood) return "food";
  if (hasActivity) return "activity";
  if (hasTravelFrame) return "travel";
  return "travel";
}

function _extractDestinationRegex(message) {
  const text = String(message || "").trim();
  if (!text) return null;

  const zhMatch = text.match(/(?:去|到|前往|出发去|飞往)\s*([一-龥]{2,10})(?=玩|旅|游|看|走|参观|出发|\s|，|。|$)/);
  if (zhMatch && zhMatch[1]) return zhMatch[1].trim();

  const STOP_WORDS = /^(English|Chinese|Japanese|Korean|Mandarin)$/i;
  const normalize = (value) => String(value || "")
    .trim()
    .replace(/\s{2,}/g, " ")
    .replace(/^["']+|["']+$/g, "");
  const keep = (value) => {
    const cleaned = normalize(value);
    if (!cleaned || STOP_WORDS.test(cleaned)) return null;
    return cleaned;
  };

  const enPatterns = [
    /\b(?:plan|trip|travel|stay|itinerary)\s+(?:a\s+\d+-day\s+)?([A-Z][A-Za-z' -]{1,40}?)\s+(?:trip|travel|stay|itinerary|plan)\b/i,
    /\b(?:find|need|want|book)\s+(?:a\s+\d+-day\s+)?([A-Z][A-Za-z' -]{1,40}?)\s+stay\s+plan\b/i,
    /\b(?:trip|travel|stay|itinerary|plan)\s+(?:in|for|to)\s+([A-Z][A-Za-z' -]{1,40}?)(?=\s+(?:in\s+English|in\s+Chinese|with|for|under|on|this|next)|[,.!?]|$)/i,
    /\b([A-Z][A-Za-z' -]{1,40}?)\s+(?:trip|travel)\b/i,
    /\b([A-Z][A-Za-z' -]{1,40}?)\s+stay\s+plan\b/i,
    /\b(?:visit|going to|travel to|trip to)\s+([A-Z][A-Za-z' -]{1,40}?)(?=\s+(?:in\s+English|in\s+Chinese|with|for|under|on|this|next)|[,.!?]|$)/i,
  ];
  for (const pattern of enPatterns) {
    const match = text.match(pattern);
    const kept = keep(match && match[1]);
    if (kept) return kept;
  }

  return null;
}

function _fallbackResult(message) {
  return {
    axis: _detectIntentAxisRegex(message),
    destination: _extractDestinationRegex(message),
    duration_days: null,
    pax: 2,
    budget_per_day: null,
    special_needs: [],
    preferences: {},
    _source: "regex",
  };
}

const INTENT_SYSTEM_PROMPT = `你是 CrossX 旅行 App 的意图分类器。分析用户消息，只返回 JSON，不要解释。

JSON 字段：
- axis: "food"（找餐厅/美食，不含综合行程）| "activity"（找景点/体验）| "stay"（找住宿）| "travel"（综合行程规划，默认）
- destination: 目的地城市名字符串（如 "西安"、"Bangkok"），无则 null
- duration_days: 行程天数整数，无则 null（"周末"=2，"一周"=7，"小长假"=3）
- pax: 出行人数整数，默认 2（"我和老公"=2，"带孩子"至少3，"一家四口"=4）
- budget_per_day: 每人每天预算（人民币元）整数，无则 null
- special_needs: 数组，从 ["child_friendly","wheelchair","solo_female","senior","pet","halal"] 中选，无则 []
- preferences: 对象，只输出推断为 true 的偏好键（其余省略）：
    has_children（带孩子）, has_elderly（带老人）, solo（独自旅行）, couple（情侣/夫妻）,
    pace_slow（悠闲/不赶/慢节奏）, pace_packed（紧凑/多景点）,
    food_focus（美食优先）, vegetarian（素食）, halal（清真）,
    budget_low（省钱/穷游）, budget_high（奢华/高端）,
    cultural（文化历史）, nature（自然户外/爬山）, shopping（购物）

示例：
用户："带孩子去西安玩3天，找个好住处" → {"axis":"travel","destination":"\u897f\u5b89","duration_days":3,"pax":3,"budget_per_day":null,"special_needs":["child_friendly"],"preferences":{"has_children":true}}
用户："推荐成都特色小吃，我一个人" → {"axis":"food","destination":"\u6210\u90fd","duration_days":null,"pax":1,"budget_per_day":null,"special_needs":[],"preferences":{"food_focus":true,"solo":true}}
用户："不喜欢走太多路，想悠闲地逛逛上海" → {"axis":"travel","destination":"\u4e0a\u6d77","duration_days":null,"pax":2,"budget_per_day":null,"special_needs":[],"preferences":{"pace_slow":true}}`;

/**
 * Detect user intent via LLM with structured output.
 * Returns enriched intent object; falls back to regex on failure.
 *
 * @param {string} message - User message
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.model
 * @param {string} opts.baseUrl
 * @returns {Promise<{axis:string, destination:string|null, duration_days:number|null, pax:number, budget_per_day:number|null, special_needs:string[], _source:string}>}
 */
// detectIntentLLM() is intentionally narrow in scope: classify axis, basic travel
// parameters, and coarse preference signals. It should not expand into full planning
// logic, which belongs to planner modules downstream.
async function detectIntentLLM(message, { apiKey, model, baseUrl } = {}) {
  if (!apiKey || !message) return _fallbackResult(message || "");

  try {
    const { ok, text } = await openAIRequest({
      apiKey, model, baseUrl,
      systemPrompt: INTENT_SYSTEM_PROMPT,
      userContent: message.slice(0, 800), // cap to avoid token waste
      temperature: 0.1,
      maxTokens: 300,
      jsonMode: true,
      timeoutMs: 4000,
    });

    if (!ok || !text) {
      console.warn("[intent] LLM returned empty — using regex fallback");
      return _fallbackResult(message);
    }

    const parsed = JSON.parse(text);

    // Validate axis
    const VALID_AXES = ["food", "activity", "stay", "travel"];
    const axis = VALID_AXES.includes(parsed.axis) ? parsed.axis : _detectIntentAxisRegex(message);

    // Extract and sanitise preferences — only keep known boolean keys
    const PREF_KEYS = new Set([
      "has_children", "has_elderly", "solo", "couple",
      "pace_slow", "pace_packed",
      "food_focus", "vegetarian", "halal",
      "budget_low", "budget_high",
      "cultural", "nature", "shopping",
    ]);
    const rawPrefs = (parsed.preferences && typeof parsed.preferences === "object") ? parsed.preferences : {};
    const preferences = {};
    for (const [k, v] of Object.entries(rawPrefs)) {
      if (PREF_KEYS.has(k) && v === true) preferences[k] = true;
    }

    const result = {
      axis,
      destination:    typeof parsed.destination === "string" && parsed.destination.trim() ? parsed.destination.trim() : null,
      duration_days:  Number.isInteger(parsed.duration_days) && parsed.duration_days > 0 ? parsed.duration_days : null,
      pax:            Number.isInteger(parsed.pax) && parsed.pax > 0 ? parsed.pax : 2,
      budget_per_day: Number.isInteger(parsed.budget_per_day) && parsed.budget_per_day > 0 ? parsed.budget_per_day : null,
      special_needs:  Array.isArray(parsed.special_needs) ? parsed.special_needs.filter(s => typeof s === "string") : [],
      preferences,
      _source: "llm",
    };

    console.log("[intent] intent parsed via llm");
    return result;

  } catch (e) {
    console.warn("[intent] parse error — using regex fallback:", sanitizeOperationalError(e, "intent_parse_failed"));
    return _fallbackResult(message);
  }
}

module.exports = { detectIntentLLM };
