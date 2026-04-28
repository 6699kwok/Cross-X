"use strict";
/**
 * src/conversation/context_window.js
 * Smart ContextWindow manager for LLM message history.
 *
 * Strategy:
 *   - Core preferences (allergy, budget, nationality) → always in System Message via buildContextSummary
 *   - Last 5 turns → kept verbatim in messages[]
 *   - Older turns → summarised in a single cheap gpt-4o-mini call (≤100 chars output)
 *     and injected as a single synthetic user/assistant pair
 *
 * Usage:
 *   const { messages, summary } = await buildContextWindow(history, { apiKey, model, baseUrl });
 *   // prepend messages to your LLM call; optionally log summary
 */

const { openAIRequest } = require("../ai/openai");

const MAX_VERBATIM_TURNS = 5;
const SUMMARY_MAX_TOKENS = 150;  // ≤200 chars — preserves negative constraints
const SUMMARY_TIMEOUT_MS = 8000;

/**
 * Build a lean message array from raw history.
 *
 * @param {Array}  history   [{role, content}] — full multi-turn history
 * @param {object} llmCfg    { apiKey, model, baseUrl } — used for summarisation call
 * @returns {Promise<{ messages: Array, summary: string|null }>}
 *   messages: ready to spread into your messages[] array (no system msg included)
 *   summary:  the generated summary string, or null if not needed
 */
async function buildContextWindow(history, llmCfg) {
  const histArr = Array.isArray(history)
    ? history.filter((m) => m && m.role && m.content)
    : [];

  if (histArr.length === 0) return { messages: [], summary: null };

  // Within the verbatim window — no summarisation needed
  if (histArr.length <= MAX_VERBATIM_TURNS) {
    return {
      messages: histArr.map(_trimMsg),
      summary:  null,
    };
  }

  const olderTurns = histArr.slice(0, histArr.length - MAX_VERBATIM_TURNS);
  const recentTurns = histArr.slice(-MAX_VERBATIM_TURNS);

  // Summarise older turns with a single cheap LLM call
  const summary = await _summariseTurns(olderTurns, llmCfg);

  // Inject summary as a synthetic turn pair so the LLM sees it naturally
  const summaryMessages = summary
    ? [
        { role: "user",      content: `[Earlier conversation summary: ${summary}]` },
        { role: "assistant", content: "Understood." },
      ]
    : [];

  return {
    messages: [...summaryMessages, ...recentTurns.map(_trimMsg)],
    summary,
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Trim a single message to a safe content length (800 chars).
 * Prevents a single very long turn from dominating the context.
 */
function _trimMsg(m) {
  if (!m.content || String(m.content).length <= 800) return m;
  return { ...m, content: String(m.content).slice(0, 800) };
}

/**
 * Summarise a list of turns into ≤100 Chinese chars via a cheap LLM call.
 * Falls back to a manual concat string if the API call fails.
 *
 * @param {Array}  turns   Older turns to summarise
 * @param {object} llmCfg  { apiKey, model, baseUrl }
 * @returns {Promise<string|null>}
 */
async function _summariseTurns(turns, llmCfg) {
  const { apiKey, model, baseUrl } = llmCfg || {};

  // Extract user messages only — agent responses add little summarisation value
  const userTexts = turns
    .filter((m) => m.role === "user" && m.content)
    .map((m) => String(m.content).slice(0, 200))
    .join(" | ");

  if (!userTexts) return null;

  // Cheap fallback: truncated concat (no API call needed for very short history)
  if (userTexts.length < 80) return userTexts;

  if (!apiKey) {
    // No API config — use manual truncation as fallback
    return userTexts.slice(0, 100);
  }

  try {
    const result = await openAIRequest({
      apiKey,
      model,   // caller passes gpt-4o-mini or cheapest available
      baseUrl,
      // Summarise in ≤200 chars; MUST retain ALL negative constraints verbatim
      // (e.g. "不想排队" / "不吃辣" / "不坐飞机") — these are easy to lose in compression
      systemPrompt:
        "\u5c06\u4ee5\u4e0b\u5bf9\u8bdd\u6444\u8981\u4e3a200\u5b57\u4ee5\u5185\u7684\u4e2d\u6587\u603b\u7ed3\u3002" +
        // "将以下对话摘要为200字以内的中文总结。"
        "\u5fc5\u987b\u5b8c\u6574\u4fdd\u7559\u6240\u6709\u300e\u8d1f\u9762\u7ea6\u675f\u300f\uff08\u5982\uff1a\u4e0d\u60f3\u3001\u4e0d\u559c\u6b22\u3001\u907f\u5f00\u3001\u4e0d\u5403\u3001\u4e0d\u575b\u6a5f\uff09\u3002" +
        // "必须完整保留所有「负面约束」（如：不想、不喜欢、避开、不吃、不坐飞机）。"
        "\u540c\u65f6\u4fdd\u7559\uff1a\u76ee\u7684\u5730\u3001\u4eba\u6570\u3001\u9884\u7b97\u3001\u884c\u7a0b\u5929\u6570\u3001\u7279\u6b8a\u5065\u5eb7\u9700\u6c42\u3002\u4e0d\u8981\u5305\u542b\u95ee\u5019\u8bed\u6216\u5ba2\u5957\u8bdd\u3002",
        // "同时保留：目的地、人数、预算、行程天数、特殊健康需求。不要包含问候语或客套话。"
      userContent: userTexts,
      maxTokens:   SUMMARY_MAX_TOKENS,
      timeoutMs:   SUMMARY_TIMEOUT_MS,
    });
    if (result.ok && result.text) return result.text.trim().slice(0, 150);
  } catch (e) {
    console.warn("[ContextWindow] summarise failed:", e.message);
  }

  // Fallback: manual truncation
  return userTexts.slice(0, 100);
}

module.exports = { buildContextWindow };
