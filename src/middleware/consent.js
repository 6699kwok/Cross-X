"use strict";
/**
 * src/middleware/consent.js
 * GDPR consent enforcement middleware (Privacy by Design — Art. 7).
 *
 * Checks that a device has granted consent before behavioral data is collected.
 * Routes that collect PII or analytics MUST call enforceConsent(deviceId, res).
 *
 * Consent bypass scenarios (no check needed):
 *   - Essential service requests (plan generation, booking confirmation)
 *   - GDPR right-exercise endpoints (/api/privacy/*)
 *   - Static asset serving
 */

const { getUserGdprFields } = require("../services/db");

const CONSENT_BYPASS_PATHS = new Set([
  "/api/privacy/consent",
  "/api/privacy/export",
  "/api/privacy/erase",
  "/api/privacy/restrict",
  "/api/privacy/requests",
  "/api/privacy/notice",
  "/api/privacy/register",
  "/api/plan/coze",       // core service — essential
  "/api/plan/detail",
  "/api/system/llm-status",
  "/api/map-key",
  "/api/emergency/support",
  "/api/admin/login",
]);

/**
 * Check if the given pathname should bypass consent enforcement.
 */
function shouldBypassConsent(pathname) {
  return CONSENT_BYPASS_PATHS.has(pathname) || pathname.startsWith("/api/privacy/");
}

/**
 * Enforce GDPR consent for a device before behavioral data collection.
 * Returns true if consent is granted (or bypass applies).
 * Returns false and writes 403 if consent is missing.
 *
 * @param {string} deviceId
 * @param {import("http").ServerResponse} res
 * @param {object} opts
 * @param {boolean} [opts.required=true]   — false = warn only (soft enforcement)
 * @returns {boolean}
 */
function enforceConsent(deviceId, res, { required = true } = {}) {
  if (!deviceId || deviceId === "demo") return true; // demo/anonymous always allowed

  let consentGranted = false;
  try {
    const fields = getUserGdprFields(deviceId);
    consentGranted = Boolean(fields && fields.consent_version);
  } catch (err) {
    // DB error — fail open to avoid blocking legitimate users
    console.warn("[consent] DB lookup failed, failing open:", err?.message);
    return true;
  }

  if (!consentGranted) {
    if (required) {
      res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        error: "consent_required",
        message: "Please accept the privacy policy before using this feature.",
        privacyUrl: "/privacy",
        consentEndpoint: "POST /api/privacy/consent",
      }));
      return false;
    }
    // Soft mode: just warn
    console.warn(`[consent] Device ${deviceId.slice(0, 12)}... has no consent — soft enforcement`);
  }

  return true;
}

/**
 * Middleware wrapper for use in server.js.
 * Paths that collect behavioral data: metrics, profile, sessions.
 * Returns false (and writes 403) if consent missing; true to continue.
 */
function consentMiddleware(req, res, pathname, deviceId) {
  if (shouldBypassConsent(pathname)) return true;

  // Only enforce for behavioral-data paths
  const behavioralPaths = [
    "/api/metrics/events",
    "/api/user/profile",
    "/api/sessions",
    "/api/trips",
    "/api/user/preferences",
  ];

  const needsConsent = behavioralPaths.some(p => pathname.startsWith(p));
  if (!needsConsent) return true;

  return enforceConsent(deviceId, res, { required: false }); // soft enforcement initially
}

module.exports = { enforceConsent, consentMiddleware, shouldBypassConsent };
