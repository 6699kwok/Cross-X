"use strict";
/**
 * src/agent/contradiction_check.js
 * CT-05/P1-07: Travel intent contradiction detector.
 *
 * Detects impossible or highly conflicting combinations in user requests
 * before spinning up the full Agent loop — avoids hallucination on
 * infeasible itineraries.
 *
 * Examples:
 *   "3天两夜, 预算1000元, 5星级酒店, 成都+乐山+峨眉山" → budget contradiction
 *   "明天出发去拉萨, 当天回" → time/distance impossibility
 */

// ── Budget contradiction ────────────────────────────────────────────────────

// Minimum nightly cost estimates (CNY) by hotel tier
const MIN_HOTEL_COST = { budget: 100, balanced: 300, premium: 800, luxury: 1500 };

// Keywords indicating high-end hotel preference
const LUXURY_HOTEL_RE = /五星|5星|豪华|奢华|顶级|奢侈|luxury|five.?star/i;
const BUDGET_RE       = /穷游|省钱|最便宜|最低价|经济|低价|cheap|budget/i;

/**
 * Detect budget vs hotel tier contradiction.
 * Returns { conflict: true, message, hint } or { conflict: false }
 */
function checkBudgetContradiction(constraints, message = "") {
  const budget = Number(constraints?.budget || 0);
  const days   = Number(constraints?.duration_days || constraints?.duration || 3);
  const pax    = Number(constraints?.party_size || 1);
  const wantsLuxury = LUXURY_HOTEL_RE.test(message);
  const wantsBudget = BUDGET_RE.test(message);

  if (wantsLuxury && wantsBudget) {
    return {
      conflict: true,
      type: "hotel_tier_conflict",
      message: "您同时要求豪华酒店和低价，这两个条件相互矛盾",
      hint: "请选择其中一个：高档体验还是经济实惠？",
    };
  }

  if (budget > 0 && wantsLuxury && days > 0) {
    const minLuxuryCost = MIN_HOTEL_COST.luxury * days * pax;
    if (budget < minLuxuryCost * 0.5) {
      return {
        conflict: true,
        type: "budget_hotel_mismatch",
        message: `${days}天五星级酒店预算最低约¥${minLuxuryCost.toLocaleString()}，您的预算¥${budget.toLocaleString()}可能不够`,
        hint: "建议提高预算，或选择四星/精品酒店以控制成本",
      };
    }
  }

  // Very tight budget: check if it's enough for basic trip
  if (budget > 0 && days > 0 && pax > 0) {
    const minPerDayPerPerson = 200; // transport + accommodation + food minimum
    const minTotal = minPerDayPerPerson * days * pax;
    if (budget < minTotal * 0.6) {
      return {
        conflict: true,
        type: "budget_too_low",
        message: `${pax}人${days}天出行，最低预算约¥${minTotal.toLocaleString()}，您的¥${budget.toLocaleString()}可能不足`,
        hint: "建议增加预算，或缩短行程天数，或减少出行人数",
      };
    }
  }

  return { conflict: false };
}

// ── Destination count vs duration ──────────────────────────────────────────

// Minimum days needed per destination type
const MULTI_CITY_MIN_DAYS = 2; // need at least 2 days per extra city

/**
 * Detect too many destinations for too few days.
 */
function checkDestinationDuration(constraints, message = "") {
  const days = Number(constraints?.duration_days || constraints?.duration || 0);
  if (!days) return { conflict: false };

  // Extract city/destination count from constraints
  const destList = constraints?.multi_city || constraints?.destinations || [];
  const destCount = Array.isArray(destList) ? destList.length : 0;

  // Simple heuristic: count city mentions in message (Chinese city patterns)
  const cityPattern = /[成都|上海|北京|广州|杭州|西安|重庆|武汉|南京|苏州|厦门|三亚|西藏|拉萨|丽江|大理|云南|四川]+/g;
  const messageCities = (message.match(cityPattern) || []).length;
  const totalDest = Math.max(destCount, messageCities);

  if (totalDest >= 3 && days <= 2) {
    return {
      conflict: true,
      type: "too_many_destinations",
      message: `${days}天内游览${totalDest}个城市时间非常紧张`,
      hint: `建议至少安排${totalDest * MULTI_CITY_MIN_DAYS}天，或减少城市数量`,
    };
  }

  return { conflict: false };
}

// ── Time impossibility ─────────────────────────────────────────────────────

const REMOTE_DESTINATIONS = [
  /西藏|拉萨|珠峰|阿里|林芝/,    // Tibet — requires altitude acclimatization
  /南极|北极/,
  /新疆|喀什|塔克拉玛干/,        // Xinjiang remote areas
];

/**
 * Detect physically impossible itineraries (same-day remote destinations).
 */
function checkTimeFeasibility(constraints, message = "") {
  const days = Number(constraints?.duration_days || constraints?.duration || 0);
  if (!days) return { conflict: false };

  for (const pattern of REMOTE_DESTINATIONS) {
    if (pattern.test(message)) {
      if (days <= 1) {
        return {
          conflict: true,
          type: "time_impossibility",
          message: "前往高原/偏远地区当天返回不可行（需要高反适应期）",
          hint: "建议至少安排4-5天，包括1-2天高反适应时间",
        };
      }
      if (days <= 3 && /成都.*西藏|北京.*西藏|上海.*西藏/.test(message)) {
        return {
          conflict: true,
          type: "time_too_short_for_destination",
          message: "前往西藏建议至少7天（3天路途+2天适应+2天游览）",
          hint: "延长至7-10天，或选择成都周边目的地",
        };
      }
    }
  }

  return { conflict: false };
}

// ── Main entry point ────────────────────────────────────────────────────────

/**
 * Run all contradiction checks against the current request.
 *
 * @param {object} opts
 * @param {object} opts.constraints  — parsed intent constraints
 * @param {string} opts.message      — raw user message
 * @returns {{ hasConflict: boolean, conflicts: Array<{type, message, hint}> }}
 */
function detectContradictions({ constraints = {}, message = "" } = {}) {
  const conflicts = [];

  const budget = checkBudgetContradiction(constraints, message);
  if (budget.conflict) conflicts.push({ type: budget.type, message: budget.message, hint: budget.hint });

  const destDur = checkDestinationDuration(constraints, message);
  if (destDur.conflict) conflicts.push({ type: destDur.type, message: destDur.message, hint: destDur.hint });

  const timeFeas = checkTimeFeasibility(constraints, message);
  if (timeFeas.conflict) conflicts.push({ type: timeFeas.type, message: timeFeas.message, hint: timeFeas.hint });

  return { hasConflict: conflicts.length > 0, conflicts };
}

module.exports = { detectContradictions, checkBudgetContradiction, checkDestinationDuration, checkTimeFeasibility };
