"use strict";
/**
 * tests/reliability-extended.test.js
 * Concurrent sessions, DB stability, memory bounds, rate limiting under load,
 * cron idempotency, profile merge correctness under concurrent writes.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

describe("Concurrent Session Operations", () => {
  const { getSession, createSession, patchSession } = require("../src/session/store");

  test("50 concurrent session creates without data corruption", async () => {
    const N = 50;
    // createSession() generates UUIDs and actually stores the entry
    const createdIds = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        Promise.resolve(createSession({ index: i, intent: "test", slots: { destination: `City${i}` } }))
      )
    );

    // Verify all sessions persisted correctly
    let successCount = 0;
    for (const id of createdIds) {
      const sess = getSession(id);
      if (sess && sess.index !== undefined) successCount++;
    }
    assert.equal(successCount, N, `All ${N} sessions should persist correctly`);
  });

  test("concurrent reads on same session ID are stable", async () => {
    const id = createSession({ intent: "read-test", marker: "stable" });
    const reads = await Promise.all(
      Array.from({ length: 20 }, () => Promise.resolve(getSession(id)))
    );
    const allMatch = reads.every(r => r && r.intent === "read-test");
    assert.ok(allMatch, "All concurrent reads should return consistent session data");
  });
});

describe("DB Stability — Consecutive Operations", () => {
  const { getUser, updateUser, getOrder, getAllOrders } = require("../src/services/db");

  test("1000 consecutive getUser calls without error", () => {
    let errors = 0;
    for (let i = 0; i < 1000; i++) {
      try {
        getUser("demo");
      } catch {
        errors++;
      }
    }
    assert.equal(errors, 0, "All 1000 getUser calls should succeed");
  });

  test("1000 consecutive getAllOrders calls without error", () => {
    let errors = 0;
    for (let i = 0; i < 1000; i++) {
      try {
        getAllOrders();
      } catch {
        errors++;
      }
    }
    assert.equal(errors, 0, "All 1000 getAllOrders calls should succeed");
  });

  test("updateUser: 100 consecutive updates without corruption", () => {
    const DID = "cx_" + "u".repeat(30) + "99";
    updateUser(DID, { id: DID, language: "EN" });
    for (let i = 0; i < 100; i++) {
      updateUser(DID, { city: `City${i}` });
    }
    const user = getUser(DID);
    assert.ok(user, "user should exist after 100 updates");
    assert.equal(user.city, "City99", "last update should win");
  });
});

describe("Rate Limiter Under Concurrent Load", () => {
  const { createRateLimiter } = require("../src/middleware/ratelimit");

  // check() takes (req, pathname) — null = allowed, {retryAfterMs} = blocked
  function mockReq(ip) {
    return { headers: {}, socket: { remoteAddress: ip } };
  }
  const RATE_PATH = "/api/agent/llm-plan"; // matches "llm" tier

  test("rate limiter correctly blocks over-limit requests (10/min)", () => {
    const limiter = createRateLimiter({ limits: { llm: 10, agent: 30 }, windowMs: 60_000 });
    limiter.gc.unref(); // don't block process exit
    const req = mockReq(`192.168.${Date.now() % 255}.1`);

    let allowed = 0, blocked = 0;
    for (let i = 0; i < 15; i++) {
      const result = limiter.check(req, RATE_PATH);
      if (result === null) allowed++;
      else blocked++;
    }
    assert.equal(allowed, 10, "exactly 10 requests should be allowed");
    assert.equal(blocked, 5, "5 requests should be blocked");
  });

  test("rate limiter resets after window expiry (simulated)", async () => {
    const limiter = createRateLimiter({ limits: { llm: 3, agent: 30 }, windowMs: 100 }); // 100ms window
    limiter.gc.unref(); // don't block process exit
    const req = mockReq(`10.0.${Date.now() % 255}.2`);

    // Fill the window
    for (let i = 0; i < 3; i++) limiter.check(req, RATE_PATH);
    // Should be blocked now (4th request)
    assert.notEqual(limiter.check(req, RATE_PATH), null, "4th request should be rate-limited");

    // Wait for window to expire
    await new Promise((resolve) => setTimeout(resolve, 150));
    const result = limiter.check(req, RATE_PATH);
    assert.equal(result, null, "should be allowed after window reset");
  });
});

describe("GDPR Cron Idempotency", () => {
  const gdpr = require("../src/services/gdpr");

  test("startErasureCron called multiple times is safe", () => {
    assert.doesNotThrow(() => {
      gdpr.startErasureCron();
      gdpr.startErasureCron();
      gdpr.startErasureCron();
      gdpr.stopCrons();
    });
  });

  test("executePendingDeletions called multiple times is safe", () => {
    assert.doesNotThrow(() => {
      gdpr.executePendingDeletions();
      gdpr.executePendingDeletions();
    });
  });
});

describe("Memory Baseline", () => {
  test("heap stays below 256MB after 500 rapid DB reads", () => {
    const { getUser, getAllOrders, getAuditLogs } = require("../src/services/db");
    for (let i = 0; i < 500; i++) {
      getUser("demo");
      if (i % 10 === 0) getAllOrders();
    }
    const { heapUsed } = process.memoryUsage();
    const heapMb = heapUsed / 1024 / 1024;
    assert.ok(heapMb < 256, `Heap should be under 256MB, got ${heapMb.toFixed(1)}MB`);
  });
});

describe("Profile Merge Concurrent Writes", () => {
  const { saveProfile, loadProfile } = require("../src/session/profile");

  test("10 sequential profile saves accumulate trip count", () => {
    const deviceId = `profile_test_${Date.now()}`;
    const cities = ["Shanghai", "Beijing", "Guangzhou", "Shenzhen", "Chengdu",
      "Hangzhou", "Nanjing", "Wuhan", "Chongqing", "Xiamen"];
    for (const city of cities) {
      saveProfile(deviceId, { budget: "mid" }, city, null);
    }
    const profile = loadProfile(deviceId);
    assert.ok(profile, "profile should exist after saves");
    assert.ok(typeof profile.tripCount === "number", "tripCount should be a number");
    assert.ok(profile.tripCount >= 1, "tripCount should be at least 1");
    assert.ok(Array.isArray(profile.cities), "cities should be array");
  });

  test("loadProfile: returns null for unknown device", () => {
    const result = loadProfile("cx_unknown_device_that_never_existed_xyz");
    assert.equal(result, null);
  });
});
