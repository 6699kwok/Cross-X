"use strict";
/**
 * src/utils/identity.js
 * Request identity resolution — who is calling this endpoint.
 * Level 0: no imports from services/ or controllers/.
 * (Uses lazy require to avoid circular deps at module load time.)
 */

/**
 * Resolve the caller identity from a request.
 * Tries user token first, then admin token, falls back to "anon".
 * This is the single source of truth for SSO passthrough across all controllers.
 *
 * @param {import("http").IncomingMessage} req
 * @returns {string} userId, admin sub, or "anon"
 */
function whoFromReq(req) {
  try {
    const { validateUserToken } = require("../services/user_auth");
    const up = validateUserToken(req);
    if (up && up.sub) return up.sub;
  } catch {}
  try {
    const { validateAdminToken } = require("../middleware/auth");
    const ap = validateAdminToken(req);
    if (ap && ap.sub) return ap.sub;
  } catch {}
  return "anon";
}

module.exports = { whoFromReq };
