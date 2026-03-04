"use strict";
/**
 * src/services/favorites.js
 * Per-device favorites store — hotels, restaurants, attractions saved by user.
 *
 * Keyed by deviceId (cx_<32hex> from client localStorage).
 * Max 100 favorites per device. Persisted to data/favorites.json.
 * TTL: 90 days, refreshed on each add.
 */

const fs   = require("fs");
const path = require("path");

const FAVORITES_FILE = path.join(__dirname, "../../data/favorites.json");
const MAX_PER_DEVICE = 100;
const TTL_MS         = 90 * 24 * 60 * 60 * 1000; // 90 days
const FLUSH_DEBOUNCE = 2000;

/** @type {Map<string, {items: Array, updatedAt: number, expiresAt: number}>} */
const _store = new Map();
let _loaded     = false;
let _flushTimer = null;

// ── Persistence ───────────────────────────────────────────────────────────────
function _load() {
  if (_loaded) return;
  _loaded = true;
  try {
    if (!fs.existsSync(FAVORITES_FILE)) return;
    const raw = fs.readFileSync(FAVORITES_FILE, "utf8").trim();
    if (!raw) return;
    const data = JSON.parse(raw);
    const now  = Date.now();
    for (const [id, bucket] of Object.entries(data)) {
      if (bucket.expiresAt && bucket.expiresAt < now) continue;
      _store.set(id, bucket);
    }
    console.log(`[favorites] loaded ${_store.size} device bucket(s)`);
  } catch (e) {
    console.warn("[favorites] load error:", e.message);
  }
}

function _scheduleFlush() {
  if (_flushTimer) clearTimeout(_flushTimer);
  _flushTimer = setTimeout(_flush, FLUSH_DEBOUNCE);
}

function _flush() {
  _flushTimer = null;
  const obj = {};
  for (const [id, bucket] of _store) obj[id] = bucket;
  const content = JSON.stringify(obj);
  if (!content || content === "null") return;
  try { fs.mkdirSync(path.dirname(FAVORITES_FILE), { recursive: true }); } catch {}
  const tmp = FAVORITES_FILE + ".tmp";
  fs.promises.writeFile(tmp, content, "utf8")
    .then(() => fs.promises.rename(tmp, FAVORITES_FILE))
    .catch((e) => console.warn("[favorites] flush error:", e.message));
}

function _flushSync() {
  try {
    const obj = {};
    for (const [id, bucket] of _store) obj[id] = bucket;
    const content = JSON.stringify(obj);
    if (!content || content === "null") return;
    fs.mkdirSync(path.dirname(FAVORITES_FILE), { recursive: true });
    const tmp = FAVORITES_FILE + ".tmp";
    fs.writeFileSync(tmp, content, "utf8");
    fs.renameSync(tmp, FAVORITES_FILE);
  } catch (e) {
    try { console.warn("[favorites] sync flush failed:", e.message); } catch {}
  }
}

process.once("exit",    _flushSync);
process.once("SIGTERM", _flushSync);
process.once("SIGINT",  _flushSync);

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Add a favorite item for a device.
 * @param {string} deviceId
 * @param {{ type: string, name: string, city?: string, price?: number, image_url?: string, note?: string }} item
 * @returns {{ ok: boolean, id: string, total: number }}
 */
function addFavorite(deviceId, item) {
  if (!deviceId || !item || !item.name) return { ok: false, error: "missing_fields" };
  _load();

  const bucket = _store.get(deviceId) || { items: [], updatedAt: 0, expiresAt: 0 };

  // Deduplicate by name + type
  const isDupe = bucket.items.some(
    (f) => f.name === item.name && f.type === item.type
  );
  if (isDupe) return { ok: false, error: "already_saved", total: bucket.items.length };

  if (bucket.items.length >= MAX_PER_DEVICE) {
    bucket.items.shift(); // drop oldest to stay within cap
  }

  const favId = `fav_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  bucket.items.push({
    id:        favId,
    type:      item.type || "place",        // hotel | restaurant | attraction | place
    name:      String(item.name).slice(0, 100),
    city:      item.city    || null,
    price:     item.price   || null,
    image_url: item.image_url || null,
    note:      item.note    ? String(item.note).slice(0, 200) : null,
    savedAt:   new Date().toISOString(),
  });
  bucket.updatedAt = Date.now();
  bucket.expiresAt = Date.now() + TTL_MS;
  _store.set(deviceId, bucket);
  _scheduleFlush();
  return { ok: true, id: favId, total: bucket.items.length };
}

/**
 * List all favorites for a device (newest first).
 * @param {string} deviceId
 * @param {{ type?: string, city?: string, limit?: number }} opts
 * @returns {Array}
 */
function listFavorites(deviceId, opts = {}) {
  if (!deviceId) return [];
  _load();
  const bucket = _store.get(deviceId);
  if (!bucket || bucket.expiresAt < Date.now()) return [];
  let items = [...bucket.items].reverse(); // newest first
  if (opts.type) items = items.filter((f) => f.type === opts.type);
  if (opts.city) items = items.filter((f) => f.city === opts.city);
  if (opts.limit) items = items.slice(0, opts.limit);
  return items;
}

/**
 * Remove a favorite by id.
 * @param {string} deviceId
 * @param {string} favId
 * @returns {{ ok: boolean, total: number }}
 */
function removeFavorite(deviceId, favId) {
  if (!deviceId || !favId) return { ok: false };
  _load();
  const bucket = _store.get(deviceId);
  if (!bucket) return { ok: false, error: "not_found" };
  const before = bucket.items.length;
  bucket.items = bucket.items.filter((f) => f.id !== favId);
  if (bucket.items.length === before) return { ok: false, error: "not_found" };
  bucket.updatedAt = Date.now();
  _store.set(deviceId, bucket);
  _scheduleFlush();
  return { ok: true, total: bucket.items.length };
}

/**
 * Check if a specific item is already favorited.
 * @param {string} deviceId
 * @param {string} name
 * @param {string} type
 * @returns {boolean}
 */
function isFavorited(deviceId, name, type) {
  if (!deviceId || !name) return false;
  _load();
  const bucket = _store.get(deviceId);
  if (!bucket || bucket.expiresAt < Date.now()) return false;
  return bucket.items.some((f) => f.name === name && f.type === type);
}

module.exports = { addFavorite, listFavorites, removeFavorite, isFavorited };
