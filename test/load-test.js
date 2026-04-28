/**
 * CT-07/P3-04: CrossX k6 Load Test Script
 *
 * Usage:
 *   k6 run test/load-test.js                              # default: 50 VU, 5min
 *   k6 run --vus 100 --duration 10m test/load-test.js    # custom
 *   k6 run --out influxdb=http://localhost:8086/k6 test/load-test.js  # Grafana output
 *
 * Install k6: brew install k6
 * Docs: https://k6.io/docs/
 *
 * Test scenarios:
 *   1. Health check (sanity, fast)
 *   2. Agent plan request (main load test)
 *   3. Static file serving
 *   4. Training stats API
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";

// ── SLO definitions (from GG-02 recommendations) ───────────────────────────
export const options = {
  scenarios: {
    // Smoke test: 1 VU, 1min — verify system works
    smoke: {
      executor: "constant-vus",
      vus: 1,
      duration: "1m",
      tags: { scenario: "smoke" },
      startTime: "0s",
    },
    // Load test: ramp up to 50 VU over 2min, hold for 3min, ramp down
    load: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "2m", target: 50 },   // ramp up
        { duration: "3m", target: 50 },   // hold
        { duration: "1m", target: 0  },   // ramp down
      ],
      tags: { scenario: "load" },
      startTime: "1m", // start after smoke
    },
    // Spike test: sudden burst
    spike: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 200 }, // sudden spike
        { duration: "1m",  target: 200 }, // hold
        { duration: "30s", target: 0   }, // drop
      ],
      tags: { scenario: "spike" },
      startTime: "8m", // after load test
    },
  },
  thresholds: {
    // SLO: 95th percentile latency < 30s for plan requests
    "http_req_duration{endpoint:plan}": ["p(95)<30000"],
    // SLO: error rate < 1% for all requests
    "http_req_failed": ["rate<0.01"],
    // SLO: healthz endpoint < 500ms always
    "http_req_duration{endpoint:health}": ["p(99)<500"],
    // SLO: static files < 2s
    "http_req_duration{endpoint:static}": ["p(95)<2000"],
  },
};

// ── Custom metrics ────────────────────────────────────────────────────────
const planErrors  = new Counter("plan_errors");
const planSuccess = new Counter("plan_success");
const planLatency = new Trend("plan_latency_ms", true);

// ── Test data ─────────────────────────────────────────────────────────────
const BASE_URL = __ENV.BASE_URL || "http://localhost:8787";

const PLAN_REQUESTS = [
  { message: "帮我规划上海3天旅游", language: "ZH", city: "上海" },
  { message: "成都美食之旅，2天1晚", language: "ZH", city: "成都" },
  { message: "Plan a 3-day trip to Beijing", language: "EN", city: "Beijing" },
  { message: "杭州西湖周边，带小孩出行", language: "ZH", city: "杭州" },
  { message: "三亚海边度假，情侣，预算5000", language: "ZH", city: "三亚" },
];

// ── Test scenarios ────────────────────────────────────────────────────────

export default function () {
  const scenario = __VU % 3; // rotate between test types

  if (scenario === 0) {
    testHealthCheck();
  } else if (scenario === 1) {
    testPlanRequest();
  } else {
    testStaticFile();
  }

  sleep(1);
}

function testHealthCheck() {
  const res = http.get(`${BASE_URL}/healthz`, { tags: { endpoint: "health" } });
  check(res, {
    "health: status 200":     (r) => r.status === 200,
    "health: has ok field":   (r) => { try { return JSON.parse(r.body).ok === true; } catch { return false; } },
  });
}

function testPlanRequest() {
  const req = PLAN_REQUESTS[Math.floor(Math.random() * PLAN_REQUESTS.length)];
  const payload = JSON.stringify({
    message:             req.message,
    language:            req.language,
    city:                req.city,
    constraints:         { duration_days: 3, party_size: 2 },
    conversationHistory: [],
  });

  const start = Date.now();
  // Note: Agent plan uses SSE — test the non-streaming endpoint for load testing
  const res = http.post(
    `${BASE_URL}/api/chat/reply`,
    payload,
    {
      headers: { "Content-Type": "application/json", "X-Device-Id": `load_test_${__VU}` },
      tags: { endpoint: "plan" },
      timeout: "35s",
    }
  );
  const elapsed = Date.now() - start;
  planLatency.add(elapsed);

  const ok = check(res, {
    "plan: status 200":      (r) => r.status === 200,
    "plan: has reply field": (r) => { try { const b = JSON.parse(r.body); return !!b.reply || !!b.structured; } catch { return false; } },
    "plan: no error":        (r) => { try { return !JSON.parse(r.body).error; } catch { return false; } },
  });

  if (ok) planSuccess.add(1);
  else    planErrors.add(1);
}

function testStaticFile() {
  const res = http.get(`${BASE_URL}/app.js`, { tags: { endpoint: "static" } });
  check(res, {
    "static: status 200": (r) => r.status === 200,
    "static: has content": (r) => r.body.length > 100,
  });
}

// ── Teardown: print summary ────────────────────────────────────────────────
export function handleSummary(data) {
  return {
    "test/load-results.json": JSON.stringify(data, null, 2),
    stdout: `
=== CrossX Load Test Summary ===
Total requests:  ${data.metrics.http_reqs?.values.count || 0}
Error rate:      ${((data.metrics.http_req_failed?.values.rate || 0) * 100).toFixed(2)}%
Plan P95 (ms):   ${data.metrics["http_req_duration{endpoint:plan}"]?.values["p(95)"]?.toFixed(0) || "N/A"}
Health P99 (ms): ${data.metrics["http_req_duration{endpoint:health}"]?.values["p(99)"]?.toFixed(0) || "N/A"}
================================
`,
  };
}
