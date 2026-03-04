"use strict";
const { test } = require("node:test");
const assert   = require("node:assert/strict");
const { createRateLimiter } = require("../src/middleware/ratelimit");

function fakeReq(ip, path) {
  return { headers: {}, socket: { remoteAddress: ip }, url: path };
}

function rl(limitCount = 2) {
  // Short window so tests don't need to wait; huge GC interval so it never runs
  const r = createRateLimiter({ limits: { agent: limitCount, llm: limitCount }, windowMs: 10_000, gcIntervalMs: 1e9 });
  r.gc.unref();
  return r;
}

test("first request is always allowed", () => {
  const r = rl();
  assert.equal(r.check(fakeReq("1.2.3.4", "/api/agent/reserve"), "/api/agent/reserve"), null);
});

test("requests within limit are allowed", () => {
  const r = rl(3);
  for (let i = 0; i < 3; i++) {
    assert.equal(r.check(fakeReq("1.1.1.1", "/api/agent/x"), "/api/agent/x"), null);
  }
});

test("request over limit returns retryAfterMs", () => {
  const r = rl(2);
  r.check(fakeReq("1.1.1.1", "/api/agent/x"), "/api/agent/x");
  r.check(fakeReq("1.1.1.1", "/api/agent/x"), "/api/agent/x");
  const result = r.check(fakeReq("1.1.1.1", "/api/agent/x"), "/api/agent/x");
  assert.ok(result !== null, "3rd request should be rate-limited");
  assert.ok(typeof result.retryAfterMs === "number" && result.retryAfterMs > 0);
});

test("different IPs are isolated", () => {
  const r = rl(1);
  r.check(fakeReq("1.1.1.1", "/api/agent/x"), "/api/agent/x");
  r.check(fakeReq("1.1.1.1", "/api/agent/x"), "/api/agent/x"); // blocked
  // different IP should still be allowed
  assert.equal(r.check(fakeReq("2.2.2.2", "/api/agent/x"), "/api/agent/x"), null);
});

test("llm and agent tiers are independent", () => {
  const r = rl(1);
  r.check(fakeReq("1.1.1.1", "/api/agent/llm-plan"), "/api/agent/llm-plan");
  r.check(fakeReq("1.1.1.1", "/api/agent/llm-plan"), "/api/agent/llm-plan"); // llm blocked
  // agent tier still fresh
  assert.equal(r.check(fakeReq("1.1.1.1", "/api/agent/reserve"), "/api/agent/reserve"), null);
});

test("XFF header takes priority over socket IP", () => {
  const r = rl();
  const req = {
    headers: { "x-forwarded-for": "5.5.5.5, 10.0.0.1" },
    socket: { remoteAddress: "127.0.0.1" },
  };
  assert.equal(r.getIp(req), "5.5.5.5");
});

test("non-rate-limited path always returns null", () => {
  const r = rl(0); // limit=0 means every agent/llm request would block
  for (let i = 0; i < 20; i++) {
    // /api/system/status is not in the tier map → always null
    assert.equal(r.check(fakeReq("1.1.1.1", "/api/system/status"), "/api/system/status"), null);
  }
});

test("/api/payments/charge is rate-limited under agent tier", () => {
  const r = rl(1);
  r.check(fakeReq("9.9.9.9", "/api/payments/charge"), "/api/payments/charge");
  const denied = r.check(fakeReq("9.9.9.9", "/api/payments/charge"), "/api/payments/charge");
  assert.ok(denied !== null, "payments/charge should be rate-limited");
});
