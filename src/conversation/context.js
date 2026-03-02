"use strict";
/**
 * src/conversation/context.js
 * Preference extraction + conversation context builder.
 * Zero LLM calls — pure rule-based, O(1).
 */

// ── Preference signals ────────────────────────────────────────────────────────
const PREF_RULES = [
  // Party composition
  { key: "has_children",   re: /儿童|小孩|宝宝|孩子|小朋友|baby|kid/i },
  { key: "has_elderly",    re: /老人|长辈|年迈|爷爷|奶奶|外公|外婆/ },
  { key: "solo",           re: /一个人|单独|独自|solo|自助游/ },
  { key: "couple",         re: /两个人|情侣|夫妻|蜜月|couple|honeymoon/i },
  // Pace
  { key: "pace_slow",      re: /悠闲|慢慢|轻松|不赶|慢节奏|slow/i },
  { key: "pace_packed",    re: /紧凑|行程满|多玩|多景点|packed|efficient/i },
  // Food preferences
  { key: "food_focus",     re: /美食|吃|餐厅|小吃|food|eat|dining/i },
  { key: "vegetarian",     re: /素食|素菜|不吃肉|vegetarian|vegan/i },
  { key: "halal",          re: /清真|halal|穆斯林|回族/i },
  // Budget signals
  { key: "budget_low",     re: /省钱|经济|实惠|便宜|穷游|budget/i },
  { key: "budget_high",    re: /奢华|豪华|高端|luxury|高档|五星/i },
  // Interest
  { key: "cultural",       re: /文化|历史|古迹|博物馆|culture|history|museum/i },
  { key: "nature",         re: /自然|爬山|徒步|户外|nature|hiking|outdoor/i },
  { key: "shopping",       re: /购物|买东西|逛街|shopping|outlet/i },
];

/**
 * Rule-based preference extraction from a single message. 0 tokens.
 * @param {string} message
 * @returns {object}  Preference flags + optional party_size
 */
function extractPreferences(message) {
  if (!message) return {};
  const prefs = {};

  // party_size — extract explicit number
  const paxMatch = message.match(/(\d+)\s*(?:人|位|个人|名|adults?|people|persons?)/i);
  if (paxMatch) prefs.party_size = parseInt(paxMatch[1], 10);

  // Boolean signals
  for (const rule of PREF_RULES) {
    if (rule.re.test(message)) prefs[rule.key] = true;
  }

  return prefs;
}

/**
 * Merge incoming preferences into existing; party_size always overwrites,
 * booleans accumulate (once true, stay true).
 * @param {object} existing   Stored prefs (may be null/undefined)
 * @param {object} incoming   From current message
 * @returns {object}          Merged prefs object
 */
function mergePreferences(existing, incoming) {
  const base = existing ? { ...existing } : {};
  for (const [k, v] of Object.entries(incoming || {})) {
    if (k === "party_size") {
      base.party_size = v; // always overwrite
    } else if (v === true) {
      base[k] = true;      // accumulate booleans
    }
  }
  return base;
}

/**
 * Build a hard-constraint preference rules block for prompt injection.
 * Numbered mandatory rules — not advisory suggestions.
 * Returns empty string if no notable preferences.
 * @param {object} prefs
 * @returns {string}
 */
function buildContextSummary(prefs) {
  if (!prefs || !Object.keys(prefs).length) return "";
  const rules = [];

  // ── Party composition rules ───────────────────────────────────────────────
  if (prefs.has_children && prefs.has_elderly) {
    rules.push(
      "\u8001\u5e7c\u540c\u884c\uff1a\u6bcf\u5929\u5fc5\u987b\u5305\u542b 1 \u4e2a\u4ee5\u4e0a\u8001\u4eba\u53cb\u597d\u4e14\u513f\u7ae5\u53cb\u597d\u7684\u666f\u70b9/\u6d3b\u52a8\uff0c\u7981\u6b62\u63a8\u8350\u9ad8\u5f3a\u5ea6\u5f39\u8dd1\u8df3\u8dc3\u9879\u76ee",
      // "老幼同行：每天必须包含 1 个以上老人友好且儿童友好的景点/活动，禁止推荐高强度弹跑跳跃项目"
    );
  } else if (prefs.has_children) {
    rules.push(
      "\u4eb2\u5b50\u8def\u7ebf\uff1a\u6bcf\u5929\u5fc5\u987b\u5b89\u6392 1 \u4e2a\u4ee5\u4e0a\u513f\u7ae5\u53cb\u597d\u4e92\u52a8\u4f53\u9a8c\uff0c\u666f\u70b9\u5fc5\u987b\u6ce8\u660e\u6709\u513f\u7ae5\u8bbe\u65bd\uff0c\u63a7\u5236\u6bcf\u5929\u6b65\u884c\u8ddd\u79bb",
      // "亲子路线：每天必须安排 1 个以上儿童友好互动体验，景点必须注明有儿童设施，控制每天步行距离"
    );
  } else if (prefs.has_elderly) {
    rules.push(
      "\u8001\u4eba\u540c\u884c\uff1a\u4f18\u5148\u9009\u62e9\u65e0\u969c\u788d\u8bbe\u65bd\u5b8c\u5584\u7684\u666f\u70b9\uff0c\u5c11\u5b89\u6392\u961f\u9636\u8d77\u4f0f\u9879\u76ee\uff0c\u5fc5\u987b\u6ce8\u660e\u4e2d\u5348\u4f11\u606f\u65f6\u95f4",
    );
  }

  if (prefs.solo) {
    rules.push(
      "\u72ec\u884c\u516c\u5171\u4ea4\u901a\u4f18\u5148\uff0c\u63a8\u8350\u80cc\u5305\u5ba2\u6216\u75ab\u4e00\u65c5\u8205\u9152\u5e97\uff0c\u6bcf\u5929\u5b89\u6392 1 \u4e2a\u53ef\u4e0e\u5176\u4ed6\u6e38\u5ba2\u4ea4\u6d41\u7684\u6d3b\u52a8",
    );
  }
  if (prefs.couple) {
    rules.push(
      "\u60c5\u4fa3/\u592b\u59bb\u884c\uff1a\u6bcf\u5929\u5fc5\u987b\u5305\u542b 1 \u4e2a\u6d6a\u6f2b\u4f53\u9a8c\u6216\u79c1\u5bc6\u573a\u6240\uff0c\u63a8\u8350\u7279\u8272\u6c11\u5bbf\u6216\u8bbf\u65e5\u5e38\u6240\u9608\u9152\u5e97",
    );
  }

  // ── Pace rules ────────────────────────────────────────────────────────────
  if (prefs.pace_slow) {
    rules.push(
      "\u60a0\u95f2\u8282\u594f\uff1a\u6bcf\u5929\u666f\u70b9\u4e0d\u8d85\u8fc7 2 \u4e2a\uff0c\u5fc5\u987b\u5305\u542b\u5480\u548c / \u4e0b\u5348\u8336\u6b47\u81da\u65f6\u95f4\uff0c\u7981\u6b62\u5b89\u6392\u65e9\u4e8e 8:00 \u7684\u666f\u70b9",
    );
  }
  if (prefs.pace_packed) {
    rules.push(
      "\u7d27\u51d1\u884c\u7a0b\uff1a\u6bcf\u5929\u5b89\u6392 3\u20134 \u4e2a\u666f\u70b9\u6d3b\u52a8\uff0c\u6bcf\u4e2a\u666f\u70b9\u5efa\u8bae\u6e38\u89c8\u65f6\u95f4\u4e0d\u8d85\u8fc7 2 \u5c0f\u65f6",
    );
  }

  // ── Food rules ────────────────────────────────────────────────────────────
  if (prefs.food_focus) {
    rules.push(
      "\u7f8e\u98df\u4f18\u5148\uff1a\u6bcf\u5929\u5fc5\u987b\u5b89\u6392\u4e0d\u5c11\u4e8e 2 \u4e2a\u9910\u996e\u4f53\u9a8c\u6d3b\u52a8\uff0c\u4f18\u5148\u63a8\u8350\u5f53\u5730\u7279\u8272\u5c0f\u5403\u548c\u793e\u7f51\u53e3\u7891\u9910\u5385",
    );
  }
  if (prefs.vegetarian) {
    rules.push(
      "\u7d20\u98df\u8981\u6c42\uff1a\u6240\u6709\u9910\u996e\u63a8\u8350\u5fc5\u987b\u6807\u6ce8\u7d20\u98df\u9009\u9879\u6216\u7d20\u98df\u9910\u5385\uff0c\u7981\u6b62\u63a8\u8350\u8089\u98df\u4e3a\u4e3b\u7684\u9910\u5385",
    );
  }
  if (prefs.halal) {
    rules.push(
      "\u6e05\u771f\u9982\u98df\uff1a\u6240\u6709\u9910\u996e\u63a8\u8350\u5fc5\u987b\u4e3a\u6e05\u771f\u8ba4\u8bc1\u9910\u5385\uff0c\u5728 activity.note \u4e2d\u6ce8\u660e\u201c\u6e05\u771f\u8ba4\u8bc1\u201d",
    );
  }

  // ── Budget rules ──────────────────────────────────────────────────────────
  if (prefs.budget_low) {
    rules.push(
      "\u9650\u5236\u9884\u7b97\uff1a\u6240\u6709\u65b9\u6848\u5fc5\u987b\u4f18\u5148\u63a8\u8350\u201c\u5b9e\u60e0\u4e4b\u9009\u201d tag\uff0c\u7981\u6b62\u5c06\u8c6a\u534e/\u4e94\u661f\u914d\u7f6e\u4e3a\u63a8\u8350\u65b9\u6848",
    );
  }
  if (prefs.budget_high) {
    rules.push(
      "\u9ad8\u7aef\u4f53\u9a8c\uff1a\u4f18\u5148\u63a8\u8350\u201c\u9ad8\u7aef\u4f53\u9a8c\u201d tag\uff0c\u6bcf\u5929\u5fc5\u987b\u5305\u542b 1 \u4e2a\u4e94\u661f/\u8c6a\u534e\u7ea7\u522b\u7684\u6d3b\u52a8\u6216\u9910\u5385",
    );
  }

  // ── Interest rules ────────────────────────────────────────────────────────
  if (prefs.cultural) {
    rules.push(
      "\u6587\u5316\u5386\u53f2\u4f18\u5148\uff1a\u5fc5\u987b\u5c06\u535a\u7269\u9986/\u53e4\u8ff9/\u65b9\u8a00\u6587\u5316\u4f53\u9a8c\u5217\u4e3a\u6bcf\u5929\u91cd\u7070\u5c55\u70b9\uff0c\u5c55\u70b9\u6570\u91cf\u4e0d\u5c11\u4e8e\u5168\u5929\u7684 40%",
    );
  }
  if (prefs.nature) {
    rules.push(
      "\u81ea\u7136\u6237\u5916\u4f18\u5148\uff1a\u6bcf\u5929\u5fc5\u987b\u5305\u542b 1 \u4e2a\u81ea\u7136\u666f\u89c2\u6216\u6237\u5916\u6d3b\u52a8\uff0c\u652f\u6301\u6bcd\u8d8a\u91ce\u5985\u716e\u9662\u7b49\u8f7b\u6237\u5916\u4f53\u9a8c",
    );
  }
  if (prefs.shopping) {
    rules.push(
      "\u8d2d\u7269\u4f53\u9a8c\uff1a\u6bcf\u5929\u5fc5\u987b\u5305\u542b 1 \u4e2a\u8d2d\u7269\u6d3b\u52a8\uff08\u5f53\u5730\u7279\u8272\u5e02\u573a/\u5546\u5c71\uff09\uff0c\u5e76\u5728 note \u4e2d\u6807\u6ce8\u4f50\u601d\u54c1\u63a8\u8350",
    );
  }

  if (!rules.length) return "";

  // Format as numbered mandatory constraint block
  const numbered = rules.map((r, i) => `${i + 1}. ${r}`).join("\n");
  return `\u3010\u7528\u6237\u504f\u597d\u89c4\u5219 \u2014 card_data \u5fc5\u987b\u6ee1\u8db3\u4ee5\u4e0b\u6240\u6709\u7ea6\u675f\u3011\n${numbered}`;
  // "【用户偏好规则 — card_data 必须满足以下所有约束】\n1. ..."
}

/**
 * Keep only the last N turns of conversation history.
 * @param {Array}  history  Array of {role, content}
 * @param {number} max      Max turns to keep (default 12)
 * @returns {Array}
 */
function pruneHistory(history, max = 12) {
  if (!Array.isArray(history)) return [];
  return history.slice(-max);
}

module.exports = { extractPreferences, mergePreferences, buildContextSummary, pruneHistory };
