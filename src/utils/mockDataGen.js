"use strict";
/**
 * src/utils/mockDataGen.js
 * OpenAI-powered rich mock data generator.
 *
 * When real API data (Amap/Ctrip) is unavailable, generate realistic-looking
 * structured data with proper names, reviews, ratings, and Unsplash images.
 *
 * Image strategy: source.unsplash.com/{w}x{h}/?{keyword} — no API key required.
 * Uses English keywords mapped from Chinese categories for accurate results.
 *
 * Cache: 30-min in-memory cache per (city, type) to avoid repeat OpenAI calls.
 */

const CACHE_TTL_MS = 30 * 60 * 1000;
const _cache = new Map();

function _cached(key) {
  const e = _cache.get(key);
  if (!e || Date.now() > e.expiresAt) { _cache.delete(key); return null; }
  return e.data;
}
function _store(key, data) {
  if (_cache.size > 100) _cache.delete(_cache.keys().next().value);
  _cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

// ── City name → English pinyin (for Unsplash search accuracy) ───────────────
const CITY_PINYIN = {
  "北京":"beijing","上海":"shanghai","广州":"guangzhou","深圳":"shenzhen",
  "成都":"chengdu","西安":"xian","杭州":"hangzhou","重庆":"chongqing",
  "武汉":"wuhan","南京":"nanjing","苏州":"suzhou","青岛":"qingdao",
  "厦门":"xiamen","大理":"dali","丽江":"lijiang","张家界":"zhangjiajie",
  "桂林":"guilin","三亚":"sanya","黄山":"huangshan","拉萨":"lhasa",
  "乌鲁木齐":"urumqi","哈尔滨":"harbin","长沙":"changsha","昆明":"kunming",
  "贵阳":"guiyang","天津":"tianjin","西宁":"xining","兰州":"lanzhou",
};

function _cityEn(city) {
  const c = city.replace(/市$/, "");
  return CITY_PINYIN[c] || c;
}

// ── Curated Unsplash photo IDs (images.unsplash.com CDN — accessible in China) ─
// Using specific photo IDs avoids the blocked source.unsplash.com random search.
const ATTRACTION_PHOTOS = {
  "自然风光": "photo-1528360983277-13d401cdc186", // mountain mist china
  "历史古迹": "photo-1547981609-4b6bfe67ca0b", // great wall
  "博物馆":   "photo-1582139329536-e7284fece509", // museum interior
  "主题公园": "photo-1569880153113-76175c41776b", // theme park
  "寺庙":     "photo-1508804185872-d7badad00f7d", // chinese temple
  "公园":     "photo-1567461293-b4c4b5e2e6c1", // chinese garden
  "湖泊":     "photo-1506905925346-21bda4d32df4", // mountain lake
  "瀑布":     "photo-1501854140801-50d01698950b", // waterfall
  "古镇":     "photo-1545569341-9eb8b30979d9", // ancient town lanterns
  "海滩":     "photo-1559494007-9f5847c49d94", // beach sea
  "_default": "photo-1480796927426-f609979314bd", // china scenery
};

const CUISINE_PHOTOS = {
  "川菜":   "photo-1563245372-f21724e3856d", // chinese spicy food
  "火锅":   "photo-1569050467447-ce54b3bbc37d", // hot pot
  "粤菜":   "photo-1563379926898-05f4575a45d8", // dim sum
  "湘菜":   "photo-1585032226651-759b368d7246", // chinese noodles
  "面食":   "photo-1585032226651-759b368d7246", // noodles
  "海鲜":   "photo-1559941727-6fb446e7e8ae", // seafood
  "烧烤":   "photo-1558030006-450675393462", // grilled meat
  "_default": "photo-1414235077428-338989a2e8c0", // restaurant food
};

const HOTEL_TIER_PHOTOS = {
  "budget":   "photo-1555854877-bab0e564b8d5", // simple clean room
  "balanced": "photo-1566073771259-c35e8d22cbee", // modern hotel room
  "premium":  "photo-1542314831-068cd1dbfeeb", // luxury lobby
};

function _unsplash(photoId, w = 800, h = 480) {
  // Use images.unsplash.com CDN with specific photo ID — no search, no blocking
  return `https://images.unsplash.com/${photoId}?w=${w}&h=${h}&fit=crop&q=80`;
}

function _attractionImg(category) {
  return ATTRACTION_PHOTOS[category] || ATTRACTION_PHOTOS["_default"];
}

function _cuisineImg(cuisine) {
  if (!cuisine) return CUISINE_PHOTOS["_default"];
  for (const key of Object.keys(CUISINE_PHOTOS)) {
    if (key !== "_default" && cuisine.includes(key)) return CUISINE_PHOTOS[key];
  }
  return CUISINE_PHOTOS["_default"];
}

// ── OpenAI helper ─────────────────────────────────────────────────────────────

function _openAIConfig() {
  return {
    key:     String(process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || "").trim(),
    baseUrl: String(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, ""),
    model:   String(process.env.OPENAI_MODEL || "gpt-4o-mini").trim(),
  };
}

async function _callOpenAI(prompt, maxTokens = 1500) {
  const { key, baseUrl, model } = _openAIConfig();
  if (!key) return null;
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method:  "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "You are a China travel data API. Return ONLY valid JSON, no markdown, no comments, no explanation." },
          { role: "user",   content: prompt },
        ],
        temperature: 0.4,
        max_tokens:  maxTokens,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`openai_http_${res.status}`);
    const data = await res.json();
    const raw  = (data?.choices?.[0]?.message?.content || "").trim();
    const s = raw.indexOf("{"), e = raw.lastIndexOf("}");
    if (s === -1 || e === -1) throw new Error("no_json");
    return JSON.parse(raw.slice(s, e + 1));
  } catch (err) {
    console.warn("[mockDataGen] OpenAI error:", err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── Hotels ────────────────────────────────────────────────────────────────────

/**
 * Generate 3 realistic hotels (budget/balanced/premium) for a city.
 * Returns same shape as queryAmapHotels() so it's a drop-in fallback.
 */
async function generateRichHotels(city, budgetPerNight) {
  const cacheKey = `hotels:${city}`;
  const cached = _cached(cacheKey);
  if (cached) return cached;

  const prompt = `Generate 3 realistic hotels for ${city}, China — budget/mid-range/luxury tiers.
Return ONLY this JSON (Chinese text, tier in English):
{"hotels":[
  {"tier":"budget","name":"<hotel name>","price_per_night":<180-280>,"rating":<4.0-4.4>,"review_count":<300-800>,"guest_review":"<2-sentence Chinese review mentioning location and value, 30-50 chars>","district":"<district>","address":"<street address>","highlights":["<3 specific amenities>","",""]},
  {"tier":"balanced","name":"<hotel name>","price_per_night":<400-800>,"rating":<4.4-4.7>,"review_count":<600-2000>,"guest_review":"<2-sentence Chinese review mentioning service and comfort, 30-50 chars>","district":"<district>","address":"<address>","highlights":["<3 amenities>","",""]},
  {"tier":"premium","name":"<luxury brand hotel e.g. Marriott/Hyatt/Hilton in ${city}>","price_per_night":<900-2000>,"rating":<4.7-4.9>,"review_count":<1000-3000>,"guest_review":"<2-sentence Chinese review mentioning luxury experience, 30-50 chars>","district":"<upscale district>","address":"<address>","highlights":["<3 premium amenities>","",""]}
]}`;

  const result = await _callOpenAI(prompt, 1200);
  if (!Array.isArray(result?.hotels) || result.hotels.length < 3) return null;

  const hotels = result.hotels.map((h, i) => {
    const tier = h.tier || ["budget", "balanced", "premium"][i];
    return {
      tier,
      name:            h.name || `${city}酒店`,
      price_per_night: Number(h.price_per_night) || [220, 580, 1400][i],
      rating:          Number(h.rating) || [4.2, 4.6, 4.8][i],
      review_count:    (h.review_count ? String(h.review_count) + " 条评价" : "500+ 条评价"),
      guest_review:    h.guest_review || "住宿体验良好，地理位置便利，推荐入住。",
      district:        h.district || city,
      address:         h.address || `${city}市中心`,
      highlights:      Array.isArray(h.highlights) ? h.highlights.filter(Boolean) : [],
      hero_image:      _unsplash(HOTEL_TIER_PHOTOS[tier] || HOTEL_TIER_PHOTOS["balanced"]),
      source:          "ai_generated",
      fits_budget:     budgetPerNight ? (Number(h.price_per_night) <= budgetPerNight) : undefined,
    };
  });

  console.log(`[mockDataGen] Generated ${hotels.length} hotels for ${city}`);
  return _store(cacheKey, hotels);
}

// ── Restaurants ───────────────────────────────────────────────────────────────

/**
 * Generate 8 realistic restaurants for a city.
 * Returns enrichment shape compatible with buildAIEnrichment().
 */
async function generateRichRestaurants(city) {
  const cacheKey = `restaurants:${city}`;
  const cached = _cached(cacheKey);
  if (cached) return cached;

  const prompt = `Generate 8 local specialty restaurants for ${city}, China. Use authentic local cuisine types.
Return ONLY this JSON (no extra text):
{"spoken_text":"<vivid 1-sentence Chinese about ${city} food scene with timing tip>","restaurant_queue":<15-45>,"item_list":[{"name":"<restaurant name>","address":"<street address>","cuisine":"<specific local cuisine type>","avg_price":<25-150>,"rating":<4.0-4.9>,"review_count":<200-5000>,"guest_review":"<2-sentence Chinese review mentioning specific dish and experience, 30-50 chars>","must_order":"<signature dish>","open_hours":"<realistic hours>"}]}`;

  const result = await _callOpenAI(prompt, 1400);
  if (!Array.isArray(result?.item_list) || !result.item_list.length) return null;

  const items = result.item_list.map((r) => ({
    name:           r.name || "特色餐厅",
    address:        r.address || city,
    cuisine:        r.cuisine || "当地特色",
    avg_price:      Number(r.avg_price) || 60,
    rating:         Number(r.rating) || 4.3,
    review_count:   r.review_count || 500,
    guest_review:   r.guest_review || "菜品正宗，用料新鲜，强烈推荐招牌菜。",
    must_order:     r.must_order || "",
    open_hours:     r.open_hours || "10:00-22:00",
    // Use our cuisine→image map for accurate Unsplash results
    real_photo_url: _unsplash(_cuisineImg(r.cuisine)),
    queue_min:      Math.round(Number(result.restaurant_queue) || 20),
  }));

  const enrichment = {
    spoken_text:         result.spoken_text || `${city}美食丰富，建议提前预约热门餐厅。`,
    restaurant_queue:    Number(result.restaurant_queue) || 20,
    ticket_availability: true,
    item_list:           items,
    _synthetic:          true,
    _source:             "ai_generated",
  };

  console.log(`[mockDataGen] Generated ${items.length} restaurants for ${city}`);
  return _store(cacheKey, enrichment);
}

// ── Attractions ───────────────────────────────────────────────────────────────

/**
 * Generate 6 realistic attractions for a city.
 * Returns enrichment shape compatible with buildAIEnrichment().
 */
async function generateRichAttractions(city) {
  const cacheKey = `attractions:${city}`;
  const cached = _cached(cacheKey);
  if (cached) return cached;

  const cityEn = _cityEn(city);

  const prompt = `Generate 6 real tourist attractions for ${city}, China. Only use attractions that actually exist.
Return ONLY this JSON (no extra text):
{"spoken_text":"<vivid 1-sentence Chinese about ${city} tourism with booking tip>","item_list":[{"name":"<attraction name>","address":"<address>","category":"<自然风光/历史古迹/博物馆/主题公园/古镇/寺庙>","ticket_price":<CNY or 0 if free>,"open_hours":"<HH:MM-HH:MM>","duration_hours":<1-6>,"rating":<4.0-5.0>,"review_count":<1000-80000>,"highlight":"<2-sentence Chinese why it's unmissable, mention unique feature>"}]}`;

  const result = await _callOpenAI(prompt, 1400);
  if (!Array.isArray(result?.item_list) || !result.item_list.length) return null;

  const items = result.item_list.map((a) => ({
    name:           a.name || "景点",
    address:        a.address || city,
    category:       a.category || "景点",
    ticket_price:   a.ticket_price != null ? Number(a.ticket_price) : null,
    open_hours:     a.open_hours || "9:00-18:00",
    duration_hours: Number(a.duration_hours) || 2,
    rating:         Number(a.rating) || 4.3,
    review_count:   a.review_count || 5000,
    highlight:      a.highlight || "",
    // Use our category→English keyword map for accurate Unsplash results
    real_photo_url: _unsplash(_attractionImg(a.category, cityEn)),
  }));

  const enrichment = {
    spoken_text:         result.spoken_text || `${city}景点众多，建议提前购票热门景区。`,
    restaurant_queue:    0,
    ticket_availability: true,
    item_list:           items,
    _synthetic:          true,
    _source:             "ai_generated",
  };

  console.log(`[mockDataGen] Generated ${items.length} attractions for ${city}`);
  return _store(cacheKey, enrichment);
}

module.exports = { generateRichHotels, generateRichRestaurants, generateRichAttractions };
