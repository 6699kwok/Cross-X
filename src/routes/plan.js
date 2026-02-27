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
const { isComplexItinerary, buildPrePlan, generateCrossXResponse } = require("../planner/pipeline");

// ── P1 session + security modules ─────────────────────────────────────────────
const {
  createSession, getSession, patchSession,
  scrubPii, DEFAULT_TTL_MS,
} = require("../session/store");
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
  detectQuickActionIntent, buildQuickActionResponse,
  detectCasualChatIntent, callCasualChat,
  classifyBookingIntent, callPythonRagService, searchAttractions,
  ragEngine, sessionItinerary, extractAgentConstraints,
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
          patchSession(incomingSessionId, { plan: patchResult.patched, message, language, city });
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

      const prePlan = complex ? null : buildPrePlan({ message, city, constraints });

      // Run Coze workflow in parallel with OpenAI for enrichment (hero_image, queue, availability).
      // callCozeWorkflow ALWAYS resolves (synthetic fallback on failure) — cozeEnrichment is never null.
      const [result, cozeEnrichment] = await Promise.all([
        generateCrossXResponse({
          message, language, city,
          constraints: { ...constraints, _clientIp: clientIp },
          conversationHistory,
          apiKey: OPENAI_API_KEY, model: OPENAI_MODEL, baseUrl: OPENAI_BASE_URL,
          prePlan,
          skipSpeaker:  true,
          cardTimeoutMs: complex ? 55000 : 50000,
          cardMaxTokens: complex ? 1400  : 2200,
          summaryOnly:   complex,
        }),
        callCozeWorkflow({ query: message, city, lang: language, budget: budgetVal }),
      ]);

      console.log(`[plan/coze] Coze enrichment: ${cozeEnrichment?._synthetic ? "synthetic" : "live"} — queue=${cozeEnrichment?.restaurant_queue}min ticket=${cozeEnrichment?.ticket_availability}`);

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
          if (outSessionId && getSession(outSessionId)) {
            patchSession(outSessionId, { plan: s.card_data, message, language, city });
          } else {
            outSessionId = createSession(
              { plan: s.card_data, message, language, city },
              DEFAULT_TTL_MS,
            );
          }
          console.log(`[plan/coze] Session ${outSessionId} — plan saved (${s.card_data.title || "untitled"})`);
        }

        emit({
          type: "final", ...s,
          source: "openai",
          sessionId: outSessionId || null,
          coze_data: cozeEnrichment,   // always present (synthetic fallback guaranteed)
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
