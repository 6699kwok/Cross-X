"use strict";
const { test } = require("node:test");
const assert   = require("node:assert/strict");
const { applyMetadataFilter } = require("../lib/rag/engine");

const docs = [
  { id: 1, metadata: { audience: "b2c", language: "ZH", source_country: "CN", category: "food" } },
  { id: 2, metadata: { audience: "b2b", language: "ZH", source_country: "CN", category: "hotel" } },
  { id: 3, metadata: { audience: "b2c", language: "EN", source_country: "US", category: "food" } },
  { id: 4, metadata: { audience: "b2c", language: "ZH", source_country: "JP", category: "transport" } },
];

test("no filter returns all docs", () => {
  assert.equal(applyMetadataFilter(docs, {}).length, 4);
});

test("audience b2c excludes b2b", () => {
  const r = applyMetadataFilter(docs, { audience: "b2c" });
  assert.ok(r.every(d => d.metadata.audience === "b2c"));
  assert.equal(r.length, 3);
});

test("audience b2b returns only b2b docs", () => {
  const r = applyMetadataFilter(docs, { audience: "b2b" });
  assert.equal(r.length, 1);
  assert.equal(r[0].id, 2);
});

test("language filter — ZH", () => {
  const r = applyMetadataFilter(docs, { language: "ZH" });
  assert.ok(r.every(d => d.metadata.language === "ZH"));
  assert.equal(r.length, 3);
});

test("language filter — EN", () => {
  const r = applyMetadataFilter(docs, { language: "EN" });
  assert.equal(r.length, 1);
  assert.equal(r[0].id, 3);
});

test("source_country filter", () => {
  const r = applyMetadataFilter(docs, { source_country: "JP" });
  assert.equal(r.length, 1);
  assert.equal(r[0].id, 4);
});

test("combined filters: b2c + ZH + CN", () => {
  const r = applyMetadataFilter(docs, { audience: "b2c", language: "ZH", source_country: "CN" });
  assert.equal(r.length, 1);
  assert.equal(r[0].id, 1);
});

test("filter returning empty set", () => {
  const r = applyMetadataFilter(docs, { source_country: "DE" });
  assert.equal(r.length, 0);
});

test("empty docs array returns empty", () => {
  assert.equal(applyMetadataFilter([], { audience: "b2c" }).length, 0);
});
