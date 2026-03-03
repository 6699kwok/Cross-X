const QRCode = require("qrcode");

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

      // ── Live: Alipay 当面付 precreate ──────────────────────────────────
      const appId      = String(process.env.ALIPAY_APP_ID      || "").trim();
      const privateKey = String(process.env.ALIPAY_PRIVATE_KEY || "").trim();
      const publicKey  = String(process.env.ALIPAY_PUBLIC_KEY  || "").trim();

      if (appId && privateKey && publicKey) {
        try {
          const { default: AlipaySdk } = await import("alipay-sdk");
          const sdk = new AlipaySdk({ appId, privateKey, alipayPublicKey: publicKey });
          const outTradeNo = `CX${Date.now().toString().slice(-10)}`;
          const result = await sdk.exec("alipay.trade.precreate", {
            bizContent: {
              out_trade_no:  outTradeNo,
              total_amount:  Number(amount || 0).toFixed(2),
              subject:       `CrossX ${taskId || outTradeNo}`,
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

      // ── Sandbox fallback: fake deeplink encoded as a QR data-URL ──────
      const sandboxTradeNo = `CX${refSeed}`;
      const fakeDeeplink   = `alipays://payment/crossx/${sandboxTradeNo}/${Number(amount || 0).toFixed(2)}`;
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
          qrCode: qrDataUrl, alipayTradeNo: sandboxTradeNo, sandbox: true,
        },
      };
    },
  };
}

module.exports = {
  createPaymentRailManager,
  normalizeRail,
};
