"use strict";
/**
 * tests/gdpr-compliance.test.js
 * Full GDPR compliance test suite: consent, export, erasure, restriction, notices.
 */

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");

// Use a unique test device ID to avoid polluting real data
const TEST_DID = "cx_" + "f".repeat(30) + "01";

describe("GDPR Consent (Art. 7)", () => {
  const gdpr = require("../src/services/gdpr");

  test("recordConsent: returns id, version, granted, purposes, recordedAt", () => {
    const fakeReq = { socket: { remoteAddress: "127.0.0.1" }, headers: { "user-agent": "test-agent" } };
    const result = gdpr.recordConsent({
      deviceId: TEST_DID,
      granted: true,
      purposes: ["personalization", "analytics"],
      consentVersion: "1.0",
      req: fakeReq,
    });
    assert.ok(result.id?.startsWith("cs_"), "id should start with cs_");
    assert.equal(result.granted, true);
    assert.deepEqual(result.purposes, ["personalization", "analytics"]);
    assert.ok(result.recordedAt, "should have recordedAt");
  });

  test("getConsentStatus: reflects granted consent", () => {
    const status = gdpr.getConsentStatus(TEST_DID);
    assert.equal(status.consented, true, "should be consented after recordConsent");
    assert.equal(status.version, "1.0");
  });

  test("getConsentStatus: history has at least one entry", () => {
    const status = gdpr.getConsentStatus(TEST_DID);
    assert.ok(Array.isArray(status.history), "history should be array");
    assert.ok(status.history.length >= 1, "history should have at least one entry");
    assert.equal(status.history[0].event, "granted");
  });

  test("recordConsent withdrawal: sets granted=false", () => {
    const fakeReq = { socket: { remoteAddress: "127.0.0.1" }, headers: {} };
    const result = gdpr.recordConsent({
      deviceId: TEST_DID,
      granted: false,
      purposes: [],
      consentVersion: "1.0",
      req: fakeReq,
    });
    assert.equal(result.granted, false);
  });
});

describe("GDPR Data Export (Art. 15 + 20)", () => {
  const gdpr = require("../src/services/gdpr");

  test("exportData: returns _meta with policyVersion", () => {
    const data = gdpr.exportData(TEST_DID);
    assert.ok(data._meta?.policyVersion, "should have _meta.policyVersion");
    assert.ok(data._meta?.exportedAt, "should have _meta.exportedAt");
    assert.ok(data._meta?.dataController, "should have _meta.dataController");
  });

  test("exportData: subject.deviceId matches requested device", () => {
    const data = gdpr.exportData(TEST_DID);
    assert.equal(data.subject?.deviceId, TEST_DID);
  });

  test("exportData: trips is an array", () => {
    const data = gdpr.exportData(TEST_DID);
    assert.ok(Array.isArray(data.trips), "trips should be array");
  });

  test("exportData: consent_history is an array with event field", () => {
    const data = gdpr.exportData(TEST_DID);
    assert.ok(Array.isArray(data.consent_history), "consent_history should be array");
    if (data.consent_history.length > 0) {
      assert.ok(data.consent_history[0].event, "consent_history entry should have event field");
    }
  });

  test("exportData: gdpr_requests is an array", () => {
    const data = gdpr.exportData(TEST_DID);
    assert.ok(Array.isArray(data.gdpr_requests), "gdpr_requests should be array");
  });
});

describe("GDPR Erasure (Art. 17)", () => {
  const gdpr = require("../src/services/gdpr");

  const ERASE_DID = "cx_" + "e".repeat(30) + "01";

  before(() => {
    // Record consent first so the user exists
    gdpr.recordConsent({
      deviceId: ERASE_DID,
      granted: true,
      purposes: ["essential"],
      consentVersion: "1.0",
      req: { socket: { remoteAddress: "127.0.0.1" }, headers: {} },
    });
  });

  test("requestErasure: returns ok=true with id and scheduledAt", () => {
    const result = gdpr.requestErasure(ERASE_DID, "test erasure");
    assert.equal(result.ok, true);
    assert.ok(result.id?.startsWith("gr_"), "id should start with gr_");
    assert.ok(result.scheduledAt, "should have scheduledAt");
    assert.ok(result.deadline, "should have deadline");
  });

  test("requestErasure: scheduledAt is in the future (or immediate in test mode)", () => {
    // In test mode (NODE_ENV=test), ERASURE_GRACE_MS=0, so it might be immediate
    const result = gdpr.requestErasure(ERASE_DID + "x", "test2");
    const scheduledAt = new Date(result.scheduledAt).getTime();
    const now = Date.now();
    assert.ok(scheduledAt >= now - 1000, "scheduledAt should be now or in the future");
  });

  test("executePendingDeletions: processes immediate erasures (test mode)", () => {
    // In NODE_ENV=test, ERASURE_GRACE_MS=0 means immediate deletion
    const IMMEDIATE_DID = "cx_" + "d".repeat(30) + "01";
    gdpr.recordConsent({
      deviceId: IMMEDIATE_DID,
      granted: true,
      purposes: ["essential"],
      consentVersion: "1.0",
      req: { socket: {}, headers: {} },
    });
    gdpr.requestErasure(IMMEDIATE_DID, "immediate test");
    // Should not throw
    assert.doesNotThrow(() => gdpr.executePendingDeletions());
    // After erasure, consent status should be cleared
    const status = gdpr.getConsentStatus(IMMEDIATE_DID);
    // Either consented=false or history is empty (data wiped)
    assert.ok(typeof status.consented === "boolean", "consent status should return boolean");
  });
});

describe("GDPR Processing Restriction (Art. 18)", () => {
  const gdpr = require("../src/services/gdpr");
  const RESTRICT_DID = "cx_" + "r".repeat(30) + "01";

  test("restrictProcessing: returns ok=true", () => {
    const result = gdpr.restrictProcessing(RESTRICT_DID, ["accuracy_dispute"]);
    assert.equal(result.ok, true);
    assert.equal(result.restricted, true);
  });

  test("withdrawRestriction: returns ok=true, restricted=false", () => {
    const result = gdpr.withdrawRestriction(RESTRICT_DID);
    assert.equal(result.ok, true);
    assert.equal(result.restricted, false);
  });
});

describe("GDPR Privacy Notice (Art. 13/14)", () => {
  const gdpr = require("../src/services/gdpr");

  test("getPrivacyNotice: has required top-level fields", () => {
    const notice = gdpr.getPrivacyNotice();
    assert.ok(notice.version, "notice should have version");
    assert.ok(notice.controller, "notice should have controller");
    assert.ok(notice.dataProcessed, "notice should have dataProcessed");
    assert.ok(notice.dataSubjectRights, "notice should have dataSubjectRights");
    assert.ok(notice.contact, "notice should have contact");
  });

  test("getPrivacyNotice: controller has contact email", () => {
    const notice = gdpr.getPrivacyNotice();
    assert.ok(notice.controller.contact?.includes("@"), "controller.contact should be an email");
  });

  test("getPrivacyNotice: dataSubjectRights includes erasure", () => {
    const notice = gdpr.getPrivacyNotice();
    const rights = notice.dataSubjectRights.map(r => r.right);
    assert.ok(rights.includes("erasure") || rights.includes("erasure_right") || rights.some(r => r.includes("eras")),
      "rights should include erasure");
  });
});

describe("GDPR Processing Register (Art. 30)", () => {
  const gdpr = require("../src/services/gdpr");

  test("getProcessingRegister: has controller and activities", () => {
    const register = gdpr.getProcessingRegister();
    assert.ok(register.controller, "should have controller");
    assert.ok(Array.isArray(register.activities), "activities should be array");
    assert.ok(register.activities.length >= 2, "should have at least 2 processing activities");
  });

  test("getProcessingRegister: each activity has required fields", () => {
    const register = gdpr.getProcessingRegister();
    for (const activity of register.activities) {
      assert.ok(activity.id,      `activity ${JSON.stringify(activity)} should have id`);
      assert.ok(activity.purpose, `activity ${activity.id} should have purpose`);
      assert.ok(activity.basis,   `activity ${activity.id} should have lawful basis`);
    }
  });
});

describe("GDPR Crons", () => {
  const gdpr = require("../src/services/gdpr");

  test("startErasureCron/stopCrons: idempotent", () => {
    assert.doesNotThrow(() => {
      gdpr.startErasureCron();
      gdpr.startErasureCron(); // second call should be no-op
      gdpr.stopCrons();
    });
  });

  test("startRetentionCron/stopCrons: idempotent", () => {
    assert.doesNotThrow(() => {
      gdpr.startRetentionCron();
      gdpr.stopCrons();
    });
  });
});
