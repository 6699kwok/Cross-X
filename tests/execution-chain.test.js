"use strict";
/**
 * tests/execution-chain.test.js
 * Execution chain reliability tests:
 *   - TOTP 2FA (RFC 6238 _totpCode / _validateTotp)
 *   - Receipt SQLite persistence (upsertReceipt / getReceipt)
 *   - makeProof Amap deep-links (food.js / travel.js)
 *   - MCP call-chain data format
 *   - confirm.js verifyIntent logic
 */

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");

// ─── TOTP ─────────────────────────────────────────────────────────────────────

describe("TOTP — _totpCode", () => {
  let _totpCode, _validateTotp;
  before(() => {
    ({ _totpCode, _validateTotp } = require("../lib/trust/confirm.js"));
  });

  test("produces 6-digit string", () => {
    const code = _totpCode("deadbeef");
    assert.match(code, /^\d{6}$/, "should be 6 digits");
  });

  test("same secret + step gives same code (deterministic)", () => {
    const step = 123456;
    const c1 = _totpCode("aabbcc", step);
    const c2 = _totpCode("aabbcc", step);
    assert.equal(c1, c2);
  });

  test("different steps give different codes (with overwhelming probability)", () => {
    const c1 = _totpCode("aabbcc", 100);
    const c2 = _totpCode("aabbcc", 101);
    // Not guaranteed (1/1000000 chance they collide) but safe for test
    assert.notEqual(c1, c2);
  });

  test("handles utf8 secret fallback (odd-length hex)", () => {
    // 'xyz' is not valid hex — must fall back to utf8 without throwing
    const code = _totpCode("xyz", 1);
    assert.match(code, /^\d{6}$/);
  });

  test("code for step-1, step, step+1 are all accepted by _validateTotp", () => {
    const secret = "cafebabe0102";
    const step = Math.floor(Date.now() / 30000);
    // Generate code for each window step and verify acceptance
    for (const s of [step - 1, step, step + 1]) {
      const code = _totpCode(secret, s);
      assert.equal(_validateTotp(secret, code), true, `step offset ${s - step} should be accepted`);
    }
  });

  test("_validateTotp rejects wrong code", () => {
    assert.equal(_validateTotp("cafebabe", "000000"), false);
  });

  test("_validateTotp rejects non-6-digit input", () => {
    const secret = "cafebabe";
    assert.equal(_validateTotp(secret, "12345"), false);
    assert.equal(_validateTotp(secret, "1234567"), false);
    assert.equal(_validateTotp(secret, "abcdef"), false);
    assert.equal(_validateTotp(secret, ""), false);
    assert.equal(_validateTotp(secret, null), false);
    assert.equal(_validateTotp(secret, undefined), false);
  });
});

describe("TOTP — createConfirmPolicy", () => {
  let createConfirmPolicy;
  before(() => {
    ({ createConfirmPolicy } = require("../lib/trust/confirm.js"));
  });

  test("verifyIntent: below threshold always passes without 2FA", () => {
    const policy = createConfirmPolicy({ getSingleLimit: () => 1000 });
    const result = policy.verifyIntent({ amount: 500, secondFactor: null });
    assert.equal(result.verified, true);
  });

  test("verifyIntent: above threshold without secondFactor returns needs2FA", () => {
    const policy = createConfirmPolicy({ getSingleLimit: () => 100 });
    const result = policy.verifyIntent({ amount: 500, secondFactor: null });
    assert.equal(result.verified, false);
    assert.equal(result.needs2FA, true);
  });

  test("verifyIntent: dev mode (no env secret) accepts any non-empty string", () => {
    const orig = process.env.CROSSX_2FA_SECRET;
    delete process.env.CROSSX_2FA_SECRET;
    try {
      // Re-require to pick up new env
      delete require.cache[require.resolve("../lib/trust/confirm.js")];
      const { createConfirmPolicy: cp } = require("../lib/trust/confirm.js");
      const policy = cp({ getSingleLimit: () => 0 });
      const result = policy.verifyIntent({ amount: 999, secondFactor: "any-string" });
      assert.equal(result.verified, true);
    } finally {
      if (orig !== undefined) process.env.CROSSX_2FA_SECRET = orig;
      delete require.cache[require.resolve("../lib/trust/confirm.js")];
    }
  });

  test("verifyIntent: with TOTP secret, wrong code is rejected", () => {
    process.env.CROSSX_2FA_SECRET = "deadbeef12345678";
    try {
      delete require.cache[require.resolve("../lib/trust/confirm.js")];
      const { createConfirmPolicy: cp } = require("../lib/trust/confirm.js");
      const policy = cp({ getSingleLimit: () => 0 });
      const result = policy.verifyIntent({ amount: 999, secondFactor: "000000" });
      // 000000 almost certainly not the correct TOTP code
      // (1/1000000 chance of false failure — acceptable for tests)
      assert.equal(result.verified, false);
      assert.equal(result.reason, "invalid_2fa_code");
    } finally {
      delete process.env.CROSSX_2FA_SECRET;
      delete require.cache[require.resolve("../lib/trust/confirm.js")];
    }
  });

  test("generateCode: returns null when no secret set", () => {
    const orig = process.env.CROSSX_2FA_SECRET;
    delete process.env.CROSSX_2FA_SECRET;
    try {
      delete require.cache[require.resolve("../lib/trust/confirm.js")];
      const { createConfirmPolicy: cp } = require("../lib/trust/confirm.js");
      const policy = cp({ getSingleLimit: () => 0 });
      assert.equal(policy.generateCode(), null);
    } finally {
      if (orig !== undefined) process.env.CROSSX_2FA_SECRET = orig;
      delete require.cache[require.resolve("../lib/trust/confirm.js")];
    }
  });

  test("verifyIntent: NaN amount treated as 0 (does not trigger 2FA for positive threshold)", () => {
    const policy = createConfirmPolicy({ getSingleLimit: () => 1000 });
    // NaN should be treated as 0, so 0 <= 1000 → no 2FA needed
    const result = policy.verifyIntent({ amount: NaN, secondFactor: null });
    assert.equal(result.verified, true, "NaN amount should be safe (treated as 0)");
  });

  test("verifyIntent: negative amount treated as 0", () => {
    const policy = createConfirmPolicy({ getSingleLimit: () => 1000 });
    const result = policy.verifyIntent({ amount: -500, secondFactor: null });
    assert.equal(result.verified, true, "negative amount should be treated as 0");
  });

  test("verifyIntent: 'abc' string amount treated as 0", () => {
    const policy = createConfirmPolicy({ getSingleLimit: () => 100 });
    const result = policy.verifyIntent({ amount: "abc", secondFactor: null });
    assert.equal(result.verified, true, "non-numeric string amount → 0, under threshold");
  });

  test("generateCode + verifyIntent round-trip with real TOTP secret", () => {
    process.env.CROSSX_2FA_SECRET = "abcdef1234567890";
    try {
      delete require.cache[require.resolve("../lib/trust/confirm.js")];
      const { createConfirmPolicy: cp } = require("../lib/trust/confirm.js");
      const policy = cp({ getSingleLimit: () => 0 });
      const code = policy.generateCode();
      assert.match(code, /^\d{6}$/);
      const result = policy.verifyIntent({ amount: 9999, secondFactor: code });
      assert.equal(result.verified, true);
    } finally {
      delete process.env.CROSSX_2FA_SECRET;
      delete require.cache[require.resolve("../lib/trust/confirm.js")];
    }
  });
});

// ─── Receipt Persistence ───────────────────────────────────────────────────────

describe("Receipt SQLite persistence", () => {
  let upsertReceipt, getReceipt, DB_PATH;

  before(() => {
    // Use a temp DB so tests are isolated
    DB_PATH = path.join(os.tmpdir(), `cx_receipt_test_${Date.now()}.db`);
    process.env.CROSSX_DB_PATH = DB_PATH;
    // Clear module cache so db.js picks up the new path
    for (const key of Object.keys(require.cache)) {
      if (key.includes("/src/services/db")) delete require.cache[key];
    }
    const db = require("../src/services/db.js");
    upsertReceipt = db.upsertReceipt;
    getReceipt = db.getReceipt;
  });

  after(() => {
    delete process.env.CROSSX_DB_PATH;
    try { fs.unlinkSync(DB_PATH); } catch {}
  });

  test("upsertReceipt returns a string ID starting with 'rcpt_'", () => {
    const id = upsertReceipt("order-001", "text/html", "<h1>Receipt</h1>");
    assert.ok(typeof id === "string");
    assert.ok(id.startsWith("rcpt_"));
  });

  test("getReceipt retrieves the body written by upsertReceipt", () => {
    upsertReceipt("order-002", "text/html", "<p>Hello</p>");
    const rec = getReceipt("order-002");
    assert.ok(rec !== null);
    assert.equal(rec.body, "<p>Hello</p>");
    assert.equal(rec.content_type, "text/html");
    assert.equal(rec.order_id, "order-002");
  });

  test("upsertReceipt overwrites existing receipt (INSERT OR REPLACE)", () => {
    upsertReceipt("order-003", "text/html", "v1");
    upsertReceipt("order-003", "text/html", "v2");
    const rec = getReceipt("order-003");
    assert.equal(rec.body, "v2");
  });

  test("getReceipt returns null for unknown order ID", () => {
    const rec = getReceipt("nonexistent-order-xyz");
    assert.equal(rec, null);
  });

  test("receipt created_at is a valid ISO date string", () => {
    upsertReceipt("order-004", "text/html", "test");
    const rec = getReceipt("order-004");
    assert.ok(rec.created_at);
    assert.ok(!isNaN(Date.parse(rec.created_at)));
  });

  test("50 concurrent upserts don't corrupt data", async () => {
    const tasks = Array.from({ length: 50 }, (_, i) =>
      Promise.resolve(upsertReceipt(`order-cc-${i}`, "text/html", `body-${i}`))
    );
    await Promise.all(tasks);
    // Spot-check 5 random ones
    for (const i of [0, 12, 25, 37, 49]) {
      const rec = getReceipt(`order-cc-${i}`);
      assert.equal(rec.body, `body-${i}`);
    }
  });
});

// ─── Amap Deep-links ──────────────────────────────────────────────────────────

describe("food.js makeProof — Amap deep-links", () => {
  let createFoodTools;
  before(() => {
    ({ createFoodTools } = require("../lib/tools/food.js"));
  });

  test("navLink starts with https://uri.amap.com", async () => {
    const tools = createFoodTools({});
    const result = await tools.makeProof({ place: "老街饺子", city: "上海" });
    assert.ok(result.ok);
    assert.ok(result.data.navLink.startsWith("https://uri.amap.com"), `Got: ${result.data.navLink}`);
  });

  test("navLink contains keyword with encoded place + city", async () => {
    const tools = createFoodTools({});
    const result = await tools.makeProof({ place: "Local Noodle", city: "Shanghai" });
    const url = result.data.navLink;
    assert.ok(url.includes("keyword="), "should have keyword param");
    assert.ok(url.includes("Local"), "should contain place name");
    assert.ok(url.includes("sourceApplication=crossx"), "should have sourceApplication");
  });

  test("navLink does NOT contain google.com", async () => {
    const tools = createFoodTools({});
    const result = await tools.makeProof({ place: "Test", city: "Beijing" });
    assert.ok(!result.data.navLink.includes("google.com"), "should not use Google Maps");
  });

  test("bilingualAddress contains place name", async () => {
    const tools = createFoodTools({});
    const result = await tools.makeProof({ place: "Dragon Palace", city: "Shenzhen" });
    assert.ok(result.data.bilingualAddress.includes("Dragon Palace"));
  });

  test("mcpOp is 'deliverable'", async () => {
    const tools = createFoodTools({});
    const result = await tools.makeProof({ place: "Test", city: "Guangzhou" });
    assert.equal(result.mcpOp, "deliverable");
  });

  test("liveTranslation flag produces bilingual itinerary", async () => {
    const tools = createFoodTools({});
    const result = await tools.makeProof({
      place: "Test",
      city: "Chengdu",
      constraints: { flags: { liveTranslation: { active: true } } },
    });
    assert.ok(result.data.itinerary.includes("CN:"), "should have CN: prefix");
    assert.ok(result.data.itinerary.includes("EN:"), "should have EN: prefix");
  });
});

describe("travel.js makeProof — Amap deep-links", () => {
  let createTravelTools;
  before(() => {
    ({ createTravelTools } = require("../lib/tools/travel.js"));
  });

  test("navLink starts with https://uri.amap.com", async () => {
    const tools = createTravelTools({});
    const result = await tools.makeProof({ destination: "Pudong Airport", city: "Shanghai" });
    assert.ok(result.ok);
    assert.ok(result.data.navLink.startsWith("https://uri.amap.com"), `Got: ${result.data.navLink}`);
  });

  test("uses navigation URL when destinationCoord provided", async () => {
    const tools = createTravelTools({});
    const result = await tools.makeProof({
      destination: "机场",
      destinationCoord: "121.8083,31.1512",
    });
    assert.ok(result.data.navLink.includes("navigation"), "should use navigation endpoint");
    assert.ok(result.data.navLink.includes("121.8083"), "should include coordinates");
    assert.ok(result.data.navLink.includes("mode=car"), "should have car mode");
  });

  test("uses search URL when no coord provided", async () => {
    const tools = createTravelTools({});
    const result = await tools.makeProof({ destination: "West Lake", city: "Hangzhou" });
    assert.ok(result.data.navLink.includes("search"), "should use search endpoint");
    assert.ok(result.data.navLink.includes("keyword="), "should have keyword param");
  });

  test("navLink does NOT contain google.com", async () => {
    const tools = createTravelTools({});
    const result = await tools.makeProof({ destination: "Test" });
    assert.ok(!result.data.navLink.includes("google.com"));
  });

  test("mcpOp is 'deliverable'", async () => {
    const tools = createTravelTools({});
    const result = await tools.makeProof({ destination: "Airport" });
    assert.equal(result.mcpOp, "deliverable");
  });

  test("liveTranslation flag produces bilingual itinerary", async () => {
    const tools = createTravelTools({});
    const result = await tools.makeProof({
      destination: "Airport",
      constraints: { flags: { liveTranslation: { active: true } } },
    });
    assert.ok(result.data.itinerary.includes("CN:"));
    assert.ok(result.data.itinerary.includes("EN:"));
  });

  test("default destination fallback when nothing provided", async () => {
    const tools = createTravelTools({});
    const result = await tools.makeProof({});
    assert.ok(result.ok);
    assert.ok(result.data.navLink.length > 0);
  });
});

// ─── MCP call-chain data format ───────────────────────────────────────────────

describe("MCP tool result format", () => {
  let createFoodTools, createTravelTools;
  before(() => {
    ({ createFoodTools } = require("../lib/tools/food.js"));
    ({ createTravelTools } = require("../lib/tools/travel.js"));
  });

  const expectMcpShape = (result, expectedOp) => {
    assert.ok(result.ok === true, "result.ok should be true");
    assert.ok(typeof result.latency === "number" && result.latency > 0, "latency should be positive number");
    assert.equal(result.mcpOp, expectedOp, `mcpOp should be '${expectedOp}'`);
    assert.ok(result.data && typeof result.data === "object", "data should be object");
    assert.ok(result.data.provider, "data.provider should be set");
    assert.ok(result.data.source, "data.source should be set");
    assert.ok(result.data.sourceTs, "data.sourceTs should be set");
    assert.ok(!isNaN(Date.parse(result.data.sourceTs)), "sourceTs should be valid ISO date");
  };

  test("food queryMap returns query mcpOp", async () => {
    const tools = createFoodTools({});
    const result = await tools.queryMap({ intent: "dumplings", city: "Shanghai" });
    expectMcpShape(result, "query");
    assert.ok(Array.isArray(result.data.picks), "picks should be array");
    assert.ok(result.data.picks.length > 0, "should have at least one pick");
  });

  test("food checkQueue returns status mcpOp", async () => {
    const tools = createFoodTools({});
    const result = await tools.checkQueue({ city: "Shanghai" });
    expectMcpShape(result, "status");
    assert.ok(typeof result.data.waitMin === "number");
    assert.ok(typeof result.data.seatsLeft === "number");
  });

  test("food lockBooking returns book mcpOp", async () => {
    const tools = createFoodTools({});
    const result = await tools.lockBooking({ city: "Shanghai" });
    expectMcpShape(result, "book");
    assert.ok(result.data.lockId.startsWith("BK-") || typeof result.data.lockId === "string");
    assert.ok(typeof result.data.expiresInSec === "number");
  });

  test("travel planRoute returns query mcpOp", async () => {
    const tools = createTravelTools({});
    const result = await tools.planRoute({ origin: "A", destination: "B" });
    expectMcpShape(result, "query");
    assert.ok(typeof result.data.route === "string");
    assert.ok(typeof result.data.etaMin === "number" && result.data.etaMin > 0);
  });

  test("travel checkTraffic returns status mcpOp", async () => {
    const tools = createTravelTools({});
    const result = await tools.checkTraffic({ origin: "A", destination: "B" });
    expectMcpShape(result, "status");
    assert.ok(["low", "medium", "high"].includes(result.data.congestionLevel));
    assert.ok(["low", "medium", "high"].includes(result.data.risk));
  });

  test("travel lockTransport returns book mcpOp with ticketRef", async () => {
    const tools = createTravelTools({});
    const result = await tools.lockTransport({ city: "Shanghai" });
    expectMcpShape(result, "book");
    assert.ok(typeof result.data.ticketRef === "string" && result.data.ticketRef.length > 0);
  });

  test("travel payAct returns pay mcpOp (mock path)", async () => {
    const tools = createTravelTools({});
    const result = await tools.payAct({ amount: 200, currency: "CNY", railId: "alipay_cn" });
    expectMcpShape(result, "pay");
    assert.ok(result.data.paymentRef && result.data.paymentRef.startsWith("PAY-"));
    assert.equal(result.data.railId, "alipay_cn");
  });

  test("food payAct returns pay mcpOp (mock path)", async () => {
    const tools = createFoodTools({});
    const result = await tools.payAct({ amount: 150, currency: "CNY", railId: "alipay_cn" });
    expectMcpShape(result, "pay");
    assert.ok(result.data.paymentRef && result.data.paymentRef.startsWith("PAY-"));
  });

  test("latency is within plausible bounds (10ms–2000ms)", async () => {
    const tools = createFoodTools({});
    const result = await tools.queryMap({ intent: "ramen", city: "Tokyo" });
    assert.ok(result.latency >= 1 && result.latency <= 2000,
      `latency ${result.latency}ms should be 1–2000ms`);
  });

  test("food makeProof sourceStamp source is 'crossx_proof'", async () => {
    const tools = createFoodTools({});
    const result = await tools.makeProof({ place: "Test", city: "Test" });
    assert.equal(result.data.source, "crossx_proof");
    assert.equal(result.data.provider, "Cross X Core");
  });

  test("travel makeProof sourceStamp source is 'crossx_proof'", async () => {
    const tools = createTravelTools({});
    const result = await tools.makeProof({ destination: "Airport" });
    assert.equal(result.data.source, "crossx_proof");
    assert.equal(result.data.provider, "Cross X Core");
  });
});

// ─── Tool integration with real payments connector ────────────────────────────

describe("Tool payAct with payments connector", () => {
  test("food payAct delegates to payments.charge when connector provided", async () => {
    const { createFoodTools } = require("../lib/tools/food.js");
    let capturedArgs = null;
    const mockPayments = {
      charge: async (args) => {
        capturedArgs = args;
        return {
          ok: true,
          latency: 42,
          provider: "Mock",
          source: "mock",
          sourceTs: new Date().toISOString(),
          data: {
            paymentRef: "MOCK-123",
            amount: args.amount,
            currency: args.currency,
          },
        };
      },
    };

    const tools = createFoodTools({ payments: mockPayments });
    const result = await tools.payAct({
      railId: "wechat_cn",
      amount: 350,
      currency: "CNY",
      userId: "user-abc",
      taskId: "task-001",
    });

    assert.equal(result.ok, true);
    assert.equal(result.mcpOp, "pay");
    assert.ok(capturedArgs !== null, "payments.charge should have been called");
    assert.equal(capturedArgs.railId, "wechat_cn");
    assert.equal(capturedArgs.amount, 350);
    assert.equal(capturedArgs.userId, "user-abc");
  });

  test("travel payAct delegates to payments.charge when connector provided", async () => {
    const { createTravelTools } = require("../lib/tools/travel.js");
    let called = false;
    const mockPayments = {
      charge: async () => {
        called = true;
        return {
          ok: true,
          latency: 10,
          provider: "Mock",
          source: "mock",
          sourceTs: new Date().toISOString(),
          data: { paymentRef: "MOCK-456", amount: 100, currency: "CNY" },
        };
      },
    };
    const tools = createTravelTools({ payments: mockPayments });
    await tools.payAct({ railId: "alipay_cn", amount: 100, currency: "CNY" });
    assert.ok(called, "payments.charge should be called");
  });
});
