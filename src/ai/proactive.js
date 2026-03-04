"use strict";
/**
 * src/ai/proactive.js
 * Proactive AI suggestions for returning users.
 *
 * Generates personalized "next trip" suggestions based on:
 * - Cross-session profile (cities visited, preferences)
 * - Recent trip history
 * - Time-of-year context
 *
 * Uses a 100-token OpenAI call; results cached per deviceId for 6h.
 */

const { openAIRequest } = require("../ai/openai");

const CACHE = new Map(); // deviceId → { suggestions, cachedAt }
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h

const SUGGESTION_ICONS = ["✈️", "🏨", "🍜", "🏔️", "🌊", "🛤️", "🎋", "🏯"];

function _cacheGet(deviceId) {
  const entry = CACHE.get(deviceId);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) { CACHE.delete(deviceId); return null; }
  return entry.suggestions;
}

function _cacheSet(deviceId, suggestions) {
  CACHE.set(deviceId, { suggestions, cachedAt: Date.now() });
}

/**
 * Generate proactive suggestions for a returning user.
 *
 * @param {object} profile  — from loadProfile(deviceId), may be null
 * @param {object[]} recentTrips — last 3 completed trips
 * @param {string} deviceId
 * @returns {Promise<Array<{ text, query, icon }>>}
 */
async function generateProactiveSuggestions(profile, recentTrips = [], deviceId) {
  if (!profile || !deviceId) return [];

  const cached = _cacheGet(deviceId);
  if (cached) return cached;

  // Build context for LLM
  const cities     = profile.cities?.slice(0, 5).join("、") || "未知";
  const prefs      = profile.profileSummary || "";
  const trips      = recentTrips.map(t => `${t.intent === "stay" ? "住宿" : "美食"} in ${t.city || "?"}`).join("; ");
  const month      = new Date().getMonth() + 1;
  const season     = month <= 2 || month === 12 ? "冬季" : month <= 5 ? "春季" : month <= 8 ? "夏季" : "秋季";

  const prompt = `You are a travel AI. Based on the user's travel history, suggest 3 brief next-trip ideas.
User's visited cities: ${cities}
Preferences: ${prefs}
Recent trips: ${trips || "none yet"}
Current season: ${season}

Respond ONLY with a JSON array of 3 objects: [{"text":"...","query":"...","icon":"..."}]
- text: ≤20 chars Chinese, friendly suggestion title
- query: natural language trip request the user can send directly, ≤30 chars
- icon: single emoji
No markdown, no explanation, just the JSON array.`;

  try {
    const apiKey = process.env.OPENAI_API_KEY || "";
    const result = await openAIRequest({
      apiKey,
      model:        "gpt-4o-mini",
      systemPrompt: "You are a travel AI assistant.",
      userContent:  prompt,
      maxTokens:    200,
      temperature:  0.7,
    });

    const content = result.text || "[]";
    // Extract JSON array from response
    const match = content.match(/\[[\s\S]*\]/);
    if (!match) return _fallbackSuggestions(cities, season);

    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed) || parsed.length === 0) return _fallbackSuggestions(cities, season);

    const suggestions = parsed.slice(0, 3).map((s, i) => ({
      text:  String(s.text  || "探索新目的地").slice(0, 25),
      query: String(s.query || "推荐一个好玩的地方").slice(0, 40),
      icon:  String(s.icon  || SUGGESTION_ICONS[i % SUGGESTION_ICONS.length]),
    }));

    _cacheSet(deviceId, suggestions);
    return suggestions;

  } catch (err) {
    console.warn("[proactive] LLM call failed:", err.message);
    return _fallbackSuggestions(cities, season);
  }
}

function _fallbackSuggestions(cities, season) {
  const fallbacks = [
    { text: "探索周边城市", query: "推荐一个距离近的周末目的地", icon: "🗺️" },
    { text: `${season}特色之旅`, query: `${season}适合去哪里旅行`, icon: "🌿" },
    { text: "美食发现之旅", query: "安排一次以美食为主题的城市之旅", icon: "🍜" },
  ];
  return fallbacks;
}

/**
 * Clear cache for a device (e.g., after profile update).
 */
function invalidateCache(deviceId) {
  CACHE.delete(deviceId);
}

module.exports = { generateProactiveSuggestions, invalidateCache };
