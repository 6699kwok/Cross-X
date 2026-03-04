"use strict";
const { test } = require("node:test");
const assert   = require("node:assert/strict");
const { loadProfile, saveProfile } = require("../src/session/profile");

// Use unique device IDs per test to avoid cross-test contamination
function uid() {
  return "cx_" + Math.random().toString(16).slice(2).padEnd(32, "0").slice(0, 32);
}

test("loadProfile returns null for unknown deviceId", () => {
  assert.equal(loadProfile("cx_" + "0".repeat(32)), null);
});

test("loadProfile returns null when no deviceId", () => {
  assert.equal(loadProfile(null), null);
  assert.equal(loadProfile(""), null);
});

test("saveProfile creates a new profile that loadProfile reads back", () => {
  const id = uid();
  saveProfile(id, { luxury: true }, "Tokyo");
  const p = loadProfile(id);
  assert.ok(p !== null, "profile should exist after save");
  assert.equal(p.preferences.luxury, true);
  assert.ok(p.cities.includes("Tokyo"));
  assert.equal(p.tripCount, 1);
});

test("saveProfile bumps tripCount on each call", () => {
  const id = uid();
  saveProfile(id, {}, null);
  saveProfile(id, {}, null);
  saveProfile(id, {}, null);
  assert.equal(loadProfile(id).tripCount, 3);
});

test("saveProfile merges preferences across trips", () => {
  const id = uid();
  saveProfile(id, { veg: true }, null);
  saveProfile(id, { luxury: true }, null);
  const p = loadProfile(id);
  assert.equal(p.preferences.veg, true);
  assert.equal(p.preferences.luxury, true);
});

test("saveProfile clears preference when false is passed (bidirectional merge)", () => {
  const id = uid();
  saveProfile(id, { veg: true }, null);          // trip 1: veg = true
  saveProfile(id, { veg: false }, null);         // trip 2: explicit opt-out
  const p = loadProfile(id);
  assert.equal(p.preferences.veg, false, "false should override previous true");
});

test("city list deduplicates across saves", () => {
  const id = uid();
  saveProfile(id, {}, "Paris");
  saveProfile(id, {}, "Paris");
  saveProfile(id, {}, "London");
  const p = loadProfile(id);
  assert.equal(p.cities.filter(c => c === "Paris").length, 1, "Paris should appear once");
  assert.ok(p.cities.includes("London"));
});

test("profileSummary is stored when provided", () => {
  const id = uid();
  saveProfile(id, {}, null, "品质旅行达人");
  assert.equal(loadProfile(id).profileSummary, "品质旅行达人");
});

test("existing profileSummary preserved when null passed", () => {
  const id = uid();
  saveProfile(id, {}, null, "original summary");
  saveProfile(id, {}, null, null);  // null means: don't overwrite
  assert.equal(loadProfile(id).profileSummary, "original summary");
});
