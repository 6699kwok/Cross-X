const QRCode = require("qrcode");
const crypto  = require("crypto");

function randomLatency(min = 120, max = 520) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

const RAILS = {
  alipay_cn: {
    id: "alipay_cn",
    label: "Alipay CN",
    provider: "Alipay Gateway",
    supportsForeignCard: true,
    settlementDelayMin: 5,
  },
  wechat_cn: {
    id: "wechat_cn",
    label: "WeChat Pay CN",
    provider: "WeChat Pay Gateway",
    supportsForeignCard: false,
    settlementDelayMin: 8,
  },
  card_delegate: {
    id: "card_delegate",
    label: "ACT Delegated Card",
    provider: "ACT Delegation Rail",
    supportsForeignCard: true,
    settlementDelayMin: 15,
  },
};

function normalizeRail(id) {
  return RAILS[id] ? id : "alipay_cn";
}

function quoteFx({ amount, currency, railId }) {
  if (currency !== "CNY" || railId !== "card_delegate") return null;
  const usdRate = 7.18;
  return {
    settlementCurrency: "USD",
    rate: usdRate,
    settledAmount: Math.round((Number(amount || 0) / usdRate) * 100) / 100,
  };
}

function createPaymentRailManager(options = {}) {
  const checkRailAllowed = options.checkRailAllowed;
  return {
    listRails() {
      return Object.values(RAILS);
    },

    resolveRail(id) {
      return RAILS[normalizeRail(id)];
    },

    async charge({ railId, amount, currency = "CNY", userId = "demo", taskId = "" }) {
      const rail = RAILS[normalizeRail(railId)];
      if (typeof checkRailAllowed === "function") {
        const check = checkRailAllowed(rail.id);
        if (!check || check.ok !== true) {
          return {
            ok: false,
            errorCode: check && check.code ? check.code : "rail_blocked",
            latency: randomLatency(),
            provider: rail.provider,
            source: "payment_rail",
            sourceTs: new Date().toISOString(),
            data: {
              amount: Number(amount || 0),
              currency,
              paymentRef: "",
              gatewayRef: "",
              railId: rail.id,
              railLabel: rail.label,
              userId,
              taskId,
              fx: null,
              complianceReason: check && check.reason ? check.reason : "Rail blocked by compliance policy",
            },
          };
        }
      }
      const latency  = randomLatency();
      const fx       = quoteFx({ amount, currency, railId: rail.id });
      const refSeed  = `${Date.now().toString().slice(-6)}${String(taskId || "").replace(/[^\d]/g, "").slice(-2) || "00"}`;

      // ── Live: Alipay 当面付 precreate (alipay_cn only) ────────────────
      if (rail.id === "alipay_cn") {
        const aliAppId  = String(process.env.ALIPAY_APP_ID      || "").trim();
        const aliPriv   = String(process.env.ALIPAY_PRIVATE_KEY || "").trim();
        const aliPub    = String(process.env.ALIPAY_PUBLIC_KEY  || "").trim();
        if (aliAppId && aliPriv && aliPub) {
          try {
            const { default: AlipaySdk } = await import("alipay-sdk");
            const sdk = new AlipaySdk({ appId: aliAppId, privateKey: aliPriv, alipayPublicKey: aliPub });
            const outTradeNo = `CX${Date.now().toString().slice(-10)}`;
            const result = await sdk.exec("alipay.trade.precreate", {
              bizContent: {
                out_trade_no: outTradeNo,
                total_amount: Number(amount || 0).toFixed(2),
                subject:      `CrossX ${taskId || outTradeNo}`,
              },
            });
            if (result.code === "10000" && result.qrCode) {
              return {
                ok: true, latency, provider: "Alipay Gateway (live)", source: "alipay_precreate",
                sourceTs: new Date().toISOString(),
                data: {
                  amount: Number(amount || 0), currency,
                  paymentRef: `PAY-${refSeed}`, gatewayRef: `GW-${rail.id}-${refSeed}`,
                  railId: rail.id, railLabel: rail.label, userId, taskId, fx,
                  qrCode: result.qrCode, alipayTradeNo: outTradeNo,
                },
              };
            }
            console.warn("[alipay] precreate non-success:", result.code, result.subMsg);
          } catch (err) {
            console.warn("[alipay] precreate fallback:", err.message);
          }
        }
      }

      // ── Live: WeChat Pay v3 Native (wechat_cn only) ───────────────────
      if (rail.id === "wechat_cn") {
        const wxMchId    = String(process.env.WECHAT_MCH_ID        || "").trim();
        const wxAppId    = String(process.env.WECHAT_APP_ID        || "").trim();
        const wxSerialNo = String(process.env.WECHAT_CERT_SERIAL_NO|| "").trim();
        const wxPrivKey  = String(process.env.WECHAT_PRIVATE_KEY   || "").trim();
        const wxNotify   = String(process.env.WECHAT_NOTIFY_URL    || "").trim();
        if (wxMchId && wxAppId && wxSerialNo && wxPrivKey && wxNotify) {
          try {
            const outTradeNo  = `CX${Date.now().toString().slice(-10)}`;
            const totalFen    = Math.round(Number(amount || 0) * 100); // WeChat uses fen (cents)
            const body        = JSON.stringify({
              mchid: wxMchId, appid: wxAppId,
              description: `CrossX ${taskId || outTradeNo}`,
              out_trade_no: outTradeNo,
              notify_url: wxNotify,
              amount: { total: totalFen, currency: "CNY" },
            });
            // Build v3 auth signature: method\npath\ntimestamp\nnonce\nbody\n
            const timestamp = String(Math.floor(Date.now() / 1000));
            const nonce     = crypto.randomBytes(16).toString("hex");
            const message   = `POST\n/v3/pay/transactions/native\n${timestamp}\n${nonce}\n${body}\n`;
            const signer    = crypto.createSign("SHA256");
            signer.update(message);
            const signature = signer.sign(wxPrivKey, "base64");
            const auth = `WECHATPAY2-SHA256-RSA2048 mchid="${wxMchId}",serial_no="${wxSerialNo}",timestamp="${timestamp}",nonce_str="${nonce}",signature="${signature}"`;

            const resp = await fetch("https://api.mch.weixin.qq.com/v3/pay/transactions/native", {
              method: "POST",
              headers: { "Content-Type": "application/json", "Accept": "application/json", Authorization: auth },
              body,
              signal: AbortSignal.timeout(8000),
            });
            const json = await resp.json();
            if (json.code_url) {
              const qrCode = await QRCode.toDataURL(json.code_url, { width: 200, margin: 1 });
              return {
                ok: true, latency, provider: "WeChat Pay Gateway (live)", source: "wechat_native",
                sourceTs: new Date().toISOString(),
                data: {
                  amount: Number(amount || 0), currency,
                  paymentRef: `PAY-${refSeed}`, gatewayRef: `GW-${rail.id}-${refSeed}`,
                  railId: rail.id, railLabel: rail.label, userId, taskId, fx,
                  qrCode, wechatTradeNo: outTradeNo, wechatCodeUrl: json.code_url,
                },
              };
            }
            console.warn("[wechat] native non-success:", json);
          } catch (err) {
            console.warn("[wechat] native fallback:", err.message);
          }
        }
      }

      // ── Sandbox fallback: rail-specific deeplink encoded as QR data-URL ─
      const sandboxTradeNo = `CX${refSeed}`;
      const isWechat       = rail.id === "wechat_cn";
      const fakeDeeplink   = isWechat
        ? `weixin://wxpay/bizpayurl?pr=CROSSX_${sandboxTradeNo}`
        : `alipays://payment/crossx/${sandboxTradeNo}/${Number(amount || 0).toFixed(2)}`;
      let qrDataUrl;
      try { qrDataUrl = await QRCode.toDataURL(fakeDeeplink, { width: 200, margin: 1 }); }
      catch { qrDataUrl = fakeDeeplink; }

      return {
        ok: true, latency, provider: rail.provider, source: "payment_rail_sandbox",
        sourceTs: new Date().toISOString(),
        data: {
          amount: Number(amount || 0), currency,
          paymentRef: `PAY-${refSeed}`, gatewayRef: `GW-${rail.id}-${refSeed}`,
          railId: rail.id, railLabel: rail.label, userId, taskId, fx,
          qrCode: qrDataUrl,
          ...(isWechat ? { wechatTradeNo: sandboxTradeNo } : { alipayTradeNo: sandboxTradeNo }),
          sandbox: true,
        },
      };
    },
  };
}

module.exports = {
  createPaymentRailManager,
  normalizeRail,
};
