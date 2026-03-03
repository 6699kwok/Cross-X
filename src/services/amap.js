"use strict";
/**
 * src/services/amap.js
 * Amap (高德地图) POI API — hotels, restaurants, attractions.
 * Reads AMAP_API_KEY from process.env at call time (no global state).
 *
 * Exports: CHAIN_RESTAURANT_RE, queryAmapPoi, queryAmapHotels, enrichPlanWithAmapData
 */

// ── Chain restaurant blocklist (global fast food / coffee / bubble tea) ──────
const CHAIN_RESTAURANT_RE = /麦当劳|肯德基|必胜客|汉堡王|华莱士|赛百味|Subway|星巴克|Starbucks|瑞幸|奈雪|喜茶|蜜雪冰城|沙县|兰州拉面|沙县小吃|正新鸡排|绝味|周黑鸭|卤味|Jollibee|Tim Hortons|Costa|COSTA|DQ|Dairy Queen|Shake Shack|Taco Bell|Popeyes|Chick-fil-A|Pizza|肯德基|KFC/i;

// ── Per-city local cuisine keyword — biases Amap toward authentic local food ─
const CITY_CUISINE_KEYWORD = {
  '上海': '本帮菜', '北京': '北京菜', '深圳': '粤菜', '成都': '川菜',
  '杭州': '浙菜', '广州': '粤菜', '重庆': '重庆火锅', '武汉': '湖北菜',
  '西安': '陕菜', '厦门': '闽南菜', '南京': '苏菜', '苏州': '苏菜',
  '青岛': '海鲜', '长沙': '湘菜', '昆明': '云南菜', '哈尔滨': '黑龙江菜',
  '天津': '津菜', '贵阳': '黔菜', '大理': '云南菜', '丽江': '云南菜',
  '桂林': '桂菜', '三亚': '海南菜', '黄山': '皖菜', '张家界': '湘菜',
  '拉萨': '藏菜', '乌鲁木齐': '新疆菜',
};

/**
 * Query Amap POI API for hotels, restaurants, or attractions in a city.
 * Returns array of { name, address, tel, rating, price, type } or null on failure.
 */
async function queryAmapPoi(city, poiType = "hotel") {
  const AMAP_API_KEY = String(process.env.AMAP_API_KEY || process.env.GAODE_API_KEY || "").trim();
  if (!AMAP_API_KEY) return null;

  // Restaurants: no types filter (Amap types override keyword relevance, causing chains to dominate)
  const typeMap = {
    hotel:      "100000",
    budget:     "100000",
    luxury:     "100000",
    halal:      "050301",
    transport:  "150200|150300",
    attraction: "110000|110100|110200|110300",
  };
  const types = typeMap[poiType] || "100000";

  // City-specific cuisine keyword gets local restaurants; generic fallback avoids "特色" (pulls chains)
  const cityKey = city.replace(/市$/, "");
  const keyword = poiType === "restaurant"
                  ? (CITY_CUISINE_KEYWORD[cityKey] || "\u5f53\u5730\u7279\u8272\u7f8e\u98df")  // 当地特色美食
                  : poiType === "attraction" ? "\u666f\u70b9"                                    // 景点
                  : "\u9152\u5e97";                                                               // 酒店

  // For restaurants: omit types filter — Amap types override keyword relevance
  // and cause chain restaurants (KFC/McDonald's) to dominate via review count.
  // Cuisine keyword alone produces accurate local results.
  const typesParam = poiType === "restaurant" ? "" : `&types=${types}`;
  const url = `https://restapi.amap.com/v3/place/text?key=${AMAP_API_KEY}` +
    `&keywords=${encodeURIComponent(keyword)}` +
    `&city=${encodeURIComponent(city)}&citylimit=true` +
    `${typesParam}&extensions=all&offset=20&output=JSON`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!resp.ok) { console.warn("[amap] HTTP", resp.status); return null; }
    const data = await resp.json();
    if (String(data.status) !== "1" || !Array.isArray(data.pois) || !data.pois.length) {
      console.warn("[amap] status!=1 or empty pois, info:", data.info);
      return null;
    }

    let pois = data.pois.map((p) => ({
      name:      String(p.name || ""),
      address:   String(Array.isArray(p.address) ? p.address.join("") : (p.address || "")),
      tel:       String(Array.isArray(p.tel) ? p.tel[0] : (p.tel || "")),
      rating:    p.biz_ext ? (parseFloat(p.biz_ext.rating) || 0) : 0,
      price:     p.biz_ext ? (parseFloat(Array.isArray(p.biz_ext.cost) ? 0 : p.biz_ext.cost) || 0) : 0,
      open_time: p.biz_ext ? (String(p.biz_ext.open_time || "")).trim() : "",
      area:      String(p.adname || p.pname || city),
      type:      String(p.type || ""),
    })).filter((p) => p.name);

    // For restaurants: filter chains + low-price fast food, sort by local quality
    if (poiType === "restaurant") {
      pois = pois
        .filter((p) => !CHAIN_RESTAURANT_RE.test(p.name))   // remove global chains
        .filter((p) => p.price === 0 || p.price >= 18)      // remove sub-¥18 fast food
        .sort((a, b) => {
          // Score = rating * 10 + log(price+1) — higher rating + reasonable price wins
          const scoreA = (a.rating || 3.5) * 10 + Math.log((a.price || 30) + 1);
          const scoreB = (b.rating || 3.5) * 10 + Math.log((b.price || 30) + 1);
          return scoreB - scoreA;
        });
      console.log(`[amap] restaurant filter: ${data.pois.length} → ${pois.length} local specialty for ${city}`);
    }

    // For attractions: strip any hotels/guesthouses that leaked in, sort by rating
    if (poiType === "attraction") {
      pois = pois
        .filter((p) => !/\u9152\u5e97|\u5bbe\u9986|\u65c5\u9986|\u6c11\u5bbf|\u516c\u5bd3|\u5ba2\u6808|hostel/i.test(p.name))
        .sort((a, b) => (b.rating || 0) - (a.rating || 0));
      // 酒店|宾馆|旅馆|民宿|公寓|客栈|hostel
      console.log(`[amap] attraction filter: ${data.pois.length} \u2192 ${pois.length} attractions for ${city}`);
    }

    return pois;
  } catch (e) {
    console.warn("[amap] error:", e.message);
    return null;
  }
}

/**
 * Enrich a mockBuildThreeTierPlans() options_card with real Amap hotel data.
 * Replaces hotel_name and area per tier if data is available.
 */
async function enrichPlanWithAmapData(plan, city) {
  const pois = await queryAmapPoi(city, "hotel");
  if (!pois || pois.length < 3) return plan; // not enough data, keep mock

  // Sort by rating desc; partition into luxury (rating≥4.5), mid, budget
  const sorted = [...pois].sort((a, b) => (b.rating || 0) - (a.rating || 0));
  const luxury  = sorted.filter((p) => p.rating >= 4.5).slice(0, 5);
  const mid     = sorted.filter((p) => p.rating >= 4.0 && p.rating < 4.5).slice(0, 5);
  const budget  = sorted.filter((p) => p.rating < 4.0 || p.price < 300).slice(0, 5);

  const pick = (pool, fallback) => pool[Math.floor(Math.random() * pool.length)] || fallback;

  const enrichOpt = (opt) => {
    let pool;
    if (opt.tag && /极致|豪华|高端|premium/i.test(opt.tag)) pool = luxury;
    else if (opt.tag && /均衡|推荐|balanced/i.test(opt.tag)) pool = mid.length ? mid : sorted;
    else pool = budget.length ? budget : sorted.slice(-3);
    const poi = pick(pool, null);
    if (!poi) return opt;
    return {
      ...opt,
      hotel_name: poi.price > 0
        ? `${poi.name}（${poi.area}，约¥${poi.price}/晚）`
        : `${poi.name}（${poi.area}）`,
      hotel_address: poi.address || opt.hotel_address || "",
      hotel_tel: poi.tel || opt.hotel_tel || "",
      hotel_rating: poi.rating || opt.hotel_rating || "",
    };
  };

  return {
    ...plan,
    options: plan.options.map(enrichOpt),
    data_source: "amap",
  };
}

/**
 * queryAmapHotels — fetch real hotels from Amap POI and return them
 * in the same 3-tier shape as mockCtripHotels(), so pipeline.js can
 * drop-in replace the mock without any other changes.
 */
async function queryAmapHotels(city, budgetPerNight) {
  const pois = await queryAmapPoi(city, "hotel");
  if (!pois || pois.length < 2) return null; // fall back to mock

  // Classify by Amap type string (e.g. "住宿服务;宾馆酒店;五星级宾馆")
  const isLuxury = (p) => /五星|五星级|豪华|luxury|resort|瑞吉|四季|柏悦|君悦|丽思|洲际/i.test(p.type + p.name);
  const isBudget = (p) => /经济型|快捷|连锁|如家|汉庭|7天|青年旅|旅舍|hostel|民宿|公寓|客栈|招待所/i.test(p.type + p.name);

  const luxuryPool = pois.filter(isLuxury);
  const budgetPool = pois.filter((p) => isBudget(p) && !isLuxury(p));
  const midPool    = pois.filter((p) => !isLuxury(p) && !isBudget(p));

  // Fallback: partition by rating + price, never put budget-type into premium
  const byRating = [...pois].sort((a, b) => (b.rating || 0) - (a.rating || 0));
  const eligiblePremium = byRating.filter((p) => !isBudget(p) && (p.rating || 0) >= 4.0);
  const eligibleMid     = byRating.filter((p) => !isBudget(p) && (p.rating || 0) >= 3.5);
  const fallbackLuxury  = eligiblePremium.length ? eligiblePremium : byRating.filter((p) => !isBudget(p));
  const fallbackMid     = eligibleMid.length     ? eligibleMid     : byRating.filter((p) => !isBudget(p));
  const fallbackBudget  = byRating;

  const all = pois;

  const pick = (pool, fb) => pool[Math.floor(Math.random() * Math.max(pool.length, 1))] || fb || all[0];

  const HERO_SEEDS = [
    "https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?w=800&q=80",
    "https://images.unsplash.com/photo-1566073771259-c35e8d22cbee?w=800&q=80",
    "https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=800&q=80",
  ];

  const makeHotel = (poi, tier, idx) => {
    const ppn = poi.price || (idx === 0 ? 220 : idx === 1 ? 580 : 1400);
    return {
      tier,
      name:           poi.name,
      price_per_night: ppn,
      rating:          poi.rating || 4.2,
      review_count:    "高德评分",
      guest_review:    tier === "budget" ? "价格实惠，位置便利，性价比高" :
                       tier === "balanced" ? "服务好，环境舒适，推荐入住" :
                       "高端体验，设施完善，服务一流",
      district:        poi.area || city,
      address:         poi.address || "",
      tel:             poi.tel || "",
      hero_image:      HERO_SEEDS[idx] || HERO_SEEDS[0],
      booking_url:     `https://m.ctrip.com/webapp/hotel/search/?keyword=${encodeURIComponent(poi.name)}`,
      source:          "amap",
      fits_budget:     budgetPerNight ? ppn <= budgetPerNight : undefined,
    };
  };

  return [
    makeHotel(pick(budgetPool,  fallbackBudget[0]),  "budget",   0),
    makeHotel(pick(midPool,     fallbackMid[0]),     "balanced", 1),
    makeHotel(pick(luxuryPool,  fallbackLuxury[0]),  "premium",  2),
  ];
}

module.exports = { CHAIN_RESTAURANT_RE, queryAmapPoi, queryAmapHotels, enrichPlanWithAmapData };
