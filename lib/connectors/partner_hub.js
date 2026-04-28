// Partner Hub is CrossX's adapter for external commercial providers.
// This connector intentionally exposes normalized methods (queue, booking, search,
// transport, rail availability) so the rest of the app does not need to know
// provider-specific response formats or whether the runtime is using live data,
// deterministic local fallback, or fully disabled mode.
const { isPublicFacingRuntime } = require("../../src/utils/runtimeFlags");

const BUILTIN_12306_BASE_URL = "https://kyfw.12306.cn";
const BUILTIN_12306_STATION_JS = `${BUILTIN_12306_BASE_URL}/otn/resources/js/framework/station_name.js`;
const BUILTIN_12306_QUERY_URL = `${BUILTIN_12306_BASE_URL}/otn/leftTicket/query`;
const BUILTIN_CITY_STATIONS = {
  北京: ["北京南", "北京西", "北京朝阳", "北京丰台", "北京"],
  北京市: ["北京南", "北京西", "北京朝阳", "北京丰台", "北京"],
  Shanghai: ["上海虹桥", "上海", "上海南"],
  上海: ["上海虹桥", "上海", "上海南"],
  上海市: ["上海虹桥", "上海", "上海南"],
  广州: ["广州南", "广州东", "广州白云", "广州"],
  广州市: ["广州南", "广州东", "广州白云", "广州"],
  深圳: ["深圳北", "深圳", "深圳坪山", "福田"],
  深圳市: ["深圳北", "深圳", "深圳坪山", "福田"],
  杭州: ["杭州东", "杭州西", "杭州", "杭州南"],
  杭州市: ["杭州东", "杭州西", "杭州", "杭州南"],
  成都: ["成都东", "成都南", "成都西", "成都"],
  成都市: ["成都东", "成都南", "成都西", "成都"],
  西安: ["西安北", "西安", "西安南"],
  西安市: ["西安北", "西安", "西安南"],
  武汉: ["武汉", "汉口", "武昌"],
  武汉市: ["武汉", "汉口", "武昌"],
  南京: ["南京南", "南京", "南京西"],
  南京市: ["南京南", "南京", "南京西"],
  苏州: ["苏州", "苏州北", "苏州园区"],
  苏州市: ["苏州", "苏州北", "苏州园区"],
  厦门: ["厦门", "厦门北"],
  厦门市: ["厦门", "厦门北"],
  青岛: ["青岛", "青岛北"],
  青岛市: ["青岛", "青岛北"],
};
const BUILTIN_CITY_ALIASES = {
  beijing: "北京",
  shanghai: "上海",
  guangzhou: "广州",
  shenzhen: "深圳",
  hangzhou: "杭州",
  chengdu: "成都",
  xian: "西安",
  "xi'an": "西安",
  wuhan: "武汉",
  nanjing: "南京",
  suzhou: "苏州",
  xiamen: "厦门",
  qingdao: "青岛",
};
const BUILTIN_12306_SEAT_KEYS = [
  { key: "swz_num", label: "Business class", priority: 10 },
  { key: "tz_num", label: "Premium class", priority: 9 },
  { key: "zy_num", label: "First class", priority: 8 },
  { key: "ze_num", label: "Second class", priority: 7 },
  { key: "rw_num", label: "Soft sleeper", priority: 6 },
  { key: "yw_num", label: "Hard sleeper", priority: 5 },
  { key: "gr_num", label: "Deluxe soft sleeper", priority: 4 },
  { key: "rz_num", label: "Soft seat", priority: 3 },
  { key: "yz_num", label: "Hard seat", priority: 2 },
  { key: "wz_num", label: "No seat", priority: 1 },
];
let _stationCodeCache = null;
let _stationCodeCacheAt = 0;

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

function normalizeProviderName(raw, fallback = "generic") {
  const value = String(raw || "").trim().toLowerCase();
  return value || String(fallback || "generic").trim().toLowerCase() || "generic";
}

function buildRailInventorySource(provider = "partner_hub") {
  const safe = String(provider || "partner_hub")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return (safe || "partner_hub") + "_rail_live";
}

function normalizeRailDate(value) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(raw)) return raw.replace(/\//g, "-");
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeBuiltinRailCity(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  return BUILTIN_CITY_ALIASES[lower] || raw.replace(/\s+city$/i, "").replace(/市$/, "");
}

function pickBuiltinStationCandidates(city) {
  const normalized = normalizeBuiltinRailCity(city);
  if (!normalized) return [];
  const key = normalized.replace(/市$/, "");
  const bucket = BUILTIN_CITY_STATIONS[normalized] || BUILTIN_CITY_STATIONS[key] || [];
  return Array.from(new Set([normalized, key, ...bucket].filter(Boolean)));
}

async function fetchBuiltin12306StationMap(timeoutMs = 6000) {
  const now = Date.now();
  if (_stationCodeCache && now - _stationCodeCacheAt < 6 * 60 * 60 * 1000) return _stationCodeCache;
  const res = await fetch(BUILTIN_12306_STATION_JS, { headers: { Accept: "*/*" }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`builtin_12306_station_http_${res.status}`);
  const text = await res.text();
  const match = text.match(/station_names\s*=\s*'([^']+)'/);
  if (!match || !match[1]) throw new Error("builtin_12306_station_parse_failed");
  const map = new Map();
  String(match[1] || "").split("@").forEach((row) => {
    const parts = row.split("|");
    if (parts.length >= 3) {
      const name = String(parts[1] || "").trim();
      const code = String(parts[2] || "").trim();
      if (name && code) map.set(name, code);
    }
  });
  if (!map.size) throw new Error("builtin_12306_station_empty");
  _stationCodeCache = map;
  _stationCodeCacheAt = now;
  return map;
}

function buildBuiltin12306QueryUrl(fromCode, toCode, date) {
  const url = new URL(BUILTIN_12306_QUERY_URL);
  url.searchParams.set("leftTicketDTO.train_date", normalizeRailDate(date));
  url.searchParams.set("leftTicketDTO.from_station", fromCode);
  url.searchParams.set("leftTicketDTO.to_station", toCode);
  url.searchParams.set("purpose_codes", "ADULT");
  return url.toString();
}

function parseBuiltinSeatCount(raw) {
  const value = String(raw == null ? "" : raw).trim();
  if (!value || value === "--" || value === "无") return 0;
  if (value === "有") return 20;
  const num = Number(value.replace(/[^0-9]/g, ""));
  return Number.isFinite(num) ? num : 0;
}

function chooseBuiltinSeat(fields) {
  const candidates = BUILTIN_12306_SEAT_KEYS
    .map((seat) => ({ ...seat, count: parseBuiltinSeatCount(fields[seat.key]) }))
    .filter((seat) => seat.count > 0)
    .sort((a, b) => b.priority - a.priority || b.count - a.count);
  return candidates[0] || { label: "Seat", count: 0 };
}

function parseBuiltinDurationToMinutes(raw) {
  const value = String(raw || "").trim();
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return 0;
  return (Number(match[1]) * 60) + Number(match[2]);
}

function isBuiltinHighSpeed(trainNo) {
  return /^[GDC]/i.test(String(trainNo || "").trim());
}

function normalizeBuiltin12306Rows(rows, { origin, destination }) {
  return rows
    .map((raw, idx) => {
      const parts = String(raw || "").split("|");
      const trainNo = String(parts[3] || "").trim();
      if (!trainNo) return null;
      const depTime = String(parts[8] || "").trim();
      const arrTime = String(parts[9] || "").trim();
      const duration = String(parts[10] || "").trim();
      const seatFields = {
        swz_num: parts[32],
        tz_num: parts[25],
        zy_num: parts[31],
        ze_num: parts[30],
        gr_num: parts[21],
        rw_num: parts[23],
        yw_num: parts[28],
        rz_num: parts[24],
        yz_num: parts[29],
        wz_num: parts[26],
      };
      const bestSeat = chooseBuiltinSeat(seatFields);
      const seatsLeft = bestSeat.count;
      const fromStation = String(parts[6] || origin || "").trim();
      const toStation = String(parts[7] || destination || "").trim();
      return {
        id: `builtin_12306_${trainNo}_${idx + 1}`,
        type: isBuiltinHighSpeed(trainNo) ? "hsr" : "train",
        label: `${trainNo} ${isBuiltinHighSpeed(trainNo) ? "High-speed rail" : "Train"}`,
        trainNo,
        fromStation,
        toStation,
        depTime,
        arrTime,
        durationMin: parseBuiltinDurationToMinutes(duration),
        priceCny: 0,
        seatsLeft,
        seatLabel: bestSeat.label,
        bookingUrl: BUILTIN_12306_QUERY_URL,
        providerSource: "builtin_12306",
        latency: jitter(120, 480),
      };
    })
    .filter((item) => item && item.trainNo);
}

async function queryBuiltin12306RailAvailability({ origin = "", destination = "", date = "", timeoutMs = 6000 } = {}) {
  const stationMap = await fetchBuiltin12306StationMap(timeoutMs);
  const originCandidates = pickBuiltinStationCandidates(origin);
  const destinationCandidates = pickBuiltinStationCandidates(destination);
  const fromName = originCandidates.find((name) => stationMap.has(name)) || "";
  const toName = destinationCandidates.find((name) => stationMap.has(name)) || "";
  if (!fromName || !toName || fromName === toName) {
    return { enabled: false, items: [], inventorySource: "builtin_12306_rail_live", errorCode: "rail_station_not_supported" };
  }
  const url = buildBuiltin12306QueryUrl(stationMap.get(fromName), stationMap.get(toName), date);
  const res = await fetch(url, {
    headers: {
      Accept: "application/json, text/javascript, */*; q=0.01",
      Referer: `${BUILTIN_12306_BASE_URL}/otn/leftTicket/init`,
      "User-Agent": "Mozilla/5.0 CrossX rail probe",
    },
    signal: AbortSignal.timeout(Math.max(1800, timeoutMs)),
  });
  if (!res.ok) throw new Error(`builtin_12306_http_${res.status}`);
  const json = await res.json();
  const rows = Array.isArray(json?.data?.result) ? json.data.result : [];
  const items = normalizeBuiltin12306Rows(rows, { origin: fromName, destination: toName });
  return {
    enabled: items.length > 0,
    items,
    providerSource: "builtin_12306",
    inventorySource: "builtin_12306_rail_live",
    latency: jitter(120, 480),
    errorCode: items.length ? null : "rail_no_results",
  };
}

function clampScore(raw) {
  const n = safeNum(raw, 80);
  if (n > 100) return 100;
  if (n < 0) return 0;
  return Math.round(n);
}

function isLocalBookingFallbackEnabled() {
  if (String(process.env.CROSSX_ALLOW_LOCAL_BOOKING_FALLBACK || "").trim() !== "1") return false;
  if (process.env.NODE_ENV === "production") return false;
  if (isPublicFacingRuntime()) return false;
  return true;
}

function isLocalCandidateFallbackEnabled() {
  if (String(process.env.CROSSX_ALLOW_LOCAL_CANDIDATE_FALLBACK || "").trim() !== "1") return false;
  if (process.env.NODE_ENV === "production") return false;
  if (isPublicFacingRuntime()) return false;
  return true;
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
  const resolvedKey = String(key || process.env.PARTNER_HUB_KEY || "").trim();
  const resolvedBaseUrl = String(baseUrl || process.env.PARTNER_HUB_BASE_URL || "").trim();
  const resolvedProvider = normalizeProviderName(provider || process.env.PARTNER_HUB_PROVIDER || "generic", "generic");
  const resolvedTimeoutMs = Math.max(1200, safeNum(timeoutMs || process.env.PARTNER_HUB_TIMEOUT_MS, 4200));
  const resolvedChannels = parseChannels(channels || process.env.PARTNER_HUB_CHANNELS || "");
  const enabled = Boolean(resolvedKey || resolvedBaseUrl);

  const hasDedicatedRailConfig = [
    process.env.RAIL_KEY,
    process.env.RAIL_BASE_URL,
    process.env.RAIL_PROVIDER,
    process.env.RAIL_TIMEOUT_MS,
    process.env.RAIL_CHANNELS,
  ].some((value) => String(value || "").trim());
  const resolvedRailKey = String(process.env.RAIL_KEY || resolvedKey || "").trim();
  const resolvedRailBaseUrl = String(process.env.RAIL_BASE_URL || resolvedBaseUrl || "").trim();
  const resolvedRailProvider = normalizeProviderName(
    process.env.RAIL_PROVIDER || (hasDedicatedRailConfig ? "rail_provider" : (resolvedProvider || "partner_hub")),
    hasDedicatedRailConfig ? "rail_provider" : (resolvedProvider || "partner_hub")
  );
  const resolvedRailTimeoutMs = Math.max(1200, safeNum(process.env.RAIL_TIMEOUT_MS || resolvedTimeoutMs, resolvedTimeoutMs));
  const resolvedRailChannels = parseChannels(process.env.RAIL_CHANNELS || resolvedChannels.join(","));
  const railEnabled = Boolean(resolvedRailKey || resolvedRailBaseUrl);
  const railInventorySource = buildRailInventorySource(hasDedicatedRailConfig ? resolvedRailProvider : "partner_hub");

  function buildHeaders(providerName, secretKey, channelList) {
    const headers = {
      "Content-Type": "application/json",
      "X-CrossX-Provider": providerName || "generic",
    };
    if (secretKey) {
      headers.Authorization = `Bearer ${secretKey}`;
      headers["X-Partner-Key"] = String(secretKey);
    }
    if (Array.isArray(channelList) && channelList.length) {
      headers["X-Partner-Channels"] = channelList.join(",");
    }
    return headers;
  }

  async function callWithConfig(targetBaseUrl, path, payload, providerName, secretKey, channelList, requestTimeoutMs) {
    if (!targetBaseUrl) return null;
    const url = `${targetBaseUrl.replace(/\/+$/, "")}/${String(path || "").replace(/^\/+/, "")}`;
    const headers = buildHeaders(providerName, secretKey, channelList);
    return withTimeout((signal) => postJson(url, payload, headers, signal), requestTimeoutMs);
  }

  async function call(path, payload) {
    return callWithConfig(resolvedBaseUrl, path, payload, resolvedProvider, resolvedKey, resolvedChannels, resolvedTimeoutMs);
  }

  async function callRail(path, payload) {
    return callWithConfig(resolvedRailBaseUrl, path, payload, resolvedRailProvider, resolvedRailKey, resolvedRailChannels, resolvedRailTimeoutMs);
  }

  return {
    enabled,
    baseUrl: resolvedBaseUrl || null,
    provider: resolvedProvider,
    channels: resolvedChannels,
    mode: resolvedBaseUrl ? "external_contract" : resolvedKey ? "key_only_mock" : "mock",
    railEnabled,
    railBaseUrl: resolvedRailBaseUrl || null,
    railProvider: resolvedRailProvider,
    railChannels: resolvedRailChannels,
    railMode: resolvedRailBaseUrl ? (hasDedicatedRailConfig ? "direct_contract" : "external_contract") : railEnabled ? "key_only_mock" : "mock",
    liveRailInventorySource: railInventorySource,

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
      if (!isLocalBookingFallbackEnabled()) {
        return {
          enabled: false,
          lockId: null,
          expiresInSec: 0,
          city,
          latency: jitter(),
          providerSource: resolvedProvider || "partner_hub",
          errorCode: "booking_provider_not_configured",
        };
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
      if (!isLocalBookingFallbackEnabled()) {
        return {
          enabled: false,
          ticketRef: null,
          city,
          latency: jitter(),
          providerSource: resolvedProvider || "partner_hub",
          errorCode: "transport_provider_not_configured",
        };
      }
      return {
        enabled: true,
        ticketRef: `PH-TR-${Date.now().toString().slice(-6)}`,
        city,
        latency: jitter(),
        providerSource: resolvedProvider || "partner_hub",
      };
    },

    // Live rail inventory adapter. Priority order:
    // 1. external rail provider contract when configured
    // 2. built-in 12306 live query when external rail is absent
    // 3. explicit unavailable result so the planner falls back to 12306 self-check copy
    async railAvailability({ origin = "", destination = "", date = "", language = "EN" } = {}) {
      if (resolvedRailBaseUrl) {
        try {
          const live = await callRail("transport/rail-availability", {
            origin,
            destination,
            date,
            language,
            provider: resolvedRailProvider,
          });
          const rows = Array.isArray(live && (live.data?.items || live.items || live.data))
            ? (live.data?.items || live.items || live.data)
            : [];
          const items = rows
            .map((item, idx) => ({
              id: String(item.id || `rail_${Date.now().toString().slice(-6)}_${idx + 1}`),
              type: String(item.type || item.mode || "train").trim().toLowerCase(),
              label: String(item.label || item.name || item.trainNo || item.train_no || "").trim(),
              trainNo: String(item.trainNo || item.train_no || "").trim(),
              fromStation: String(item.fromStation || item.from_station || origin || "").trim(),
              toStation: String(item.toStation || item.to_station || destination || "").trim(),
              depTime: String(item.depTime || item.dep_time || "").trim(),
              arrTime: String(item.arrTime || item.arr_time || "").trim(),
              durationMin: Math.max(0, safeNum(item.durationMin || item.duration_min, 0)),
              priceCny: Math.max(0, safeNum(item.priceCny || item.price_cny || item.price, 0)),
              seatsLeft: Math.max(0, safeNum(item.seatsLeft || item.seats_left, 0)),
              seatLabel: String(item.seatLabel || item.seat_label || item.seatType || "").trim(),
              bookingUrl: String(item.bookingUrl || item.url || "").trim(),
              providerSource: String(item.provider || resolvedRailProvider || "partner_hub"),
              latency: Math.max(1, safeNum(item.latencyMs || item.latency, jitter())),
            }))
            .filter((item) => item.label || item.trainNo);
          if (items.length) {
            return {
              enabled: true,
              items,
              latency: Math.max(1, safeNum(live && (live.latencyMs || live.latency), jitter())),
              providerSource: resolvedRailProvider || "partner_hub",
              inventorySource: String(live && (live.inventorySource || live.data?.inventorySource) || railInventorySource),
            };
          }
        } catch {
          // continue to builtin 12306 fallback below.
        }
      }

      try {
        const builtinRail = await queryBuiltin12306RailAvailability({
          origin,
          destination,
          date,
          timeoutMs: Math.max(1800, resolvedRailTimeoutMs || 5000),
        });
        if (builtinRail && builtinRail.enabled && Array.isArray(builtinRail.items) && builtinRail.items.length) {
          return builtinRail;
        }
        if (builtinRail && builtinRail.errorCode && builtinRail.errorCode !== "rail_no_results") {
          return builtinRail;
        }
      } catch {
        // continue to explicit unavailable result.
      }

      return {
        enabled: false,
        items: [],
        latency: jitter(),
        providerSource: resolvedRailBaseUrl ? (resolvedRailProvider || "partner_hub") : "builtin_12306",
        inventorySource: resolvedRailBaseUrl ? railInventorySource : "builtin_12306_rail_live",
        errorCode: resolvedRailBaseUrl ? "rail_provider_unavailable" : "rail_provider_not_configured",
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
      if (!isLocalCandidateFallbackEnabled()) {
        return {
          enabled: false,
          items: [],
          latency: jitter(),
          providerSource: resolvedProvider || "partner_hub",
          channels: resolvedChannels,
          mode: resolvedBaseUrl ? "external_contract_unavailable" : "unavailable",
          errorCode: "candidate_provider_not_configured",
        };
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
  isLocalBookingFallbackEnabled,
  isLocalCandidateFallbackEnabled,
};
