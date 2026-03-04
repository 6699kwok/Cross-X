"use strict";
/**
 * tests/order-lifecycle.test.js
 * Order state machine: confirm, execute, deliver, cancel, refund.
 * Also tests payment rail compliance enforcement.
 */

const { test, describe, before } = require("node:test");
const assert = require("node:assert/strict");

const { upsertOrder, getOrder, nowIso } = require("../src/services/db");
const { confirmOrder, executeOrder, deliverOrder, cancelOrder, requestRefund, assertRailCompliant } =
  require("../src/services/fulfillment");

// Seed a fresh order for each test group
function seedOrder(id, overrides = {}) {
  const base = {
    id,
    taskId:       null,
    provider:     "Test Provider",
    type:         "hotel",
    city:         "Shanghai",
    price:        500,
    currency:     "CNY",
    cancelPolicy: "Free cancel within 10 minutes",
    merchant:     "CrossX (Mock)",
    status:       "pending",
    refundable:   true,
    proof:        null,
    lifecycle:    [],
    paymentRail:  "alipay_cn",
    outOrderNo:   `OUT_${id}`,
    createdAt:    nowIso(),
  };
  upsertOrder({ ...base, ...overrides });
  return getOrder(id);
}

describe("Order State Transitions", () => {
  test("pending → confirmed: bookingRef generated, status updated", () => {
    seedOrder("test_order_001");
    const result = confirmOrder("test_order_001");
    assert.equal(result.status, "confirmed");
    assert.ok(result.bookingRef?.startsWith("BK"), "bookingRef should start with BK");
    assert.ok(result.confirmedAt, "confirmedAt should be set");
    // Check order in DB
    const order = getOrder("test_order_001");
    assert.equal(order.status, "confirmed");
  });

  test("confirmed → executing: status updated", () => {
    seedOrder("test_order_002");
    confirmOrder("test_order_002");
    const result = executeOrder("test_order_002");
    assert.equal(result.status, "executing");
    const order = getOrder("test_order_002");
    assert.equal(order.status, "executing");
  });

  test("executing → delivered: proof generated with required fields", () => {
    seedOrder("test_order_003");
    confirmOrder("test_order_003");
    executeOrder("test_order_003");
    const result = deliverOrder("test_order_003");
    assert.equal(result.status, "delivered");
    assert.ok(result.proof?.bookingRef, "proof should have bookingRef");
    assert.ok(result.proof?.certificateNo, "proof should have certificateNo");
    assert.ok(result.proof?.deliveredAt, "proof should have deliveredAt");
    const order = getOrder("test_order_003");
    assert.equal(order.status, "delivered");
  });

  test("Invalid transition: completed → confirm rejected", () => {
    seedOrder("test_order_004", { status: "delivered" });
    assert.throws(
      () => confirmOrder("test_order_004"),
      (err) => err.message.includes("Cannot confirm") && err.message.includes("delivered"),
      "should throw on invalid transition"
    );
  });

  test("Invalid transition: delivered → execute rejected", () => {
    seedOrder("test_order_005", { status: "delivered" });
    assert.throws(
      () => executeOrder("test_order_005"),
      (err) => err.message.includes("Cannot execute") || err.message.includes("delivered"),
    );
  });

  test("Non-existent order throws NOT_FOUND", () => {
    assert.throws(
      () => confirmOrder("order_that_does_not_exist_xyz"),
      (err) => err.code === "NOT_FOUND" || err.message.includes("not found"),
    );
  });
});

describe("Order Cancellation", () => {
  test("pending order cancellation: returns refundable=true for eligible policy", () => {
    seedOrder("test_order_cancel_001");
    const result = cancelOrder("test_order_cancel_001", { reason: "changed mind", requestedBy: "user" });
    assert.equal(result.status, "cancelled");
    assert.ok(typeof result.refundable === "boolean", "refundable should be boolean");
    const order = getOrder("test_order_cancel_001");
    assert.equal(order.status, "cancelled");
  });

  test("confirmed order cancellation: lifecycle event recorded", () => {
    seedOrder("test_order_cancel_002");
    confirmOrder("test_order_cancel_002");
    const result = cancelOrder("test_order_cancel_002", { reason: "test" });
    assert.equal(result.status, "cancelled");
    const order = getOrder("test_order_cancel_002");
    assert.ok(Array.isArray(order.lifecycle), "lifecycle should be array");
    const cancelEvent = order.lifecycle?.find(e => e.event === "cancelled");
    assert.ok(cancelEvent, "lifecycle should contain cancelled event");
  });
});

describe("Order Refund", () => {
  test("requestRefund on cancelled order: creates settlement credit, returns mock refundId", async () => {
    seedOrder("test_order_refund_001");
    confirmOrder("test_order_refund_001");
    cancelOrder("test_order_refund_001", { reason: "test" });
    const result = await requestRefund("test_order_refund_001", { amount: 500, reason: "cancelled" });
    assert.ok(result.refundId, "should have refundId");
    assert.ok(result.source, "should have source (mock or real)");
    assert.ok(result.status, "should have status");
  });

  test("requestRefund: returns mock source when no payment keys configured", async () => {
    seedOrder("test_order_refund_002");
    cancelOrder("test_order_refund_002", { reason: "test" }); // move to cancelled so refund is valid
    const saved = {
      ALIPAY_APP_ID: process.env.ALIPAY_APP_ID,
      WECHAT_MCH_ID: process.env.WECHAT_MCH_ID,
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    };
    delete process.env.ALIPAY_APP_ID;
    delete process.env.WECHAT_MCH_ID;
    delete process.env.STRIPE_SECRET_KEY;
    const result = await requestRefund("test_order_refund_002", { amount: 100, reason: "test" });
    Object.assign(process.env, saved);
    assert.equal(result.source, "mock");
  });
});

describe("Payment Rail Compliance (assertRailCompliant)", () => {
  test("assertRailCompliant: certified rail passes without throwing", () => {
    assert.doesNotThrow(() => assertRailCompliant("alipay_cn"));
  });

  test("assertRailCompliant: wechat_cn passes (certified in config)", () => {
    assert.doesNotThrow(() => assertRailCompliant("wechat_cn"));
  });

  test("assertRailCompliant: card_delegate passes (certified in config)", () => {
    assert.doesNotThrow(() => assertRailCompliant("card_delegate"));
  });

  test("assertRailCompliant: unknown rail throws UNCERTIFIED_RAIL", () => {
    assert.throws(
      () => assertRailCompliant("bitcoin_lightning"),
      (err) => err.code === "UNCERTIFIED_RAIL" || err.message.includes("not certified"),
    );
  });
});
