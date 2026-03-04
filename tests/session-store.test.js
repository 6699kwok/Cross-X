"use strict";
const { test } = require("node:test");
const assert   = require("node:assert/strict");
const {
  createSession, getSession, setSession, patchSession, deleteSession, scrubPii,
} = require("../src/session/store");

test("createSession returns a cxs_ prefixed unique ID", () => {
  const a = createSession({});
  const b = createSession({});
  assert.ok(a.startsWith("cxs_"), `expected cxs_ prefix, got ${a}`);
  assert.notEqual(a, b);
});

test("getSession returns initial data", () => {
  const id = createSession({ foo: "bar", n: 42 });
  assert.deepEqual(getSession(id), { foo: "bar", n: 42 });
});

test("setSession replaces data", () => {
  const id = createSession({ a: 1 });
  setSession(id, { b: 2 });
  assert.deepEqual(getSession(id), { b: 2 });
});

test("patchSession merges into existing data", () => {
  const id = createSession({ a: 1 });
  patchSession(id, { b: 2 });
  assert.deepEqual(getSession(id), { a: 1, b: 2 });
});

test("patchSession overwrites a key", () => {
  const id = createSession({ x: "old" });
  patchSession(id, { x: "new" });
  assert.equal(getSession(id).x, "new");
});

test("deleteSession removes the entry", () => {
  const id = createSession({ z: true });
  deleteSession(id);
  assert.equal(getSession(id), null);
});

test("getSession returns null for unknown ID", () => {
  assert.equal(getSession("cxs_doesnotexist"), null);
});

test("getSession returns null after TTL expires", () => {
  const id = createSession({ ttlTest: true }, 1); // 1 ms TTL
  return new Promise((resolve) => setTimeout(resolve, 10)).then(() => {
    assert.equal(getSession(id), null);
  });
});

test("scrubPii — Chinese mobile phone", () => {
  assert.equal(scrubPii("请联系 13812345678 预约"), "请联系 [PHONE] 预约");
});

test("scrubPii — email", () => {
  assert.equal(scrubPii("send to user@example.com please"), "send to [EMAIL] please");
});

test("scrubPii — credit card (spaced)", () => {
  assert.equal(scrubPii("card 4111 1111 1111 1111 ok"), "card [CARD] ok");
});

test("scrubPii — non-PII text unchanged", () => {
  const s = "Shanghai 3 nights hotel budget 2000";
  assert.equal(scrubPii(s), s);
});

test("scrubPii — non-string passthrough", () => {
  assert.equal(scrubPii(null), null);
  assert.equal(scrubPii(42), 42);
});
