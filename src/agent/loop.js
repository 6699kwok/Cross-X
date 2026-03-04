"use strict";
/**
 * src/agent/loop.js
 * AI-native streaming agent loop.
 *
 * Hybrid strategy:
 *   Tool-call rounds  → openAIStream (streaming) — real-time thinking panel
 *   Final card round  → openAIRequest (jsonMode:true) — guaranteed parseable JSON
 *
 * Parallel tool execution: all tool_calls in a round run concurrently.
 * Max rounds: MAX_TOOL_ROUNDS tool-call rounds + 1 final non-streaming round.
 */

const { openAIStream, openAIRequest } = require("../ai/openai");
const { buildCrossXSystemPrompt }      = require("../planner/prompts");
const { safeParseJson }                = require("../planner/mock");
const { TOOL_DEFINITIONS, executeTool } = require("./tools");

// Compact system prompt for the agent final generation round.
// Replaces the full 7000-char buildCrossXSystemPrompt to save ~1500 input tokens.
function buildAgentFinalSystemPrompt(language) {
  const isZH = language === "ZH";
  return (isZH
    ? "你是 CrossX 旅行规划 AI。"
    : "You are CrossX, a travel planning AI. ")
    + (isZH
    ? "输出 JSON，包含: response_type:\"options_card\", spoken_text:<1句>, card_data:{title,destination,duration_days,pax,plans:[{id,tag,hotel:{name,type,price_per_night,hero_image:\"\"},transport_plan,total_price,highlights:[],budget_breakdown:{}}],days:[{day,label,activities:[{time,type,name,note,cost,image_url,real_vibes,insider_tips}],meals:[]}],layout_type,arrival_note}。"
    : "Output JSON with: response_type:\"options_card\", spoken_text:<1 sentence>, card_data:{title,destination,duration_days,pax,plans:[{id,tag,hotel:{name,type,price_per_night,hero_image:\"\"},transport_plan,total_price,highlights:[],budget_breakdown:{}}],days:[{day,label,activities:[{time,type,name,note,cost,image_url,real_vibes,insider_tips}],meals:[]}],layout_type,arrival_note}.")
    + (isZH
    ? " 规则: 1)name必须用工具数据中的真实名称,禁止虚构。2)hotel.hero_image留空\"\"。3)每个activity的image_url从工具结果real_photo_url复制。4)note/label最多15字。5)plans包含budget/balanced/premium三档。"
    : " Rules: 1)names must come from tool results, no hallucination. 2)hotel.hero_image=\"\". 3)activity image_url from tool result real_photo_url. 4)note/label max 15 chars. 5)plans must have budget/balanced/premium tiers.");
}

const TOOL_ROUND_TOKENS = 600; // small — LLM only decides which tools to call
// FINAL_ROUND_TOKENS is now computed per-request based on trip duration (see runAgentLoop).

/**
 * Adaptive agent rounds based on intent complexity.
 * Simple single-city queries → 2 rounds. Complex multi-city or long trips → 5 rounds.
 */
function getAdaptiveRounds(intent) {
  if (!intent) return 2;
  const { multi_city, duration_days, constraints = [] } = intent;
  if (multi_city || duration_days >= 11) return 5;
  if (Array.isArray(constraints) && constraints.length >= 3) return 4;
  return 2;
}

// ── System prompt builder ─────────────────────────────────────────────────────
function buildSystemPrompt({ language, contextSummary, city, constraints, intentAxis }) {
  const parts = [];
  if (contextSummary) parts.push(contextSummary); // hard preference rules first
  parts.push(buildCrossXSystemPrompt(language));

  // 工作流程
  parts.push(
    "\n\u5de5\u4f5c\u6d41\u7a0b\uff1a\u5148\u8c03\u7528\u5de5\u5177\u83b7\u53d6\u5b9e\u65f6\u6570\u636e\uff0c\u5168\u90e8\u53d6\u5b8c\u540e\u518d\u8f93\u51fa\u5b8c\u6574\u7684 JSON card_data\u3002"
  );

  // Gap 2: Hard rule — force tool result usage, ban hallucinated names
  parts.push(
    "\n\u6570\u636e\u4f7f\u7528\u89c4\u5219\uff08\u5fc5\u987b\u9075\u5b88\uff09\uff1a" +
    "\n1. restaurant.name \u5fc5\u987b\u6765\u81ea search_restaurants \u6216 get_city_enrichment \u5de5\u5177\u8fd4\u56de\u7684\u771f\u5b9e\u5e97\u540d\uff0c\u7981\u6b62\u865a\u6784\u3002" +
    "\n2. hotel.name \u5fc5\u987b\u6765\u81ea search_hotels \u5de5\u5177\u8fd4\u56de\u7684\u771f\u5b9e\u9152\u5e97\u540d\uff0c\u7981\u6b62\u865a\u6784\u3002" +
    "\n3. activity.name \u5fc5\u987b\u6765\u81ea get_attractions \u6216 get_city_enrichment \u5de5\u5177\u8fd4\u56de\u7684\u771f\u5b9e\u666f\u70b9\u540d\uff0c\u7981\u6b62\u865a\u6784\u3002" +
    "\n4. \u5de5\u5177\u672a\u8fd4\u56de\u8db3\u591f\u6570\u636e\u65f6\uff0c\u7528\u201c\uff08\u5f85\u786e\u8ba4\uff09\u201d\u5360\u4f4d\uff0c\u4e0d\u5f97\u81ea\u884c\u7f16\u9020\u3002"
  );

  // Gap 3: Intent-aware tool guidance — skip irrelevant tools
  if (intentAxis === "food") {
    parts.push("\n\u672c\u6b21\u610f\u56fe\u4e3a\u7eaf\u7f8e\u98df\uff0c\u65e0\u9700\u8c03\u7528 search_hotels\u3002");
  } else if (intentAxis === "stay") {
    parts.push("\n\u672c\u6b21\u610f\u56fe\u4e3a\u4f4f\u5bbf\uff0c\u65e0\u9700\u8c03\u7528 get_attractions \u548c search_restaurants\u3002");
  } else if (intentAxis === "activity") {
    parts.push("\n\u672c\u6b21\u610f\u56fe\u4e3a\u666f\u70b9\u6d3b\u52a8\uff0c\u65e0\u9700\u8c03\u7528 search_hotels\u3002");
  }

  if (city)                    parts.push(`\n\u7528\u6237\u51fa\u53d1\u57ce\u5e02: ${String(city).replace(/[\n\r<>"']/g, "").slice(0, 30)}`);
  // Sanitize user-supplied constraint values before injecting into system prompt
  if (constraints?.party_size) {
    const _pax = Number(constraints.party_size);
    if (Number.isInteger(_pax) && _pax > 0 && _pax <= 100) parts.push(`\n\u4eba\u6570: ${_pax}\u4eba`);
  }
  if (constraints?.budget) {
    const _budget = String(constraints.budget).replace(/[^0-9\u4e07\u5343\u767e\-]/g, "").slice(0, 20);
    if (_budget) parts.push(`\n\u9884\u7b97\u7ebf\u7d22: \xA5${_budget}`);
  }
  return parts.filter(Boolean).join("");
}

// ── Structured response normaliser ───────────────────────────────────────────
function normaliseStructured(parsed, language, intentAxis) {
  if (!parsed) return null;
  let structured;
  if (parsed.response_type && parsed.card_data) {
    structured = parsed;
  } else if (parsed.plans || parsed.title || parsed.destination) {
    structured = {
      response_type: "options_card",
      card_data:     parsed,
      spoken_text:   parsed.spoken_text || (language === "ZH"
        ? `\u597d\u7684\uff0c${parsed.destination || ""}\u65b9\u6848\u5df2\u4e3a\u60a8\u5b9a\u5236\u5b8c\u6210\u3002`
        : `Your ${parsed.destination || ""} plan is ready.`),
    };
  } else {
    return null;
  }
  if (structured.card_data && !structured.card_data.layout_type) {
    const axisMap = { food: "food_only", activity: "travel_full", stay: "stay_focus", travel: "travel_full" };
    structured.card_data.layout_type = axisMap[intentAxis] || "travel_full";
  }
  return structured;
}

/**
 * Run the AI-native streaming agent loop.
 *
 * @param {object}   opts
 * @param {string}   opts.message
 * @param {string}   opts.language
 * @param {string}   opts.city
 * @param {object}   opts.constraints
 * @param {string}   [opts.contextSummary]  Preference rules (hard constraints)
 * @param {Array}    [opts.history]
 * @param {string}   opts.apiKey
 * @param {string}   opts.model
 * @param {string}   [opts.baseUrl]
 * @param {string}   [opts.intentAxis]
 * @param {object}   opts.deps
 * @param {function} opts.emit
 * @returns {Promise<{ok: boolean, structured?: object}>}
 */
async function runAgentLoop({
  message, language, city, constraints,
  contextSummary, history,
  apiKey, model, baseUrl,
  intentAxis, deps, emit,
}) {
  const systemContent = buildSystemPrompt({ language, contextSummary, city, constraints, intentAxis });

  // P1a: Adaptive final-round token budget — longer trips produce larger JSON
  const _tripDays = Number(constraints?.duration_days || constraints?.duration || 3);
  const FINAL_ROUND_TOKENS = _tripDays >= 8 ? 3600 : _tripDays >= 4 ? 2600 : 2000;
  console.log(`[agent] Adaptive token budget: ${FINAL_ROUND_TOKENS} (${_tripDays} days)`);

  // ── Initial messages ──────────────────────────────────────────────────────
  const messages = [{ role: "system", content: systemContent }];

  // Gap 6: Smarter history window — keep last 4 turns verbatim, summarise older turns
  // so the agent retains awareness of earlier requests without ballooning context.
  const histArr = Array.isArray(history) ? history : [];
  const MAX_RECENT_TURNS = 4;
  const droppedTurns = histArr.slice(0, Math.max(0, histArr.length - MAX_RECENT_TURNS));
  const recentTurns  = histArr.slice(-MAX_RECENT_TURNS);
  if (droppedTurns.length > 0) {
    const priorUserMsgs = droppedTurns
      .filter((m) => m.role === "user" && m.content)
      .map((m) => String(m.content).slice(0, 100))
      .join(" → ");
    if (priorUserMsgs) {
      messages.push({ role: "user",      content: `[Earlier requests: ${priorUserMsgs}]` });
      messages.push({ role: "assistant", content: "Understood the prior context." });
      console.log(`[agent] Gap6: summarised ${droppedTurns.length} dropped turns`);
    }
  }
  for (const m of recentTurns) {
    if (m.role && m.content) {
      messages.push({ role: m.role, content: String(m.content).slice(0, 800) });
    }
  }
  messages.push({ role: "user", content: message });

  // ── Phase 1: Streaming tool-call rounds ──────────────────────────────────
  let toolRound = 0;
  const MAX_TOOL_ROUNDS = getAdaptiveRounds(constraints);
  console.log(`[agent] Adaptive rounds: ${MAX_TOOL_ROUNDS} (based on complexity)`);
  const collectedToolResults = {};   // name → last result, for enrichmentData on return

  while (toolRound < MAX_TOOL_ROUNDS) {
    console.log(`[agent] Tool round ${toolRound + 1}/${MAX_TOOL_ROUNDS} — ${messages.length} messages`);

    const streamResult = await openAIStream({
      apiKey, model, baseUrl,
      messages,
      tools:       TOOL_DEFINITIONS,
      temperature: 0.3,
      maxTokens:   TOOL_ROUND_TOKENS,
      timeoutMs:   30000,
      onChunk: (chunk) => {
        if (emit) try { emit({ type: "thinking", text: chunk }); } catch {}
      },
    });

    if (!streamResult.ok) {
      console.warn(`[agent] Stream failed on tool round ${toolRound + 1}`);
      return { ok: false };
    }

    const tool_calls = streamResult.tool_calls || [];

    if (!tool_calls.length) {
      // LLM signalled it has all the data it needs — exit tool phase
      console.log(`[agent] No tool calls on round ${toolRound + 1} — entering final generation`);
      break;
    }

    // Append assistant message with its tool_calls
    messages.push({
      role:       "assistant",
      content:    streamResult.text || null,
      tool_calls: tool_calls.map((tc) => ({
        id:       tc.id,
        type:     "function",
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      })),
    });

    // ── Parallel tool execution ─────────────────────────────────────────────
    // Each tool is individually guarded — one failure must not abort the whole round.
    await Promise.all(tool_calls.map(async (tc) => {
      if (emit) try { emit({ type: "tool_call", tool_name: tc.name }); } catch {}
      let result;
      try {
        result = await executeTool(tc.name, tc.arguments, deps);
      } catch (toolErr) {
        console.warn(`[agent] tool_error: ${tc.name} →`, toolErr.message);
        result = { error: toolErr.message, _source: "error" };
      }
      collectedToolResults[tc.name] = result;   // keep last result per tool name
      console.log(`[agent] tool_result: ${tc.name} → ${JSON.stringify(result).slice(0, 140)}`);
      // Note: push is not thread-safe in theory, but JS is single-threaded so fine
      messages.push({
        role:         "tool",
        tool_call_id: tc.id,
        content:      JSON.stringify(result),
      });
    }));

    toolRound++;

    // Early-exit: if round 1 already called ≥3 tools, all data is collected — skip round 2.
    // This avoids a costly extra streaming round where gpt-4o-mini just says "no more tools".
    if (toolRound === 1 && tool_calls.length >= 3) {
      console.log(`[agent] Round 1 called ${tool_calls.length} tools — skipping round 2, going to final`);
      break;
    }
  }

  // ── Phase 2: Final card generation — streaming jsonMode (up to 60s) ─────────
  // Advance timeline: T_CALC (routes calculated) → B_CHECK (budget check starting)
  if (emit) try { emit({ type: "status", code: "T_CALC", label: "" }); } catch {}
  if (emit) try { emit({ type: "status", code: "B_CHECK", label: "" }); } catch {}

  // Heartbeat: emit a status update every 8s so frontend knows we're alive during long generation.
  // Cleared immediately when openAIStream resolves.
  const _hbLabels = language === "ZH"
    ? ["整合行程数据...", "生成三档方案对比...", "优化景点顺序...", "最终预算校验..."]
    : ["Integrating data...", "Building 3 plan tiers...", "Optimising route order...", "Final budget check..."];
  let _hbIdx = 0;
  const _finalHeartbeat = emit ? setInterval(() => {
    try { emit({ type: "status", code: "B_CHECK", label: _hbLabels[_hbIdx++ % _hbLabels.length] }); } catch {}
  }, 8000) : null;

  // Reconstruct a flat userContent from all messages after system prompt.
  // This lets us call openAIRequest (which supports jsonMode) cleanly.
  console.log(`[agent] Final generation — jsonMode (${messages.length} messages, ${toolRound} tool rounds)`);

  // Build flat user content from collected conversation + tool results.
  // Tool results are compacted to key fields only — reduces final-round context by ~60%.
  function compactToolResult(jsonStr) {
    try {
      const d = JSON.parse(jsonStr);
      const lines = [];
      if (d.city)   lines.push(`城市:${d.city}`);
      // hotels — keep name+tier+price+rating; 5 options so LLM can span budget/mid/luxury tiers
      if (Array.isArray(d.hotels) && d.hotels.length) {
        lines.push("酒店:" + d.hotels.slice(0, 5).map((h) =>
          `${h.name}(${h.tier||""}¥${h.price_per_night||h.price||"?"}${h.rating ? " ★"+h.rating : ""})`).join("|"));
      }
      // restaurants — 6 for variety
      if (Array.isArray(d.restaurants) && d.restaurants.length) {
        lines.push("餐厅:" + d.restaurants.slice(0, 6).map((r) =>
          `${r.name}(¥${r.avg_price||"?"},${r.queue_min != null ? r.queue_min+"min" : ""})${r.real_photo_url ? " photo:"+r.real_photo_url : ""}`).join("|"));
      }
      // attractions — 6
      if (Array.isArray(d.attractions) && d.attractions.length) {
        lines.push("景点:" + d.attractions.slice(0, 6).map((a) =>
          `${a.name}(¥${a.ticket_price||a.avg_price||"?"},${a.open_hours||""})${a.real_photo_url ? " photo:"+a.real_photo_url : ""}`).join("|"));
      }
      // item_list (enrichment) — 6
      if (Array.isArray(d.item_list) && d.item_list.length) {
        lines.push("项目:" + d.item_list.slice(0, 6).map((i) =>
          `${i.name}${i.avg_price ? "(¥"+i.avg_price+")" : ""}${i.real_photo_url ? " photo:"+i.real_photo_url : ""}`).join("|"));
      }
      // route
      if (d.route) {
        const r = d.route;
        lines.push(`路线:${r.transport_mode||""}${r.flight_no ? " "+r.flight_no : ""}¥${r.price_cny||"?"} ${r.dep_time||""}→${r.arr_time||""}`);
      }
      if (d.queue_avg_min != null) lines.push(`排队:${d.queue_avg_min}min`);
      if (d.ticket_available  != null) lines.push(`票务:${d.ticket_available}`);
      return lines.length ? lines.join("\n") : jsonStr.slice(0, 400);
    } catch {
      return jsonStr.slice(0, 400);
    }
  }

  const collectedContext = messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      if (m.role === "tool")      return `[Tool result]\n${compactToolResult(m.content)}`;
      if (m.role === "assistant" && Array.isArray(m.tool_calls)) return null; // skip tool-call assistant msgs
      if (m.role === "assistant") return m.content ? `[AI]\n${m.content}` : null;
      return m.content ? `[User]\n${m.content}` : null;
    })
    .filter(Boolean)
    .join("\n\n");

  // 以上是工具返回的实时数据。请用工具数据中的真实名称输出紧凑的 JSON card_data。
  // 要求：每个字段用最短的值；note/review/headline 最多15字；不要重复数据；不要说明文字。
  const finalUserContent = collectedContext
    + "\n\n\u4ee5\u4e0a\u662f\u5de5\u5177\u8fd4\u56de\u7684\u5b9e\u65f6\u6570\u636e\u3002"
    + "\u8bf7\u7528\u5de5\u5177\u6570\u636e\u4e2d\u7684\u771f\u5b9e\u540d\u79f0\uff0c\u8f93\u51fa\u7d27\u51d1\u7684 JSON card_data\u3002"
    + "\u8981\u6c42\uff1a\u6bcf\u4e2a\u5b57\u6bb5\u7528\u6700\u77ed\u7684\u503c\uff1bnote/review/headline \u6700\u591a15\u5b57\uff1b"
    + "\u6bcf\u4e2a activity \u548c meal \u7684 image_url \u5fc5\u987b\u5c06\u5bf9\u5e94\u5de5\u5177\u7ed3\u679c\u4e2d\u7684 real_photo_url \u586b\u5165\uff1b\u4e0d\u8981\u8bf4\u660e\u6587\u5b57\u3002";

  // Use compact system prompt for final round to save ~1500 input tokens
  const finalSystemPrompt = buildAgentFinalSystemPrompt(language);

  // Hotel name constraint: inject real names from search_hotels to prevent hallucination.
  // Agent sometimes generates fictional hotels (e.g. "德玛西亚酒店") — this forces it to
  // use exactly the names returned by the tool.
  let hotelConstraint = "";
  const _hotelResult = collectedToolResults.search_hotels;
  if (_hotelResult?.hotels?.length) {
    const tierNames = _hotelResult.hotels
      .filter((h) => h.name && h.tier)
      .map((h) => `${h.tier === "budget" ? "\u7ecf\u6d4e" : h.tier === "balanced" ? "\u5747\u8861" : "\u8c6a\u534e"}: "${h.name}"(\u00a5${h.price_per_night || "?"}/\u665a)`)
      .join("; ");
    if (tierNames) {
      hotelConstraint = `\n[\u5f3a\u5236\u7ea6\u675f] plans\u4e2d\u6bcf\u4e2a hotel.name \u5fc5\u987b\u5b8c\u5168\u4f7f\u7528\u4ee5\u4e0b\u771f\u5b9e\u9152\u5e97\u540d\u79f0: ${tierNames}\u3002\u7981\u6b62\u865a\u6784\u9152\u5e97\u540d\u79f0\u3002`;
    }
  }

  // Add context summary (preference rules) if present — must still obey hard constraints
  const finalSystemContent = contextSummary
    ? contextSummary + "\n\n" + finalSystemPrompt + hotelConstraint
    : finalSystemPrompt + hotelConstraint;

  // Final round: streaming with jsonMode — accumulates full JSON while emitting chunks
  // for real-time frontend feedback. Replaces blocking openAIRequest.
  const finalMessages = [
    { role: "system", content: finalSystemContent },
    { role: "user",   content: finalUserContent   },
  ];
  const finalResult = await openAIStream({
    apiKey, model, baseUrl,
    messages:    finalMessages,
    temperature: 0.5,
    maxTokens:   FINAL_ROUND_TOKENS,
    jsonMode:    true,
    timeoutMs:   60000,
    onChunk: (chunk) => {
      if (emit) try { emit({ type: "thinking", text: chunk }); } catch {}
    },
  });
  if (_finalHeartbeat) clearInterval(_finalHeartbeat); // stop heartbeat immediately

  if (!finalResult.ok || !finalResult.text) {
    console.warn("[agent] Final streaming failed");
    return { ok: false };
  }

  const parsed = safeParseJson(finalResult.text);
  if (!parsed) {
    console.warn("[agent] Final JSON parse failed, raw:", finalResult.text?.slice(0, 300));
    return { ok: false };
  }

  let structured = normaliseStructured(parsed, language, intentAxis);
  if (!structured) {
    console.warn("[agent] Unrecognised response shape:", JSON.stringify(parsed).slice(0, 200));
    return { ok: false };
  }

  // Post-process: inject photo URLs from tool results into activities/meals.
  // LLM at compact token budget often omits image_url — fill from all tool messages.
  // NOTE: collectedToolResults keeps last result per name (overwritten when same tool called twice).
  // Instead, scan all tool messages in history to capture every call (e.g. 2× get_city_enrichment).
  if (structured.card_data?.days) {
    const photoMap = new Map();
    for (const m of messages) {
      if (m.role !== "tool") continue;
      try {
        const d = JSON.parse(m.content);
        const items = d.item_list || d.restaurants || d.attractions || [];
        for (const item of (Array.isArray(items) ? items : [])) {
          const photo = item.real_photo_url || item.photo_url || item.image_url;
          if (item.name && photo) photoMap.set(item.name, photo);
        }
      } catch {}
    }
    if (photoMap.size) {
      structured = {
        ...structured,
        card_data: {
          ...structured.card_data,
          days: (structured.card_data.days || []).map((day) => ({
            ...day,
            activities: (day.activities || []).map((act) => {
              if (act.image_url) return act;
              const photo = photoMap.get(act.name);
              return photo ? { ...act, image_url: photo } : act;
            }),
            meals: (day.meals || []).map((meal) => {
              if (meal.image_url) return meal;
              const photo = photoMap.get(meal.name) || photoMap.get(meal.restaurant);
              return photo ? { ...meal, image_url: photo } : meal;
            }),
          })),
        },
      };
      console.log(`[agent] Photo injection: ${photoMap.size} items in map`);
    }
  }

  // Post-process: fix hotel hero_image — agent sometimes copies attraction/food URLs
  // into hotel.hero_image, making all 3 tier cards look identical.
  // Strip these incorrect URLs; frontend fallback will use city hero photo instead.
  if (structured.card_data?.plans) {
    structured.card_data.plans = structured.card_data.plans.map((plan) => {
      if (!plan.hotel?.hero_image) return plan;
      // If hero_image is an attraction/food picsum seed, clear it
      if (/seed\/(food|attraction)-/.test(plan.hotel.hero_image)) {
        return { ...plan, hotel: { ...plan.hotel, hero_image: "" } };
      }
      return plan;
    });
  }

  // ── P0: Hallucination detection + _dataQuality tagging ─────────────────
  // Build set of every real name returned by tools in this session.
  // Scans ALL tool messages (not just collectedToolResults) to handle same-tool
  // called multiple times (e.g. 2× get_city_enrichment overwrites collectedToolResults).
  {
    const _knownNames = new Set();
    for (const m of messages) {
      if (m.role !== "tool") continue;
      try {
        const d = JSON.parse(m.content);
        const allItems = [
          ...(d.item_list    || []),
          ...(d.restaurants  || []),
          ...(d.attractions  || []),
          ...(d.hotels       || []),
        ];
        for (const item of allItems) {
          if (item.name) _knownNames.add(item.name);
        }
      } catch {}
    }

    // Overall data quality: highest-fidelity source wins
    const _srcList = Object.values(collectedToolResults)
      .map((r) => r?._source || r?.source || "unknown");
    const _dq = _srcList.some((s) => s === "amap" || s === "juhe") ? "live"
               : _srcList.some((s) => s === "openai")              ? "ai"
               : _srcList.some((s) => s === "synthetic")           ? "synthetic"
               : "mock";

    // Tag each activity/meal with _verified (name in tool results) or _unverified (hallucination candidate)
    let _vOk = 0, _vFail = 0;
    if (structured.card_data?.days) {
      structured = {
        ...structured,
        card_data: {
          ...structured.card_data,
          _dataQuality: _dq,
          days: structured.card_data.days.map((day) => ({
            ...day,
            activities: (day.activities || []).map((act) => {
              // Skip transport/check-in entries — their names are route/airline labels
              if (/transport|check.?in|hotel/i.test(act.type || "")) return act;
              const ok = _knownNames.size > 0 && _knownNames.has(act.name);
              ok ? _vOk++ : _vFail++;
              return ok ? { ...act, _verified: true } : { ...act, _unverified: true };
            }),
            meals: (day.meals || []).map((meal) => {
              const mname = meal.name || meal.restaurant;
              const ok = _knownNames.size > 0 && Boolean(mname) && _knownNames.has(mname);
              ok ? _vOk++ : _vFail++;
              return ok ? { ...meal, _verified: true } : { ...meal, _unverified: true };
            }),
          })),
        },
      };
    }
    const _total = _vOk + _vFail;
    const _pct   = _total > 0 ? Math.round((_vFail / _total) * 100) : 0;
    console.log(`[agent] P0 hallucination: ${_vOk}/${_total} verified (${_pct}% unverified) | quality=${_dq} | known_names=${_knownNames.size}`);
  }

  // Build a coze-compatible enrichmentData from collected tool results
  const _enrich = collectedToolResults.get_city_enrichment
                || collectedToolResults.search_restaurants
                || collectedToolResults.get_attractions
                || null;
  const enrichmentData = _enrich ? {
    restaurant_queue:    _enrich.queue_avg_min ?? _enrich.restaurant_queue ?? null,
    ticket_availability: _enrich.ticket_available ?? _enrich.ticket_availability ?? true,
    spoken_text:         _enrich.spoken_text || "",
    item_list:           _enrich.restaurants || _enrich.attractions || _enrich.item_list || [],
    _source:             _enrich._source || _enrich.source || "agent",
    _synthetic:          false,
  } : null;

  console.log(`[agent] Complete — response_type=${structured.response_type}, layout=${structured.card_data?.layout_type}, tool_rounds=${toolRound}`);
  return { ok: true, structured, enrichmentData };
}

module.exports = { runAgentLoop };
