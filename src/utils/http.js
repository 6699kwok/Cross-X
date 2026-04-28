"use strict";
/**
 * src/utils/http.js
 * Shared HTTP primitives for all controllers.
 * No imports from services/ or controllers/ — Level 0 utility.
 */

const BODY_LIMIT = 1_000_000; // 1 MB

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk.toString("utf8");
      if (data.length > BODY_LIMIT) reject(new Error("Payload too large"));
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); }
      catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

const RAW_BODY_LIMIT = 10 * 1024 * 1024; // 10 MB

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let len = 0;
    req.on("data", (d) => {
      len += d.length;
      if (len > RAW_BODY_LIMIT) {
        req.destroy();
        return reject(Object.assign(new Error("Request body too large"), { code: "PAYLOAD_TOO_LARGE" }));
      }
      chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d));
    });
    req.on("end",   () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function writeJson(res, statusCode, payload, buildId = "") {
  const body = JSON.stringify(payload);
  const headers = {
    "Content-Type":   "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  };
  if (buildId) headers["X-CrossX-Build"] = buildId;
  res.writeHead(statusCode, headers);
  res.end(body);
}

module.exports = { readBody, readRawBody, writeJson };
