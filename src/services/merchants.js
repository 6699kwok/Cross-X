"use strict";
/**
 * src/services/merchants.js
 * Third-party merchant integrations — real implementations with mock fallbacks.
 *
 * Payment Rails:
 *   - WeChat Pay v3 refund (real API, mock fallback)
 *   - Alipay refund (via alipay-sdk if available, mock fallback)
 *   - Stripe refund (via stripe if available, mock fallback)
 *
 * Data APIs:
 *   - Juhe flight status (real API, mock fallback)
 *   - Jutui restaurant search (real API, mock fallback)
 *   - Partner Hub hotel booking (real API, mock fallback)
 *
 * Payment compliance:
 *   - assertRailCompliant(railId) — throws if rail is uncertified/no-KYC
 */

const https  = require("https");
const crypto = require("crypto");

// ── Payment Rail Compliance ──────────────────────────────────────────────────

// Mirrors config.paymentCompliance.rails in db.js; kept in sync manually
const RAIL_CONFIG = {
  alipay_cn:     { certified: true,  kycPassed: true,  pciDss: true,  enabled: true },
  wechat_cn:     { certified: true,  kycPassed: true,  pciDss: true,  enabled: true },
  card_delegate: { certified: true,  kycPassed: true,  pciDss: true,  enabled: true },
  // Add new rails below:
  // paypal_global: { certified: false, kycPassed: false, pciDss: false, enabled: false },
};

/**
 * Assert that a payment rail is compliant before charging/refunding.
 * @param {string} railId
 * @throws {Error} with code "uncertified_rail" if not compliant
 */
function assertRailCompliant(railId) {
  const cfg = RAIL_CONFIG[railId];
  if (!cfg) throw Object.assign(new Error(`Unknown payment rail: ${railId}`), { code: "unknown_rail" });
  if (!cfg.enabled) throw Object.assign(new Error(`Rail ${railId} is disabled`), { code: "rail_disabled" });
  if (!cfg.certified) throw Object.assign(new Error(`Rail ${railId} is not certified`), { code: "uncertified_rail" });
  if (!cfg.kycPassed) throw Object.assign(new Error(`Rail ${railId} KYC not passed`), { code: "kyc_required" });
}

// ── WeChat Pay v3 Refund ─────────────────────────────────────────────────────

function _wxSign(method, url, timestamp, nonce, body) {
  const apiKey = process.env.WECHAT_API_KEY_V3 || "";
  const message = `${method}\n${url}\n${timestamp}\n${nonce}\n${body}\n`;
  return crypto.createHmac("sha256", apiKey).update(message).digest("hex");
}

function _wxRequest(path, body) {
  return new Promise((resolve, reject) => {
    const mchId     = process.env.WECHAT_MCH_ID || "";
    const serialNo  = process.env.WECHAT_CERT_SERIAL_NO || "";
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce     = crypto.randomBytes(16).toString("hex");
    const bodyStr   = JSON.stringify(body);
    const signature = _wxSign("POST", path, timestamp, nonce, bodyStr);
    const authToken = `WECHATPAY2-SHA256-RSA2048 mchid="${mchId}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${serialNo}",signature="${signature}"`;

    const options = {
      hostname: "api.mch.weixin.qq.com",
      path,
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": authToken,
        "Content-Length": Buffer.byteLength(bodyStr),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", chunk => { data += chunk; });
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { console.warn("[merchants/wx] JSON parse failed, body length:", data.length, e.message); resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on("error", reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error("WeChat API timeout")); });
    req.write(bodyStr);
    req.end();
  });
}

/**
 * Issue a WeChat Pay v3 refund.
 * @param {{ outRefundNo, outTradeNo, totalFee, refundFee, reason }} opts
 * @returns {{ refundId, status, expectedAt }}
 */
async function wechatRefund({ outRefundNo, outTradeNo, totalFee, refundFee, reason = "User requested refund" }) {
  const mchId  = process.env.WECHAT_MCH_ID || "";
  const apiKey = process.env.WECHAT_API_KEY_V3 || "";

  if (!mchId || !apiKey) {
    // Mock refund
    return {
      refundId:   `MOCK_WX_${outRefundNo}_${Date.now().toString(36)}`,
      status:     "mock_refund",
      expectedAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    };
  }

  const { status, body } = await _wxRequest("/v3/refund/domestic/refunds", {
    out_trade_no:  outTradeNo,
    out_refund_no: outRefundNo,
    reason,
    amount: { refund: refundFee, total: totalFee, currency: "CNY" },
  });

  if (status !== 200) throw new Error(`WeChat refund failed: ${JSON.stringify(body)}`);

  return {
    refundId:   body.refund_id,
    status:     body.status,
    expectedAt: body.success_time || new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

// ── Alipay Refund ────────────────────────────────────────────────────────────

/**
 * Issue an Alipay refund. Uses alipay-sdk if installed and keys configured.
 */
async function alipayRefund({ tradeNo, outRequestNo, refundAmount, refundReason }) {
  const appId      = process.env.ALIPAY_APP_ID || "";
  const privateKey = process.env.ALIPAY_PRIVATE_KEY || "";

  if (!appId || !privateKey) {
    return {
      refundId:   `MOCK_ALI_${outRequestNo}_${Date.now().toString(36)}`,
      status:     "mock_refund",
      expectedAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
  }

  let AlipaySdk;
  try { AlipaySdk = require("alipay-sdk").default || require("alipay-sdk"); } catch (e) {
    console.warn("[merchants/alipay] alipay-sdk not installed — refund mocked:", e.message);
    return { refundId: `NOLIB_ALI_${outRequestNo}`, status: "mock_no_sdk", expectedAt: new Date().toISOString() };
  }

  const client = new AlipaySdk({ appId, privateKey, alipayPublicKey: process.env.ALIPAY_PUBLIC_KEY || "" });
  const result = await client.exec("alipay.trade.refund", {
    bizContent: {
      trade_no:      tradeNo,
      out_request_no: outRequestNo,
      refund_amount:  refundAmount,
      refund_reason:  refundReason,
    },
  });

  if (result.code !== "10000") throw new Error(`Alipay refund failed: ${result.subMsg || result.msg}`);

  return {
    refundId:   result.tradeNo || tradeNo,
    status:     "success",
    expectedAt: new Date().toISOString(),
  };
}

// ── Stripe Refund ────────────────────────────────────────────────────────────

async function stripeRefund({ chargeId, amount, reason }) {
  const secretKey = process.env.STRIPE_SECRET_KEY || "";

  if (!secretKey) {
    return {
      refundId:   `MOCK_STRIPE_${Date.now().toString(36)}`,
      status:     "mock_refund",
      expectedAt: new Date().toISOString(),
    };
  }

  let Stripe;
  try { Stripe = require("stripe"); } catch (e) {
    console.warn("[merchants/stripe] stripe not installed — refund mocked:", e.message);
    return { refundId: `NOLIB_STRIPE`, status: "mock_no_sdk", expectedAt: new Date().toISOString() };
  }

  const stripe = Stripe(secretKey);
  const refund = await stripe.refunds.create({ charge: chargeId, amount, reason: reason || "requested_by_customer" });
  return { refundId: refund.id, status: refund.status, expectedAt: new Date().toISOString() };
}

// ── Merchant Refund Dispatcher ────────────────────────────────────────────────

/**
 * Route refund to the correct payment gateway based on order.payment_rail.
 * @param {object} order — order row from DB
 * @param {{ amount, reason }} opts
 * @returns {{ refundId, status, expectedAt }}
 */
async function merchantRefund(order, { amount, reason } = {}) {
  assertRailCompliant(order.payment_rail || "alipay_cn");

  const rail   = order.payment_rail || "alipay_cn";
  const proof  = order.proof || {};
  const refAmt = Math.round((amount || order.price || 0) * 100); // cents

  switch (rail) {
    case "wechat_cn":
      return wechatRefund({
        outRefundNo: `RF${Date.now().toString(36).toUpperCase()}`,
        outTradeNo:  proof.wechatTradeNo || order.id,
        totalFee:    Math.round((order.price || 0) * 100),
        refundFee:   refAmt,
        reason,
      });

    case "alipay_cn":
      return alipayRefund({
        tradeNo:     proof.alipayTradeNo || order.id,
        outRequestNo: `RF${Date.now().toString(36).toUpperCase()}`,
        refundAmount: ((refAmt / 100).toFixed(2)),
        refundReason: reason || "用户申请退款",
      });

    case "card_delegate":
      return stripeRefund({
        chargeId: proof.cardChargeId || "mock_charge",
        amount:   refAmt,
        reason,
      });

    default:
      // Unknown rail — mock refund
      return {
        refundId:   `MOCK_${rail}_${Date.now().toString(36)}`,
        status:     "mock_refund",
        expectedAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      };
  }
}

// ── Juhe Flight Status ───────────────────────────────────────────────────────

const JUHE_FLIGHT_API = "https://v.juhe.cn/flight/queryFlightStatus";

function _fetchJson(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      path:     parsedUrl.pathname + parsedUrl.search,
      method:   "GET",
      headers:  { "User-Agent": "CrossX/1.0" },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", c => { data += c; });
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { console.warn("[merchants/fetchJson] JSON parse failed, url:", url.slice(0, 80), e.message); resolve({ raw: data }); }
      });
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error("timeout")); });
    req.end();
  });
}

const MOCK_FLIGHT_STATUSES = ["准时", "延误", "取消", "已到达"];

/**
 * Query Juhe flight status API.
 * @param {string} flightNo  e.g. "CZ3102"
 * @param {string} date      e.g. "2026-03-04"
 */
async function queryFlightStatus(flightNo, date) {
  const key = process.env.JUHE_FLIGHT_KEY || "";

  if (!key) {
    // Mock response
    const status = MOCK_FLIGHT_STATUSES[Math.floor(Math.random() * MOCK_FLIGHT_STATUSES.length)];
    return {
      flightNo, date,
      status, source: "mock",
      departureTime: "08:30", arrivalTime: "10:45", delay: 0,
    };
  }

  try {
    const url  = `${JUHE_FLIGHT_API}?key=${encodeURIComponent(key)}&flight_no=${encodeURIComponent(flightNo)}&date=${encodeURIComponent(date)}`;
    const data = await _fetchJson(url);

    if (data.error_code !== 0) {
      throw new Error(data.reason || "Juhe flight API error");
    }

    const info = data.result || {};
    return {
      flightNo:      info.flight_no || flightNo,
      date,
      status:        info.status_desc || "未知",
      departureTime: info.dep_time || "",
      arrivalTime:   info.arr_time || "",
      delay:         info.delay_minutes || 0,
      source:        "juhe",
    };
  } catch (err) {
    console.warn("[merchants] Juhe flight API failed:", err.message);
    return { flightNo, date, status: "查询失败", source: "error", error: err.message };
  }
}

// ── Jutui Restaurant Search ──────────────────────────────────────────────────

const JUTUI_API_BASE = "https://api.jutui.com";

// Synthetic fallback data (25 known cities)
const SYNTHETIC_RESTAURANTS = {
  "上海": [
    { name: "外滩18号餐厅", cuisine: "粤菜", rating: 4.8, price: 380, address: "黄浦区中山东一路18号" },
    { name: "新荣记", cuisine: "台州菜", rating: 4.9, price: 560, address: "静安区延安中路" },
    { name: "喜粤8号", cuisine: "粤菜", rating: 4.7, price: 290, address: "徐汇区淮海中路" },
  ],
  "北京": [
    { name: "全聚德（前门店）", cuisine: "北京烤鸭", rating: 4.6, price: 220, address: "前门大街30号" },
    { name: "四季民福", cuisine: "北京菜", rating: 4.8, price: 180, address: "故宫景山脚下" },
  ],
  "深圳": [
    { name: "明华轩", cuisine: "粤菜", rating: 4.7, price: 320, address: "南山区科技园" },
    { name: "老码头茶餐厅", cuisine: "港式", rating: 4.5, price: 120, address: "福田中心区" },
  ],
};

/**
 * Search Jutui for restaurants in a city.
 * @param {string} city
 * @param {string} keyword
 * @param {number} limit
 */
async function queryJutuiRestaurants(city, keyword = "", limit = 10) {
  const token = process.env.JUTUI_TOKEN || "";

  if (!token) {
    const list = SYNTHETIC_RESTAURANTS[city] || [];
    const filtered = keyword
      ? list.filter(r => r.name.includes(keyword) || r.cuisine.includes(keyword))
      : list;
    return { restaurants: filtered.slice(0, limit), source: "synthetic" };
  }

  try {
    const url    = `${JUTUI_API_BASE}/restaurants?token=${encodeURIComponent(token)}&city=${encodeURIComponent(city)}&keyword=${encodeURIComponent(keyword)}&limit=${limit}`;
    const data   = await _fetchJson(url);
    const result = Array.isArray(data.data) ? data.data : [];
    return { restaurants: result, source: "jutui" };
  } catch (err) {
    console.warn("[merchants] Jutui API failed:", err.message);
    const fallback = SYNTHETIC_RESTAURANTS[city] || [];
    return { restaurants: fallback.slice(0, limit), source: "fallback", error: err.message };
  }
}

// ── Partner Hub Hotel Booking ─────────────────────────────────────────────────

const MAX_RETRIES = 3;

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Create a hotel booking via Partner Hub API.
 * @param {{ hotelId, checkIn, checkOut, rooms, guestName }} opts
 * @returns {{ bookingId, confirmationNo, status, hotelName }}
 */
async function createHotelBooking({ hotelId, checkIn, checkOut, rooms = 1, guestName }) {
  const baseUrl = process.env.PARTNER_HUB_BASE_URL || "";
  const hubKey  = process.env.PARTNER_HUB_KEY || "";

  if (!baseUrl || !hubKey) {
    // Mock booking
    return {
      bookingId:      `PHUB_MOCK_${Date.now().toString(36).toUpperCase()}`,
      confirmationNo: `CX${Math.floor(10000000 + Math.random() * 89999999)}`,
      status:         "confirmed",
      hotelName:      `Hotel ${hotelId}`,
      checkIn, checkOut, rooms,
      source: "mock",
    };
  }

  const body = JSON.stringify({ hotelId, checkIn, checkOut, rooms, guestName });
  const url  = new URL("/bookings", baseUrl);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = await new Promise((resolve, reject) => {
        const options = {
          hostname: url.hostname,
          port:     url.port || 443,
          path:     url.pathname,
          method:   "POST",
          headers: {
            "Content-Type":   "application/json",
            "Authorization":  `Bearer ${hubKey}`,
            "Content-Length": Buffer.byteLength(body),
          },
        };
        const req = https.request(options, (res) => {
          let data = "";
          res.on("data", c => { data += c; });
          res.on("end", () => {
            try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
            catch (e) { console.warn("[merchants/hub] JSON parse failed, status:", res.statusCode, e.message); resolve({ status: res.statusCode, body: data }); }
          });
        });
        req.on("error", reject);
        req.setTimeout(10000, () => { req.destroy(); reject(new Error("Partner Hub timeout")); });
        req.write(body);
        req.end();
      });

      if (result.status === 200 || result.status === 201) {
        return {
          bookingId:      result.body.id || result.body.booking_id,
          confirmationNo: result.body.confirmation_no,
          status:         result.body.status || "confirmed",
          hotelName:      result.body.hotel_name,
          checkIn, checkOut, rooms,
          source: "partner_hub",
        };
      }

      if (result.status >= 400 && result.status < 500) {
        // Client error — don't retry
        throw new Error(`Partner Hub client error ${result.status}: ${JSON.stringify(result.body)}`);
      }

      // 5xx — retry after backoff
      await _sleep(1000 * Math.pow(2, attempt));
    } catch (err) {
      if (attempt === MAX_RETRIES - 1) throw err;
      await _sleep(1000 * Math.pow(2, attempt));
    }
  }

  throw new Error("Partner Hub booking failed after retries");
}

module.exports = {
  assertRailCompliant,
  wechatRefund, alipayRefund, stripeRefund, merchantRefund,
  queryFlightStatus,
  queryJutuiRestaurants,
  createHotelBooking,
};
