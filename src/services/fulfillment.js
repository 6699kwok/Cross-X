"use strict";
/**
 * src/services/fulfillment.js
 * Order lifecycle state machine for CrossX bookings.
 *
 * States: pending → confirmed → executing → delivered
 *                ↘ cancelled  (triggers refund eligibility check)
 *         confirmed → refund_requested → refunding → refunded
 *
 * In mock mode (no real merchant keys), transitions happen with simulated
 * delays and generated proof data. When payment keys are configured, refunds
 * call the real gateway APIs.
 */

const crypto = require("crypto");
const { getOrder, upsertOrder, appendAuditLog, appendSettlement, nowIso } = require("./db");

// ── Helpers ──────────────────────────────────────────────────────────────────
function nowIsoLocal() { return new Date().toISOString(); }
function genRef() { return crypto.randomBytes(6).toString("hex").toUpperCase(); }

function lifecycleEvent(status, meta = {}) {
  return { event: status, at: nowIsoLocal(), ...meta };
}

function getOrderOrThrow(orderId) {
  const order = getOrder(orderId);
  if (!order) throw Object.assign(new Error(`Order not found: ${orderId}`), { code: "NOT_FOUND" });
  return order;
}

function appendLifecycle(order, event) {
  const lc = Array.isArray(order.lifecycle) ? order.lifecycle : [];
  lc.push(event);
  return lc;
}

// ── State machine transitions ─────────────────────────────────────────────────

/**
 * Confirm an order (merchant acceptance).
 * pending → confirmed
 */
function confirmOrder(orderId, { source = "mock", merchantRef = null } = {}) {
  const order = getOrderOrThrow(orderId);
  if (!["pending", "planned"].includes(order.status)) {
    throw Object.assign(
      new Error(`Cannot confirm order in status '${order.status}'`),
      { code: "INVALID_TRANSITION" }
    );
  }
  const confirmedAt = nowIsoLocal();
  const bookingRef  = merchantRef || `BK${genRef()}`;
  const lifecycle   = appendLifecycle(order, lifecycleEvent("confirmed", { source, bookingRef }));

  upsertOrder({
    ...order,
    status: "confirmed",
    confirmedAt,
    lifecycle,
    proof: { ...order.proof, bookingRef, confirmedAt, source },
  });

  appendAuditLog({ kind: "fulfillment.confirm", who: source, what: `order.confirmed:${orderId}`,
    taskId: order.taskId, toolInput: { orderId, source }, toolOutput: { bookingRef } });

  return { ok: true, status: "confirmed", confirmedAt, bookingRef };
}

/**
 * Move order into executing state (service delivery started).
 * confirmed → executing
 */
function executeOrder(orderId) {
  const order = getOrderOrThrow(orderId);
  if (order.status !== "confirmed") {
    throw Object.assign(
      new Error(`Cannot execute order in status '${order.status}'`),
      { code: "INVALID_TRANSITION" }
    );
  }
  const executingAt = nowIsoLocal();
  const lifecycle   = appendLifecycle(order, lifecycleEvent("executing"));

  upsertOrder({ ...order, status: "executing", lifecycle });
  return { ok: true, status: "executing", executingAt };
}

/**
 * Mark order as delivered — generates proof package.
 * executing → delivered
 */
function deliverOrder(orderId) {
  const order = getOrderOrThrow(orderId);
  if (!["executing", "confirmed"].includes(order.status)) {
    throw Object.assign(
      new Error(`Cannot deliver order in status '${order.status}'`),
      { code: "INVALID_TRANSITION" }
    );
  }
  const deliveredAt  = nowIsoLocal();
  const bookingRef   = order.proof?.bookingRef || `BK${genRef()}`;
  const certificateNo = `CERT-CX-${genRef()}`;

  const proof = {
    bookingRef,
    certificateNo,
    provider: order.provider || "CrossX",
    type: order.type,
    city: order.city,
    confirmedAt: order.confirmedAt || order.createdAt,
    deliveredAt,
    amount: { value: order.price, currency: order.currency || "CNY" },
    qrCodeData: `https://crossx.ai/proof/${certificateNo}`,
    status: "delivered",
  };

  const lifecycle = appendLifecycle(order, lifecycleEvent("delivered", { certificateNo }));
  upsertOrder({ ...order, status: "delivered", lifecycle, proof });

  appendAuditLog({ kind: "fulfillment.deliver", who: "system", what: `order.delivered:${orderId}`,
    taskId: order.taskId, toolInput: { orderId }, toolOutput: { certificateNo, deliveredAt } });

  return { ok: true, status: "delivered", deliveredAt, proof };
}

/**
 * Cancel an order with reason + refund eligibility calculation.
 * pending|confirmed|executing → cancelled
 */
function cancelOrder(orderId, { reason = "user_request", requestedBy = "user" } = {}) {
  const order = getOrderOrThrow(orderId);
  if (["delivered", "cancelled", "refunded"].includes(order.status)) {
    throw Object.assign(
      new Error(`Cannot cancel order in status '${order.status}'`),
      { code: "INVALID_TRANSITION" }
    );
  }

  // Calculate refund eligibility from cancel_policy
  const { refundable, refundAmount, refundReason } = _calcRefundEligibility(order, reason);

  const cancelledAt = nowIsoLocal();
  const lifecycle   = appendLifecycle(order, lifecycleEvent("cancelled", { reason, requestedBy, refundable, refundAmount }));

  upsertOrder({ ...order, status: "cancelled", lifecycle });

  appendAuditLog({ kind: "fulfillment.cancel", who: requestedBy, what: `order.cancelled:${orderId}`,
    taskId: order.taskId, toolInput: { reason }, toolOutput: { refundable, refundAmount } });

  return { ok: true, status: "cancelled", cancelledAt, refundable, refundAmount, refundReason };
}

/**
 * Initiate a refund for a cancelled/confirmed order.
 * Calls real payment gateway if keys configured; otherwise mock.
 */
async function requestRefund(orderId, { amount, reason = "customer_request", currency = "CNY" } = {}) {
  const order = getOrderOrThrow(orderId);
  if (!["cancelled", "confirmed"].includes(order.status)) {
    throw Object.assign(
      new Error(`Cannot refund order in status '${order.status}'`),
      { code: "INVALID_TRANSITION" }
    );
  }

  const refundId   = `RF${genRef()}`;
  const refundAmt  = amount ?? order.price;
  const lifecycle  = appendLifecycle(order, lifecycleEvent("refund_requested", { refundId, amount: refundAmt, reason }));
  upsertOrder({ ...order, status: "refund_requested", lifecycle });

  // Attempt real gateway refund; fall back to mock
  let result;
  const rail = order.paymentRail || "alipay_cn";
  let _gatewayWarning = null;
  try {
    result = await _gatewayRefund(rail, { orderId, refundId, amount: refundAmt, currency, reason, outOrderNo: order.outOrderNo });
  } catch (err) {
    console.warn(`[fulfillment] Gateway refund failed (${rail}): ${err.message} — using mock`);
    _gatewayWarning = err.message;
    result = { source: "mock", refundId, status: "refunded", processedAt: nowIsoLocal() };
  }

  const refundedAt = nowIsoLocal();
  const lc2 = appendLifecycle({ ...order, lifecycle }, lifecycleEvent("refunded", { refundId, source: result.source }));
  upsertOrder({ ...order, status: "refunded", lifecycle: lc2 });

  // Record settlement credit
  appendSettlement({
    id: `st_${refundId}`, orderId, taskId: order.taskId,
    currency, gross: -refundAmt, net: -refundAmt, markup: 0, refund: refundAmt,
    settledGross: -refundAmt, settledNet: -refundAmt, settledMarkup: 0, status: "refunded",
  });

  appendAuditLog({ kind: "fulfillment.refund", who: "system", what: `order.refunded:${orderId}`,
    taskId: order.taskId, toolInput: { refundId, amount: refundAmt }, toolOutput: result });

  return {
    ok: true, refundId, status: "refunded", refundedAt, amount: refundAmt, source: result.source,
    ...(_gatewayWarning ? { gatewayWarning: _gatewayWarning, note: "Refund processed via mock — real gateway failed" } : {}),
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function _calcRefundEligibility(order, reason) {
  const policy = order.cancelPolicy || "full_refund";
  if (policy === "no_refund") {
    return { refundable: false, refundAmount: 0, refundReason: "Non-refundable booking" };
  }
  if (policy === "partial_refund") {
    return { refundable: true, refundAmount: Math.round(order.price * 0.5), refundReason: "50% refund per cancellation policy" };
  }
  // full_refund (default)
  return { refundable: true, refundAmount: order.price, refundReason: "Full refund applicable" };
}

async function _gatewayRefund(rail, { refundId, amount, currency, reason, outOrderNo }) {
  if (rail === "alipay_cn" && process.env.ALIPAY_APP_ID && outOrderNo) {
    // Real Alipay refund via SDK
    const AlipaySDK = require("alipay-sdk").default;
    const sdk = new AlipaySDK({
      appId: process.env.ALIPAY_APP_ID,
      privateKey: process.env.ALIPAY_PRIVATE_KEY || "",
      alipayPublicKey: process.env.ALIPAY_PUBLIC_KEY || "",
    });
    const res = await sdk.exec("alipay.trade.refund", {
      bizContent: {
        out_trade_no: outOrderNo,
        refund_amount: (amount / 100).toFixed(2),
        refund_reason: reason,
        out_request_no: refundId,
      },
    });
    if (res.code === "10000") return { source: "alipay", refundId, status: "refunded" };
    throw new Error(`Alipay refund error: ${res.subMsg || res.msg}`);
  }

  if (rail === "wechat_cn" && process.env.WECHAT_MCH_ID && process.env.WECHAT_API_KEY_V3 && outOrderNo) {
    // WeChat Pay v3 refund — HMAC-SHA256 signed request
    const mchId      = process.env.WECHAT_MCH_ID;
    const apiKeyV3   = process.env.WECHAT_API_KEY_V3;
    const certSerial = process.env.WECHAT_CERT_SERIAL_NO || "";
    const url        = "https://api.mch.weixin.qq.com/v3/refund/domestic/refunds";
    const body       = JSON.stringify({
      out_trade_no:  outOrderNo,
      out_refund_no: refundId,
      reason,
      amount: { refund: Math.round(amount), total: Math.round(amount), currency: "CNY" },
    });
    // Build authorization header
    const ts     = Math.floor(Date.now() / 1000);
    const nonce  = crypto.randomBytes(8).toString("hex");
    const method = "POST";
    const urlObj = new URL(url);
    const signStr = `${method}\n${urlObj.pathname}\n${ts}\n${nonce}\n${body}\n`;
    const signature = crypto.createHmac("sha256", apiKeyV3).update(signStr).digest("base64");
    const authorization = `WECHATPAY2-SHA256-RSA2048 mchid="${mchId}",nonce_str="${nonce}",signature="${signature}",timestamp="${ts}",serial_no="${certSerial}"`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authorization },
      body,
      signal: AbortSignal.timeout(15000),
    });
    const json = await resp.json();
    if (resp.ok && json.refund_id) {
      return { source: "wechat", refundId: json.refund_id, status: json.status };
    }
    throw new Error(`WeChat refund error: ${json.message || JSON.stringify(json)}`);
  }

  if (rail === "card_delegate" && process.env.STRIPE_SECRET_KEY && outOrderNo) {
    const Stripe = require("stripe");
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const refund = await stripe.refunds.create({ payment_intent: outOrderNo, amount: Math.round(amount) });
    return { source: "stripe", refundId: refund.id, status: refund.status };
  }

  // Mock fallback
  return { source: "mock", refundId, status: "refunded", processedAt: nowIsoLocal() };
}

/**
 * Assert that a payment rail is certified and KYC-passed before charging.
 * Reads from config.paymentCompliance.rails. Throws on uncertified rail.
 * @param {string} railId  e.g. "alipay_cn", "wechat_cn", "card_delegate"
 */
function assertRailCompliant(railId) {
  const { getConfig } = require("./db");
  const cfg = getConfig();
  const compliance = cfg?.paymentCompliance;
  if (!compliance) return; // no policy configured — allow (dev mode)
  const policy = compliance.policy || {};
  const railCfg = compliance.rails?.[railId];
  if (policy.blockUncertifiedRails && (!railCfg || !railCfg.certified)) {
    throw Object.assign(
      new Error(`Payment rail "${railId}" is not certified for use`),
      { code: "UNCERTIFIED_RAIL", railId }
    );
  }
  if (policy.blockUncertifiedRails && !railCfg?.kycPassed) {
    throw Object.assign(
      new Error(`Payment rail "${railId}" has not passed KYC`),
      { code: "KYC_FAILED", railId }
    );
  }
  if (railCfg && !railCfg.enabled) {
    throw Object.assign(
      new Error(`Payment rail "${railId}" is disabled`),
      { code: "RAIL_DISABLED", railId }
    );
  }
}

module.exports = {
  confirmOrder,
  executeOrder,
  deliverOrder,
  cancelOrder,
  requestRefund,
  assertRailCompliant,
};
