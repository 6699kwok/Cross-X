"use strict";
/**
 * src/controllers/AuthController.js
 * Business logic for all /api/auth/* endpoints.
 *
 * Dependency chain (no cycles):
 *   AuthController → services/user_auth (Level 2)
 *                  → repositories/UserRepository (Level 1 via lazy db)
 *                  → utils/http (Level 0)
 *
 * SSO guarantee:
 *   - Token format is unchanged — issueUserToken() in user_auth.js signs with _tokenSecret()
 *   - validateUserToken() called on every /api/auth/me request as before
 *   - Session state lives entirely in the stateless HMAC token; no server-side session added
 */

const { readBody, writeJson } = require("../utils/http");
const {
  generateOtp,
  verifyOtp,
  createOrLoginUser,
  createOrLoginUserByOpenid,
  generateEmailOtp,
  verifyEmailOtp,
  createOrLoginUserByEmail,
  issueUserToken,
  validateUserToken,
  _normalizePhone,
  _normalizeEmail,
  _hashPhone,
} = require("../services/user_auth");
const { getAuthUser } = require("../repositories/UserRepository");

// ── POST /api/auth/send-otp ────────────────────────────────────────────────
async function sendOtp(req, res, { buildId } = {}) {
  try {
    const body   = await readBody(req);
    if (!body || typeof body !== "object") return writeJson(res, 400, { error: "invalid_request" }, buildId);
    const result = await generateOtp(typeof body.phone === "string" ? body.phone : "");
    if (!result.ok) {
      return writeJson(res, 400, { error: result.reason, retryAfterSec: result.retryAfterSec }, buildId);
    }
    const isProd = process.env.NODE_ENV === "production";
    return writeJson(res, 200, {
      ok: true,
      message: result.devCode && !isProd ? "OTP generated (dev mode — no SMS sent)" : "OTP sent",
      ...(result.devCode && !isProd ? { dev_code:    result.devCode  } : {}),
      ...(result.smsError           ? { sms_warning: result.smsError } : {}),
    }, buildId);
  } catch (e) {
    console.error("[AuthController.sendOtp]", e.message);
    return writeJson(res, 500, { error: "internal_error" }, buildId);
  }
}

// ── POST /api/auth/verify-otp ──────────────────────────────────────────────
async function verifyOtpAndIssueToken(req, res, { buildId } = {}) {
  try {
    const body  = await readBody(req);
    const phone = String(body.phone || "");
    const code  = String(body.code  || "");

    const otpResult = verifyOtp(phone, code);
    if (!otpResult.ok) {
      return writeJson(res, 401, {
        error:        otpResult.reason,
        attemptsLeft: otpResult.attemptsLeft,
      }, buildId);
    }

    const normalized  = _normalizePhone(phone);
    const displayName = String(body.displayName || "").trim().slice(0, 30);
    const { userId, displayName: name, isNew } = createOrLoginUser(normalized, displayName);
    const phoneHash = _hashPhone(normalized);
    const token     = issueUserToken(userId, phoneHash);

    // SEC-03: Also set HttpOnly Secure cookie to eliminate localStorage XSS risk.
    // Keep returning token in body for backwards compat (existing clients without cookie support).
    const isSecure  = process.env.NODE_ENV === "production" || process.env.FORCE_HTTPS === "1";
    const cookieParts = [
      `cx_token=${token}`,
      "HttpOnly",
      "SameSite=Strict",
      "Path=/",
      "Max-Age=86400",           // 24h — matches token TTL
      ...(isSecure ? ["Secure"] : []),
    ];
    res.setHeader("Set-Cookie", cookieParts.join("; "));

    return writeJson(res, 200, { ok: true, token, userId, displayName: name, isNew }, buildId);
  } catch (e) {
    console.error("[AuthController.verifyOtp]", e.message);
    return writeJson(res, 500, { error: "internal_error" }, buildId);
  }
}

// ── GET /api/auth/me ───────────────────────────────────────────────────────
async function getMe(req, res, { buildId } = {}) {
  try {
    const payload = validateUserToken(req);
    if (!payload) return writeJson(res, 401, { error: "unauthorized" }, buildId);

    const user = getAuthUser(payload.sub);
    if (!user)  return writeJson(res, 404, { error: "user_not_found" }, buildId);

    return writeJson(res, 200, {
      ok:          true,
      userId:      user.user_id,
      displayName: user.display_name,
      role:        "user",
      createdAt:   user.created_at,
    }, buildId);
  } catch (e) {
    console.error("[AuthController.getMe]", e.message);
    return writeJson(res, 500, { error: "internal_error" }, buildId);
  }
}

// ── POST /api/auth/logout ──────────────────────────────────────────────────
// Stateless — token lives only on the client; server just acknowledges.
async function logout(req, res, { buildId } = {}) {
  // SEC-03: Clear HttpOnly cookie on logout
  res.setHeader("Set-Cookie", "cx_token=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
  return writeJson(res, 200, { ok: true }, buildId);
}

// ── GET /api/auth/wechat ───────────────────────────────────────────────────
// Redirect user to WeChat OAuth authorization page.
async function wechatBegin(req, res, { port, buildId } = {}) {
  try {
    const crypto = require("crypto");
    const appId  = process.env.WECHAT_APP_ID;
    if (!appId) return writeJson(res, 503, { error: "wechat_not_configured" }, buildId);

    const base     = process.env.APP_BASE_URL || `http://localhost:${port || 8787}`;
    const redirect = encodeURIComponent(`${base}/api/auth/wechat/callback`);
    const ts       = Date.now().toString();
    const nonce    = crypto.randomBytes(8).toString("hex"); // P2-C: replay-prevention nonce
    const secret   = _wxStateSecret();
    const sig      = crypto.createHmac("sha256", secret)
      .update(`wechat_state:${ts}:${nonce}`).digest("hex").slice(0, 16);
    const state = `${ts}.${nonce}.${sig}`;
    // Register nonce so callback can verify single-use
    _wxUsedNonces.set(nonce, Date.now() + _WX_NONCE_TTL_MS);

    const url = `https://open.weixin.qq.com/connect/oauth2/authorize` +
      `?appid=${appId}` +
      `&redirect_uri=${redirect}` +
      `&response_type=code` +
      `&scope=snsapi_userinfo` +
      `&state=${encodeURIComponent(state)}` +
      `#wechat_redirect`;

    res.writeHead(302, { Location: url });
    return res.end();
  } catch (e) {
    console.error("[AuthController.wechatBegin]", e.message);
    return writeJson(res, 500, { error: "internal_error" }, buildId);
  }
}

// ── GET /api/auth/wechat/callback ─────────────────────────────────────────
async function wechatCallback(req, res, { port, buildId } = {}) {
  const crypto  = require("crypto");
  const https   = require("https");
  const appId   = process.env.WECHAT_APP_ID;
  const secret  = process.env.WECHAT_APP_SECRET;
  const base    = process.env.APP_BASE_URL || `http://localhost:${port || 8787}`;

  if (!appId || !secret) return writeJson(res, 503, { error: "wechat_not_configured" }, buildId);

  const params  = new URL(`http://x${req.url}`).searchParams;
  const code    = params.get("code");
  const stateIn = params.get("state") || "";

  // P2-C: CSRF state validation (ts.nonce.sig, 10-min window, single-use nonce)
  const parts = stateIn.split(".");
  if (parts.length !== 3) {
    res.writeHead(302, { Location: `${base}/?auth_error=invalid_state` });
    return res.end();
  }
  const [ts, nonce, sigIn] = parts;
  const tsNum = parseInt(ts, 10);
  const sigExpected = crypto.createHmac("sha256", _wxStateSecret())
    .update(`wechat_state:${ts}:${nonce}`).digest("hex").slice(0, 16);
  // Single-use nonce check: if already consumed, reject (replay attack)
  const nonceValid = _wxUsedNonces.has(nonce) && _wxUsedNonces.get(nonce) > Date.now();
  const stateOk = sigIn === sigExpected
    && !isNaN(tsNum)
    && (Date.now() - tsNum) < 10 * 60 * 1000
    && nonceValid;

  if (!stateOk) {
    res.writeHead(302, { Location: `${base}/?auth_error=invalid_state` });
    return res.end();
  }
  // Consume nonce — subsequent replays will fail nonceValid check
  _wxUsedNonces.delete(nonce);

  if (!code || code === "authdeny") {
    res.writeHead(302, { Location: `${base}/?auth_error=denied` });
    return res.end();
  }

  try {
    // Step 1: exchange code for access_token + openid
    const tokenData = await _httpsGet(
      `https://api.weixin.qq.com/sns/oauth2/access_token` +
      `?appid=${appId}&secret=${secret}&code=${code}&grant_type=authorization_code`
    );
    if (tokenData.errcode) throw new Error(`wx_token: ${tokenData.errmsg}`);
    const { access_token, openid } = tokenData;

    // Step 2: fetch WeChat user info (nickname)
    const info = await _httpsGet(
      `https://api.weixin.qq.com/sns/userinfo?access_token=${access_token}&openid=${openid}&lang=zh_CN`
    );
    const nickname = (info.nickname || "").slice(0, 30);

    const { userId, displayName, isNew, openidHash } = createOrLoginUserByOpenid(openid, nickname);
    const token = issueUserToken(userId, `wx_${openidHash.slice(0, 8)}`);

    console.info(`[AuthController] WeChat login: ${userId} (${displayName}) isNew=${isNew}`);
    res.writeHead(302, {
      Location: `${base}/?wx_token=${encodeURIComponent(token)}&wx_name=${encodeURIComponent(displayName)}`,
    });
    return res.end();
  } catch (e) {
    console.error("[AuthController.wechatCallback]", e.message);
    res.writeHead(302, { Location: `${base}/?auth_error=wechat_failed` });
    return res.end();
  }
}

// ── POST /api/auth/send-email-code ─────────────────────────────────────────
async function sendEmailCode(req, res, { buildId } = {}) {
  try {
    const body   = await readBody(req);
    if (!body || typeof body !== "object") return writeJson(res, 400, { error: "invalid_request" }, buildId);
    const isProd = process.env.NODE_ENV === "production";
    const result = await generateEmailOtp(typeof body.email === "string" ? body.email : "");
    if (!result.ok) {
      const status = result.reason === "invalid_email" ? 400 : result.reason === "locked" ? 429 : result.reason === "too_soon" ? 429 : 500;
      return writeJson(res, status, { error: result.reason, ...(result.retryAfterSec ? { retryAfterSec: result.retryAfterSec } : {}) }, buildId);
    }
    return writeJson(res, 200, {
      ok: true,
      message: result.devCode && !isProd ? "OTP generated (dev mode — no email sent)" : "OTP sent",
      ...(result.devCode && !isProd ? { dev_code: result.devCode } : {}),
    }, buildId);
  } catch (e) {
    console.error("[AuthController.sendEmailCode]", e.message);
    return writeJson(res, 500, { error: "internal_error" }, buildId);
  }
}

// ── POST /api/auth/verify-email-code ───────────────────────────────────────
async function verifyEmailCodeAndIssueToken(req, res, { buildId } = {}) {
  try {
    const body  = await readBody(req);
    const email = String(body.email || "").trim();
    const code  = String(body.code  || "").trim();

    const normalized = _normalizeEmail(email);
    if (!normalized) return writeJson(res, 400, { error: "invalid_email" }, buildId);

    const otpResult = verifyEmailOtp(normalized, code);
    if (!otpResult.ok) {
      const status = otpResult.reason === "locked" ? 429 : otpResult.reason === "expired" ? 410 : 401;
      return writeJson(res, status, { error: otpResult.reason, ...(otpResult.attemptsLeft !== undefined ? { attemptsLeft: otpResult.attemptsLeft } : {}) }, buildId);
    }

    const displayName = String(body.displayName || body.display_name || "").slice(0, 30);
    const { userId, displayName: storedName, isNew } = createOrLoginUserByEmail(normalized, displayName);

    const emailHash = require("crypto").createHash("sha256").update(normalized).digest("hex");
    const token = issueUserToken(userId, `em_${emailHash.slice(0, 8)}`);

    console.info(`[AuthController] Email login: ${userId} (${storedName}) isNew=${isNew}`);
    return writeJson(res, 200, { ok: true, token, userId, displayName: storedName, isNew }, buildId);
  } catch (e) {
    console.error("[AuthController.verifyEmailCodeAndIssueToken]", e.message);
    return writeJson(res, 500, { error: "internal_error" }, buildId);
  }
}

// ── GET /api/auth/google ───────────────────────────────────────────────────
// Redirect user to Google OAuth authorization page.
async function googleBegin(req, res, { port, buildId } = {}) {
  try {
    const crypto   = require("crypto");
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) return writeJson(res, 503, { error: "google_not_configured" }, buildId);

    const base     = process.env.APP_BASE_URL || `http://localhost:${port || 8787}`;
    const redirect = encodeURIComponent(`${base}/api/auth/google/callback`);
    const ts       = Date.now().toString();
    const secret   = _stateSecret();
    const sig      = crypto.createHmac("sha256", secret)
      .update(`google_state:${ts}`).digest("hex").slice(0, 16);
    const state = `${ts}.${sig}`;

    const url = `https://accounts.google.com/o/oauth2/v2/auth` +
      `?client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${redirect}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent("openid email profile")}` +
      `&state=${encodeURIComponent(state)}` +
      `&prompt=select_account`;

    res.writeHead(302, { Location: url });
    return res.end();
  } catch (e) {
    console.error("[AuthController.googleBegin]", e.message);
    return writeJson(res, 500, { error: "internal_error" }, buildId);
  }
}

// ── GET /api/auth/google/callback ──────────────────────────────────────────
async function googleCallback(req, res, { port, buildId } = {}) {
  const crypto       = require("crypto");
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const base         = process.env.APP_BASE_URL || `http://localhost:${port || 8787}`;

  if (!clientId || !clientSecret) {
    res.writeHead(302, { Location: `${base}/?auth_error=google_not_configured` });
    return res.end();
  }

  const params  = new URL(`http://x${req.url}`).searchParams;
  const code    = params.get("code");
  const stateIn = params.get("state") || "";

  const parts = stateIn.split(".");
  if (parts.length !== 2) {
    res.writeHead(302, { Location: `${base}/?auth_error=invalid_state` });
    return res.end();
  }
  const [ts, sigIn] = parts;
  const tsNum = parseInt(ts, 10);
  const sigExpected = crypto.createHmac("sha256", _stateSecret())
    .update(`google_state:${ts}`).digest("hex").slice(0, 16);
  const stateOk = sigIn === sigExpected
    && !isNaN(tsNum)
    && (Date.now() - tsNum) < 10 * 60 * 1000;

  if (!stateOk) {
    res.writeHead(302, { Location: `${base}/?auth_error=invalid_state` });
    return res.end();
  }
  if (!code) {
    res.writeHead(302, { Location: `${base}/?auth_error=denied` });
    return res.end();
  }

  try {
    const redirectUri = `${base}/api/auth/google/callback`;
    const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }).toString(),
      signal: AbortSignal.timeout(10000),
    });
    const tokenData = await tokenResp.json();
    if (!tokenData.access_token) throw new Error(`google_token: ${JSON.stringify(tokenData)}`);

    const infoResp = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
      signal: AbortSignal.timeout(8000),
    });
    const info = await infoResp.json();

    const googleId = String(info.id || info.sub || "");
    const email    = String(info.email || "");
    const name     = String(info.name || email.split("@")[0] || "Traveler").slice(0, 30);
    if (!googleId) throw new Error("google_no_id");

    const idHash = crypto.createHash("sha256").update(`google:${googleId}`).digest("hex");
    const { userId, displayName, isNew } = createOrLoginUserByOpenid(`google_${idHash.slice(0, 16)}`, name);
    const token = issueUserToken(userId, `goog_${idHash.slice(0, 8)}`);

    console.info(`[AuthController] Google login: ${userId} (${displayName}) isNew=${isNew}`);
    res.writeHead(302, {
      Location: `${base}/?wx_token=${encodeURIComponent(token)}&wx_name=${encodeURIComponent(displayName)}`,
    });
    return res.end();
  } catch (e) {
    console.error("[AuthController.googleCallback]", e.message);
    res.writeHead(302, { Location: `${base}/?auth_error=google_failed` });
    return res.end();
  }
}

// ── Private helpers ────────────────────────────────────────────────────────

function _stateSecret() {
  const secret = process.env.USER_TOKEN_SECRET || process.env.ADMIN_SECRET_KEY;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      console.error("[FATAL] USER_TOKEN_SECRET must be set in production");
      process.exit(1);
    }
    return "cx_dev_only_not_for_production";
  }
  return secret;
}

// Re-use the same secret source as user_auth.js to keep CSRF tokens stable
function _wxStateSecret() {
  return _stateSecret();
}

// ── P2-C: WeChat OAuth nonce store (replay prevention) ──────────────────────
// Keeps used nonces in memory; auto-expires after 15 min (nonce TTL > OAuth window).
// A Set is sufficient — nonces are single-use and expire with the window.
const _wxUsedNonces = new Map(); // nonce → expiresAt
const _WX_NONCE_TTL_MS = 15 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [n, exp] of _wxUsedNonces) { if (exp < now) _wxUsedNonces.delete(n); }
}, 5 * 60 * 1000).unref(); // GC every 5 min

function _httpsGet(url, timeoutMs = 8000) {
  const https = require("https");
  return new Promise((resolve, reject) => {
    const req = https.get(url, (r) => {
      let d = "";
      r.on("data", (c) => { d += c; });
      r.on("end",  () => { try { resolve(JSON.parse(d)); } catch { reject(new Error("parse_error")); } });
    }).on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error("request_timeout"));
    });
  });
}

module.exports = {
  sendOtp,
  verifyOtpAndIssueToken,
  sendEmailCode,
  verifyEmailCodeAndIssueToken,
  getMe,
  logout,
  wechatBegin,
  wechatCallback,
  googleBegin,
  googleCallback,
};
