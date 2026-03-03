"use strict";
/**
 * src/services/amapRouting.js
 * Real Amap inter-city routing: geocode → transit/integrated + driving
 * Returns mock-compatible format: { modes[], recommended, note, _source }
 * Returns null on any hard failure so callers can fall back to mock data.
 */

const AMAP_BASE   = "https://restapi.amap.com/v3";
const TIMEOUT_MS  = 5500;
const GEO_CACHE   = new Map(); // in-process geocode cache (session lifetime)

// ── Helpers ──────────────────────────────────────────────────────────────────

async function fetchJson(url) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    clearTimeout(timer);
    return null;
  }
}

async function geocodeCity(key, cityName) {
  const cacheKey = cityName.toLowerCase().trim();
  if (GEO_CACHE.has(cacheKey)) return GEO_CACHE.get(cacheKey);
  const url = `${AMAP_BASE}/geocode/geo?key=${encodeURIComponent(key)}&address=${encodeURIComponent(cityName)}&output=JSON`;
  const data = await fetchJson(url);
  const loc  = data?.geocodes?.[0]?.location || null;
  if (loc) GEO_CACHE.set(cacheKey, loc);
  return loc;
}

/**
 * Classify a Chinese transit line name into hsr / train / null.
 * Amap returns line names like "G105次(北京南-上海虹桥)" or "K8次(上海-乌鲁木齐)".
 */
function classifyRailLine(name = "") {
  if (/高铁|高速铁路|\bG\d{1,5}\b/.test(name)) return "hsr";
  if (/动车|\bD\d{1,5}\b/.test(name))           return "hsr"; // D-trains counted as hsr
  if (/特快|\bZ\d{1,4}\b/.test(name))            return "train";
  if (/快速|\bT\d{1,4}\b/.test(name))            return "train";
  if (/快车|\bK\d{1,4}\b/.test(name))            return "train";
  if (/普快|普速|\bY\d{1,4}\b/.test(name))       return "train";
  return null;
}

function parseCostYuan(costStr) {
  if (!costStr && costStr !== 0) return null;
  const n = parseFloat(String(costStr).replace(/[^\d.]/g, ""));
  return isNaN(n) || n === 0 ? null : Math.round(n);
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Query real Amap APIs for inter-city routing.
 * @param {string} fromCity  e.g. "深圳" | "Shenzhen"
 * @param {string} toCity    e.g. "北京" | "Beijing"
 * @returns {object|null}  { modes[], recommended, note, _source:"amap_live" }
 *                         or null if data unavailable (caller falls back to mock)
 */
async function queryAmapRouting(fromCity, toCity) {
  const key = String(process.env.AMAP_API_KEY || "").trim();
  if (!key) return null;

  // 1. Geocode both cities in parallel
  const [originLoc, destLoc] = await Promise.all([
    geocodeCity(key, fromCity),
    geocodeCity(key, toCity),
  ]);
  if (!originLoc || !destLoc) {
    console.warn(`[amapRouting] geocode failed: ${fromCity}→${toCity}`);
    return null;
  }

  // Strip 市/省 suffix for city parameters
  const fromShort = fromCity.replace(/[市省自治区直辖市特别行政区]$/, "");
  const toShort   = toCity.replace(/[市省自治区直辖市特别行政区]$/, "");

  // 2. Fire transit + driving queries in parallel
  const transitUrl = `${AMAP_BASE}/direction/transit/integrated` +
    `?key=${encodeURIComponent(key)}` +
    `&origin=${originLoc}&destination=${destLoc}` +
    `&city=${encodeURIComponent(fromShort)}&cityd=${encodeURIComponent(toShort)}` +
    `&nightflag=0&output=JSON`;
  const drivingUrl = `${AMAP_BASE}/direction/driving` +
    `?key=${encodeURIComponent(key)}` +
    `&origin=${originLoc}&destination=${destLoc}` +
    `&strategy=0&output=JSON`;

  const [transitData, drivingData] = await Promise.all([
    fetchJson(transitUrl),
    fetchJson(drivingUrl),
  ]);

  const modes    = [];
  const seenTypes = new Set();

  // 3. Parse transit (HSR / train) — scan each transit option's segments
  const transits = transitData?.route?.transits || [];
  for (const t of transits.slice(0, 10)) {
    const durationMin = Math.round(Number(t.duration || 0) / 60);
    if (durationMin < 5) continue;
    const priceAround = parseCostYuan(t.cost);
    const segments    = t.segments || [];
    for (const seg of segments) {
      const buslines = seg?.bus?.buslines || [];
      for (const bl of buslines) {
        const type = classifyRailLine(bl.name || "");
        if (!type || seenTypes.has(type)) continue;
        seenTypes.add(type);
        modes.push({
          type,
          label:       bl.name || (type === "hsr" ? "高铁" : "火车"),
          duration_min: durationMin,
          ...(priceAround ? { price_cny: priceAround } : {}),
          _source: "amap_live",
        });
      }
    }
    if (seenTypes.size >= 2) break; // enough transit modes found
  }

  // 4. Parse driving distance (always useful for context + flight estimation)
  const drivePath = drivingData?.route?.paths?.[0];
  let   distKm    = 0;
  if (drivePath) {
    distKm = Math.round(Number(drivePath.distance || 0) / 1000);
    const driveMin = Math.round(Number(drivePath.duration || 0) / 60);
    if (distKm > 0 && driveMin > 0) {
      modes.push({
        type: "drive",
        label: `自驾 (${distKm} km)`,
        duration_min: driveMin,
        _source: "amap_live",
      });
      seenTypes.add("drive");
    }
  }

  if (modes.length === 0) {
    console.warn(`[amapRouting] no usable routes from Amap: ${fromCity}→${toCity}`);
    return null;
  }

  // 5. For long routes (>700 km driving), add estimated flight option
  if (distKm > 700 && !seenTypes.has("flight")) {
    // Rough estimate: ~900 km/h cruise + 90 min airport overhead
    const flightMin = Math.round(distKm / 900 * 60 + 90);
    modes.unshift({
      type:         "flight",
      label:        "航班 (估算)",
      duration_min: flightMin,
      _source:      "estimated",
    });
    seenTypes.add("flight");
  }

  // 6. Determine recommended mode
  const hsrMode    = modes.find((m) => m.type === "hsr");
  const flightMode = modes.find((m) => m.type === "flight");
  let recommended  = modes[0]?.type || "drive";
  if (hsrMode && hsrMode.duration_min <= 300)      recommended = "hsr";   // ≤5h HSR wins
  else if (flightMode && distKm > 700)             recommended = "flight";
  else if (hsrMode)                                recommended = "hsr";

  const note = `${fromCity}→${toCity}，路线数据来源：高德地图`;
  console.log(`[amapRouting] ${fromCity}→${toCity}: ${modes.map((m) => m.type).join("/")} recommended=${recommended}`);
  return { fromCity, toCity, modes, recommended, note, _source: "amap_live" };
}

// ── In-city route: geocode two POI names → walk + transit + taxi ──────────────

/**
 * Geocode a place name scoped to a city (e.g. "世界之窗" in "深圳").
 * Uses a separate cache key so city context is included.
 */
async function geocodePlaceInCity(key, placeName, city) {
  const cacheKey = `${city.toLowerCase()}:${placeName.toLowerCase()}`;
  if (GEO_CACHE.has(cacheKey)) return GEO_CACHE.get(cacheKey);
  const url = `${AMAP_BASE}/geocode/geo?key=${encodeURIComponent(key)}` +
    `&address=${encodeURIComponent(placeName)}&city=${encodeURIComponent(city)}&output=JSON`;
  const data = await fetchJson(url);
  const loc  = data?.geocodes?.[0]?.location || null;
  if (loc) GEO_CACHE.set(cacheKey, loc);
  return loc;
}

/**
 * Query intra-city routes between two named places (e.g. hotel → attraction).
 * Returns { walk?, transit?, taxi?, _source } or null on failure.
 *   walk:    { min, km }
 *   transit: { min, fare_cny, transfers }
 *   taxi:    { min, cost_cny, km }
 */
async function queryLocalRoute(originName, destName, city) {
  const key = String(process.env.AMAP_API_KEY || "").trim();
  if (!key) return null;

  const cityShort = city.replace(/[市省自治区直辖市特别行政区]$/, "");

  const [origLoc, destLoc] = await Promise.all([
    geocodePlaceInCity(key, originName, cityShort),
    geocodePlaceInCity(key, destName,   cityShort),
  ]);
  if (!origLoc || !destLoc) return null;

  const walkUrl    = `${AMAP_BASE}/direction/walking` +
    `?key=${encodeURIComponent(key)}&origin=${origLoc}&destination=${destLoc}&output=JSON`;
  const transitUrl = `${AMAP_BASE}/direction/transit/integrated` +
    `?key=${encodeURIComponent(key)}&origin=${origLoc}&destination=${destLoc}` +
    `&city=${encodeURIComponent(cityShort)}&cityd=${encodeURIComponent(cityShort)}&output=JSON`;
  const drivingUrl = `${AMAP_BASE}/direction/driving` +
    `?key=${encodeURIComponent(key)}&origin=${origLoc}&destination=${destLoc}&strategy=0&output=JSON`;

  const [walkData, transitData, drivingData] = await Promise.all([
    fetchJson(walkUrl),
    fetchJson(transitUrl),
    fetchJson(drivingUrl),
  ]);

  const result = {};

  // Walking
  const walkPath = walkData?.route?.paths?.[0];
  if (walkPath) {
    const walkMin = Math.round(Number(walkPath.duration || 0) / 60);
    const walkKm  = Math.round(Number(walkPath.distance  || 0) / 100) / 10;
    if (walkMin > 0) result.walk = { min: walkMin, km: walkKm };
  }

  // Transit (metro/bus) — pick cheapest/fastest option
  const transits = transitData?.route?.transits || [];
  if (transits.length) {
    // Prefer options with fewest transfers, then shortest duration
    const best = transits.slice(0, 5).reduce((a, b) => {
      const aT = Number(a.nightwalking || a.duration || 99999);
      const bT = Number(b.nightwalking || b.duration || 99999);
      const aSeg = (a.segments || []).length;
      const bSeg = (b.segments || []).length;
      return aSeg !== bSeg ? (aSeg < bSeg ? a : b) : (aT < bT ? a : b);
    });
    const tMin  = Math.round(Number(best.duration || 0) / 60);
    const tFare = parseCostYuan(best.cost) || 0;
    const tXfer = Math.max(0, (best.segments || []).length - 1);
    if (tMin > 0) result.transit = { min: tMin, fare_cny: tFare, transfers: tXfer };
  }

  // Taxi (driving distance + rough fare estimate)
  const drivePath = drivingData?.route?.paths?.[0];
  if (drivePath) {
    const driveMin = Math.round(Number(drivePath.duration || 0) / 60);
    const distKm   = Math.round(Number(drivePath.distance || 0) / 100) / 10;
    if (driveMin > 0) {
      // Rough taxi fare: ¥13 flag-fall + ¥2.5/km, capped at reasonable max
      const taxiCost = Math.round(Math.min(13 + distKm * 2.5, 200));
      result.taxi = { min: driveMin, cost_cny: taxiCost, km: distKm };
    }
  }

  if (!Object.keys(result).length) return null;

  console.log(`[localRoute] ${originName}→${destName}(${city}): walk=${result.walk?.min}m transit=${result.transit?.min}m taxi=${result.taxi?.min}m`);
  return { ...result, _source: "amap_live" };
}

module.exports = { queryAmapRouting, queryLocalRoute };
