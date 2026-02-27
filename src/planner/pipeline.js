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

// ── Injected dependencies (set once at server startup) ───────────────────────
let _buildKnowledge = () => "";
let _extractConstraints = (msg, ctx) => ({ city: null, duration: null, budget: null, party_size: null, service_types: [] });
let _sessionItinerary = null; // Will be the Map from server.js

/**
 * Call once at startup to inject server.js-level dependencies.
 * @param {object} deps
 * @param {function} deps.buildChinaTravelKnowledge
 * @param {function} deps.extractAgentConstraints
 * @param {Map}      deps.sessionItinerary
 */
function configure({ buildChinaTravelKnowledge, extractAgentConstraints, sessionItinerary }) {
  if (buildChinaTravelKnowledge) _buildKnowledge = buildChinaTravelKnowledge;
  if (extractAgentConstraints) _extractConstraints = extractAgentConstraints;
  if (sessionItinerary) _sessionItinerary = sessionItinerary;
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
function buildPrePlan({ message, city, constraints }) {
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

  const days = Number(extracted.duration || constraints.duration || constraints.days || 3);
  const pax = Number(extracted.party_size || constraints.party_size || constraints.pax || 2);
  let budget = Number(extracted.budget || constraints.budget || 0);
  if (!budget) {
    const bm  = message.match(/(\d[\d,]*)\s*万\s*(?:元|人民币|RMB|CNY|预算)?/i);
    const bm2 = message.match(/(\d[\d,]+)\s*(?:元|人民币|RMB|CNY)/i);
    const bm3 = message.match(/(?:预算|budget)[^\d]*(\d[\d,]+)/i);
    if (bm)       budget = parseFloat(bm[1].replace(/,/g, "")) * 10000;
    else if (bm2) budget = parseFloat(bm2[1].replace(/,/g, ""));
    else if (bm3) budget = parseFloat(bm3[1].replace(/,/g, ""));
    if (!budget)  budget = pax * days * 800;
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
 * @returns {Promise<{ok: boolean, structured: object}>}
 */
async function generateCrossXResponse({
  message, language, city, constraints, conversationHistory,
  apiKey, model, baseUrl,
  prePlan, skipSpeaker,
  cardTimeoutMs, cardMaxTokens,
  summaryOnly,
}) {
  const usedModel = model;
  let plan;

  // ── Node 1: Planner ──────────────────────────────────────────────────────
  if (prePlan) {
    plan = prePlan;
  } else {
    const historyForPlanner = Array.isArray(conversationHistory) && conversationHistory.length
      ? conversationHistory.slice(-6).map((m) => {
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
  const days      = plan.duration_days || 3;
  const pax       = plan.pax || 1;
  let budget      = plan.total_budget || constraints.budget || null;
  if (!budget) {
    const bm  = message.match(/(\d[\d,]*)\s*万\s*(?:元|人民币|RMB|CNY|预算)?/i);
    const bm2 = message.match(/(\d[\d,]+)\s*(?:元|人民币|RMB|CNY)/i);
    if (bm)       budget = parseFloat(bm[1].replace(/,/g, "")) * 10000;
    else if (bm2) budget = parseFloat(bm2[1].replace(/,/g, ""));
    if (!budget)  budget = pax * days * 800;
  }

  const knowledgeContext = _buildKnowledge();
  const lbsResults = [];
  if (Array.isArray(plan.itinerary) && plan.itinerary.length > 1) {
    for (let i = 0; i < plan.itinerary.length - 1; i++) {
      const route = mockAmapRouting(plan.itinerary[i].city, plan.itinerary[i + 1].city);
      if (route) lbsResults.push({ leg: `${plan.itinerary[i].city}→${plan.itinerary[i + 1].city}`, ...route });
    }
  } else {
    const route = mockAmapRouting(city || "origin", dest);
    if (route) lbsResults.push({ leg: `${city || "出发地"}→${dest}`, ...route });
  }

  const budgetPerNight = Math.round(budget * 0.40 / Math.max(days, 1));
  const destCities = Array.isArray(plan.itinerary) && plan.itinerary.length > 1
    ? plan.itinerary.map((s) => s.city) : [dest];
  const otaHotels = {};
  destCities.forEach((c) => { otaHotels[c] = mockCtripHotels(c, budgetPerNight); });

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

  const cardUserContent = `
${updateNote}${summaryModeNote}用户原始需求: ${message}

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
`.trim();

  const _cardOpts = {
    apiKey, model: usedModel, baseUrl,
    systemPrompt: buildCrossXSystemPrompt(language),
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
  generateCrossXResponse,
};
