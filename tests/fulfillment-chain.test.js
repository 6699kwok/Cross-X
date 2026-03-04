"use strict";
/**
 * tests/fulfillment-chain.test.js
 * Tests the full execution chain:
 *   runner.js → fulfillment state machine → delivered order with certificateNo
 *   makeProof receives and uses real booking/payment refs from prior steps
 */

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");

// ─── Fulfillment State Machine ────────────────────────────────────────────────

describe("Fulfillment state machine — full lifecycle", () => {
  let confirmOrder, executeOrder, deliverOrder, cancelOrder, requestRefund;
  let upsertOrder, getOrder;
  let DB_PATH;

  before(() => {
    DB_PATH = path.join(os.tmpdir(), `cx_fulfillment_test_${Date.now()}.db`);
    process.env.CROSSX_DB_PATH = DB_PATH;
    for (const key of Object.keys(require.cache)) {
      if (key.includes("/src/services/db")) delete require.cache[key];
      if (key.includes("/src/services/fulfillment")) delete require.cache[key];
    }
    ({ upsertOrder, getOrder } = require("../src/services/db"));
    ({ confirmOrder, executeOrder, deliverOrder, cancelOrder, requestRefund } = require("../src/services/fulfillment"));
  });

  after(() => {
    delete process.env.CROSSX_DB_PATH;
    try { fs.unlinkSync(DB_PATH); } catch {}
  });

  function makeTestOrder(id, extra = {}) {
    return {
      id,
      taskId: `task_${id}`,
      tripId: null,
      provider: "Partner Restaurant Network",
      type: "eat",
      city: "Shanghai",
      price: 280,
      currency: "CNY",
      pricing: { basePrice: 280, finalPrice: 280, currency: "CNY" },
      cancelPolicy: "full_refund",
      merchant: "Test Merchant",
      paymentRail: "alipay_cn",
      status: "planned",
      paymentStatus: "pending",
      refundable: true,
      proof: { qrText: "TEST", orderNo: "CX123", bilingualAddress: "CN: 测试 / EN: Test", navLink: "https://uri.amap.com/search?keyword=test", itinerary: "Test" },
      proofItems: [],
      lifecycle: [{ state: "created", label: "Created", at: new Date().toISOString() }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...extra,
    };
  }

  test("planned → confirmed → executing → delivered produces certificateNo", () => {
    const orderId = `ord_full_${Date.now()}`;
    upsertOrder(makeTestOrder(orderId));

    const c = confirmOrder(orderId, { merchantRef: "BK-ABCD01", source: "mcp" });
    assert.equal(c.ok, true);
    assert.equal(c.status, "confirmed");
    assert.equal(c.bookingRef, "BK-ABCD01");

    const e = executeOrder(orderId);
    assert.equal(e.ok, true);
    assert.equal(e.status, "executing");

    const d = deliverOrder(orderId);
    assert.equal(d.ok, true);
    assert.equal(d.status, "delivered");
    assert.ok(d.proof.certificateNo.startsWith("CERT-CX-"), "certificateNo should start with CERT-CX-");
    assert.ok(d.proof.qrCodeData.includes(d.proof.certificateNo), "qrCodeData should contain certificateNo");

    // Check final persisted state
    const final = getOrder(orderId);
    assert.equal(final.status, "delivered");
    assert.ok(final.proof.certificateNo, "persisted proof should have certificateNo");
  });

  test("confirmOrder rejects duplicate confirm (non-planned status)", () => {
    const orderId = `ord_dup_${Date.now()}`;
    upsertOrder(makeTestOrder(orderId));
    confirmOrder(orderId, { merchantRef: "BK-X" });
    assert.throws(
      () => confirmOrder(orderId, { merchantRef: "BK-X2" }),
      (err) => err.code === "INVALID_TRANSITION"
    );
  });

  test("executeOrder rejects if not confirmed", () => {
    const orderId = `ord_noconf_${Date.now()}`;
    upsertOrder(makeTestOrder(orderId));
    assert.throws(
      () => executeOrder(orderId),
      (err) => err.code === "INVALID_TRANSITION"
    );
  });

  test("cancelOrder from planned produces full refund", () => {
    const orderId = `ord_cancel_${Date.now()}`;
    upsertOrder(makeTestOrder(orderId));
    const result = cancelOrder(orderId, { reason: "user_request", requestedBy: "user" });
    assert.equal(result.ok, true);
    assert.equal(result.status, "cancelled");
    assert.equal(result.refundable, true);
    assert.equal(result.refundAmount, 280);
  });

  test("cancelOrder from delivered throws INVALID_TRANSITION", () => {
    const orderId = `ord_cancel_del_${Date.now()}`;
    upsertOrder(makeTestOrder(orderId));
    confirmOrder(orderId, { merchantRef: "BK-DEL" });
    executeOrder(orderId);
    deliverOrder(orderId);
    assert.throws(
      () => cancelOrder(orderId),
      (err) => err.code === "INVALID_TRANSITION"
    );
  });

  test("20 concurrent fulfillment chains complete without corruption", async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `ord_conc_${Date.now()}_${i}`);
    ids.forEach(id => upsertOrder(makeTestOrder(id)));
    await Promise.all(ids.map(async id => {
      confirmOrder(id, { merchantRef: `BK-${id}` });
      executeOrder(id);
      const d = deliverOrder(id);
      assert.ok(d.proof.certificateNo.startsWith("CERT-CX-"), `${id}: certificateNo invalid`);
    }));
    // Spot check 5
    for (const id of ids.slice(0, 5)) {
      const order = getOrder(id);
      assert.equal(order.status, "delivered");
    }
  });
});

// ─── Runner → makeProof data injection ────────────────────────────────────────

describe("runner.js — makeProof receives real step data", () => {
  test("food makeProof uses lockId from book.lock when provided", async () => {
    const { createFoodTools } = require("../lib/tools/food.js");
    const tools = createFoodTools({});
    const result = await tools.makeProof({
      place: "Dragon Palace",
      city: "Shanghai",
      bookingRef: "BK-REAL01",
      lockId: "BK-REAL01",
      paymentRef: "PAY-REAL01",
    });
    assert.ok(result.ok);
    assert.ok(result.data.itinerary.includes("BK-REAL01"), "itinerary should contain bookingRef");
    assert.ok(result.data.itinerary.includes("PAY-REAL01"), "itinerary should contain paymentRef");
    assert.equal(result.data.bookingRef, "BK-REAL01");
    assert.equal(result.data.paymentRef, "PAY-REAL01");
  });

  test("food makeProof falls back to generic text when no booking refs", async () => {
    const { createFoodTools } = require("../lib/tools/food.js");
    const tools = createFoodTools({});
    const result = await tools.makeProof({ place: "Noodle Bar", city: "Beijing" });
    assert.ok(result.ok);
    assert.ok(result.data.itinerary.includes("Seat reserved") || result.data.itinerary.includes("已预留"), "fallback itinerary should be present");
    assert.equal(result.data.bookingRef, null);
  });

  test("travel makeProof uses ticketRef from transport.lock when provided", async () => {
    const { createTravelTools } = require("../lib/tools/travel.js");
    const tools = createTravelTools({});
    const result = await tools.makeProof({
      destination: "Pudong Airport",
      city: "Shanghai",
      ticketRef: "TR-REAL99",
      paymentRef: "PAY-TR99",
    });
    assert.ok(result.ok);
    assert.ok(result.data.itinerary.includes("TR-REAL99"), "itinerary should contain ticketRef");
    assert.ok(result.data.itinerary.includes("PAY-TR99"), "itinerary should contain paymentRef");
    assert.equal(result.data.ticketRef, "TR-REAL99");
    assert.equal(result.data.paymentRef, "PAY-TR99");
  });

  test("travel makeProof falls back to generic text when no ticket ref", async () => {
    const { createTravelTools } = require("../lib/tools/travel.js");
    const tools = createTravelTools({});
    const result = await tools.makeProof({ destination: "Airport" });
    assert.ok(result.ok);
    assert.ok(result.data.itinerary.includes("Pickup") || result.data.itinerary.includes("上车"), "fallback itinerary should be present");
    assert.equal(result.data.ticketRef, null);
  });
});

// ─── runner.js executePlan → end-to-end ───────────────────────────────────────

describe("executePlan — proof.card receives prior step context", () => {
  const { executePlan } = require("../lib/runner.js");

  function makeMockFoodTools({ lockIdOverride, payRefOverride } = {}) {
    return {
      food: {
        queryMap: async () => ({
          ok: true, latency: 10, mcpOp: "query",
          data: { query: "test", picks: [{ name: "Dim Sum Palace", score: 95 }], provider: "CrossX Mock Provider", source: "mock", sourceTs: new Date().toISOString() },
        }),
        checkQueue: async () => ({
          ok: true, latency: 10, mcpOp: "status",
          data: { waitMin: 5, seatsLeft: 3, provider: "Restaurant Queue Partner", source: "queue_partner", sourceTs: new Date().toISOString() },
        }),
        lockBooking: async () => ({
          ok: true, latency: 10, mcpOp: "book",
          data: { lockId: lockIdOverride || "BK-MOCK01", expiresInSec: 600, provider: "Partner Restaurant Network", source: "restaurant_partner", sourceTs: new Date().toISOString() },
        }),
        payAct: async () => ({
          ok: true, latency: 10, mcpOp: "pay",
          data: { paymentRef: payRefOverride || "PAY-MOCK01", amount: 200, currency: "CNY", railId: "alipay_cn", railLabel: "Alipay CN", provider: "ACT Gateway", source: "act_gateway", sourceTs: new Date().toISOString() },
        }),
        makeProof: async (inp) => ({
          ok: true, latency: 10, mcpOp: "deliverable",
          data: {
            bilingualAddress: "CN: 测试 / EN: Test",
            navLink: "https://uri.amap.com/search?keyword=test",
            itinerary: inp.bookingRef
              ? `Seat confirmed [${inp.bookingRef}]${inp.paymentRef ? `, payment ${inp.paymentRef}` : ""}`
              : "18:30 Seat reserved",
            bookingRef: inp.bookingRef || null,
            paymentRef: inp.paymentRef || null,
            provider: "Cross X Core",
            source: "crossx_proof",
            sourceTs: new Date().toISOString(),
          },
        }),
      },
    };
  }

  test("runner passes lockId and paymentRef to makeProof input", async () => {
    let capturedProofInput = null;
    const tools = {
      food: {
        queryMap:    async () => ({ ok: true, latency: 5, mcpOp: "query",      data: { picks: [{ name: "Test", score: 90 }], query: "test", provider: "P", source: "mock", sourceTs: new Date().toISOString() } }),
        checkQueue:  async () => ({ ok: true, latency: 5, mcpOp: "status",     data: { waitMin: 10, seatsLeft: 4, provider: "P", source: "queue_partner", sourceTs: new Date().toISOString() } }),
        lockBooking: async () => ({ ok: true, latency: 5, mcpOp: "book",       data: { lockId: "BK-CAPTURE01", expiresInSec: 600, provider: "P", source: "restaurant_partner", sourceTs: new Date().toISOString() } }),
        payAct:      async () => ({ ok: true, latency: 5, mcpOp: "pay",        data: { paymentRef: "PAY-CAPTURE01", amount: 150, currency: "CNY", railId: "alipay_cn", railLabel: "Alipay CN", provider: "P", source: "act_gateway", sourceTs: new Date().toISOString() } }),
        makeProof:   async (inp) => { capturedProofInput = inp; return { ok: true, latency: 5, mcpOp: "deliverable", data: { bilingualAddress: "x", navLink: "https://uri.amap.com/search?keyword=x", itinerary: "x", provider: "Cross X Core", source: "crossx_proof", sourceTs: new Date().toISOString() } }; },
      },
    };

    const plan = {
      intentType: "eat",
      sourceIntent: "restaurant",
      constraints: { city: "Shanghai", budget: "medium" },
      confirm: { amount: 150, currency: "CNY", paymentRail: "alipay_cn" },
      steps: [
        { id: "s1", toolType: "map.query",    label: "Search",  status: "pending", etaSec: 2 },
        { id: "s2", toolType: "queue.status", label: "Queue",   status: "pending", etaSec: 2 },
        { id: "s3", toolType: "book.lock",    label: "Reserve", status: "pending", etaSec: 2 },
        { id: "s4", toolType: "pay.act",      label: "Pay",     status: "pending", etaSec: 2 },
        { id: "s5", toolType: "proof.card",   label: "Proof",   status: "pending", etaSec: 2 },
      ],
    };

    const result = await executePlan({ plan, tools, amount: 150, currency: "CNY", userId: "u1", taskId: "t1", paymentRail: "alipay_cn" });

    assert.ok(capturedProofInput, "makeProof should have been called");
    assert.equal(capturedProofInput.bookingRef, "BK-CAPTURE01", "bookingRef from book.lock should be passed to makeProof");
    assert.equal(capturedProofInput.lockId, "BK-CAPTURE01", "lockId should be passed to makeProof");
    assert.equal(capturedProofInput.paymentRef, "PAY-CAPTURE01", "paymentRef from pay.act should be passed to makeProof");
    assert.ok(result.proof, "result should have proof");
    assert.equal(result.outputs.length, 5, "all 5 steps should produce outputs");
  });

  test("runner executePlan: travel chain passes ticketRef to makeProof", async () => {
    let capturedProofInput = null;
    const tools = {
      travel: {
        planRoute:      async () => ({ ok: true, latency: 5, mcpOp: "query",  data: { route: "A→B", etaMin: 30, provider: "P", source: "mock", sourceTs: new Date().toISOString() } }),
        checkTraffic:   async () => ({ ok: true, latency: 5, mcpOp: "status", data: { congestionLevel: "low", risk: "low", provider: "P", source: "mock", sourceTs: new Date().toISOString() } }),
        lockTransport:  async () => ({ ok: true, latency: 5, mcpOp: "book",   data: { ticketRef: "TR-TRAVEL01", provider: "P", source: "mobility_partner", sourceTs: new Date().toISOString() } }),
        payAct:         async () => ({ ok: true, latency: 5, mcpOp: "pay",    data: { paymentRef: "PAY-TRAVEL01", amount: 300, currency: "CNY", railId: "alipay_cn", railLabel: "Alipay CN", provider: "P", source: "act_gateway", sourceTs: new Date().toISOString() } }),
        makeProof:      async (inp) => { capturedProofInput = inp; return { ok: true, latency: 5, mcpOp: "deliverable", data: { bilingualAddress: "x", navLink: "https://uri.amap.com/search?keyword=x", itinerary: "x", provider: "Cross X Core", source: "crossx_proof", sourceTs: new Date().toISOString() } }; },
      },
    };

    const plan = {
      intentType: "travel",
      sourceIntent: "airport transfer",
      constraints: { city: "Shanghai", destination: "Pudong Airport" },
      confirm: { amount: 300, currency: "CNY", paymentRail: "alipay_cn" },
      steps: [
        { id: "s1", toolType: "route.plan",      label: "Route",     status: "pending", etaSec: 2 },
        { id: "s2", toolType: "traffic.live",     label: "Traffic",   status: "pending", etaSec: 2 },
        { id: "s3", toolType: "transport.lock",   label: "Lock",      status: "pending", etaSec: 2 },
        { id: "s4", toolType: "pay.act",          label: "Pay",       status: "pending", etaSec: 2 },
        { id: "s5", toolType: "proof.card",       label: "Proof",     status: "pending", etaSec: 2 },
      ],
    };

    await executePlan({ plan, tools, amount: 300, currency: "CNY", userId: "u2", taskId: "t2", paymentRail: "alipay_cn" });

    assert.ok(capturedProofInput, "makeProof should have been called");
    assert.equal(capturedProofInput.ticketRef, "TR-TRAVEL01", "ticketRef from transport.lock should be passed");
    assert.equal(capturedProofInput.paymentRef, "PAY-TRAVEL01", "paymentRef from pay.act should be passed");
  });
});
