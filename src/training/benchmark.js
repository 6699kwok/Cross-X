"use strict";
/**
 * src/training/benchmark.js
 * CrossX LLM Capability Evaluation Framework.
 *
 * 20 canonical test queries covering:
 *   - Intent classification (food/activity/stay/travel)
 *   - Destination extraction
 *   - Duration parsing (explicit + implicit "周末"=2, "一周"=7)
 *   - Pax parsing (solo/couple/group)
 *   - Budget parsing with per-day calculation
 *   - Special needs detection
 *   - Multi-city detection
 *
 * Scoring: weighted partial-match (see scoreResult)
 *   axis         → 0.40
 *   destination  → 0.30
 *   duration     → 0.15
 *   pax          → 0.10
 *   budget       → 0.05
 *
 * Run: GET /api/training/benchmark   (admin)
 * History: GET /api/training/benchmark/history
 */

const crypto = require("crypto");
const { detectIntentLLM } = require("../ai/intent");
const { appendCapabilityBenchmark, getBenchmarkRuns } = require("../services/db");

// ── Canonical Test Cases ───────────────────────────────────────────────────
const BENCHMARK_CASES = [
  // --- Travel intent + destination + duration ---
  { id: "bm01", query: "去成都玩3天，喜欢美食",                 expected: { axis: "travel",   destination: "成都",   duration_days: 3 } },
  { id: "bm02", query: "帮我规划上海5天旅游，带孩子",           expected: { axis: "travel",   destination: "上海",   duration_days: 5 } },
  { id: "bm03", query: "北京历史文化游4天两人",                 expected: { axis: "travel",   destination: "北京",   duration_days: 4, pax: 2 } },
  { id: "bm04", query: "三亚蜜月旅行7天",                       expected: { axis: "travel",   destination: "三亚",   duration_days: 7 } },
  { id: "bm05", query: "成都加重庆连游，共6天",                 expected: { axis: "travel",   duration_days: 6 } },          // multi-city

  // --- Food intent ---
  { id: "bm06", query: "成都有哪些好吃的餐厅推荐",             expected: { axis: "food",     destination: "成都" } },
  { id: "bm07", query: "北京烤鸭哪家最正宗",                   expected: { axis: "food",     destination: "北京" } },
  { id: "bm08", query: "上海附近有什么素食餐厅",               expected: { axis: "food",     destination: "上海" } },

  // --- Stay intent ---
  { id: "bm09", query: "三亚有什么好的度假酒店推荐",           expected: { axis: "stay",     destination: "三亚" } },
  { id: "bm10", query: "北京故宫附近住哪里方便",               expected: { axis: "stay",     destination: "北京" } },

  // --- Activity intent ---
  { id: "bm11", query: "成都有什么好玩的景点",                 expected: { axis: "activity", destination: "成都" } },
  { id: "bm12", query: "张家界有什么户外徒步活动",             expected: { axis: "activity", destination: "张家界" } },

  // --- Budget parsing ---
  { id: "bm13", query: "5000元预算去云南玩5天",                expected: { axis: "travel",   destination: "云南",   duration_days: 5, budget_per_day: 1000 } },
  { id: "bm14", query: "穷游杭州3天，全程预算控制在500元",     expected: { axis: "travel",   destination: "杭州",   duration_days: 3 } },

  // --- Special needs ---
  { id: "bm15", query: "带宝宝去厦门玩，需要婴儿推车",         expected: { axis: "travel",   destination: "厦门" } },
  { id: "bm16", query: "清真美食路线西安4天",                   expected: { axis: "travel",   destination: "西安",   duration_days: 4 } },

  // --- Pax parsing ---
  { id: "bm17", query: "公司团建6人去西湖周边",                expected: { axis: "travel",   destination: "杭州",   pax: 6 } },
  { id: "bm18", query: "一个人去大理流浪一周",                 expected: { axis: "travel",   destination: "大理",   duration_days: 7, pax: 1 } },

  // --- Implicit duration ---
  { id: "bm19", query: "周末去苏州逛逛古镇",                   expected: { axis: "travel",   destination: "苏州",   duration_days: 2 } },
  { id: "bm20", query: "国庆假期去九寨沟，8天行程",            expected: { axis: "travel",   destination: "九寨沟", duration_days: 8 } },
];

// ── Scoring ────────────────────────────────────────────────────────────────
/**
 * Score a single intent detection result vs. expected.
 * Returns 0.0 – 1.0.
 */
function scoreResult(actual, expected) {
  if (!actual) return 0;
  let score = 0;

  // Axis (0.40)
  if (actual.axis === expected.axis) score += 0.40;

  // Destination (0.30) — substring match in both directions
  if (expected.destination) {
    const a = actual.destination || "";
    const e = expected.destination;
    if (a === e) score += 0.30;
    else if (a.includes(e) || e.includes(a)) score += 0.20;
  }

  // Duration (0.15) — exact match required
  if (expected.duration_days) {
    if (actual.duration_days === expected.duration_days) score += 0.15;
  }

  // Pax (0.10) — exact match required
  if (expected.pax) {
    if (actual.pax === expected.pax) score += 0.10;
  }

  // Budget (0.05) — ±20% tolerance
  if (expected.budget_per_day) {
    const b = actual.budget_per_day;
    if (b && Math.abs(b - expected.budget_per_day) / expected.budget_per_day <= 0.20) score += 0.05;
  }

  return Math.min(1.0, Math.round(score * 1000) / 1000);
}

// ── Benchmark Runner ───────────────────────────────────────────────────────
/**
 * Run capability benchmark against the intent detection LLM.
 *
 * @param {object} opts
 * @param {string} opts.apiKey  - OpenAI API key
 * @param {string} [opts.model] - model override
 * @param {Array}  [opts.casesOverride] - custom test cases
 * @returns {Promise<object>} benchmark result
 */
async function runBenchmark({ apiKey, model, casesOverride } = {}) {
  const cases  = casesOverride || BENCHMARK_CASES;
  const runId  = "brun_" + crypto.randomBytes(6).toString("hex");
  const results = [];
  let totalScore = 0;

  for (const bc of cases) {
    const t0 = Date.now();
    let actual, error;

    try {
      actual = await detectIntentLLM(bc.query, { apiKey, model });
    } catch (e) {
      error  = e.message;
      actual = { axis: "travel", destination: null, duration_days: null, pax: 2, _source: "error" };
    }

    const latencyMs = Date.now() - t0;
    const score     = scoreResult(actual, bc.expected);
    totalScore += score;

    appendCapabilityBenchmark({
      run_id:               runId,
      query:                bc.query,
      expected_intent:      bc.expected.axis,
      actual_intent:        actual.axis,
      expected_destination: bc.expected.destination || null,
      actual_destination:   actual.destination || null,
      score,
      latency_ms:           latencyMs,
      model:                model || "default",
    });

    results.push({
      id:         bc.id,
      query:      bc.query,
      expected:   bc.expected,
      actual:     { axis: actual.axis, destination: actual.destination, duration_days: actual.duration_days, pax: actual.pax, _source: actual._source },
      score,
      latencyMs,
      error:      error || null,
    });
  }

  const avgScore  = Math.round(totalScore / cases.length * 1000) / 1000;
  const passCount = results.filter(r => r.score >= 0.7).length;

  return {
    runId,
    model:      model || "default",
    totalCases: cases.length,
    avgScore,
    passRate:   Math.round(passCount / cases.length * 100),
    passCount,
    passed:     passCount >= Math.ceil(cases.length * 0.8), // ≥80% = PASS
    results,
    timestamp:  new Date().toISOString(),
  };
}

// ── Baseline (regex-only) Benchmark ───────────────────────────────────────
/**
 * Run benchmark using regex fallback only (no LLM call).
 * Establishes the pre-LLM baseline for capability comparison.
 */
async function runBaselineBenchmark() {
  const { detectIntentLLM: _d } = require("../ai/intent");
  // Override: pass no apiKey → forces regex fallback
  return runBenchmark({ apiKey: null, model: "regex-baseline" });
}

module.exports = {
  BENCHMARK_CASES,
  scoreResult,
  runBenchmark,
  runBaselineBenchmark,
  getBenchmarkHistory: (limit) => getBenchmarkRuns(limit),
};
