"use strict";
/**
 * src/utils/levenshtein.js
 * Levenshtein (edit) distance — for fuzzy POI name matching.
 * Pure function, zero deps. Level 0 utility.
 */

/**
 * Compute Levenshtein edit distance between two strings.
 * Time O(mn), Space O(min(m,n)).
 * Returns integer >= 0.
 */
function levenshtein(a, b) {
  if (!a) return b ? b.length : 0;
  if (!b) return a.length;
  if (a === b) return 0;

  // Keep shorter string in the inner array to minimise memory
  if (a.length > b.length) [a, b] = [b, a];

  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: m + 1 }, (_, i) => i);
  let curr = new Array(m + 1);

  for (let j = 1; j <= n; j++) {
    curr[0] = j;
    for (let i = 1; i <= m; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[i] = Math.min(
        prev[i]     + 1,       // delete
        curr[i - 1] + 1,       // insert
        prev[i - 1] + cost     // replace
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[m];
}

/**
 * Fuzzy-match a query name against a Map<name, externalId>.
 * Returns the external_id of the closest match if within threshold,
 * or null if no match is close enough.
 *
 * Strategy:
 *   1. Exact match (levenshtein = 0)             → always accept
 *   2. Prefix containment (a contains b or v.v)  → accept if length diff <= 4
 *   3. Edit distance <= threshold                → accept
 *
 * @param {string}      query      — LLM-generated name
 * @param {Map<string,string>} nameMap — name → externalId from tool results
 * @param {number}      [threshold=3]
 * @returns {string|null} externalId or null
 */
function fuzzyMatchExternalId(query, nameMap, threshold = 3) {
  if (!query || !nameMap || !nameMap.size) return null;

  // 1. Exact
  if (nameMap.has(query)) return nameMap.get(query);

  let bestId   = null;
  let bestDist = Infinity;

  for (const [name, id] of nameMap) {
    // 2. Containment (handles "大鸽饭下午茶" ⊇ "大鸽饭")
    if (name.includes(query) || query.includes(name)) {
      const diff = Math.abs(name.length - query.length);
      if (diff <= 4) return id;   // strong containment — immediate return
    }
    // 3. Edit distance
    const d = levenshtein(query, name);
    if (d < bestDist) {
      bestDist = d;
      bestId   = id;
    }
  }

  return bestDist <= threshold ? bestId : null;
}

module.exports = { levenshtein, fuzzyMatchExternalId };
