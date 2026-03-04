"use strict";
/**
 * src/middleware/auth.js
 * Admin authentication and RBAC for CrossX server.
 *
 * Strategy:
 *   - ADMIN_SECRET_KEY env var is the master admin secret
 *   - Client calls POST /api/admin/login with { key: ADMIN_SECRET_KEY }
 *   - Server returns a signed token (HMAC-SHA256 of payload + secret)
 *   - Subsequent calls include: Authorization: Bearer <token>
 *   - Token is stateless but validated on each request (no session store needed)
 *
 * Token format: base64(<payload_json>).<hmac-sha256-hex>
 * Payload: { sub, role, iat, exp }
 */

const crypto = require("crypto");

const TOKEN_TTL_MS   = 8 * 60 * 60 * 1000;  // 8 hours
const ADMIN_ROLES    = ["admin"];
const FINANCE_ROLES  = ["admin", "finance"];
const OPERATOR_ROLES = ["admin", "operator"];

function _getSecret() {
  return process.env.ADMIN_SECRET_KEY || "";
}

function _hmac(data) {
  return crypto.createHmac("sha256", _getSecret()).update(data).digest("hex");
}

/**
 * Issue a signed token for a given role.
 * @param {string} sub  — device_id or "admin"
 * @param {"admin"|"finance"|"operator"|"user"} role
 * @returns {string}  — signed token string
 */
function issueToken(sub, role) {
  const payload = { sub, role, iat: Date.now(), exp: Date.now() + TOKEN_TTL_MS };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64");
  const sig = _hmac(payloadB64);
  return `${payloadB64}.${sig}`;
}

/**
 * Verify and decode a token. Returns payload or null if invalid/expired.
 * @param {string} token
 * @returns {{ sub, role, iat, exp }|null}
 */
function verifyToken(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [payloadB64, sig] = parts;
  const expectedSig = _hmac(payloadB64);
  // Constant-time comparison — guard against length mismatch (tampered sigs)
  try {
    const sigBuf      = Buffer.from(sig.length % 2 === 0 ? sig : sig + "0", "hex").slice(0, 32);
    const expectedBuf = Buffer.from(expectedSig, "hex").slice(0, 32);
    if (sigBuf.length !== expectedBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  } catch {
    return null; // any buffer/crypto error → invalid token
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64").toString("utf8"));
  } catch {
    return null;
  }

  if (!payload.exp || Date.now() > payload.exp) return null;
  return payload;
}

/**
 * Extract Bearer token from Authorization header.
 * @param {import('http').IncomingMessage} req
 * @returns {string|null}
 */
function extractToken(req) {
  const authHeader = req.headers["authorization"] || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  return authHeader.slice(7).trim() || null;
}

/**
 * Validate that the request carries a valid admin token.
 * Returns the payload if valid, null otherwise.
 */
let _warnedNoAdminKey = false;
function validateAdminToken(req) {
  if (!_getSecret()) {
    // No admin key configured — allow in dev mode with a one-time warning
    if (!_warnedNoAdminKey) {
      _warnedNoAdminKey = true;
      console.warn("[auth] ADMIN_SECRET_KEY not set — admin endpoints unprotected (dev mode)");
    }
    return { sub: "dev", role: "admin", iat: Date.now(), exp: Date.now() + 999999 };
  }
  const token = extractToken(req);
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload) return null;
  if (!ADMIN_ROLES.includes(payload.role)) return null;
  return payload;
}

/**
 * Middleware helper — writes 401 and returns false if not admin.
 * Usage: if (!requireAdmin(req, res)) return;
 */
function requireAdmin(req, res) {
  const payload = validateAdminToken(req);
  if (!payload) {
    res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "unauthorized", message: "Admin token required" }));
    return false;
  }
  return payload;
}

/**
 * Middleware helper — allows admin or finance roles.
 */
function requireFinance(req, res) {
  if (!_getSecret()) return { sub: "dev", role: "finance" };
  const token = extractToken(req);
  const payload = token ? verifyToken(token) : null;
  if (!payload || !FINANCE_ROLES.includes(payload.role)) {
    res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "unauthorized", message: "Finance or admin token required" }));
    return false;
  }
  return payload;
}

/**
 * Validate the raw ADMIN_SECRET_KEY (for login endpoint).
 */
function validateMasterKey(provided) {
  const secret = _getSecret();
  if (!secret) return false;
  // Constant-time comparison
  const a = Buffer.from(provided || "", "utf8");
  const b = Buffer.from(secret, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ── Admin rate limiter for settlement batch (1 call per hour) ────────────────
const _settlementLastRun = new Map(); // ip → timestamp

function checkSettlementRateLimit(req) {
  const ip = req.socket?.remoteAddress || "unknown";
  const last = _settlementLastRun.get(ip) || 0;
  const now  = Date.now();
  if (now - last < 60 * 60 * 1000) {
    const retryAfterSec = Math.ceil((60 * 60 * 1000 - (now - last)) / 1000);
    return { allowed: false, retryAfterSec };
  }
  _settlementLastRun.set(ip, now);
  return { allowed: true };
}

module.exports = {
  issueToken, verifyToken, extractToken,
  validateAdminToken, requireAdmin, requireFinance,
  validateMasterKey, checkSettlementRateLimit,
};
