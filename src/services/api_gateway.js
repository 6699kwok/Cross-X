"use strict";
/**
 * src/services/api_gateway.js
 * CrossX API Gateway — Jutui (聚推客) restaurants, Juhe FX rates, APIFOX proxy
 *
 * Design principles:
 *  1. Every third-party brand name is stripped via sanitizeText() before LLM consumption.
 *  2. All functions degrade gracefully: missing API keys → plausible mock data, never throws.
 *  3. FX rates are cached 5 min in-process; restaurants are cached 10 min.
 *  4. API tokens consumed server-side only; never exposed to browser.
 *
 * Jutui (聚推客) auth: GET http://api.jutuike.com/<path>?apikey=TOKEN[&...]
 * Juhe FX auth:       GET http://op.juhe.cn/onebox/exchange/query?key=KEY&from=CNY
 */

// ── External API bases ────────────────────────────────────────────────────
const JUTUI_BASE   = "http://api.jutuike.com";
const JUHE_FX_URL  = "http://op.juhe.cn/onebox/exchange/query";
const APIFOX_BASE  = "https://api.apifox.com/v1";

// ── Brand sanitization ────────────────────────────────────────────────────
const BRAND_PATTERNS = [
  [/美团/g,     "CrossX"],
  [/聚合数据/g, "CrossX Data"],
  [/聚推客/g,   "CrossX Deals"],
  [/聚推客?e/gi,"CrossX Deals"],
  [/携程/g,     "CrossX Travel"],
  [/高德地图?/g,"CrossX Maps"],
  [/百度地图?/g,"CrossX Maps"],
  [/阿里云/g,   "CrossX Cloud"],
  [/腾讯云/g,   "CrossX Cloud"],
  [/微信支付/g, "CrossX Pay"],
  [/支付宝/g,   "CrossX Pay"],
  [/饿了么/g,   "CrossX Food"],
  [/滴滴/g,     "CrossX Ride"],
  [/Meituan/gi, "CrossX"],
  [/Ctrip/gi,   "CrossX Travel"],
  [/JuHe/gi,    "CrossX Data"],
  [/Jutui(ke)?/gi, "CrossX Deals"],
  [/Eleme/gi,   "CrossX Food"],
  [/Didi/gi,    "CrossX Ride"],
];

function sanitizeText(text) {
  if (!text || typeof text !== "string") return text;
  let out = text;
  BRAND_PATTERNS.forEach(([pat, rep]) => { out = out.replace(pat, rep); });
  return out;
}

// ── In-process caches ─────────────────────────────────────────────────────
const _cache = {
  fx:          { data: null, ts: 0 },
  restaurants: new Map(),   // cacheKey → { data, ts }
};
const FX_TTL         = 5  * 60 * 1000;
const RESTAURANT_TTL = 10 * 60 * 1000;

// ── City → coordinates lookup (GCJ-02) ────────────────────────────────────
const CITY_COORDS = {
  "北京":   { lat: 39.9042, lng: 116.4074 },
  "上海":   { lat: 31.2304, lng: 121.4737 },
  "广州":   { lat: 23.1291, lng: 113.2644 },
  "深圳":   { lat: 22.5431, lng: 114.0579 },
  "成都":   { lat: 30.5728, lng: 104.0668 },
  "重庆":   { lat: 29.5630, lng: 106.5516 },
  "杭州":   { lat: 30.2741, lng: 120.1551 },
  "武汉":   { lat: 30.5928, lng: 114.3055 },
  "西安":   { lat: 34.3416, lng: 108.9398 },
  "南京":   { lat: 32.0603, lng: 118.7969 },
  "苏州":   { lat: 31.2990, lng: 120.5853 },
  "天津":   { lat: 39.1256, lng: 117.1901 },
  "青岛":   { lat: 36.0671, lng: 120.3826 },
  "厦门":   { lat: 24.4798, lng: 118.0894 },
  "三亚":   { lat: 18.2524, lng: 109.5119 },
  "丽江":   { lat: 26.8721, lng: 100.2330 },
  "大理":   { lat: 25.6065, lng: 100.2676 },
  "桂林":   { lat: 25.2736, lng: 110.2907 },
  "张家界":  { lat: 29.1250, lng: 110.4799 },
  "黄山":   { lat: 29.7144, lng: 118.3377 },
  "乌鲁木齐": { lat: 43.8256, lng: 87.6168 },
  "拉萨":   { lat: 29.6520, lng: 91.1721 },
  "西宁":   { lat: 36.6232, lng: 101.7782 },
  "新疆":   { lat: 43.7930, lng: 87.6270 },
  "哈尔滨":  { lat: 45.8038, lng: 126.5349 },
  "长沙":   { lat: 28.2282, lng: 112.9388 },
  "昆明":   { lat: 25.0453, lng: 102.7097 },
  "贵阳":   { lat: 26.6470, lng: 106.6302 },
  "福州":   { lat: 26.0745, lng: 119.2965 },
  "济南":   { lat: 36.6512, lng: 117.1201 },
  "郑州":   { lat: 34.7466, lng: 113.6254 },
  "沈阳":   { lat: 41.8057, lng: 123.4315 },
};

function _getCityCoords(cityName) {
  if (!cityName) return null;
  const key = Object.keys(CITY_COORDS).find(
    (k) => cityName.includes(k) || k.includes(cityName)
  );
  return key ? CITY_COORDS[key] : null;
}

// ── Juhe FX Rates ─────────────────────────────────────────────────────────
/**
 * Returns CNY→foreign rate map (1 CNY = X foreign).
 * Falls back to hardcoded mock if JUHE_KEY absent or request fails.
 * Juhe response format: list rows = [zh_name, base_qty, buy_rate, ..., sell_rate, ...]
 * Meaning: base_qty foreign = buy_rate CNY → 1 CNY = base_qty/buy_rate foreign
 */
const MOCK_RATES = {
  USD: 0.1462,
  EUR: 0.1240,
  JPY: 22.86,
  KRW: 211.7,
  MYR: 0.648,    // not in Juhe list — always mock
  HKD: 1.144,
};

// Map Chinese currency names → ISO codes
const ZH_TO_ISO = {
  "美元":  "USD",
  "欧元":  "EUR",
  "日元":  "JPY",
  "韩元":  "KRW",
  "港币":  "HKD",
  "马来西亚林吉特": "MYR",
  "新加坡元": "SGD",
  "英镑":  "GBP",
  "澳大利亚元": "AUD",
  "泰国铢": "THB",
};

async function fetchFxRates() {
  const key = process.env.JUHE_KEY || "";
  const now = Date.now();
  if (_cache.fx.data && now - _cache.fx.ts < FX_TTL) return _cache.fx.data;

  if (!key) {
    _cache.fx.data = { ...MOCK_RATES, _source: "mock" };
    _cache.fx.ts   = now;
    return _cache.fx.data;
  }

  try {
    // One call returns ALL currencies — much more efficient than 6 parallel calls
    const res  = await fetch(`${JUHE_FX_URL}?key=${encodeURIComponent(key)}&from=CNY`, {
      signal: AbortSignal.timeout(5000),
    });
    const json = await res.json();

    if (json.error_code !== 0 || !Array.isArray(json.result?.list)) {
      throw new Error(`Juhe error: ${json.error_code}`);
    }

    const rates = { ...MOCK_RATES };  // start with mocks (especially MYR)
    json.result.list.forEach((row) => {
      // row = [zh_name, base_qty_str, buy_rate_str, ...]
      const zhName  = row[0];
      const baseQty = parseFloat(row[1]) || 100;
      const buyRate = parseFloat(row[2]) || 0;
      const iso     = ZH_TO_ISO[zhName];
      if (iso && buyRate > 0) {
        // base_qty foreign = buyRate CNY → 1 CNY = base_qty/buyRate foreign
        rates[iso] = parseFloat((baseQty / buyRate).toFixed(6));
      }
    });

    _cache.fx.data = { ...rates, _source: "live" };
    _cache.fx.ts   = now;
    return _cache.fx.data;
  } catch {
    _cache.fx.data = { ...MOCK_RATES, _source: "mock" };
    _cache.fx.ts   = now;
    return _cache.fx.data;
  }
}

// ── Jutui (聚推客) Restaurant/Store Service ────────────────────────────────
/**
 * Fetches nearby restaurant/store deals from 饿了么 CPS via Jutui.
 * Endpoint: GET http://api.jutuike.com/ele/store_list
 * Required: apikey, latitude, longitude
 * Optional: keyword (search term)
 *
 * If cityName has no coords mapping, falls back to stub data.
 */
async function fetchJutuiRestaurants(cityName = "", keyword = "美食", maxItems = 4) {
  const token = process.env.JUTUI_TOKEN || "";
  const ck    = `${cityName}:${keyword}:${maxItems}`;
  const now   = Date.now();
  const hit   = _cache.restaurants.get(ck);
  if (hit && now - hit.ts < RESTAURANT_TTL) return hit.data;

  const stub = _makeRestaurantStub(cityName, keyword);

  if (!token) {
    _cache.restaurants.set(ck, { data: stub, ts: now });
    return stub;
  }

  const coords = _getCityCoords(cityName);
  if (!coords) {
    _cache.restaurants.set(ck, { data: stub, ts: now });
    return stub;
  }

  try {
    const qs = new URLSearchParams({
      apikey:    token,
      latitude:  String(coords.lat),
      longitude: String(coords.lng),
      keyword:   keyword,
    });
    const res  = await fetch(`${JUTUI_BASE}/ele/store_list?${qs}`, {
      signal: AbortSignal.timeout(6000),
    });
    const json = await res.json();

    if (json.code !== 1 || !json.data) {
      throw new Error(`Jutui error: ${json.msg}`);
    }

    const records = json.data.records?.store_promotion_dto || [];
    const items   = records.slice(0, maxItems).map((s) => ({
      shop_name:    sanitizeText(s.title || ""),
      monthly_sales: s.indistinct_monthly_sales || "",
      commission:   s.commission || 0,
      commission_rate: s.commission_rate || "0",
      shop_logo:    s.shop_logo || "",
      wx_path:      s.link?.wx_path || "",
      biz_type:     s.biz_type || "",
      is_live:      true,
    }));

    const result = items.length > 0 ? items : stub;
    _cache.restaurants.set(ck, { data: result, ts: now });
    return result;
  } catch {
    _cache.restaurants.set(ck, { data: stub, ts: now });
    return stub;
  }
}

function _makeRestaurantStub(city, keyword) {
  return [
    {
      shop_name:    `CrossX ${sanitizeText(city || keyword)} 精选美食`,
      monthly_sales: "月售3000+",
      commission:   200,
      commission_rate: "0.06",
      shop_logo:    "",
      wx_path:      "",
      biz_type:     "stub",
      is_live:      false,
    },
  ];
}

// ── Jutui Didi (滴滴) Orders ────────────────────────────────────────────────
/**
 * Fetches Didi order list for the user (orders placed via affiliate links).
 * Returns empty array when no orders exist (expected for new affiliates).
 */
async function fetchDidiOrders() {
  const token = process.env.JUTUI_TOKEN || "";
  if (!token) return [];
  try {
    const res  = await fetch(`${JUTUI_BASE}/didi/orders?apikey=${encodeURIComponent(token)}`, {
      signal: AbortSignal.timeout(5000),
    });
    const json = await res.json();
    return Array.isArray(json.data) ? json.data : [];
  } catch { return []; }
}

// ── APIFOX Data Proxy ─────────────────────────────────────────────────────
/**
 * Generic proxy to APIFOX project APIs.
 * Token read from process.env.APIFOX_TOKEN (never exposed client-side).
 * Returns null gracefully if token missing or request fails.
 */
async function fetchApifoxData(endpoint, params = {}, method = "GET") {
  const token = process.env.APIFOX_TOKEN;
  if (!token) return null;

  try {
    const qs  = method === "GET" ? "?" + new URLSearchParams(params).toString() : "";
    const url = `${APIFOX_BASE}${endpoint}${qs}`;
    const res = await fetch(url, {
      method,
      headers: {
        "Authorization": `Bearer ${token}`,
        "X-Apifox-Language": "zh-CN",
        "Content-Type": "application/json",
      },
      ...(method !== "GET" ? { body: JSON.stringify(params) } : {}),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// ── XHS-style Authentic Review Synthesizer ────────────────────────────────
const XHS_VIBES = {
  ZH: ["超适合情侣出行✨", "性价比拉满🔥", "宝藏路线 GET！", "回头客强烈推荐💯", "细节满满绝了"],
  EN: ["Absolutely hidden gem ✨", "Worth every penny 🔥", "Must-book NOW!", "Vibes were immaculate 💯", "10/10 would revisit"],
  JA: ["最高すぎる体験✨", "コスパ最強クラス🔥", "絶対行くべき！", "また絶対来る💯", "想像以上に良かった"],
  KO: ["완전 강추해요✨", "가성비 진짜 최고🔥", "꼭 가보세요！", "다시 오고 싶다💯", "기대 이상이었어요"],
  MY: ["Sangat berbaloi✨", "Value for money🔥", "Wajib pergi！", "Pengalaman terbaik💯", "Memang tak rugi"],
};

function generateXhsReview(highlights = [], lang = "ZH") {
  const vibes = XHS_VIBES[lang] || XHS_VIBES.EN;
  const vibe  = vibes[Math.floor(Math.random() * vibes.length)];
  const h     = highlights[0] ? sanitizeText(highlights[0]) : "";
  return h ? `${vibe} — ${h}` : vibe;
}

module.exports = {
  sanitizeText,
  fetchFxRates,
  fetchJutuiRestaurants,
  fetchDidiOrders,
  fetchApifoxData,
  generateXhsReview,
};
