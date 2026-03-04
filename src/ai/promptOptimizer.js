"use strict";
/**
 * src/ai/promptOptimizer.js
 * A/B Prompt Experimentation Framework using Thompson Sampling.
 *
 * Tracks win/loss rates of different prompt variants and selects
 * the best-performing one using Beta-distribution Thompson Sampling,
 * which balances exploration (trying new variants) with exploitation
 * (using what works best).
 *
 * Usage:
 *   const { selectVariant, recordOutcome } = require("./promptOptimizer");
 *
 *   // In plan generation:
 *   const variant = selectVariant("planner_system", ["v1", "v2_concise", "v3_cot"]);
 *   const prompt  = PROMPTS[variant];
 *   // ... call LLM ...
 *   recordOutcome("planner_system", variant, userBooked);  // true = positive signal
 */

const { upsertPromptExperiment, getPromptExperiments } = require("../services/db");

// ── Thompson Sampling ──────────────────────────────────────────────────────
/**
 * Sample a score from Beta(alpha, beta) using Johnk's method approximation.
 * alpha = wins + 1, beta = losses + 1 (Bayes prior: Beta(1,1) = uniform)
 */
function _betaSample(wins, losses) {
  const alpha = wins + 1;
  const beta  = losses + 1;
  // Gamma approximation: sample from Gamma(a,1) and Gamma(b,1)
  // Using Box-Muller-adjacent method for speed
  let x = 0, y = 0;
  for (let i = 0; i < alpha; i++) x -= Math.log(Math.random() || 1e-10);
  for (let i = 0; i < beta;  i++) y -= Math.log(Math.random() || 1e-10);
  return x / (x + y);
}

// ── Public API ─────────────────────────────────────────────────────────────
/**
 * Select the best variant for a prompt experiment using Thompson Sampling.
 * Returns the first variant if no data exists yet (cold start = control).
 *
 * @param {string}   promptId  - e.g. "planner_system", "intent_detector"
 * @param {string[]} variants  - list of variant names; first = control/default
 * @returns {string} selected variant name
 */
function selectVariant(promptId, variants) {
  if (!variants || variants.length === 0) return null;
  if (variants.length === 1) return variants[0];

  const rows = getPromptExperiments(promptId);
  const dataMap = Object.fromEntries(rows.map(r => [r.variant, r]));

  let bestVariant = variants[0];
  let bestScore   = -1;

  for (const v of variants) {
    const row   = dataMap[v];
    const wins  = row ? row.win_count   : 0;
    const losses = row ? row.loss_count : 0;
    const score = _betaSample(wins, losses);
    if (score > bestScore) {
      bestScore   = score;
      bestVariant = v;
    }
  }

  return bestVariant;
}

/**
 * Record the outcome of a prompt variant usage.
 * Call after you know whether the interaction was successful.
 *
 * @param {string}  promptId  - same promptId used in selectVariant
 * @param {string}  variant   - variant that was used
 * @param {boolean} won       - true = positive outcome (booking, high rating, etc.)
 */
function recordOutcome(promptId, variant, won) {
  if (!promptId || !variant) return;
  upsertPromptExperiment({ prompt_id: promptId, variant, won: !!won });
}

/**
 * Get current statistics for all prompt experiments.
 * Sorted by prompt_id, then by win_rate descending.
 *
 * @returns {Array<{prompt_id, variant, win_count, loss_count, total_count, win_rate_pct}>}
 */
function getPromptStats() {
  const { sqliteDb } = require("../services/db");
  return sqliteDb.prepare(`
    SELECT
      prompt_id, variant, win_count, loss_count, total_count,
      CASE WHEN total_count > 0
           THEN ROUND(win_count * 100.0 / total_count, 1)
           ELSE 0 END AS win_rate_pct,
      is_active, created_at
    FROM prompt_experiments
    ORDER BY prompt_id, win_rate_pct DESC
  `).all();
}

/**
 * Deactivate all variants for a promptId (e.g. when prompt content changes).
 * Keeps history intact but excludes from future selectVariant.
 */
function resetExperiment(promptId) {
  const { sqliteDb } = require("../services/db");
  sqliteDb.prepare("UPDATE prompt_experiments SET is_active=0 WHERE prompt_id=?").run(promptId);
}

/**
 * Get the currently winning variant for a promptId (highest win rate, min 10 trials).
 * Returns null if no data or no variant has enough trials.
 *
 * @param {string} promptId
 * @param {number} [minTrials=10]
 * @returns {{ variant: string, win_rate_pct: number }|null}
 */
function getWinningVariant(promptId, minTrials = 10) {
  const { sqliteDb } = require("../services/db");
  const row = sqliteDb.prepare(`
    SELECT variant, ROUND(win_count * 100.0 / total_count, 1) as win_rate_pct
    FROM prompt_experiments
    WHERE prompt_id=? AND is_active=1 AND total_count >= ?
    ORDER BY win_rate_pct DESC LIMIT 1
  `).get(promptId, minTrials);
  return row || null;
}

module.exports = { selectVariant, recordOutcome, getPromptStats, resetExperiment, getWinningVariant };
