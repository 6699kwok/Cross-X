"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const { createPartnerHubConnector } = require("../lib/connectors/partner_hub");

async function withEnv(patch, fn) {
  const keys = Object.keys(patch);
  const snapshot = new Map(keys.map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === null) delete process.env[key];
      else process.env[key] = value;
    }
    return await fn();
  } finally {
    for (const key of keys) {
      const value = snapshot.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("Candidate Fallback Guards", () => {
  test("partner hub candidate search fails closed in key-only mode when local fallback is disabled", { concurrency: false }, async () => {
    await withEnv({
      CROSSX_ALLOW_LOCAL_CANDIDATE_FALLBACK: undefined,
      PUBLIC_MODE: undefined,
      APP_BASE_URL: undefined,
      PUBLIC_APP_BASE_URL: undefined,
    }, async () => {
      const connector = createPartnerHubConnector({ key: "partner-key", baseUrl: "" });
      const result = await connector.searchCandidates({ vertical: "eat", city: "Shanghai", query: "dumpling", limit: 4 });

      assert.equal(result.enabled, false);
      assert.equal(result.errorCode, "candidate_provider_not_configured");
      assert.equal(result.mode, "unavailable");
      assert.deepEqual(result.items, []);
    });
  });

  test("partner hub candidate search allows local fallback only when explicit flag is enabled", { concurrency: false }, async () => {
    await withEnv({
      CROSSX_ALLOW_LOCAL_CANDIDATE_FALLBACK: "1",
      PUBLIC_MODE: undefined,
      APP_BASE_URL: undefined,
      PUBLIC_APP_BASE_URL: undefined,
    }, async () => {
      const connector = createPartnerHubConnector({ key: "partner-key", baseUrl: "" });
      const result = await connector.searchCandidates({ vertical: "travel", city: "Shanghai", query: "airport", limit: 4 });

      assert.equal(result.enabled, true);
      assert.equal(result.mode, "mock");
      assert.ok(Array.isArray(result.items) && result.items.length > 0);
    });
  });

  test("partner hub candidate search ignores local fallback for public runtime", { concurrency: false }, async () => {
    await withEnv({
      CROSSX_ALLOW_LOCAL_CANDIDATE_FALLBACK: "1",
      PUBLIC_MODE: "1",
      APP_BASE_URL: "https://crossx.example.com",
      PUBLIC_APP_BASE_URL: undefined,
    }, async () => {
      const connector = createPartnerHubConnector({ key: "partner-key", baseUrl: "" });
      const result = await connector.searchCandidates({ vertical: "eat", city: "Shanghai", query: "dumpling", limit: 4 });

      assert.equal(result.enabled, false);
      assert.equal(result.errorCode, "candidate_provider_not_configured");
      assert.deepEqual(result.items, []);
    });
  });

  test("rail availability uses dedicated RAIL_* provider config and returns normalized live inventory", { concurrency: false }, async () => {
    await withEnv({
      RAIL_KEY: "rail-live-key",
      RAIL_BASE_URL: "https://rail.example.com",
      RAIL_PROVIDER: "railmax",
      RAIL_CHANNELS: "rail,inventory",
      RAIL_TIMEOUT_MS: "3200",
      PARTNER_HUB_KEY: undefined,
      PARTNER_HUB_BASE_URL: undefined,
      PARTNER_HUB_PROVIDER: undefined,
      PARTNER_HUB_CHANNELS: undefined,
      PARTNER_HUB_TIMEOUT_MS: undefined,
    }, async () => {
      const connector = createPartnerHubConnector({});
      const originalFetch = global.fetch;
      global.fetch = async (url, options = {}) => {
        assert.equal(url, "https://rail.example.com/transport/rail-availability");
        assert.equal(options.headers.Authorization, "Bearer rail-live-key");
        assert.equal(options.headers["X-CrossX-Provider"], "railmax");
        assert.equal(options.headers["X-Partner-Channels"], "rail,inventory");
        return {
          ok: true,
          async json() {
            return {
              data: {
                items: [{
                  type: "hsr",
                  trainNo: "G88",
                  fromStation: "北京南站",
                  toStation: "上海虹桥站",
                  depTime: "09:00",
                  arrTime: "13:28",
                  durationMin: 268,
                  priceCny: 553,
                  seatsLeft: 9,
                  seatLabel: "Second class",
                  bookingUrl: "https://rail.example.com/book/G88",
                }],
                inventorySource: "railmax_rail_live",
              },
            };
          },
        };
      };
      try {
        const result = await connector.railAvailability({ origin: "Beijing", destination: "Shanghai", date: "2026-05-01", language: "EN" });
        assert.equal(result.enabled, true);
        assert.equal(result.providerSource, "railmax");
        assert.equal(result.inventorySource, "railmax_rail_live");
        assert.equal(result.items.length, 1);
        assert.equal(result.items[0].trainNo, "G88");
        assert.equal(result.items[0].providerSource, "railmax");
        assert.equal(connector.railEnabled, true);
        assert.equal(connector.railBaseUrl, "https://rail.example.com");
        assert.equal(connector.liveRailInventorySource, "railmax_rail_live");
      } finally {
        global.fetch = originalFetch;
      }
    });
  });
});

test("rail availability falls back to builtin 12306 live query when no external rail provider is configured", { concurrency: false }, async () => {
  await withEnv({
    RAIL_KEY: undefined,
    RAIL_BASE_URL: undefined,
    RAIL_PROVIDER: undefined,
    RAIL_CHANNELS: undefined,
    RAIL_TIMEOUT_MS: undefined,
    PARTNER_HUB_KEY: undefined,
    PARTNER_HUB_BASE_URL: undefined,
    PARTNER_HUB_PROVIDER: undefined,
    PARTNER_HUB_CHANNELS: undefined,
    PARTNER_HUB_TIMEOUT_MS: undefined,
  }, async () => {
    const connector = createPartnerHubConnector({});
    const originalFetch = global.fetch;
    global.fetch = async (url) => {
      if (String(url).includes("station_name.js")) {
        return {
          ok: true,
          async text() {
            return "var station_names ='@bjn|北京南|VNP|beijingnan|bjn|0@shhq|上海虹桥|AOH|shanghaihongqiao|shhq|0';";
          },
        };
      }
      if (String(url).includes("leftTicket/query")) {
        return {
          ok: true,
          async json() {
            return {
              data: {
                result: [
                  [
                    "secret", "pre", "240000G1010A", "G101", "start", "end",
                    "北京南", "上海虹桥", "09:00", "13:28", "04:28", "Y", "x", "x", "x", "x", "x", "01", "02", "03", "04",
                    "5", "06", "7", "8", "9", "10", "11", "12", "13", "14", "6", "3"
                  ].join("|"),
                ],
              },
            };
          },
        };
      }
      throw new Error("unexpected url " + String(url));
    };
    try {
      const result = await connector.railAvailability({ origin: "Beijing", destination: "Shanghai", date: "2026-05-01", language: "EN" });
      assert.equal(result.enabled, true);
      assert.equal(result.providerSource, "builtin_12306");
      assert.equal(result.inventorySource, "builtin_12306_rail_live");
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0].trainNo, "G101");
      assert.equal(result.items[0].type, "hsr");
      assert.equal(result.items[0].seatLabel, "Business class");
      assert.equal(result.items[0].seatsLeft, 3);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
