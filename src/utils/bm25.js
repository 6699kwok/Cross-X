"use strict";
/**
 * src/utils/bm25.js
 * AP-05/CT-03/P2-02: Lightweight BM25 relevance scoring for attraction search.
 *
 * BM25 (Best Match 25) is the gold standard for keyword relevance ranking,
 * used in Elasticsearch, Lucene, and most modern search engines.
 * This implementation handles both Chinese and English text.
 *
 * Constants: k1=1.5, b=0.75 (standard BM25 tuning)
 */

const BM25_K1 = 1.5;
const BM25_B  = 0.75;

/**
 * Tokenize text for BM25 — handles Chinese character n-grams + English words.
 * @param {string} text
 * @returns {string[]} tokens
 */
function _tokenize(text) {
  if (!text) return [];
  const lower = String(text).toLowerCase();
  const tokens = [];

  // Extract English words
  const englishWords = lower.match(/[a-z0-9]+/g) || [];
  tokens.push(...englishWords);

  // Extract Chinese bigrams (2-char sliding window — simple but effective)
  const chineseChars = lower.replace(/[^\u4e00-\u9fa5]/g, "");
  for (let i = 0; i < chineseChars.length - 1; i++) {
    tokens.push(chineseChars.slice(i, i + 2));
  }
  // Also add individual Chinese chars for single-char keywords
  for (const ch of chineseChars) tokens.push(ch);

  return tokens;
}

/**
 * Build a BM25 index from a document corpus.
 * @param {object[]} docs  — array of objects with text fields
 * @param {string[]} fields — which fields to index (e.g. ["name", "description", "tags"])
 * @returns {object} BM25 index { idf, docTermFreqs, avgDocLen, N }
 */
function buildIndex(docs, fields = ["name", "description", "tags"]) {
  const N = docs.length;
  if (!N) return { idf: {}, docTermFreqs: [], avgDocLen: 0, N: 0 };

  const docTermFreqs = [];
  const df = {};     // document frequency per term
  let totalLen = 0;

  for (const doc of docs) {
    const text = fields.map(f => doc[f] || "").join(" ");
    const tokens = _tokenize(text);
    const tf = {};
    for (const t of tokens) {
      tf[t] = (tf[t] || 0) + 1;
    }
    docTermFreqs.push({ tf, len: tokens.length });
    totalLen += tokens.length;
    for (const t of Object.keys(tf)) {
      df[t] = (df[t] || 0) + 1;
    }
  }

  const avgDocLen = N > 0 ? totalLen / N : 0;

  // Precompute IDF for all terms
  const idf = {};
  for (const [term, freq] of Object.entries(df)) {
    idf[term] = Math.log((N - freq + 0.5) / (freq + 0.5) + 1);
  }

  return { idf, docTermFreqs, avgDocLen, N };
}

/**
 * Score a single document against a query using BM25.
 * @param {string} query
 * @param {object} docFreq  — { tf, len } from buildIndex
 * @param {object} index    — { idf, avgDocLen }
 * @returns {number} BM25 score (higher = more relevant)
 */
function scoreDoc(query, docFreq, index) {
  const queryTokens = _tokenize(query);
  if (!queryTokens.length) return 0;

  let score = 0;
  const { tf, len } = docFreq;
  const { idf, avgDocLen } = index;

  for (const term of queryTokens) {
    if (!idf[term]) continue;
    const termFreq = tf[term] || 0;
    const numerator   = termFreq * (BM25_K1 + 1);
    const denominator = termFreq + BM25_K1 * (1 - BM25_B + BM25_B * len / (avgDocLen || 1));
    score += idf[term] * (numerator / denominator);
  }

  return score;
}

/**
 * Rank documents by relevance to a query.
 * @param {string} query
 * @param {object[]} docs   — original document array
 * @param {object} index    — built with buildIndex()
 * @param {object} [opts]
 * @param {number} [opts.ratingBoost=0.3]  — weight for doc.rating in final score
 * @returns {object[]} sorted docs with _bm25Score added
 */
function rankDocuments(query, docs, index, { ratingBoost = 0.3 } = {}) {
  if (!query || !docs.length) return docs;

  const scored = docs.map((doc, i) => {
    const bm25 = scoreDoc(query, index.docTermFreqs[i], index);
    // Combine BM25 with rating boost (normalised rating to 0-1 scale, 5-star max)
    const rating = Number(doc.rating || 0);
    const ratingFactor = rating > 0 ? (rating / 5) * ratingBoost : 0;
    return { ...doc, _bm25Score: bm25 + ratingFactor };
  });

  return scored.sort((a, b) => b._bm25Score - a._bm25Score);
}

module.exports = { buildIndex, rankDocuments, scoreDoc, _tokenize };
