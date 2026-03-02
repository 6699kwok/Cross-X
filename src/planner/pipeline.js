"use strict";
/**
 * src/planner/pipeline.js
 * Core planning pipeline — extracted from server.js
 *
 * 3-node flow:
 *   Node 1 (Planner)        → extract intent JSON from user message
 *   Node 2 (Mock Data)      → inject routing + hotel data
 *   Node 3 (Card Generator) → produce options_card JSON
 *
 * External server.js dependencies are injected via configure() at startup.
 */

const { openAIRequest } = require("../ai/openai");
const { PLANNER_SYSTEM_PROMPT, buildCrossXSystemPrompt, SPEAKER_SYSTEM_PROMPT } = require("./prompts");
const { safeParseJson, CHINA_CITIES_RE, mockAmapRouting, mockCtripHotels } = require("./mock");

// ── Flight data adapter ───────────────────────────────────────────────────────
/**
 * Convert queryJuheFlight() result into the same shape as mockAmapRouting()
 * so the rest of the pipeline stays unchanged.
 */
function _flightDataToRoute(flightData) {
  if (!flightData || !Array.isArray(flightData.flights) || !flightData.flights.length) return null;
  const best = flightData.flights[0]; // already sorted by price asc
  return {
    transport_mode: "flight",
    flight_no:      best.flightNo,
    airline:        best.airline,
    dep_time:       best.depTime,
    arr_time:       best.arrTime,
    duration_min:   _parseDurationMin(best.duration),
    price_range:    best.price ? { low: best.price, high: best.price } : null,
    stops:          best.stops || 0,
    source:         "juhe",
  };
}

/** Convert "2小时30分" / "02:30" / "150" → minutes */
function _parseDurationMin(str) {
  if (!str) return null;
  const hm = String(str).match(/(\d+)\s*(?:小时|h|:)\s*(\d+)/i);
  if (hm) return parseInt(hm[1]) * 60 + parseInt(hm[2]);
  const h = String(str).match(/^(\d+)\s*(?:小时|h)$/i);
  if (h) return parseInt(h[1]) * 60;
  const m = String(str).match(/^(\d+)\s*(?:分|min)$/i);
  if (m) return parseInt(m[1]);
  const n = parseInt(str);
  return isNaN(n) ? null : n;
}

// ── Injected dependencies (set once at server startup) ───────────────────────
let _buildKnowledge = () => "";
let _extractConstraints = (msg, ctx) => ({ city: null, duration: null, budget: null, party_size: null, service_types: [] });
let _sessionItinerary = null; // Will be the Map from server.js
let _queryFlight  = null;     // queryJuheFlight(fromCity, toCity, dateStr?) → flight data or null
let _queryHotels  = null;     // queryAmapHotels(city, budgetPerNight?) → [{tier,name,...}] | null

/**
 * Call once at startup to inject server.js-level dependencies.
 * @param {object}   deps
 * @param {function} deps.buildChinaTravelKnowledge
 * @param {function} deps.extractAgentConstraints
 * @param {Map}      deps.sessionItinerary
 * @param {function} deps.queryFlight   — async (from, to, date?) => {flights, ...} | null
 * @param {function} deps.queryHotels   — async (city, budgetPerNight?) => [{tier,...}] | null
 */
function configure({ buildChinaTravelKnowledge, extractAgentConstraints, sessionItinerary, queryFlight, queryHotels }) {
  if (buildChinaTravelKnowledge) _buildKnowledge = buildChinaTravelKnowledge;
  if (extractAgentConstraints) _extractConstraints = extractAgentConstraints;
  if (sessionItinerary) _sessionItinerary = sessionItinerary;
  if (queryFlight)  _queryFlight  = queryFlight;
  if (queryHotels)  _queryHotels  = queryHotels;
}

// ── isComplexItinerary ───────────────────────────────────────────────────────
/**
 * Returns true when the message describes a multi-city or international trip.
 * Used to decide: prePlan fast-path vs full Planner LLM.
 */
function isComplexItinerary(message) {
  const cityMatches = message.match(new RegExp(CHINA_CITIES_RE.source, "g")) || [];
  if (cityMatches.length >= 2) return true;
  if (/然后(?:去|飞|到)|再(?:去|飞|到)|接着|之后去|最后(?:去|飞|到)/.test(message)) return true;
  if (/→|->/.test(message)) return true;
  if (/巴黎|法国|英国|美国|日本|韩国|欧洲|paris|france|london|tokyo|seoul/i.test(message)) return true;
  const durMatches = message.match(/\d+\s*天/g) || [];
  if (durMatches.length >= 2) return true;
  if (message.length > 100) return true;
  return false;
}

// ── buildPrePlan — local fast-path, skips Planner LLM ───────────────────────
/**
 * Extracts plan parameters locally (~0ms), avoiding the 12s Planner LLM call.
 * Only used for simple single-city messages.
 */
function buildPrePlan({ message, city, constraints, intentAxis = "travel" }) {
  const extracted = _extractConstraints(message, constraints);

  let dest = extracted.city || extracted.destination || constraints.destination || null;
  if (!dest) {
    const cityInMsg = message.match(CHINA_CITIES_RE);
    if (cityInMsg) dest = cityInMsg[0];
  }
  if (!dest) {
    const destMatch =
      message.match(/(?:去|到|前往|出发去|飞往)\s*([\u4e00-\u9fa5]{2,4})(?=玩|旅|游|看|走|参观|出发|\s|，|。|$)/) ||
      message.match(/(?:trip to|visit|going to|travel to)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/i);
    if (destMatch) dest = destMatch[1];
  }
  dest = dest || city || "Shanghai";

  const days = Number(extracted.duration || constraints.duration || constraints.days || (intentAxis === "food" ? 1 : 3));
  const pax = Number(extracted.party_size || constraints.party_size || constraints.pax || 2);
  let budget = Number(extracted.budget || constraints.budget || 0);
  if (!budget) {
    const bm  = message.match(/(\d[\d,]*)\s*万\s*(?:元|人民币|RMB|CNY|预算)?/i);
    const bm2 = message.match(/(\d[\d,]+)\s*(?:元|人民币|RMB|CNY)/i);
    const bm3 = message.match(/(?:预算|budget)[^\d]*(\d[\d,]+)/i);
    if (bm)       budget = parseFloat(bm[1].replace(/,/g, "")) * 10000;
    else if (bm2) budget = parseFloat(bm2[1].replace(/,/g, ""));
    else if (bm3) budget = parseFloat(bm3[1].replace(/,/g, ""));
    // P8.11: food mode uses per-meal estimate; travel uses per-day estimate
    if (!budget)  budget = intentAxis === "food" ? pax * 150 : pax * days * 800;
  }

  return {
    destination: dest, duration_days: days, pax,
    total_budget: budget, interests: [],
    food_preference: extracted.food_preference || constraints.food_preference || "无特殊要求",
    special_needs: [], language_needs: false, trip_purpose: "观光游览",
    is_update: false, is_multi_city: false,
    itinerary: [{ city: dest, days }],
    allocation: {
      accommodation: Math.round(budget * 0.40),
      transport:     Math.round(budget * 0.12),
      meals:         Math.round(budget * 0.25),
      activities:    Math.round(budget * 0.15),
      misc:          Math.round(budget * 0.08),
    },
    budget_assessment: "合理",
    trade_off: "预算合理，无需取舍",
  };
}

// ── buildInventoryContext — Coze item_list → named shop/attraction inventory ──
/**
 * Converts Coze item_list (real restaurant/attraction arrays) into a structured
 * named inventory block. Forces LLM to use real shop names in activities[].name
 * and real photo URLs in image_url fields.
 *
 * @param {object} cozeData   Coze enrichment result
 * @param {string} dest       Destination city
 * @param {string} intentAxis "food"|"activity"|"stay"|"travel"
 * @returns {string}          Formatted inventory block or ""
 */
function buildInventoryContext(cozeData, dest, intentAxis) {
  if (!cozeData || cozeData._synthetic) return "";
  const itemList = cozeData.item_list || cozeData.items || [];
  if (!itemList.length) return "";

  const destLabel = dest || "目的地";

  if (intentAxis === "food") {
    const lines = [`【真实餐厅名录·${destLabel}】（来自实时数据，必须在 activity.name 中使用以下店名）`];
    itemList.slice(0, 8).forEach((item, i) => {
      const name  = item.name || item.shop_name || `餐厅${i + 1}`;
      const addr  = item.address || item.addr || "";
      const price = item.avg_price != null ? `人均¥${item.avg_price}` : "";
      const queue = item.queue_min  != null ? `等位${item.queue_min}min` : "";
      const photo = item.real_photo_url || item.photo_url || item.image_url || "";
      const parts = [addr, price, queue].filter(Boolean).join(" ");
      lines.push(`${i + 1}. 【${name}】${parts ? `（${parts}）` : ""}${photo ? ` photo:${photo}` : ""}`);
    });
    lines.push('\u26a0\ufe0f activity.name \u5fc5\u987b\u5199\u6210\u201c\u5728\u3010\u5e97\u540d\u3011\u4eab\u7528XX\u201d\uff0c\u7981\u6b62\u4ec5\u5199\u201c\u5403\u5348\u9910\u201d\u7b49\u6a21\u7cca\u63cf\u8ff0\u3002');
    lines.push('\u26a0\ufe0f \u82e5 item \u542b photo:URL\uff0c\u5fc5\u987b\u5c06\u5176\u539f\u6837\u590d\u5236\u5230\u5bf9\u5e94 activity.image_url \u5b57\u6bb5\u3002');
    return lines.join("\n");
  }

  if (intentAxis === "activity") {
    const lines = [`【真实景点名录·${destLabel}】（必须在 activity.name 中使用以下景点名）`];
    itemList.slice(0, 8).forEach((item, i) => {
      const name   = item.name || `景点${i + 1}`;
      const ticket = item.ticket_price != null ? `门票¥${item.ticket_price}` : "";
      const hours  = item.open_hours || "";
      const photo  = item.real_photo_url || item.photo_url || "";
      const parts  = [ticket, hours].filter(Boolean).join(" ");
      lines.push(`${i + 1}. 【${name}】${parts ? `（${parts}）` : ""}${photo ? ` photo:${photo}` : ""}`);
    });
    lines.push('\u26a0\ufe0f activity.name \u5fc5\u987b\u5199\u6210\u201c\u6e38\u89c8\u3010\u666f\u70b9\u540d\u3011\u201d\u683c\u5f0f\uff0c\u7981\u6b62\u4ec5\u5199\u201c\u9017\u666f\u70b9\u201d\u7b49\u6a21\u7cca\u63cf\u8ff0\u3002');
    return lines.join("\n");
  }

  return "";
}

// ── buildResourceContext — Coze → structured injection string ────────────────
/**
 * Converts Coze enrichment data into a structured Chinese resource context string.
 * Injected into the Card Generator prompt to ground OpenAI in real-time data.
 *
 * @param {object} cozeData    Result from callCozeWorkflow (never null in P8.4)
 * @param {string} city        Destination city name
 * @param {string} message     Original user message (for pace hint detection)
 * @param {object} constraints Extracted constraints (unused, reserved for future)
 * @param {string} intentAxis  "food"|"activity"|"stay"|"travel" (P8.7)
 * @returns {string}           Formatted resource context block
 */
function buildResourceContext(cozeData, city, message, constraints, intentAxis) {
  if (!cozeData) return "";
  const dest = city || "目的地";
  const lines = [`【实时资源池·${dest}】`];

  // Restaurant queue time
  if (cozeData.restaurant_queue != null) {
    lines.push(`• 餐厅等位：当前热门餐厅等待约 ${cozeData.restaurant_queue} 分钟，建议提前预约或错峰就餐`);
  }
  // Ticket availability
  if (cozeData.ticket_availability != null) {
    const ticketStatus = cozeData.ticket_availability
      ? "✅ 主要景点门票当前有余票，可代订"
      : "⚠️ 部分景点门票紧张，建议提前7天预订";
    lines.push(`• 景点门票：${ticketStatus}`);
  }
  // Spoken text from Coze (city travel tips)
  if (cozeData.spoken_text) {
    lines.push(`• 旅游热度播报：${cozeData.spoken_text}`);
  }
  // Pace hints inferred from user message
  const paceHints = [];
  if (/老人|长辈|年迈|爷爷|奶奶|外公|外婆/.test(message))
    paceHints.push("行程节奏宜慢，减少爬升景点，安排午休");
  if (/儿童|小孩|宝宝|孩子|小朋友|baby|kid/i.test(message))
    paceHints.push("安排亲子友好景点，控制每天步行距离，加入互动体验");
  if (/孕妇|孕期|怀孕/.test(message))
    paceHints.push("避免高强度步行和刺激性活动，安排充足休息时间");
  if (/轮椅|行动不便|残疾|无障碍/.test(message))
    paceHints.push("优先选择无障碍设施完善的景点，安排轮椅可达路线");
  if (paceHints.length)
    lines.push(`• 人群特殊需求：${paceHints.join("；")}`);
  if (cozeData._synthetic)
    lines.push("（以上数据为智能模拟，实时数据将在正式接入后替换）");

  // P8.7: Real item inventory — real shop/attraction names + photo URLs
  const inventoryBlock = buildInventoryContext(cozeData, dest, intentAxis);
  if (inventoryBlock) {
    lines.push("");
    lines.push(inventoryBlock);
  }

  return lines.join("\n");
}

// ── generateCrossXResponse — 3-node pipeline ─────────────────────────────────
/**
 * @param {object}  opts
 * @param {string}  opts.message
 * @param {string}  opts.language
 * @param {string}  opts.city
 * @param {object}  opts.constraints
 * @param {Array}   opts.conversationHistory
 * @param {string}  opts.apiKey
 * @param {string}  opts.model
 * @param {object}  [opts.prePlan]       Pre-extracted plan (skips Node 1)
 * @param {boolean} [opts.skipSpeaker]   Skip Speaker LLM (use card's spoken_text)
 * @param {number}  [opts.cardTimeoutMs] Card Generator timeout (ms)
 * @param {number}  [opts.cardMaxTokens] Card Generator max tokens
 * @param {boolean} [opts.summaryOnly]   Skip days[] generation (complex itinerary mode)
 * @param {string}  [opts.resourceContext] Pre-built Coze resource context string (P8.4)
 * @param {string}  [opts.intentAxis]     "food"|"activity"|"stay"|"travel" (P8.6)
 * @param {string}  [opts.contextSummary] 【用户画像】line from conversation/context.js
 * @param {Array}   [opts.fullHistory]    Merged server+browser conversation history
 * @returns {Promise<{ok: boolean, structured: object}>}
 */
async function generateCrossXResponse({
  message, language, city, constraints, conversationHistory,
  apiKey, model, baseUrl,
  prePlan, skipSpeaker,
  cardTimeoutMs, cardMaxTokens,
  summaryOnly,
  resourceContext,
  intentAxis,
  contextSummary,
  fullHistory,
}) {
  const usedModel = model;
  let plan;

  // ── Node 1: Planner ──────────────────────────────────────────────────────
  if (prePlan) {
    plan = prePlan;
  } else {
    // Prefer fullHistory (server-side merged) over browser-only conversationHistory
    const _historySource = Array.isArray(fullHistory) && fullHistory.length
      ? fullHistory
      : (Array.isArray(conversationHistory) ? conversationHistory : []);
    const historyForPlanner = _historySource.length
      ? _historySource.slice(-6).map((m) => {
          const role = m.role === "assistant" ? "AI助手" : "用户";
          return `${role}: ${String(m.content || "").slice(0, 300)}`;
        }).join("\n")
      : "";

    const plannerContent = [
      historyForPlanner ? `【对话历史（用于识别是否为修改请求）】\n${historyForPlanner}` : "",
      city ? `城市/区域线索: ${city}` : "",
      constraints.budget ? `预算线索: ${constraints.budget}` : "",
      constraints.party_size ? `人数线索: ${constraints.party_size}人` : "",
      constraints.duration ? `天数线索: ${constraints.duration}天` : "",
      `用户当前消息: ${message}`,
    ].filter(Boolean).join("\n");

    const plannerRes = await openAIRequest({
      apiKey, model: usedModel, baseUrl,
      systemPrompt: PLANNER_SYSTEM_PROMPT,
      userContent: plannerContent,
      temperature: 0.2, maxTokens: 400, jsonMode: true, timeoutMs: 12000,
    });

    plan = safeParseJson(plannerRes.text);

    if (!plan || (!plan.destination && !city)) {
      return {
        ok: true,
        structured: {
          response_type: "clarify",
          spoken_text: language === "ZH"
            ? "您想去哪儿？大概预算是多少？告诉我这两点我马上给您出方案。"
            : "Which city are you heading to, and what's your budget? Tell me these two and I'll build your plan.",
          missing_slots: ["destination", "budget"],
        },
      };
    }
  }

  // ── Node 2: Mock Data injection ──────────────────────────────────────────
  const dest      = plan.destination || city;
  const destArea  = plan.destination_area || "";
  const days      = plan.duration_days || (intentAxis === "food" ? 1 : 3);
  const pax       = plan.pax || 1;
  let budget      = plan.total_budget || constraints.budget || null;
  if (!budget) {
    const bm  = message.match(/(\d[\d,]*)\s*万\s*(?:元|人民币|RMB|CNY|预算)?/i);
    const bm2 = message.match(/(\d[\d,]+)\s*(?:元|人民币|RMB|CNY)/i);
    if (bm)       budget = parseFloat(bm[1].replace(/,/g, "")) * 10000;
    else if (bm2) budget = parseFloat(bm2[1].replace(/,/g, ""));
    // P8.11: food mode uses per-meal estimate; travel uses per-day estimate
    if (!budget)  budget = intentAxis === "food" ? pax * 150 : pax * days * 800;
  }

  const knowledgeContext = _buildKnowledge();
  const lbsResults = [];
  if (Array.isArray(plan.itinerary) && plan.itinerary.length > 1) {
    for (let i = 0; i < plan.itinerary.length - 1; i++) {
      const from = plan.itinerary[i].city;
      const to   = plan.itinerary[i + 1].city;
      const flightData = _queryFlight ? await _queryFlight(from, to) : null;
      const route = flightData
        ? _flightDataToRoute(flightData)
        : mockAmapRouting(from, to);
      if (route) lbsResults.push({ leg: `${from}→${to}`, ...route });
    }
  } else {
    const from = city || "origin";
    const flightData = _queryFlight ? await _queryFlight(from, dest) : null;
    const route = flightData
      ? _flightDataToRoute(flightData)
      : mockAmapRouting(from, dest);
    if (route) lbsResults.push({ leg: `${city || "出发地"}→${dest}`, ...route });
  }

  const originCity = city; // user's GPS / stated departure city
  const budgetPerNight = Math.round(budget * 0.40 / Math.max(days, 1));
  const destCities = Array.isArray(plan.itinerary) && plan.itinerary.length > 1
    ? plan.itinerary.map((s) => s.city) : [dest];

  // ── Geo-Lock: build hotel map ONLY for destination cities ────────────────
  // Never include hotels for the origin/departure city — that data would
  // mislead the Card Generator into generating origin-city content.
  const otaHotels = {};
  await Promise.all(destCities.map(async (c) => {
    const realHotels = _queryHotels ? await _queryHotels(c, budgetPerNight) : null;
    otaHotels[c] = realHotels || mockCtripHotels(c, budgetPerNight);
  }));

  const realApiData = JSON.stringify({ routing: lbsResults, hotels: otaHotels }, null, 2);
  console.log("[Data Injection] Injecting:\n" + realApiData.slice(0, 400));

  // ── Node 3: Card Generator ───────────────────────────────────────────────
  const alloc = plan.allocation || plan.allocation_plan || {};
  const updateNote = plan.is_update
    ? "⚠️ 这是一个修改请求：用户已有行程方案，本次仅修改了部分参数，请生成完整更新后的方案。\n"
    : "";
  const isMultiCity = plan.is_multi_city || (Array.isArray(plan.itinerary) && plan.itinerary.length > 1);
  const itineraryNote = isMultiCity && Array.isArray(plan.itinerary) && plan.itinerary.length
    ? `- ⚠️ 多城市行程: ${plan.itinerary.map((s) => `${s.city}(${s.days || "?"}天)`).join(" → ")} (总${plan.itinerary.reduce((t, s) => t + (Number(s.days) || 0), 0)}天)\n- days 数组必须覆盖所有城市，城市间换乘标记 type:"city_change"\n`
    : "";
  const summaryModeNote = summaryOnly
    ? `\n⚠️ SUMMARY MODE: Generate plans[] with all fields EXCEPT days. Set "days": [] (empty array). Day-by-day activities will be generated separately on demand.\n`
    : "";

  // P8.6: Specialty-mode note — suppresses hotel template for non-accommodation queries
  const _axisToLayout = { food: "food_only", activity: "travel_full", stay: "stay_focus", travel: "travel_full" };
  const targetLayout = _axisToLayout[intentAxis] || "travel_full";
  const specialtyNote = intentAxis === "food"
    ? `\n[专项查询·美食] 当前请求为餐厅/美食专项查询，每个 plan 代表一家餐厅，请严格按以下结构输出：\n` +
      `card_data 顶层必须输出 "layout_type": "food_only"。\n` +
      `每个 plan 对象必须包含以下字段（全部必填，无则填 null）：\n` +
      `  "name":          餐厅真实名称（必须是真实存在的餐厅，如"老孙家羊肉泡馍"）\n` +
      `  "headline":      一句话卖点（如"百年老字号，羊肉泡馍排队首选"）\n` +
      `  "rating":        评分数字（如 4.8，从 Real_API_Data 复制或基于知识库估算）\n` +
      `  "avg_price":     人均消费数字（如 65，单位元人民币）\n` +
      `  "queue_min":     等位时间分钟数（如 20，无需排队填 0）\n` +
      `  "address":       具体地址或商圈（如"西安市莲湖区回民街北广济街"）\n` +
      `  "review":        代表性顾客评价一句话（如"羊肉鲜嫩不膻，泡馍分量十足"）\n` +
      `  "dishes":        招牌菜数组，3-5道，如["羊肉泡馍","腊牛肉夹馍","凉皮"]\n` +
      `  "cuisine_type":  菜系（如"陕西菜"、"川菜"、"粤菜"、"清真菜"）\n` +
      `  "flavor":        口味特征（如"咸鲜微辣"、"浓郁醇厚"）\n` +
      `  "origin":        发源地/代表区域（如"西安回民街"）\n` +
      `  "real_photo_url": 从 Real_API_Data item_list[].photo 原样复制；无则省略\n` +
      `  "tag":           档次标签（"实惠之选"|"口碑首选"|"高端体验"）\n` +
      `  "is_recommended": 口碑首选方案设为 true\n` +
      `严禁出现 hotel 字段。days[] 中每个 activity.name 写"在【餐厅名】享用XX"格式。\n` +
      `⚠️ 真实性要求：禁止编造不存在的餐厅名称，必须是该城市真实知名餐厅。\n`
    : intentAxis === "activity"
    ? `\n[专项查询·景点] 当前请求为景点/活动专项查询，无需填充完整酒店住宿模板。\n` +
      `plans[].highlights 聚焦景点、门票价格、最佳游览时长。\n` +
      `card_data 顶层必须输出 "layout_type": "travel_full"。\n`
    : intentAxis === "stay"
    ? `\n[专项查询·住宿] 当前请求聚焦酒店/住宿对比，无需填充活动行程。\n` +
      `plans[].highlights 聚焦酒店设施、位置便利性、性价比。\n` +
      `card_data 顶层必须输出 "layout_type": "stay_focus"。\n`
    : ``;  // travel: full itinerary, no specialty note

  // Geo-lock directive: when origin ≠ destination, explicitly ban origin-city content
  const geoLocked = originCity && dest && originCity !== dest
    && !dest.includes(originCity) && !originCity.includes(dest);
  const geoNote = geoLocked
    ? `\n🔒 地理锁定（HARD RULE）：目标城市=${dest}，出发城市=${originCity}。\n` +
      `绝对禁止在 hotel.name / activity.name / day.label / transport_plan 中出现"${originCity}"或属于${originCity}的任何酒店/景点/餐厅。\n` +
      `Real_API_Data 的 hotels 键名必须是 "${dest}" 相关条目，若有其他城市条目请完全忽略。\n`
    : "";

  // Pax-aware service hints for families / large groups
  const paxHint = pax >= 5
    ? `\n👨‍👩‍👧‍👦 大家庭出行（${pax}人）：\n` +
      `• transport_plan 必须注明"包商务车/MPV（${pax}人座），门到门接送，省去拼车麻烦"\n` +
      `• 每天餐饮 activity 的 note 必须包含"建议提前预订家庭大桌包间（${pax}人）"\n` +
      `• 酒店推荐家庭房/相邻双间，在 hotel.guest_review 后追加"（有家庭房型）"\n`
    : pax >= 3
    ? `\n👨‍👩‍👦 家庭出行（${pax}人）：transport_plan 建议注明"滴滴/拼车或小型商务车接送"；` +
      `餐厅 note 中建议"提前预订家庭座位"\n`
    : "";

  const cardUserContent = `
${updateNote}${summaryModeNote}${specialtyNote}${geoNote}${paxHint}用户原始需求: ${message}

⚠️ 你是无情的数据组装员。酒店名称/价格/image_keyword 必须且只能使用 <Real_API_Data> 中的数据，绝对禁止编造！

<Real_API_Data>
${realApiData}
</Real_API_Data>

深度需求分析 (Planner 输出):
- 目的地: ${dest}${destArea ? " · " + destArea : ""}
${itineraryNote}- 天数: ${days}天, 人数: ${pax}人
- 抵达日期: ${plan.arrival_date || "待定"}
- 旅行目的: ${plan.trip_purpose || "未指定"}
- 兴趣偏好: ${(plan.interests || []).join("、") || "未指定"}
- 饮食偏好: ${plan.food_preference || "无特殊要求"}
- 特殊需求: ${(plan.special_needs || []).join("、") || "无"}
- 需要翻译: ${plan.language_needs ? "是" : "否"}
- 总预算: ¥${budget}（${plan.budget_assessment || "合理"}）
- 预算分配建议: 住宿¥${alloc.accommodation || Math.round(budget * 0.40)}, 交通¥${alloc.transport || Math.round(budget * 0.12)}, 餐饮¥${alloc.meals || Math.round(budget * 0.25)}, 活动¥${alloc.activities || Math.round(budget * 0.15)}, 杂项¥${alloc.misc || Math.round(budget * 0.08)}
- 取舍建议: ${plan.trade_off || "预算合理，无需取舍"}

本地知识库（景点/餐厅参考，酒店请以 Real_API_Data 为准）:
${knowledgeContext.slice(0, 800)}
${resourceContext ? `\n${resourceContext}\n⚠️ 资源池中的餐厅等位时间和门票状态必须体现在对应 activity 的 note 字段；highlights[] 亮点必须与 days[].activities[].name 的景点名称一致。` : ""}
`.trim();

  const _cardOpts = {
    apiKey, model: usedModel, baseUrl,
    systemPrompt: (contextSummary ? `${contextSummary}\n` : "") + buildCrossXSystemPrompt(language),
    userContent: cardUserContent,
    temperature: 0.5,
    maxTokens: cardMaxTokens || 2200,
    jsonMode: true,
    timeoutMs: cardTimeoutMs || 50000,   // bumped 32s → 50s
  };
  let speakerCardRes = await openAIRequest(_cardOpts);

  // One automatic retry on empty/timeout response
  if (!speakerCardRes.text) {
    console.warn("[Card Generator] First attempt failed — retrying once");
    speakerCardRes = await openAIRequest(_cardOpts);
  }

  let cardData = safeParseJson(speakerCardRes.text);
  if (!cardData) console.warn("[Card Generator] Failed to parse JSON, raw:", speakerCardRes.text?.slice(0, 200));

  // P8.6: Safety net — ensure layout_type is always present in card_data
  if (cardData?.card_data && !cardData.card_data.layout_type) {
    cardData.card_data.layout_type = targetLayout;
  }

  // Speaker: generate natural spoken_text (skipped on fast path)
  const cdPlans = cardData?.card_data?.plans || [];
  const recommendedPlan = cdPlans.find((p) => p.is_recommended) || cdPlans[1] || cdPlans[0] || {};
  const finalDest = cardData?.card_data?.destination || dest;
  const finalDays = cardData?.card_data?.duration_days || days;
  let spokenText = cardData?.spoken_text || (language === "ZH"
    ? `好的，${finalDest}${finalDays}天的方案已为您定制完成。`
    : `Your ${finalDays}-day ${finalDest} plan is ready.`);

  if (!skipSpeaker) {
    const planSummaries = cdPlans.map((p) =>
      `${p.tag}（¥${p.total_price}）: ${p.hotel?.name || ""}，${p.transport_plan || ""}，亮点：${(p.highlights || []).join("/")}`,
    ).join("\n");
    const totalPrice = recommendedPlan?.total_price || budget;
    const hotelName = recommendedPlan?.hotel?.name || `${dest}精选酒店`;

    const speakerRes = await openAIRequest({
      apiKey, model: usedModel, baseUrl,
      systemPrompt: SPEAKER_SYSTEM_PROMPT,
      userContent: `
用户需求: ${message}

后台分析:
- 旅行目的: ${plan.trip_purpose || "旅游"}
- 兴趣偏好: ${(plan.interests || []).join("、") || "综合"}
- 目的地: ${dest}${destArea ? " · " + destArea : ""}，${finalDays}天${pax > 1 ? pax + "人" : ""}
- 总预算: ¥${budget}（${plan.budget_assessment || "合理"}）
- 取舍建议: ${plan.trade_off || "预算合理"}

三个方案对比:
${planSummaries || `推荐酒店: ${hotelName}，总价¥${totalPrice}`}

行程亮点（逐日）: ${cardData?.card_data?.days?.map((d) => d.label).join(" → ") || "逐日定制行程"}
      `.trim(),
      temperature: 0.7, maxTokens: 400, jsonMode: false, timeoutMs: 10000,
    });
    if (speakerRes.ok && speakerRes.text) spokenText = speakerRes.text.trim();
  }

  if (cardData && cardData.response_type === "options_card" && cardData.card_data) {
    cardData.spoken_text = spokenText;

    // ── Post-gen Geo Validation ────────────────────────────────────────────
    // Warn (and log) if any plan's hotel name contains a known origin-city keyword.
    // This is a canary — future versions can trigger a re-gen on violation.
    if (geoLocked) {
      const originKeywords = [originCity, originCity.replace(/市$/, "")];
      const plans = cardData.card_data.plans || [];
      plans.forEach((p) => {
        const hotelName = p.hotel?.name || "";
        const hasOriginData = originKeywords.some((kw) => hotelName.includes(kw));
        if (hasOriginData) {
          console.warn(`[GeoLock] VIOLATION — plan[${p.id}] hotel="${hotelName}" contains origin city "${originCity}". dest="${dest}"`);
        }
      });
      const days = cardData.card_data.days || [];
      let actViolations = 0;
      days.forEach((day) => {
        (day.activities || []).forEach((a) => {
          if (originKeywords.some((kw) => (a.name || "").includes(kw))) actViolations++;
        });
      });
      if (actViolations > 0) {
        console.warn(`[GeoLock] ${actViolations} activity(ies) may reference origin city "${originCity}"`);
      }
    }

    // Store in session for follow-up Q&A
    if (_sessionItinerary && constraints._clientIp) {
      _sessionItinerary.set(constraints._clientIp, {
        card_data: cardData.card_data, dest, storedAt: Date.now(),
      });
    }
    return { ok: true, structured: cardData };
  }

  // Fallback
  return {
    ok: true,
    structured: {
      response_type: "clarify",
      spoken_text: language === "ZH"
        ? "方案生成中遇到问题，请稍后重试或换个说法描述您的需求。"
        : "Encountered an issue generating your plan. Please try rephrasing.",
      missing_slots: [],
    },
  };
}

module.exports = {
  configure,
  isComplexItinerary,
  buildPrePlan,
  buildInventoryContext,
  buildResourceContext,
  generateCrossXResponse,
};
