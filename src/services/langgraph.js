"use strict";
/**
 * src/services/langgraph.js
 * HTTP client for the CrossX AI Native Engine (LangGraph / FastAPI).
 *
 * Endpoint:  POST {LANGGRAPH_URL}/run
 * Input:     { query, city, lang, budget (1-3) }
 * Output:    { success, data: { plans, daily_details }, run_id }
 *
 * Maps schema_wrapper_node output to CrossX card_data format.
 */

const LANGGRAPH_URL     = process.env.LANGGRAPH_URL     || "http://localhost:3000";
const LANGGRAPH_TIMEOUT = Number(process.env.LANGGRAPH_TIMEOUT_MS) || 90000;

// Map LangGraph plan_id → CrossX plan id
const PLAN_ID_MAP = {
  recommended: "balanced",
  economy:     "budget",
  luxury:      "premium",
};

/**
 * Convert constraints.budget string to LangGraph integer level 1–3.
 */
function _budgetLevel(constraints) {
  const b = String(constraints?.budget || "2").toLowerCase();
  if (/经济|便宜|cheap|budget|low|1/.test(b)) return 1;
  if (/豪华|luxury|high|premium|3/.test(b))   return 3;
  return 2;
}

/**
 * Convert LangGraph { plans, daily_details } → CrossX card_data.
 */
function _adaptToCardData(lgData, city) {
  const { plans = [], daily_details = [] } = lgData;

  const mappedPlans = plans.map((p) => ({
    id:             PLAN_ID_MAP[p.plan_id] || p.plan_id,
    tag:            p.plan_name  || p.plan_id,
    total:          p.total_price || 0,
    hero_image:     p.hero_image  || "",
    highlights:     p.highlights  || [],
    tags:           p.tags        || [],
    mini_timeline:  p.mini_timeline || [],
    is_recommended: !!p.is_recommended,
  }));

  const mappedDays = daily_details.map((d) => {
    const activities = (d.activities || []).map((act) => ({
      time:         act.time         || "",
      type:         act.type         || "sightseeing",
      name:         act.name         || "",
      note:         act.description  || "",
      cost:         act.price        || 0,
      image_url:    act.image_url    || "",
      transport_to: act.transport_to || "",
    }));

    const hotel = d.hotel ? {
      name:       d.hotel.name            || "",
      price:      d.hotel.price_per_night || d.hotel.price || 0,
      address:    d.hotel.address         || d.hotel.location || "",
      rating:     d.hotel.rating          || 0,
      hero_image: d.hotel.hero_image      || d.hotel.image_url || "",
    } : null;

    return {
      day:              d.day              || 1,
      date:             d.date             || "",
      theme:            d.theme            || "",
      activities,
      hotel,
      transport_advice: d.transport_advice || "",
      tips:             d.tips             || "",
    };
  });

  const firstHotel = mappedDays.find((d) => d.hotel)?.hotel || null;
  const heroImage  = mappedPlans.find((p) => p.hero_image)?.hero_image
                   || firstHotel?.hero_image
                   || "";

  return {
    title:        `${city || ""}精选旅行方案`,
    destination:  city  || "",
    plans:        mappedPlans,
    days:         mappedDays,
    hotel:        firstHotel,
    hero_image:   heroImage,
    _dataQuality: "live",
    _source:      "langgraph",
  };
}

/**
 * Call the LangGraph /run endpoint.
 * Returns { ok:true, card_data, spoken_text } or { ok:false, error }.
 *
 * @param {object} opts
 * @param {string} opts.query         - User message
 * @param {string} opts.city          - Destination city
 * @param {string} [opts.lang="ZH"]   - Language code
 * @param {object} [opts.constraints] - Constraints (budget, etc.)
 */
async function callLangGraph({ query, city, lang = "ZH", constraints = {} }) {
  const url    = `${LANGGRAPH_URL}/run`;
  const budget = _budgetLevel(constraints);

  console.log(`[langgraph] POST ${url} | city=${city} lang=${lang} budget=${budget} query="${query.slice(0, 50)}"`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LANGGRAPH_TIMEOUT);

  try {
    const resp = await fetch(url, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ query, city, lang, budget }),
      signal:  controller.signal,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      console.warn(`[langgraph] HTTP ${resp.status}: ${text.slice(0, 200)}`);
      return { ok: false, error: `HTTP ${resp.status}` };
    }

    const data = await resp.json();
    console.log(`[langgraph] run_id=${data.run_id} success=${data.success}`);

    if (!data.success || !data.data) {
      console.warn(`[langgraph] Not successful: ${data.message || "no data"}`);
      return { ok: false, error: data.message || "no data" };
    }

    const lgData = data.data;
    if (!lgData.plans?.length && !lgData.daily_details?.length) {
      console.warn("[langgraph] Empty plans and daily_details");
      return { ok: false, error: "empty output" };
    }

    const card_data   = _adaptToCardData(lgData, city);
    const days        = lgData.daily_details?.length || 0;
    const planCount   = lgData.plans?.length        || 0;
    const spoken_text = `\u4e3a\u60a8\u7cbe\u5fc3\u89c4\u5212\u4e86${city}${days}\u5929\u884c\u7a0b\uff0c\u63d0\u4f9b${planCount}\u5957\u65b9\u6848\u4f9b\u60a8\u9009\u62e9\uff0c\u5df2\u6574\u5408\u5b9e\u65f6\u666f\u70b9\u3001\u9152\u5e97\u53ca\u9910\u996e\u8d44\u6e90\u3002`;

    return { ok: true, card_data, spoken_text };

  } catch (err) {
    if (err.name === "AbortError") {
      console.warn(`[langgraph] Timeout after ${LANGGRAPH_TIMEOUT}ms`);
      return { ok: false, error: "timeout" };
    }
    const isConnErr = err.code === "ECONNREFUSED" || (err.message || "").includes("ECONNREFUSED");
    console.warn(`[langgraph] ${isConnErr ? "Service not running" : "Error"}: ${err.message}`);
    return { ok: false, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { callLangGraph, LANGGRAPH_URL };
