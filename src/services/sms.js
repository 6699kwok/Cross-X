"use strict";
/**
 * src/services/sms.js
 * Pluggable SMS provider interface for OTP delivery.
 *
 * Configuration (env vars):
 *   SMS_PROVIDER=tencent   → Tencent Cloud SMS (腾讯云)
 *   SMS_PROVIDER=aliyun    → Alibaba Cloud SMS (阿里云)
 *   SMS_PROVIDER=mock      → Force mock (dev/test)
 *   (unset)                → Dev mode — logs to console, no HTTP call
 *
 * Tencent Cloud env vars:
 *   TENCENT_SMS_APP_ID      SecretId AppId
 *   TENCENT_SMS_APP_KEY     SecretKey
 *   TENCENT_SMS_SIGN        短信签名（如"CrossX旅行"）
 *   TENCENT_SMS_TEMPLATE_ID 模板ID（含 {1} 占位符 = OTP code）
 *
 * Aliyun env vars:
 *   ALIYUN_SMS_ACCESS_KEY_ID
 *   ALIYUN_SMS_ACCESS_KEY_SECRET
 *   ALIYUN_SMS_SIGN_NAME    短信签名
 *   ALIYUN_SMS_TEMPLATE_CODE 模板CODE（如 SMS_xxxxx）
 */

const https = require("https");
const crypto = require("crypto");

// ── Tencent Cloud SMS ─────────────────────────────────────────────────────────
async function _sendTencent(phone, code) {
  const appId      = process.env.TENCENT_SMS_APP_ID;
  const appKey     = process.env.TENCENT_SMS_APP_KEY;
  const sign       = process.env.TENCENT_SMS_SIGN       || "CrossX";
  const templateId = process.env.TENCENT_SMS_TEMPLATE_ID;

  if (!appId || !appKey || !templateId) {
    throw new Error("TENCENT_SMS_APP_ID / TENCENT_SMS_APP_KEY / TENCENT_SMS_TEMPLATE_ID not set");
  }

  // E.164 normalization: CN 11-digit → +86
  const e164 = phone.startsWith("+") ? phone : `+86${phone}`;

  const random = Math.floor(Math.random() * 1e8).toString().padStart(8, "0");
  const now    = Math.floor(Date.now() / 1000);
  const strToSign = `appkey=${appKey}&random=${random}&time=${now}&mobile=${e164}`;
  const sig = crypto.createHash("sha256").update(strToSign).digest("hex");

  const body = JSON.stringify({
    ext:          "",
    extend:       "",
    params:       [code, "5"],
    sig,
    sign,
    tel:          { mobile: e164.replace(/^\+86/, ""), nationcode: "86" },
    time:         now,
    tpl_id:       Number(templateId),
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "yun.tim.qq.com",
        path:     `/v5/tlssmssvr/sendsms?sdkappid=${appId}&random=${random}`,
        method:   "POST",
        headers:  { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            if (json.result === 0) resolve({ ok: true });
            else reject(new Error(`Tencent SMS error ${json.result}: ${json.errmsg}`));
          } catch { reject(new Error("Tencent SMS invalid response")); }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── Aliyun SMS ────────────────────────────────────────────────────────────────
async function _sendAliyun(phone, code) {
  const accessKeyId     = process.env.ALIYUN_SMS_ACCESS_KEY_ID;
  const accessKeySecret = process.env.ALIYUN_SMS_ACCESS_KEY_SECRET;
  const signName        = process.env.ALIYUN_SMS_SIGN_NAME;
  const templateCode    = process.env.ALIYUN_SMS_TEMPLATE_CODE;

  if (!accessKeyId || !accessKeySecret || !signName || !templateCode) {
    throw new Error("ALIYUN_SMS_* env vars not set");
  }

  const params = {
    AccessKeyId:       accessKeyId,
    Action:            "SendSms",
    Format:            "JSON",
    PhoneNumbers:      phone,
    SignName:          signName,
    SignatureMethod:   "HMAC-SHA1",
    SignatureNonce:    crypto.randomBytes(8).toString("hex"),
    SignatureVersion:  "1.0",
    TemplateCode:      templateCode,
    TemplateParam:     JSON.stringify({ code }),
    Timestamp:         new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    Version:           "2017-05-25",
  };

  const sorted = Object.keys(params).sort().map((k) =>
    `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`
  ).join("&");
  const toSign = `GET&${encodeURIComponent("/")}&${encodeURIComponent(sorted)}`;
  const sig = crypto.createHmac("sha1", `${accessKeySecret}&`).update(toSign).digest("base64");
  const query = `${sorted}&Signature=${encodeURIComponent(sig)}`;

  return new Promise((resolve, reject) => {
    https.get(`https://dysmsapi.aliyuncs.com/?${query}`, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (json.Code === "OK") resolve({ ok: true });
          else reject(new Error(`Aliyun SMS error: ${json.Code} — ${json.Message}`));
        } catch { reject(new Error("Aliyun SMS invalid response")); }
      });
    }).on("error", reject);
  });
}

/**
 * Send an OTP code via SMS.
 * In dev mode (SMS_PROVIDER not set), logs to console and resolves immediately.
 *
 * @param {string} phone  — normalized phone number (CN 11-digit or E.164)
 * @param {string} code   — 6-digit OTP code
 * @returns {Promise<{ ok: boolean, provider: string }>}
 */
async function sendOtp(phone, code) {
  const provider = (process.env.SMS_PROVIDER || "").toLowerCase();

  if (!provider || provider === "mock") {
    // Dev / test mode — print to console, do NOT send real SMS
    console.info(`[sms] DEV mode — OTP for ${phone.slice(0, 3)}****${phone.slice(-4)}: ${code}`);
    return { ok: true, provider: "mock" };
  }

  if (provider === "tencent") {
    await _sendTencent(phone, code);
    return { ok: true, provider: "tencent" };
  }

  if (provider === "aliyun") {
    await _sendAliyun(phone, code);
    return { ok: true, provider: "aliyun" };
  }

  throw new Error(`Unknown SMS_PROVIDER: "${provider}". Supported: tencent, aliyun, mock`);
}

module.exports = { sendOtp };
