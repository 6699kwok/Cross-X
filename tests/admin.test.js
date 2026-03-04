"use strict";
/**
 * tests/admin.test.js
 * Admin auth, token issuance, settlement rate limiting, RBAC.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

describe("Admin Token Issuance and Validation", () => {
  const { issueToken, verifyToken, validateMasterKey, validateAdminToken, requireAdmin, requireFinance } =
    require("../src/middleware/auth");

  test("issueToken: finance role token passes verifyToken", () => {
    const saved = process.env.ADMIN_SECRET_KEY;
    process.env.ADMIN_SECRET_KEY = "admin-test-secret-xyz";
    const token = issueToken("finance_user", "finance");
    const payload = verifyToken(token);
    process.env.ADMIN_SECRET_KEY = saved || "";
    assert.ok(payload, "finance token should be valid");
    assert.equal(payload.role, "finance");
  });

  test("validateAdminToken: returns null when no token provided", () => {
    const saved = process.env.ADMIN_SECRET_KEY;
    process.env.ADMIN_SECRET_KEY = "admin-test-secret-xyz";
    const req = { headers: {} };
    const result = validateAdminToken(req);
    process.env.ADMIN_SECRET_KEY = saved || "";
    assert.equal(result, null);
  });

  test("validateAdminToken: returns null when finance token provided (wrong role)", () => {
    const saved = process.env.ADMIN_SECRET_KEY;
    process.env.ADMIN_SECRET_KEY = "admin-test-secret-xyz";
    const token = issueToken("finance_user", "finance");
    const req = { headers: { authorization: `Bearer ${token}` } };
    const result = validateAdminToken(req);
    process.env.ADMIN_SECRET_KEY = saved || "";
    assert.equal(result, null, "finance token should not pass admin validation");
  });

  test("validateAdminToken: returns payload when admin token provided", () => {
    const saved = process.env.ADMIN_SECRET_KEY;
    process.env.ADMIN_SECRET_KEY = "admin-test-secret-xyz";
    const token = issueToken("admin", "admin");
    const req = { headers: { authorization: `Bearer ${token}` } };
    const result = validateAdminToken(req);
    process.env.ADMIN_SECRET_KEY = saved || "";
    assert.ok(result, "admin token should be accepted");
    assert.equal(result.role, "admin");
  });

  test("requireAdmin: writes 401 and returns false when no token", () => {
    const saved = process.env.ADMIN_SECRET_KEY;
    process.env.ADMIN_SECRET_KEY = "admin-test-secret-xyz";
    let statusCode = null;
    let body = null;
    const req = { headers: {} };
    const res = {
      writeHead: (code) => { statusCode = code; },
      end: (b) => { body = b; },
    };
    const result = requireAdmin(req, res);
    process.env.ADMIN_SECRET_KEY = saved || "";
    assert.equal(result, false);
    assert.equal(statusCode, 401);
    const parsed = JSON.parse(body);
    assert.equal(parsed.error, "unauthorized");
  });

  test("requireAdmin: returns payload when valid admin token", () => {
    const saved = process.env.ADMIN_SECRET_KEY;
    process.env.ADMIN_SECRET_KEY = "admin-test-secret-xyz";
    const token = issueToken("admin", "admin");
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = { writeHead: () => {}, end: () => {} };
    const result = requireAdmin(req, res);
    process.env.ADMIN_SECRET_KEY = saved || "";
    assert.ok(result && result.role === "admin");
  });

  test("requireFinance: accepts admin token", () => {
    const saved = process.env.ADMIN_SECRET_KEY;
    process.env.ADMIN_SECRET_KEY = "admin-test-secret-xyz";
    const token = issueToken("admin", "admin");
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = { writeHead: () => {}, end: () => {} };
    const result = requireFinance(req, res);
    process.env.ADMIN_SECRET_KEY = saved || "";
    assert.ok(result && ["admin", "finance"].includes(result.role));
  });

  test("requireFinance: accepts finance token", () => {
    const saved = process.env.ADMIN_SECRET_KEY;
    process.env.ADMIN_SECRET_KEY = "admin-test-secret-xyz";
    const token = issueToken("finance", "finance");
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = { writeHead: () => {}, end: () => {} };
    const result = requireFinance(req, res);
    process.env.ADMIN_SECRET_KEY = saved || "";
    assert.ok(result, "finance token should be accepted");
  });

  test("requireFinance: rejects user token with 401", () => {
    const saved = process.env.ADMIN_SECRET_KEY;
    process.env.ADMIN_SECRET_KEY = "admin-test-secret-xyz";
    const token = issueToken("user1", "user");
    const req = { headers: { authorization: `Bearer ${token}` } };
    let statusCode = null;
    const res = { writeHead: (c) => { statusCode = c; }, end: () => {} };
    const result = requireFinance(req, res);
    process.env.ADMIN_SECRET_KEY = saved || "";
    assert.equal(result, false);
    assert.equal(statusCode, 401);
  });
});

describe("Settlement Rate Limiting", () => {
  const { checkSettlementRateLimit } = require("../src/middleware/auth");

  test("first call: allowed=true", () => {
    const req = { socket: { remoteAddress: "10.0.0.99" } };
    const result = checkSettlementRateLimit(req);
    assert.equal(result.allowed, true);
  });

  test("second call within 1 hour: allowed=false, retryAfterSec > 0", () => {
    const req = { socket: { remoteAddress: "10.0.0.100" } };
    checkSettlementRateLimit(req); // first call — allowed
    const result = checkSettlementRateLimit(req); // second call — blocked
    assert.equal(result.allowed, false);
    assert.ok(result.retryAfterSec > 0, "retryAfterSec should be positive");
  });

  test("different IPs are tracked independently", () => {
    const req1 = { socket: { remoteAddress: "10.0.0.201" } };
    const req2 = { socket: { remoteAddress: "10.0.0.202" } };
    checkSettlementRateLimit(req1); // consumes req1's quota
    const r1 = checkSettlementRateLimit(req1); // blocked
    const r2 = checkSettlementRateLimit(req2); // allowed (different IP)
    assert.equal(r1.allowed, false);
    assert.equal(r2.allowed, true);
  });
});

describe("RBAC: getUserRole and setUserRole", () => {
  const { getUserRole, setUserRole, getUser, updateUser, nowIso } = require("../src/services/db");
  const TEST_RBAC_DID = "cx_" + "b".repeat(30) + "01";

  // Ensure user row exists
  before(() => {
    const existing = getUser(TEST_RBAC_DID);
    if (!existing) {
      updateUser(TEST_RBAC_DID, { id: TEST_RBAC_DID, language: "EN" });
    }
  });

  test("getUserRole: returns 'user' for new device", () => {
    const FRESH_DID = "cx_" + "0".repeat(30) + "01";
    const role = getUserRole(FRESH_DID);
    assert.equal(role, "user");
  });

  test("setUserRole + getUserRole: round-trip", () => {
    // setUserRole requires user row exists
    updateUser(TEST_RBAC_DID, { id: TEST_RBAC_DID });
    setUserRole(TEST_RBAC_DID, "operator");
    const role = getUserRole(TEST_RBAC_DID);
    assert.equal(role, "operator");
  });

  test("setUserRole: rejects invalid role", () => {
    assert.throws(
      () => setUserRole(TEST_RBAC_DID, "superadmin"),
      /Invalid role/,
    );
  });
});

function before(fn) { fn(); }
