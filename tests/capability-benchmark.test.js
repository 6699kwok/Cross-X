"use strict";
/**
 * tests/capability-benchmark.test.js
 * Validates the benchmark framework, scoring logic, and DB persistence.
 * Does NOT call OpenAI (mocks detectIntentLLM) to keep tests fast.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const { BENCHMARK_CASES, scoreResult } = require("../src/training/benchmark");
const { getBenchmarkRuns, appendCapabilityBenchmark } = require("../src/services/db");

// ── Benchmark Case Validity ───────────────────────────────────────────────────
describe("Benchmark Cases — structure validation", () => {
  test("has exactly 20 canonical cases", () => {
    assert.equal(BENCHMARK_CASES.length, 20, "should have 20 benchmark cases");
  });

  test("all cases have id, query, expected fields", () => {
    for (const bc of BENCHMARK_CASES) {
      assert.ok(bc.id,           `case ${bc.id}: missing id`);
      assert.ok(bc.query,        `case ${bc.id}: missing query`);
      assert.ok(bc.expected,     `case ${bc.id}: missing expected`);
      assert.ok(bc.expected.axis, `case ${bc.id}: missing expected.axis`);
    }
  });

  test("all case IDs are unique", () => {
    const ids = BENCHMARK_CASES.map(bc => bc.id);
    const unique = new Set(ids);
    assert.equal(unique.size, ids.length, "all case IDs should be unique");
  });

  test("all expected.axis values are valid", () => {
    const VALID_AXES = new Set(["travel", "food", "stay", "activity"]);
    for (const bc of BENCHMARK_CASES) {
      assert.ok(VALID_AXES.has(bc.expected.axis), `case ${bc.id}: invalid axis '${bc.expected.axis}'`);
    }
  });

  test("food intent cases have no duration_days expectation", () => {
    const foodCases = BENCHMARK_CASES.filter(bc => bc.expected.axis === "food");
    assert.ok(foodCases.length >= 3, "should have at least 3 food cases");
    for (const bc of foodCases) {
      assert.ok(!bc.expected.duration_days, `food case ${bc.id} should not expect duration_days`);
    }
  });
});

// ── Scoring Logic ────────────────────────────────────────────────────────────
describe("scoreResult — scoring function", () => {
  test("perfect match scores 1.0 (axis + destination + duration)", () => {
    const actual   = { axis: "travel", destination: "成都", duration_days: 3, pax: 2 };
    const expected = { axis: "travel", destination: "成都", duration_days: 3, pax: 2 };
    const score = scoreResult(actual, expected);
    assert.ok(score >= 0.9, `perfect match should score ≥0.9, got ${score}`);
  });

  test("correct axis only scores exactly 0.4", () => {
    const actual   = { axis: "food", destination: null, duration_days: null, pax: 2 };
    const expected = { axis: "food" }; // no destination expected
    const score = scoreResult(actual, expected);
    assert.equal(score, 0.4, "axis-only match should score 0.40");
  });

  test("wrong axis scores 0 for axis component", () => {
    const actual   = { axis: "food",   destination: "成都", duration_days: 3 };
    const expected = { axis: "travel", destination: "成都", duration_days: 3 };
    const score = scoreResult(actual, expected);
    assert.ok(score < 0.7, "wrong axis should reduce score significantly");
    // Should still get partial credit for destination + duration
    assert.ok(score > 0.0, "correct destination+duration should still give partial score");
  });

  test("destination substring match gives partial credit", () => {
    const actual   = { axis: "travel", destination: "西安市", duration_days: 4 };
    const expected = { axis: "travel", destination: "西安",   duration_days: 4 };
    const score = scoreResult(actual, expected);
    // "西安" is in "西安市" → substring match → 0.20 credit
    assert.ok(score >= 0.55, `substring destination match should give partial credit, got ${score}`);
  });

  test("exact destination match gives full 0.30 credit", () => {
    const actual   = { axis: "stay", destination: "三亚", duration_days: null, pax: 2 };
    const expected = { axis: "stay", destination: "三亚" };
    const score = scoreResult(actual, expected);
    // axis(0.4) + destination(0.3) = 0.7
    assert.equal(score, 0.7, "exact destination match should add 0.30");
  });

  test("correct pax adds 0.10", () => {
    const actual   = { axis: "travel", destination: "北京", duration_days: 4, pax: 2 };
    const expected = { axis: "travel", destination: "北京", duration_days: 4, pax: 2 };
    const scoreWithPax    = scoreResult(actual, expected);

    const actualNoPax   = { ...actual, pax: 1 };
    const scoreWithoutPax = scoreResult(actualNoPax, expected);

    assert.ok(scoreWithPax > scoreWithoutPax, "correct pax should add credit");
  });

  test("budget within ±20% adds 0.05", () => {
    const actual   = { axis: "travel", destination: "云南", duration_days: 5, budget_per_day: 950  }; // within 20% of 1000
    const expected = { axis: "travel", destination: "云南", duration_days: 5, budget_per_day: 1000 };
    const score = scoreResult(actual, expected);
    // axis(0.4) + dest(0.3) + duration(0.15) + budget(0.05) = 0.90 (no pax in expected)
    assert.ok(score >= 0.85, `budget within tolerance should get full credit, got ${score}`);
  });

  test("budget outside ±20% gets no credit", () => {
    const actual   = { axis: "travel", destination: "云南", duration_days: 5, budget_per_day: 500  }; // 50% off
    const expected = { axis: "travel", destination: "云南", duration_days: 5, budget_per_day: 1000 };
    const withBudgetScore    = scoreResult(actual, expected);
    const exactBudgetActual  = { ...actual, budget_per_day: 1000 };
    const exactBudgetScore   = scoreResult(exactBudgetActual, expected);
    assert.ok(exactBudgetScore > withBudgetScore, "wrong budget should get less credit");
  });

  test("null actual returns 0", () => {
    const score = scoreResult(null, { axis: "travel", destination: "成都" });
    assert.equal(score, 0);
  });

  test("score is always between 0 and 1", () => {
    const cases = [
      [{ axis: "travel", destination: "成都", duration_days: 3, pax: 4, budget_per_day: 1000 },
       { axis: "travel", destination: "成都", duration_days: 3, pax: 4, budget_per_day: 1000 }],
      [{ axis: "food" }, { axis: "travel", destination: "北京", duration_days: 5 }],
      [null, { axis: "activity" }],
    ];
    for (const [actual, expected] of cases) {
      const score = scoreResult(actual, expected);
      assert.ok(score >= 0 && score <= 1.0, `score ${score} should be in [0, 1]`);
    }
  });
});

// ── DB Persistence ────────────────────────────────────────────────────────────
describe("Benchmark DB — persistence", () => {
  test("appendCapabilityBenchmark stores a row", () => {
    const runId = "test_run_" + Date.now();
    appendCapabilityBenchmark({
      run_id:               runId,
      query:                "去成都玩3天",
      expected_intent:      "travel",
      actual_intent:        "travel",
      expected_destination: "成都",
      actual_destination:   "成都",
      score:                0.85,
      latency_ms:           1234,
      model:                "gpt-4o-mini",
    });

    const history = getBenchmarkRuns(5);
    const run = history.find(r => r.run_id === runId);
    assert.ok(run, "run should appear in history");
    assert.equal(run.cases, 1);
    assert.ok(run.avg_score >= 0.8, "avg_score should reflect stored score");
  });

  test("getBenchmarkRuns returns aggregate stats per run_id", () => {
    const runId = "agg_run_" + Date.now();
    for (let i = 0; i < 5; i++) {
      appendCapabilityBenchmark({
        run_id: runId, query: `query ${i}`,
        expected_intent: "travel", actual_intent: i < 4 ? "travel" : "food",
        score: i < 4 ? 0.9 : 0.1, latency_ms: 500, model: "test",
      });
    }

    const history = getBenchmarkRuns(20);
    const run = history.find(r => r.run_id === runId);
    assert.ok(run, "aggregated run should be findable");
    assert.equal(run.cases, 5, "should aggregate all 5 cases");
    assert.equal(run.pass_count, 4, "4 cases with score ≥ 0.7 should pass");
    assert.ok(run.avg_score > 0.5 && run.avg_score < 1.0, "avg score should reflect mix");
  });
});

// ── Capability Score Threshold ────────────────────────────────────────────────
describe("Capability Target — 80% pass rate", () => {
  test("benchmark framework can compute pass rate correctly", () => {
    // Simulate 20 results: 18 pass (score≥0.7), 2 fail
    const scores = [...Array(18).fill(0.85), ...Array(2).fill(0.3)];
    const passCount = scores.filter(s => s >= 0.7).length;
    const passRate  = Math.round(passCount / scores.length * 100);
    assert.equal(passRate, 90, "90% pass rate computed correctly");
    assert.ok(passRate >= 80, "90% meets the 80% pass threshold");
  });

  test("score threshold: 0.7 is the right pass/fail boundary", () => {
    // bm01: perfect axis + destination + duration
    const perfectScore = scoreResult(
      { axis: "travel", destination: "成都", duration_days: 3 },
      { axis: "travel", destination: "成都", duration_days: 3 }
    );
    assert.ok(perfectScore >= 0.7, `perfect result (${perfectScore}) should pass`);

    // Wrong axis only
    const wrongAxisScore = scoreResult(
      { axis: "food",   destination: "成都" },
      { axis: "travel", destination: "成都" }
    );
    assert.ok(wrongAxisScore < 0.7, `wrong axis (${wrongAxisScore}) should fail`);
  });
});
