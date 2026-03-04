"use strict";
/**
 * src/middleware/security.js
 * HTTP security hardening for CrossX server.
 *
 * Provides:
 *  - applySecurityHeaders(res) — sets CSP, X-Frame-Options, HSTS, etc.
 *  - validateMapKeyOrigin(req) — guards Amap key endpoint against abuse
 *  - validateSchema(body, schema) — lightweight body schema validator
 *  - sanitizeError(err) — prevents internal details leaking in 500 responses
 */

const ALLOWED_ORIGINS_DEFAULT = "http://127.0.0.1:8787,http://localhost:8787";

// ── Security Headers ──────────────────────────────────────────────────────────
const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",      // SPA uses inline <script>
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https: blob:",       // Unsplash + Amap tiles + data URIs
  "connect-src 'self'",                      // Only same-origin XHR/fetch
  "font-src 'self' data:",
  "media-src 'self' blob:",                  // TTS audio playback
  "worker-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const SECURITY_HEADERS = {
  "X-Content-Type-Options":  "nosniff",
  "X-Frame-Options":         "DENY",
  "X-XSS-Protection":        "1; mode=block",
  "Referrer-Policy":         "strict-origin-when-cross-origin",
  "Permissions-Policy":      "geolocation=(self), microphone=(self), camera=(), payment=()",
  "Content-Security-Policy": CSP_DIRECTIVES,
};

/**
 * Apply all security headers to an outgoing response.
 * Call once per request, before any writeHead().
 */
function applySecurityHeaders(res) {
  for (const [key, val] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(key, val);
  }
  // HSTS: only meaningful behind HTTPS — opt-in via env
  if (process.env.FORCE_HTTPS === "1") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }
}

// ── Map Key Origin Guard ──────────────────────────────────────────────────────

/**
 * Returns true only if the request comes from an allowed same-origin browser.
 * Headless/server-to-server requests (no Origin/Referer) are rejected.
 */
function validateMapKeyOrigin(req) {
  const origin = req.headers["origin"] || req.headers["referer"] || "";
  if (!origin) return false;
  const allowed = (process.env.ALLOWED_ORIGINS || ALLOWED_ORIGINS_DEFAULT)
    .split(",").map(s => s.trim()).filter(Boolean);
  // Use exact origin match or strict prefix with "/" to prevent subdomain spoofing
  // e.g. "http://127.0.0.1:8787.evil.com" must NOT match "http://127.0.0.1:8787"
  return allowed.some(a => origin === a || origin.startsWith(a + "/"));
}

// ── Lightweight Body Schema Validator ────────────────────────────────────────

/**
 * Validate a request body object against a simple schema.
 *
 * Schema format: { fieldName: { required?, type?, maxLength?, min?, max?, enum?, pattern? } }
 * Returns [] on success; [errorString, ...] on failure.
 */
function validateSchema(body, schema) {
  if (!body || typeof body !== "object") return ["Request body must be a JSON object"];
  const errors = [];
  for (const [key, rule] of Object.entries(schema)) {
    const val = body[key];
    if (rule.required && (val === undefined || val === null || val === "")) {
      errors.push(`${key}: required field missing`);
      continue;
    }
    if (val === undefined || val === null) continue; // optional and absent — OK

    if (rule.type) {
      if (rule.type === "array" && !Array.isArray(val)) {
        errors.push(`${key}: must be an array`);
      } else if (rule.type !== "array" && typeof val !== rule.type) {
        errors.push(`${key}: must be type '${rule.type}' (got '${typeof val}')`);
      }
    }
    if (rule.maxLength !== undefined && String(val).length > rule.maxLength) {
      errors.push(`${key}: exceeds max length of ${rule.maxLength}`);
    }
    if (rule.minLength !== undefined && String(val).length < rule.minLength) {
      errors.push(`${key}: below min length of ${rule.minLength}`);
    }
    if (rule.min !== undefined && Number(val) < rule.min) {
      errors.push(`${key}: must be >= ${rule.min}`);
    }
    if (rule.max !== undefined && Number(val) > rule.max) {
      errors.push(`${key}: must be <= ${rule.max}`);
    }
    if (rule.enum && !rule.enum.includes(val)) {
      errors.push(`${key}: must be one of [${rule.enum.join(", ")}]`);
    }
    if (rule.pattern && !rule.pattern.test(String(val))) {
      errors.push(`${key}: invalid format`);
    }
  }
  return errors;
}

// ── Error Sanitizer ───────────────────────────────────────────────────────────

/**
 * Returns a safe error response body, hiding internals in production.
 */
function sanitizeError(err, requestId) {
  const isDev = process.env.NODE_ENV !== "production";
  return {
    error:     "internal_error",
    message:   isDev ? (err?.message || "Unknown error") : "An unexpected error occurred. Please try again.",
    requestId: requestId || require("crypto").randomBytes(6).toString("hex"),
  };
}

// ── GDPR Device-ID Extractor ──────────────────────────────────────────────────

/**
 * Extract and validate device ID from request headers or body.
 * GDPR endpoints require this for identity scoping.
 */
function extractDeviceId(req, body) {
  const fromHeader = req.headers["x-device-id"] || "";
  const fromBody   = body?.deviceId || "";
  const did = String(fromHeader || fromBody).trim();
  // cx_ prefix + 32 hex chars = typical format from getDeviceId() in frontend
  if (did && /^cx_[a-f0-9]{32}$/i.test(did)) return did;
  // Also allow "demo" for development
  if (did === "demo") return "demo";
  return null;
}

module.exports = {
  applySecurityHeaders,
  validateMapKeyOrigin,
  validateSchema,
  sanitizeError,
  extractDeviceId,
};
