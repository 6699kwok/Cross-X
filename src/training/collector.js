"use strict";
/**
 * src/training/collector.js
 * Training data capture pipeline for CrossX LLM capability enhancement.
 *
 * Captures plan generations and formats them as OpenAI fine-tuning examples.
 * Auto-applies quality signals from user behavior:
 *   booking_completed → score 1.0  (strong positive)
 *   rating_high (4-5) → score 0.85 (explicit positive)
 *   no_refine         → score 0.65 (implicit positive)
 *   rating_low (1-2)  → score 0.1  (negative, excluded from export)
 *   refine            → score 0.35 (needs improvement)
 *
 * Fine-tuning JSONL format: OpenAI chat completions
 *   { messages: [{ role, content }, ...] }
 */

const {
  upsertTrainingExample,
  updateTrainingExampleScore,
  getTrainingExamples,
  getTrainingFeedback,
  appendTrainingFeedback,
} = require("../services/db");

// Minimum quality score for export to fine-tuning
const EXPORT_QUALITY_THRESHOLD = 0.6;

// System prompt used in fine-tuning (production equivalent)
const FT_SYSTEM_PROMPT =
  "你是 CrossX 专业旅行规划助手。根据用户需求，生成结构化的旅行计划，" +
  "包含住宿、交通、行程安排和预算估算。输出为可直接使用的 JSON 格式，" +
  "字段包括 destination、days、hotel、transport、activities、budget_estimate。";

// Signal type → quality score mapping
const SIGNAL_SCORES = {
  booking:     1.0,
  rating_high: 0.85,
  no_refine:   0.65,
  refine:      0.35,
  rating_low:  0.1,
};

/**
 * Capture a plan generation as a training example.
 * Called after successful plan generation in plan.js.
 *
 * @param {object} params
 * @param {string} params.deviceId
 * @param {string} params.userMessage   - original user query
 * @param {string} params.assistantResponse - generated plan JSON (stringified)
 * @param {object} params.intent        - detected intent {axis, destination, duration_days, ...}
 * @param {string} params.source        - "openai"|"coze"|"agent"
 * @param {number} [params.latencyMs]
 * @returns {string|null} example ID
 */
function captureExample({ deviceId, userMessage, assistantResponse, intent, source, sessionId, latencyMs }) {
  if (!userMessage || !assistantResponse) return null;

  const destination  = intent?.destination  || null;
  const durationDays = intent?.duration_days || null;

  // Base quality score: coze slightly higher (more expensive, higher quality baseline)
  const baseScore = source === "coze" ? 0.55 : 0.50;

  const id = upsertTrainingExample({
    user_message:       userMessage.slice(0, 2000),
    system_prompt:      FT_SYSTEM_PROMPT,
    assistant_response: assistantResponse.slice(0, 8000),
    quality_score:      baseScore,
    source:             source || "openai",
    destination,
    duration_days:      durationDays,
    session_id:         sessionId || null,
  });

  return id;
}

/**
 * Record an auto-detected quality signal for a training example.
 * Applies exponential moving average: new_score = 0.6 * old + 0.4 * signal
 *
 * @param {string} exampleId  - training_examples.id
 * @param {string} signalType - "booking"|"rating_high"|"no_refine"|"refine"|"rating_low"
 */
function recordSignal(exampleId, signalType) {
  const signal = SIGNAL_SCORES[signalType];
  if (signal === undefined || !exampleId) return;

  const { sqliteDb } = require("../services/db");
  const row = sqliteDb.prepare("SELECT quality_score FROM training_examples WHERE id=?").get(exampleId);
  if (!row) return;

  const newScore = Math.round((row.quality_score * 0.6 + signal * 0.4) * 1000) / 1000;
  updateTrainingExampleScore(exampleId, newScore);
}

/**
 * Record explicit user feedback (rating + comment).
 * Also updates the corresponding training example's quality score.
 *
 * @param {object} params
 * @param {string} params.planId     - session or plan identifier
 * @param {string} params.deviceId
 * @param {number} params.rating     - 1-5 stars
 * @param {string} [params.comment]
 * @param {string} [params.exampleId] - training_examples.id to update quality
 * @param {string} [params.destination]
 * @param {number} [params.durationDays]
 * @returns {string} feedback ID
 */
function recordFeedback({ planId, deviceId, rating, comment, exampleId, destination, durationDays }) {
  const signalType = rating >= 4 ? "rating_high" : rating <= 2 ? "rating_low" : "no_refine";

  const feedbackId = appendTrainingFeedback({
    plan_id:      planId,
    device_id:    deviceId,
    rating,
    comment:      comment || null,
    signal_type:  signalType,
    destination:  destination || null,
    duration_days: durationDays || null,
  });

  // Propagate signal to training example quality score
  if (exampleId) recordSignal(exampleId, signalType);

  return feedbackId;
}

/**
 * Export training data as OpenAI fine-tuning JSONL.
 * Only includes examples at or above the quality threshold.
 *
 * @param {object} [opts]
 * @param {number} [opts.minScore=EXPORT_QUALITY_THRESHOLD]
 * @param {number} [opts.limit=1000]
 * @param {string} [opts.destination] - optional city filter
 * @returns {string} JSONL content (one JSON object per line)
 */
function exportFineTuningJSONL({ minScore = EXPORT_QUALITY_THRESHOLD, limit = 1000, destination } = {}) {
  const rows = getTrainingExamples({ minScore, limit, destination });

  return rows.map(row => JSON.stringify({
    messages: [
      { role: "system",    content: row.system_prompt },
      { role: "user",      content: row.user_message },
      { role: "assistant", content: row.assistant_response },
    ],
  })).join("\n");
}

/**
 * Get training data statistics summary.
 */
function getTrainingStats() {
  const { sqliteDb } = require("../services/db");

  const total      = sqliteDb.prepare("SELECT COUNT(*) as n FROM training_examples").get().n;
  const exportable = sqliteDb.prepare(
    "SELECT COUNT(*) as n FROM training_examples WHERE quality_score >= ?"
  ).get(EXPORT_QUALITY_THRESHOLD).n;

  const bySource  = sqliteDb.prepare(
    "SELECT source, COUNT(*) as n, ROUND(AVG(quality_score),3) as avg_quality FROM training_examples GROUP BY source"
  ).all();

  const topCities = sqliteDb.prepare(
    "SELECT destination, COUNT(*) as n FROM training_examples WHERE destination IS NOT NULL GROUP BY destination ORDER BY n DESC LIMIT 10"
  ).all();

  const feedbackStats = sqliteDb.prepare(
    "SELECT signal_type, COUNT(*) as n FROM training_feedback GROUP BY signal_type"
  ).all();

  const scoreDistrib = sqliteDb.prepare(`
    SELECT
      SUM(CASE WHEN quality_score >= 0.8  THEN 1 ELSE 0 END) as excellent,
      SUM(CASE WHEN quality_score >= 0.6 AND quality_score < 0.8 THEN 1 ELSE 0 END) as good,
      SUM(CASE WHEN quality_score >= 0.4 AND quality_score < 0.6 THEN 1 ELSE 0 END) as fair,
      SUM(CASE WHEN quality_score < 0.4  THEN 1 ELSE 0 END) as poor
    FROM training_examples
  `).get();

  return {
    total,
    exportable,
    exportThreshold: EXPORT_QUALITY_THRESHOLD,
    scoreDistrib,
    bySource,
    topCities,
    feedbackStats,
  };
}

module.exports = {
  captureExample,
  recordSignal,
  recordFeedback,
  exportFineTuningJSONL,
  getTrainingStats,
  EXPORT_QUALITY_THRESHOLD,
  FT_SYSTEM_PROMPT,
};
