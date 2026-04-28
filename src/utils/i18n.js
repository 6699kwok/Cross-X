"use strict";
/**
 * src/utils/i18n.js
 * CT-10/P2-06: Internationalization helpers — timezone, currency, date formatting.
 *
 * Uses Node.js built-in Intl API (no external dependencies).
 * Supports CN (mainland), HK, TW, and international users.
 */

// ── Currency formatting ────────────────────────────────────────────────────

const CURRENCY_BY_LOCALE = {
  ZH:    "CNY",  // Mainland China
  ZH_HK: "HKD",  // Hong Kong
  ZH_TW: "TWD",  // Taiwan
  EN:    "USD",
  JA:    "JPY",
  KO:    "KRW",
};

/**
 * Format a price in the appropriate currency for the user's locale.
 * @param {number} amountCny  — amount in CNY (our internal unit)
 * @param {string} language   — "ZH" | "EN" | etc.
 * @param {string} [targetCurrency]  — override target currency
 * @returns {string} formatted price string
 */
function formatPrice(amountCny, language = "ZH", targetCurrency) {
  const currency = targetCurrency || CURRENCY_BY_LOCALE[language] || "CNY";

  // For now, only CNY is supported without exchange rate service.
  // TODO: integrate exchange rate API for HKD/USD/JPY display.
  if (currency === "CNY") {
    try {
      return new Intl.NumberFormat("zh-CN", {
        style: "currency", currency: "CNY", maximumFractionDigits: 0,
      }).format(amountCny);
    } catch { return `¥${amountCny}`; }
  }

  // Fallback: show CNY with a note
  return `¥${amountCny} CNY`;
}

// ── Date/time formatting ───────────────────────────────────────────────────

const LOCALE_MAP = { ZH: "zh-CN", EN: "en-US", JA: "ja-JP", KO: "ko-KR" };

/**
 * Format a date string respecting locale conventions.
 * @param {string|Date} date
 * @param {string} language
 * @param {object} [opts]  — Intl.DateTimeFormat options
 * @returns {string}
 */
function formatDate(date, language = "ZH", opts = {}) {
  try {
    const locale = LOCALE_MAP[language] || "zh-CN";
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return String(date);
    return new Intl.DateTimeFormat(locale, {
      year: "numeric", month: "long", day: "numeric",
      ...opts,
    }).format(d);
  } catch { return String(date); }
}

/**
 * Format a time string for display, with timezone.
 * @param {string} time  — "HH:MM" or ISO string
 * @param {string} timezone — IANA timezone (e.g. "Asia/Shanghai", "Asia/Chongqing")
 * @param {string} language
 * @returns {string}
 */
function formatTime(time, timezone = "Asia/Shanghai", language = "ZH") {
  try {
    const locale = LOCALE_MAP[language] || "zh-CN";
    // Parse time string
    const d = time.includes("T") ? new Date(time) : new Date(`2000-01-01T${time}`);
    if (isNaN(d.getTime())) return time;
    return new Intl.DateTimeFormat(locale, {
      hour: "2-digit", minute: "2-digit",
      timeZone: timezone, hour12: language !== "ZH",
    }).format(d);
  } catch { return time; }
}

/**
 * Get destination timezone from city name (common Chinese cities).
 * @param {string} city
 * @returns {string} IANA timezone
 */
function getDestinationTimezone(city = "") {
  // All of China uses Asia/Shanghai (UTC+8), but we future-proof for international
  const c = String(city).toLowerCase();
  if (/xinjiang|新疆|乌鲁木齐/.test(c)) return "Asia/Urumqi"; // UTC+6
  if (/hong.?kong|hk|香港/.test(c)) return "Asia/Hong_Kong";
  if (/taiwan|taipei|台湾|台北/.test(c)) return "Asia/Taipei";
  if (/japan|tokyo|日本|東京/.test(c)) return "Asia/Tokyo";
  if (/korea|seoul|韩国|首尔/.test(c)) return "Asia/Seoul";
  if (/bangkok|thailand|泰国|曼谷/.test(c)) return "Asia/Bangkok";
  if (/singapore|新加坡/.test(c)) return "Asia/Singapore";
  return "Asia/Shanghai"; // default: China Standard Time (UTC+8)
}

/**
 * Generate a localized "price validity" warning.
 * Travel prices change frequently — inform users.
 * @param {string} language
 * @param {number} validMinutes  — how long the price is valid
 * @returns {string}
 */
function priceValidityWarning(language = "ZH", validMinutes = 30) {
  if (language === "ZH") {
    return `价格仅供参考，实际以预订时为准（波动频繁，建议${validMinutes}分钟内完成预订）`;
  }
  return `Prices are estimates only. Actual prices may vary. We recommend booking within ${validMinutes} minutes.`;
}

// ── Phone number formatting ────────────────────────────────────────────────

/**
 * Format a Chinese phone number for international display.
 * @param {string} phone  — e.g. "13812345678"
 * @param {boolean} international  — whether to add +86 prefix
 * @returns {string}
 */
function formatPhone(phone, international = false) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    const formatted = `${digits.slice(0, 3)} ${digits.slice(3, 7)} ${digits.slice(7)}`;
    return international ? `+86 ${formatted}` : formatted;
  }
  return phone;
}

module.exports = {
  formatPrice,
  formatDate,
  formatTime,
  getDestinationTimezone,
  priceValidityWarning,
  formatPhone,
  CURRENCY_BY_LOCALE,
};
