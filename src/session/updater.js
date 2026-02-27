"use strict";
/**
 * src/session/updater.js
 * Handles UPDATE intent: patches an existing plan with OpenAI instead of
 * regenerating from scratch.
 *
 * Flow:
 *   1. looksLikeUpdate(message) — fast local heuristic, no LLM needed
 *   2. getSession(sessionId)    — load existing card_data from store
 *   3. applyPlanPatch(...)      — targeted OpenAI call to modify only changed fields
 *   4. patchSession(...)        — write updated plan back to store
 *
 * Why patch, not regenerate?
 *   Full regeneration for "把酒店换便宜点" takes ~25s and discards context.
 *   A patch prompt with the existing plan + delta instruction takes ~8s and
 *   preserves all unchanged content (activities, transport, dates, etc.).
 */

const { openAIRequest } = require("../ai/openai");
const { safeParseJson }  = require("../planner/mock");
const { patchSession, getSession, scrubPii } = require("./store");

// ── Update intent detection ───────────────────────────────────────────────────
/**
 * Patterns that signal a modification to an existing plan (not a new trip).
 * Ordered from most specific to most general.
 */
const UPDATE_PATTERNS = [
  // People count changes
  /改成\s*\d+\s*人|换成\s*\d+\s*人|人数[改调]为?\s*\d+|\d+\s*人出行|人数从\d+/,
  // Budget adjustment
  /预算[改调整换]|[改调整换]预算|省钱|便宜[点些]|贵[点些]|升级|降[一]?级/,
  // Hotel change
  /换[个间家]?.{0,6}酒店|换到.{0,5}区|换[便宜贵好]|酒店[换改]/,
  // Duration change
  /加[一]?天|减[一]?天|改成\s*\d+\s*天|延长|缩短|多[一]?天|少[一]?天/,
  // Food / special requirements change
  /换成素食|清真|海鲜|不吃|过敏|饮食改/,
  // Date / schedule shift
  /往后推|提前[一两三]?天|改[到为]?\d{1,2}月\d{1,2}[日号]|改日期|换[个]?时间/,
  // Remove/add elements
  /去掉|不[要需]|删掉|取消|加[上个]?(?!天)\S+/,
  // Explicit update keywords
  /修改方案|重新调整|根据.{0,10}修改|按.{0,10}调整/,
];

/**
 * Fast local heuristic: does this message look like a plan modification request?
 * No LLM call — O(n) regex check against UPDATE_PATTERNS.
 *
 * @param {string} message
 * @returns {boolean}
 */
function looksLikeUpdate(message) {
  if (!message) return false;
  return UPDATE_PATTERNS.some((re) => re.test(message));
}

// ── Patch prompt ──────────────────────────────────────────────────────────────
const PATCH_SYSTEM_PROMPT = `你是 CrossX 行程修改引擎。用户已有一份行程方案，现在需要局部修改。

# 绝对规则
- 只修改用户明确指定的内容，其余字段原样保留
- 预算变化 → 按比例调整 budget_breakdown 各项之和 = total_price
- 酒店变化 → 同步更新 hotel.name / price_per_night / total / image_keyword
- 人数变化 → 同步调整 total_price 和各费用项
- 天数变化 → 同步增减 days 数组（新增天参照已有风格）
- 只输出合法 JSON（card_data 结构），零 markdown，零注释，零解释文字

# 输出格式（严格 JSON，直接输出 card_data 对象）
{"title":..., "destination":..., "duration_days":..., "pax":..., "plans":[...], "days":[...], "action_button":{...}}`;

// ── applyPlanPatch ────────────────────────────────────────────────────────────
/**
 * Apply a user's modification instruction to an existing plan via OpenAI.
 *
 * @param {object} opts
 * @param {string}  opts.message        User's update instruction (PII already scrubbed)
 * @param {object}  opts.existingPlan   card_data from the last generated plan
 * @param {string}  opts.language       "ZH" | "EN" | ...
 * @param {string}  opts.apiKey
 * @param {string}  opts.model
 * @param {number}  [opts.timeoutMs=20000]
 * @returns {Promise<{ok: boolean, patched: object|null, spokenText: string}>}
 */
async function applyPlanPatch({
  message,
  existingPlan,
  language,
  apiKey,
  model,
  timeoutMs = 20000,
}) {
  // Truncate existing plan to stay within token budget (~2000 input tokens)
  const planJson = JSON.stringify(existingPlan, null, 2).slice(0, 3500);

  const userContent = [
    `修改指令: ${message}`,
    "",
    `现有方案 (card_data):`,
    planJson,
    "",
    "请输出修改后的完整 card_data JSON。",
  ].join("\n");

  const result = await openAIRequest({
    apiKey,
    model,
    systemPrompt: PATCH_SYSTEM_PROMPT,
    userContent,
    temperature: 0.3,
    maxTokens:   2500,
    jsonMode:    true,
    timeoutMs,
  });

  if (!result.ok || !result.text) {
    return {
      ok: false,
      patched: null,
      spokenText: language === "ZH"
        ? "抱歉，修改遇到问题，请重试或重新描述需求。"
        : "Sorry, the update failed. Please retry.",
    };
  }

  const patched = safeParseJson(result.text);
  if (!patched || typeof patched !== "object") {
    return {
      ok: false,
      patched: null,
      spokenText: language === "ZH"
        ? "修改结果解析失败，请重新描述您的调整需求。"
        : "Failed to parse the updated plan. Please rephrase.",
    };
  }

  const spokenText = language === "ZH"
    ? "好的，我已根据您的要求完成修改，请查看更新后的方案。"
    : "Done! Your plan has been updated. Please review the changes below.";

  return { ok: true, patched, spokenText };
}

// ── handleUpdateRequest ───────────────────────────────────────────────────────
/**
 * Full update flow: load session → scrub PII → patch via OpenAI → write back.
 *
 * @param {object} opts
 * @param {string}  opts.sessionId
 * @param {string}  opts.message       Raw user message
 * @param {string}  opts.language
 * @param {string}  opts.apiKey
 * @param {string}  opts.model
 * @returns {Promise<{
 *   ok: boolean,
 *   patched: object|null,
 *   spokenText: string,
 *   reason: string
 * }>}
 */
async function handleUpdateRequest({ sessionId, message, language, apiKey, model }) {
  // 1. Load existing plan from session
  const sessionData = getSession(sessionId);
  if (!sessionData || !sessionData.plan) {
    return {
      ok: false,
      patched: null,
      spokenText: language === "ZH"
        ? "还没有找到您之前的行程方案，请先生成一份新方案再修改。"
        : "No existing plan found for this session. Please generate a plan first.",
      reason: "no_session",
    };
  }

  // 2. Scrub PII from user message before forwarding to OpenAI
  const cleanedMessage = scrubPii(message);

  // 3. Call OpenAI for targeted patch
  const patchResult = await applyPlanPatch({
    message:      cleanedMessage,
    existingPlan: sessionData.plan,
    language,
    apiKey,
    model,
  });

  if (!patchResult.ok) {
    return { ok: false, patched: null, spokenText: patchResult.spokenText, reason: "patch_failed" };
  }

  // 4. Write patched plan back to session (preserving other session metadata)
  patchSession(sessionId, { plan: patchResult.patched });

  return {
    ok:         true,
    patched:    patchResult.patched,
    spokenText: patchResult.spokenText,
    reason:     "ok",
  };
}

module.exports = {
  looksLikeUpdate,
  applyPlanPatch,
  handleUpdateRequest,
  UPDATE_PATTERNS,
};
