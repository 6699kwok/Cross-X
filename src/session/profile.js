"use strict";
/**
 * src/session/profile.js
 * Cross-session user preference profile — C4 AI Native upgrade.
 *
 * Persists a per-device preference profile to data/user_profiles.json.
 * Profile TTL: 30 days (refreshed on every save).
 * Debounced flush to disk mirrors the session store pattern.
 *
 * Exports: loadProfile, saveProfile, generateProfileSummary
 */

const fs   = require("fs");
const path = require("path");
const { openAIRequest } = require("../ai/openai");
const { enc, dec } = require("../crypto/fieldEncrypt");

// ── Config ────────────────────────────────────────────────────────────────────
const PROFILE_FILE    = path.join(__dirname, "../../data/user_profiles.json");
const PROFILE_TTL_MS  = 30 * 24 * 60 * 60 * 1000; // 30 days
const FLUSH_DEBOUNCE  = 2000;                        // ms — coalesce rapid writes
const MAX_CITIES      = 20;                          // cap stored city list

// ── In-memory store ───────────────────────────────────────────────────────────
/** @type {Map<string, {preferences, profileSummary, tripCount, cities, updatedAt, expiresAt}>} */
const _profiles = new Map();
let _flushTimer = null;
let _loaded     = false;

// ── Persistence ───────────────────────────────────────────────────────────────
function _load() {
  if (_loaded) return;
  _loaded = true;
  try {
    if (!fs.existsSync(PROFILE_FILE)) return;
    const raw  = fs.readFileSync(PROFILE_FILE, "utf8").trim();
    if (!raw) return; // empty file — treat as no profiles
    const data = JSON.parse(dec(raw) || raw);
    const now  = Date.now();
    for (const [id, profile] of Object.entries(data)) {
      if (profile.expiresAt && profile.expiresAt < now) continue; // skip expired
      _profiles.set(id, profile);
    }
    console.log(`[profile] loaded ${_profiles.size} profile(s) from disk`);
  } catch (e) {
    console.warn("[profile] load error:", e.message);
  }
}

function _scheduleFlush() {
  if (_flushTimer) clearTimeout(_flushTimer);
  _flushTimer = setTimeout(_flush, FLUSH_DEBOUNCE);
}

function _flush() {
  _flushTimer = null;
  const obj = {};
  for (const [id, profile] of _profiles) obj[id] = profile;
  const content = enc(JSON.stringify(obj, null, 2));
  if (!content || content === "null") return;
  // Atomic write: tmp → rename, prevents 0-byte corruption on crash
  const tmp = PROFILE_FILE + ".tmp";
  // Retry once after 500ms on failure to handle transient I/O errors
  const tryWrite = (retriesLeft) =>
    fs.promises.writeFile(tmp, content, "utf8")
      .then(() => fs.promises.rename(tmp, PROFILE_FILE))
      .catch((e) => {
        if (retriesLeft > 0) {
          console.warn("[profile] Flush failed, retrying in 500ms:", e.message);
          return new Promise((r) => setTimeout(r, 500)).then(() => tryWrite(retriesLeft - 1));
        }
        console.error("[profile] Flush failed permanently — profiles may be lost on restart:", e.message);
      });
  tryWrite(1); // 1 retry = 2 total attempts
}

// Synchronous flush for process exit — async I/O won't complete after process.exit()
function _flushSync() {
  try {
    const obj = {};
    for (const [id, profile] of _profiles) obj[id] = profile;
    const content = enc(JSON.stringify(obj, null, 2));
    if (!content || content === "null") return;
    const dir = require("path").dirname(PROFILE_FILE);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = PROFILE_FILE + ".tmp";
    fs.writeFileSync(tmp, content, "utf8");
    fs.renameSync(tmp, PROFILE_FILE);
  } catch (e) {
    try { console.warn("[profile] sync flush failed:", e.message); } catch {}
  }
}

// Flush on shutdown
process.once("SIGTERM", _flushSync);
process.once("SIGINT",  _flushSync);
process.once("exit",    _flushSync);

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Load a user's preference profile by deviceId.
 * Returns null if not found or expired.
 * @param {string} deviceId
 * @returns {{ preferences: object, profileSummary: string|null, tripCount: number, cities: string[] } | null}
 */
function loadProfile(deviceId) {
  if (!deviceId) return null;
  _load();

  const profile = _profiles.get(deviceId);
  if (!profile) return null;
  if (profile.expiresAt < Date.now()) {
    _profiles.delete(deviceId);
    return null;
  }
  return profile;
}

/**
 * Save (upsert) a user profile. Merges preferences, bumps tripCount, appends city.
 * @param {string}      deviceId
 * @param {object}      prefs         Merged preference flags from current session
 * @param {string|null} city          Destination city (may be null)
 * @param {string|null} profileSummary LLM-generated summary string (optional)
 */
function saveProfile(deviceId, prefs, city = null, profileSummary = null) {
  if (!deviceId || !prefs) return;
  _load();

  const existing = _profiles.get(deviceId) || {
    preferences: {},
    profileSummary: null,
    tripCount: 0,
    cities: [],
    updatedAt: 0,
    expiresAt: 0,
  };

  // Merge preferences — both true and false propagate (bidirectional)
  const merged = { ...existing.preferences };
  for (const [k, v] of Object.entries(prefs)) {
    if (typeof v === "boolean") merged[k] = v;
  }

  // Append city (deduplicated, capped)
  const cities = [...existing.cities];
  if (city && !cities.includes(city)) {
    cities.push(city);
    if (cities.length > MAX_CITIES) cities.shift();
  }

  _profiles.set(deviceId, {
    preferences:    merged,
    profileSummary: profileSummary !== null ? profileSummary : existing.profileSummary,
    tripCount:      existing.tripCount + 1,
    cities,
    updatedAt:      Date.now(),
    expiresAt:      Date.now() + PROFILE_TTL_MS,
  });

  _scheduleFlush();
}

/**
 * Generate a one-line semantic traveler summary via LLM.
 * Non-blocking — caller should fire-and-forget.
 * @param {object} prefs  Merged preference flags
 * @param {object} opts   { apiKey, model, baseUrl }
 * @returns {Promise<string|null>}
 */
async function generateProfileSummary(prefs, { apiKey, model, baseUrl } = {}) {
  const keys = Object.keys(prefs || {}).filter(k => prefs[k] === true);
  if (!keys.length || !apiKey) return null;

  try {
    const { ok, text } = await openAIRequest({
      apiKey, model, baseUrl,
      systemPrompt: "你是旅行偏好分析师。根据用户的偏好标签，用一句话（15字以内）概括这位旅行者的风格。只输出这句话，不要解释。",
      userContent:  `偏好标签：${keys.join("、")}`,
      temperature:  0.3,
      maxTokens:    40,
      jsonMode:     false,
      timeoutMs:    3000,
    });
    return (ok && text) ? text.trim().slice(0, 30) : null;
  } catch {
    return null;
  }
}

/**
 * Record a micro-preference signal for a device.
 * Increments a numeric score in profile.preferences[key] by `delta` (default 1).
 * Scores are clamped to [0, 10]. Profile is persisted asynchronously.
 *
 * @param {string} deviceId
 * @param {string} key      - preference key, e.g. "luxury_preference", "food_focus"
 * @param {number} [delta=1] - amount to increment (negative to decrement)
 */
function recordSignal(deviceId, key, delta = 1) {
  if (!deviceId || !key) return;
  _load();
  const profile = _profiles.get(deviceId);
  if (!profile) return; // no profile to update
  const current = typeof profile.preferences[key] === "number" ? profile.preferences[key] : 0;
  profile.preferences[key] = Math.min(10, Math.max(0, current + delta));
  profile.updatedAt = Date.now();
  _scheduleFlush();
}

module.exports = { loadProfile, saveProfile, generateProfileSummary, recordSignal };
