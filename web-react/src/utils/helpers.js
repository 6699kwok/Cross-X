/**
 * Shared utility helpers
 */

export function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatCurrency(amount) {
  if (!amount && amount !== 0) return "";
  return `¥${Number(amount).toLocaleString("zh-CN")}`;
}

/**
 * Pick text by language code
 */
export function pickLang(lang, zh, en, ja = zh, ko = zh) {
  switch (lang) {
    case "ZH": return zh;
    case "EN": return en;
    case "JA": return ja;
    case "KO": return ko;
    default:   return zh;
  }
}

/**
 * Generate Amap navigation deep link from address string
 */
export function amapNavUrl(address) {
  const encoded = encodeURIComponent(address || "");
  return `https://uri.amap.com/marker?position=&name=${encoded}&src=crossx&callnative=1`;
}

/**
 * Clamp text to maxLen chars
 */
export function clamp(text, maxLen = 60) {
  if (!text) return "";
  const s = String(text);
  return s.length <= maxLen ? s : s.slice(0, maxLen) + "…";
}
