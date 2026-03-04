"use strict";
/**
 * src/services/user_auth.js
 * User authentication: phone OTP + stateless HMAC token.
 *
 * Flow:
 *   1. POST /api/auth/send-otp  → generateOtp(phone) → store + (dev) return code
 *   2. POST /api/auth/verify-otp → verifyOtp(phone, code) → createOrLoginUser → issueUserToken
 *   3. GET  /api/auth/me         → verifyUserToken(token) → return user info
 *
 * Security:
 *   - Only sha256(phone) is persisted — raw phone never stored
 *   - OTP: 6-digit numeric, 5-min TTL, max 5 attempts then locked
 *   - Token: base64(payload).HMAC-SHA256 — same format as admin token
 *   - All string comparisons use crypto.timingSafeEqual
 */

const crypto = require("crypto");

// ── Config ────────────────────────────────────────────────────────────────────
const OTP_TTL_MS      = 5 * 60 * 1000;  // 5 minutes
const OTP_MAX_ATTEMPTS = 5;
const USER_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function _tokenSecret() {
  return process.env.USER_TOKEN_SECRET
    || process.env.ADMIN_SECRET_KEY
    || "cx_dev_user_secret_change_in_prod";
}

// ── OTP Store (in-memory) ─────────────────────────────────────────────────────
// phone (normalized) → { code, expiresAt, attempts, locked }
const _otpStore = new Map();

// GC: remove expired OTPs every 10 minutes
const _otpGc = setInterval(() => {
  const now = Date.now();
  for (const [phone, entry] of _otpStore) {
    if (now > entry.expiresAt) _otpStore.delete(phone);
  }
}, 10 * 60 * 1000);
if (_otpGc.unref) _otpGc.unref();

function _normalizePhone(phone) {
  if (!phone || typeof phone !== "string") return null;
  const digits = phone.replace(/[\s\-().+]/g, "");
  // Accepts: 11-digit CN mobile (1XXXXXXXXXX) or E.164 (prefix digits)
  if (/^1[3-9]\d{9}$/.test(digits)) return digits;
  if (/^\d{7,15}$/.test(digits)) return digits;
  return null;
}

function _hashPhone(phone) {
  return crypto.createHash("sha256").update(phone).digest("hex");
}

/**
 * Generate a 6-digit OTP for the given phone number.
 * In production (SMS_PROVIDER set), OTP should be sent via SMS and NOT returned.
 * In dev (no SMS_PROVIDER), returns { code } for testing.
 *
 * @param {string} phone
 * @returns {{ ok: boolean, reason?: string, devCode?: string }}
 */
function generateOtp(phone) {
  const normalized = _normalizePhone(phone);
  if (!normalized) return { ok: false, reason: "invalid_phone" };

  const existing = _otpStore.get(normalized);
  if (existing && existing.locked) {
    const wait = Math.ceil((existing.expiresAt - Date.now()) / 1000);
    return { ok: false, reason: "locked", retryAfterSec: wait > 0 ? wait : 0 };
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  _otpStore.set(normalized, { code, expiresAt: Date.now() + OTP_TTL_MS, attempts: 0, locked: false });

  const isDev = !process.env.SMS_PROVIDER;
  if (isDev) {
    console.log(`[user_auth] DEV OTP for ${normalized.slice(0, 3)}****${normalized.slice(-4)}: ${code}`);
  }
  // TODO: if SMS_PROVIDER set, call SMS gateway here (Tencent Cloud / Aliyun)

  return { ok: true, ...(isDev ? { devCode: code } : {}) };
}

/**
 * Verify a submitted OTP.
 * Uses constant-time comparison to prevent timing attacks.
 *
 * @param {string} phone
 * @param {string} submitted  — user-entered 6-digit code
 * @returns {{ ok: boolean, reason?: string }}
 */
function verifyOtp(phone, submitted) {
  const normalized = _normalizePhone(phone);
  if (!normalized) return { ok: false, reason: "invalid_phone" };
  if (!submitted || typeof submitted !== "string") return { ok: false, reason: "invalid_code" };

  const entry = _otpStore.get(normalized);
  if (!entry) return { ok: false, reason: "no_otp" };
  if (Date.now() > entry.expiresAt) {
    _otpStore.delete(normalized);
    return { ok: false, reason: "expired" };
  }
  if (entry.locked) return { ok: false, reason: "locked" };

  entry.attempts += 1;
  if (entry.attempts > OTP_MAX_ATTEMPTS) {
    entry.locked = true;
    return { ok: false, reason: "locked" };
  }

  // Constant-time string comparison (pad to fixed length to avoid length leak)
  const a = Buffer.from(submitted.padEnd(6, "0").slice(0, 6), "utf8");
  const b = Buffer.from(entry.code.padEnd(6, "0").slice(0, 6), "utf8");
  const match = crypto.timingSafeEqual(a, b);

  if (!match) {
    const remaining = OTP_MAX_ATTEMPTS - entry.attempts;
    return { ok: false, reason: "wrong_code", attemptsLeft: remaining };
  }

  _otpStore.delete(normalized); // consume OTP
  return { ok: true };
}

// ── User persistence (uses db.js via lazy require) ────────────────────────────

function _db() { return require("./db"); }

/**
 * Create a new user account or return the existing one for this phone.
 * @param {string} phone  — normalized phone
 * @param {string} [displayName]
 * @returns {{ userId, displayName, isNew }}
 */
function createOrLoginUser(phone, displayName = "") {
  const phoneHash = _hashPhone(phone);
  const userId    = `usr_${phoneHash.slice(0, 16)}`;
  const now       = new Date().toISOString();

  const db = _db();
  const existing = db.getUserAuth(userId);
  if (existing) {
    db.upsertUserAuth({ userId, phoneHash, displayName: existing.displayName, lastLogin: now });
    return { userId, displayName: existing.displayName, isNew: false };
  }

  const name = displayName.trim().slice(0, 30) || `旅行者${phoneHash.slice(0, 4)}`;
  db.upsertUserAuth({ userId, phoneHash, displayName: name, createdAt: now, lastLogin: now });

  // Seed a minimal record in the users table so /api/user/* routes work
  try { db.updateUser(userId, { id: userId }); } catch {}

  return { userId, displayName: name, isNew: true };
}

// ── User Tokens ───────────────────────────────────────────────────────────────

function _hmac(data) {
  return crypto.createHmac("sha256", _tokenSecret()).update(data).digest("hex");
}

/**
 * Issue a stateless user token.
 * @param {string} userId
 * @param {string} phoneHash
 * @returns {string}  token
 */
function issueUserToken(userId, phoneHash) {
  const payload = {
    sub:       userId,
    role:      "user",
    phoneHash: phoneHash.slice(0, 8), // partial hash as extra check
    iat:       Date.now(),
    exp:       Date.now() + USER_TOKEN_TTL_MS,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64");
  const sig = _hmac(payloadB64);
  return `${payloadB64}.${sig}`;
}

/**
 * Verify and decode a user token.
 * @param {string} token
 * @returns {{ sub, role, iat, exp, phoneHash } | null}
 */
function verifyUserToken(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [payloadB64, sig] = parts;
  const expectedSig = _hmac(payloadB64);

  try {
    const sigBuf      = Buffer.from(sig.length % 2 === 0 ? sig : sig + "0", "hex").slice(0, 32);
    const expectedBuf = Buffer.from(expectedSig, "hex").slice(0, 32);
    if (sigBuf.length !== expectedBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  } catch {
    return null;
  }

  let payload;
  try { payload = JSON.parse(Buffer.from(payloadB64, "base64").toString("utf8")); } catch { return null; }

  if (!payload.exp || Date.now() > payload.exp) return null;
  if (payload.role !== "user") return null;
  return payload;
}

/**
 * Extract user token from Authorization: Bearer header or query param.
 * @param {import('http').IncomingMessage} req
 * @returns {string|null}
 */
function extractUserToken(req) {
  const authHeader = req.headers["authorization"] || "";
  if (authHeader.startsWith("Bearer ")) return authHeader.slice(7).trim() || null;
  return null;
}

/**
 * Validate user token from request. Returns payload or null.
 * @param {import('http').IncomingMessage} req
 * @returns {{ sub, role, phoneHash } | null}
 */
function validateUserToken(req) {
  const token = extractUserToken(req);
  if (!token) return null;
  return verifyUserToken(token);
}

module.exports = {
  generateOtp,
  verifyOtp,
  createOrLoginUser,
  issueUserToken,
  verifyUserToken,
  extractUserToken,
  validateUserToken,
  _normalizePhone,
  _hashPhone,
};
