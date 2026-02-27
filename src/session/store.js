"use strict";
/**
 * src/session/store.js
 * In-memory session store for CrossX planner state.
 *
 * Security design:
 *   [S1] Physical isolation: every session keyed by UUID (crypto.randomBytes),
 *        never by sequential ID, username, or IP address alone.
 *   [S2] TTL enforcement: sessions auto-expire (default 4h); periodic GC runs
 *        every 30 min to clear stale entries.
 *   [S3] PII scrubbing: scrubPii() utility strips phone/email/ID numbers from
 *        any user text before it enters the session or gets forwarded to LLM.
 *
 * Session data shape (card_data from pipeline + planner metadata):
 * {
 *   plan:         { ...card_data }   — last generated plan
 *   plannerMeta:  { ...planner JSON } — Node 1 output (intent, budget, etc.)
 *   language:     "ZH" | "EN" | ...
 *   city:         string
 *   message:      string              — original user message that created plan
 *   createdAt:    number (ms)
 * }
 */

const crypto = require("crypto");

// ── Constants ─────────────────────────────────────────────────────────────────
const DEFAULT_TTL_MS = 4 * 60 * 60 * 1000;    // 4 hours
const GC_INTERVAL_MS = 30 * 60 * 1000;         // GC every 30 min

// ── Internal store ────────────────────────────────────────────────────────────
/** @type {Map<string, {data: object, expiresAt: number, updatedAt: number}>} */
const _store = new Map();

// Periodic GC — remove expired sessions proactively
const _gc = setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of _store) {
    if (entry.expiresAt <= now) _store.delete(id);
  }
}, GC_INTERVAL_MS);
_gc.unref(); // Don't block process exit

// ── UUID generation ───────────────────────────────────────────────────────────
/**
 * Generate a cryptographically secure session ID.
 * Format: "cxs_" + 32 hex chars  →  "cxs_" + 128-bit entropy
 * Never collides with sequential counters or IP-based keys.
 *
 * @returns {string}
 */
function generateSessionId() {
  return "cxs_" + crypto.randomBytes(16).toString("hex");
}

// ── CRUD ──────────────────────────────────────────────────────────────────────
/**
 * Create a new isolated session.
 * @param {object} [initialData={}]  Data to store (plan, metadata, etc.)
 * @param {number} [ttlMs]           TTL override (ms). Default: DEFAULT_TTL_MS.
 * @returns {string}  New sessionId
 */
function createSession(initialData = {}, ttlMs = DEFAULT_TTL_MS) {
  const id = generateSessionId();
  _store.set(id, {
    data:      { ...initialData },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    expiresAt: Date.now() + ttlMs,
  });
  return id;
}

/**
 * Get session data. Returns null if session not found or expired.
 * @param {string} sessionId
 * @returns {object|null}
 */
function getSession(sessionId) {
  if (!sessionId) return null;
  const entry = _store.get(sessionId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    _store.delete(sessionId);
    return null;
  }
  return entry.data;
}

/**
 * Replace entire session data. TTL is NOT reset unless ttlMs is provided.
 * @param {string} sessionId
 * @param {object} data
 * @param {number} [ttlMs]   Optional TTL refresh
 * @returns {boolean}  true if session existed and was updated
 */
function setSession(sessionId, data, ttlMs) {
  const entry = _store.get(sessionId);
  if (!entry || entry.expiresAt <= Date.now()) return false;
  entry.data      = { ...data };
  entry.updatedAt = Date.now();
  if (ttlMs) entry.expiresAt = Date.now() + ttlMs;
  return true;
}

/**
 * Shallow-merge patch into existing session data.
 * Only updates the keys present in `patch`; all other keys are preserved.
 * @param {string} sessionId
 * @param {object} patch
 * @returns {boolean}
 */
function patchSession(sessionId, patch) {
  const entry = _store.get(sessionId);
  if (!entry || entry.expiresAt <= Date.now()) return false;
  Object.assign(entry.data, patch);
  entry.updatedAt = Date.now();
  return true;
}

/**
 * Extend the TTL of a session (e.g., on user activity).
 * @param {string} sessionId
 * @param {number} [ttlMs]  New TTL from now. Default: DEFAULT_TTL_MS.
 * @returns {boolean}
 */
function touchSession(sessionId, ttlMs = DEFAULT_TTL_MS) {
  const entry = _store.get(sessionId);
  if (!entry) return false;
  entry.expiresAt = Date.now() + ttlMs;
  entry.updatedAt = Date.now();
  return true;
}

/**
 * Delete a session immediately (e.g., on logout or plan reset).
 * @param {string} sessionId
 */
function deleteSession(sessionId) {
  _store.delete(sessionId);
}

/**
 * Stats for /api/system/* health endpoints.
 * @returns {{ total: number, active: number }}
 */
function getStoreStats() {
  const now = Date.now();
  let active = 0;
  for (const entry of _store.values()) {
    if (entry.expiresAt > now) active++;
  }
  return { total: _store.size, active };
}

// ── PII scrubbing ─────────────────────────────────────────────────────────────
/**
 * [S3] Strip common PII patterns from a string before it enters the session
 * or is forwarded to an LLM. Replaces matches with placeholder tokens.
 *
 * Covered patterns:
 *   - Chinese mobile numbers  (1[3-9]XXXXXXXXX)         → [PHONE]
 *   - E-mail addresses                                   → [EMAIL]
 *   - Chinese national ID numbers (18-digit + optional X) → [ID_NUMBER]
 *   - Bank card / credit card numbers (15-16 digits)     → [CARD]
 *
 * @param {string} text
 * @returns {string}
 */
function scrubPii(text) {
  if (typeof text !== "string") return text;
  return text
    // Chinese mobile  e.g. 13812345678
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, "[PHONE]")
    // Email address
    .replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, "[EMAIL]")
    // Chinese national ID (18 chars: 17 digits + digit/X)
    .replace(/[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]/g, "[ID_NUMBER]")
    // Credit / bank card (15-16 consecutive digits, not already matched)
    .replace(/(?<!\d)\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{3,4}(?!\d)/g, "[CARD]");
}

// ── Exports ───────────────────────────────────────────────────────────────────
module.exports = {
  DEFAULT_TTL_MS,
  generateSessionId,
  createSession,
  getSession,
  setSession,
  patchSession,
  touchSession,
  deleteSession,
  getStoreStats,
  scrubPii,
};
