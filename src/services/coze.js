"use strict";
/**
 * src/services/coze.js
 * Coze workflow + AI enrichment cascade.
 *
 * Priority cascade for enrichment:
 *   1. Coze Workflow (real curated data)
 *   2. Amap POI (live local data)
 *   3. OpenAI generation (AI-synthesised)
 *   4. Hash-based fallback (offline)
 *
 * All env vars read from process.env at call time (no global state required).
 *
 * Exports: buildSyntheticEnrichment, buildAIEnrichment, callCozeWorkflow
 */

const { queryAmapPoi } = require("./amap");

// In-memory cache for AI-generated enrichment: "city:intent" → { data, ts }
const AI_ENRICHMENT_CACHE = new Map();
const AI_ENRICHMENT_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

// Separate cache for Coze workflow results (city-level, not intent-specific)
const COZE_RESULT_CACHE = new Map();
const COZE_RESULT_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

/**
 * Synthetic enrichment — generated from city name when Coze workflow is
 * unavailable (missing key, workflow 4200, network failure, timeout).
 * Keeps the rendering pipeline fully active so all Coze UI slots render.
 */
function buildSyntheticEnrichment(city) {
  // City-specific curated restaurant data — injected into LLM prompt via buildInventoryContext
  const CITY_DATA = {
    "\u897f\u5b89": {
      queue: 28, tickets: true,
      spoken: "\u897f\u5b89\u65c5\u6e38\u70ed\u5ea6\u6301\u7eed\u8d70\u9ad8\uff0c\u56de\u6c11\u8857\u3001\u5927\u5510\u4e0d\u591c\u57ce\u5747\u662f\u70ed\u95e8\u6253\u5361\u5730\uff0c\u5efa\u8bae\u9519\u5cf0\u51fa\u884c\u3002",
      items: [
        { name: "\u8001\u5b59\u5bb6\u7f8a\u8089\u6ce1\u998d\u00b7\u4e1c\u5927\u8857\u603b\u5e97", address: "\u897f\u5b89\u5e02\u788d\u6797\u533a\u4e1c\u5927\u8857364\u53f7", avg_price: 42, queue_min: 30 },
        { name: "\u8d3e\u4e09\u704c\u6c64\u5305\u5b50\u94fa", address: "\u897f\u5b89\u5e02\u83b2\u6e56\u533a\u9662\u95e8\u53e342\u53f7", avg_price: 28, queue_min: 15 },
        { name: "\u540c\u76db\u7965\u6ce1\u998d\u9986\u00b7\u9f13\u697c\u5e97", address: "\u897f\u5b89\u5e02\u83b2\u6e56\u533a\u9f13\u697c\u897f\u4fa7", avg_price: 55, queue_min: 20 },
        { name: "\u9b4f\u5bb6\u51c9\u76ae\u00b7\u56de\u6c11\u8857\u5e97", address: "\u897f\u5b89\u5e02\u83b2\u6e56\u533a\u56de\u6c11\u8857\u5317\u9662\u95e8", avg_price: 18, queue_min: 25 },
        { name: "\u6a0a\u8bb0\u814a\u6c41\u8089\u5939\u998d", address: "\u897f\u5b89\u5e02\u788d\u6797\u533a\u7af9\u7b46\u5e02\u857741\u53f7", avg_price: 22, queue_min: 10 },
      ],
    },
    "\u5317\u4eac": {
      queue: 35, tickets: true,
      spoken: "\u5317\u4eac\u5404\u666f\u533a\u6301\u7eed\u70ed\u95e8\uff0c\u6545\u5bab\u3001\u957f\u57ce\u95e8\u7968\u9700\u63d0\u524d7\u5929\u9884\u8ba2\uff0c\u9910\u996e\u9ad8\u5cf0\u671f\u7b49\u4f4d\u52604 35\u5206\u949f\u3002",
      items: [
        { name: "\u5168\u805a\u5fb7\u70e4\u9e2d\u00b7\u524d\u95e8\u603b\u5e97", address: "\u5317\u4eac\u5e02\u4e1c\u57ce\u533a\u524d\u95e8\u5927\u856732\u53f7", avg_price: 220, queue_min: 45 },
        { name: "\u56db\u5b63\u6c11\u798f\u70e4\u9e2d\u5e97\u00b7\u6545\u5bab\u5e97", address: "\u5317\u4eac\u5e02\u4e1c\u57ce\u533a\u666f\u5c71\u4e1c\u857714\u53f7", avg_price: 180, queue_min: 60 },
        { name: "\u7206\u80da\u51af\u00b7\u4ec0\u5261\u6d77\u5e97", address: "\u5317\u4eac\u5e02\u897f\u57ce\u533a\u62a4\u56fd\u5bfa\u8857\u5317\u4fa7", avg_price: 65, queue_min: 20 },
        { name: "\u7c3a\u8857\u80e1\u5927\u996d\u9986", address: "\u5317\u4eac\u5e02\u4e1c\u57ce\u533a\u7c3a\u857793\u53f7", avg_price: 120, queue_min: 40 },
        { name: "\u8001\u5317\u4eac\u70b8\u9171\u9762\u5927\u738b", address: "\u5317\u4eac\u5e02\u4e1c\u57ce\u533a\u5d07\u6587\u95e8\u5916\u5927\u857711\u53f7", avg_price: 38, queue_min: 15 },
      ],
    },
    "\u4e0a\u6d77": {
      queue: 30, tickets: false,
      spoken: "\u4e0a\u6d77\u9910\u996e\u7ade\u4e89\u6fc0\u70c8\uff0c\u5916\u6ee9\u9644\u8fd1\u9910\u5385\u7b49\u4f4d\u52604 30\u5206\u949f\uff0c\u5efa\u8bae\u63d0\u524d\u4f7f\u7528\u5927\u4f17\u70b9\u8bc4\u9884\u7ea6\u3002",
      items: [
        { name: "\u5357\u7fd4\u9992\u5934\u5e97\u00b7\u57ce\u9699\u5e99\u603b\u5e97", address: "\u4e0a\u6d77\u5e02\u9ec4\u6d66\u533a\u8c6b\u56ed\u8def85\u53f7", avg_price: 55, queue_min: 40 },
        { name: "\u6c88\u5927\u6210\u70b9\u5fc3\u5e97", address: "\u4e0a\u6d77\u5e02\u9ec4\u6d66\u533a\u5357\u4eac\u4e1c\u8def636\u53f7", avg_price: 35, queue_min: 20 },
        { name: "\u5c0f\u6768\u751f\u714e\u00b7\u5434\u6c5f\u8def\u5e97", address: "\u4e0a\u6d77\u5e02\u9759\u5b89\u533a\u5434\u6c5f\u8def269\u53f7", avg_price: 28, queue_min: 30 },
        { name: "\u8001\u6b63\u5174\u83dc\u9986", address: "\u4e0a\u6d77\u5e02\u9ec4\u6d66\u533a\u4e91\u5357\u5357\u8def556\u53f7", avg_price: 95, queue_min: 25 },
        { name: "\u5149\u660e\u90a3\u5927\u9152\u5bb6", address: "\u4e0a\u6d77\u5e02\u9ec4\u6d66\u533a\u6dee\u6d77\u4e2d\u8def588\u53f7", avg_price: 88, queue_min: 35 },
      ],
    },
    "\u6df1\u5733": {
      queue: 20, tickets: true,
      spoken: "\u6df1\u5733\u7f8e\u98df\u591a\u5143\uff0c\u7ca4\u5f0f\u8336\u697c\u5348\u5e02\u6700\u53d7\u6b22\u8fce\uff0c\u5efa\u8bae11\u70b9\u524d\u5230\u5e97\u6216\u63d0\u524d\u9884\u7ea6\u3002",
      items: [
        { name: "\u6e14\u6e2f\u6d77\u9c9c\u9152\u5bb6\u00b7\u5357\u5c71\u5e97", address: "\u6df1\u5733\u5e02\u5357\u5c71\u533a\u5357\u6d77\u5927\u90531013\u53f7", avg_price: 150, queue_min: 25 },
        { name: "\u6f6e\u6c55\u725b\u8089\u706b\u9505\u00b7\u798f\u7530\u5e97", address: "\u6df1\u5733\u5e02\u798f\u7530\u533a\u534e\u5f3a\u5317\u8def\u6b65\u884c\u8857", avg_price: 85, queue_min: 20 },
        { name: "\u83b2\u9999\u697c\u00b7\u7f57\u6e56\u5e97", address: "\u6df1\u5733\u5e02\u7f57\u6e56\u533a\u4eba\u6c11\u5357\u8def3023\u53f7", avg_price: 68, queue_min: 15 },
        { name: "\u4e1c\u95e8\u8001\u8857\u80a0\u7c89\u738b", address: "\u6df1\u5733\u5e02\u7f57\u6e56\u533a\u4e1c\u95e8\u5357\u8def\u6b65\u884c\u8857", avg_price: 22, queue_min: 10 },
        { name: "\u5bb6\u5927\u56f4\u9f99\u519c\u5bb6\u83dc", address: "\u6df1\u5733\u5e02\u9f99\u534e\u533a\u5927\u6d6a\u8857\u9053", avg_price: 75, queue_min: 0 },
      ],
    },
    "\u6210\u90fd": {
      queue: 32, tickets: true,
      spoken: "\u6210\u90fd\u7f8e\u98df\u4e4b\u90fd\u5f53\u4e4b\u65e0\u6127\uff0c\u9526\u91cc\u3001\u5bbd\u7a84\u5df7\u5b50\u9910\u5385\u6392\u961f\u523030\u5206\u949f\uff0c\u706b\u9505\u9700\u63d0\u524d\u9884\u7ea6\u3002",
      items: [
        { name: "\u9f99\u6284\u624b\u00b7\u6625\u7199\u8def\u603b\u5e97", address: "\u6210\u90fd\u5e02\u9526\u6c5f\u533a\u6625\u7199\u8def\u6b65\u884c\u8857", avg_price: 45, queue_min: 20 },
        { name: "\u5ed6\u8bb0\u68d2\u68d2\u9e21\u00b7\u4eba\u6c11\u5357\u8def\u5e97", address: "\u6210\u90fd\u5e02\u6b66\u4faf\u533a\u4eba\u6c11\u5357\u8def\u56db\u6bb5", avg_price: 38, queue_min: 10 },
        { name: "\u84c4\u4e5d\u9999\u706b\u9505\u00b7\u9526\u91cc\u5e97", address: "\u6210\u90fd\u5e02\u6b66\u4faf\u533a\u9526\u91cc\u53e4\u8857\u65c1", avg_price: 95, queue_min: 40 },
        { name: "\u592b\u59bb\u80ba\u7247\u603b\u5e97", address: "\u6210\u90fd\u5e02\u9752\u7f8e\u533a\u957f\u987a\u4e0a\u8857177\u53f7", avg_price: 52, queue_min: 25 },
        { name: "\u949f\u6c34\u9965\u00b7\u63d0\u7763\u8857\u5e97", address: "\u6210\u90fd\u5e02\u9526\u6c5f\u533a\u63d0\u7763\u857787\u53f7", avg_price: 25, queue_min: 15 },
      ],
    },
    "\u676d\u5dde": {
      queue: 25, tickets: true,
      spoken: "\u676d\u5dde\u897f\u6e56\u5468\u8fb9\u666f\u533a\u95e8\u7968\u514d\u8d39\u4f46\u505c\u8f66\u7d27\u5f20\uff0c\u9910\u996e\u65fa\u5b63\u7b49\u4f4d\u523025\u5206\u949f\uff0c\u9f99\u4e95\u8336\u56ed\u5efa\u8bae\u4e0b\u5348\u524d\u5f80\u3002",
      items: [
        { name: "\u697c\u5916\u697c\u83dc\u9986\u00b7\u897f\u6e56\u603b\u5e97", address: "\u676d\u5dde\u5e02\u897f\u6e56\u533a\u5b64\u5c71\u8def30\u53f7", avg_price: 180, queue_min: 35 },
        { name: "\u77e5\u5473\u89c2\u00b7\u4ec1\u548c\u8def\u5e97", address: "\u676d\u5dde\u5e02\u4e0a\u57ce\u533a\u4ec1\u548c\u8def83\u53f7", avg_price: 85, queue_min: 20 },
        { name: "\u65b0\u767d\u9e7f\u9910\u5385\u00b7\u897f\u6e56\u6587\u5316\u5e7f\u573a\u5e97", address: "\u676d\u5dde\u5e02\u62f1\u5893\u533a\u66f2\u9662\u98ce\u8377\u8def", avg_price: 75, queue_min: 25 },
        { name: "\u5916\u5a46\u5bb6\u00b7\u6b66\u6797\u5e97", address: "\u676d\u5dde\u5e02\u4e0b\u57ce\u533a\u6b66\u6797\u5e7f\u573a\u9644\u8fd1", avg_price: 65, queue_min: 30 },
        { name: "\u594e\u5143\u9986\u9762\u9986", address: "\u676d\u5dde\u5e02\u4e0a\u57ce\u533a\u89e3\u653e\u8def154\u53f7", avg_price: 35, queue_min: 15 },
      ],
    },
    "\u91cd\u5e86": {
      queue: 38, tickets: true,
      spoken: "\u91cd\u5e86\u706b\u9505\u6587\u5316\u76db\u884c\uff0c\u6d2a\u5d16\u6d1e\u591c\u666f\u6392\u961f\u62cd\u7167\u523030\u5206\u949f\uff0c\u5404\u5927\u706b\u9505\u5e97\u665a\u5e02\u9700\u63d0\u524d\u9884\u7ea6\u3002",
      items: [
        { name: "\u6d2a\u5d16\u6d1e\u00b7\u91cd\u5e86\u706b\u9505\u65d7\u8230\u5e97", address: "\u91cd\u5e86\u5e02\u6e1d\u4e2d\u533a\u5609\u6ee8\u8def88\u53f7\u6d2a\u5d16\u6d1e", avg_price: 115, queue_min: 50 },
        { name: "\u79e6\u5988\u706b\u9505\u00b7\u89e3\u653e\u7891\u5e97", address: "\u91cd\u5e86\u5e02\u6e1d\u4e2d\u533a\u6c11\u6743\u8def\u6b65\u884c\u8857", avg_price: 95, queue_min: 40 },
        { name: "\u8f83\u573a\u53e3\u62c5\u62c5\u9762", address: "\u91cd\u5e86\u5e02\u6e1d\u4e2d\u533a\u8f83\u573a\u53e3\u6b65\u884c\u8857", avg_price: 18, queue_min: 10 },
        { name: "\u5c71\u57ce\u5c0f\u6c64\u5706", address: "\u91cd\u5e86\u5e02\u6e1d\u4e2d\u533a\u4e03\u661f\u5c97\u6ef4\u6c34\u5ca9\u8def", avg_price: 12, queue_min: 5 },
        { name: "\u5468\u541b\u8bb0\u9ebb\u8fa3\u70eb", address: "\u91cd\u5e86\u5e02\u5357\u5c90\u533a\u5357\u576a\u6b65\u884c\u8857", avg_price: 45, queue_min: 20 },
      ],
    },
    "\u5e7f\u5dde": {
      queue: 22, tickets: true,
      spoken: "\u5e7f\u5dde\u65e9\u8336\u6587\u5316\u6d53\u5389\uff0c\u8336\u697c\u65e9\u5e02\uff0c7-10\u70b9\uff0c\u4eba\u6c14\u6700\u65fa\uff0c\u5efa\u8bae\u5de5\u4f5c\u65e5\u524d\u5f80\u907f\u5f00\u5468\u672b\u9ad8\u5cf0\u3002",
      items: [
        { name: "\u9676\u9676\u5c45\u9152\u697c\u00b7\u8354\u6e7e\u603b\u5e97", address: "\u5e7f\u5dde\u5e02\u8354\u6e7e\u533a\u7b2c\u5341\u752820\u53f7", avg_price: 95, queue_min: 30 },
        { name: "\u83b2\u9999\u697c\u00b7\u5e7f\u5dde\u603b\u5e97", address: "\u5e7f\u5dde\u5e02\u8354\u6e7e\u533a\u7b2c\u5341\u752867\u53f7", avg_price: 75, queue_min: 25 },
        { name: "\u4e0a\u4e0b\u4e5d\u80a0\u7c89\u5e97", address: "\u5e7f\u5dde\u5e02\u8354\u6e7e\u533a\u4e0a\u4e0b\u4e5d\u6b65\u884c\u8857", avg_price: 22, queue_min: 10 },
        { name: "\u5e7f\u5dde\u9152\u5bb6\u00b7\u6587\u660c\u5e97", address: "\u5e7f\u5dde\u5e02\u8354\u6e7e\u533a\u6587\u660c\u5357\u8def2\u53f7", avg_price: 120, queue_min: 20 },
        { name: "\u897f\u5173\u8247\u4ed4\u7ca5", address: "\u5e7f\u5dde\u5e02\u8354\u6e7e\u533a\u8354\u679d\u6e7e\u6d8c\u65c1", avg_price: 28, queue_min: 15 },
      ],
    },
    "\u5f20\u5bb6\u754c": {
      queue: 15, tickets: true,
      spoken: "\u5f20\u5bb6\u754c\u5929\u95e8\u5c71\u666f\u533a\u70ed\u5ea6\u9ad8\uff0c\u5efa\u8bae\u63d0\u524d3\u5929\u9884\u8ba2\u95e8\u7968\uff0c\u571f\u5bb6\u83dc\u9986\u5c71\u73cd\u6d77\u5473\u4ef7\u683c\u5b9e\u60e0\u3002",
      items: [
        { name: "\u5f20\u5bb6\u754c\u571f\u5bb6\u83dc\u00b7\u6b66\u9675\u6e90\u5e97", address: "\u5f20\u5bb6\u754c\u5e02\u6b66\u9675\u6e90\u666f\u533a\u5185", avg_price: 65, queue_min: 15 },
        { name: "\u817f\u5b50\u8214\u7c97\u7c2e\u9986", address: "\u5f20\u5bb6\u754c\u5e02\u6b66\u9675\u6e90\u5c0f\u5c91\u6751", avg_price: 25, queue_min: 10 },
        { name: "\u5eb8\u5c71\u4e61\u571f\u5bb6\u83dc", address: "\u5f20\u5bb6\u754c\u5e02\u6b66\u9675\u6e90\u4e2d\u5fc3", avg_price: 55, queue_min: 20 },
        { name: "\u571f\u5bb6\u814a\u8089\u5355\u9505\u706f\u9986", address: "\u5f20\u5bb6\u754c\u5e02\u6b66\u9675\u6e90\u666f\u533a\u5929\u95e8\u5c71\u811a\u4e0b", avg_price: 38, queue_min: 5 },
        { name: "\u5eb8\u5dde\u71df\u76d8\u8096", address: "\u5f20\u5bb6\u754c\u5e02\u6b66\u9675\u6e90\u5929\u95e8\u5c71\u666f\u533a\u5185", avg_price: 42, queue_min: 10 },
      ],
    },
    "\u4e09\u4e9a": {
      queue: 18, tickets: true,
      spoken: "\u4e09\u4e9a\u65c5\u6e38\u65fa\u5b63\uff0c11\u6708\u81f3\u6b21\u5e744\u6708\uff0c\u6d77\u9c9c\u4ef7\u683c\u4e0a\u6d6e\uff0c\u5efa\u8bae\u9884\u7b97\u591a\u4e88\u5907\u6d77\u9c9c\u9910\u8d39\u3002",
      items: [
        { name: "\u9e7f\u56de\u5934\u6d77\u9c9c\u5e7f\u573a", address: "\u4e09\u4e9a\u5e02\u6cb3\u897f\u533a\u9e7f\u56de\u5934\u534a\u5c9b", avg_price: 160, queue_min: 25 },
        { name: "\u5927\u4e1c\u6d77\u6d77\u9c9c\u6392\u6863", address: "\u4e09\u4e9a\u5e02\u5409\u9633\u533a\u5927\u4e1c\u6d77\u666f\u533a\u65c1", avg_price: 120, queue_min: 20 },
        { name: "\u5d16\u5dde\u53e4\u57ce\u00b7\u6e05\u8865\u51c9", address: "\u4e09\u4e9a\u5e02\u5d16\u5dde\u533a\u53e4\u57ce\u8857", avg_price: 15, queue_min: 5 },
        { name: "\u6912\u98ce\u6d77\u97f5\u9910\u5385", address: "\u4e09\u4e9a\u5e02\u5929\u6daf\u533a\u5929\u6daf\u6d77\u89d2\u65c1", avg_price: 88, queue_min: 10 },
        { name: "\u6d77\u68e0\u6e7e\u6e14\u5bb6\u4e50", address: "\u4e09\u4e9a\u5e02\u6d77\u68e0\u533a\u56fd\u5bb6\u6d77\u5c78", avg_price: 145, queue_min: 15 },
      ],
    },
    "\u6b66\u6c49": {
      queue: 25, tickets: true,
      spoken: "\u6b66\u6c49\u65e9\u9910\u6587\u5316\u72ec\u7279\uff0c\u70ed\u5e72\u9762\u3001\u8c46\u76ae\u65e9\u5e02\u6700\u65fa\uff0c\u6237\u90e8\u5df7\u665a\u5e02\u6392\u961f\u523025\u5206\u949f\u3002",
      items: [
        { name: "\u8521\u6797\u8bb0\u70ed\u5e72\u9762\u00b7\u53f8\u95e8\u53e3\u603b\u5e97", address: "\u6b66\u6c49\u5e02\u6b66\u660c\u533a\u53f8\u95e8\u53e3\u5f6d\u5218\u6768\u8def57\u53f7", avg_price: 12, queue_min: 20 },
        { name: "\u8001\u8c26\u8bb0\u8c46\u76ae\u6c64\u5706", address: "\u6b66\u6c49\u5e02\u6c49\u53e3\u533a\u4e2d\u5c71\u5927\u9053", avg_price: 18, queue_min: 15 },
        { name: "\u5927\u4e2d\u534e\u9152\u697c", address: "\u6b66\u6c49\u5e02\u6c5f\u6c49\u533a\u6c5f\u6c49\u8def\u6b65\u884c\u8857", avg_price: 95, queue_min: 25 },
        { name: "\u6237\u90e8\u5df7\u5c0f\u5403\u8857", address: "\u6b66\u6c49\u5e02\u6b66\u660c\u533a\u4e34\u6c5f\u5927\u9053\u6237\u90e8\u5df7", avg_price: 35, queue_min: 30 },
        { name: "\u56db\u5b63\u7f8e\u6c64\u5305\u9986", address: "\u6b66\u6c49\u5e02\u6c49\u53e3\u533a\u4e2d\u5c71\u5927\u90531037\u53f7", avg_price: 28, queue_min: 10 },
      ],
    },
    "\u53a6\u95e8": {
      queue: 22, tickets: true,
      spoken: "\u53a6\u95e8\u9f13\u6d6a\u5c7f\u95e8\u7968\u9700\u63d0\u524d\u9884\u8d2d\uff0c\u4e2d\u5c71\u8def\u6b65\u884c\u8857\u5c0f\u5403\u591c\u5e7c\u523022\u70b9\u6700\u70ed\u95f9\u3002",
      items: [
        { name: "\u9ec4\u5219\u548c\u82b1\u751f\u6c64\u5e97", address: "\u53a6\u95e8\u5e02\u601d\u660e\u533a\u4e2d\u5c71\u8def22\u53f7", avg_price: 15, queue_min: 20 },
        { name: "\u597d\u6e05\u9999\u9152\u697c\u00b7\u672c\u5e97", address: "\u53a6\u95e8\u5e02\u601d\u660e\u533a\u5927\u540c\u8def216\u53f7", avg_price: 95, queue_min: 15 },
        { name: "\u4f73\u4e3d\u5706\u5473\u00b7\u4e2d\u5c71\u8def\u5e97", address: "\u53a6\u95e8\u5e02\u601d\u660e\u533a\u4e2d\u5c71\u8def\u6b65\u884c\u8857", avg_price: 35, queue_min: 10 },
        { name: "\u9f13\u6d6a\u5c7f\u9985\u997c\u8001\u5b57\u53f7", address: "\u53a6\u95e8\u5e02\u601d\u660e\u533a\u9f13\u6d6a\u5c7f\u9f99\u5934\u8def", avg_price: 28, queue_min: 25 },
        { name: "\u5357\u666e\u9640\u7d20\u83dc\u9986", address: "\u53a6\u95e8\u5e02\u601d\u660e\u533a\u5357\u666e\u9640\u5bfa\u5185", avg_price: 55, queue_min: 20 },
      ],
    },
    "\u4e3d\u6c5f": {
      queue: 12, tickets: true,
      spoken: "\u4e3d\u6c5f\u53e4\u57ce\u514d\u8d39\u53c2\u89c2\u4f46\u9700\u8d2d\u7ef4\u62a4\u8d39\uff0c\u7389\u9f99\u96ea\u5c71\u7f26\u8f66\u7968\u5efa\u8bae\u63d0\u524d3\u5929\u8d2d\u3002",
      items: [
        { name: "\u7eb3\u897f\u4eba\u5bb6\u00b7\u6728\u5e9c\u65c1", address: "\u4e3d\u6c5f\u5e02\u53e4\u57ce\u533a\u4e94\u4e00\u8857\u6728\u5e9c\u65c1", avg_price: 68, queue_min: 15 },
        { name: "\u53e4\u57ce\u62ab\u8428\u5e97\u00b7\u56db\u65b9\u8857", address: "\u4e3d\u6c5f\u5e02\u53e4\u57ce\u533a\u56db\u65b9\u8857", avg_price: 45, queue_min: 10 },
        { name: "\u675f\u6cb3\u9e21\u8c46\u51c9\u7c89", address: "\u4e3d\u6c5f\u5e02\u53e4\u57ce\u533a\u675f\u6cb3\u53e4\u9547", avg_price: 12, queue_min: 5 },
        { name: "\u4e09\u6735\u706b\u9505", address: "\u4e3d\u6c5f\u5e02\u53e4\u57ce\u533a\u65b0\u534e\u8857", avg_price: 75, queue_min: 20 },
        { name: "\u7c91\u7c91\u5988\u5988\u7eb3\u897f\u5c0f\u5403", address: "\u4e3d\u6c5f\u5e02\u53e4\u57ce\u533a\u9ec4\u5c71\u4e0b\u6bb5", avg_price: 20, queue_min: 10 },
      ],
    },
    "\u5357\u4eac": {
      queue: 22, tickets: true,
      spoken: "\u5357\u4eac\u590f\u5b63\u65c5\u6e38\u65fa\u5b63\uff0c\u592b\u5b50\u5e99\u3001\u4e2d\u5c71\u9675\u9700\u63d0\u524d\u9884\u8ba2\uff0c\u79cb\u5898\u9e2d\u8840\u7cd5\u7b49\u5c0f\u5403\u5ea7\u4f4d\u7d27\u4fe9\u3002",
      items: [
        { name: "\u592b\u5b50\u5e99\u5c0f\u5403\u8857", address: "\u5357\u4eac\u5e02\u79e6\u6dee\u533a\u592b\u5b50\u5e99\u666f\u533a\u5185", avg_price: 35, queue_min: 25 },
        { name: "\u8001\u95e8\u4e01\u996d\u5e97\u00b7\u592b\u5b50\u5e99\u5e97", address: "\u5357\u4eac\u5e02\u79e6\u6dee\u533a\u5efa\u90ba\u8def28\u53f7", avg_price: 65, queue_min: 20 },
        { name: "\u7518\u719f\u5c0f\u9986\u00b7\u65b0\u8857\u53e3\u5e97", address: "\u5357\u4eac\u5e02\u79e6\u6dee\u533a\u65b0\u8857\u53e3\u6b65\u884c\u8857", avg_price: 28, queue_min: 15 },
        { name: "\u6c38\u548c\u5802\u9e2d\u8840\u7cd5\u9986", address: "\u5357\u4eac\u5e02\u7384\u6b66\u533a\u73e0\u6c5f\u8def137\u53f7", avg_price: 18, queue_min: 30 },
        { name: "\u5cad\u4e0a\u5927\u724c\u6dae\u9762\u9986", address: "\u5357\u4eac\u5e02\u9f13\u697c\u533a\u751f\u8fdb\u6c34\u5e02\u573a\u4e1c\u8def", avg_price: 22, queue_min: 10 },
      ],
    },
    "\u82cf\u5dde": {
      queue: 18, tickets: true,
      spoken: "\u82cf\u5dde\u8ba4\u8bc6\u5398\u56ed\u7d20\u98df\u4e30\u5bcc\uff0c\u62f3\u5934\u5927\u808c\u3001\u86ea\u86c5\u6c64\u6c41\u9762\u4e3a\u5f53\u5730\u5fc5\u5c1d\uff0c\u5efa\u8bae\u9547\u4e0a\u8d2d\u5730\u624b\u4f34\u4f34\u3002",
      items: [
        { name: "\u677e\u9e64\u697c\u00b7\u89c2\u524d\u8857\u5e97", address: "\u82cf\u5dde\u5e02\u59d1\u82cf\u533a\u89c2\u524d\u8857\u8def8\u53f7", avg_price: 120, queue_min: 25 },
        { name: "\u5efa\u4e1a\u5927\u996d\u5e97\u00b7\u89c2\u524d\u5e97", address: "\u82cf\u5dde\u5e02\u59d1\u82cf\u533a\u89c2\u524d\u8857\u8def69\u53f7", avg_price: 85, queue_min: 20 },
        { name: "\u62f3\u5934\u5927\u808c\u5e97\u00b7\u89c2\u524d\u5c71\u5e97", address: "\u82cf\u5dde\u5e02\u59d1\u82cf\u533a\u89c2\u524d\u5c71\u5916\u5546\u4e1a\u8857", avg_price: 45, queue_min: 15 },
        { name: "\u82cf\u5dde\u5927\u706c\u5c71\u6c64\u6c41\u9762\u9986", address: "\u82cf\u5dde\u5e02\u59d1\u82cf\u533a\u666f\u5fb7\u8def\u5546\u4e1a\u8857", avg_price: 22, queue_min: 10 },
        { name: "\u86ea\u86c5\u5992\u5992\u5c0f\u9986", address: "\u82cf\u5dde\u5e02\u59d1\u82cf\u533a\u5c71\u5858\u8def", avg_price: 18, queue_min: 8 },
      ],
    },
    "\u6842\u6797": {
      queue: 15, tickets: true,
      spoken: "\u6842\u6797\u5c71\u6c34\u7532\u5929\u4e0b\uff0c\u6f13\u6c5f\u6e38\u8239\u9700\u63d0\u524d2\u5929\u9884\u8ba2\uff0c\u7c73\u7c89\u3001\u4e91\u5438\u5c71\u7b4b\u662f\u5f53\u5730\u5fc5\u5c1d\u5c0f\u5403\u3002",
      items: [
        { name: "\u9756\u6c5f\u996d\u5e97\u00b7\u6b63\u9633\u8def\u5e97", address: "\u6842\u6797\u5e02\u79e6\u5c71\u533a\u6b63\u9633\u8def1\u53f7", avg_price: 55, queue_min: 20 },
        { name: "\u9a6c\u8096\u7c73\u7c89\u5c0f\u9986", address: "\u6842\u6797\u5e02\u79e6\u5c71\u533a\u4e2d\u5c71\u4e2d\u8def\u5546\u4e1a\u8857", avg_price: 18, queue_min: 15 },
        { name: "\u8001\u5357\u9986\u7c73\u7c89", address: "\u6842\u6797\u5e02\u79e6\u5c71\u533a\u89e3\u653e\u4e1c\u8def", avg_price: 15, queue_min: 10 },
        { name: "\u6843\u82b1\u6c5f\u9c9c\u9c7c\u996d\u5e97", address: "\u6842\u6797\u5e02\u7075\u5ddd\u533a\u5c71\u6c34\u8def", avg_price: 75, queue_min: 12 },
        { name: "\u4e91\u5438\u5c71\u7b4b\u5f71\u5c71\u5e97", address: "\u6842\u6797\u5e02\u7075\u5ddd\u533a\u5982\u610f\u5cf0\u53e3", avg_price: 28, queue_min: 5 },
      ],
    },
    "\u9752\u5c9b": {
      queue: 20, tickets: true,
      spoken: "\u9752\u5c9b\u6d77\u9c9c\u95fb\u540d\uff0c\u6ce2\u8d85\u5e02\u573a\u529f\u663e\u6d77\u9c9c\u65b0\u9c9c\uff0c\u4e0d\u5934\u8857\u591c\u5e02\u5c0f\u5403\u5757\u65c5\u6e38\u5fc5\u53bb\u3002",
      items: [
        { name: "\u6ce2\u8d85\u5e02\u573a\u6d77\u9c9c\u6447\u6307\u5c71", address: "\u9752\u5c9b\u5e02\u5c71\u4e1c\u533a\u6ce2\u8d85\u5e02\u573a\u5185", avg_price: 150, queue_min: 30 },
        { name: "\u5929\u5c71\u6d77\u9c9c\u9976\u9986\u00b7\u516b\u5927\u5173\u5e97", address: "\u9752\u5c9b\u5e02\u5e02\u5357\u533a\u516b\u5927\u5173\u6d77\u6c34\u6d74\u573a", avg_price: 120, queue_min: 20 },
        { name: "\u4e0d\u5934\u8857\u71c3\u70e7\u5c0f\u5403\u8857", address: "\u9752\u5c9b\u5e02\u5e02\u5357\u533a\u4e0d\u5934\u8857\u5546\u4e1a\u6b65\u884c\u8857", avg_price: 35, queue_min: 25 },
        { name: "\u8001\u8f66\u7ad9\u7b80\u9910\u5927\u738b", address: "\u9752\u5c9b\u5e02\u5e02\u5357\u533a\u4e2d\u5c71\u8def\u5546\u4e1a\u8857", avg_price: 45, queue_min: 10 },
        { name: "\u9752\u5c9b\u8c6a\u9c7c\u706f\u9986", address: "\u9752\u5c9b\u5e02\u5e02\u5357\u533a\u5fb7\u5c71\u8def\u6d77\u8fb9", avg_price: 80, queue_min: 15 },
      ],
    },
    "\u957f\u6c99": {
      queue: 28, tickets: true,
      spoken: "\u957f\u6c99\u8679\u5c71\u591c\u5e02\u706b\u7206\uff0c\u81ed\u8c46\u8150\u3001\u5c0f\u9f99\u867e\u7b49\u5c0f\u5403\u6c38\u8fdc\u6392\u961f\uff0c\u5efa\u8bae\u4e0b\u5348\u523b\u520a\u524d\u5f80\u9676\u8d77\u3002",
      items: [
        { name: "\u706b\u5bab\u6b63\u5927\u8679\u5c71\u8def\u5e97", address: "\u957f\u6c99\u5e02\u65ed\u533a\u8679\u5c71\u8def109\u53f7", avg_price: 95, queue_min: 40 },
        { name: "\u6587\u548c\u53cb\u81ed\u8c46\u8150\u5927\u96c6\u4f1a", address: "\u957f\u6c99\u5e02\u5929\u5fc3\u533a\u5c0f\u54a8\u5317\u5e73\u8def\u5546\u4e1a\u8857", avg_price: 65, queue_min: 35 },
        { name: "\u8d3a\u5c71\u8679\u5c71\u5c0f\u9f99\u867e\u9986", address: "\u957f\u6c99\u5e02\u5929\u5fc3\u533a\u8679\u5c71\u8def155\u53f7", avg_price: 45, queue_min: 30 },
        { name: "\u7b2c\u4e00\u6e7e\u8679\u5c71\u5965\u5305\u4e18\u5e97", address: "\u957f\u6c99\u5e02\u65ed\u533a\u8679\u5c71\u5730\u94811\u53f7\u53e3", avg_price: 28, queue_min: 20 },
        { name: "\u5f20\u53d4\u7c73\u9762\u5e97\u00b7\u8679\u5c71\u5e97", address: "\u957f\u6c99\u5e02\u65ed\u533a\u8679\u5c71\u8def\u5730\u94812\u53f7\u53e3", avg_price: 18, queue_min: 10 },
      ],
    },
    "\u5927\u7406": {
      queue: 12, tickets: true,
      spoken: "\u5927\u7406\u53e4\u57ce\u8d44\u666f\u5c40\u5e03\u8f7b\u677e\uff0c\u9999\u82b1\u5e02\u573a\u3001\u4eba\u6c11\u8def\u4e3a\u65c5\u6e38\u5fc5\u6253\u5361\u5730\uff0c\u767d\u65cf\u7f8a\u5994\u3001\u9245\u9505\u4e3a\u5f53\u5730\u7279\u8272\u3002",
      items: [
        { name: "\u7384\u5929\u4e3a\u5e97\u5c0f\u5403\u5e97", address: "\u5927\u7406\u53e4\u57ce\u5185\u4eba\u6c11\u8def", avg_price: 35, queue_min: 10 },
        { name: "\u767d\u65cf\u7f8a\u5994\u9165\u998b\u5e97\u00b7\u9999\u82b1\u5e02\u573a\u5e97", address: "\u5927\u7406\u5e02\u5927\u7406\u53e4\u57ce\u9999\u82b1\u5e02\u573a\u5185", avg_price: 45, queue_min: 15 },
        { name: "\u59d3\u5218\u9245\u9505\u9986", address: "\u5927\u7406\u5e02\u5c71\u9f99\u5c71\u8def\u5546\u4e1a\u8857", avg_price: 55, queue_min: 12 },
        { name: "\u6d17\u9a6c\u53e4\u9707\u996d\u5e97", address: "\u5927\u7406\u53e4\u57ce\u5185\u6d17\u9a6c\u7687\u5bab\u65c1", avg_price: 28, queue_min: 8 },
        { name: "\u9999\u82b1\u5e02\u573a\u5c0f\u5403\u6444\u5f71\u6467", address: "\u5927\u7406\u5e02\u5927\u7406\u53e4\u57ce\u9999\u82b1\u5e02\u573a", avg_price: 20, queue_min: 5 },
      ],
    },
    "\u6606\u660e": {
      queue: 18, tickets: true,
      spoken: "\u6606\u660e\u6625\u57ce\u5929\u6c14\u5b9c\u4eba\uff0c\u7fe1\u6e56\u5468\u8fb9\u5c0f\u5403\u8857\u8bcd\u5974\u5c71\u9c9c\u82b1\u997c\uff0c\u8fc7\u6865\u996d\u5e97\u5e78\u770b\u5473\u3002",
      items: [
        { name: "\u5efa\u6210\u5f97\u996d\u5e97", address: "\u6606\u660e\u5e02\u76d8\u9f99\u533a\u5ef7\u5c71\u8857\u9053", avg_price: 85, queue_min: 20 },
        { name: "\u54ac\u9556\u7ea2\u7684\u9999\u8fb9\u996d\u5e97", address: "\u6606\u660e\u5e02\u76d8\u9f99\u533a\u66f4\u751f\u8857\u9053", avg_price: 65, queue_min: 15 },
        { name: "\u7fe1\u6e56\u8fb9\u9ca3\u9c7c\u996d\u5e97", address: "\u6606\u660e\u5e02\u897f\u5c71\u533a\u7fe1\u6e56\u516c\u56ed\u5185\u6d77\u6e90\u5c71\u8def", avg_price: 95, queue_min: 25 },
        { name: "\u5c0f\u9505\u9965\u4e91\u5357\u7c73\u7ebf", address: "\u6606\u660e\u5e02\u76d8\u9f99\u533a\u53d1\u5c55\u5e7f\u573a\u5546\u4e1a\u8857", avg_price: 22, queue_min: 10 },
        { name: "\u9e2d\u5f39\u5bb6\u9ec4\u730e\u9c9c\u82b1\u5e95\u9505", address: "\u6606\u660e\u5e02\u76d8\u9f99\u533a\u65b0\u8fea\u5e7f\u573a\u9644\u8fd1", avg_price: 38, queue_min: 12 },
      ],
    },
    "\u54c8\u5c14\u6ee8": {
      queue: 15, tickets: true,
      spoken: "\u54c8\u5c14\u6ee8\u51ac\u5b63\u6c38\u4e0d\u5c71\u90fd\u9996\u9009\uff0c\u4e2d\u592e\u5927\u8857\u6b27\u5f0f\u5efa\u7b51\u9083\u8854\uff0c\u9505\u8d34\u3001\u7ea2\u80a0\u3001\u4fe5\u5c14\u8bba\u5993\u662f\u5f53\u5730\u7279\u8272\u3002",
      items: [
        { name: "\u8001\u5382\u9505\u8d34\u9986\u00b7\u9053\u91cc\u5e97", address: "\u54c8\u5c14\u6ee8\u5e02\u9053\u91cc\u533a\u4e2d\u592e\u5927\u8857\u4e2d\u6bb5", avg_price: 55, queue_min: 20 },
        { name: "\u534e\u6885\u996d\u5e97\u00b7\u4e2d\u592e\u5927\u8857\u5e97", address: "\u54c8\u5c14\u6ee8\u5e02\u9053\u91cc\u533a\u4e2d\u592e\u5927\u8857123\u53f7", avg_price: 45, queue_min: 15 },
        { name: "\u73b2\u73ca\u6c34\u9970\u54c1\u5bb6\u5510\u6c14\u9986\u00b7\u9053\u91cc\u5e97", address: "\u54c8\u5c14\u6ee8\u5e02\u9053\u91cc\u533a\u9053\u91cc\u4e2d\u5fc3\u5e7f\u573a\u65c1", avg_price: 35, queue_min: 10 },
        { name: "\u65b0\u7586\u7ea2\u7597\u6781\u5de5\u5c4f\u5c71\u5e97", address: "\u54c8\u5c14\u6ee8\u5e02\u9053\u91cc\u533a\u79e6\u5bb6\u5c97\u5730\u533a\u5546\u4e1a\u8857", avg_price: 28, queue_min: 8 },
        { name: "\u4fe5\u5c14\u8bba\u9965\u5e97", address: "\u54c8\u5c14\u6ee8\u5e02\u9053\u91cc\u533a\u90e8\u961f\u4ecb\u7ecf\u516c\u53f8", avg_price: 22, queue_min: 5 },
      ],
    },
    "\u5929\u6d25": {
      queue: 20, tickets: true,
      spoken: "\u5929\u6d25\u7206\u8563\u3001\u718f\u9177\u8465\u5e74\u9996\u9009\uff0c\u53e4\u6587\u5316\u8857\u593e\u5c0f\u5403\u822c\u5bcc\uff0c\u5c24\u5176\u5929\u6d25\u767e\u997c\u5404\u662f\u5fc5\u5c1d\u3002",
      items: [
        { name: "\u72d7\u4e0d\u7406\u5305\u5b50\u00b7\u53e4\u6587\u5316\u8857\u5e97", address: "\u5929\u6d25\u5e02\u8d64\u5c97\u533a\u53e4\u6587\u5316\u8857\u5e02\u573a\u5185", avg_price: 28, queue_min: 25 },
        { name: "\u6607\u53d1\u5927\u9965\u5e97\u00b7\u5185\u9662\u5e97", address: "\u5929\u6d25\u5e02\u5357\u5f00\u533a\u5185\u9662\u5185\u5927\u8857", avg_price: 75, queue_min: 20 },
        { name: "\u5929\u6d25\u767e\u997c\u00b7\u53e4\u6587\u5316\u8857\u5e97", address: "\u5929\u6d25\u5e02\u8d64\u5c97\u533a\u8fad\u5eb8\u8def\u5546\u4e1a\u8857", avg_price: 30, queue_min: 15 },
        { name: "\u8001\u8f66\u7ad9\u9eba\u5934\u9986", address: "\u5929\u6d25\u5e02\u548c\u5e73\u533a\u5c71\u6d77\u8def\u6b65\u884c\u8857", avg_price: 35, queue_min: 10 },
        { name: "\u718f\u9177\u8405\u5927\u9905\u00b7\u5929\u6d25\u5e97", address: "\u5929\u6d25\u5e02\u5357\u5f00\u533a\u6d77\u6cb3\u53e3\u5927\u8857", avg_price: 55, queue_min: 12 },
      ],
    },
    "\u9ec4\u5c71": {
      queue: 10, tickets: true,
      spoken: "\u9ec4\u5c71\u666f\u533a\u9700\u63d0\u524d3\u5929\u9884\u8ba2\u7f46\u8f66\u7968\uff0c\u5c71\u4e0a\u996d\u5e97\u4ef7\u683c\u504f\u9ad8\uff0c\u5efa\u8bae\u6253\u5305\u996d\u4e8a\u5c71\u3002",
      items: [
        { name: "\u5c71\u95e8\u571f\u83dc\u9986\u00b7\u6c64\u53e3\u5e97", address: "\u5b89\u5fbd\u9ec4\u5c71\u5e02\u6c64\u53e3\u53bf\u666f\u533a\u5165\u53e3\u5e7f\u573a", avg_price: 55, queue_min: 10 },
        { name: "\u5c71\u73cd\u533a\u571f\u7279\u4ea7\u5c0f\u5403\u8857", address: "\u5b89\u5fbd\u9ec4\u5c71\u5e02\u5c71\u73cd\u57ce\u5e02\u5e7f\u573a", avg_price: 30, queue_min: 8 },
        { name: "\u7ff0\u5c71\u5c71\u9a84\u5e84\u56ed\u996d\u5e97", address: "\u5b89\u5fbd\u9ec4\u5c71\u5e02\u6c64\u53e3\u53bf\u7ff0\u5c71\u91cc", avg_price: 45, queue_min: 5 },
        { name: "\u5927\u9ec4\u5c71\u571f\u83dc\u9986\u00b7\u4e91\u8c37\u5e97", address: "\u5b89\u5fbd\u9ec4\u5c71\u5e02\u9ec4\u5c71\u98ce\u666f\u533a\u4e91\u8c37\u666f\u9a71", avg_price: 65, queue_min: 12 },
        { name: "\u6c61\u5de5\u519c\u5bb6\u4e50\u00b7\u5c71\u820d\u90a3\u517c", address: "\u5b89\u5fbd\u9ec4\u5c71\u5e02\u6c64\u53e3\u53bf\u5c71\u820d\u9547", avg_price: 35, queue_min: 0 },
      ],
    },
    "\u62c9\u8428": {
      queue: 8, tickets: true,
      spoken: "\u62c9\u8428\u6d77\u62d4\u9ad8\uff0c\u5efa\u8bae\u6162\u6177\u9002\u5e94\u4e00\u5929\u518d\u8fdb\u884c\u9ad8\u5f3a\u5ea6\u6d3b\u52a8\uff0c\u85cf\u5f0f\u70e7\u7f8a\u8089\u548c\u9178\u5976\u8336\u5c9b\u5ffc\u5f53\u5730\u5c0f\u5403\u9996\u9009\u3002",
      items: [
        { name: "\u8001\u897f\u85cf\u997c\u5df4\u5DF4", address: "\u62c9\u8428\u5e02\u57ce\u5173\u533a\u5e7f\u573a\u5317\u8def\u6b65\u884c\u8857", avg_price: 28, queue_min: 10 },
        { name: "\u5bab\u53f6\u996d\u5e97\u00b7\u5e03\u8fbe\u62c9\u5bab\u5e97", address: "\u62c9\u8428\u5e02\u57ce\u5173\u533a\u5317\u4eac\u4e2d\u8def8\u53f7", avg_price: 95, queue_min: 15 },
        { name: "\u654f\u73e0\u85cf\u9910\u9986", address: "\u62c9\u8428\u5e02\u57ce\u5173\u533a\u91d1\u73e0\u8def", avg_price: 55, queue_min: 8 },
        { name: "\u85cf\u6c11\u5bb6\u70e7\u7f8a\u8089\u9986", address: "\u62c9\u8428\u5e02\u57ce\u5173\u533a\u516b\u5ec3\u5927\u8857", avg_price: 45, queue_min: 5 },
        { name: "\u62c9\u8428\u9153\u5c4b\u9152\u5e97", address: "\u62c9\u8428\u5e02\u57ce\u5173\u533a\u5957\u4e0d\u620e\u8def", avg_price: 35, queue_min: 0 },
      ],
    },
  };

  const key = String(city || "").replace(/\u5e02$/, "");
  const d = CITY_DATA[key];
  if (d) {
    return {
      restaurant_queue:    d.queue,
      ticket_availability: d.tickets,
      spoken_text:         d.spoken,
      item_list:           d.items.map((it) => ({ ...it, real_photo_url: "" })),
      _synthetic:          true,
    };
  }
  // Unknown city — return null to signal AI enrichment is needed
  return null;
}

/**
 * Generate enrichment data for any city.
 * Priority: Amap POI (real-time, live data) → OpenAI (AI-generated) → hash fallback.
 * Cached per city+intent for 4 h.
 */
async function buildAIEnrichment(city, intentAxis) {
  const cacheKey = `${city}:${intentAxis || "food"}`;
  const cached = AI_ENRICHMENT_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < AI_ENRICHMENT_TTL_MS) {
    console.log(`[ai-enrichment] Cache hit: ${cacheKey}`);
    return cached.data;
  }

  const isFood = !intentAxis || intentAxis === "food";

  // ── Level 1: Amap POI (real data, zero LLM cost) ──────────────────────────
  const AMAP_API_KEY = String(process.env.AMAP_API_KEY || process.env.GAODE_API_KEY || "").trim();
  if (AMAP_API_KEY) {
    try {
      const poiType  = isFood                        ? "restaurant"
                     : intentAxis === "activity"    ? "attraction"
                     : "hotel";
      const pois     = await queryAmapPoi(city, poiType);
      if (pois && pois.length >= 3) {
        const isAttraction = poiType === "attraction";
        const items = pois.slice(0, 6).map((p) => ({
          name:           p.name,
          address:        p.address || city,
          avg_price:      isFood       ? (p.price || 60)  : undefined,
          ticket_price:   isAttraction ? (p.price || null) : undefined,  // null = price unknown; 0 = genuinely free
          queue_min:      isFood       ? (p.rating >= 4.5 ? 30 : p.rating >= 4.0 ? 15 : 5) : undefined,
          open_hours:     isAttraction ? (p.open_time ? p.open_time.trim().split(/\s+/).pop() : "9:00-18:00") : undefined,
          real_photo_url: "",
        }));
        const avgQueue = isFood
          ? Math.round(items.reduce((s, i) => s + (i.queue_min || 0), 0) / items.length)
          : 0;
        const enrichment = {
          restaurant_queue:    avgQueue,
          ticket_availability: true,
          spoken_text:         `${city}${isFood ? "\u7f8e\u98df\u4e30\u5bcc" : "\u666f\u70b9\u4f17\u591a"}\uff0c\u5efa\u8bae\u63d0\u524d\u9884\u8ba2\u70ed\u95e8${isFood ? "\u9910\u5385" : "\u666f\u70b9"}\u3002`,
          item_list:           items,
          _synthetic:          false,   // real Amap data
          _source:             "amap",
        };
        AI_ENRICHMENT_CACHE.set(cacheKey, { data: enrichment, ts: Date.now() });
        console.log(`[ai-enrichment] Amap live data for ${city}: ${items.length} ${poiType}s`);
        return enrichment;
      }
    } catch (e) {
      console.warn(`[ai-enrichment] Amap failed for ${city}:`, e.message);
    }
  }

  // ── Level 2: OpenAI generation (AI-generated, costs tokens) ──────────────
  const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || "").trim();
  const OPENAI_BASE_URL = String(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const OPENAI_MODEL = String(process.env.OPENAI_MODEL || "gpt-4o-mini").trim();

  const startedAt    = Date.now();
  const itemTemplate = isFood
    ? `{"name":"\u5177\u4f53\u5e97\u540d","address":"\u771f\u5b9e\u5730\u5740","avg_price":65,"queue_min":20,"real_photo_url":""}`
    : `{"name":"\u5177\u4f53\u666f\u70b9\u540d","address":"\u771f\u5b9e\u5730\u5740","ticket_price":80,"open_hours":"9:00-18:00","real_photo_url":""}`;
  const userPrompt = isFood
    ? `Generate realistic restaurant enrichment for ${city}, China. Return ONLY this JSON (5 items, use real restaurant names that exist in ${city}):
{"restaurant_queue":25,"ticket_availability":true,"spoken_text":"<one sentence about ${city} dining scene in Chinese, e.g. peak hours and tips>","item_list":[${itemTemplate},${itemTemplate},${itemTemplate},${itemTemplate},${itemTemplate}]}`
    : `Generate realistic attraction enrichment for ${city}, China. Return ONLY this JSON (5 items, use real attraction names that exist in ${city}):
{"restaurant_queue":0,"ticket_availability":true,"spoken_text":"<one sentence about ${city} tourism in Chinese, e.g. ticket tips>","item_list":[${itemTemplate},${itemTemplate},${itemTemplate},${itemTemplate},${itemTemplate}]}`;

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: "system", content: "You are a China travel data API. Return ONLY valid JSON, no markdown, no explanation." },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 900,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`openai_http_${res.status}`);
    const data = await res.json();
    const raw  = data?.choices?.[0]?.message?.content?.trim() || "";
    const s    = raw.indexOf("{"), e2 = raw.lastIndexOf("}");
    if (s === -1 || e2 === -1) throw new Error("no_json");
    const parsed = JSON.parse(raw.slice(s, e2 + 1));
    if (!Array.isArray(parsed.item_list) || !parsed.item_list.length) throw new Error("no_items");
    const enrichment = { ...parsed, _synthetic: true, _source: "openai" };
    AI_ENRICHMENT_CACHE.set(cacheKey, { data: enrichment, ts: Date.now() });
    console.log(`[ai-enrichment] OpenAI generated for ${city} in ${Date.now() - startedAt}ms (${parsed.item_list.length} items)`);
    return enrichment;
  } catch (e) {
    console.warn(`[ai-enrichment] OpenAI failed for ${city}:`, e.message);
  } finally {
    clearTimeout(timer);
  }

  // ── Level 3: hash-based fallback (no data, no tokens) ─────────────────────
  const h = String(city || "").split("").reduce((a, c) => (a + c.charCodeAt(0)) & 0xffff, 0);
  return {
    restaurant_queue:    [15, 20, 25, 30][(h >> 3) % 4],
    ticket_availability: true,
    spoken_text:         `${city || "\u76ee\u7684\u5730"}\u65c5\u6e38\u70ed\u5ea6\u9ad8\uff0c\u5efa\u8bae\u63d0\u524d\u9884\u8ba2\u666f\u70b9\u95e8\u7968\u548c\u7279\u8272\u9910\u5385\u3002`,
    _synthetic:          true,
    _source:             "fallback",
  };
}

/**
 * Call the Coze Workflow API for real-time travel intelligence enrichment.
 * ALWAYS returns an enrichment object — falls back to synthetic/AI data on any failure.
 */
async function callCozeWorkflow({ query, city, lang, budget, intentAxis }) {
  const COZE_API_KEY     = String(process.env.COZE_API_KEY || "").trim();
  const COZE_WORKFLOW_ID = String(process.env.COZE_WORKFLOW_ID || "7611467642825605161").trim();
  const COZE_API_BASE    = String(process.env.COZE_API_BASE || "https://api.coze.cn").replace(/\/+$/, "");

  // Helper: Amap first (real POI), merge synthetic queue/tips, fall back to static
  const getEnrichment = async () => {
    const amapData = await buildAIEnrichment(city, intentAxis);
    if (amapData && amapData._source === "amap") {
      // Real Amap item_list + curated queue/tips from synthetic where available
      const synthetic = buildSyntheticEnrichment(city);
      return {
        ...amapData,
        restaurant_queue: synthetic?.restaurant_queue ?? amapData.restaurant_queue,
        spoken_text:      synthetic?.spoken_text      ?? amapData.spoken_text,
      };
    }
    // Amap unavailable — synthetic for known cities, or whatever buildAIEnrichment returned
    const staticData = buildSyntheticEnrichment(city);
    if (staticData !== null) return staticData;
    return amapData;
  };

  if (!COZE_API_KEY || !COZE_WORKFLOW_ID) {
    console.log("[coze/workflow] No key/workflow configured — using AI enrichment");
    return getEnrichment();
  }

  // Cache check — avoid repeated Coze calls for same city within TTL
  const cozeCacheKey = String(city || "").trim().toLowerCase();
  const cozeHit = COZE_RESULT_CACHE.get(cozeCacheKey);
  if (cozeHit && Date.now() - cozeHit.ts < COZE_RESULT_TTL_MS) {
    console.log(`[coze/workflow] Cache hit: ${cozeCacheKey}`);
    return cozeHit.data;
  }

  try {
    const resp = await fetch(`${COZE_API_BASE}/v1/workflow/run`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${COZE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workflow_id: COZE_WORKFLOW_ID,
        parameters: {
          query: String(query || ""),
          city: String(city || ""),
          lang: String(lang || "ZH"),
          budget: String(budget || ""),
          location: String(city || ""),
        },
      }),
      signal: AbortSignal.timeout(20000),  // 20s — Coze LLM call needs headroom
    });
    const json = await resp.json();
    if (json.code !== 0) {
      if (json.code === 4100) {
        console.warn(`[coze/workflow] AUTH EXPIRED (4100) — regenerate PAT at https://www.coze.cn → 个人设置 → API 令牌, then update COZE_API_KEY in .env.local`);
      } else if (json.code === 4200) {
        console.warn(`[coze/workflow] WORKFLOW NOT FOUND (4200) — check COZE_WORKFLOW_ID in .env.local (current: ${COZE_WORKFLOW_ID})`);
      } else {
        console.warn(`[coze/workflow] API error ${json.code}: ${json.msg} — using AI enrichment`);
      }
      return getEnrichment();
    }
    // `data` may be a JSON string or already an object
    let output = json.data;
    if (typeof output === "string") {
      // Detect unresolved Coze template (End node misconfigured — variable not bound)
      if (output.includes("{{") && output.includes("}}")) {
        console.warn("[coze/workflow] End node returned unresolved template — using AI enrichment");
        return getEnrichment();
      }
      try { output = JSON.parse(output); } catch {
        output = { spoken_text: output };
      }
    }
    if (!output || typeof output !== "object") {
      return getEnrichment();
    }
    // Coze End node wraps result: { output: "<JSON string>" } — unwrap one more level
    if (typeof output.output === "string") {
      try { output = JSON.parse(output.output); } catch { /* keep outer object */ }
    }
    if (!output || typeof output !== "object") {
      return getEnrichment();
    }
    console.log("[coze/workflow] Real enrichment received:", JSON.stringify(output).slice(0, 200));
    COZE_RESULT_CACHE.set(cozeCacheKey, { data: output, ts: Date.now() });
    return output;
  } catch (e) {
    console.warn("[coze/workflow] Call failed:", e.message, "— using AI enrichment");
    return getEnrichment();
  }
}

module.exports = { buildSyntheticEnrichment, buildAIEnrichment, callCozeWorkflow };
