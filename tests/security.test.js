"use strict";
/**
 * tests/security.test.js
 * Security headers, map-key origin guard, admin auth, schema validation.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

// ── Security middleware ───────────────────────────────────────────────────────
describe("Security Middleware", () => {
  const { applySecurityHeaders, validateMapKeyOrigin, validateSchema, sanitizeError, extractDeviceId } =
    require("../src/middleware/security");

  test("applySecurityHeaders sets X-Frame-Options: DENY", () => {
    const headers = {};
    const res = { setHeader: (k, v) => { headers[k] = v; }, getHeader: () => undefined };
    applySecurityHeaders(res);
    assert.equal(headers["X-Frame-Options"], "DENY");
  });

  test("applySecurityHeaders sets Content-Security-Policy", () => {
    const headers = {};
    const res = { setHeader: (k, v) => { headers[k] = v; }, getHeader: () => undefined };
    applySecurityHeaders(res);
    assert.ok(headers["Content-Security-Policy"]?.includes("default-src 'self'"), "CSP must include default-src");
  });

  test("applySecurityHeaders sets Referrer-Policy", () => {
    const headers = {};
    const res = { setHeader: (k, v) => { headers[k] = v; }, getHeader: () => undefined };
    applySecurityHeaders(res);
    assert.ok(headers["Referrer-Policy"], "Referrer-Policy must be set");
  });

  test("applySecurityHeaders sets X-Content-Type-Options: nosniff", () => {
    const headers = {};
    const res = { setHeader: (k, v) => { headers[k] = v; }, getHeader: () => undefined };
    applySecurityHeaders(res);
    assert.equal(headers["X-Content-Type-Options"], "nosniff");
  });

  test("validateMapKeyOrigin: rejects headless request (no Origin/Referer)", () => {
    const req = { headers: {} };
    assert.equal(validateMapKeyOrigin(req), false);
  });

  test("validateMapKeyOrigin: accepts same-origin request", () => {
    const req = { headers: { origin: "http://127.0.0.1:8787" } };
    // Set ALLOWED_ORIGINS for this test
    const saved = process.env.ALLOWED_ORIGINS;
    process.env.ALLOWED_ORIGINS = "http://127.0.0.1:8787";
    const result = validateMapKeyOrigin(req);
    if (saved) process.env.ALLOWED_ORIGINS = saved; else delete process.env.ALLOWED_ORIGINS;
    assert.equal(result, true);
  });

  test("validateMapKeyOrigin: rejects cross-origin request", () => {
    const req = { headers: { origin: "https://evil.example.com" } };
    const saved = process.env.ALLOWED_ORIGINS;
    process.env.ALLOWED_ORIGINS = "http://127.0.0.1:8787";
    const result = validateMapKeyOrigin(req);
    if (saved) process.env.ALLOWED_ORIGINS = saved; else delete process.env.ALLOWED_ORIGINS;
    assert.equal(result, false);
  });

  test("validateSchema: accepts valid body", () => {
    const errs = validateSchema({ name: "test", count: 5 }, {
      name:  { required: true, type: "string", maxLength: 100 },
      count: { required: true, type: "number", min: 0, max: 100 },
    });
    assert.deepEqual(errs, []);
  });

  test("validateSchema: catches missing required field", () => {
    const errs = validateSchema({}, { name: { required: true, type: "string" } });
    assert.ok(errs.length > 0, "should report error for missing required field");
    assert.ok(errs[0].includes("name"), "error should mention field name");
  });

  test("validateSchema: catches wrong type", () => {
    const errs = validateSchema({ count: "five" }, { count: { required: true, type: "number" } });
    assert.ok(errs.length > 0, "should report type error");
  });

  test("validateSchema: catches maxLength violation", () => {
    const errs = validateSchema({ note: "a".repeat(201) }, { note: { required: true, type: "string", maxLength: 200 } });
    assert.ok(errs.length > 0, "should report maxLength error");
  });

  test("sanitizeError: hides stack in non-dev environment", () => {
    const saved = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const err = new Error("internal database error");
    const sanitized = sanitizeError(err);
    process.env.NODE_ENV = saved;
    assert.ok(!JSON.stringify(sanitized).includes("database"), "stack should not leak in production");
    assert.ok(sanitized.requestId, "should include requestId");
  });

  test("extractDeviceId: accepts valid cx_ format", () => {
    const req = { headers: { "x-device-id": "cx_aabbccddeeff00112233445566778899" } };
    const did = extractDeviceId(req, {});
    assert.equal(did, "cx_aabbccddeeff00112233445566778899");
  });

  test("extractDeviceId: accepts demo id", () => {
    const req = { headers: { "x-device-id": "demo" } };
    const did = extractDeviceId(req, {});
    assert.equal(did, "demo");
  });

  test("extractDeviceId: rejects malformed id", () => {
    const req = { headers: { "x-device-id": "badformat" } };
    const did = extractDeviceId(req, {});
    assert.equal(did, null);
  });
});

// ── Auth middleware ───────────────────────────────────────────────────────────
describe("Auth Middleware", () => {
  const { issueToken, verifyToken, validateMasterKey, validateAdminToken } = require("../src/middleware/auth");

  test("issueToken + verifyToken round trip", () => {
    const saved = process.env.ADMIN_SECRET_KEY;
    process.env.ADMIN_SECRET_KEY = "test-secret-key-abc123";
    const token = issueToken("admin", "admin");
    const payload = verifyToken(token);
    process.env.ADMIN_SECRET_KEY = saved || "";
    assert.ok(payload, "token should be verifiable");
    assert.equal(payload.role, "admin");
    assert.equal(payload.sub, "admin");
  });

  test("verifyToken: rejects tampered token", () => {
    const saved = process.env.ADMIN_SECRET_KEY;
    process.env.ADMIN_SECRET_KEY = "test-secret-key-abc123";
    const token = issueToken("admin", "admin");
    const tampered = token.slice(0, -5) + "zzzzz";
    const payload = verifyToken(tampered);
    process.env.ADMIN_SECRET_KEY = saved || "";
    assert.equal(payload, null);
  });

  test("verifyToken: rejects expired token", () => {
    const saved = process.env.ADMIN_SECRET_KEY;
    process.env.ADMIN_SECRET_KEY = "test-secret-key-abc123";
    const crypto = require("crypto");
    // Craft a token that expired 1 hour ago
    const expiredPayload = { sub: "admin", role: "admin", iat: Date.now() - 3600000 * 9, exp: Date.now() - 1 };
    const payloadB64 = Buffer.from(JSON.stringify(expiredPayload)).toString("base64");
    const sig = crypto.createHmac("sha256", process.env.ADMIN_SECRET_KEY).update(payloadB64).digest("hex");
    const expiredToken = `${payloadB64}.${sig}`;
    const result = verifyToken(expiredToken);
    process.env.ADMIN_SECRET_KEY = saved || "";
    assert.equal(result, null);
  });

  test("validateMasterKey: accepts correct key", () => {
    const saved = process.env.ADMIN_SECRET_KEY;
    process.env.ADMIN_SECRET_KEY = "my-secret-admin-key";
    const result = validateMasterKey("my-secret-admin-key");
    process.env.ADMIN_SECRET_KEY = saved || "";
    assert.equal(result, true);
  });

  test("validateMasterKey: rejects wrong key", () => {
    const saved = process.env.ADMIN_SECRET_KEY;
    process.env.ADMIN_SECRET_KEY = "my-secret-admin-key";
    const result = validateMasterKey("wrong-key");
    process.env.ADMIN_SECRET_KEY = saved || "";
    assert.equal(result, false);
  });
});

// ── Field encryption ──────────────────────────────────────────────────────────
describe("Field Encryption", () => {
  const { enc, dec, encJson, decJson, _resetKeyCache } = require("../src/crypto/fieldEncrypt");

  test("enc output starts with ENC:v1: when key set", () => {
    _resetKeyCache();
    const saved = process.env.CROSSX_DB_ENCRYPTION_KEY;
    process.env.CROSSX_DB_ENCRYPTION_KEY = "test-encryption-key-32-bytes-abc";
    const encrypted = enc("sensitive@example.com");
    process.env.CROSSX_DB_ENCRYPTION_KEY = saved || "";
    _resetKeyCache();
    assert.ok(encrypted.startsWith("ENC:v1:"), `expected ENC:v1: prefix, got: ${encrypted.slice(0, 20)}`);
  });

  test("dec(enc(value)) round-trip preserves value", () => {
    _resetKeyCache();
    const saved = process.env.CROSSX_DB_ENCRYPTION_KEY;
    process.env.CROSSX_DB_ENCRYPTION_KEY = "test-encryption-key-32-bytes-abc";
    const original = "halal, no peanuts";
    const encrypted = enc(original);
    const decrypted = dec(encrypted);
    process.env.CROSSX_DB_ENCRYPTION_KEY = saved || "";
    _resetKeyCache();
    assert.equal(decrypted, original);
  });

  test("dec returns plaintext as-is (no prefix = unencrypted)", () => {
    _resetKeyCache();
    const saved = process.env.CROSSX_DB_ENCRYPTION_KEY;
    process.env.CROSSX_DB_ENCRYPTION_KEY = "test-encryption-key-32-bytes-abc";
    const plain = "plaintext-not-encrypted";
    const result = dec(plain);
    process.env.CROSSX_DB_ENCRYPTION_KEY = saved || "";
    _resetKeyCache();
    assert.equal(result, plain);
  });

  test("encJson + decJson round-trip for objects", () => {
    _resetKeyCache();
    const saved = process.env.CROSSX_DB_ENCRYPTION_KEY;
    process.env.CROSSX_DB_ENCRYPTION_KEY = "test-encryption-key-32-bytes-abc";
    const obj = { lat: 31.23, lng: 121.47, accuracy: 10 };
    const stored = encJson(obj);
    const recovered = decJson(stored);
    process.env.CROSSX_DB_ENCRYPTION_KEY = saved || "";
    _resetKeyCache();
    assert.deepEqual(recovered, obj);
  });

  test("enc returns plaintext when no key set (dev mode)", () => {
    _resetKeyCache();
    const saved = process.env.CROSSX_DB_ENCRYPTION_KEY;
    delete process.env.CROSSX_DB_ENCRYPTION_KEY;
    const result = enc("my data");
    if (saved) process.env.CROSSX_DB_ENCRYPTION_KEY = saved;
    _resetKeyCache();
    // In dev mode, returns plaintext
    assert.equal(result, "my data");
  });
});
