"use strict";
/**
 * src/session/store.js
 * In-memory session store for CrossX planner state, with JSON file persistence.
 *
 * Security design:
 *   [S1] Physical isolation: every session keyed by UUID (crypto.randomBytes),
 *        never by sequential ID, username, or IP address alone.
 *   [S2] TTL enforcement: sessions auto-expire (default 4h); periodic GC runs
 *        every 30 min to clear stale entries.
 *   [S3] PII scrubbing: scrubPii() utility strips phone/email/ID numbers from
 *        any user text before it enters the session or gets forwarded to LLM.
 *
 * Persistence:
 *   Sessions are flushed to SESSIONS_FILE (data/sessions.json) after each write
 *   using a 2-second debounce, and loaded on startup. This survives server
 *   restarts without requiring any npm packages (uses built-in fs).
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
const fs     = require("fs");
const path   = require("path");

// ── Constants ─────────────────────────────────────────────────────────────────
const DEFAULT_TTL_MS  = 4 * 60 * 60 * 1000;   // 4 hours
const GC_INTERVAL_MS  = 30 * 60 * 1000;        // GC every 30 min
const FLUSH_DEBOUNCE  = 2000;                   // ms — coalesce rapid writes

// Persist to <project_root>/data/sessions.json
const DATA_DIR      = path.join(__dirname, "..", "..", "data");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");

// ── Internal store ────────────────────────────────────────────────────────────
/** @type {Map<string, {data: object, createdAt: number, expiresAt: number, updatedAt: number}>} */
const _store = new Map();

// ── Startup load ──────────────────────────────────────────────────────────────
(function _loadFromDisk() {
  try {
    if (!fs.existsSync(SESSIONS_FILE)) return;
    const raw  = fs.readFileSync(SESSIONS_FILE, "utf8");
    const saved = JSON.parse(raw);
    const now   = Date.now();
    let loaded  = 0;
    for (const [id, entry] of Object.entries(saved)) {
      if (entry.expiresAt > now) {          // only load non-expired sessions
        _store.set(id, entry);
        loaded++;
      }
    }
    if (loaded > 0) console.log(`[session/store] Loaded ${loaded} sessions from disk`);
  } catch (e) {
    console.warn("[session/store] Could not load sessions from disk:", e.message);
  }
})();

// ── Flush to disk ─────────────────────────────────────────────────────────────
let _flushTimer = null;

function _scheduleFlush() {
  if (_flushTimer) return;                  // already scheduled
  _flushTimer = setTimeout(_flushNow, FLUSH_DEBOUNCE);
}

function _flushNow() {
  _flushTimer = null;
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const obj = Object.fromEntries(_store);
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(obj), "utf8");
  } catch (e) {
    console.warn("[session/store] Flush failed:", e.message);
  }
}

// Flush on clean shutdown
process.on("exit",    _flushNow);
process.on("SIGTERM", () => { _flushNow(); process.exit(0); });
process.on("SIGINT",  () => { _flushNow(); process.exit(0); });

// ── Periodic GC ───────────────────────────────────────────────────────────────
const _gc = setInterval(() => {
  const now     = Date.now();
  let   removed = 0;
  for (const [id, entry] of _store) {
    if (entry.expiresAt <= now) { _store.delete(id); removed++; }
  }
  if (removed > 0) { _scheduleFlush(); }
}, GC_INTERVAL_MS);
_gc.unref(); // Don't block process exit

// ── UUID generation ───────────────────────────────────────────────────────────
/**
 * Generate a cryptographically secure session ID.
 * Format: "cxs_" + 32 hex chars  →  "cxs_" + 128-bit entropy
 */
function generateSessionId() {
  return "cxs_" + crypto.randomBytes(16).toString("hex");
}

// ── CRUD ──────────────────────────────────────────────────────────────────────
function createSession(initialData = {}, ttlMs = DEFAULT_TTL_MS) {
  const id  = generateSessionId();
  const now = Date.now();
  _store.set(id, {
    data:      { ...initialData },
    createdAt: now,
    updatedAt: now,
    expiresAt: now + ttlMs,
  });
  _scheduleFlush();
  return id;
}

function getSession(sessionId) {
  if (!sessionId) return null;
  const entry = _store.get(sessionId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    _store.delete(sessionId);
    _scheduleFlush();
    return null;
  }
  return entry.data;
}

function setSession(sessionId, data, ttlMs) {
  const entry = _store.get(sessionId);
  if (!entry || entry.expiresAt <= Date.now()) return false;
  entry.data      = { ...data };
  entry.updatedAt = Date.now();
  if (ttlMs) entry.expiresAt = Date.now() + ttlMs;
  _scheduleFlush();
  return true;
}

function patchSession(sessionId, patch) {
  const entry = _store.get(sessionId);
  if (!entry || entry.expiresAt <= Date.now()) return false;
  Object.assign(entry.data, patch);
  entry.updatedAt = Date.now();
  _scheduleFlush();
  return true;
}

function touchSession(sessionId, ttlMs = DEFAULT_TTL_MS) {
  const entry = _store.get(sessionId);
  if (!entry) return false;
  entry.expiresAt = Date.now() + ttlMs;
  entry.updatedAt = Date.now();
  _scheduleFlush();
  return true;
}

function deleteSession(sessionId) {
  _store.delete(sessionId);
  _scheduleFlush();
}

function getStoreStats() {
  const now = Date.now();
  let active = 0;
  for (const entry of _store.values()) {
    if (entry.expiresAt > now) active++;
  }
  return { total: _store.size, active };
}

// ── PII scrubbing ─────────────────────────────────────────────────────────────
function scrubPii(text) {
  if (typeof text !== "string") return text;
  return text
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, "[PHONE]")
    .replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, "[EMAIL]")
    .replace(/[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]/g, "[ID_NUMBER]")
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
