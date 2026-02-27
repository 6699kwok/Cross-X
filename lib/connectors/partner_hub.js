function jitter(min = 80, max = 360) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function safeNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseChannels(raw) {
  if (!raw) return [];
  return String(raw)
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function clampScore(raw) {
  const n = safeNum(raw, 80);
  if (n > 100) return 100;
  if (n < 0) return 0;
  return Math.round(n);
}

function fallbackSearch(vertical, city = "Shanghai", query = "") {
  const q = String(query || "").trim();
  const prefix = q ? `${q} · ` : "";
  if (vertical === "travel") {
    return [
      {
        id: `fh_tr_${Date.now().toString().slice(-6)}_1`,
        name: `${prefix}${city} Airport Fast Transfer`,
        category: "transport",
        score: 90,
        etaMin: 42,
        priceRange: "CNY 120-260",
        riskLevel: "medium",
        imageUrl: "https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=1200&q=80",
        reason: "Best punctuality under congestion.",
      },
      {
        id: `fh_tr_${Date.now().toString().slice(-6)}_2`,
        name: `${prefix}${city} Metro + Taxi Saver`,
        category: "transport",
        score: 84,
        etaMin: 58,
        priceRange: "CNY 60-118",
        riskLevel: "medium",
        imageUrl: "https://images.unsplash.com/photo-1502877338535-766e1452684a?auto=format&fit=crop&w=1200&q=80",
        reason: "Lower cost with predictable ETA.",
      },
    ];
  }
  if (vertical === "hotel") {
    return [
      {
        id: `fh_ht_${Date.now().toString().slice(-6)}_1`,
        name: `${prefix}${city} Riverside Premium Hotel`,
        category: "hotel",
        score: 88,
        etaMin: 18,
        priceRange: "CNY 780-1280",
        riskLevel: "low",
        imageUrl: "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=80",
        reason: "High foreign traveler friendliness.",
      },
      {
        id: `fh_ht_${Date.now().toString().slice(-6)}_2`,
        name: `${prefix}${city} Business District Hotel`,
        category: "hotel",
        score: 82,
        etaMin: 24,
        priceRange: "CNY 520-980",
        riskLevel: "low",
        imageUrl: "https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?auto=format&fit=crop&w=1200&q=80",
        reason: "Balanced price and airport commute.",
      },
    ];
  }
  return [
    {
      id: `fh_eat_${Date.now().toString().slice(-6)}_1`,
      name: `${prefix}${city} Local Noodle Kitchen`,
      category: "restaurant",
      score: 91,
      etaMin: 16,
      priceRange: "CNY 58-108",
      riskLevel: "medium",
      imageUrl: "https://images.unsplash.com/photo-1525755662778-989d0524087e?auto=format&fit=crop&w=1200&q=80",
      reason: "Top fit for authentic local flavor.",
      paymentFriendly: "alipay,wechat,card_delegate",
      englishMenu: true,
    },
    {
      id: `fh_eat_${Date.now().toString().slice(-6)}_2`,
      name: `${prefix}${city} Heritage Dumpling House`,
      category: "restaurant",
      score: 86,
      etaMin: 21,
      priceRange: "CNY 68-128",
      riskLevel: "medium",
      imageUrl: "https://images.unsplash.com/photo-1543353071-10c8ba85a904?auto=format&fit=crop&w=1200&q=80",
      reason: "Stable service and bilingual ordering support.",
      paymentFriendly: "alipay,wechat",
      englishMenu: true,
    },
  ];
}

function normalizeSearchItems(data, vertical) {
  const rows = Array.isArray(data && data.items) ? data.items : [];
  return rows
    .map((item, idx) => ({
      id: String(item.id || `${vertical}_${Date.now().toString().slice(-6)}_${idx + 1}`),
      name: String(item.name || item.title || "").trim(),
      category: String(item.category || vertical || "general").trim(),
      score: clampScore(item.score),
      etaMin: Math.max(1, safeNum(item.etaMin, 20)),
      priceRange: String(item.priceRange || item.price || "").trim(),
      riskLevel: String(item.riskLevel || item.risk || "medium"),
      imageUrl: String(item.imageUrl || item.image || "").trim(),
      reason: String(item.reason || item.why || "").trim(),
      paymentFriendly: String(item.paymentFriendly || "").trim(),
      englishMenu: Boolean(item.englishMenu),
      openHours: String(item.openHours || "").trim(),
      sourceUrl: String(item.sourceUrl || item.url || "").trim(),
      providerSource: String(item.providerSource || item.source || "").trim(),
    }))
    .filter((item) => item.name);
}

function withTimeout(promiseFactory, timeoutMs = 4500) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  return Promise.race([
    promiseFactory(ctrl.signal).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs + 10)),
  ]);
}

async function postJson(url, body, headers, signal) {
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body || {}),
    signal,
  });
  if (!res.ok) {
    throw new Error(`http_${res.status}`);
  }
  return res.json();
}

function createPartnerHubConnector({ key, baseUrl, provider, timeoutMs, channels } = {}) {
  const resolvedBaseUrl = String(baseUrl || process.env.PARTNER_HUB_BASE_URL || "").trim();
  const resolvedProvider = String(provider || process.env.PARTNER_HUB_PROVIDER || "generic").trim().toLowerCase();
  const resolvedTimeoutMs = Math.max(1200, safeNum(timeoutMs || process.env.PARTNER_HUB_TIMEOUT_MS, 4200));
  const resolvedChannels = parseChannels(channels || process.env.PARTNER_HUB_CHANNELS || "");
  const enabled = Boolean(key || resolvedBaseUrl);

  async function call(path, payload) {
    if (!resolvedBaseUrl) return null;
    const url = `${resolvedBaseUrl.replace(/\/+$/, "")}/${String(path || "").replace(/^\/+/, "")}`;
    const headers = {
      "Content-Type": "application/json",
      "X-CrossX-Provider": resolvedProvider || "generic",
    };
    if (key) {
      headers.Authorization = `Bearer ${key}`;
      headers["X-Partner-Key"] = String(key);
    }
    if (resolvedChannels.length) {
      headers["X-Partner-Channels"] = resolvedChannels.join(",");
    }
    return withTimeout((signal) => postJson(url, payload, headers, signal), resolvedTimeoutMs);
  }

  return {
    enabled,
    baseUrl: resolvedBaseUrl || null,
    provider: resolvedProvider,
    channels: resolvedChannels,
    mode: resolvedBaseUrl ? "external_contract" : key ? "key_only_mock" : "mock",

    async queueStatus({ city = "Shanghai" }) {
      if (!enabled) return { enabled: false, waitMin: null, seatsLeft: null };
      if (resolvedBaseUrl) {
        try {
          const live = await call("queue/status", { city, provider: resolvedProvider });
          if (live && live.ok !== false) {
            const data = live.data || live;
            return {
              enabled: true,
              waitMin: Math.max(0, safeNum(data.waitMin, 0)),
              seatsLeft: Math.max(0, safeNum(data.seatsLeft, 0)),
              latency: Math.max(1, safeNum(data.latencyMs || data.latency, jitter())),
              providerSource: String(data.provider || resolvedProvider || "partner_hub"),
            };
          }
        } catch {
          // continue to deterministic fallback
        }
      }
      const hash = city.length % 4;
      return {
        enabled: true,
        waitMin: 12 + hash * 4,
        seatsLeft: Math.max(1, 5 - hash),
        latency: jitter(),
        providerSource: resolvedProvider || "partner_hub",
      };
    },

    async lockRestaurant({ city = "Shanghai" }) {
      if (!enabled) return { enabled: false, lockId: null };
      if (resolvedBaseUrl) {
        try {
          const live = await call("booking/lock", { city, provider: resolvedProvider, vertical: "eat" });
          if (live && live.ok !== false) {
            const data = live.data || live;
            const lockId = String(data.lockId || data.bookingId || "").trim();
            if (lockId) {
              return {
                enabled: true,
                lockId,
                expiresInSec: Math.max(300, safeNum(data.expiresInSec, 900)),
                city,
                latency: Math.max(1, safeNum(data.latencyMs || data.latency, jitter())),
                providerSource: String(data.provider || resolvedProvider || "partner_hub"),
              };
            }
          }
        } catch {
          // continue to deterministic fallback
        }
      }
      return {
        enabled: true,
        lockId: `PH-BK-${Date.now().toString().slice(-6)}`,
        expiresInSec: 900,
        city,
        latency: jitter(),
        providerSource: resolvedProvider || "partner_hub",
      };
    },

    async trafficStatus({ origin = "", destination = "" }) {
      if (!enabled) return { enabled: false, congestionLevel: null, risk: null };
      if (resolvedBaseUrl) {
        try {
          const live = await call("traffic/status", { origin, destination, provider: resolvedProvider });
          if (live && live.ok !== false) {
            const data = live.data || live;
            const congestionLevel = String(data.congestionLevel || data.congestion || "medium");
            return {
              enabled: true,
              congestionLevel,
              risk: String(data.risk || (congestionLevel === "high" ? "medium" : "low")),
              latency: Math.max(1, safeNum(data.latencyMs || data.latency, jitter())),
              providerSource: String(data.provider || resolvedProvider || "partner_hub"),
            };
          }
        } catch {
          // continue to deterministic fallback
        }
      }
      const score = (origin.length + destination.length) % 3;
      return {
        enabled: true,
        congestionLevel: score === 2 ? "high" : score === 1 ? "medium" : "low",
        risk: score === 2 ? "medium" : "low",
        latency: jitter(),
        providerSource: resolvedProvider || "partner_hub",
      };
    },

    async lockTransport({ city = "Shanghai" }) {
      if (!enabled) return { enabled: false, ticketRef: null };
      if (resolvedBaseUrl) {
        try {
          const live = await call("transport/lock", { city, provider: resolvedProvider });
          if (live && live.ok !== false) {
            const data = live.data || live;
            const ticketRef = String(data.ticketRef || data.lockId || "").trim();
            if (ticketRef) {
              return {
                enabled: true,
                ticketRef,
                city,
                latency: Math.max(1, safeNum(data.latencyMs || data.latency, jitter())),
                providerSource: String(data.provider || resolvedProvider || "partner_hub"),
              };
            }
          }
        } catch {
          // continue to deterministic fallback
        }
      }
      return {
        enabled: true,
        ticketRef: `PH-TR-${Date.now().toString().slice(-6)}`,
        city,
        latency: jitter(),
        providerSource: resolvedProvider || "partner_hub",
      };
    },

    async searchCandidates({ vertical = "eat", city = "Shanghai", query = "", constraints = {}, language = "EN", limit = 8 } = {}) {
      if (!enabled) return { enabled: false, items: [] };
      const topN = Math.max(1, Math.min(12, safeNum(limit, 8)));
      if (resolvedBaseUrl) {
        try {
          const live = await call("candidates/search", {
            provider: resolvedProvider,
            channels: resolvedChannels,
            vertical,
            city,
            query,
            constraints,
            language,
            limit: topN,
          });
          const items = normalizeSearchItems(live && (live.data || live), vertical);
          if (items.length) {
            return {
              enabled: true,
              items: items.slice(0, topN),
              latency: Math.max(1, safeNum(live && (live.latencyMs || live.latency), jitter())),
              providerSource: resolvedProvider || "partner_hub",
              channels: resolvedChannels,
              mode: "external_contract",
            };
          }
        } catch {
          // continue to deterministic fallback
        }
      }
      return {
        enabled: true,
        items: fallbackSearch(vertical, city, query).slice(0, topN),
        latency: jitter(),
        providerSource: resolvedProvider || "partner_hub",
        channels: resolvedChannels,
        mode: resolvedBaseUrl ? "external_contract_fallback" : "mock",
      };
    },
  };
}

module.exports = {
  createPartnerHubConnector,
};
