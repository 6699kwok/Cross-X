"use strict";
/**
 * src/agent/data_shaper.js
 * DataShaper — strips raw API responses before they enter LLM context.
 *
 * Goal: 10KB raw JSON → <500 bytes shaped output per tool call.
 * Applied at tool result push time (not post-hoc), so every LLM round
 * sees lean data from the start.
 *
 * Public API:
 *   DataShaper.shape(toolName, rawResult) → shaped object
 *   DataShaper.shapeMapData(rawJson)       → [{name,location,address,rating,photo}]
 *   DataShaper.shapeFlightData(rawJson)    → {flight_no,dep_time,arr_time,price,status}
 */

const DataShaper = {

  // ── Per-tool shapers ────────────────────────────────────────────────────────

  search_hotels(raw) {
    const hotels = (raw.hotels || []).slice(0, 5).map((h) => ({
      name:            h.name,
      tier:            h.tier,
      price_per_night: h.price_per_night ?? h.price,
      rating:          h.rating,
      real_photo_url:  h.real_photo_url || h.hero_image || null,
      // Preserve external IDs for 3rd-party deep-links (Ctrip, Meituan, Amap)
      external_id: h.external_id || h.ctrip_id || h.amap_id || h.id || (h._source === "openai" ? `synthetic_${h.name}` : null),
    }));
    return { city: raw.city, pax: raw.pax, hotels, _src: raw.source };
  },

  search_restaurants(raw) {
    const restaurants = (raw.restaurants || []).slice(0, 6).map((r) => ({
      name:          r.name,
      avg_price:     r.avg_price,
      queue_min:     r.queue_min,
      real_photo_url: r.real_photo_url || null,
      external_id:   r.external_id || r.meituan_id || r.amap_id || r.id || (r._source === "openai" ? `synthetic_${r.name}` : null),
    }));
    return { city: raw.city, restaurants, queue_avg_min: raw.queue_avg_min ?? null, _src: raw.source };
  },

  get_route(raw) {
    const r = raw.route;
    if (!r) return { origin: raw.origin, dest: raw.destination, route: null };
    return {
      origin: raw.origin,
      dest:   raw.destination,
      route: {
        mode:  r.transport_mode,
        no:    r.flight_no || r.train_no || null,
        dep:   r.dep_time,
        arr:   r.arr_time,
        price: r.price_cny ?? r.price,
        stops: r.stops ?? 0,
        // Keep amap polyline ID for RouteTimeline deep-link
        amap_route_id: r.amap_route_id || null,
      },
    };
  },

  get_attractions(raw) {
    const attractions = (raw.attractions || []).slice(0, 6).map((a) => ({
      name:           a.name,
      ticket_price:   a.ticket_price ?? a.avg_price,
      open_hours:     a.open_hours || null,
      real_photo_url: a.real_photo_url || null,
      external_id:    a.external_id || a.amap_id || a.id || (a._source === "openai" ? `synthetic_${a.name}` : null),
    }));
    return { city: raw.city, attractions, ticket_available: raw.ticket_available ?? true, _src: raw.source };
  },

  get_city_enrichment(raw) {
    const item_list = (raw.item_list || []).slice(0, 6).map((i) => ({
      name:           i.name,
      avg_price:      i.avg_price ?? null,
      real_photo_url: i.real_photo_url || null,
      external_id:    i.external_id || i.amap_id || i.id || (i._source === "openai" ? `synthetic_${i.name}` : null),
    }));
    return {
      city:                raw.city,
      item_list,
      restaurant_queue:    raw.restaurant_queue ?? null,
      ticket_availability: raw.ticket_availability ?? null,
      _src:                raw._source || raw.source,
    };
  },

  // ── Named public API (per spec) ─────────────────────────────────────────────

  /**
   * Shape any POI data (hotels, restaurants, attractions, enrichment items).
   * Keeps: name, location, address (≤40 chars), rating, photo.
   * Drops: IDs, subcategory codes, image thumbnail arrays, raw coords objects.
   */
  shapeMapData(rawJson) {
    const items = rawJson.item_list
      || rawJson.attractions
      || rawJson.restaurants
      || rawJson.hotels
      || [];
    return items.slice(0, 8).map((i) => ({
      name:     i.name,
      location: i.location || i.coordinates || null,
      address:  i.address ? String(i.address).slice(0, 40) : null,
      rating:   i.rating ?? i.star ?? null,
      real_photo_url: i.real_photo_url || null,
    })).filter((i) => i.name);
  },

  /**
   * Shape raw flight data from Juhe or route result.
   * Keeps: flight_no, dep_time, arr_time, price, status.
   * Drops: airline IATA codes, seat maps, meal codes, baggage policies.
   */
  shapeFlightData(rawJson) {
    // Raw Juhe array format
    if (Array.isArray(rawJson.flights)) {
      return rawJson.flights.slice(0, 3).map((f) => ({
        flight_no: f.flightNo,
        dep_time:  f.depTime,
        arr_time:  f.arrTime,
        price:     f.price,
        status:    f.status || "scheduled",
      }));
    }
    // Already-normalised route object
    const r = rawJson.route || rawJson;
    return {
      flight_no: r.flight_no || r.no || null,
      dep_time:  r.dep_time  || r.dep || null,
      arr_time:  r.arr_time  || r.arr || null,
      price:     r.price_cny ?? r.price ?? null,
      status:    r.status    || "scheduled",
    };
  },

  // ── Dispatcher ──────────────────────────────────────────────────────────────

  /**
   * Route to the correct per-tool shaper.
   * Returns the original object on error or unknown tool (safe fallback).
   */
  shape(toolName, rawResult) {
    if (!rawResult || rawResult.error) return rawResult;
    try {
      const fn = DataShaper[toolName];
      if (typeof fn === "function") return fn.call(DataShaper, rawResult);
    } catch (e) {
      console.warn(`[DataShaper] shape(${toolName}) failed:`, e.message);
    }
    // Unknown tool: return as-is (safe — DataShaper only shapes known tools)
    return rawResult;
  },
};

module.exports = { DataShaper };
