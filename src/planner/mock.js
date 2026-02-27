"use strict";
/**
 * src/planner/mock.js
 * Mock data layer (AMap routing + Ctrip hotels) — extracted from server.js
 * Also exports safeParseJson utility used across the planner pipeline.
 */

// ── safeParseJson — tolerant JSON extractor for LLM output ───────────────────
function safeParseJson(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { /* fall through */ }
  const stripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try { return JSON.parse(stripped); } catch { /* fall through */ }
  const match = stripped.match(/(\{[\s\S]*\}|\[[\s\S]*\])/m);
  if (match) {
    try { return JSON.parse(match[1]); } catch { /* fall through */ }
  }
  return null;
}

// ── Known Chinese city names (for reliable destination extraction) ───────────
const CHINA_CITIES_RE = /北京|上海|广州|深圳|成都|西安|杭州|南京|武汉|重庆|厦门|苏州|青岛|大连|哈尔滨|长沙|郑州|西宁|乌鲁木齐|昆明|贵阳|南宁|海口|三亚|丽江|桂林|张家界|黄山|敦煌|拉萨|香港|澳门|台北|台湾/;

// ── Mock AMap Routing — 8 major inter-city corridors ────────────────────────
const AMAP_ROUTES = {
  "shenzhen→xian":     { modes:[{type:"flight",label:"航班",duration_min:165,price_cny:950,freq:"每日8班"},{type:"hsr",label:"高铁（需中转武汉）",duration_min:780,price_cny:720,freq:"每日3班"}], recommended:"flight", note:"宝安机场→咸阳机场，建议提前2小时到达机场" },
  "xian→shenzhen":     { modes:[{type:"flight",label:"航班",duration_min:165,price_cny:950,freq:"每日8班"}], recommended:"flight", note:"咸阳机场→宝安机场" },
  "shenzhen→urumqi":   { modes:[{type:"flight",label:"航班",duration_min:270,price_cny:1400,freq:"每日4班"}], recommended:"flight", note:"宝安机场→地窝堡机场，无直达高铁" },
  "xian→urumqi":       { modes:[{type:"flight",label:"航班",duration_min:190,price_cny:1100,freq:"每日5班"},{type:"train",label:"普速火车",duration_min:1620,price_cny:450,freq:"每日2班"}], recommended:"flight", note:"咸阳机场→地窝堡机场" },
  "shenzhen→beijing":  { modes:[{type:"flight",label:"航班",duration_min:195,price_cny:1100,freq:"每日20班"},{type:"hsr",label:"G高铁",duration_min:510,price_cny:870,freq:"每日12班"}], recommended:"flight", note:"宝安机场→首都/大兴机场" },
  "shenzhen→shanghai": { modes:[{type:"flight",label:"航班",duration_min:150,price_cny:800,freq:"每日30班"},{type:"hsr",label:"G高铁",duration_min:330,price_cny:550,freq:"每日18班"}], recommended:"hsr", note:"推荐高铁，市区间点对点省时" },
  "beijing→xian":      { modes:[{type:"hsr",label:"G高铁",duration_min:330,price_cny:600,freq:"每日15班"},{type:"flight",label:"航班",duration_min:120,price_cny:700,freq:"每日10班"}], recommended:"hsr", note:"北京西→西安北高铁站" },
  "shanghai→beijing":  { modes:[{type:"hsr",label:"G高铁",duration_min:270,price_cny:550,freq:"每日50班"},{type:"flight",label:"航班",duration_min:135,price_cny:700,freq:"每日30班"}], recommended:"hsr", note:"虹桥→北京南高铁站" },
};

function mockAmapRouting(fromCity, toCity) {
  if (!fromCity || !toCity) return null;
  const normalize = (s) => String(s).toLowerCase()
    .replace(/深圳|shenzhen/i, "shenzhen").replace(/西安|xian|xi'an/i, "xian")
    .replace(/新疆|乌鲁木齐|urumqi|xinjiang/i, "urumqi").replace(/北京|beijing/i, "beijing")
    .replace(/上海|shanghai/i, "shanghai").replace(/成都|chengdu/i, "chengdu");
  const key = normalize(fromCity) + "→" + normalize(toCity);
  const rev = normalize(toCity) + "→" + normalize(fromCity);
  return AMAP_ROUTES[key] || AMAP_ROUTES[rev] || {
    modes: [{ type: "flight", label: "航班", duration_min: 120, price_cny: 800, freq: "每日多班" }],
    recommended: "flight",
    note: `${fromCity}→${toCity}，建议查阅携程获取实时票价`,
  };
}

// ── Mock Ctrip Hotels — 6 cities × 3 tiers ───────────────────────────────────
const CTRIP_HOTELS = {
  shenzhen: [
    { tier: "budget",   name: "汉庭酒店（深圳南山科技园店）",     price_per_night: 268,  rating: 4.4, review_count: "1,024 reviews", guest_review: "Clean rooms and great value near the tech park!", district: "南山区",  image_keyword: "Hanting Hotel Shenzhen budget city view",       hero_image: "https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?w=800&q=80" },
    { tier: "balanced", name: "深圳招商格兰云天大酒店",           price_per_night: 620,  rating: 4.7, review_count: "2,381 reviews", guest_review: "Stunning bay views and excellent service.",        district: "南山区",  image_keyword: "Grand Skylight Hotel Shenzhen bay view",       hero_image: "https://images.unsplash.com/photo-1566073771259-c35e8d22cbee?w=800&q=80" },
    { tier: "premium",  name: "深圳瑞吉酒店",                    price_per_night: 1980, rating: 4.9, review_count: "986 reviews",   guest_review: "Absolutely world-class luxury — worth every penny.", district: "福田区",  image_keyword: "St Regis Shenzhen luxury skyline",             hero_image: "https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=800&q=80" },
  ],
  xian: [
    { tier: "budget",   name: "如家酒店（西安钟楼回民街店）",      price_per_night: 198,  rating: 4.3, review_count: "827 reviews",   guest_review: "Perfect location steps from the Bell Tower!",    district: "莲湖区",  image_keyword: "Home Inn Xian Bell Tower budget",             hero_image: "https://images.unsplash.com/photo-1455587734955-081b22074882?w=800&q=80" },
    { tier: "balanced", name: "西安君乐宝铂尔曼酒店",             price_per_night: 780,  rating: 4.8, review_count: "1,645 reviews", guest_review: "Modern hotel with an amazing breakfast buffet.",  district: "高新区",  image_keyword: "Pullman Xian modern hotel exterior",          hero_image: "https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=800&q=80" },
    { tier: "premium",  name: "西安万达文华酒店",                 price_per_night: 1580, rating: 4.9, review_count: "712 reviews",   guest_review: "Exquisite rooms and breathtaking rooftop views.", district: "曲江新区", image_keyword: "Wanda Vista Xian luxury pool",               hero_image: "https://images.unsplash.com/photo-1564501049412-61e9a8c59b4f?w=800&q=80" },
  ],
  urumqi: [
    { tier: "budget",   name: "汉庭酒店（乌鲁木齐火车南站店）",   price_per_night: 228,  rating: 4.2, review_count: "532 reviews",   guest_review: "Comfortable and affordable near the station.",    district: "天山区",  image_keyword: "Hanting Hotel Urumqi budget",                 hero_image: "https://images.unsplash.com/photo-1590490360182-c33d57733427?w=800&q=80" },
    { tier: "balanced", name: "乌鲁木齐凯宾斯基大酒店",           price_per_night: 860,  rating: 4.7, review_count: "1,283 reviews", guest_review: "Top hotel in the city — staff were so helpful!",  district: "天山区",  image_keyword: "Kempinski Hotel Urumqi exterior",             hero_image: "https://images.unsplash.com/photo-1566073771259-c35e8d22cbee?w=800&q=80" },
    { tier: "premium",  name: "乌鲁木齐喜来登酒店",               price_per_night: 1280, rating: 4.8, review_count: "948 reviews",   guest_review: "Luxurious rooms with stunning mountain views.",   district: "水磨沟区", image_keyword: "Sheraton Urumqi luxury hotel lobby",          hero_image: "https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=800&q=80" },
  ],
  beijing: [
    { tier: "budget",   name: "全季酒店（北京王府井步行街店）",    price_per_night: 360,  rating: 4.5, review_count: "2,104 reviews", guest_review: "Great location on Wangfujing, very clean rooms.", district: "东城区",  image_keyword: "Ji Hotel Beijing Wangfujing",                 hero_image: "https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?w=800&q=80" },
    { tier: "balanced", name: "北京日出东方凯宾斯基酒店",         price_per_night: 1150, rating: 4.7, review_count: "1,876 reviews", guest_review: "Stunning sunrise views over the city. Top service.", district: "朝阳区",  image_keyword: "Kempinski Hotel Beijing sunrise",             hero_image: "https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=800&q=80" },
    { tier: "premium",  name: "北京柏悦酒店",                    price_per_night: 2800, rating: 4.9, review_count: "1,043 reviews", guest_review: "The Park Hyatt experience is simply incomparable.", district: "朝阳区",  image_keyword: "Park Hyatt Beijing luxury skyline",           hero_image: "https://images.unsplash.com/photo-1564501049412-61e9a8c59b4f?w=800&q=80" },
  ],
  shanghai: [
    { tier: "budget",   name: "锦江都城酒店（上海南京西路店）",    price_per_night: 320,  rating: 4.4, review_count: "1,732 reviews", guest_review: "Modern rooms, steps from Nanjing Road shopping.", district: "静安区",  image_keyword: "Metropolo Hotel Shanghai Nanjing Road",       hero_image: "https://images.unsplash.com/photo-1455587734955-081b22074882?w=800&q=80" },
    { tier: "balanced", name: "上海新天地朗廷酒店",               price_per_night: 1200, rating: 4.8, review_count: "2,571 reviews", guest_review: "Pure elegance in the heart of Shanghai.",         district: "黄浦区",  image_keyword: "The Langham Shanghai Xintiandi",              hero_image: "https://images.unsplash.com/photo-1566073771259-c35e8d22cbee?w=800&q=80" },
    { tier: "premium",  name: "上海柏悦酒店（环球金融中心）",     price_per_night: 3200, rating: 4.9, review_count: "1,384 reviews", guest_review: "102nd-floor views are absolutely unreal!",        district: "浦东新区", image_keyword: "Park Hyatt Shanghai tower luxury",           hero_image: "https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=800&q=80" },
  ],
  chengdu: [
    { tier: "budget",   name: "汉庭酒店（成都春熙路天府广场店）", price_per_night: 198,  rating: 4.3, review_count: "968 reviews",   guest_review: "Clean budget option right on Chunxi Road.",      district: "锦江区",  image_keyword: "Hanting Hotel Chengdu Chunxi Road",          hero_image: "https://images.unsplash.com/photo-1590490360182-c33d57733427?w=800&q=80" },
    { tier: "balanced", name: "成都博舍酒店（太古里）",           price_per_night: 1380, rating: 4.9, review_count: "3,247 reviews", guest_review: "A design masterpiece — the courtyard is magical!", district: "锦江区",  image_keyword: "The Temple House Chengdu Taikoo Li courtyard", hero_image: "https://images.unsplash.com/photo-1564501049412-61e9a8c59b4f?w=800&q=80" },
    { tier: "premium",  name: "成都瑞吉酒店",                    price_per_night: 2200, rating: 4.9, review_count: "876 reviews",   guest_review: "Impeccable luxury with a beautiful Chengdu vibe.", district: "高新区",  image_keyword: "St Regis Chengdu luxury hotel",              hero_image: "https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=800&q=80" },
  ],
};

function mockCtripHotels(city, budgetPerNight) {
  const normalize = (s) => String(s).toLowerCase()
    .replace(/深圳|shenzhen/i, "shenzhen").replace(/西安|xian|xi'an/i, "xian")
    .replace(/新疆|乌鲁木齐|urumqi|xinjiang/i, "urumqi").replace(/北京|beijing/i, "beijing")
    .replace(/上海|shanghai/i, "shanghai").replace(/成都|chengdu/i, "chengdu");
  const key = normalize(city || "");
  const hotels = CTRIP_HOTELS[key] || [
    { tier: "budget",   name: `${city}经济型酒店（推荐如家/汉庭）`, price_per_night: 200,  rating: 4.2, review_count: "500+ reviews",   guest_review: "Convenient location and great value for money.",  district: "市中心", image_keyword: `${city} budget hotel city center`,    hero_image: "https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?w=800&q=80" },
    { tier: "balanced", name: `${city}商务酒店（推荐万怡/四点）`,  price_per_night: 600,  rating: 4.6, review_count: "1,000+ reviews",  guest_review: "Solid business hotel with excellent amenities.",   district: "商业区", image_keyword: `${city} business hotel modern`,       hero_image: "https://images.unsplash.com/photo-1566073771259-c35e8d22cbee?w=800&q=80" },
    { tier: "premium",  name: `${city}五星酒店（推荐万豪/希尔顿）`, price_per_night: 1500, rating: 4.8, review_count: "800+ reviews",   guest_review: "Absolutely superb — luxury at its finest.",       district: "核心区", image_keyword: `${city} luxury five star hotel`,      hero_image: "https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=800&q=80" },
  ];
  if (budgetPerNight) hotels.forEach((h) => { h.fits_budget = h.price_per_night <= budgetPerNight; });
  return hotels;
}

module.exports = {
  safeParseJson,
  CHINA_CITIES_RE,
  AMAP_ROUTES,
  mockAmapRouting,
  CTRIP_HOTELS,
  mockCtripHotels,
};
