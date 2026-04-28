"use strict";
/**
 * src/utils/deeplinks.js
 * Generate platform deep links for activities, meals, hotels, and transport.
 * All links are public search/discovery URLs — no auth required.
 *
 * Returns an object with named platform links so the frontend can pick what to show.
 */

const enc = (s) => encodeURIComponent(String(s || "").trim());

/**
 * Attraction / sightseeing deep links
 */
function attractionLinks(name, city) {
  if (!name) return null;
  const q = city ? `${name} ${city}` : name;
  return {
    amap:       `https://uri.amap.com/search?keyword=${enc(q)}&src=crossx`,
    ctrip:      `https://m.ctrip.com/webapp/sight/search/${enc(name)}`,
    xiaohongshu:`https://www.xiaohongshu.com/search_result/?keyword=${enc(q)}&source=web_explore_feed`,
    dianping:   city ? `https://m.dianping.com/search/keyword/2/${enc(city)}/${enc(name)}` : null,
  };
}

/**
 * Restaurant / meal deep links
 */
function restaurantLinks(name, city) {
  if (!name) return null;
  const q = city ? `${city} ${name}` : name;
  return {
    meituan:    `https://i.meituan.com/s/search.html?q=${enc(q)}`,
    dianping:   city ? `https://m.dianping.com/search/keyword/2/${enc(city)}/${enc(name)}` : `https://m.dianping.com/search?keyword=${enc(name)}`,
    amap:       `https://uri.amap.com/search?keyword=${enc(q)}&src=crossx`,
    didi:       `https://page.didiglobal.com/passenger/book?dest=${enc(q)}`,
    xiaohongshu:`https://www.xiaohongshu.com/search_result/?keyword=${enc(q)}&source=web_explore_feed`,
  };
}

/**
 * Hotel deep links
 * @param {string} name
 * @param {string} city
 * @param {string} [checkin]  YYYY-MM-DD
 * @param {string} [checkout] YYYY-MM-DD
 */
function hotelLinks(name, city, checkin, checkout) {
  if (!name) return null;
  const dateParams = (checkin && checkout)
    ? `&checkin=${checkin}&checkout=${checkout}`
    : "";
  const cityParam = city ? `&city=${enc(city)}` : "";
  const q = name + (city ? " " + city : "");

  // Affiliate IDs from environment (optional)
  const bookingAid = process.env.BOOKING_AFFILIATE_ID || "";
  const agodaAid   = process.env.AGODA_AFFILIATE_ID   || "";

  return {
    ctrip:   `https://m.ctrip.com/webapp/hotel/list/?hotelname=${enc(name)}${cityParam}${dateParams}`,
    fliggy:  `https://hotel.fliggy.com/search.htm?keywords=${enc(q)}`,
    booking: `https://www.booking.com/search.html?ss=${enc(q)}&lang=en-gb${bookingAid ? `&aid=${bookingAid}` : ""}`,
    agoda:   `https://www.agoda.com/search?q=${enc(q)}${agodaAid ? `&cid=${agodaAid}` : ""}`,
    amap:    `https://uri.amap.com/search?keyword=${enc(q)}&src=crossx`,
    didi:    `https://page.didiglobal.com/passenger/book?dest=${enc(q)}`,
  };
}

/**
 * Transport deep links
 * @param {string} origin   e.g. "上海"
 * @param {string} dest     e.g. "西安"
 * @param {string} [date]   YYYY-MM-DD
 */
function transportLinks(origin, dest, date) {
  const dateStr = date || "";
  return {
    ctrip_flight: `https://m.ctrip.com/webapp/flight/search/?departCity=${enc(origin)}&arrCity=${enc(dest)}${dateStr ? `&depdate=${dateStr}` : ""}`,
    fliggy_flight:`https://s.taobao.com/search?q=${enc(origin + "到" + dest + "机票")}`,
    train_12306:  `https://kyfw.12306.cn/otn/leftTicket/init`,
    didi:         `https://page.xiaojukeji.com/web-didiglobal.com/index.html`,
  };
}

/**
 * Inject platform_links into all activities, meals, and hotels of a structured plan.
 * Called in loop.js after normaliseStructured().
 *
 * @param {object} structured  — card_data with days[].activities / days[].meals / days[].hotel
 * @param {string} city        — destination city
 * @param {object} [dateRange] — { checkin: "YYYY-MM-DD", checkout: "YYYY-MM-DD" }
 * @returns {object} structured with platform_links injected
 */
function injectDeepLinks(structured, city, dateRange) {
  if (!structured?.card_data?.days) return structured;
  const checkin  = dateRange?.checkin  || null;
  const checkout = dateRange?.checkout || null;

  const days = structured.card_data.days.map((day) => {
    const activities = (day.activities || []).map((act) => {
      if (!act.name) return act;
      const isTransport = /^(transport|city_change)$/i.test(act.type || "");
      const isHotel     = /^(checkin|checkout|hotel)$/i.test(act.type || "");
      const isFood      = /^(meal|food|breakfast|lunch|dinner)$/i.test(act.type || "");
      let links = null;
      if (isTransport) links = transportLinks(city, act.destination || "", checkin);
      else if (isHotel) links = hotelLinks(act.name, city, checkin, checkout);
      else if (isFood)  links = restaurantLinks(act.name, city);
      else              links = attractionLinks(act.name, city);
      return links ? { ...act, platform_links: links } : act;
    });

    const meals = (day.meals || []).map((meal) => {
      const name = meal.name || meal.restaurant;
      if (!name) return meal;
      return { ...meal, platform_links: restaurantLinks(name, city) };
    });

    const hotel = day.hotel?.name
      ? { ...day.hotel, platform_links: hotelLinks(day.hotel.name, city, checkin, checkout) }
      : day.hotel;

    return { ...day, activities, meals, hotel };
  });

  return { ...structured, card_data: { ...structured.card_data, days } };
}

module.exports = { attractionLinks, restaurantLinks, hotelLinks, transportLinks, injectDeepLinks };
