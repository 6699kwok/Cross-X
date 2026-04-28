"use strict";

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");

const { _test } = require("../src/routes/plan");

const pickLang = (language, zh, en, ja, ko) => {
  const lang = String(language || "ZH").toUpperCase();
  if (lang === "EN") return en;
  if (lang === "JA") return ja;
  if (lang === "KO") return ko;
  return zh;
};

describe("plan live rail transport wiring", () => {
  test("prefers live rail inventory and marks it live when provider returns seats", async () => {
    const result = await _test.buildLiveIntercityTransport({
      originCity: "Beijing",
      destinationCity: "Shanghai",
      date: "2026-05-01",
      language: "EN",
      pickLang,
      queryJuheFlight: async () => ({ flights: [], availability: { status: "no_results", code: "none", reason: "no_results" } }),
      queryRailAvailability: async () => ({
        enabled: true,
        items: [{
          type: "hsr",
          label: "G7 High-speed rail",
          trainNo: "G7",
          fromStation: "北京南站",
          toStation: "上海虹桥站",
          depTime: "09:00",
          arrTime: "13:28",
          durationMin: 268,
          priceCny: 553,
          seatsLeft: 12,
          seatLabel: "Second class",
          bookingUrl: "https://kyfw.12306.cn/otn/leftTicket/init",
          providerSource: "partner_hub",
        }],
      }),
      mockAmapRouting: async () => ({
        modes: [{ type: "hsr", label: "High-speed rail", duration_min: 300, price_cny: 560, freq: "每日多班", _source: "amap_live" }],
        recommended: "hsr",
        _source: "amap_live",
      }),
    });

    assert.equal(result.mode, "hsr");
    assert.equal(result.inventory_status, "live_or_verified");
    assert.equal(result.verification_required, false);
    assert.equal(result.source.rail, "partner_hub_rail_live");
    assert.match(result.tip, /live inventory source/i);
    assert.ok(Array.isArray(result.route_options));
    assert.equal(result.route_options[0].inventory_status, "live_or_verified");
  });

  test("fallback rail still requires 12306 self-check when no live rail provider data exists", async () => {
    const result = await _test.buildLiveIntercityTransport({
      originCity: "Beijing",
      destinationCity: "Shanghai",
      date: "2026-05-01",
      language: "EN",
      pickLang,
      queryJuheFlight: async () => ({ flights: [], availability: { status: "no_results", code: "none", reason: "no_results" } }),
      queryRailAvailability: async () => ({ enabled: false, items: [] }),
      mockAmapRouting: async () => ({
        modes: [{
          type: "hsr",
          label: "High-speed rail",
          duration_min: 300,
          price_cny: 560,
          freq: "每日多班",
          from_station: "北京南站",
          to_station: "上海虹桥站",
          _source: "amap_live",
        }],
        recommended: "hsr",
        _source: "amap_live",
      }),
    });

    assert.equal(result.mode, "hsr");
    assert.equal(result.inventory_status, "user_check_required");
    assert.equal(result.verification_required, true);
    assert.match(result.verification_label, /12306/i);
    assert.match(result.tip, /12306/i);
  });
});
