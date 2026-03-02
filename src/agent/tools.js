"use strict";
/**
 * src/agent/tools.js
 * OpenAI function-calling tool definitions + dispatcher for the agent loop.
 *
 * 5 tools:
 *   search_hotels         — real Amap hotels → mock fallback
 *   search_restaurants    — real Amap POI restaurants → mock fallback
 *   get_route             — Juhe flight → mockAmapRouting fallback
 *   get_attractions       — real Amap POI attractions → mock fallback
 *   get_city_enrichment   — buildAIEnrichment (3-tier: Amap → OpenAI → hash fallback)
 */

// ── OpenAI tool schema definitions ───────────────────────────────────────────
const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "search_hotels",
      description: "Search for hotels in a city matching a budget. Returns 3 tiers: budget/balanced/premium.",
      parameters: {
        type: "object",
        properties: {
          city:             { type: "string",  description: "Destination city name in Chinese (e.g. 西安)" },
          budget_per_night: { type: "number",  description: "Max budget per night in CNY (e.g. 400)" },
          pax:              { type: "integer", description: "Number of guests (e.g. 2)", default: 2 },
        },
        required: ["city"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_restaurants",
      description: "Search for restaurants in a city by cuisine type and budget. Returns top real restaurant names with address, price, queue time.",
      parameters: {
        type: "object",
        properties: {
          city:              { type: "string", description: "Destination city name in Chinese (e.g. 西安)" },
          cuisine_type:      { type: "string", description: "Cuisine type e.g. 陕西菜, 川菜, 清真菜. Optional." },
          budget_per_person: { type: "number", description: "Per-person budget in CNY. Optional." },
        },
        required: ["city"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_route",
      description: "Get transport route options (flight/HSR/train) between two cities.",
      parameters: {
        type: "object",
        properties: {
          origin:      { type: "string", description: "Departure city name in Chinese (e.g. 深圳)" },
          destination: { type: "string", description: "Arrival city name in Chinese (e.g. 西安)" },
          date:        { type: "string", description: "Travel date in YYYY-MM-DD format. Optional, defaults to tomorrow." },
        },
        required: ["origin", "destination"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_attractions",
      description: "Get top attractions in a city, with ticket prices and opening hours.",
      parameters: {
        type: "object",
        properties: {
          city:     { type: "string", description: "City name in Chinese (e.g. 西安)" },
          category: { type: "string", description: "Category filter e.g. 历史文化, 自然风光, 博物馆. Optional." },
        },
        required: ["city"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_city_enrichment",
      description: "Get real-time city enrichment data: restaurant queue times, ticket availability, local tips. Use this first to understand the city before generating a plan.",
      parameters: {
        type: "object",
        properties: {
          city:        { type: "string", description: "City name in Chinese (e.g. 西安)" },
          intent_type: {
            type: "string",
            enum: ["food", "activity", "stay", "travel"],
            description: "Intent type to fetch relevant data.",
            default: "travel",
          },
        },
        required: ["city"],
      },
    },
  },
];

// Inject picsum fallback for items with empty real_photo_url
function withPhotoFallback(items, seedPrefix) {
  if (!Array.isArray(items)) return items;
  return items.map((item, i) => {
    if (item.real_photo_url) return item;
    const seed = encodeURIComponent(`${seedPrefix}-${item.name || i}`);
    return { ...item, real_photo_url: `https://picsum.photos/seed/${seed}/400/300` };
  });
}

// ── Tool dispatcher ───────────────────────────────────────────────────────────
/**
 * Execute a named tool with the given arguments.
 *
 * @param {string} name    Tool name (must match TOOL_DEFINITIONS)
 * @param {object} args    Arguments object (already parsed from JSON)
 * @param {object} deps    Injected server-level functions:
 *   { queryAmapHotels, queryJuheFlight, mockAmapRouting, mockCtripHotels,
 *     buildAIEnrichment, queryAmapPoi? }
 * @returns {Promise<object>}  Tool result (always a serialisable object)
 */
async function executeTool(name, args, deps) {
  const {
    queryAmapHotels,
    queryJuheFlight,
    mockAmapRouting,
    mockCtripHotels,
    buildAIEnrichment,
    callCozeWorkflow,
  } = deps || {};

  try {
    switch (name) {

      // ── search_hotels ───────────────────────────────────────────────────────
      case "search_hotels": {
        const city    = String(args.city || "").trim();
        const budget  = args.budget_per_night ? Number(args.budget_per_night) : undefined;
        const pax     = args.pax ? Number(args.pax) : 2;
        if (!city) return { error: "city required" };

        let hotels = null;
        if (queryAmapHotels) {
          try { hotels = await queryAmapHotels(city, budget); } catch (e) {
            console.warn("[tool:search_hotels] Amap error:", e.message);
          }
        }
        if (!hotels && mockCtripHotels) {
          hotels = mockCtripHotels(city, budget || 400);
        }
        console.log(`[agent] tool_call: search_hotels(${city}) → ${hotels?.length || 0} results`);
        return { city, pax, hotels: hotels || [], source: hotels?.[0]?.source || "mock" };
      }

      // ── search_restaurants ──────────────────────────────────────────────────
      case "search_restaurants": {
        const city   = String(args.city || "").trim();
        const budget = args.budget_per_person ? Number(args.budget_per_person) : null;
        if (!city) return { error: "city required" };

        // Delegate to buildAIEnrichment (food mode) — it has Amap POI + OpenAI fallback
        let enrichment = null;
        if (buildAIEnrichment) {
          try { enrichment = await buildAIEnrichment(city, "food"); } catch (e) {
            console.warn("[tool:search_restaurants] enrichment error:", e.message);
          }
        }
        const restaurants = withPhotoFallback(
          (enrichment?.item_list || []).filter((item) =>
            budget == null || (item.avg_price != null && item.avg_price <= budget)
          ), "food"
        );
        console.log(`[agent] tool_call: search_restaurants(${city}) → ${restaurants.length} results`);
        return {
          city,
          restaurants,
          queue_avg_min: enrichment?.restaurant_queue ?? null,
          source: enrichment?._source || "fallback",
        };
      }

      // ── get_route ───────────────────────────────────────────────────────────
      case "get_route": {
        const origin = String(args.origin || "").trim();
        const dest   = String(args.destination || "").trim();
        const date   = args.date || null;
        if (!origin || !dest) return { error: "origin and destination required" };

        let route = null;
        if (queryJuheFlight) {
          try {
            const flightData = await queryJuheFlight(origin, dest, date);
            if (flightData?.flights?.length) {
              const best = flightData.flights[0];
              route = {
                transport_mode: "flight",
                flight_no: best.flightNo,
                airline:   best.airline,
                dep_time:  best.depTime,
                arr_time:  best.arrTime,
                price_cny: best.price,
                stops:     best.stops || 0,
                source:    "juhe",
              };
            }
          } catch (e) {
            console.warn("[tool:get_route] Juhe error:", e.message);
          }
        }
        if (!route && mockAmapRouting) {
          const mock = mockAmapRouting(origin, dest);
          if (mock) route = { ...mock, source: "mock" };
        }
        console.log(`[agent] tool_call: get_route(${origin}→${dest}) → ${route?.transport_mode || "no route"}`);
        return { origin, destination: dest, date, route: route || null };
      }

      // ── get_attractions ─────────────────────────────────────────────────────
      case "get_attractions": {
        const city     = String(args.city || "").trim();
        const category = args.category ? String(args.category) : null;
        if (!city) return { error: "city required" };

        let enrichment = null;
        if (buildAIEnrichment) {
          try { enrichment = await buildAIEnrichment(city, "activity"); } catch (e) {
            console.warn("[tool:get_attractions] enrichment error:", e.message);
          }
        }
        let attractions = enrichment?.item_list || [];
        if (category) {
          const kw = category.toLowerCase();
          attractions = attractions.filter((a) =>
            [a.name, a.address, a.category].some((f) => f && String(f).toLowerCase().includes(kw))
          );
        }
        attractions = withPhotoFallback(attractions, "attraction");
        console.log(`[agent] tool_call: get_attractions(${city}) → ${attractions.length} results`);
        return {
          city,
          attractions,
          ticket_available: enrichment?.ticket_availability ?? true,
          source: enrichment?._source || "fallback",
        };
      }

      // ── get_city_enrichment ─────────────────────────────────────────────────
      case "get_city_enrichment": {
        const city       = String(args.city || "").trim();
        const intentType = args.intent_type || "travel";
        if (!city) return { error: "city required" };

        let enrichment = null;

        // Tier 1: Coze workflow — curated real data
        if (callCozeWorkflow) {
          try {
            const cozeData = await callCozeWorkflow({ query: city, city, lang: "ZH", budget: "", intentAxis: intentType });
            if (cozeData && !cozeData._synthetic && cozeData.item_list?.length) {
              enrichment = cozeData;
              console.log(`[tool:get_city_enrichment] Coze live data: ${cozeData.item_list.length} items`);
            }
          } catch (e) {
            console.warn("[tool:get_city_enrichment] Coze error:", e.message);
          }
        }

        // Tier 2: buildAIEnrichment (Amap → OpenAI → hash fallback)
        if (!enrichment && buildAIEnrichment) {
          try { enrichment = await buildAIEnrichment(city, intentType); } catch (e) {
            console.warn("[tool:get_city_enrichment] enrichment error:", e.message);
          }
        }

        // Apply photo fallback to item_list so agent has image URLs in context
        if (enrichment?.item_list) {
          const seedPrefix = intentType === "food" ? "food" : "attraction";
          enrichment = { ...enrichment, item_list: withPhotoFallback(enrichment.item_list, seedPrefix) };
        }

        console.log(`[agent] tool_call: get_city_enrichment(${city}, ${intentType}) → source=${enrichment?._source}`);
        return enrichment || { city, _source: "none", restaurant_queue: null, ticket_availability: null };
      }

      default:
        console.warn("[agent] Unknown tool:", name);
        return { error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    console.warn(`[agent] tool execution error (${name}):`, e.message);
    return { error: e.message };
  }
}

module.exports = { TOOL_DEFINITIONS, executeTool };
