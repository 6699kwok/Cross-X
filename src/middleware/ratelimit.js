"use strict";
/**
 * src/middleware/ratelimit.js
 * Fixed-window in-memory rate limiter.
 * Factory pattern allows tests to inject custom limits and isolated state.
 */

const DEFAULT_LIMITS = { llm: 10, agent: 30, auth: 5 };
const DEFAULT_WINDOW = 60_000;

function createRateLimiter({
  limits       = DEFAULT_LIMITS,
  windowMs     = DEFAULT_WINDOW,
  gcIntervalMs = 5 * 60_000,
} = {}) {
  const store = new Map(); // "ip:tier" → { count, windowStart }

  function getIp(req) {
    const xff = req.headers?.["x-forwarded-for"];
    if (xff) return String(xff).split(",")[0].trim();
    return req.socket?.remoteAddress || "unknown";
  }

  /**
   * Check and consume one token for this request.
   * Returns null when allowed, or { retryAfterMs } when rate-limited.
   */
  function check(req, pathname) {
    const tier =
      pathname === "/api/agent/llm-plan" || pathname === "/api/agent/llm-plan/stream"
        || pathname.startsWith("/api/rag/")
        ? "llm"
        : pathname.startsWith("/api/agent/") || pathname === "/api/payments/charge"
          ? "agent"
          : pathname === "/api/auth/send-otp" || pathname === "/api/auth/verify-otp"
            ? "auth"
            : null;
    if (!tier) return null;

    const key = `${getIp(req)}:${tier}`;
    const now = Date.now();
    let bucket = store.get(key);
    if (!bucket || now - bucket.windowStart >= windowMs) {
      store.set(key, { count: 1, windowStart: now });
      return null;
    }
    bucket.count += 1;
    if (bucket.count > limits[tier]) {
      return { retryAfterMs: windowMs - (now - bucket.windowStart) };
    }
    return null;
  }

  const gc = setInterval(() => {
    const now = Date.now();
    for (const [k, b] of store) {
      if (now - b.windowStart >= windowMs) store.delete(k);
    }
  }, gcIntervalMs);

  return { check, getIp, store, gc };
}

module.exports = { createRateLimiter };
