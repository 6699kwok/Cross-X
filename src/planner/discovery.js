"use strict";
/**
 * src/planner/discovery.js
 * 小美式对话发现模式 — Conversational Discovery Mode
 *
 * Before jumping to plan generation, engage in one natural conversational turn
 * to understand user preferences. Emulates a warm travel consultant, not a
 * slot-filling form.
 *
 * Flow:
 *   1. needsDiscovery() — determines if this first-turn message is vague enough
 *      to benefit from a conversational round
 *   2. runDiscovery()   — streaming LLM call: warm opener + one natural question
 *   3. plan.js stores { pendingDiscovery: true, originalMessage, intentAxis }
 *   4. Next user turn: discovery is skipped, context merged, plan generated
 */

const { openAIStream } = require("../ai/openai");

// ── Discovery trigger heuristics ─────────────────────────────────────────────
// Messages that are SHORT and VAGUE trigger discovery.
// Rich messages (with party size, dates, preferences) skip straight to plan.

const RICH_DETAIL_RE = /\d+\s*天|\d+\s*人|\d+\s*(?:万|元)|预算|行程|带.*(?:孩|老人|朋友|家人|同事)|情侣|蜜月|亲子|背包|商务|周末|五一|国庆|假期|景点|酒店|机票/;

/**
 * Returns true if the message is too vague to generate a good plan directly.
 * Only applies to the FIRST planning turn (no prior plan in session).
 *
 * @param {string} message
 * @param {string} intentAxis   "food"|"activity"|"stay"|"travel"
 * @param {object} existingSession  null or session.data
 * @returns {boolean}
 */
function needsDiscovery(message, intentAxis, existingSession) {
  // Already had a discovery round — skip
  if (existingSession?.pendingDiscovery) return false;
  // Already has a plan — this is a follow-up, skip
  if (existingSession?.plan) return false;

  // Message has rich detail — skip discovery
  if (RICH_DETAIL_RE.test(message)) return false;

  // Very short + no detail → discovery
  // Chinese chars count (excluding spaces, punctuation)
  const chineseChars = (message.match(/[\u4e00-\u9fa5]/g) || []).length;

  // food: discover if < 12 Chinese chars (e.g. "西安美食推荐", "西安好吃的")
  if (intentAxis === "food") return chineseChars < 14;

  // travel/activity/stay: discover if < 16 Chinese chars (e.g. "我想去西安", "带孩子去成都")
  return chineseChars < 18;
}

// ── Per-intent question style ─────────────────────────────────────────────────
const DISCOVERY_SYSTEM = {
  ZH: `你是 CrossX 的旅行顾问小美，风格热情亲切、有温度。
用户刚说了一个旅行意图，你需要：
1. 用一句话热情回应（表达对目的地/美食的喜爱，带情绪）
2. 紧接着问一个最关键的问题（只问一个！）帮你更好地出方案。
整体控制在 40 字以内，口语化，不要用"您好"，不要列清单。
只输出回复文字，不要任何格式标记。`,
  EN: `You are CrossX travel advisor. Respond warmly to the user's travel interest in one sentence, then ask exactly ONE natural follow-up question to better personalise their plan. Keep it under 30 words. Conversational tone, no bullet points.`,
};

const DISCOVERY_QUESTION_HINTS = {
  food: {
    ZH: "重点问：口味偏好（辣/清淡/特定菜系）或人数",
    EN: "Ask about: cuisine preference or party size",
  },
  travel: {
    ZH: "重点问：出行人数或行程天数",
    EN: "Ask about: party size or trip duration",
  },
  activity: {
    ZH: "重点问：体力偏好（轻松/爬山）或同行人（带孩子/老人/情侣）",
    EN: "Ask about: activity intensity or who they're travelling with",
  },
  stay: {
    ZH: "重点问：预算区间或入住时间",
    EN: "Ask about: budget range or check-in dates",
  },
};

/**
 * Run a single conversational discovery turn — streaming.
 *
 * @param {object} opts
 * @param {string}   opts.message     User's vague intent message
 * @param {string}   opts.city        Destination city (extracted)
 * @param {string}   opts.language    "ZH"|"EN"
 * @param {string}   opts.intentAxis  "food"|"activity"|"stay"|"travel"
 * @param {string}   opts.apiKey
 * @param {string}   opts.model
 * @param {string}   [opts.baseUrl]
 * @param {function} opts.emit        SSE emit(data) callback
 * @returns {Promise<{ok: boolean, spokenText: string}>}
 */
async function runDiscovery({ message, city, language, intentAxis, apiKey, model, baseUrl, emit }) {
  const lang   = language === "ZH" ? "ZH" : "EN";
  const system = DISCOVERY_SYSTEM[lang] || DISCOVERY_SYSTEM.ZH;
  const hint   = (DISCOVERY_QUESTION_HINTS[intentAxis] || DISCOVERY_QUESTION_HINTS.travel)[lang] || "";

  // "城市: 西安。用户说: 西安美食推荐。[重点问：口味偏好或人数]"
  const userContent = [
    city ? `\u57ce\u5e02: ${city}\u3002` : "",
    `\u7528\u6237\u8bf4\uff1a${message}`,
    hint ? `\n[${hint}]` : "",
  ].filter(Boolean).join("");

  let fullText = "";

  const result = await openAIStream({
    apiKey, model, baseUrl,
    messages: [
      { role: "system", content: system },
      { role: "user",   content: userContent },
    ],
    temperature: 0.85,  // warmer, more personality
    maxTokens:   80,
    timeoutMs:   8000,
    onChunk: (chunk) => {
      fullText += chunk;
      if (emit) try { emit({ type: "thinking", text: chunk }); } catch {}
    },
  });

  const spokenText = (result.text || fullText).trim();
  if (!spokenText) return { ok: false, spokenText: "" };

  console.log(`[discovery] axis=${intentAxis} city=${city} → "${spokenText.slice(0, 60)}"`);
  return { ok: true, spokenText };
}

module.exports = { needsDiscovery, runDiscovery };
