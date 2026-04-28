"use strict";
/**
 * src/controllers/PaymentController.js
 * HTTP handlers for all /api/payments/* endpoints.
 *
 * Extracted from server.js — replaces ~160 inline route lines.
 *
 * Dependency injection via handler opts:
 *   { db, getUser, updateUser, appendAuditLog, saveDb,
 *     paymentRails, confirmPolicy, requireAdmin, whoFromReq, writeJson, readBody }
 */

const { normalizeRail } = require("../../lib/payments/rail");

// ── Rail compliance helpers (moved from server.js) ────────────────────────────

function getRailCompliance(db, railId) {
  const rid   = normalizeRail(railId);
  const rails = (db.paymentCompliance && db.paymentCompliance.rails) || {};
  return rails[rid] || { certified: false, kycPassed: false, pciDss: false, riskTier: "high", enabled: false };
}

function canUseRail(db, railId) {
  const policy     = (db.paymentCompliance && db.paymentCompliance.policy) || {};
  const compliance = getRailCompliance(db, railId);
  if (compliance.enabled !== true)
    return { ok: false, code: "rail_disabled",      reason: "Rail is disabled by compliance policy." };
  if (policy.blockUncertifiedRails !== false && compliance.certified !== true)
    return { ok: false, code: "rail_not_certified", reason: "Rail is not certified." };
  if (policy.requireFraudScreen && compliance.kycPassed !== true)
    return { ok: false, code: "rail_kyc_missing",   reason: "Rail KYC check not passed." };
  return { ok: true, compliance };
}

function buildComplianceSummary(db) {
  return {
    policy: (db.paymentCompliance && db.paymentCompliance.policy) || {},
    rails:  (db.paymentCompliance && db.paymentCompliance.rails)  || {},
  };
}

function buildRailsStatus(db, paymentRails, userId) {
  const userRail = (() => {
    const summary  = buildComplianceSummary(db);
    const user     = db.users?.[userId || "demo"];
    const selected = normalizeRail(user && user.paymentRail && user.paymentRail.selected);
    if (selected && canUseRail(db, selected).ok) return selected;
    const fallback = paymentRails.listRails().find((r) => canUseRail(db, r.id).ok);
    return fallback ? fallback.id : selected;
  })();
  const compliance = buildComplianceSummary(db);
  return {
    selected: userRail,
    policy:   compliance.policy,
    rails:    paymentRails.listRails().map((rail) => ({
      ...rail,
      compliance: compliance.rails[rail.id] || null,
      selectable: canUseRail(db, rail.id).ok,
      selected:   rail.id === userRail,
    })),
  };
}

// ── Route handlers ─────────────────────────────────────────────────────────────

// POST /api/payments/authorize
async function authorize(req, res, { db, getUser, updateUser, appendAuditLog, requireAdmin, whoFromReq, writeJson, readBody }) {
  if (!requireAdmin(req, res)) return;
  const body        = await readBody(req);
  const actor       = whoFromReq(req);
  const userId      = (actor !== "anon") ? actor : "demo";
  const existing    = getUser(userId) || getUser("demo");
  const newAuthDomain = {
    noPinEnabled: body.noPinEnabled !== false,
    dailyLimit:   Number(body.dailyLimit  ?? existing?.authDomain?.dailyLimit  ?? 200000),
    singleLimit:  Number(body.singleLimit ?? existing?.authDomain?.singleLimit ?? 50000),
  };
  updateUser(userId, { authDomain: newAuthDomain });
  appendAuditLog({ kind: "payment", who: actor, what: "payments.authorize.updated",
    taskId: null, toolInput: body, toolOutput: newAuthDomain });
  return writeJson(res, 200, { ok: true, authDomain: newAuthDomain });
}

// GET /api/payments/compliance
async function getCompliance(req, res, { db, writeJson }) {
  return writeJson(res, 200, { compliance: buildComplianceSummary(db) });
}

// POST /api/payments/compliance
async function updateCompliance(req, res, { db, appendAuditLog, saveDb, requireAdmin, whoFromReq, writeJson, readBody }) {
  if (!requireAdmin(req, res)) return;
  const body = await readBody(req);
  // Whitelist fields — prevent prototype pollution
  const safe = {};
  for (const k of ["region", "currency", "pciDss", "enabled", "notes"]) {
    if (body[k] !== undefined) safe[k] = body[k];
  }
  db.paymentCompliance = {
    ...db.paymentCompliance,
    ...safe,
    policy: { ...((db.paymentCompliance && db.paymentCompliance.policy) || {}),
              ...(body.policy && typeof body.policy === "object" ? body.policy : {}) },
    rails:  { ...((db.paymentCompliance && db.paymentCompliance.rails) || {}),
              ...(body.rails  && typeof body.rails  === "object" ? body.rails  : {}) },
  };
  appendAuditLog({ kind: "payment", who: whoFromReq(req), what: "payments.compliance.updated",
    taskId: null, toolInput: body, toolOutput: db.paymentCompliance });
  saveDb();
  return writeJson(res, 200, { ok: true, compliance: buildComplianceSummary(db) });
}

// POST /api/payments/compliance/certify
async function certifyRail(req, res, { db, appendAuditLog, saveDb, requireAdmin, whoFromReq, writeJson, readBody }) {
  if (!requireAdmin(req, res)) return;
  const body   = await readBody(req);
  const railId = normalizeRail(body.railId);
  const prev   = getRailCompliance(db, railId);
  db.paymentCompliance.rails[railId] = {
    ...prev,
    certified: body.certified !== false,
    kycPassed: body.kycPassed !== false,
    pciDss:    body.pciDss    !== false,
    enabled:   body.enabled   !== false,
    riskTier:  body.riskTier  || prev.riskTier || "medium",
  };
  const updated = db.paymentCompliance.rails[railId];
  appendAuditLog({ kind: "payment", who: whoFromReq(req), what: "payments.compliance.certified",
    taskId: null, toolInput: body, toolOutput: { railId, compliance: updated } });
  saveDb();
  return writeJson(res, 200, { ok: true, railId, compliance: updated });
}

// GET /api/payments/rails
async function getRails(req, res, { db, paymentRails, whoFromReq, writeJson }) {
  return writeJson(res, 200, buildRailsStatus(db, paymentRails, whoFromReq(req)));
}

// POST /api/payments/rails/select
async function selectRail(req, res, { db, updateUser, appendAuditLog, paymentRails, whoFromReq, writeJson, readBody }) {
  const body   = await readBody(req);
  const railId = normalizeRail(body.railId);
  const check  = canUseRail(db, railId);
  if (!check.ok) {
    return writeJson(res, 409, { error: check.reason, code: check.code, railId, compliance: getRailCompliance(db, railId) });
  }
  const who    = whoFromReq(req);
  const userId = (who !== "anon" && who !== "dev") ? who : "demo";
  updateUser(userId, { paymentRail: { selected: railId } });
  appendAuditLog({ kind: "payment", who, what: "payments.rail.selected",
    taskId: null, toolInput: body, toolOutput: { selected: railId } });
  return writeJson(res, 200, { ok: true, ...buildRailsStatus(db, paymentRails, who) });
}

// POST /api/payments/verify-intent
async function verifyIntent(req, res, { confirmPolicy, writeJson, readBody }) {
  const body      = await readBody(req);
  const rawAmount = Number(body.amount);
  if (isNaN(rawAmount) || rawAmount < 0) return writeJson(res, 400, { error: "invalid_amount" });
  return writeJson(res, 200, confirmPolicy.verifyIntent({ amount: rawAmount, secondFactor: body.secondFactor }));
}

// POST /api/payments/charge
async function charge(req, res, { db, getUser, paymentRails, whoFromReq, writeJson, readBody }) {
  const body    = await readBody(req);
  const { railId = "alipay_cn", amount = 0, currency = "CNY", taskId = "" } = body;
  const who     = whoFromReq(req);
  const userId  = who !== "anon" ? who : String(body.userId || "anon");

  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0)
    return writeJson(res, 400, { error: "invalid_amount", message: "Amount must be a positive number." });
  if (amt > 100_000)
    return writeJson(res, 400, { error: "amount_exceeds_limit", message: "Single charge may not exceed ¥100,000." });

  // Plus subscription gate (bypassed in dev/sandbox mode)
  const devMode = !process.env.ALIPAY_APP_ID && !process.env.WECHAT_MCH_ID && !process.env.STRIPE_SECRET_KEY;
  if (!devMode) {
    const gateUser = (userId !== "demo" && userId !== "anon") ? getUser(userId) : db.users?.demo;
    if (!gateUser?.plusSubscription?.active) {
      return writeJson(res, 402, { error: "plus_required",
        message: "Cross X Plus subscription required for payments.", upgrade: "/api/subscription/plus" });
    }
  }

  try {
    const result = await Promise.race([
      paymentRails.charge({ railId, amount: amt, currency, userId, taskId }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("charge_timeout")), 12000)),
    ]);
    return writeJson(res, 200, result);
  } catch (err) {
    console.error("[payments/charge] error:", err.message);
    return writeJson(res, 200, {
      ok: false, errorCode: "charge_error", latency: 0, provider: String(railId),
      source: "payment_rail", sourceTs: new Date().toISOString(),
      data: { amount: amt, currency, railId, paymentRef: "", gatewayRef: "" },
    });
  }
}

module.exports = { authorize, getCompliance, updateCompliance, certifyRail, getRails, selectRail, verifyIntent, charge };
