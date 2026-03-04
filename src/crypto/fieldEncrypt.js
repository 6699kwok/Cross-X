"use strict";
/**
 * src/crypto/fieldEncrypt.js
 * AES-256-GCM field-level encryption for PII columns in SQLite.
 *
 * Storage format: "ENC:v1:<base64-iv>:<base64-tag>:<base64-ciphertext>"
 * - iv: 12 bytes (GCM recommended)
 * - tag: 16 bytes auth tag
 * - Key derived via PBKDF2 from CROSSX_DB_ENCRYPTION_KEY env var
 *
 * Backwards compat: if stored value does NOT start with "ENC:v1:", it is
 * returned as-is (allows gradual migration of existing plaintext rows).
 */

const crypto = require("crypto");

const ALGO     = "aes-256-gcm";
const PREFIX   = "ENC:v1:";
const ITER     = 10_000;
const KEY_LEN  = 32;
const SALT     = "crossx-field-enc-v1"; // fixed salt (key is high-entropy env var)

let _key = null; // derived key cache
let _warned = false;

function _getKey() {
  if (_key) return _key;
  const raw = process.env.CROSSX_DB_ENCRYPTION_KEY || "";
  if (!raw) {
    if (!_warned) {
      console.warn("[fieldEncrypt] CROSSX_DB_ENCRYPTION_KEY not set — PII stored unencrypted (dev mode)");
      _warned = true;
    }
    return null;
  }
  _key = crypto.pbkdf2Sync(raw, SALT, ITER, KEY_LEN, "sha256");
  return _key;
}

/**
 * Encrypt a string value. Returns the encrypted string or the original if no key is set.
 * @param {string|null|undefined} plaintext
 * @returns {string|null}
 */
function enc(plaintext) {
  if (plaintext === null || plaintext === undefined) return null;
  const key = _getKey();
  if (!key) return String(plaintext); // dev mode: no-op

  const iv         = crypto.randomBytes(12);
  const cipher     = crypto.createCipheriv(ALGO, key, iv);
  const encrypted  = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag        = cipher.getAuthTag();

  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

/**
 * Decrypt a value encrypted with enc(). Returns as-is if not encrypted (backwards compat).
 * @param {string|null|undefined} stored
 * @returns {string|null}
 */
function dec(stored) {
  if (stored === null || stored === undefined) return null;
  const s = String(stored);
  if (!s.startsWith(PREFIX)) return s; // plaintext (pre-migration or dev mode)

  const key = _getKey();
  if (!key) {
    console.error("[fieldEncrypt] Encrypted value found but CROSSX_DB_ENCRYPTION_KEY not set — cannot decrypt");
    return null;
  }

  const parts = s.slice(PREFIX.length).split(":");
  if (parts.length !== 3) {
    console.error("[fieldEncrypt] Malformed encrypted value");
    return null;
  }

  try {
    const iv         = Buffer.from(parts[0], "base64");
    const tag        = Buffer.from(parts[1], "base64");
    const ciphertext = Buffer.from(parts[2], "base64");
    const decipher   = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(ciphertext) + decipher.final("utf8");
  } catch (e) {
    console.error("[fieldEncrypt] Decryption failed:", e.message);
    return null;
  }
}

/**
 * Encrypt an object/value as JSON.
 * @param {any} obj
 * @returns {string|null}
 */
function encJson(obj) {
  if (obj === null || obj === undefined) return null;
  return enc(typeof obj === "string" ? obj : JSON.stringify(obj));
}

/**
 * Decrypt and JSON.parse a stored value. Returns parsed object or null.
 * @param {string|null} stored
 * @param {any} fallback
 * @returns {any}
 */
function decJson(stored, fallback = null) {
  const raw = dec(stored);
  if (raw === null || raw === undefined) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return raw; // return raw string if not valid JSON
  }
}

/**
 * Check whether encryption is currently active (key is set).
 */
function isEncryptionEnabled() {
  return Boolean(process.env.CROSSX_DB_ENCRYPTION_KEY);
}

/**
 * Clear the cached derived key. Useful in tests that change env vars.
 */
function _resetKeyCache() {
  _key = null;
  _warned = false;
}

module.exports = { enc, dec, encJson, decJson, isEncryptionEnabled, _resetKeyCache };
