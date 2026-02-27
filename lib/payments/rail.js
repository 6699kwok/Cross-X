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
      const latency = randomLatency();
      const fx = quoteFx({ amount, currency, railId: rail.id });
      const refSeed = `${Date.now().toString().slice(-6)}${String(taskId || "").replace(/[^\d]/g, "").slice(-2) || "00"}`;
      return {
        ok: true,
        latency,
        provider: rail.provider,
        source: "payment_rail",
        sourceTs: new Date().toISOString(),
        data: {
          amount: Number(amount || 0),
          currency,
          paymentRef: `PAY-${refSeed}`,
          gatewayRef: `GW-${rail.id}-${refSeed}`,
          railId: rail.id,
          railLabel: rail.label,
          userId,
          taskId,
          fx,
        },
      };
    },
  };
}

module.exports = {
  createPaymentRailManager,
  normalizeRail,
};
