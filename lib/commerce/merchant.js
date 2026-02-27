function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function getBaseNetPrice(intentType) {
  if (intentType === "travel") return 108;
  return 56;
}

function getMarkupRate({ intentType, plusActive, vipFastLane }) {
  let rate = intentType === "travel" ? 0.22 : 0.18;
  if (plusActive) rate -= 0.04;
  if (vipFastLane) rate += 0.03;
  return Math.max(0.05, roundMoney(rate));
}

function buildQuote({ intentType, currency = "CNY", plusActive = false, vipFastLane = false }) {
  const netPrice = getBaseNetPrice(intentType);
  const markupRate = getMarkupRate({ intentType, plusActive, vipFastLane });
  const markup = roundMoney(netPrice * markupRate);
  const finalPrice = roundMoney(netPrice + markup);
  return {
    currency,
    netPrice,
    markupRate,
    markup,
    finalPrice,
    merchantModel: "Cross X Merchant of Record (net-price + markup)",
  };
}

module.exports = {
  buildQuote,
  roundMoney,
};
