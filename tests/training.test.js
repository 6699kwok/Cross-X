"use strict";
/**
 * tests/training.test.js
 * Training data pipeline, RLHF feedback, and prompt optimizer tests.
 */

const { test, describe, before } = require("node:test");
const assert = require("node:assert/strict");

// ── Shared setup ─────────────────────────────────────────────────────────────
const {
  upsertTrainingExample,
  getTrainingExamples,
  updateTrainingExampleScore,
  appendTrainingFeedback,
  getTrainingFeedback,
  upsertPromptExperiment,
  getPromptExperiments,
} = require("../src/services/db");

const { captureExample, recordSignal, recordFeedback, exportFineTuningJSONL, getTrainingStats, EXPORT_QUALITY_THRESHOLD } = require("../src/training/collector");
const { selectVariant, recordOutcome, getPromptStats, getWinningVariant } = require("../src/ai/promptOptimizer");

// ── Training Collector ────────────────────────────────────────────────────────
describe("Training Collector — captureExample", () => {
  test("captureExample returns an example ID", () => {
    const id = captureExample({
      deviceId:          "cx_test_device_001",
      userMessage:       "去成都玩3天，喜欢美食",
      assistantResponse: JSON.stringify({ destination: "成都", days: 3, hotel: "锦江宾馆" }),
      intent:            { axis: "travel", destination: "成都", duration_days: 3 },
      source:            "openai",
    });
    assert.ok(id, "should return an ID");
    assert.ok(id.startsWith("ex_"), "ID should start with ex_");
  });

  test("captureExample stores the example with correct base score", () => {
    const id = captureExample({
      deviceId:          "cx_test_device_002",
      userMessage:       "上海5天亲子游",
      assistantResponse: JSON.stringify({ destination: "上海", days: 5 }),
      intent:            { axis: "travel", destination: "上海", duration_days: 5 },
      source:            "coze",  // coze gets slightly higher base score
    });
    const rows = getTrainingExamples({ minScore: 0, limit: 10000 });
    const row  = rows.find(r => r.id === id);
    assert.ok(row, "example should be in DB");
    assert.ok(row.quality_score >= 0.5, "coze examples have base score ≥0.5");
    assert.equal(row.destination, "上海");
    assert.equal(row.source, "coze");
  });

  test("captureExample: null userMessage returns null", () => {
    const id = captureExample({ deviceId: "cx_x", userMessage: null, assistantResponse: "test", intent: {} });
    assert.equal(id, null, "should return null for missing userMessage");
  });

  test("captureExample: null assistantResponse returns null", () => {
    const id = captureExample({ deviceId: "cx_x", userMessage: "test", assistantResponse: null, intent: {} });
    assert.equal(id, null, "should return null for missing assistantResponse");
  });
});

describe("Training Collector — recordSignal", () => {
  test("booking signal increases quality score toward 1.0", () => {
    const id = upsertTrainingExample({
      user_message: "booking signal test", system_prompt: "sys", assistant_response: "resp",
      quality_score: 0.5, source: "openai",
    });
    recordSignal(id, "booking");
    const rows = getTrainingExamples({ minScore: 0, limit: 500 });
    const row  = rows.find(r => r.id === id);
    assert.ok(row.quality_score > 0.5, "booking signal should raise score");
    assert.ok(row.quality_score <= 1.0, "score should not exceed 1.0");
  });

  test("rating_low signal decreases quality score", () => {
    const id = upsertTrainingExample({
      user_message: "low rating test", system_prompt: "sys", assistant_response: "resp",
      quality_score: 0.5, source: "openai",
    });
    recordSignal(id, "rating_low");
    const rows = getTrainingExamples({ minScore: 0, limit: 500 });
    const row  = rows.find(r => r.id === id);
    assert.ok(row.quality_score < 0.5, "rating_low should lower score");
  });

  test("recordSignal: unknown signal type is a no-op", () => {
    const id = upsertTrainingExample({
      user_message: "noop test", system_prompt: "sys", assistant_response: "resp",
      quality_score: 0.6, source: "openai",
    });
    assert.doesNotThrow(() => recordSignal(id, "unknown_signal"));
  });

  test("recordSignal: non-existent ID is a no-op", () => {
    assert.doesNotThrow(() => recordSignal("ex_nonexistent", "booking"));
  });
});

describe("Training Collector — recordFeedback", () => {
  test("recordFeedback returns a feedback ID", () => {
    const id = captureExample({
      deviceId: "cx_fb_test", userMessage: "西安4天清真", assistantResponse: '{"ok":true}',
      intent: { destination: "西安" }, source: "openai",
    });
    const fbId = recordFeedback({ planId: "plan_001", deviceId: "cx_fb_test", rating: 5, comment: "very good", exampleId: id });
    assert.ok(fbId, "should return feedback ID");
    assert.ok(fbId.startsWith("tf_"), "feedback ID should start with tf_");
  });

  test("rating 5 marks signal_type as rating_high", () => {
    recordFeedback({ planId: "plan_002", deviceId: "cx_fb_002", rating: 5 });
    const rows = getTrainingFeedback("cx_fb_002");
    assert.ok(rows.length > 0, "feedback should be stored");
    assert.equal(rows[0].signal_type, "rating_high");
  });

  test("rating 1 marks signal_type as rating_low", () => {
    recordFeedback({ planId: "plan_003", deviceId: "cx_fb_003", rating: 1, comment: "terrible" });
    const rows = getTrainingFeedback("cx_fb_003");
    assert.equal(rows[0].signal_type, "rating_low");
  });

  test("rating 3 marks signal_type as no_refine", () => {
    recordFeedback({ planId: "plan_004", deviceId: "cx_fb_004", rating: 3 });
    const rows = getTrainingFeedback("cx_fb_004");
    assert.equal(rows[0].signal_type, "no_refine");
  });
});

describe("Training Collector — exportFineTuningJSONL", () => {
  before(() => {
    // Seed some high-quality examples
    for (let i = 0; i < 5; i++) {
      upsertTrainingExample({
        user_message: `高质量示例 ${i}`, system_prompt: "sys", assistant_response: `{"dest":"成都","day":${i}}`,
        quality_score: 0.8 + i * 0.01, source: "openai", destination: "成都",
      });
    }
  });

  test("exportFineTuningJSONL returns valid JSONL", () => {
    const jsonl = exportFineTuningJSONL({ minScore: 0.6 });
    if (!jsonl) return; // no data yet = OK
    const lines = jsonl.split("\n").filter(Boolean);
    for (const line of lines) {
      const obj = JSON.parse(line);
      assert.ok(obj.messages, "each line should have messages field");
      assert.ok(Array.isArray(obj.messages), "messages should be an array");
      assert.ok(obj.messages.length >= 3, "should have system/user/assistant");
      assert.equal(obj.messages[0].role, "system");
      assert.equal(obj.messages[1].role, "user");
      assert.equal(obj.messages[2].role, "assistant");
    }
  });

  test("exportFineTuningJSONL respects minScore filter", () => {
    const high = exportFineTuningJSONL({ minScore: 0.95 });
    const low  = exportFineTuningJSONL({ minScore: 0.0 });
    const highCount = high.split("\n").filter(Boolean).length;
    const lowCount  = low.split("\n").filter(Boolean).length;
    assert.ok(lowCount >= highCount, "lower minScore should yield >= results");
  });

  test("getTrainingStats returns expected shape", () => {
    const stats = getTrainingStats();
    assert.ok("total" in stats, "should have total");
    assert.ok("exportable" in stats, "should have exportable");
    assert.ok("bySource" in stats, "should have bySource");
    assert.ok("topCities" in stats, "should have topCities");
    assert.ok("scoreDistrib" in stats, "should have scoreDistrib");
    assert.ok(stats.total >= 0, "total should be non-negative");
    assert.ok(stats.exportThreshold === EXPORT_QUALITY_THRESHOLD, "threshold should match constant");
  });
});

// ── Prompt Optimizer ──────────────────────────────────────────────────────────
describe("Prompt Optimizer — selectVariant", () => {
  const PROMPT_ID = `test_prompt_${Date.now()}`;

  test("selectVariant returns first variant when no data", () => {
    const v = selectVariant(PROMPT_ID, ["v1_control", "v2_concise"]);
    assert.ok(["v1_control", "v2_concise"].includes(v), "should return one of the variants");
  });

  test("selectVariant returns single variant immediately", () => {
    const v = selectVariant(PROMPT_ID + "_single", ["only_v1"]);
    assert.equal(v, "only_v1");
  });

  test("selectVariant returns null for empty variants", () => {
    const v = selectVariant(PROMPT_ID, []);
    assert.equal(v, null);
  });

  test("after many wins for v2, selectVariant favors v2", () => {
    const pid = `test_prompt_bias_${Date.now()}`;
    // Record 20 wins for v2, 2 for v1
    for (let i = 0; i < 20; i++) recordOutcome(pid, "v2_test", true);
    for (let i = 0; i < 2;  i++) recordOutcome(pid, "v1_test", true);

    // Run 10 trials — v2 should win most
    let v2Wins = 0;
    for (let i = 0; i < 20; i++) {
      if (selectVariant(pid, ["v1_test", "v2_test"]) === "v2_test") v2Wins++;
    }
    assert.ok(v2Wins > 10, `v2 should be selected majority of time (got ${v2Wins}/20)`);
  });
});

describe("Prompt Optimizer — recordOutcome", () => {
  test("recordOutcome stores win/loss counts", () => {
    const pid = `rec_outcome_${Date.now()}`;
    recordOutcome(pid, "variant_a", true);
    recordOutcome(pid, "variant_a", true);
    recordOutcome(pid, "variant_a", false);

    const rows = getPromptExperiments(pid);
    const row  = rows.find(r => r.variant === "variant_a");
    assert.ok(row, "should have experiment row");
    assert.equal(row.win_count, 2);
    assert.equal(row.loss_count, 1);
    assert.equal(row.total_count, 3);
  });

  test("recordOutcome with won=false increments loss_count", () => {
    const pid = `rec_loss_${Date.now()}`;
    recordOutcome(pid, "v_loss", false);
    recordOutcome(pid, "v_loss", false);
    const rows = getPromptExperiments(pid);
    const row  = rows.find(r => r.variant === "v_loss");
    assert.equal(row.win_count,  0);
    assert.equal(row.loss_count, 2);
  });
});

describe("Prompt Optimizer — getWinningVariant", () => {
  test("returns null when no data", () => {
    const result = getWinningVariant("nonexistent_prompt_xyz");
    assert.equal(result, null);
  });

  test("returns null when total_count < minTrials", () => {
    const pid = `winner_test_${Date.now()}`;
    recordOutcome(pid, "v_a", true); // only 1 trial, below min 10
    const result = getWinningVariant(pid, 10);
    assert.equal(result, null, "should return null below minTrials threshold");
  });

  test("returns winning variant when enough data", () => {
    const pid = `winner_enough_${Date.now()}`;
    for (let i = 0; i < 12; i++) recordOutcome(pid, "winner", true);
    for (let i = 0; i < 12; i++) recordOutcome(pid, "loser", false);
    const result = getWinningVariant(pid, 10);
    assert.ok(result, "should return a result");
    assert.equal(result.variant, "winner");
    assert.ok(result.win_rate_pct > 50, "winner should have >50% win rate");
  });
});
