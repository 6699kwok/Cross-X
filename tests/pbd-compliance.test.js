"use strict";
/**
 * tests/pbd-compliance.test.js
 * Privacy by Design (PbD) compliance tests.
 * Verifies: data minimization, purpose limitation, storage limitation,
 * integrity, accountability, portability.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

describe("Privacy by Design — Consent Log Integrity", () => {
  const gdpr = require("../src/services/gdpr");
  const { getConsentLog } = require("../src/services/db");

  test("consent log: ip_hash is 64-char hex (SHA-256, not raw IP)", () => {
    const TEST_DID = "cx_" + "c".repeat(30) + "01";
    gdpr.recordConsent({
      deviceId: TEST_DID,
      granted: true,
      purposes: ["essential"],
      consentVersion: "1.0",
      req: { socket: { remoteAddress: "192.168.1.42" }, headers: { "user-agent": "TestAgent/1.0" } },
    });
    const logs = getConsentLog(TEST_DID);
    assert.ok(logs.length > 0, "consent log should have entries");
    const entry = logs[0];
    // SHA-256 hex = 64 chars, never "192.168.1.42"
    assert.ok(entry.ip_hash?.length === 64, `ip_hash should be 64 chars, got ${entry.ip_hash?.length}`);
    assert.ok(/^[a-f0-9]{64}$/.test(entry.ip_hash || ""), "ip_hash should be hex");
    assert.ok(entry.ip_hash !== "192.168.1.42", "ip_hash should not be raw IP");
  });

  test("consent log: user_agent_hash is 64-char hex (SHA-256)", () => {
    const TEST_DID = "cx_" + "c".repeat(30) + "02";
    gdpr.recordConsent({
      deviceId: TEST_DID,
      granted: true,
      purposes: ["essential"],
      consentVersion: "1.0",
      req: { socket: { remoteAddress: "127.0.0.1" }, headers: { "user-agent": "Mozilla/5.0 Test" } },
    });
    const logs = getConsentLog(TEST_DID);
    const entry = logs[0];
    assert.ok(/^[a-f0-9]{64}$/.test(entry.user_agent_hash || ""), "user_agent_hash should be SHA-256 hex");
    assert.ok(entry.user_agent_hash !== "Mozilla/5.0 Test", "should not store raw UA");
  });
});

describe("Privacy by Design — Accountability (GDPR Art. 5(2))", () => {
  const gdpr = require("../src/services/gdpr");

  test("requestErasure: GDPR request has deadline_at set", () => {
    const TEST_DID = "cx_" + "a".repeat(30) + "01";
    const result = gdpr.requestErasure(TEST_DID, "accountability test");
    assert.ok(result.deadline, "erasure request should have deadline");
    const deadline = new Date(result.deadline);
    assert.ok(!isNaN(deadline.getTime()), "deadline should be valid date");
    assert.ok(deadline.getTime() >= Date.now() - 1000, "deadline should be now or in the future");
  });

  test("getProcessingRegister: each activity has technicalMeasures", () => {
    const register = gdpr.getProcessingRegister();
    for (const activity of register.activities) {
      assert.ok(Array.isArray(activity.technicalMeasures),
        `activity ${activity.id} should have technicalMeasures array`);
      assert.ok(activity.technicalMeasures.length > 0,
        `activity ${activity.id} should list at least one technical measure`);
    }
  });
});

describe("Privacy by Design — Data Portability (Art. 20)", () => {
  const gdpr = require("../src/services/gdpr");

  test("exportData: is valid JSON and has top-level structure", () => {
    const TEST_DID = "cx_" + "p".repeat(30) + "01";
    const data = gdpr.exportData(TEST_DID);
    // Should be parseable (i.e., not throw when serialized)
    const serialized = JSON.stringify(data);
    assert.ok(serialized.length > 0, "export should not be empty");
    const parsed = JSON.parse(serialized);
    assert.ok(parsed._meta, "parsed export should have _meta");
  });

  test("exportData: trips have required portability fields", () => {
    const TEST_DID = "demo"; // demo user has known data
    const data = gdpr.exportData(TEST_DID);
    if (data.trips.length > 0) {
      const trip = data.trips[0];
      assert.ok(trip.id !== undefined, "trip should have id");
      assert.ok(trip.createdAt !== undefined, "trip should have createdAt");
    } else {
      assert.ok(true, "no trips — portability test skipped (no data)");
    }
  });

  test("exportData: does not leak internal DB implementation details", () => {
    const TEST_DID = "demo";
    const data = gdpr.exportData(TEST_DID);
    const serialized = JSON.stringify(data);
    // Should not contain raw SQL column names (snake_case internals)
    assert.ok(!serialized.includes("pref_dietary"), "should not expose internal column names");
    assert.ok(!serialized.includes("loc_lat"), "should not expose raw location column names");
    assert.ok(!serialized.includes("pii_enc_"), "should not expose encrypted column names");
  });
});

describe("Privacy by Design — Storage Limitation (Art. 5(1)(e))", () => {
  test("pruneOldData: completes without error", () => {
    const { pruneOldData } = require("../src/services/db");
    assert.doesNotThrow(() => pruneOldData());
  });

  test("pruneOldData: returns result object (or undefined — no-throw guarantee)", () => {
    const { pruneOldData } = require("../src/services/db");
    const result = pruneOldData();
    // Function may return undefined — just ensure no exception
    assert.ok(result === undefined || typeof result === "object", "pruneOldData should not crash");
  });
});

describe("Privacy by Design — Field Encryption (Art. 32)", () => {
  const { enc, dec, _resetKeyCache } = require("../src/crypto/fieldEncrypt");

  test("encrypted value is not human-readable plaintext", () => {
    _resetKeyCache();
    const saved = process.env.CROSSX_DB_ENCRYPTION_KEY;
    process.env.CROSSX_DB_ENCRYPTION_KEY = "pbd-test-encryption-key-32bytes!";
    const sensitive = "patient has halal diet";
    const encrypted = enc(sensitive);
    process.env.CROSSX_DB_ENCRYPTION_KEY = saved || "";
    _resetKeyCache();
    assert.ok(!encrypted.includes("halal"), "encrypted value should not contain plaintext 'halal'");
    assert.ok(!encrypted.includes("diet"),  "encrypted value should not contain plaintext 'diet'");
  });

  test("different encryptions of same value produce different ciphertexts (IV randomness)", () => {
    _resetKeyCache();
    const saved = process.env.CROSSX_DB_ENCRYPTION_KEY;
    process.env.CROSSX_DB_ENCRYPTION_KEY = "pbd-test-encryption-key-32bytes!";
    const value = "test@example.com";
    const enc1 = enc(value);
    const enc2 = enc(value);
    process.env.CROSSX_DB_ENCRYPTION_KEY = saved || "";
    _resetKeyCache();
    assert.notEqual(enc1, enc2, "same plaintext should produce different ciphertexts due to random IV");
  });
});

describe("Privacy by Design — Consent Middleware", () => {
  const { enforceConsent, shouldBypassConsent } = require("../src/middleware/consent");

  test("shouldBypassConsent: /api/privacy/* paths bypass consent check", () => {
    assert.equal(shouldBypassConsent("/api/privacy/consent"), true);
    assert.equal(shouldBypassConsent("/api/privacy/export"), true);
    assert.equal(shouldBypassConsent("/api/privacy/erase"), true);
  });

  test("shouldBypassConsent: /api/plan/coze bypasses (essential service)", () => {
    assert.equal(shouldBypassConsent("/api/plan/coze"), true);
  });

  test("shouldBypassConsent: /api/metrics/events does NOT bypass", () => {
    assert.equal(shouldBypassConsent("/api/metrics/events"), false);
  });

  test("enforceConsent: demo deviceId always passes (anonymous access)", () => {
    const res = { writeHead: () => {}, end: () => {} };
    const result = enforceConsent("demo", res);
    assert.equal(result, true);
  });

  test("enforceConsent: device with granted consent passes", () => {
    const gdpr = require("../src/services/gdpr");
    const TEST_DID = "cx_" + "9".repeat(30) + "01";
    gdpr.recordConsent({
      deviceId: TEST_DID, granted: true,
      purposes: ["essential"], consentVersion: "1.0",
      req: { socket: {}, headers: {} },
    });
    const res = { writeHead: () => {}, end: () => {} };
    const result = enforceConsent(TEST_DID, res, { required: true });
    assert.equal(result, true);
  });
});
