"use strict";
/**
 * lib/trust/confirm.js
 * Payment intent verification with TOTP-based 2FA.
 *
 * When CROSSX_2FA_SECRET is set, verifyIntent validates secondFactor as a
 * 6-digit HOTP/TOTP code (HMAC-SHA1, 30s window, ±1 step tolerance).
 * Without the env var (dev mode), any non-empty string is accepted.
 */

const crypto = require("crypto");

/**
 * Generate a 6-digit TOTP code for a given secret and time step.
 * RFC 6238 / RFC 4226 compliant.
 * @param {string} secret - hex or base32 secret; treated as hex here for simplicity
 * @param {number} [step]  - 30s time step counter (defaults to current)
 */
function _totpCode(secret, step) {
  // Derive key bytes from hex secret; if odd length or invalid hex, use utf8
  let keyBuf;
  try {
    keyBuf = Buffer.from(secret, "hex");
    if (!keyBuf.length) throw new Error("empty");
  } catch {
    keyBuf = Buffer.from(secret, "utf8");
  }
  const counter = step !== undefined ? step : Math.floor(Date.now() / 30000);
  const ctrBuf = Buffer.alloc(8);
  // Write 8-byte big-endian counter
  ctrBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  ctrBuf.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac("sha1", keyBuf).update(ctrBuf).digest();
  const offset = hmac[19] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24 |
                 hmac[offset + 1] << 16 |
                 hmac[offset + 2] << 8 |
                 hmac[offset + 3]) % 1000000;
  return String(code).padStart(6, "0");
}

/**
 * Validate a submitted TOTP code against the current ±1 time window.
 * @param {string} secret
 * @param {string} submitted - 6-digit code from user
 */
function _validateTotp(secret, submitted) {
  if (!submitted || !/^\d{6}$/.test(submitted)) return false;
  const step = Math.floor(Date.now() / 30000);
  const submittedBuf = Buffer.from(submitted);
  for (const s of [step - 1, step, step + 1]) {
    try {
      if (crypto.timingSafeEqual(Buffer.from(_totpCode(secret, s)), submittedBuf)) return true;
    } catch {}
  }
  return false;
}

function createConfirmPolicy({ getSingleLimit }) {
  const totpSecret = process.env.CROSSX_2FA_SECRET || null;

  return {
    verifyIntent({ amount, secondFactor }) {
      const threshold = Number(getSingleLimit() || 0);
      const parsedAmount = Number(amount);
      const safeAmount = isNaN(parsedAmount) || parsedAmount < 0 ? 0 : parsedAmount;
      const needs2FA = safeAmount > threshold;
      if (!needs2FA) return { verified: true, threshold };
      if (!secondFactor) return { verified: false, reason: "2FA required", threshold, needs2FA: true };

      // Validate TOTP when secret configured; dev mode accepts any non-empty string
      if (totpSecret) {
        const valid = _validateTotp(totpSecret, String(secondFactor));
        if (!valid) return { verified: false, reason: "invalid_2fa_code", threshold };
      }
      return { verified: true, threshold };
    },

    // Expose for admin tooling / enrollment
    generateCode() {
      if (!totpSecret) return null;
      return _totpCode(totpSecret);
    },
  };
}

module.exports = {
  createConfirmPolicy,
  _totpCode,       // exported for tests
  _validateTotp,   // exported for tests
};
