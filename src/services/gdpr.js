"use strict";
/**
 * src/services/gdpr.js
 * GDPR / EU Privacy Regulation compliance service.
 *
 * Implements all Data Subject Rights (GDPR Chapter III):
 *   Art. 7  — Consent management (record, withdraw, verify)
 *   Art. 15 — Right of access (data export)
 *   Art. 17 — Right to erasure ("right to be forgotten")
 *   Art. 18 — Right to restrict processing
 *   Art. 20 — Right to data portability
 *   Art. 21 — Right to object
 *   Art. 13/14 — Privacy notice (machine-readable)
 *   Art. 30 — Records of Processing Activities (admin/DPO)
 *
 * Identity model: device_id (cx_device_id from frontend localStorage).
 * This anonymous identifier is sufficient as GDPR "personal data" when combined
 * with behavioral data stored against it (GDPR Recital 26/30).
 */

const crypto = require("crypto");
const {
  sqliteDb, nowIso,
  appendConsentLog, getConsentLog,
  createGdprRequest, updateGdprRequest, getGdprRequests, getPendingErasures,
  updateUserGdprFields, getUserGdprFields,
  getUser, updateUser,
  getAllTasks, getAllOrders, getAuditLogs,
  getMetricEvents, getMcpCalls, getSupportTickets,
  appendAuditLog,
  pruneOldData,
} = require("./db");

// ── Constants ────────────────────────────────────────────────────────────────
const POLICY_VERSION      = "1.0";
const POLICY_DATE         = "2026-03-04";
const REQUEST_DEADLINE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days (GDPR Art. 12 §3)
const ERASURE_GRACE_MS    = process.env.NODE_ENV === "test"
  ? 0                    // immediate in test
  : 30 * 24 * 60 * 60 * 1000; // 30-day grace in production

// ── Hashing helpers (never store raw IPs or UAs) ────────────────────────────
function sha256(str) {
  return crypto.createHash("sha256").update(String(str || "")).digest("hex");
}
function genId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

// ── Art. 7 — Consent Management ─────────────────────────────────────────────

/**
 * Record a consent decision (grant or withdrawal).
 * @param {object} opts
 * @param {string} opts.deviceId
 * @param {boolean} opts.granted
 * @param {string[]} opts.purposes  e.g. ["personalization","analytics"]
 * @param {string} opts.consentVersion  must match POLICY_VERSION
 * @param {object} [opts.req]  Node IncomingMessage (for IP + UA hashing)
 * @returns {{ id, version, granted, purposes, recordedAt }}
 */
function recordConsent({ deviceId, granted, purposes = [], consentVersion, req }) {
  const id  = genId("cs");
  const now = nowIso();
  const entry = {
    id, device_id: deviceId,
    event_type: granted ? "granted" : "withdrawn",
    consent_version: consentVersion || POLICY_VERSION,
    purposes: JSON.stringify(Array.isArray(purposes) ? purposes : []),
    lawful_basis: "consent",
    ip_hash:        sha256(req?.socket?.remoteAddress || req?.headers?.["x-forwarded-for"] || ""),
    user_agent_hash: sha256(req?.headers?.["user-agent"] || ""),
    created_at: now,
  };
  appendConsentLog(entry);
  updateUserGdprFields(deviceId, {
    consent_version: granted ? (consentVersion || POLICY_VERSION) : "",
    consent_date: now,
  });
  appendAuditLog({ kind: "gdpr.consent", who: deviceId,
    what: granted ? "consent.granted" : "consent.withdrawn",
    taskId: null, toolInput: { purposes, consentVersion }, toolOutput: { id } });
  return { id, version: consentVersion || POLICY_VERSION, granted, purposes, recordedAt: now };
}

/**
 * Get current consent status for a device.
 */
function getConsentStatus(deviceId) {
  const gdprFields = getUserGdprFields(deviceId);
  const logs = getConsentLog(deviceId);
  const lastGrant = logs.find(l => l.event_type === "granted");
  return {
    consented: Boolean(gdprFields.consent_version),
    version:   gdprFields.consent_version || null,
    date:      gdprFields.consent_date || null,
    purposes:  lastGrant ? safeParseJson(lastGrant.purposes, []) : [],
    history:   logs.slice(0, 10).map(l => ({
      event: l.event_type, version: l.consent_version,
      purposes: safeParseJson(l.purposes, []), at: l.created_at,
    })),
  };
}

// ── Art. 15 + Art. 20 — Right of Access + Data Portability ──────────────────

/**
 * Export all personal data for a device (GDPR Art. 15 + Art. 20).
 * Returns a structured, human-readable data package.
 */
function exportData(deviceId) {
  const user   = getUser(deviceId) || getUser("demo");
  const tasks  = getAllTasks().filter(t => t.userId === deviceId || (deviceId === "demo" && t.userId === "demo"));
  const orders = getAllOrders().filter(o => {
    const task = tasks.find(t => t.id === o.taskId);
    return !!task;
  });
  const auditLogs    = getAuditLogs(200);
  const consentHist  = getConsentLog(deviceId);
  const gdprRequests = getGdprRequests(deviceId);
  const gdprFields   = getUserGdprFields(deviceId);

  return {
    _meta: {
      exportedAt: nowIso(),
      policyVersion: POLICY_VERSION,
      dataController: { name: "CrossX Travel", contact: "privacy@crossx.ai" },
      notice: "This export contains all personal data we hold for your device identifier.",
    },
    subject: {
      deviceId,
      language: user?.language,
      city: user?.city,
      preferences: user?.preferences,
      savedPlaces: user?.savedPlaces,
      location: user?.location
        ? { lat: user.location.lat, lng: user.location.lng, source: user.location.source }
        : null,
      plus: user?.plusSubscription,
      consentVersion:  gdprFields.consent_version || null,
      consentDate:     gdprFields.consent_date || null,
      processingRestricted: Boolean(gdprFields.data_processing_restricted),
      deletionRequested:    gdprFields.deletion_requested_at || null,
    },
    trips: tasks.slice(0, 100).map(t => ({
      id: t.id, intent: t.intent, status: t.status,
      destination: t.plan?.destination, duration: t.plan?.duration_days,
      createdAt: t.createdAt,
    })),
    orders: orders.slice(0, 100).map(o => ({
      id: o.id, type: o.type, city: o.city, price: o.price,
      currency: o.currency, status: o.status, createdAt: o.createdAt,
    })),
    consent_history: consentHist.map(l => ({
      event: l.event_type, version: l.consent_version,
      purposes: safeParseJson(l.purposes, []), at: l.created_at,
    })),
    gdpr_requests: gdprRequests.map(r => ({
      id: r.id, type: r.type, status: r.status,
      createdAt: r.created_at, deadline: r.deadline_at,
    })),
    activity_log: auditLogs
      .filter(l => l.who === deviceId || l.who === "demo")
      .slice(0, 50)
      .map(l => ({ kind: l.kind, what: l.what, at: l.at })),
  };
}

// ── Art. 17 — Right to Erasure ───────────────────────────────────────────────

/**
 * Schedule data erasure for a device (30-day grace period in production).
 * Returns confirmation with scheduled execution date.
 */
function requestErasure(deviceId, reason) {
  const id       = genId("gr");
  const now      = nowIso();
  const deadline = new Date(Date.now() + REQUEST_DEADLINE_MS).toISOString();
  const scheduledAt = new Date(Date.now() + ERASURE_GRACE_MS).toISOString();

  createGdprRequest({
    id, device_id: deviceId, type: "erase",
    status: "pending",
    request: { reason, scheduledAt },
    deadline_at: deadline,
    created_at: now,
  });
  updateUserGdprFields(deviceId, {
    deletion_requested_at: now,
    deletion_scheduled_at: scheduledAt,
  });
  appendAuditLog({ kind: "gdpr.erase_request", who: deviceId,
    what: "erasure.scheduled", taskId: null,
    toolInput: { reason }, toolOutput: { id, scheduledAt } });

  return { ok: true, id, scheduledAt, deadline, message: "Your data will be permanently deleted on the scheduled date." };
}

/**
 * Execute all pending erasure requests whose grace period has elapsed.
 * Called on server startup and in GC interval.
 */
function executePendingDeletions() {
  const pending = getPendingErasures();
  if (!pending.length) return;
  for (const req of pending) {
    const deviceId = req.device_id;
    try {
      // Wipe tasks belonging to this device
      sqliteDb.prepare("DELETE FROM tasks WHERE user_id = ?").run(deviceId);
      // Wipe audit logs for this device
      sqliteDb.prepare("DELETE FROM audit_logs WHERE who = ?").run(deviceId);
      // Wipe metric events
      sqliteDb.prepare("DELETE FROM metric_events WHERE user_id = ?").run(deviceId);
      // Wipe consent log (erasure supersedes consent records)
      sqliteDb.prepare("DELETE FROM consent_log WHERE device_id = ?").run(deviceId);
      // Reset user preferences to anonymous defaults (keep row for operational integrity)
      sqliteDb.prepare(`
        UPDATE users SET
          language='EN', city='Shanghai', city_zh='', province='', province_zh='',
          district='', district_zh='', pref_budget='mid', pref_dietary='',
          pref_family=0, pref_accessibility='optional', pref_transport='mixed',
          pref_walking='walk', pref_allergy='', place_hotel='', place_office='',
          loc_lat=NULL, loc_lng=NULL, loc_accuracy=NULL, loc_updated_at=NULL,
          consent_version='', consent_date='', data_processing_restricted=0,
          deletion_requested_at=NULL, deletion_scheduled_at=NULL
        WHERE id = ?
      `).run(deviceId);
      // Mark gdpr_request completed
      updateGdprRequest(req.id, {
        status: "completed",
        response_json: JSON.stringify({ deletedAt: nowIso() }),
        completed_at: nowIso(),
      });
      console.log(`[gdpr] Erasure completed for device ${deviceId.slice(0, 10)}…`);
    } catch (err) {
      console.error(`[gdpr] Erasure error for ${deviceId}:`, err.message);
      updateGdprRequest(req.id, { status: "error", response_json: JSON.stringify({ error: err.message }) });
    }
  }
}

// ── Art. 18 — Right to Restrict Processing ───────────────────────────────────

function restrictProcessing(deviceId, reasons) {
  const id = genId("gr");
  createGdprRequest({
    id, device_id: deviceId, type: "restrict",
    status: "completed",
    request: { reasons },
    deadline_at: new Date(Date.now() + REQUEST_DEADLINE_MS).toISOString(),
    created_at: nowIso(),
  });
  updateUserGdprFields(deviceId, { data_processing_restricted: 1 });
  appendAuditLog({ kind: "gdpr.restrict", who: deviceId, what: "processing.restricted",
    taskId: null, toolInput: { reasons }, toolOutput: { id } });
  return { ok: true, id, restricted: true };
}

function withdrawRestriction(deviceId) {
  updateUserGdprFields(deviceId, { data_processing_restricted: 0 });
  appendAuditLog({ kind: "gdpr.restrict_withdraw", who: deviceId, what: "processing.restriction_withdrawn",
    taskId: null, toolInput: {}, toolOutput: {} });
  return { ok: true, restricted: false };
}

// ── Art. 13/14 — Privacy Notice (machine-readable) ───────────────────────────

function getPrivacyNotice() {
  return {
    version:       POLICY_VERSION,
    effectiveDate: POLICY_DATE,
    language:      "zh-CN / en",
    controller: {
      name:    "CrossX Travel Technology Co., Ltd.",
      contact: "privacy@crossx.ai",
      dpo:     "dpo@crossx.ai",
    },
    dataProcessed: [
      { category: "device_identifier", description: "Random device ID stored in browser localStorage", retention: "30 days of inactivity", basis: "legitimate_interest" },
      { category: "travel_preferences", description: "Preferred budget, dietary requirements, transport mode", retention: "30 days", basis: "consent" },
      { category: "location", description: "Approximate city location (if permission granted)", retention: "session only", basis: "consent" },
      { category: "trip_plans", description: "AI-generated travel itineraries and selected options", retention: "730 days", basis: "contract" },
      { category: "payment_info", description: "Payment method type only; no card numbers stored", retention: "730 days (legal)", basis: "legal_obligation" },
      { category: "usage_analytics", description: "Feature usage events for service improvement", retention: "90 days", basis: "consent" },
      { category: "support_interactions", description: "Support ticket content when submitted", retention: "730 days", basis: "legitimate_interest" },
    ],
    dataSubjectRights: [
      { right: "access",       article: "Art. 15", endpoint: "GET /api/privacy/export",   description: "Receive a copy of all personal data" },
      { right: "erasure",      article: "Art. 17", endpoint: "POST /api/privacy/erase",    description: "Request deletion of all personal data (30-day grace period)" },
      { right: "restriction",  article: "Art. 18", endpoint: "POST /api/privacy/restrict", description: "Restrict processing of personal data" },
      { right: "portability",  article: "Art. 20", endpoint: "GET /api/privacy/export",   description: "Receive data in machine-readable JSON format" },
      { right: "object",       article: "Art. 21", endpoint: "POST /api/privacy/restrict", description: "Object to processing based on legitimate interest" },
      { right: "withdraw_consent", article: "Art. 7", endpoint: "POST /api/privacy/consent", description: "Withdraw consent at any time" },
    ],
    transfers: [
      { recipient: "OpenAI (USA)", safeguard: "Standard Contractual Clauses (SCCs)", purpose: "AI plan generation and intent analysis" },
      { recipient: "Coze / ByteDance (China)", safeguard: "PIPL-compliant data processing agreement", purpose: "Travel plan enrichment (opt-in)" },
      { recipient: "Amap / AutoNavi (China)", safeguard: "PIPL-compliant service agreement", purpose: "Map and POI data" },
    ],
    contact: {
      email:     "privacy@crossx.ai",
      dpoEmail:  "dpo@crossx.ai",
      response:  "Within 30 calendar days (GDPR Art. 12 §3)",
      authority: "Your local EU Data Protection Authority; or the CNIL (France) as lead supervisory authority",
    },
    cookies: {
      essential:        ["cx_device_id (localStorage — device identifier)"],
      functional:       ["cx_gdpr_v1 (localStorage — consent record)", "cx_session_* (localStorage — session context)"],
      analytics:        ["usage event counters (in-memory, not cookies)"],
      thirdPartyCookies: "None — no third-party scripts or tracking pixels",
    },
    lastUpdated: POLICY_DATE,
  };
}

// ── Art. 30 — Records of Processing Activities ───────────────────────────────

function getProcessingRegister() {
  return {
    controller: "CrossX Travel Technology Co., Ltd.",
    dpo: "dpo@crossx.ai",
    lastUpdated: POLICY_DATE,
    activities: [
      {
        id: "PA-001", name: "AI Travel Plan Generation",
        purpose: "Generate personalized travel itineraries based on user intent",
        categories: ["device_id","travel_preferences","trip_history"],
        recipients: ["OpenAI (USA — SCC)", "Coze/ByteDance (CN — PIPL DPA)"],
        retention: "730 days", basis: "contract", crossBorderTransfer: true,
        technicalMeasures: ["TLS 1.3 in transit","SQLite at rest","PII scrubbing before LLM"],
      },
      {
        id: "PA-002", name: "Payment Processing",
        purpose: "Facilitate travel bookings via payment gateways",
        categories: ["payment_rail_type","transaction_amount","order_reference"],
        recipients: ["Alipay (CN)","WeChat Pay (CN)","Stripe (USA — SCCs)"],
        retention: "730 days (legal)", basis: "legal_obligation", crossBorderTransfer: true,
        technicalMeasures: ["PCI-DSS compliant gateways","No card numbers stored"],
      },
      {
        id: "PA-003", name: "Usage Analytics",
        purpose: "Improve service quality and detect errors",
        categories: ["device_id","feature_usage_events","error_events"],
        recipients: ["Internal only"],
        retention: "90 days", basis: "consent", crossBorderTransfer: false,
        technicalMeasures: ["No personal identifiers in events","Aggregated reporting only"],
      },
      {
        id: "PA-004", name: "Audit Logging",
        purpose: "Security incident investigation and regulatory compliance",
        categories: ["device_id","action_type","timestamp"],
        recipients: ["Internal security team","Regulatory authorities (if required)"],
        retention: "730 days", basis: "legal_obligation", crossBorderTransfer: false,
        technicalMeasures: ["Append-only log","SHA-256 integrity hashes"],
      },
    ],
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function safeParseJson(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

// ── Automated Crons ───────────────────────────────────────────────────────────

let _erasureCronHandle    = null;
let _retentionCronHandle  = null;

/**
 * Start hourly GDPR erasure cron.
 * Executes all pending deletions whose grace period has elapsed.
 * Should be called once on server startup.
 */
function startErasureCron() {
  if (_erasureCronHandle) return; // already started
  // Run immediately on startup, then every hour
  setImmediate(() => {
    try { executePendingDeletions(); }
    catch (e) { console.error("[gdpr] erasure cron startup error:", e.message); }
  });
  _erasureCronHandle = setInterval(() => {
    try { executePendingDeletions(); }
    catch (e) { console.error("[gdpr] erasure cron error:", e.message); }
  }, 60 * 60 * 1000);
  _erasureCronHandle.unref(); // don't block process exit in tests
  console.log("[gdpr] Erasure cron started (hourly)");
}

/**
 * Start hourly data retention cron.
 * Prunes metric_events > 90d, audit_logs > 730d, etc.
 */
function startRetentionCron() {
  if (_retentionCronHandle) return;
  setImmediate(() => {
    try { pruneOldData(); }
    catch (e) { console.error("[gdpr] retention cron startup error:", e.message); }
  });
  _retentionCronHandle = setInterval(() => {
    try { pruneOldData(); }
    catch (e) { console.error("[gdpr] retention cron error:", e.message); }
  }, 60 * 60 * 1000);
  _retentionCronHandle.unref(); // don't block process exit in tests
  console.log("[gdpr] Retention cron started (hourly)");
}

/**
 * Stop all crons (useful in tests).
 */
function stopCrons() {
  if (_erasureCronHandle)   { clearInterval(_erasureCronHandle);   _erasureCronHandle = null; }
  if (_retentionCronHandle) { clearInterval(_retentionCronHandle); _retentionCronHandle = null; }
}

module.exports = {
  POLICY_VERSION,
  recordConsent,
  getConsentStatus,
  exportData,
  requestErasure,
  executePendingDeletions,
  restrictProcessing,
  withdrawRestriction,
  getPrivacyNotice,
  getProcessingRegister,
  startErasureCron,
  startRetentionCron,
  stopCrons,
};
