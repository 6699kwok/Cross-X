"use strict";
/**
 * src/routes/plan.js
 * Plan route handlers — extracted from server.js
 *
 * P0: Coze parallel race ABOLISHED — OpenAI-only pipeline.
 * P1: Session state (UUID-isolated), UPDATE intent routing, safety hard-stop.
 *
 * External dependencies injected via createPlanRouter() factory.
 */

const { openAIRequest } = require("../ai/openai");
const { DETAIL_SYSTEM_PROMPT_TEMPLATE } = require("../planner/prompts");
const { safeParseJson } = require("../planner/mock");
const { isComplexItinerary, buildPrePlan, generateCrossXResponse, buildResourceContext } = require("../planner/pipeline");
const { extractPreferences, mergePreferences, buildContextSummary, pruneHistory } = require("../conversation/context");
const { runAgentLoop } = require("../agent/loop");
const { detectIntentLLM } = require("../ai/intent");
const { needsDiscovery, runDiscovery } = require("../planner/discovery");

// ── P1 session + security modules ─────────────────────────────────────────────
const {
  createSession, getSession, patchSession, touchSession,
  scrubPii, DEFAULT_TTL_MS,
} = require("../session/store");

// ── C4: Cross-session preference profile ──────────────────────────────────────
const { loadProfile, saveProfile, generateProfileSummary } = require("../session/profile");

// Preferences persist for 7 days — survives across days without user auth
const PREF_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const { looksLikeUpdate, applyPlanPatch } = require("../session/updater");

// ── Safety hard-stop: must match the fixed template in BUSINESS_BOUNDARY_BLOCK ─
// (src/planner/prompts.js → BUSINESS_BOUNDARY_BLOCK)
const BOUNDARY_MARKER = "专注于旅行规划的 AI 助手";

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
  /忽略.{0,10}(前面|上面|之前|系统).{0,10}指令/,
  /扮演.{0,10}(另一个|其他|不同).{0,10}AI/,
  /帮(我|你)写.{0,6}(代码|脚本|程序)/,
  /爬取.{0,10}(网站|数据|携程|美团)/,
  /DAN|jailbreak|prompt injection/i,
];
function isInjectionAttack(text) {
  if (!text) return false;
  return INJECTION_PATTERNS.some((re) => re.test(text));
}

// ── Coze output enrichment: fill real_vibes + insider_tips via OpenAI ────────
/**
 * After Coze bot returns card_data, all activity real_vibes/insider_tips are empty.
 * This function fills them with a single compact OpenAI call (5s budget).
 * Returns enriched card_data, or original on any error.
 */
async function enrichCozeActivities(card_data, { apiKey, model, baseUrl }) {
  try {
    // Collect activities missing real_vibes or insider_tips (skip transport)
    const targets = [];
    for (const day of card_data.days || []) {
      for (const act of day.activities || []) {
        if (act.type !== "transport" && (!act.real_vibes || !act.insider_tips)) {
          targets.push({ name: act.name, type: act.type });
        }
      }
    }
    if (!targets.length) return card_data;

    const dest = card_data.destination || "";
    const result = await openAIRequest({
      apiKey, model, baseUrl,
      systemPrompt: `\u4f60\u662f\u65c5\u6e38\u6587\u6848\u4e13\u5bb6\u3002\u4e3a${dest}\u7684\u4ee5\u4e0b\u5730\u70b9\u586b\u5199 real_vibes\uff08\u6c1b\u56f4\u611f\u53d7\uff0c8\u5b57\u4ee5\u5185\uff09\u548c insider_tips\uff08\u5b9e\u7528\u8d34\u58eb\uff0c15\u5b57\u4ee5\u5185\uff09\u3002\u8fd4\u56de JSON \u6570\u7ec4\uff0c\u6bcf\u9879\u5305\u542b name\u3001real_vibes\u3001insider_tips\u3002`,
      userContent: JSON.stringify(targets),
      maxTokens: 600,
      jsonMode: true,
      timeoutMs: 5000,
    });
    if (!result.ok) return card_data;

    let enriched;
    try { enriched = JSON.parse(result.text); } catch { return card_data; }
    const list = Array.isArray(enriched) ? enriched
      : (enriched.list || enriched.activities || enriched.data || enriched.items || []);
    if (!list.length) return card_data;

    const lookup = Object.fromEntries(list.filter(i => i.name).map(i => [i.name, i]));
    const patched = JSON.parse(JSON.stringify(card_data));
    for (const day of patched.days || []) {
      for (const act of day.activities || []) {
        const p = lookup[act.name];
        if (p) {
          if (!act.real_vibes   && p.real_vibes)   act.real_vibes   = p.real_vibes;
          if (!act.insider_tips && p.insider_tips)  act.insider_tips = p.insider_tips;
        }
      }
    }
    console.log(`[coze/enrich] Filled ${list.length} activities for ${dest}`);
    return patched;
  } catch (e) {
    console.warn("[coze/enrich] Error:", e.message);
    return card_data;
  }
}

// ── P8.6: Intent axis detector ───────────────────────────────────────────────
// Determines the primary intent of the user message to enable specialty mode.
// Returns: "food" | "activity" | "stay" | "travel" (default full itinerary)
function detectIntentAxis(message) {
  if (/餐厅|美食|好吃|推荐.*吃|吃什么|特色菜|小吃|eat|restaurant|food|dining|meal/i.test(message)) return "food";
  if (/景点|游览|门票|博物馆|景区|打卡|scenic|attraction|museum|sightseeing/i.test(message)) return "activity";
  if (/酒店|住宿|宾馆|民宿|hotel|hostel|stay|accommodation/i.test(message)) return "stay";
  return "travel";
}

// ── P8.8: Requirement completeness gate ──────────────────────────────────────
// Explicit city/destination detection regex (covers mainland China + common international)
const CITY_MENTION_RE = /北京|上海|深圳|广州|成都|重庆|杭州|苏州|西安|南京|三亚|丽江|大理|桂林|张家界|黄山|青岛|厦门|拉萨|哈尔滨|新疆|乌鲁木齐|武汉|长沙|贵阳|昆明|天津|福州|宁波|济南|郑州|大连|沈阳|长春|合肥|南昌|石家庄|呼和浩特|银川|兰州|西宁|香港|澳门|台北|东京|大阪|首尔|曼谷|巴黎|伦敦|纽约|新加坡|吐鲁番|敦煌|西双版纳/;

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

  // activity / stay / travel: only duration matters; budget has a reliable default
  if (!hasDuration) return ["duration"];
  return [];
}

// ── Follow-up suggestions by intent axis ─────────────────────────────────────
const FOLLOW_UP_SUGGESTIONS = {
  travel:   ["想调整预算", "多一天行程", "深挖一下美食"],
  food:     ["换个口味风格", "再加一个餐厅", "附近还有什么好吃的"],
  stay:     ["换便宜一点的", "换个区域", "看看民宿"],
  activity: ["加一个景点", "换轻松一点的", "有没有门票优惠"],
};

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
  const slotLabels = {
    destination: language === "ZH" ? "目的地城市" : "destination city",
    duration:    language === "ZH" ? "行程天数"   : "trip duration",
    budget:      language === "ZH" ? "预算"       : "budget",
  };
  const slotsText = missingSlots.map((s) => slotLabels[s] || s).join("，");

  if (!apiKey || language !== "ZH") return null; // only ZH conversational; EN uses hardcoded

  try {
    const r = await openAIRequest({
      apiKey, model, baseUrl,
      systemPrompt: "\u4f60\u662f\u70ed\u60c5\u7684\u65c5\u884c\u52a9\u624b\u3002\u7528\u4e00\u53e5\u53e3\u8bed\u95ee\u51fa\u7f3a\u5c11\u7684\u4fe1\u606f\uff0c\u7981\u6b62\u7528\u201c\u60a8\u597d\u201d\uff0c\u7981\u6b62\u8bf4\u201c\u6211\u9700\u8981\u201d\uff0c\u76f4\u63a5\u95ee\u3002\u5185\u5bb9\u5c3120\u5b57\u5185\u3002\u53ea\u8f93\u51fa\u95ee\u53e5\uff0c\u4e0d\u8981\u4efb\u4f55\u89e3\u91ca\u3002",
      userContent: `\u7528\u6237\u8bf4\uff1a${effectiveMessage}\n\u8fd8\u9700\u8981\u95ee\uff1a${slotsText}`,
      temperature: 0.7, maxTokens: 60, jsonMode: false, timeoutMs: 3000,
    });
    if (r.ok && r.text) return r.text.trim().replace(/^["']|["']$/g, "");
  } catch (e) {
    console.warn("[clarify-llm] Timeout/error — using hardcoded fallback:", e.message);
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
function createPlanRouter({
  readBody, writeJson, normalizeLang, pickLang, db,
  getOpenAIConfig,
  getCozeConfig,
  callCozeWorkflow,
  callCozeBotStreaming,
  detectQuickActionIntent, buildQuickActionResponse,
  detectCasualChatIntent, callCasualChat,
  classifyBookingIntent, callPythonRagService, searchAttractions,
  ragEngine, sessionItinerary, extractAgentConstraints,
  // Agent loop deps (Module 2 tools)
  queryAmapHotels, queryJuheFlight, mockAmapRouting, mockCtripHotels, buildAIEnrichment,
}) {

  // ── POST /api/plan/coze — OpenAI Planning Pipeline (SSE) ──────────────────
  // P0: Coze race abolished, OpenAI only, no thinking panel.
  // P1: PII scrub → looksLikeUpdate routing → session save → safety hard-stop.
  async function handleCoze(req, res) {
    const body = await readBody(req);

    // [S3] PII scrub: strip phone/email/ID/card BEFORE any LLM call or session write
    const rawMessage = String(body.message || "").trim();
    if (!rawMessage) return writeJson(res, 400, { error: "message required" });
    const message = scrubPii(rawMessage);

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
        spoken_text:   "抱歉，我是专注于旅行规划的 AI 助手，无法处理此类请求。如果您有旅行计划需要帮助，我很乐意为您安排！",
        source:        "input-guard",
      })}\n\n`);
      res.end();
      return;
    }

    const { apiKey: OPENAI_API_KEY, model: OPENAI_MODEL, keyHealth: OPENAI_KEY_HEALTH, baseUrl: OPENAI_BASE_URL } = getOpenAIConfig();
    const language        = normalizeLang(body.language || db.users.demo.language || "ZH");
    const cityRaw         = String(body.city || db.users.demo.city || "Shanghai");
    const city            = cityRaw.split("·")[0].trim() || "Shanghai";
    const constraints     = body.constraints && typeof body.constraints === "object" ? body.constraints : {};
    const conversationHistory = Array.isArray(body.conversationHistory) ? body.conversationHistory : [];

    // [P1] Session: resolve incoming sessionId and load existing data (if any)
    const incomingSessionId = String(body.sessionId || "").trim();
    const existingSession   = incomingSessionId ? getSession(incomingSessionId) : null;

    // [C4] Cross-session preference profile — keyed by deviceId from client localStorage
    const deviceId    = String(body.deviceId || "").trim().slice(0, 64) || null;
    const userProfile = deviceId ? loadProfile(deviceId) : null;
    if (userProfile) console.log(`[profile] loaded deviceId=${deviceId.slice(0, 8)}… prefs=[${Object.keys(userProfile.preferences || {}).join(",")}] trips=${userProfile.tripCount}`);

    // [Context] Restore stored preferences + history; merge with browser state
    // Layer order (lowest → highest priority): profile → session → incoming turn
    const storedPrefs   = mergePreferences(userProfile?.preferences || {}, existingSession?.preferences || {});
    const storedHistory = Array.isArray(existingSession?.history) ? existingSession.history : [];
    // mergedHistory: prefer stored (server-side) + any extra turns from browser not yet persisted
    const mergedHistory = pruneHistory([...storedHistory, ...conversationHistory
      .filter((m) => !storedHistory.some((s) => s.content === m.content && s.role === m.role))], 12);

    // SSE headers — sent here so ALL paths below can use emit()
    res.writeHead(200, {
      "Content-Type":      "text/event-stream",
      "Cache-Control":     "no-cache",
      "Connection":        "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const emit  = (data) => { try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch {} };
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));

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
      const chatText = await callCasualChat({ message, language, city });
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
      const clientIpRag = req.socket?.remoteAddress || req.connection?.remoteAddress || "default";

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
            ragAnswer = `根据景点数据库找到以下相关景点：\n\n${localAttractions.slice(0, 3).map((a) =>
              `📍 **${a.name}**（${a.city}，⭐${a.rating}）\n🕐 ${a.hours || "请查询官方"}\n🎟 ${a.ticket || "请查询门票"}\n📝 ${a.intro.slice(0, 100)}`
            ).join("\n\n")}`;
            ragSource = "local-kb";
          }
        }
      }

      // 3. CrossX general RAG engine
      if (!ragAnswer && OPENAI_API_KEY) {
        try {
          const prevItin = sessionItinerary.get(clientIpRag);
          const itinCtx  = prevItin && (Date.now() - prevItin.storedAt < 7200000)
            ? `\n\n[已生成的行程方案参考]:\n${JSON.stringify(prevItin.card_data, null, 2).slice(0, 1800)}`
            : "";
          const ragResult = await ragEngine.retrieveAndGenerate({
            query: message + itinCtx, audience: "b2c", language,
            openaiApiKey: OPENAI_API_KEY, topK: 4,
          });
          if (ragResult.ragUsed && ragResult.answer) {
            ragAnswer = ragResult.answer;
            ragSource = "crossx-rag";
          }
        } catch (e) { console.warn("[plan/coze/rag]", e.message); }
      }

      // 4. LLM chat with session context as last resort
      if (!ragAnswer) {
        try {
          const prevItin = sessionItinerary.get(clientIpRag);
          const itinCtx  = prevItin && (Date.now() - prevItin.storedAt < 7200000)
            ? `\n\n[用户已生成行程供参考，目的地: ${prevItin.dest || ""}]:\n${JSON.stringify(prevItin.card_data, null, 2).slice(0, 1200)}`
            : "";
          const chatRes = await callCasualChat({ message: message + itinCtx, language, city });
          ragAnswer = chatRes?.ok ? chatRes.text : (typeof chatRes === "string" ? chatRes : null);
          if (ragAnswer) ragSource = "openai-chat";
        } catch (e) { console.warn("[plan/coze/rag/fallback]", e.message); }
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
      console.log(`[plan/coze] UPDATE intent detected — patching session ${incomingSessionId}`);
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
        console.warn("[plan/coze] UPDATE path error:", e.message);
        emit({ type: "error", msg: pickLang(language,
          "修改方案时遇到问题，请重试。",
          "Failed to update the plan. Please retry.",
          "プランの修正に失敗しました。",
          "플랜 수정에 실패했습니다.",
        ), detail: e.message });
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
        const t = setTimeout(r, ms);
        const check = setInterval(() => {
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

    // Extract budget for Coze parameters
    const budgetVal = constraints.budget
      ? String(constraints.budget).replace(/[^0-9]/g, "") || constraints.budget
      : "";

    try {
      if (!(OPENAI_API_KEY && OPENAI_KEY_HEALTH.looksValid)) {
        throw new Error("OpenAI not configured or key invalid");
      }

      // P8.10: Merge slot-fill answer with original message from pendingClarify
      let effectiveMessage = message;
      const _pc = existingSession?.pendingClarify;
      if (_pc?.originalMessage) {
        effectiveMessage = `${_pc.originalMessage} ${message}`.trim();
        patchSession(incomingSessionId, { pendingClarify: null });
        console.log(`[plan/coze] Slot-fill merge: "${_pc.originalMessage}" + "${message}" -> "${effectiveMessage}"`);
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
        console.log(`[plan/coze] Discovery merge: "${priorMsg}" + follow-up \u2192 "${effectiveMessage.slice(0, 80)}"`);
      }

      // B1+C3: Detect intent axis + extract preferences via LLM (single call).
      // Falls back to regex on timeout/error. Extracts axis, destination, duration,
      // pax, and user preference flags (has_children, pace_slow, etc.) simultaneously.
      const intentResult = await detectIntentLLM(effectiveMessage, {
        apiKey: OPENAI_API_KEY, model: OPENAI_MODEL, baseUrl: OPENAI_BASE_URL,
      });
      const intentAxis = intentResult.axis;
      if (intentAxis !== "travel") console.log(`[plan/coze] Intent axis: ${intentAxis} (${intentResult._source}) — specialty mode`);

      // Merge LLM-extracted params into constraints (without overwriting explicit user values)
      if (intentResult.destination  && !constraints.destination) constraints.destination = intentResult.destination;
      if (intentResult.duration_days && !constraints.duration)   constraints.duration    = intentResult.duration_days;
      if (intentResult.pax > 2       && !constraints.pax)        constraints.pax         = intentResult.pax;
      if (intentResult.special_needs?.length)                     constraints._specialNeeds = intentResult.special_needs;

      // C3: Use LLM-extracted preferences when available; fallback to regex.
      const incomingPrefs = (intentResult._source === "llm" && Object.keys(intentResult.preferences || {}).length)
        ? intentResult.preferences
        : extractPreferences(effectiveMessage);
      const mergedPrefs   = mergePreferences(storedPrefs, incomingPrefs);
      const contextSummary = buildContextSummary(mergedPrefs);
      if (contextSummary) console.log(`[plan/coze] Context: ${contextSummary}`);

      // C4: Prepend semantic traveler portrait (LLM-generated, from cross-session profile)
      const profileSummary = userProfile?.profileSummary || null;
      const fullContext = [
        profileSummary ? `【旅行者画像】${profileSummary}` : "",
        contextSummary,
      ].filter(Boolean).join("\n");

      const prePlan = complex ? null : buildPrePlan({ message: effectiveMessage, city, constraints, intentAxis });

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
        console.log(`[plan/coze] Requirement gate — missing: ${missingSlots.join(", ")}`);

        // Conversational clarification: LLM natural question (ZH only, 3s timeout)
        const conversationalText = await buildConversationalClarify(
          OPENAI_API_KEY, OPENAI_MODEL, OPENAI_BASE_URL, effectiveMessage, missingSlots, language,
        );
        const clarifyText = conversationalText || pickLang(language,
          `请告诉我您的${asked}，我马上为您量身定制方案。`,
          `Hi! Please share your ${asked} and I'll build your custom plan right away.`,
          `${asked}を教えてください。すぐにプランを作ります。`,
          `${asked}를 알려주시면 바로 맞춤 플랜을 만들겠습니다.`);

        emit({
          type: "final", response_type: "clarify",
          spoken_text: clarifyText,
          missing_slots: missingSlots,
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
      if (!didDiscoveryMerge && needsDiscovery(effectiveMessage, intentAxis, _discoverySession)) {
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
          discoverySessionId = createSession(discoveryPayload, DEFAULT_TTL_MS);
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

      // ── Coze Bot: primary plan generator (real plugin data) ─────────────────
      // Try bot first; if it returns a valid options_card, emit directly.
      // Falls through to agent loop on failure / timeout.
      if (typeof callCozeBotStreaming === "function") {
        emit({ type: "status", code: "H_SEARCH", label: pickLang(language,
          "\u6b63\u5728\u67e5\u8be2\u5b9e\u65f6\u65c5\u6e38\u8d44\u6e90...",
          "Fetching live travel data...",
          "\u65c5\u884c\u30c7\u30fc\u30bf\u3092\u53d6\u5f97\u4e2d...",
          "\uc2e4\uc2dc\uac04 \uc5ec\ud589 \ub370\uc774\ud130 \uc870\ud68c \uc911...") });

        const _botUserId = deviceId || incomingSessionId || "crossx_user";
        const botResult  = await callCozeBotStreaming(
          effectiveMessage,
          _botUserId,
          (text) => emit({ type: "status", code: "H_SEARCH", label: text }),
          160000,
          (chunk) => emit({ type: "thinking", text: chunk }),
        );

        if (botResult.ok && botResult.card_data) {
          // Bot succeeded — save session + emit final, skip OpenAI pipeline
          emit({ type: "status", code: "H_SEARCH", label: pickLang(language, "\u5b9e\u65f6\u6570\u636e\u6574\u5408\u5b8c\u6210", "Live data integrated", "\u30c7\u30fc\u30bf\u7d71\u5408\u5b8c\u4e86", "\ub370\uc774\ud130 \ud1b5\ud569 \uc644\ub8cc") });
          emit({ type: "status", code: "T_CALC",   label: pickLang(language, "\u4ea4\u901a\u6838\u7b97\u5b8c\u6210", "Transport calculated", "\u4ea4\u901a\u8cbb\u78ba\u5b9a", "\uad50\ud1b5\ube44 \ud655\uc815") });
          emit({ type: "status", code: "B_CHECK",  label: pickLang(language, "\u9884\u7b97\u6821\u9a8c\u5b8c\u6210", "Budget verified", "\u4e88\u7b97\u78ba\u5b9a", "\uc608\uc0b0 \ud655\uc815") });

          // Enrich Coze card with real_vibes + insider_tips (5s budget, fallback to original)
          emit({ type: "status", code: "B_CHECK", label: pickLang(language, "\u6574\u5408\u666f\u70b9\u5185\u5bb9...", "Enhancing details...", "\u30b3\u30f3\u30c6\u30f3\u30c4\u6574\u5099\u4e2d...", "\ucf58\ud150\uce20 \uc815\ub9ac \uc911...") });
          const _enrichedCard = await enrichCozeActivities(botResult.card_data, {
            apiKey: OPENAI_API_KEY, model: OPENAI_MODEL, baseUrl: OPENAI_BASE_URL,
          });

          let outSessionId = incomingSessionId;
          const _botCard = _enrichedCard;
          const _newTurn = { role: "user", content: effectiveMessage };
          const _updatedHistory = pruneHistory([...mergedHistory, _newTurn], 12);
          const _sessionPayload = {
            plan: _botCard, message: effectiveMessage, language, city,
            preferences: mergedPrefs, history: _updatedHistory,
          };
          if (outSessionId && getSession(outSessionId)) {
            patchSession(outSessionId, _sessionPayload);
          } else {
            outSessionId = createSession(_sessionPayload, DEFAULT_TTL_MS);
          }
          if (outSessionId && Object.keys(mergedPrefs).length > 0) {
            touchSession(outSessionId, PREF_TTL_MS);
          }
          console.log(`[plan/coze] Bot OK — session ${outSessionId} (${_botCard.title || "untitled"})`);

          // [C4] Async profile save
          if (deviceId) {
            const _dest2 = intentResult?.destination || city || null;
            const _trips2 = (userProfile?.tripCount || 0) + 1;
            setImmediate(async () => {
              try {
                let summary = userProfile?.profileSummary || null;
                if (!summary || _trips2 % 3 === 0) {
                  summary = await generateProfileSummary(mergedPrefs, {
                    apiKey: OPENAI_API_KEY, model: OPENAI_MODEL, baseUrl: OPENAI_BASE_URL,
                  });
                }
                saveProfile(deviceId, mergedPrefs, _dest2, summary);
              } catch (_e) { console.warn("[profile] async save error:", _e.message); }
            });
          }

          const _followUp = FOLLOW_UP_SUGGESTIONS[intentAxis] || FOLLOW_UP_SUGGESTIONS.travel;
          emit({
            type: "final",
            response_type: "options_card",
            spoken_text:   botResult.spoken_text,
            card_data:     _botCard,
            source:        "coze",
            sessionId:     outSessionId || null,
            coze_data:     null,
            follow_up_suggestions: _followUp,
          });
          res.end();
          return;
        }

        console.log("[plan/coze] Bot failed/timeout — falling back to agent loop");
      }

      // Agent loop — agent autonomously decides what data to fetch via tools (parallel execution).
      const agentDeps = {
        queryAmapHotels, queryJuheFlight, mockAmapRouting, mockCtripHotels, buildAIEnrichment,
        callCozeWorkflow,
      };
      let result = await runAgentLoop({
        message: effectiveMessage, language, city,
        constraints: { ...constraints, _clientIp: clientIp },
        contextSummary: fullContext,
        history: mergedHistory,
        apiKey: OPENAI_API_KEY, model: OPENAI_MODEL, baseUrl: OPENAI_BASE_URL,
        intentAxis,
        deps: agentDeps,
        emit,
      });

      // Agent path: attach enrichmentData collected from tool results for detail view
      if (result.ok && result.enrichmentData) {
        result._cozeEnrichment = result.enrichmentData;
      }

      // Fallback: agent loop parse failure → original 3-node pipeline with Coze pre-enrichment.
      if (!result.ok) {
        console.warn("[plan/coze] Agent loop failed — falling back to pipeline");
        // Use destination city (from intent extraction) for enrichment, not departure city
        const destCity = constraints.destination || intentResult?.destination || city;
        const cozeEnrichment = await callCozeWorkflow({ query: effectiveMessage, city: destCity, lang: language, budget: budgetVal, intentAxis });
        console.log(`[plan/coze/fallback] Coze: ${cozeEnrichment?._synthetic ? "synthetic" : "live"} — queue=${cozeEnrichment?.restaurant_queue}min`);
        const resourceContext = buildResourceContext(cozeEnrichment, city, effectiveMessage, constraints, intentAxis);
        result = await generateCrossXResponse({
          message: effectiveMessage, language, city,
          constraints: { ...constraints, _clientIp: clientIp },
          conversationHistory,
          apiKey: OPENAI_API_KEY, model: OPENAI_MODEL, baseUrl: OPENAI_BASE_URL,
          prePlan,
          resourceContext,
          intentAxis,
          contextSummary: fullContext,
          fullHistory: mergedHistory,
          skipSpeaker:  true,
          cardTimeoutMs: complex ? 40000 : 35000,
          cardMaxTokens: complex ? 1400  : 2200,
          summaryOnly:   complex,
        });
        result._cozeEnrichment = cozeEnrichment;

        // Photo injection for fallback path — coze enrichment item_list → activities/meals
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
            console.log(`[plan/coze/fallback] Photo injection: ${photoMap.size} items`);
          }
        }
      }

      planDone = true;

      if (result.ok && result.structured) {
        const s = result.structured;

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
        let outSessionId = incomingSessionId;
        if (s.response_type === "options_card" && s.card_data) {
          // Build updated history with this turn appended
          const newTurn = { role: "user", content: effectiveMessage };
          const updatedHistory = pruneHistory([...mergedHistory, newTurn], 12);
          const sessionPayload = {
            plan: s.card_data, message: effectiveMessage, language, city,
            preferences: mergedPrefs,
            history: updatedHistory,
          };
          if (outSessionId && getSession(outSessionId)) {
            patchSession(outSessionId, sessionPayload);
          } else {
            outSessionId = createSession(sessionPayload, DEFAULT_TTL_MS);
          }
          // Extend TTL to 7 days when user has accumulated preferences — cross-day memory
          if (outSessionId && Object.keys(mergedPrefs).length > 0) {
            touchSession(outSessionId, PREF_TTL_MS);
          }
          console.log(`[plan/coze] Session ${outSessionId} — plan saved (${s.card_data.title || "untitled"})`);

          // [C4] Async profile save — fire-and-forget, does not block response
          if (deviceId) {
            const _dest = intentResult.destination || city || null;
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
                console.log(`[profile] saved deviceId=${deviceId.slice(0, 8)}… trips=${_tripCount}${summary ? ` summary="${summary}"` : ""}`);
              } catch (e) {
                console.warn("[profile] async save error:", e.message);
              }
            });
          }
        }

        // Follow-up suggestions based on intent axis
        const followUpSuggestions = FOLLOW_UP_SUGGESTIONS[intentAxis] || FOLLOW_UP_SUGGESTIONS.travel;

        emit({
          type: "final", ...s,
          source: "openai",
          sessionId: outSessionId || null,
          coze_data: result._cozeEnrichment || null,   // present on fallback path; null on agent path
          follow_up_suggestions: followUpSuggestions,
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
      console.warn("[plan/coze] Pipeline error:", e.message);
      emit({ type: "error", msg: pickLang(language,
        "抱歉，行程方案生成遇到问题，请稍后重试或换个方式描述需求。",
        "Sorry, we couldn't generate your plan. Please retry or rephrase.",
        "プランの生成に失敗しました。しばらく待ってから再試行してください。",
        "플랜 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.",
      ), detail: e.message });
    }

    res.end();
  }

  // ── POST /api/plan/detail — On-demand day-by-day itinerary (JSON) ─────────
  // Called after summaryOnly card; generates days in 5-day batches.
  // No session integration needed here — detail is ephemeral display data.
  async function handleDetail(req, res) {
    const body = await readBody(req);
    const { message, city, constraints, planSummary } = body;
    if (!message || !planSummary) return writeJson(res, 400, { error: "message and planSummary required" });

    const { apiKey, model: OPENAI_MODEL, baseUrl } = getOpenAIConfig();
    if (!apiKey) return writeJson(res, 503, { error: "OpenAI not configured" });

    const dest      = planSummary.destination || city || "中国";
    const totalDays = planSummary.duration_days || constraints?.duration || 3;
    const budget    = planSummary.total_price
      || (constraints?.budget ? Number(String(constraints.budget).replace(/[^0-9]/g, "")) : 5000);
    const tier      = planSummary.tier || "balanced";
    const transport = planSummary.transport_plan || "";
    const hotelNote = planSummary.hotel?.name || "";

    const BATCH    = 2;   // 2 days/batch — safe for all tiers on gpt-4o-mini (≤45s)
    const startDay = Math.max(1, Number(body.startDay) || 1);
    const endDay   = Math.min(totalDays, startDay + BATCH - 1);
    const hasMore  = endDay < totalDays;

    const systemPrompt = DETAIL_SYSTEM_PROMPT_TEMPLATE({ tier, startDay, endDay, totalDays });
    const userContent  = [
      `用户需求: ${scrubPii(String(message))}`,  // [S3] PII scrub on user content
      `方案: ${dest} | ${totalDays}天 | ¥${budget} | ${tier}`,
      `交通: ${transport}`,
      `住宿: ${hotelNote}`,
      `请生成 Day ${startDay}-Day ${endDay} 的行程`,
    ].join("\n");

    // [Input Guard] off-topic / injection check on detail endpoint too
    if (isInjectionAttack(String(message))) {
      return writeJson(res, 400, { ok: false, error: "Input rejected by security guard" });
    }

    const result = await openAIRequest({
      apiKey, model: OPENAI_MODEL, baseUrl,
      systemPrompt, userContent,
      temperature: 0.5, maxTokens: 2800,
      jsonMode: true, timeoutMs: 45000,
    });

    const parsed = safeParseJson(result.text);
    if (!parsed || !Array.isArray(parsed.days) || !parsed.days.length) {
      console.warn("[plan/detail] Failed to parse days, raw:", result.text?.slice(0, 200));
      return writeJson(res, 500, { ok: false, error: "Failed to generate itinerary detail" });
    }

    console.log(`[plan/detail] Generated days ${startDay}-${endDay} (${parsed.days.length} days) for ${dest}`);
    return writeJson(res, 200, {
      ok: true,
      days: parsed.days,
      arrival_note: parsed.arrival_note || "",
      hasMore,
      nextStartDay: hasMore ? endDay + 1 : null,
      totalDays,
    });
  }

  return { handleCoze, handleDetail };
}

module.exports = { createPlanRouter };
