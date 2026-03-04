"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

// Patch setTimeout to be instantaneous so backoff delays don't slow tests
let _origTimeout;
before(() => {
  _origTimeout = global.setTimeout;
  global.setTimeout = (fn) => { fn(); return 0; };
});
after(() => { global.setTimeout = _origTimeout; });

// Fresh require each test to pick up the patched setTimeout
const { openAIRequest } = require("../src/ai/openai");

test("openAIRequest succeeds on first attempt", async () => {
  let calls = 0;
  global.fetch = async () => {
    calls++;
    return {
      ok: true,
      text: async () => JSON.stringify({
        choices: [{ message: { content: "hello" }, finish_reason: "stop" }],
      }),
    };
  };
  const r = await openAIRequest({ apiKey: "k", systemPrompt: "s", userContent: "u" });
  assert.equal(r.ok, true);
  assert.equal(r.text, "hello");
  assert.equal(calls, 1);
});

test("openAIRequest retries 3 times on 429", async () => {
  let calls = 0;
  global.fetch = async () => { calls++; return { ok: false, status: 429 }; };
  const r = await openAIRequest({ apiKey: "k", systemPrompt: "s", userContent: "u" });
  assert.equal(r.ok, false);
  assert.equal(calls, 3, `expected 3 attempts (OPENAI_MAX_RETRIES), got ${calls}`);
});

test("openAIRequest does NOT retry on 400", async () => {
  let calls = 0;
  global.fetch = async () => { calls++; return { ok: false, status: 400 }; };
  await openAIRequest({ apiKey: "k", systemPrompt: "s", userContent: "u" });
  assert.equal(calls, 1, "400 is not retryable");
});

test("openAIRequest succeeds on 2nd attempt after 429", async () => {
  let calls = 0;
  global.fetch = async () => {
    calls++;
    if (calls === 1) return { ok: false, status: 429 };
    return {
      ok: true,
      text: async () => JSON.stringify({
        choices: [{ message: { content: "retry ok" }, finish_reason: "stop" }],
      }),
    };
  };
  const r = await openAIRequest({ apiKey: "k", systemPrompt: "s", userContent: "u" });
  assert.equal(r.ok, true);
  assert.equal(r.text, "retry ok");
  assert.equal(calls, 2);
});

test("openAIRequest does NOT retry on network/timeout error", async () => {
  let calls = 0;
  global.fetch = async () => { calls++; throw Object.assign(new Error("net"), { name: "TimeoutError" }); };
  const r = await openAIRequest({ apiKey: "k", systemPrompt: "s", userContent: "u" });
  assert.equal(r.ok, false);
  assert.equal(calls, 1, "timeout errors should not be retried");
});
