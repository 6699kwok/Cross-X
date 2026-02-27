const http = require("http");
const https = require("https");
const { parse: parseUrl } = require("url");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { createToolRegistry } = require("./lib/tools/registry");
const { createGaodeConnector } = require("./lib/connectors/gaode");
const { createPartnerHubConnector } = require("./lib/connectors/partner_hub");
const { createAuditLogger } = require("./lib/trust/audit");
const { createConfirmPolicy } = require("./lib/trust/confirm");
const { createOrchestrator } = require("./lib/orchestrator");
const { buildQuote, roundMoney } = require("./lib/commerce/merchant");
const { createPaymentRailManager, normalizeRail } = require("./lib/payments/rail");
const { buildAgentMeta } = require("./lib/planner");
const { buildChinaTravelKnowledge } = require("./lib/knowledge/china-travel");
const ragEngine = require("./lib/rag/engine");

// ── Extracted planner modules ──────────────────────────────────────────────
const { openAIRequest, setDefaultModel, setDefaultBaseUrl } = require("./src/ai/openai");
const { safeParseJson } = require("./src/planner/mock");
const { configure: configurePipeline, generateCrossXResponse } = require("./src/planner/pipeline");
const { createPlanRouter } = require("./src/routes/plan");
const { fetchFxRates, fetchJutuiRestaurants } = require("./src/services/api_gateway");
const sessionItinerary = new Map(); // 2h TTL session context, keyed by client IP

// ─── Sichuan Attraction Knowledge Base (1650 records from RAG project CSVs) ───
let _sichuanAttractions = null;
function getSichuanAttractions() {
  if (!_sichuanAttractions) {
    try {
      _sichuanAttractions = JSON.parse(
        fs.readFileSync(path.join(__dirname, "lib/knowledge/sichuan-attractions.json"), "utf-8")
      );
    } catch { _sichuanAttractions = {}; }
  }
  return _sichuanAttractions;
}

/**
 * Search Sichuan attraction data by city and/or keyword.
 * Returns top `limit` sorted by rating desc.
 */
function searchAttractions({ city = "", keyword = "", limit = 8 } = {}) {
  const db = getSichuanAttractions();
  const kw = String(keyword).toLowerCase();

  // Determine which city buckets to search
  let buckets = [];
  if (city) {
    const cityKey = Object.keys(db).find((k) =>
      k === city || city.includes(k) || k.includes(city)
    );
    if (cityKey) buckets = [db[cityKey]];
  }
  if (!buckets.length) buckets = Object.values(db); // search all

  let results = buckets.flat();

  // Keyword filter
  if (kw) {
    results = results.filter((a) =>
      [a.name, a.intro, a.address, a.tips, a.season].some(
        (f) => f && String(f).toLowerCase().includes(kw)
      )
    );
  }

  // Sort by rating desc, take top N
  return results
    .sort((a, b) => (b.rating || 0) - (a.rating || 0))
    .slice(0, limit)
    .map((a) => ({
      name: a.name,
      city: a.city,
      rating: a.rating,
      address: a.address,
      hours: a.hours,
      ticket: a.ticket,
      visit_time: a.visit_time,
      season: a.season,
      intro: a.intro ? a.intro.slice(0, 200) : "",
      tips: a.tips ? a.tips.slice(0, 150) : "",
    }));
}

function loadLocalEnvFiles() {
  const loaded = [];
  const envFiles = [
    path.join(__dirname, ".env.local"),
    path.join(__dirname, ".env"),
  ];
  for (const filePath of envFiles) {
    if (!fs.existsSync(filePath)) continue;
    let raw = "";
    try {
      raw = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    loaded.push(filePath);
    const lines = raw.split(/\r?\n/);
    for (const lineRaw of lines) {
      const line = String(lineRaw || "").trim();
      if (!line || line.startsWith("#")) continue;
      const cleaned = line.startsWith("export ") ? line.slice(7).trim() : line;
      const idx = cleaned.indexOf("=");
      if (idx <= 0) continue;
      const key = cleaned.slice(0, idx).trim();
      if (!key || !!process.env[key]) continue;  // overwrite only if current value is falsy/empty
      let value = cleaned.slice(idx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
  return loaded;
}

let LOADED_ENV_FILES = loadLocalEnvFiles();

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const BUILD_ID = process.env.BUILD_ID || "crossx-20260224-r34";
let OPENAI_API_KEY = "";
let OPENAI_KEY_SOURCE = null;
let OPENAI_MODEL = "gpt-4o-mini";
let OPENAI_TTS_MODEL = "gpt-4o-mini-tts";
let OPENAI_BASE_URL = "https://api.openai.com/v1";
let OPENAI_TIMEOUT_MS = 8500;
let OPENAI_KEY_HEALTH = { looksValid: false, reason: "missing", providerHint: "openai" };
let OPENAI_LAST_RUNTIME = {
  attemptedAt: null,
  successAt: null,
  errorAt: null,
  lastError: null,
  statusCode: null,
  durationMs: null,
};

function inspectOpenAiKey(keyRaw) {
  let key = String(keyRaw || "").trim();
  if (!key) return { looksValid: false, reason: "missing", providerHint: "openai" };
  key = key.replace(/^Bearer\s+/i, "").replace(/^["']+|["']+$/g, "").trim();
  if (!key) return { looksValid: false, reason: "missing", providerHint: "openai" };
  if (/[\u4e00-\u9fa5]/.test(key)) return { looksValid: false, reason: "contains_non_ascii_placeholder", providerHint: "openai" };
  if (/\s/.test(key)) return { looksValid: false, reason: "contains_whitespace", providerHint: "openai" };
  if (!/^sk-[a-z0-9._\-]+$/i.test(key)) return { looksValid: false, reason: "invalid_prefix_or_format", providerHint: "openai" };
  if (key.length < 28) return { looksValid: false, reason: "too_short", providerHint: "openai" };
  return { looksValid: true, reason: "ok", providerHint: "openai" };
}

function openAiKeyPreview(keyRaw) {
  const key = String(keyRaw || "").trim();
  if (!key) return "";
  if (key.length <= 12) return `${key.slice(0, 4)}...`;
  return `${key.slice(0, 7)}...${key.slice(-4)}`;
}

function applyOpenAiConfig() {
  OPENAI_API_KEY = String(
    process.env.OPENAI_API_KEY ||
    process.env.OPENAI_KEY ||
    process.env.CHATGPT_API_KEY ||
    "",
  )
    .replace(/^Bearer\s+/i, "")
    .replace(/^["']+|["']+$/g, "")
    .trim();
  OPENAI_KEY_SOURCE = process.env.OPENAI_API_KEY
    ? "OPENAI_API_KEY"
    : process.env.OPENAI_KEY
      ? "OPENAI_KEY"
      : process.env.CHATGPT_API_KEY
        ? "CHATGPT_API_KEY"
        : null;
  OPENAI_MODEL = String(process.env.OPENAI_MODEL || process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini").trim();
  OPENAI_TTS_MODEL = String(process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts").trim();
  OPENAI_BASE_URL = String(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  OPENAI_TIMEOUT_MS = Math.max(3000, Number(process.env.OPENAI_TIMEOUT_MS || 8500));
  OPENAI_KEY_HEALTH = inspectOpenAiKey(OPENAI_API_KEY);
}

applyOpenAiConfig();

// ─── Claude / Anthropic ───────────────────────────────────────────────────────
let ANTHROPIC_API_KEY = "";
let ANTHROPIC_KEY_SOURCE = null;
let ANTHROPIC_MODEL = "claude-sonnet-4-6";
let ANTHROPIC_BASE_URL = "https://api.anthropic.com";
let ANTHROPIC_TIMEOUT_MS = 10000;
let ANTHROPIC_KEY_HEALTH = { looksValid: false, reason: "missing", providerHint: "anthropic" };
let ANTHROPIC_LAST_RUNTIME = {
  attemptedAt: null,
  successAt: null,
  errorAt: null,
  lastError: null,
  statusCode: null,
  durationMs: null,
};

function inspectClaudeKey(keyRaw) {
  let key = String(keyRaw || "").trim();
  if (!key) return { looksValid: false, reason: "missing", providerHint: "anthropic" };
  key = key.replace(/^Bearer\s+/i, "").replace(/^["']+|["']+$/g, "").trim();
  if (!key) return { looksValid: false, reason: "missing", providerHint: "anthropic" };
  if (/[\u4e00-\u9fa5]/.test(key)) return { looksValid: false, reason: "contains_non_ascii_placeholder", providerHint: "anthropic" };
  if (/\s/.test(key)) return { looksValid: false, reason: "contains_whitespace", providerHint: "anthropic" };
  // Accept standard Anthropic keys (sk-ant-*) and proxy keys (sk_*, sk-*)
  if (!/^sk/i.test(key)) return { looksValid: false, reason: "invalid_prefix_or_format", providerHint: "anthropic" };
  if (key.length < 20) return { looksValid: false, reason: "too_short", providerHint: "anthropic" };
  return { looksValid: true, reason: "ok", providerHint: "anthropic" };
}

function claudeKeyPreview(keyRaw) {
  const key = String(keyRaw || "").trim();
  if (!key) return "";
  if (key.length <= 12) return `${key.slice(0, 4)}...`;
  return `${key.slice(0, 10)}...${key.slice(-4)}`;
}

function applyClaudeConfig() {
  ANTHROPIC_API_KEY = String(
    process.env.ANTHROPIC_API_KEY ||
    process.env.CLAUDE_API_KEY ||
    process.env.CLAUDE_KEY ||
    "",
  )
    .replace(/^Bearer\s+/i, "")
    .replace(/^["']+|["']+$/g, "")
    .trim();
  ANTHROPIC_KEY_SOURCE = process.env.ANTHROPIC_API_KEY
    ? "ANTHROPIC_API_KEY"
    : process.env.CLAUDE_API_KEY
      ? "CLAUDE_API_KEY"
      : process.env.CLAUDE_KEY
        ? "CLAUDE_KEY"
        : null;
  ANTHROPIC_MODEL = String(process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6").trim();
  ANTHROPIC_BASE_URL = String(process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "");
  ANTHROPIC_TIMEOUT_MS = Math.max(3000, Number(process.env.ANTHROPIC_TIMEOUT_MS || 10000));
  ANTHROPIC_KEY_HEALTH = inspectClaudeKey(ANTHROPIC_API_KEY);
}

applyClaudeConfig();

// ─── Coze ─────────────────────────────────────────────────────────────────────
let COZE_API_KEY = "";
let COZE_API_BASE = "https://api.coze.cn";
let COZE_BOT_ID = "";

let COZE_WORKFLOW_ID = "7611467642825605161";

function applyCozeConfig() {
  COZE_API_KEY = String(process.env.COZE_API_KEY || "").trim();
  COZE_API_BASE = String(process.env.COZE_API_BASE || "https://api.coze.cn").replace(/\/+$/, "");
  COZE_BOT_ID = String(process.env.COZE_BOT_ID || "").trim();
  COZE_WORKFLOW_ID = String(process.env.COZE_WORKFLOW_ID || "7611467642825605161").trim();
}

applyCozeConfig();

/**
 * Synthetic enrichment — generated from city name when Coze workflow is
 * unavailable (missing key, workflow 4200, network failure, etc.).
 * Keeps the rendering pipeline fully active so all Coze UI slots render.
 */
function buildSyntheticEnrichment(city) {
  // Stable pseudo-random per city so hot-reload doesn't flicker
  const h = String(city || "").split("").reduce((a, c) => (a + c.charCodeAt(0)) & 0xffff, 0);
  const queueMinutes = [15, 20, 25, 30, 35, 40][(h >> 3) % 6];
  return {
    restaurant_queue:    queueMinutes,
    ticket_availability: true,
    spoken_text: `${city || "目的地"}旅游热度高，建议提前预订景点门票和特色餐厅。`,
    _synthetic: true,   // debug flag — not rendered by frontend
  };
}

/**
 * Call the Coze Workflow API for real-time travel intelligence enrichment.
 * ALWAYS returns an enrichment object — falls back to synthetic data on any
 * failure (missing key, workflow not found, network error, timeout).
 * Fields: hero_image?, restaurant_queue, ticket_availability, total_price?, spoken_text
 */
async function callCozeWorkflow({ query, city, lang, budget }) {
  if (!COZE_API_KEY || !COZE_WORKFLOW_ID) {
    console.log("[coze/workflow] No key/workflow configured — using synthetic enrichment");
    return buildSyntheticEnrichment(city);
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
        },
      }),
      signal: AbortSignal.timeout(25000),
    });
    const json = await resp.json();
    if (json.code !== 0) {
      // 4200 = workflow not found; other codes = API error
      console.warn(`[coze/workflow] API error ${json.code}: ${json.msg} — using synthetic enrichment`);
      return buildSyntheticEnrichment(city);
    }
    // `data` may be a JSON string or already an object
    let output = json.data;
    if (typeof output === "string") {
      try { output = JSON.parse(output); } catch {
        output = { spoken_text: output };
      }
    }
    if (!output || typeof output !== "object") {
      return buildSyntheticEnrichment(city);
    }
    console.log("[coze/workflow] Real enrichment received:", JSON.stringify(output).slice(0, 200));
    return output;
  } catch (e) {
    console.warn("[coze/workflow] Call failed:", e.message, "— using synthetic enrichment");
    return buildSyntheticEnrichment(city);
  }
}

// ─── Python RAG Service Bridge (Intelligent-Tourism-QA-System) ───────────────
// When running, forward scenic/attraction questions to the Python FastAPI on port 8005.
let RAG_SERVICE_URL = "";
function applyRagServiceConfig() {
  RAG_SERVICE_URL = String(process.env.RAG_SERVICE_URL || process.env.PYTHON_RAG_URL || "").replace(/\/+$/, "");
}
applyRagServiceConfig();

/**
 * Call the Python RAG service (POST /qa) with a tourism question.
 * Returns { answer, sources } or null if service unavailable.
 */
async function callPythonRagService(question, sessionId = "crossx") {
  if (!RAG_SERVICE_URL) return null;
  try {
    const resp = await fetch(`${RAG_SERVICE_URL}/qa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, session_id: sessionId, top_k: 5 }),
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return {
      answer: data.answer || null,
      sources: Array.isArray(data.source_documents) ? data.source_documents : [],
    };
  } catch {
    return null;
  }
}

// ─── Amap (高德地图) ──────────────────────────────────────────────────────────
let AMAP_API_KEY = "";

function applyAmapConfig() {
  AMAP_API_KEY = String(process.env.AMAP_API_KEY || process.env.GAODE_API_KEY || "").trim();
}

applyAmapConfig();

/**
 * Query Amap POI API for hotels and restaurants in a city.
 * Returns array of { name, address, tel, rating, price, type } or null on failure.
 */
async function queryAmapPoi(city, poiType = "hotel") {
  if (!AMAP_API_KEY) return null;
  // Amap type codes: 050100=星级酒店, 050200=快捷酒店, 050301=中餐厅, 050302=外国餐厅, 050303=快餐
  const typeMap = {
    hotel:      "050100|050200",
    budget:     "050200",
    luxury:     "050100",
    restaurant: "050301|050302|050303|050304",
    halal:      "050301",
    transport:  "150200|150300",
  };
  const types = typeMap[poiType] || "050100|050200";
  const url = `https://restapi.amap.com/v3/place/text?key=${AMAP_API_KEY}` +
    `&keywords=${encodeURIComponent(poiType === "restaurant" ? "餐厅" : "酒店")}` +
    `&city=${encodeURIComponent(city)}&citylimit=true` +
    `&types=${types}&extensions=all&offset=25&output=JSON`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!resp.ok) { console.warn("[amap] HTTP", resp.status); return null; }
    const data = await resp.json();
    if (String(data.status) !== "1" || !Array.isArray(data.pois) || !data.pois.length) {
      console.warn("[amap] status!=1 or empty pois, info:", data.info);
      return null;
    }
    return data.pois.map((p) => ({
      name: String(p.name || ""),
      address: String(Array.isArray(p.address) ? p.address.join("") : (p.address || "")),
      tel: String(Array.isArray(p.tel) ? p.tel[0] : (p.tel || "")),
      rating: p.biz_ext ? (parseFloat(p.biz_ext.rating) || 0) : 0,
      price: p.biz_ext ? (parseFloat(p.biz_ext.cost) || 0) : 0,
      area: String(p.adname || p.pname || city),
      type: String(p.type || ""),
    })).filter((p) => p.name);
  } catch (e) {
    console.warn("[amap] error:", e.message);
    return null;
  }
}

/**
 * Enrich a mockBuildThreeTierPlans() options_card with real Amap hotel data.
 * Replaces hotel_name and area per tier if data is available.
 */
async function enrichPlanWithAmapData(plan, city) {
  const pois = await queryAmapPoi(city, "hotel");
  if (!pois || pois.length < 3) return plan; // not enough data, keep mock

  // Sort by rating desc; partition into luxury (rating≥4.5), mid, budget
  const sorted = [...pois].sort((a, b) => (b.rating || 0) - (a.rating || 0));
  const luxury  = sorted.filter((p) => p.rating >= 4.5).slice(0, 5);
  const mid     = sorted.filter((p) => p.rating >= 4.0 && p.rating < 4.5).slice(0, 5);
  const budget  = sorted.filter((p) => p.rating < 4.0 || p.price < 300).slice(0, 5);

  const pick = (pool, fallback) => pool[Math.floor(Math.random() * pool.length)] || fallback;

  const enrichOpt = (opt) => {
    let pool;
    if (opt.tag && /极致|豪华|高端|premium/i.test(opt.tag)) pool = luxury;
    else if (opt.tag && /均衡|推荐|balanced/i.test(opt.tag)) pool = mid.length ? mid : sorted;
    else pool = budget.length ? budget : sorted.slice(-3);
    const poi = pick(pool, null);
    if (!poi) return opt;
    return {
      ...opt,
      hotel_name: poi.price > 0
        ? `${poi.name}（${poi.area}，约¥${poi.price}/晚）`
        : `${poi.name}（${poi.area}）`,
      hotel_address: poi.address || opt.hotel_address || "",
      hotel_tel: poi.tel || opt.hotel_tel || "",
      hotel_rating: poi.rating || opt.hotel_rating || "",
    };
  };

  return {
    ...plan,
    options: plan.options.map(enrichOpt),
    data_source: "amap",
  };
}

const PUBLIC_DIR = path.join(__dirname, "web");
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const ENV_LOCAL_FILE = path.join(__dirname, ".env.local");

function formatEnvValue(raw) {
  const value = String(raw == null ? "" : raw);
  if (!value) return "";
  if (/[\s#"'`]/.test(value)) return JSON.stringify(value);
  return value;
}

function parseEnvAssignment(lineRaw) {
  const line = String(lineRaw || "").trim();
  if (!line || line.startsWith("#")) return null;
  const cleaned = line.startsWith("export ") ? line.slice(7).trim() : line;
  const idx = cleaned.indexOf("=");
  if (idx <= 0) return null;
  const key = cleaned.slice(0, idx).trim();
  const value = cleaned.slice(idx + 1).trim();
  if (!key) return null;
  return { key, value };
}

function persistOpenAiRuntimeEnv({ clear = false, updates = null }) {
  const updateMap = updates && typeof updates === "object" ? updates : {};
  const removeKeys = new Set([
    "OPENAI_API_KEY",
    "OPENAI_KEY",
    "CHATGPT_API_KEY",
    "OPENAI_MODEL",
    "OPENAI_TTS_MODEL",
    "OPENAI_BASE_URL",
    "OPENAI_TIMEOUT_MS",
  ]);

  let lines = [];
  if (fs.existsSync(ENV_LOCAL_FILE)) {
    try {
      lines = fs.readFileSync(ENV_LOCAL_FILE, "utf8").split(/\r?\n/);
    } catch {
      lines = [];
    }
  }
  if (!Array.isArray(lines)) lines = [];

  const indexByKey = new Map();
  for (let i = 0; i < lines.length; i += 1) {
    const parsed = parseEnvAssignment(lines[i]);
    if (!parsed) continue;
    indexByKey.set(parsed.key, i);
  }

  // Remove old aliases to avoid confusion.
  for (const key of removeKeys) {
    const idx = indexByKey.get(key);
    if (idx != null) {
      lines[idx] = "";
      indexByKey.delete(key);
    }
  }

  if (!clear) {
    const entries = Object.entries(updateMap)
      .map(([k, v]) => [String(k || "").trim(), v])
      .filter(([k, v]) => k && v != null && String(v).trim() !== "");
    for (const [key, value] of entries) {
      const row = `${key}=${formatEnvValue(value)}`;
      const idx = indexByKey.get(key);
      if (idx != null) {
        lines[idx] = row;
      } else {
        lines.push(row);
        indexByKey.set(key, lines.length - 1);
      }
    }
  }

  // Normalize trailing blanks.
  while (lines.length && String(lines[lines.length - 1] || "").trim() === "") {
    lines.pop();
  }

  try {
    fs.writeFileSync(ENV_LOCAL_FILE, `${lines.join("\n")}\n`, "utf8");
    return { ok: true, file: ENV_LOCAL_FILE };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err || "persist_env_failed") };
  }
}

const db = {
  users: {
    demo: {
      id: "demo",
      language: "EN",
      city: "Shanghai",
      viewMode: "user",
      preferences: {
        budget: "mid",
        dietary: "",
        family: false,
        accessibility: "optional",
        transport: "mixed",
        walking: "walk",
        allergy: "",
      },
      savedPlaces: {
        hotel: "",
        office: "",
        airport: "PVG",
      },
      location: {
        lat: null,
        lng: null,
        accuracy: null,
        updatedAt: null,
        source: "none",
      },
      privacy: {
        locationEnabled: true,
      },
      authDomain: {
        noPinEnabled: true,
        dailyLimit: 2000,
        singleLimit: 500,
      },
      paymentRail: {
        selected: "alipay_cn",
      },
      plusSubscription: {
        active: false,
        plan: "none",
        benefits: [],
      },
    },
  },
  tasks: {},
  tripPlans: {},
  orders: {},
  settlements: [],
  providerLedger: [],
  reconciliationRuns: [],
  miniProgram: {
    version: "0.1.0",
    channels: {
      alipay: { status: "ready", pathPrefix: "pages/" },
      wechat: { status: "ready", pathPrefix: "pages/" },
    },
    releases: [],
  },
  auditLogs: [],
  mcpCalls: [],
  metricEvents: [],
  chatNotifications: [],
  supportTickets: [],
  supportSessions: {},
  idempotency: {},
  featureFlags: {
    plusConcierge: { enabled: false, rollout: 0 },
    manualFallback: { enabled: true, rollout: 100 },
    liveTranslation: { enabled: false, rollout: 10 },
  },
  mcpContracts: {
    gaode_or_fallback: { id: "gaode_or_fallback", provider: "Gaode LBS", external: true, slaMs: 2200, enforced: true },
    partner_hub_queue: { id: "partner_hub_queue", provider: "Partner Hub Queue API", external: true, slaMs: 1800, enforced: true },
    partner_hub_booking: { id: "partner_hub_booking", provider: "Partner Hub Booking API", external: true, slaMs: 2500, enforced: true },
    partner_hub_traffic: { id: "partner_hub_traffic", provider: "Partner Hub Traffic API", external: true, slaMs: 1800, enforced: true },
    partner_hub_transport: { id: "partner_hub_transport", provider: "Partner Hub Transport API", external: true, slaMs: 2500, enforced: true },
    payment_rail: { id: "payment_rail", provider: "ACT Rail Gateway", external: true, slaMs: 3200, enforced: true },
  },
  mcpPolicy: {
    enforceSla: false,
    simulateBreachRate: 0,
  },
  paymentCompliance: {
    policy: {
      blockUncertifiedRails: true,
      requireFraudScreen: true,
    },
    rails: {
      alipay_cn: { certified: true, kycPassed: true, pciDss: true, riskTier: "low", enabled: true },
      wechat_cn: { certified: true, kycPassed: true, pciDss: true, riskTier: "medium", enabled: true },
      card_delegate: { certified: true, kycPassed: true, pciDss: true, riskTier: "high", enabled: true },
    },
  },
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadDb() {
  try {
    ensureDataDir();
    if (!fs.existsSync(DB_FILE)) return;
    const raw = fs.readFileSync(DB_FILE, "utf8");
    if (!raw.trim()) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;
    db.users = parsed.users || db.users;
    db.tasks = parsed.tasks || db.tasks;
    db.tripPlans = parsed.tripPlans || db.tripPlans;
    db.orders = parsed.orders || db.orders;
    db.settlements = parsed.settlements || db.settlements;
    db.providerLedger = parsed.providerLedger || db.providerLedger;
    db.reconciliationRuns = parsed.reconciliationRuns || db.reconciliationRuns;
    db.miniProgram = parsed.miniProgram || db.miniProgram;
    db.auditLogs = parsed.auditLogs || db.auditLogs;
    db.mcpCalls = parsed.mcpCalls || db.mcpCalls;
    db.metricEvents = parsed.metricEvents || db.metricEvents;
    db.chatNotifications = parsed.chatNotifications || db.chatNotifications;
    db.supportTickets = parsed.supportTickets || db.supportTickets;
    db.supportSessions = parsed.supportSessions || db.supportSessions;
    db.idempotency = parsed.idempotency || db.idempotency;
    db.featureFlags = parsed.featureFlags || db.featureFlags;
    db.mcpContracts = parsed.mcpContracts || db.mcpContracts;
    db.mcpPolicy = parsed.mcpPolicy || db.mcpPolicy;
    db.paymentCompliance = parsed.paymentCompliance || db.paymentCompliance;
    if (!db.users.demo.privacy) {
      db.users.demo.privacy = { locationEnabled: true };
    }
    if (!db.users.demo.viewMode) {
      db.users.demo.viewMode = "user";
    }
    if (!db.users.demo.savedPlaces || typeof db.users.demo.savedPlaces !== "object") {
      db.users.demo.savedPlaces = {
        hotel: "",
        office: "",
        airport: "PVG",
      };
    }
    if (!db.users.demo.location || typeof db.users.demo.location !== "object") {
      db.users.demo.location = {
        lat: null,
        lng: null,
        accuracy: null,
        updatedAt: null,
        source: "none",
      };
    }
    if (!db.users.demo.preferences || typeof db.users.demo.preferences !== "object") {
      db.users.demo.preferences = { budget: "mid" };
    }
    db.users.demo.preferences = {
      budget: "mid",
      dietary: "",
      family: false,
      accessibility: "optional",
      transport: "mixed",
      walking: "walk",
      allergy: "",
      ...db.users.demo.preferences,
    };
    if (!db.users.demo.paymentRail) {
      db.users.demo.paymentRail = { selected: "alipay_cn" };
    }
    if (!db.users.demo.plusSubscription) {
      db.users.demo.plusSubscription = { active: false, plan: "none", benefits: [] };
    }
    if (!db.mcpPolicy) {
      db.mcpPolicy = { enforceSla: false, simulateBreachRate: 0 };
    }
    if (typeof db.mcpPolicy.simulateBreachRate !== "number") {
      db.mcpPolicy.simulateBreachRate = 0;
    }
    if (!db.miniProgram || typeof db.miniProgram !== "object") {
      db.miniProgram = {
        version: "0.1.0",
        channels: {
          alipay: { status: "ready", pathPrefix: "pages/" },
          wechat: { status: "ready", pathPrefix: "pages/" },
        },
        releases: [],
      };
    }
    if (!db.miniProgram.channels) {
      db.miniProgram.channels = {
        alipay: { status: "ready", pathPrefix: "pages/" },
        wechat: { status: "ready", pathPrefix: "pages/" },
      };
    }
    if (!Array.isArray(db.miniProgram.releases)) {
      db.miniProgram.releases = [];
    }
    if (!db.mcpContracts || typeof db.mcpContracts !== "object") {
      db.mcpContracts = {
        gaode_or_fallback: { id: "gaode_or_fallback", provider: "Gaode LBS", external: true, slaMs: 2200, enforced: true },
        partner_hub_queue: { id: "partner_hub_queue", provider: "Partner Hub Queue API", external: true, slaMs: 1800, enforced: true },
        partner_hub_booking: { id: "partner_hub_booking", provider: "Partner Hub Booking API", external: true, slaMs: 2500, enforced: true },
        partner_hub_traffic: { id: "partner_hub_traffic", provider: "Partner Hub Traffic API", external: true, slaMs: 1800, enforced: true },
        partner_hub_transport: { id: "partner_hub_transport", provider: "Partner Hub Transport API", external: true, slaMs: 2500, enforced: true },
        payment_rail: { id: "payment_rail", provider: "ACT Rail Gateway", external: true, slaMs: 3200, enforced: true },
      };
    }
    if (!db.paymentCompliance || typeof db.paymentCompliance !== "object") {
      db.paymentCompliance = {
        policy: {
          blockUncertifiedRails: true,
          requireFraudScreen: true,
        },
        rails: {
          alipay_cn: { certified: true, kycPassed: true, pciDss: true, riskTier: "low", enabled: true },
          wechat_cn: { certified: true, kycPassed: true, pciDss: true, riskTier: "medium", enabled: true },
          card_delegate: { certified: true, kycPassed: true, pciDss: true, riskTier: "high", enabled: true },
        },
      };
    }
    if (migrateLoadedData()) {
      saveDb();
    }
    if (!db.tripPlans || typeof db.tripPlans !== "object") {
      db.tripPlans = {};
    }
    if (!Array.isArray(db.chatNotifications)) {
      db.chatNotifications = [];
    }
    if (!db.supportSessions || typeof db.supportSessions !== "object" || Array.isArray(db.supportSessions)) {
      db.supportSessions = {};
    }
    let linkedSupportChanged = false;
    if (Array.isArray(db.supportTickets)) {
      for (const ticket of db.supportTickets) {
        const session = ensureSupportSessionForTicket(ticket, { skipGreeting: true, startedBy: "system" });
        if (session && (!ticket.sessionId || ticket.sessionId !== session.id)) {
          ticket.sessionId = session.id;
          linkedSupportChanged = true;
        }
      }
    }
    if (linkedSupportChanged) saveDb();
  } catch (err) {
    console.error("Failed to load db:", err.message);
  }
}

function saveDb() {
  try {
    ensureDataDir();
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
  } catch (err) {
    console.error("Failed to save db:", err.message);
  }
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeLang(language) {
  const upper = String(language || "EN").toUpperCase();
  if (upper.startsWith("ZH")) return "ZH";
  if (upper.startsWith("JA") || upper.startsWith("JP")) return "JA";
  if (upper.startsWith("KO")) return "KO";
  return "EN";
}

function pickLang(language, zh, en, ja, ko) {
  const lang = normalizeLang(language);
  if (lang === "ZH") return zh;
  if (lang === "JA") return ja || en;
  if (lang === "KO") return ko || en;
  return en;
}

const HOTEL_CITY_ROWS = [
  { cityCode: "2", cityName: "上海", cityEn: "Shanghai" },
  { cityCode: "1", cityName: "北京", cityEn: "Beijing" },
  { cityCode: "30", cityName: "深圳", cityEn: "Shenzhen" },
  { cityCode: "32", cityName: "广州", cityEn: "Guangzhou" },
  { cityCode: "17", cityName: "杭州", cityEn: "Hangzhou" },
  { cityCode: "28", cityName: "成都", cityEn: "Chengdu" },
];

const HOTEL_TEMPLATE_ROWS = [
  {
    key: "river_premium",
    nameCn: "滨江国际酒店",
    nameEn: "Riverside Premium Hotel",
    starRating: 5,
    commentScore: 4.8,
    district: "CBD",
    imageUrl: "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=80",
    tags: ["business", "airport", "view", "river", "foreign-friendly"],
    basePrice: 980,
  },
  {
    key: "metro_smart",
    nameCn: "都会智选酒店",
    nameEn: "Metro Smart Hotel",
    starRating: 4,
    commentScore: 4.6,
    district: "Metro Hub",
    imageUrl: "https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?auto=format&fit=crop&w=1200&q=80",
    tags: ["metro", "budget", "family", "english-service"],
    basePrice: 620,
  },
  {
    key: "airport_express",
    nameCn: "机场快线酒店",
    nameEn: "Airport Express Hotel",
    starRating: 4,
    commentScore: 4.5,
    district: "Airport Link",
    imageUrl: "https://images.unsplash.com/photo-1445019980597-93fa8acb246c?auto=format&fit=crop&w=1200&q=80",
    tags: ["airport", "early-flight", "transfer", "quiet"],
    basePrice: 680,
  },
  {
    key: "heritage_boutique",
    nameCn: "历史街区精品酒店",
    nameEn: "Heritage Boutique Hotel",
    starRating: 5,
    commentScore: 4.7,
    district: "Historic Zone",
    imageUrl: "https://images.unsplash.com/photo-1522798514-97ceb8c4f1c8?auto=format&fit=crop&w=1200&q=80",
    tags: ["old-town", "culture", "couple", "walkable"],
    basePrice: 860,
  },
  {
    key: "value_stay",
    nameCn: "优享商务酒店",
    nameEn: "Value Business Stay",
    starRating: 3,
    commentScore: 4.3,
    district: "Business Zone",
    imageUrl: "https://images.unsplash.com/photo-1564501049412-61c2a3083791?auto=format&fit=crop&w=1200&q=80",
    tags: ["budget", "business", "fast-checkin"],
    basePrice: 420,
  },
];

const HOTEL_ROOM_TEMPLATES = [
  {
    key: "queen",
    roomTypeName: "Superior Queen",
    maxGuests: 2,
    breakfastInfo: "1 breakfast included",
    cancelRule: "Free cancel before 18:00 one day prior",
    priceFactor: 1,
  },
  {
    key: "twin",
    roomTypeName: "Deluxe Twin",
    maxGuests: 2,
    breakfastInfo: "2 breakfasts included",
    cancelRule: "Free cancel before 16:00 one day prior",
    priceFactor: 1.12,
  },
  {
    key: "family",
    roomTypeName: "Family Suite",
    maxGuests: 4,
    breakfastInfo: "2 breakfasts + kids set",
    cancelRule: "Free cancel before 14:00 one day prior",
    priceFactor: 1.34,
  },
];

const HOTEL_CATALOG_CACHE = new Map();

function toDateOnlyIso(dateObj) {
  if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return "";
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDateDays(dateIso, days = 0) {
  const dt = new Date(`${dateIso}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return "";
  dt.setUTCDate(dt.getUTCDate() + Number(days || 0));
  return toDateOnlyIso(dt);
}

function normalizeHotelDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const direct = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (direct) {
    return `${direct[1]}-${String(direct[2]).padStart(2, "0")}-${String(direct[3]).padStart(2, "0")}`;
  }
  const md = raw.match(/^(\d{1,2})[-/.](\d{1,2})$/);
  if (md) {
    const year = new Date().getFullYear();
    return `${year}-${String(md[1]).padStart(2, "0")}-${String(md[2]).padStart(2, "0")}`;
  }
  return "";
}

function todayDateIso() {
  return toDateOnlyIso(new Date());
}

function normalizeDateRange(checkInDate, checkOutDate) {
  const inDate = normalizeHotelDate(checkInDate) || addDateDays(todayDateIso(), 1);
  const outInput = normalizeHotelDate(checkOutDate);
  const outDate = outInput || addDateDays(inDate, 1);
  if (new Date(`${outDate}T00:00:00Z`).getTime() <= new Date(`${inDate}T00:00:00Z`).getTime()) {
    return { checkInDate: inDate, checkOutDate: addDateDays(inDate, 1) };
  }
  return { checkInDate: inDate, checkOutDate: outDate };
}

function countStayNights(checkInDate, checkOutDate) {
  const inTs = new Date(`${checkInDate}T00:00:00Z`).getTime();
  const outTs = new Date(`${checkOutDate}T00:00:00Z`).getTime();
  if (!Number.isFinite(inTs) || !Number.isFinite(outTs) || outTs <= inTs) return 1;
  return Math.max(1, Math.round((outTs - inTs) / (1000 * 60 * 60 * 24)));
}

function findHotelCityByName(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  return (
    HOTEL_CITY_ROWS.find(
      (item) =>
        item.cityName === raw ||
        item.cityEn.toLowerCase() === lower ||
        lower.includes(item.cityEn.toLowerCase()) ||
        raw.includes(item.cityName),
    ) || null
  );
}

function getHotelCityRowByCode(cityCode) {
  const code = String(cityCode || "").trim();
  return HOTEL_CITY_ROWS.find((item) => item.cityCode === code) || null;
}

function resolveHotelCityRow(cityCode, cityName, fallbackName = "Shanghai") {
  const byCode = getHotelCityRowByCode(cityCode);
  if (byCode) return byCode;
  const byName = findHotelCityByName(cityName) || findHotelCityByName(fallbackName);
  return byName || HOTEL_CITY_ROWS[0];
}

function normalizeBudgetCap(raw) {
  const text = String(raw || "").trim().toLowerCase();
  if (!text) return null;
  if (text === "low") return 500;
  if (text === "mid") return 900;
  if (text === "high") return 1600;
  const amount = Number(text.replace(/[^\d.]/g, ""));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function normalizeStarFloor(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  const text = String(raw).trim().toLowerCase();
  if (!text) return null;
  if (text.includes("5")) return 5;
  if (text.includes("4")) return 4;
  if (text.includes("3")) return 3;
  const n = Number(text.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.max(1, Math.min(5, Math.round(n)));
}

function ensureHotelCatalog(cityCode) {
  const code = String(cityCode || "");
  if (HOTEL_CATALOG_CACHE.has(code)) return HOTEL_CATALOG_CACHE.get(code);
  const city = getHotelCityRowByCode(code) || HOTEL_CITY_ROWS[0];
  const rows = HOTEL_TEMPLATE_ROWS.map((tpl, idx) => {
    const cityBias = stablePercent(`${city.cityCode}:${tpl.key}`) % 8;
    const rooms = HOTEL_ROOM_TEMPLATES.map((room, roomIdx) => {
      const roomId = `R_${city.cityCode}_${idx + 1}_${roomIdx + 1}`;
      return {
        roomId,
        roomTypeName: room.roomTypeName,
        maxGuests: room.maxGuests,
        breakfastInfo: room.breakfastInfo,
        cancelRule: room.cancelRule,
        basePrice: Math.max(280, Math.round(tpl.basePrice * room.priceFactor) + cityBias * 8),
      };
    });
    return {
      cityCode: city.cityCode,
      cityName: city.cityName,
      cityEn: city.cityEn,
      hotelId: `HTL_${city.cityCode}_${idx + 1}`,
      hotelName: `${city.cityName}${tpl.nameCn} (${tpl.nameEn})`,
      hotelAddress: `${city.cityName}${tpl.district} · ${idx + 18} ${tpl.nameCn}`,
      starRating: tpl.starRating,
      commentScore: Number((tpl.commentScore - cityBias * 0.02).toFixed(1)),
      imageUrl: tpl.imageUrl,
      tags: tpl.tags,
      rooms,
    };
  });
  HOTEL_CATALOG_CACHE.set(code, rows);
  return rows;
}

function findHotelAndRoom(hotelId, roomId) {
  for (const city of HOTEL_CITY_ROWS) {
    const hotels = ensureHotelCatalog(city.cityCode);
    for (const hotel of hotels) {
      if (String(hotel.hotelId) !== String(hotelId)) continue;
      const room =
        hotel.rooms.find((item) => String(item.roomId) === String(roomId)) ||
        hotel.rooms[0] ||
        null;
      return { city, hotel, room };
    }
  }
  return { city: null, hotel: null, room: null };
}

function buildHotelInventoryQuote({ hotelId, roomId, checkInDate, checkOutDate, guestNum }) {
  const { hotel, room } = findHotelAndRoom(hotelId, roomId);
  if (!hotel || !room) {
    return {
      canBook: false,
      totalPrice: 0,
      inventoryNum: 0,
      breakfastInfo: "",
      cancelRule: "",
      priceValidTime: nowIso(),
      roomTypeName: "",
      roomId: String(roomId || ""),
      hotelId: String(hotelId || ""),
    };
  }
  const { checkInDate: inDate, checkOutDate: outDate } = normalizeDateRange(checkInDate, checkOutDate);
  const nights = countStayNights(inDate, outDate);
  const dynamicBump = (stablePercent(`${hotel.hotelId}:${room.roomId}:${inDate}:${outDate}`) % 21) - 6;
  const baseTotal = room.basePrice * nights;
  const totalPrice = roundMoney(baseTotal * (1 + dynamicBump / 100));
  const inventoryNum = Math.max(0, 7 - Math.floor(stablePercent(`${hotel.hotelId}:${room.roomId}:${inDate}`) / 16));
  const pax = Math.max(1, Number(guestNum || 1));
  const canBook = inventoryNum > 0 && pax <= Number(room.maxGuests || 2);
  const validMs = Date.now() + 1000 * 60 * 8;
  return {
    canBook,
    totalPrice,
    inventoryNum,
    breakfastInfo: room.breakfastInfo,
    cancelRule: room.cancelRule,
    priceValidTime: new Date(validMs).toISOString(),
    roomTypeName: room.roomTypeName,
    roomId: room.roomId,
    hotelId: hotel.hotelId,
    nights,
  };
}

function searchHotelsCore({
  cityCode,
  checkInDate,
  checkOutDate,
  pageNum = 1,
  pageSize = 10,
  budget = null,
  starRating = null,
  keyword = "",
  guestNum = 1,
}) {
  const city = resolveHotelCityRow(cityCode, null);
  const { checkInDate: inDate, checkOutDate: outDate } = normalizeDateRange(checkInDate, checkOutDate);
  const budgetCap = normalizeBudgetCap(budget);
  const starFloor = normalizeStarFloor(starRating);
  const keywordLower = String(keyword || "").trim().toLowerCase();
  const hotels = ensureHotelCatalog(city.cityCode)
    .map((hotel) => {
      const roomQuotes = hotel.rooms.map((room) =>
        buildHotelInventoryQuote({
          hotelId: hotel.hotelId,
          roomId: room.roomId,
          checkInDate: inDate,
          checkOutDate: outDate,
          guestNum,
        }),
      );
      const sellable = roomQuotes.filter((item) => item.canBook);
      if (!sellable.length) return null;
      const bestRoom = sellable.sort((a, b) => Number(a.totalPrice || 0) - Number(b.totalPrice || 0))[0];
      const lowestPrice = Number(bestRoom.totalPrice || 0);
      const textPool = `${hotel.hotelName} ${hotel.hotelAddress} ${hotel.tags.join(" ")}`.toLowerCase();
      const keywordHit = keywordLower ? textPool.includes(keywordLower) : true;
      if (!keywordHit) return null;
      if (budgetCap && lowestPrice > budgetCap) return null;
      if (starFloor && Number(hotel.starRating || 0) < starFloor) return null;
      return {
        hotelId: hotel.hotelId,
        hotelName: hotel.hotelName,
        hotelAddress: hotel.hotelAddress,
        starRating: hotel.starRating,
        lowestPrice,
        commentScore: hotel.commentScore,
        bestRoom,
        imageUrl: hotel.imageUrl,
        canBook: true,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const scoreA = Number(a.commentScore || 0) * 100 - Number(a.lowestPrice || 0) * 0.04;
      const scoreB = Number(b.commentScore || 0) * 100 - Number(b.lowestPrice || 0) * 0.04;
      return scoreB - scoreA;
    });

  const safePageSize = Math.max(1, Math.min(20, Number(pageSize || 10)));
  const safePageNum = Math.max(1, Number(pageNum || 1));
  const start = (safePageNum - 1) * safePageSize;
  const list = hotels.slice(start, start + safePageSize);
  return {
    city,
    checkInDate: inDate,
    checkOutDate: outDate,
    total: hotels.length,
    pageNum: safePageNum,
    pageSize: safePageSize,
    list,
  };
}

function buildHotelOutOrderNo() {
  return `OC${Date.now().toString().slice(-10)}${Math.floor(Math.random() * 900 + 100)}`;
}

function pushChatNotification(payload) {
  const row = {
    id: `ntf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
    at: nowIso(),
    type: "order_update",
    ...payload,
  };
  db.chatNotifications.push(row);
  if (db.chatNotifications.length > 240) {
    db.chatNotifications = db.chatNotifications.slice(-240);
  }
  return row;
}

function listChatNotificationsSince(since = "") {
  const sinceTs = since ? new Date(since).getTime() : 0;
  if (!Number.isFinite(sinceTs) || sinceTs <= 0) {
    return db.chatNotifications.slice(-40);
  }
  return db.chatNotifications.filter((item) => new Date(item.at).getTime() > sinceTs);
}

function pollCadenceSecForHotelOrderStatus(status) {
  const s = String(status || "");
  if (s === "pending_confirmation" || s === "awaiting_payment") return 600;
  if (s === "confirmed" || s === "completed") return 86400;
  return 0;
}

function refreshHotelOrderRuntime(order, source = "system") {
  if (!order) return;
  if (!order.polling || typeof order.polling !== "object") order.polling = {};
  const cadenceSec = pollCadenceSecForHotelOrderStatus(order.orderStatus || order.status || "");
  if (cadenceSec <= 0) {
    order.polling.active = false;
    order.polling.cadenceSec = 0;
    order.polling.nextPollAt = null;
    order.polling.stoppedAt = nowIso();
    order.polling.stopReason = `status:${order.orderStatus || order.status || "unknown"}`;
    return;
  }
  order.polling.active = true;
  order.polling.cadenceSec = cadenceSec;
  order.polling.lastSource = source;
  const nowMs = Date.now();
  order.polling.nextPollAt = new Date(nowMs + cadenceSec * 1000).toISOString();
}

function maybeAdvanceHotelOrderStatus(order, source = "poll") {
  if (!order) return { changed: false, pushed: [] };
  const prev = String(order.orderStatus || order.status || "pending_confirmation");
  const createdMs = new Date(order.createdAt || nowIso()).getTime();
  const ageSec = Math.max(0, Math.floor((Date.now() - createdMs) / 1000));
  const pushed = [];

  if (prev === "pending_confirmation" && ageSec >= 55) {
    order.orderStatus = "confirmed";
    order.status = "confirmed";
    order.payStatus = order.payStatus === "paid" ? "paid" : "paid";
    lifecyclePush(order.lifecycle || [], "confirmed", "Order confirmed", "Hotel inventory confirmed by supplier.");
    pushed.push(
      pushChatNotification({
        orderId: order.id,
        outOrderNo: order.outOrderNo || "",
        status: "confirmed",
        message: "订单已确认，酒店已为你保留房间。",
        messageEn: "Your hotel order is confirmed and room inventory is secured.",
      }),
    );
  }

  if (prev === "cancelled" && ageSec >= 90) {
    order.orderStatus = "refunded";
    order.status = "refunded";
    order.refundStatus = "completed";
    order.refundAmount = Number(order.totalPrice || order.price || 0);
    lifecyclePush(order.lifecycle || [], "refunded", "Refund completed", `${order.refundAmount || 0} CNY refunded.`);
    pushed.push(
      pushChatNotification({
        orderId: order.id,
        outOrderNo: order.outOrderNo || "",
        status: "refund_completed",
        message: "退款已完成，资金将按银行时效到账。",
        messageEn: "Refund completed. Funds will arrive based on your bank timeline.",
      }),
    );
  }

  const changed = String(order.orderStatus || order.status || "") !== prev;
  if (changed) {
    order.updatedAt = nowIso();
    if (!order.polling || typeof order.polling !== "object") order.polling = {};
    order.polling.active = false;
    order.polling.stoppedAt = nowIso();
    order.polling.stopReason = `status_changed:${prev}->${order.orderStatus || order.status}`;
    order.polling.lastSource = source;
  } else {
    refreshHotelOrderRuntime(order, source);
  }
  return { changed, pushed };
}

function runHotelOrderPollingCycle() {
  const nowMs = Date.now();
  let changed = false;
  for (const order of Object.values(db.orders || {})) {
    if (!order || order.type !== "hotel") continue;
    if (!order.polling || order.polling.active !== true) continue;
    const nextPollMs = order.polling.nextPollAt ? new Date(order.polling.nextPollAt).getTime() : 0;
    if (!Number.isFinite(nextPollMs) || nextPollMs > nowMs) continue;
    order.polling.lastPolledAt = nowIso();
    const progressed = maybeAdvanceHotelOrderStatus(order, "poll");
    if (progressed.changed) changed = true;
    order.updatedAt = nowIso();
  }
  if (changed) saveDb();
}

function extractHotelSlotInfo(message = "", constraints = {}) {
  const text = String(message || "").trim();
  const lower = text.toLowerCase();
  const slots = {
    city: String(constraints.city || constraints.cityName || "").trim() || "",
    cityCode: String(constraints.cityCode || "").trim() || "",
    checkInDate: normalizeHotelDate(constraints.checkInDate || constraints.check_in_date || "") || "",
    checkOutDate: normalizeHotelDate(constraints.checkOutDate || constraints.check_out_date || "") || "",
    guestNum: Math.max(1, Number(constraints.guestNum || constraints.group_size || constraints.party_size || 1)),
    budget: constraints.budget || "",
    starRating: constraints.starRating || constraints.star || "",
    keyword: String(constraints.keyword || constraints.area || "").trim(),
  };

  const cityFromText = findHotelCityByName(text);
  if (cityFromText) {
    slots.city = cityFromText.cityEn;
    slots.cityCode = cityFromText.cityCode;
  }
  const dateMatches = [...text.matchAll(/(20\d{2}[-/.]\d{1,2}[-/.]\d{1,2})/g)].map((item) => normalizeHotelDate(item[1]));
  if (dateMatches[0] && !slots.checkInDate) slots.checkInDate = dateMatches[0];
  if (dateMatches[1] && !slots.checkOutDate) slots.checkOutDate = dateMatches[1];
  if (!slots.checkInDate) {
    if (/后天|day after tomorrow/i.test(lower)) slots.checkInDate = addDateDays(todayDateIso(), 2);
    else if (/明天|tomorrow/i.test(lower)) slots.checkInDate = addDateDays(todayDateIso(), 1);
    else if (/今天|today/i.test(lower)) slots.checkInDate = todayDateIso();
  }
  if (!slots.checkOutDate && slots.checkInDate) {
    if (/住一晚|one night|1 night/i.test(lower)) slots.checkOutDate = addDateDays(slots.checkInDate, 1);
    else if (/住两晚|two nights|2 nights/i.test(lower)) slots.checkOutDate = addDateDays(slots.checkInDate, 2);
  }
  if (!slots.checkOutDate && slots.checkInDate) {
    slots.checkOutDate = addDateDays(slots.checkInDate, 1);
  }

  const pax = text.match(/(\d{1,2})\s*(人|位|people|pax|guest)/i);
  if (pax && pax[1]) slots.guestNum = Math.max(1, Number(pax[1]));

  const budgetMatch = text.match(/(\d{2,5})\s*(元|rmb|cny|¥)?/i);
  if (budgetMatch && budgetMatch[1]) slots.budget = String(Number(budgetMatch[1]));
  else if (!slots.budget && /预算低|cheap|budget|便宜/i.test(lower)) slots.budget = "low";
  else if (!slots.budget && /高端|luxury|premium/i.test(lower)) slots.budget = "high";

  if (!slots.starRating) {
    const star = text.match(/([345])\s*星|([345])\s*star/i);
    if (star) slots.starRating = String(Number(star[1] || star[2]));
  }

  if (!slots.keyword) {
    const key = text.match(/(机场|外滩|静安寺|浦东|beach|airport|bund|business|family|quiet|亲子|清真)/i);
    if (key && key[1]) slots.keyword = String(key[1]);
  }

  const city = resolveHotelCityRow(slots.cityCode, slots.city || constraints.city || "", constraints.city || db.users.demo.city || "Shanghai");
  slots.cityCode = city.cityCode;
  slots.city = city.cityEn;
  const range = normalizeDateRange(slots.checkInDate, slots.checkOutDate);
  slots.checkInDate = range.checkInDate;
  slots.checkOutDate = range.checkOutDate;

  const missing = [];
  if (!slots.cityCode) missing.push("city");
  if (!slots.checkInDate) missing.push("checkInDate");
  if (!slots.checkOutDate) missing.push("checkOutDate");
  if (!slots.guestNum) missing.push("guestNum");

  return { slots, missing };
}

function buildHotelRecommendationsFromSlots({ slots, language = "EN", pageNum = 1, pageSize = 10, refresh = false } = {}) {
  const safeSlots = slots && typeof slots === "object" ? slots : {};
  const city = resolveHotelCityRow(safeSlots.cityCode, safeSlots.city, db.users.demo.city || "Shanghai");
  const search = searchHotelsCore({
    cityCode: city.cityCode,
    checkInDate: safeSlots.checkInDate,
    checkOutDate: safeSlots.checkOutDate,
    pageNum,
    pageSize,
    budget: safeSlots.budget,
    starRating: safeSlots.starRating,
    keyword: safeSlots.keyword,
    guestNum: safeSlots.guestNum || 1,
  });
  const list = Array.isArray(search.list) ? search.list.slice(0, 20) : [];
  if (!list.length) {
    return {
      city,
      checkInDate: search.checkInDate,
      checkOutDate: search.checkOutDate,
      options: [],
      crossXChoice: null,
      summary: pickLang(
        language,
        "当前没有符合条件且可订的酒店，建议放宽预算或星级。",
        "No real-time bookable hotels match your constraints. Try widening budget or star range.",
        "条件に合致する予約可能ホテルがありません。予算または星級条件を広げてください。",
        "조건에 맞는 예약 가능 호텔이 없습니다. 예산/성급 조건을 완화해 주세요.",
      ),
    };
  }

  const prices = list.map((item) => Number(item.lowestPrice || 0)).filter((v) => Number.isFinite(v) && v > 0);
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const maxPrice = prices.length ? Math.max(...prices) : minPrice + 1;
  const budgetCap = normalizeBudgetCap(safeSlots.budget);
  const starFloor = normalizeStarFloor(safeSlots.starRating);
  const keywordLower = String(safeSlots.keyword || "").trim().toLowerCase();

  const options = list
    .map((item, idx) => {
      const price = Number(item.lowestPrice || 0);
      const priceScore = maxPrice > minPrice ? Math.max(30, Math.round(100 - ((price - minPrice) / (maxPrice - minPrice)) * 100)) : 82;
      let matchScore = 78;
      if (budgetCap && price <= budgetCap) matchScore += 8;
      if (starFloor && Number(item.starRating || 0) >= starFloor) matchScore += 7;
      if (keywordLower && String(item.hotelName || "").toLowerCase().includes(keywordLower)) matchScore += 7;
      if (Number(item.commentScore || 0) >= 4.6) matchScore += 4;
      matchScore = Math.min(100, Math.max(55, matchScore));
      const score = Math.round(matchScore * 0.7 + priceScore * 0.3);
      const room = item.bestRoom || {};
      const nights = countStayNights(search.checkInDate, search.checkOutDate);
      const reason =
        idx === 0
          ? pickLang(
            language,
            "匹配度最高，且价格与退改规则最稳。",
            "Best overall fit with stable price and cancellation policy.",
            "一致度が最も高く、価格と取消規約が安定。",
            "적합도가 가장 높고 가격/취소 규정이 안정적입니다.",
          )
          : idx === 1
            ? pickLang(
              language,
              "价格更优，适合预算敏感场景。",
              "Lower cost option for budget-sensitive booking.",
              "価格重視の予約に適した選択肢。",
              "예산 민감 상황에 적합한 저비용 옵션입니다.",
            )
            : pickLang(
              language,
              "退改更灵活，适合行程不确定时保底。",
              "More flexible cancellation for uncertain schedules.",
              "旅程不確定時に有効な柔軟な取消条件。",
              "일정이 불확실할 때 유리한 유연한 취소 조건입니다.",
            );
      return {
        id: `hotel_${item.hotelId}_${idx + 1}`,
        optionId: idx + 1,
        title: pickLang(
          language,
          `${item.hotelName} · ${item.starRating}星`,
          `${item.hotelName} · ${item.starRating}-star`,
          `${item.hotelName} · ${item.starRating}つ星`,
          `${item.hotelName} · ${item.starRating}성`,
        ),
        prompt: pickLang(
          language,
          `按方案${idx + 1}预订酒店：${item.hotelName}，${search.checkInDate}入住，${search.checkOutDate}离店，${safeSlots.guestNum || 1}人。`,
          `Book hotel option ${idx + 1}: ${item.hotelName}, check-in ${search.checkInDate}, check-out ${search.checkOutDate}, ${safeSlots.guestNum || 1} guest(s).`,
          `ホテル案${idx + 1}を予約: ${item.hotelName}、${search.checkInDate}チェックイン、${search.checkOutDate}チェックアウト、${safeSlots.guestNum || 1}名。`,
          `호텔 옵션 ${idx + 1} 예약: ${item.hotelName}, 체크인 ${search.checkInDate}, 체크아웃 ${search.checkOutDate}, ${safeSlots.guestNum || 1}명.`,
        ),
        grade: recommendationGrade(score),
        recommendationLevel: recommendationLevel(score, language),
        score,
        imagePath: item.imageUrl || "/assets/solution-flow.svg",
        placeName: item.hotelName,
        placeDisplay: item.hotelName,
        hotelName: item.hotelName,
        hotelDisplay: item.hotelName,
        transportMode: "",
        etaWindow: pickLang(language, "可当天确认", "same-day confirm", "当日確認可", "당일 확인 가능"),
        costRange: `CNY ${price}`,
        openHours: "24h front desk",
        touristFriendlyScore: Number(item.commentScore || 4.3),
        paymentFriendly: "WeChat Pay / Alipay / delegated card",
        englishMenu: true,
        nextActions: [
          {
            id: `hotel_book_${idx + 1}`,
            kind: "hotel_book",
            label: pickLang(language, "立即预订", "Book now", "今すぐ予約", "지금 예약"),
            prompt: "",
            payload: {
              cityCode: city.cityCode,
              cityName: city.cityEn,
              hotelId: item.hotelId,
              roomId: room.roomId || "",
              checkInDate: search.checkInDate,
              checkOutDate: search.checkOutDate,
              guestNum: safeSlots.guestNum || 1,
              totalPrice: price,
              hotelName: item.hotelName,
            },
          },
          {
            id: `hotel_switch_${idx + 1}`,
            kind: "execute",
            label: pickLang(language, "换一批", "Refresh options", "別候補を表示", "다른 후보 보기"),
            prompt: pickLang(language, "换一批酒店方案", "refresh hotel options", "ホテル案を更新", "호텔 옵션 새로고침"),
          },
        ],
        executionPlan: [
          pickLang(language, "查询实时库存", "Check live inventory", "在庫を照会", "실시간 재고 조회"),
          pickLang(language, "锁定房型与价格", "Lock room and price", "部屋と価格をロック", "객실/가격 잠금"),
          pickLang(language, "创建订单并推送支付", "Create order and push payment", "注文作成と決済案内", "주문 생성 및 결제 안내"),
        ],
        comments: [
          pickLang(
            language,
            `房型：${room.roomTypeName || "Standard"} · 早餐：${room.breakfastInfo || "详见下单页"}`,
            `Room: ${room.roomTypeName || "Standard"} · Breakfast: ${room.breakfastInfo || "shown at checkout"}`,
            `部屋: ${room.roomTypeName || "Standard"} · 朝食: ${room.breakfastInfo || "注文画面で表示"}`,
            `객실: ${room.roomTypeName || "Standard"} · 조식: ${room.breakfastInfo || "주문 단계 표시"}`,
          ),
        ],
        reasons: [
          reason,
          pickLang(
            language,
            `入住 ${nights} 晚，当前报价在有效期内，可直接下单。`,
            `${nights} night(s), price quote is still valid and bookable now.`,
            `${nights}泊、価格有効期限内で即時予約可能。`,
            `${nights}박 기준, 가격 유효시간 내 즉시 예약 가능.`,
          ),
        ],
        candidates: [],
        hotelApi: {
          hotelId: item.hotelId,
          roomId: room.roomId || "",
          checkInDate: search.checkInDate,
          checkOutDate: search.checkOutDate,
          guestNum: safeSlots.guestNum || 1,
          totalPrice: price,
        },
      };
    })
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, 3);

  const crossXChoice = options[0]
    ? {
      optionId: options[0].id,
      title: options[0].title,
      score: options[0].score,
      recommendationLevel: options[0].recommendationLevel,
      reason: options[0].reasons[0] || "",
      prompt: options[0].prompt,
    }
    : null;

  const refreshed = refresh === true
    ? pickLang(
      language,
      "已按实时库存与价格刷新新一批可订酒店。",
      "Refreshed with a new batch based on live inventory and price.",
      "リアルタイム在庫/価格で候補を更新しました。",
      "실시간 재고/가격 기준으로 새 후보를 갱신했습니다.",
    )
    : pickLang(
      language,
      "已基于实时库存、价格与需求匹配度生成可订酒店方案。",
      "Generated bookable hotel options using live inventory, price and match score.",
      "在庫・価格・要件一致度に基づき予約可能な案を生成しました。",
      "실시간 재고/가격/요구 일치도를 기준으로 예약 가능한 옵션을 생성했습니다.",
    );

  return {
    city,
    checkInDate: search.checkInDate,
    checkOutDate: search.checkOutDate,
    options,
    crossXChoice,
    summary: refreshed,
  };
}

function toNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371 * c;
}

function inferCityFromCoordinates(lat, lng) {
  const points = [
    { city: "Shanghai",      cityZh: "上海市",  province: "Shanghai",   provinceZh: "上海市",   lat: 31.2304, lng: 121.4737 },
    { city: "Beijing",       cityZh: "北京市",  province: "Beijing",    provinceZh: "北京市",   lat: 39.9042, lng: 116.4074 },
    { city: "Shenzhen",      cityZh: "深圳市",  province: "Guangdong",  provinceZh: "广东省",   lat: 22.5431, lng: 114.0579 },
    { city: "Guangzhou",     cityZh: "广州市",  province: "Guangdong",  provinceZh: "广东省",   lat: 23.1291, lng: 113.2644 },
    { city: "Hangzhou",      cityZh: "杭州市",  province: "Zhejiang",   provinceZh: "浙江省",   lat: 30.2741, lng: 120.1551 },
    { city: "Chengdu",       cityZh: "成都市",  province: "Sichuan",    provinceZh: "四川省",   lat: 30.5728, lng: 104.0668 },
    { city: "Chongqing",     cityZh: "重庆市",  province: "Chongqing",  provinceZh: "重庆市",   lat: 29.5630, lng: 106.5516 },
    { city: "Nanjing",       cityZh: "南京市",  province: "Jiangsu",    provinceZh: "江苏省",   lat: 32.0603, lng: 118.7969 },
    { city: "Wuhan",         cityZh: "武汉市",  province: "Hubei",      provinceZh: "湖北省",   lat: 30.5928, lng: 114.3055 },
    { city: "Xian",          cityZh: "西安市",  province: "Shaanxi",    provinceZh: "陕西省",   lat: 34.3416, lng: 108.9398 },
    { city: "Xiamen",        cityZh: "厦门市",  province: "Fujian",     provinceZh: "福建省",   lat: 24.4798, lng: 118.0894 },
    { city: "Kuala Lumpur",  cityZh: "吉隆坡",  province: "Selangor",   provinceZh: "雪兰莪州", lat: 3.1390,  lng: 101.6869 },
    { city: "Singapore",     cityZh: "新加坡",  province: "Singapore",  provinceZh: "新加坡",   lat: 1.3521,  lng: 103.8198 },
  ];
  let best = points[0];
  let minDist = Infinity;
  for (const item of points) {
    const d = haversineKm(lat, lng, item.lat, item.lng);
    if (d < minDist) {
      best = item;
      minDist = d;
    }
  }
  if (minDist > 300) best = { city: "Shanghai", cityZh: "上海市", province: "Shanghai", provinceZh: "上海市", lat: 31.2304, lng: 121.4737 };
  return best;
}

function inferCityNameFromCoordinates(lat, lng) {
  return inferCityFromCoordinates(lat, lng).city;
}

/**
 * WGS-84 → GCJ-02 (火星坐标系) conversion.
 * Required because browser geolocation returns WGS-84,
 * but AMap/GaoDe uses GCJ-02. Apply only if coordinates are within China.
 */
function wgs84ToGcj02(lat, lng) {
  const PI = 3.1415926535897932384626;
  const a = 6378245.0;
  const ee = 0.00669342162296594323;

  function isInChinaBounds(lat, lng) {
    return lng >= 72.004 && lng <= 137.8347 && lat >= 0.8293 && lat <= 55.8271;
  }

  if (!isInChinaBounds(lat, lng)) return { lat, lng }; // Outside China: no transform

  function transformLat(x, y) {
    let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
    ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0;
    ret += (160.0 * Math.sin(y / 12.0 * PI) + 320 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0;
    return ret;
  }

  function transformLng(x, y) {
    let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
    ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0;
    ret += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0;
    return ret;
  }

  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = lat / 180.0 * PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * PI);
  dLng = (dLng * 180.0) / (a / sqrtMagic * Math.cos(radLat) * PI);
  return { lat: lat + dLat, lng: lng + dLng };
}

/**
 * Reverse geocode using AMap (GaoDe) API.
 * Returns { city, cityZh, province, provinceZh, district, districtZh, address }
 * Falls back to inferCityFromCoordinates if API key is absent or call fails.
 */
async function reverseGeocodeWithAmap(rawLat, rawLng) {
  const amapKey = process.env.GAODE_KEY || process.env.AMAP_KEY || "";

  // Convert to GCJ-02 if we're in China bounds
  const { lat, lng } = wgs84ToGcj02(rawLat, rawLng);
  const coordStr = `${lng.toFixed(6)},${lat.toFixed(6)}`;

  if (!amapKey) {
    // No API key — fall back to lookup table
    console.warn("[ReverseGeocode] No GAODE_KEY/AMAP_KEY. Using fallback lookup table.");
    return inferCityFromCoordinates(rawLat, rawLng);
  }

  return new Promise((resolve) => {
    const url = `https://restapi.amap.com/v3/geocode/regeo?key=${amapKey}&location=${coordStr}&poitype=&radius=0&extensions=base&batch=false&roadlevel=0`;
    const urlObj = new URL(url);
    const reqOptions = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: "GET",
      headers: { "User-Agent": "CrossX/1.0" },
    };

    const req = https.request(reqOptions, (apiRes) => {
      let data = "";
      apiRes.on("data", (chunk) => (data += chunk));
      apiRes.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.status !== "1" || !parsed.regeocode) {
            console.warn("[ReverseGeocode] AMap API error:", parsed.info || parsed.status);
            return resolve(inferCityFromCoordinates(rawLat, rawLng));
          }
          const comp = parsed.regeocode.addressComponent || {};
          // AMap returns Chinese names natively
          const cityZh = String(comp.city || comp.district || "").replace(/市$/, "") + "市" || "未知市";
          const provinceZh = String(comp.province || "").trim();
          const districtZh = String(comp.district || "").trim();
          const cityZhClean = String(comp.city || comp.district || "").trim() || cityZh;
          const provinceZhClean = provinceZh || cityZhClean; // Some cities like 北京 are their own province

          // Build English names via simple lookup
          const zhToEnCity = {
            "上海市": "Shanghai", "北京市": "Beijing", "深圳市": "Shenzhen",
            "广州市": "Guangzhou", "杭州市": "Hangzhou", "成都市": "Chengdu",
            "重庆市": "Chongqing", "南京市": "Nanjing", "武汉市": "Wuhan",
            "西安市": "Xi'an", "厦门市": "Xiamen", "天津市": "Tianjin",
            "苏州市": "Suzhou", "青岛市": "Qingdao", "长沙市": "Changsha",
            "郑州市": "Zhengzhou", "大连市": "Dalian", "宁波市": "Ningbo",
            "哈尔滨市": "Harbin", "昆明市": "Kunming", "福州市": "Fuzhou",
            "合肥市": "Hefei", "济南市": "Jinan", "石家庄市": "Shijiazhuang",
            "乌鲁木齐市": "Urumqi", "南宁市": "Nanning", "贵阳市": "Guiyang",
            "兰州市": "Lanzhou", "太原市": "Taiyuan", "三亚市": "Sanya",
          };
          const zhToEnProv = {
            "广东省": "Guangdong", "浙江省": "Zhejiang", "四川省": "Sichuan",
            "江苏省": "Jiangsu", "湖北省": "Hubei", "陕西省": "Shaanxi",
            "福建省": "Fujian", "山东省": "Shandong", "湖南省": "Hunan",
            "河南省": "Henan", "河北省": "Hebei", "辽宁省": "Liaoning",
            "云南省": "Yunnan", "贵州省": "Guizhou", "广西壮族自治区": "Guangxi",
            "内蒙古自治区": "Inner Mongolia", "新疆维吾尔自治区": "Xinjiang",
            "西藏自治区": "Tibet", "宁夏回族自治区": "Ningxia",
            "黑龙江省": "Heilongjiang", "吉林省": "Jilin", "辽宁省": "Liaoning",
            "安徽省": "Anhui", "江西省": "Jiangxi", "海南省": "Hainan",
            "山西省": "Shanxi", "甘肃省": "Gansu", "青海省": "Qinghai",
            "上海市": "Shanghai", "北京市": "Beijing", "天津市": "Tianjin",
            "重庆市": "Chongqing",
          };

          const city = zhToEnCity[cityZhClean] || cityZhClean.replace(/市$/, "");
          const province = zhToEnProv[provinceZhClean] || provinceZhClean.replace(/省$|自治区$|壮族自治区$|回族自治区$|维吾尔自治区$/, "");

          resolve({
            city,
            cityZh: cityZhClean,
            province,
            provinceZh: provinceZhClean,
            district: districtZh.replace(/区$|县$/, ""),
            districtZh,
            address: String(parsed.regeocode.formatted_address || ""),
          });
        } catch (e) {
          console.warn("[ReverseGeocode] Parse error:", e.message);
          resolve(inferCityFromCoordinates(rawLat, rawLng));
        }
      });
    });
    req.on("error", (e) => {
      console.warn("[ReverseGeocode] Request error:", e.message);
      resolve(inferCityFromCoordinates(rawLat, rawLng));
    });
    req.setTimeout(5000, () => {
      req.destroy();
      console.warn("[ReverseGeocode] Timeout — using fallback.");
      resolve(inferCityFromCoordinates(rawLat, rawLng));
    });
    req.end();
  });
}

function detectIntentHint(text) {
  const lower = String(text || "").toLowerCase();
  const travelKeywords = [
    "airport", "flight", "taxi", "metro", "route", "hotel", "transfer", "terminal", "check in", "check-in",
    "赶飞机", "机场", "出行", "打车", "路线", "酒店", "高铁", "火车站", "train", "station",
  ];
  const eatKeywords = [
    "restaurant", "food", "eat", "dinner", "lunch", "breakfast", "cuisine", "hotpot", "noodle", "coffee", "cafe", "halal", "vegetarian", "vegan", "tea",
    "餐厅", "美食", "吃", "火锅", "面", "点心", "奶茶", "清真", "素食", "咖啡",
  ];
  if (travelKeywords.some((k) => lower.includes(k))) return "travel";
  if (eatKeywords.some((k) => lower.includes(k))) return "eat";
  return null;
}

function normalizeNameLookupKey(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

const cnPinyinLexicon = (() => {
  const rows = [
    ["A Niang Noodles (Sinan Rd)", "阿娘面馆（思南路）", "A Niang Mian Guan (Si Nan Lu)"],
    ["阿娘面馆（思南路）", "阿娘面馆（思南路）", "A Niang Mian Guan (Si Nan Lu)"],
    ["Chenglong Crab House (Bund)", "成隆行蟹王府（外滩）", "Cheng Long Hang Xie Wang Fu (Wai Tan)"],
    ["成隆行蟹王府（外滩）", "成隆行蟹王府（外滩）", "Cheng Long Hang Xie Wang Fu (Wai Tan)"],
    ["Nanxiang Bun House (Yuyuan)", "南翔馒头店（豫园）", "Nan Xiang Man Tou Dian (Yu Yuan)"],
    ["南翔馒头店（豫园）", "南翔馒头店（豫园）", "Nan Xiang Man Tou Dian (Yu Yuan)"],
    ["Siji Minfu Peking Duck (Forbidden City)", "四季民福烤鸭（故宫店）", "Si Ji Min Fu Kao Ya (Gu Gong Dian)"],
    ["四季民福烤鸭（故宫店）", "四季民福烤鸭（故宫店）", "Si Ji Min Fu Kao Ya (Gu Gong Dian)"],
    ["Juqi Beijing Cuisine (Qianmen)", "局气（前门店）", "Ju Qi (Qian Men Dian)"],
    ["局气（前门店）", "局气（前门店）", "Ju Qi (Qian Men Dian)"],
    ["Huguosi Snacks (Flagship)", "护国寺小吃（总店）", "Hu Guo Si Xiao Chi (Zong Dian)"],
    ["护国寺小吃（总店）", "护国寺小吃（总店）", "Hu Guo Si Xiao Chi (Zong Dian)"],
    ["Baheli Beef Hotpot (Futian)", "八合里牛肉火锅（福田店）", "Ba He Li Niu Rou Huo Guo (Fu Tian Dian)"],
    ["八合里牛肉火锅（福田店）", "八合里牛肉火锅（福田店）", "Ba He Li Niu Rou Huo Guo (Fu Tian Dian)"],
    ["Chaoshan Claypot Congee (Chegongmiao)", "潮汕味道砂锅粥（车公庙）", "Chao Shan Sha Guo Zhou (Che Gong Miao)"],
    ["潮汕味道砂锅粥（车公庙）", "潮汕味道砂锅粥（车公庙）", "Chao Shan Sha Guo Zhou (Che Gong Miao)"],
    ["Muwu BBQ (Nanshan)", "木屋烧烤（南山店）", "Mu Wu Shao Kao (Nan Shan Dian)"],
    ["木屋烧烤（南山店）", "木屋烧烤（南山店）", "Mu Wu Shao Kao (Nan Shan Dian)"],
    ["Haidilao Hotpot (People's Square)", "海底捞火锅（人民广场）", "Hai Di Lao Huo Guo (Ren Min Guang Chang)"],
    ["海底捞火锅（人民广场）", "海底捞火锅（人民广场）", "Hai Di Lao Huo Guo (Ren Min Guang Chang)"],
    ["Dong Lai Shun Hotpot (Wangfujing)", "东来顺涮肉（王府井）", "Dong Lai Shun Shuan Rou (Wang Fu Jing)"],
    ["东来顺涮肉（王府井）", "东来顺涮肉（王府井）", "Dong Lai Shun Shuan Rou (Wang Fu Jing)"],
    ["Shu Jiu Xiang Hotpot (Taikoo Li)", "蜀九香火锅（太古里）", "Shu Jiu Xiang Huo Guo (Tai Gu Li)"],
    ["蜀九香火锅（太古里）", "蜀九香火锅（太古里）", "Shu Jiu Xiang Huo Guo (Tai Gu Li)"],
    ["Yershari Xinjiang Cuisine (Jing'an)", "耶里夏丽新疆餐厅（静安）", "Ye Li Xia Li Xin Jiang Can Ting (Jing An)"],
    ["耶里夏丽新疆餐厅（静安）", "耶里夏丽新疆餐厅（静安）", "Ye Li Xia Li Xin Jiang Can Ting (Jing An)"],
    ["Jubaoyuan Halal Hotpot (Niujie)", "聚宝源涮肉（牛街）", "Ju Bao Yuan Shuan Rou (Niu Jie)"],
    ["聚宝源涮肉（牛街）", "聚宝源涮肉（牛街）", "Ju Bao Yuan Shuan Rou (Niu Jie)"],
    ["King's Joy Vegetarian (Yonghegong)", "京兆尹素食（雍和宫）", "Jing Zhao Yin Su Shi (Yong He Gong)"],
    ["京兆尹素食（雍和宫）", "京兆尹素食（雍和宫）", "Jing Zhao Yin Su Shi (Yong He Gong)"],
    ["Gong De Lin Vegetarian (Nanjing West Rd)", "功德林素食（南京西路）", "Gong De Lin Su Shi (Nan Jing Xi Lu)"],
    ["功德林素食（南京西路）", "功德林素食（南京西路）", "Gong De Lin Su Shi (Nan Jing Xi Lu)"],
    ["M Stand Coffee (Xintiandi)", "M Stand咖啡（新天地）", "M Stand Ka Fei (Xin Tian Di)"],
    ["M Stand咖啡（新天地）", "M Stand咖啡（新天地）", "M Stand Ka Fei (Xin Tian Di)"],
    ["%Arabica (Sanlitun)", "%Arabica（三里屯）", "Arabica (San Li Tun)"],
    ["%Arabica（三里屯）", "%Arabica（三里屯）", "Arabica (San Li Tun)"],
    ["Fangzhuanchang 69 Zhajiangmian", "方砖厂69号炸酱面", "Fang Zhuan Chang Liu Shi Jiu Hao Zha Jiang Mian"],
    ["方砖厂69号炸酱面", "方砖厂69号炸酱面", "Fang Zhuan Chang Liu Shi Jiu Hao Zha Jiang Mian"],
    ["Pudong Shangri-La Shanghai", "上海浦东香格里拉酒店", "Shang Hai Pu Dong Xiang Ge Li La Jiu Dian"],
    ["上海浦东香格里拉酒店", "上海浦东香格里拉酒店", "Shang Hai Pu Dong Xiang Ge Li La Jiu Dian"],
    ["PVG Airport Express Ride", "浦东机场快线专车", "Pu Dong Ji Chang Kuai Xian Zhuan Che"],
    ["浦东机场快线专车", "浦东机场快线专车", "Pu Dong Ji Chang Kuai Xian Zhuan Che"],
    ["Daxing Airport Express Ride", "大兴机场快线专车", "Da Xing Ji Chang Kuai Xian Zhuan Che"],
    ["大兴机场快线专车", "大兴机场快线专车", "Da Xing Ji Chang Kuai Xian Zhuan Che"],
    ["SZX Airport Express Ride", "宝安机场快线专车", "Bao An Ji Chang Kuai Xian Zhuan Che"],
    ["宝安机场快线专车", "宝安机场快线专车", "Bao An Ji Chang Kuai Xian Zhuan Che"],
    ["Waldorf Astoria Shanghai on the Bund", "上海外滩华尔道夫酒店", "Shang Hai Wai Tan Hua Er Dao Fu Jiu Dian"],
    ["上海外滩华尔道夫酒店", "上海外滩华尔道夫酒店", "Shang Hai Wai Tan Hua Er Dao Fu Jiu Dian"],
    ["China World Hotel Beijing", "北京国贸大酒店", "Bei Jing Guo Mao Da Jiu Dian"],
    ["北京国贸大酒店", "北京国贸大酒店", "Bei Jing Guo Mao Da Jiu Dian"],
    ["Four Seasons Hotel Shenzhen", "深圳四季酒店", "Shen Zhen Si Ji Jiu Dian"],
    ["深圳四季酒店", "深圳四季酒店", "Shen Zhen Si Ji Jiu Dian"],
    ["PVG Airport Fast Ride", "浦东机场专线网约车", "Pu Dong Ji Chang Zhuan Xian Wang Yue Che"],
    ["SZX Airport Fast Ride", "宝安机场快线专车", "Bao An Ji Chang Kuai Xian Zhuan Che"],
    ["PEK Airport Express Ride", "首都机场快线专车", "Shou Du Ji Chang Kuai Xian Zhuan Che"],
    ["Metro Line 2 + Airport Link", "地铁2号线 + 机场联络线", "Di Tie Er Hao Xian + Ji Chang Lian Luo Xian"],
    ["Metro Line 11 + Ride-hailing", "地铁11号线 + 网约车", "Di Tie Shi Yi Hao Xian + Wang Yue Che"],
    ["Metro + Airport Express Mix", "地铁 + 机场快线组合", "Di Tie + Ji Chang Kuai Xian Zu He"],
    ["The Bund", "外滩", "Wai Tan"],
    ["外滩", "外滩", "Wai Tan"],
    ["Yu Garden", "豫园", "Yu Yuan"],
    ["豫园", "豫园", "Yu Yuan"],
  ];
  const map = {};
  for (const [name, zh, pinyin] of rows) {
    map[normalizeNameLookupKey(name)] = {
      zh,
      pinyin,
    };
  }
  return map;
})();

function lookupCnPinyinMeta(name) {
  return cnPinyinLexicon[normalizeNameLookupKey(name)] || null;
}

function formatNameWithCnPinyin(name, language = "EN") {
  const raw = String(name || "").trim();
  if (!raw) return "-";
  const lang = normalizeLang(language);
  const meta = lookupCnPinyinMeta(raw);
  if (!meta) return raw;
  const zh = String(meta.zh || "").trim();
  const hasChinese = /[\u3400-\u9fff]/.test(raw);
  if (lang === "ZH") {
    if (hasChinese) return raw;
    return zh ? `${zh}（${raw}）` : raw;
  }
  if (hasChinese) {
    return raw;
  }
  if (zh) {
    return `${raw} (${zh})`;
  }
  return raw;
}

function summarizeUserCue(message, language = "EN") {
  const text = String(message || "");
  const lower = text.toLowerCase();
  const cues = [];
  if (/halal|清真/.test(lower)) cues.push(pickLang(language, "清真", "halal", "ハラール", "할랄"));
  if (/vegan|vegetarian|素食|纯素/.test(lower)) cues.push(pickLang(language, "素食", "vegan/vegetarian", "ヴィーガン", "비건"));
  if (/airport|机场|flight|赶飞机/.test(lower)) cues.push(pickLang(language, "赶机场", "airport transfer", "空港移動", "공항 이동"));
  if (/hotel|酒店/.test(lower)) cues.push(pickLang(language, "酒店", "hotel", "ホテル", "호텔"));
  if (/family|儿童|亲子/.test(lower)) cues.push(pickLang(language, "亲子", "family friendly", "ファミリー", "가족 친화"));
  if (/walk|步行/.test(lower)) cues.push(pickLang(language, "步行优先", "walk-first", "徒歩優先", "도보 우선"));
  if (/cheap|budget|便宜|省钱/.test(lower)) cues.push(pickLang(language, "预算优先", "budget-first", "予算優先", "예산 우선"));
  if (/authentic|地道|local/.test(lower)) cues.push(pickLang(language, "地道本地", "authentic local", "ローカル重視", "현지성 우선"));
  if (/quiet|安静/.test(lower)) cues.push(pickLang(language, "安静环境", "quiet ambience", "静かな環境", "조용한 분위기"));
  const budget = text.match(/(?:¥|cny|rmb|\$)?\s?(\d{2,5})/i);
  if (budget && budget[1]) {
    cues.push(
      pickLang(
        language,
        `预算 ${budget[1]}`,
        `budget ${budget[1]}`,
        `予算 ${budget[1]}`,
        `예산 ${budget[1]}`,
      ),
    );
  }
  if (!cues.length) {
    return pickLang(language, "通用旅行需求", "general travel request", "一般的な旅行依頼", "일반 여행 요청");
  }
  return cues.slice(0, 3).join(" / ");
}

function buildThinkingNarrative() {
  // Deprecated: the /api/plan/coze SSE flow replaced this. Returns empty string to prevent ghost text.
  return "";
}

function inferConversationStage(message, intentHint = null) {
  const lower = String(message || "").toLowerCase();
  if (/restaurant|food|eat|dinner|lunch|breakfast|hotpot|noodle|halal|vegetarian|vegan|cafe|tea|餐厅|美食|吃|火锅|面|奶茶|清真|素食|咖啡/.test(lower)) return "restaurant_selection";
  if (/airport|flight|taxi|metro|route|train|station|机场|出行|打车|路线|高铁/.test(lower)) return "mobility_selection";
  if (/hotel|stay|check in|accommodation|酒店|住|住宿/.test(lower)) return "hotel_selection";
  if (intentHint === "travel") return "mobility_selection";
  if (intentHint === "eat") return "restaurant_selection";
  return "discovery";
}

function hasMeaningfulConstraints(constraints) {
  if (!constraints || typeof constraints !== "object") return false;
  const keys = ["budget", "distance", "time", "dietary", "family", "accessibility", "city", "origin", "destination"];
  return keys.some((key) => {
    const value = constraints[key];
    return value !== undefined && value !== null && String(value).trim() !== "";
  });
}

function isAmbiguousIntentMessage(message, constraints = {}) {
  const text = String(message || "").trim();
  if (!text) return true;
  const shortText = text.length <= 8 || text.split(/\s+/).length <= 2;
  const genericPattern = /(推荐|建议|攻略|help|ideas|suggest|recommend|where to go|what to do|怎么安排)/i;
  const hasSpecificIntent = /(restaurant|food|eat|hotel|airport|route|taxi|metro|book|reserve|餐厅|美食|吃|酒店|机场|路线|打车|预约|预订)/i.test(text);
  if (hasSpecificIntent) return false;
  if (!hasMeaningfulConstraints(constraints) && (shortText || genericPattern.test(text))) return true;
  return false;
}

function buildOptionActions(option, stage, language = "EN") {
  const lang = normalizeLang(language);
  const L = (zh, en, ja, ko) => pickLang(lang, zh, en, ja, ko);
  const place = option && (option.placeDisplay || option.placeName || option.title) ? String(option.placeDisplay || option.placeName || option.title) : "-";
  const hotel = option && (option.hotelDisplay || option.hotelName) ? String(option.hotelDisplay || option.hotelName) : "";
  const menuUrl = `https://www.dianping.com/search/keyword/1/0_${encodeURIComponent(String(option && option.placeName ? option.placeName : "restaurant"))}`;
  const actions = [];

  if (option && option.prompt) {
    actions.push({
      id: "run_choice",
      kind: "execute",
      label: L("确认并开始执行", "Confirm & Execute", "確認して実行", "확인 후 실행"),
      prompt: option.prompt,
    });
  }

  if (option && option.type === "eat") {
    actions.push({
      id: "one_tap_taxi",
      kind: "execute",
      label: L("一键打车", "One-Tap Taxi", "ワンタップ配車", "원탭 택시"),
      prompt: L(
        `现在从我的位置打车去 ${place}，并给我中文地址卡片。`,
        `Book a ride from my current location to ${place} now and send me a Chinese address card.`,
        `現在地から ${place} へ配車し、中国語住所カードをください。`,
        `현재 위치에서 ${place}까지 택시를 호출하고 중국어 주소 카드를 보내줘.`,
      ),
    });
    actions.push({
      id: "view_menu",
      kind: "link",
      label: L("查看菜单", "View Menu", "メニューを見る", "메뉴 보기"),
      url: menuUrl,
    });
    return actions.slice(0, 3);
  }

  if (option && option.type === "travel") {
    actions.push({
      id: "lock_route",
      kind: "execute",
      label: L("锁定路线", "Lock Route", "ルート確定", "경로 확정"),
      prompt: L(
        `锁定这条路线并开始执行，优先保证准点到达。`,
        `Lock this route and start execution with on-time arrival priority.`,
        `このルートを確定して実行し、定時到着を優先してください。`,
        `이 경로를 확정하고 실행해. 정시 도착을 우선해줘.`,
      ),
    });
    actions.push({
      id: "one_tap_taxi",
      kind: "execute",
      label: L("一键叫车", "One-Tap Ride", "ワンタップ配車", "원탭 호출"),
      prompt: L(
        `现在按该方案叫车并把二维码和中文地址发给我。`,
        `Dispatch this ride now and send me QR + Chinese address card.`,
        `この案で配車し、QRと中国語住所カードを送ってください。`,
        `이 경로로 지금 호출하고 QR과 중국어 주소 카드를 보내줘.`,
      ),
    });
    return actions.slice(0, 3);
  }

  if (stage === "hotel_selection") {
    actions.push({
      id: "hotel_to_next_stop",
      kind: "execute",
      label: L("加入酒店行程", "Add to Itinerary", "ホテル行程に追加", "호텔 일정에 추가"),
      prompt: L(
        `将 ${hotel || place} 加入我的行程，并安排最近可用的到达方式。`,
        `Add ${hotel || place} to my trip and arrange the nearest available transfer.`,
        `${hotel || place} を旅程に追加し、最寄りの移動手段を手配してください。`,
        `${hotel || place}를 일정에 추가하고 가장 가까운 이동 수단을 잡아줘.`,
      ),
    });
    return actions.slice(0, 3);
  }

  if (stage === "restaurant_selection") return actions.slice(0, 1);
  if (stage === "mobility_selection") return actions.slice(0, 1);

  actions.push({
    id: "ask_preferences",
    kind: "execute",
    label: L("补充偏好", "Add Preferences", "条件を追加", "조건 추가"),
    prompt: L(
      "我停留2天，偏好历史文化，预算中等，请重算更精准方案。",
      "I stay for 2 days, prefer history/culture, mid budget. Recalculate precise options.",
      "2日滞在、歴史文化志向、予算中程度で再計算してください。",
      "2일 체류, 역사/문화 선호, 중간 예산으로 다시 계산해줘.",
    ),
  });
  return actions.slice(0, 3);
}

function recommendationGrade(score) {
  const n = Number(score || 0);
  if (n >= 92) return "S";
  if (n >= 84) return "A";
  if (n >= 74) return "B";
  return "C";
}

function recommendationLevel(score, language = "EN") {
  const n = Number(score || 0);
  if (n >= 90) return pickLang(language, "优先推荐", "Top Pick", "最優先", "최우선");
  if (n >= 82) return pickLang(language, "强推荐", "Strong", "有力候補", "강력 추천");
  return pickLang(language, "备选", "Backup", "バックアップ", "대체안");
}

function localizedCityName(cityName, language = "EN") {
  const city = String(cityName || "Shanghai");
  const lang = normalizeLang(language);
  const map = {
    Shanghai: { ZH: "上海", EN: "Shanghai", JA: "上海", KO: "상하이" },
    Beijing: { ZH: "北京", EN: "Beijing", JA: "北京", KO: "베이징" },
    Shenzhen: { ZH: "深圳", EN: "Shenzhen", JA: "深圳", KO: "선전" },
    Guangzhou: { ZH: "广州", EN: "Guangzhou", JA: "広州", KO: "광저우" },
    Hangzhou: { ZH: "杭州", EN: "Hangzhou", JA: "杭州", KO: "항저우" },
    Chengdu: { ZH: "成都", EN: "Chengdu", JA: "成都", KO: "청두" },
  };
  if (map[city] && map[city][lang]) return map[city][lang];
  return city;
}

function canonicalCityKey(cityName) {
  const raw = String(cityName || "Shanghai").toLowerCase();
  if (raw.includes("上海") || raw.includes("shanghai")) return "Shanghai";
  if (raw.includes("北京") || raw.includes("beijing")) return "Beijing";
  if (raw.includes("深圳") || raw.includes("shenzhen")) return "Shenzhen";
  if (raw.includes("广州") || raw.includes("guangzhou")) return "Guangzhou";
  if (raw.includes("杭州") || raw.includes("hangzhou")) return "Hangzhou";
  if (raw.includes("成都") || raw.includes("chengdu")) return "Chengdu";
  return "Shanghai";
}

function cityLaneCandidates(cityName, language = "EN") {
  const lang = normalizeLang(language);
  const city = localizedCityName(cityName || "Shanghai", lang);
  const cityKey = canonicalCityKey(cityName || city);
  const L = (zh, en, ja, ko) => pickLang(lang, zh, en, ja, ko);
  const presetNames = {
    Shanghai: {
      eat: [
        { ZH: "阿娘面馆（思南路）", EN: "A Niang Noodles (Sinan Rd)", JA: "阿娘面館（思南路）", KO: "아냥 누들 (쓰난루)" },
        { ZH: "成隆行蟹王府（外滩）", EN: "Chenglong Crab House (Bund)", JA: "成隆行蟹王府（外灘）", KO: "청룽 크랩 하우스 (번드)" },
        { ZH: "南翔馒头店（豫园）", EN: "Nanxiang Bun House (Yuyuan)", JA: "南翔饅頭店（豫園）", KO: "난샹 번 하우스 (위위안)" },
      ],
      travel: [
        { ZH: "上海外滩华尔道夫酒店", EN: "Waldorf Astoria Shanghai on the Bund", JA: "ウォルドーフ・アストリア上海外灘", KO: "월도프 아스토리아 상하이 온 더 번드" },
        { ZH: "浦东机场专线网约车", EN: "PVG Airport Fast Ride", JA: "浦東空港ファスト配車", KO: "푸동공항 패스트 라이드" },
        { ZH: "地铁2号线 + 机场联络线", EN: "Metro Line 2 + Airport Link", JA: "地下鉄2号線 + 空港連絡線", KO: "지하철 2호선 + 공항 링크" },
      ],
    },
    Beijing: {
      eat: [
        { ZH: "四季民福烤鸭（故宫店）", EN: "Siji Minfu Peking Duck (Forbidden City)", JA: "四季民福（故宮店）", KO: "쓰지민푸 북경오리 (고궁점)" },
        { ZH: "局气（前门店）", EN: "Juqi Beijing Cuisine (Qianmen)", JA: "局気（前門店）", KO: "쥐치 베이징 요리 (첸먼)" },
        { ZH: "护国寺小吃（总店）", EN: "Huguosi Snacks (Flagship)", JA: "護国寺小吃（本店）", KO: "후궈쓰 스낵 (플래그십)" },
      ],
      travel: [
        { ZH: "北京国贸大酒店", EN: "China World Hotel Beijing", JA: "チャイナワールドホテル北京", KO: "차이나월드 호텔 베이징" },
        { ZH: "首都机场快线专车", EN: "PEK Airport Express Ride", JA: "首都空港エクスプレス配車", KO: "서우두공항 익스프레스 라이드" },
        { ZH: "地铁 + 机场快线组合", EN: "Metro + Airport Express Mix", JA: "地下鉄 + 空港快速線", KO: "지하철 + 공항 익스프레스" },
      ],
    },
    Shenzhen: {
      eat: [
        { ZH: "深圳精选粤菜餐厅", EN: "Shenzhen Cantonese Restaurant", JA: "深圳粤料理レストラン", KO: "선전 광둥 음식점" },
        { ZH: "深圳本地特色小馆", EN: "Shenzhen Local Specialty Restaurant", JA: "深圳ローカルレストラン", KO: "선전 현지 음식점" },
        { ZH: "深圳人气餐厅", EN: "Shenzhen Popular Dining", JA: "深圳人気飲食店", KO: "선전 인기 음식점" },
      ],
      travel: [
        { ZH: "深圳四季酒店", EN: "Four Seasons Hotel Shenzhen", JA: "フォーシーズンズ深圳", KO: "포시즌스 호텔 선전" },
        { ZH: "宝安机场快线专车", EN: "SZX Airport Fast Ride", JA: "宝安空港ファスト配車", KO: "바오안공항 패스트 라이드" },
        { ZH: "地铁11号线 + 网约车", EN: "Metro Line 11 + Ride-hailing", JA: "地下鉄11号線 + 配車", KO: "지하철 11호선 + 택시" },
      ],
    },
  };
  const pickPresetName = (group, idx, fallback) => {
    const cityPack = presetNames[cityKey] || presetNames.Shanghai;
    const row = cityPack && cityPack[group] ? cityPack[group][idx] : null;
    if (!row) return fallback;
    return pickLang(lang, row.ZH || fallback, row.EN || fallback, row.JA || row.EN || fallback, row.KO || row.EN || fallback);
  };
  return {
    eat: [
      {
        name: pickPresetName("eat", 0, L(`${city}本地面馆实验室`, `${city} Local Noodle Lab`, `${city} ローカルヌードルラボ`, `${city} 로컬 누들 랩`)),
        category: L("餐厅", "Restaurant", "レストラン", "레스토랑"),
        imageUrl: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=1200&q=80",
        score: 93,
        reason: L("地道度评分最高，且排队吞吐稳定。", "Top authenticity score with stable queue throughput.", "本場らしさの評価が最上位で、待ち行列の処理も安定。", "현지성 점수가 가장 높고 대기열 처리도 안정적입니다."),
      },
      {
        name: pickPresetName("eat", 1, L(`${city}传承饺子馆`, `${city} Heritage Dumpling House`, `${city} 伝統餃子ハウス`, `${city} 헤리티지 딤섬 하우스`)),
        category: L("餐厅", "Restaurant", "レストラン", "레스토랑"),
        imageUrl: "https://images.unsplash.com/photo-1543353071-10c8ba85a904?auto=format&fit=crop&w=1200&q=80",
        score: 90,
        reason: L("双语菜单支持好，定金规则清晰可预期。", "Great bilingual menu support and predictable deposit policy.", "多言語メニュー対応が良く、デポジット規約も明確。", "다국어 메뉴 지원이 좋고 보증금 정책이 명확합니다."),
      },
      {
        name: pickPresetName("eat", 2, L(`${city}亲子火锅花园`, `${city} Family Hotpot Garden`, `${city} ファミリーホットポットガーデン`, `${city} 패밀리 훠궈 가든`)),
        category: L("餐厅", "Restaurant", "レストラン", "레스토랑"),
        imageUrl: "https://images.unsplash.com/photo-1515003197210-e0cd71810b5f?auto=format&fit=crop&w=1200&q=80",
        score: 88,
        reason: L("亲子就座与过敏约束匹配度最高。", "Best fit for family seating and allergy constraints.", "家族席とアレルギー条件への適合度が高い。", "가족 좌석과 알레르기 조건에 가장 잘 맞습니다."),
      },
    ],
    travel: [
      {
        name: pickPresetName("travel", 0, L(`${city}滨江精选酒店`, `${city} Riverside Premium Hotel`, `${city} リバーサイドプレミアムホテル`, `${city} 리버사이드 프리미엄 호텔`)),
        category: L("酒店", "Hotel", "ホテル", "호텔"),
        imageUrl: "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=80",
        score: 91,
        reason: L("接驳上车点稳定，支持礼宾接管。", "Reliable pickup point with concierge handoff support.", "乗車ポイントが安定しており、コンシェルジュ引き継ぎに対応。", "픽업 지점이 안정적이고 컨시어지 인계 지원이 가능합니다."),
      },
      {
        name: pickPresetName("travel", 1, L(`${city}机场极速接驳`, `${city} Airport Fast Transfer`, `${city} 空港ファストトランスファー`, `${city} 공항 패스트 트랜스퍼`)),
        category: L("机场接送", "Airport Transfer", "空港送迎", "공항 이동"),
        imageUrl: "https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=1200&q=80",
        score: 89,
        reason: L("晚高峰拥堵下仍有最高准点概率。", "Highest on-time probability under evening congestion.", "夕方の渋滞下でも最も高い定時到着確率。", "저녁 혼잡 시간에도 가장 높은 정시 도착 확률."),
      },
      {
        name: pickPresetName("travel", 2, L(`${city}地铁+打车省钱线`, `${city} Metro + Taxi Saver`, `${city} 地下鉄+タクシー節約ルート`, `${city} 지하철+택시 절약 루트`)),
        category: L("交通组合", "Transport Mix", "交通ミックス", "교통 혼합"),
        imageUrl: "https://images.unsplash.com/photo-1502877338535-766e1452684a?auto=format&fit=crop&w=1200&q=80",
        score: 86,
        reason: L("在到达时间可弹性时，性价比最好。", "Best cost-performance for flexible arrival windows.", "到着時間に余裕がある場合の費用対効果が最良。", "도착 시간이 유연할 때 비용 효율이 가장 좋습니다."),
      },
    ],
    trust: [
      {
        name: L("ACT 委托支付防护", "ACT Delegated Card Guard", "ACT 委任カードガード", "ACT 위임결제 가드"),
        category: L("支付安全", "Payment Safety", "決済セーフティ", "결제 안전"),
        imageUrl: "https://images.unsplash.com/photo-1556740749-887f6717d7e4?auto=format&fit=crop&w=1200&q=80",
        score: 95,
        reason: L("可拦截高风险交易并保护免密上限。", "High-risk interception and no-pin cap protection.", "高リスク取引の遮断とNo-PIN上限保護に有効。", "고위험 거래 차단 및 무PIN 한도 보호에 효과적."),
      },
      {
        name: L("MCP 合同监控", "MCP Contract Watch", "MCP 契約ウォッチ", "MCP 계약 모니터"),
        category: L("稳定性", "Reliability", "信頼性", "신뢰성"),
        imageUrl: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1200&q=80",
        score: 90,
        reason: L("最适合做 SLA 诊断与供应商兜底可视化。", "Best for SLA diagnostics and provider fallback visibility.", "SLA診断とプロバイダーフォールバック可視化に最適。", "SLA 진단과 공급자 대체 경로 가시화에 최적."),
      },
      {
        name: L("退款与证据控制台", "Refund & Evidence Console", "返金・証憑コンソール", "환불·증빙 콘솔"),
        category: L("售后", "After-sales", "アフターサポート", "애프터서비스"),
        imageUrl: "https://images.unsplash.com/photo-1450101499163-c8848c66ca85?auto=format&fit=crop&w=1200&q=80",
        score: 87,
        reason: L("退款和售后争议的可追溯性最强。", "Strongest traceability for refunds and support disputes.", "返金・サポート紛争時の追跡性が最も高い。", "환불 및 지원 분쟁 시 추적성이 가장 높습니다."),
      },
    ],
  };
}

function offsetCoords(lat, lng, northKm, eastKm) {
  const latDeg = northKm / 110.574;
  const lngDeg = eastKm / (111.320 * Math.cos((lat * Math.PI) / 180));
  return {
    lat: Number((lat + latDeg).toFixed(6)),
    lng: Number((lng + lngDeg).toFixed(6)),
  };
}

function summarizeConstraintsForReply(language, constraints) {
  const entries = Object.entries(constraints || {})
    .filter(([, value]) => value !== "" && value !== null && value !== undefined)
    .slice(0, 6);
  if (!entries.length) {
    return pickLang(
      language,
      "未提供额外约束",
      "No extra constraints",
      "追加条件なし",
      "추가 제약 없음",
    );
  }
  return entries.map(([key, value]) => `${key}:${String(value)}`).join(" · ");
}

function openAiVoiceForLanguage(language) {
  const lang = normalizeLang(language || "EN");
  if (lang === "ZH") return "alloy";
  if (lang === "JA") return "alloy";
  if (lang === "KO") return "alloy";
  return "alloy";
}

async function callOpenAITextToSpeech({ text, language, voice }) {
  const startedAt = Date.now();
  const content = String(text || "").trim();
  if (!content) return { ok: false, error: "empty_text" };
  OPENAI_LAST_RUNTIME.attemptedAt = nowIso();
  OPENAI_LAST_RUNTIME.statusCode = null;
  if (!OPENAI_API_KEY) {
    OPENAI_LAST_RUNTIME.errorAt = nowIso();
    OPENAI_LAST_RUNTIME.lastError = "missing_api_key";
    OPENAI_LAST_RUNTIME.durationMs = Date.now() - startedAt;
    return { ok: false, error: "missing_api_key" };
  }
  if (!OPENAI_KEY_HEALTH.looksValid) {
    OPENAI_LAST_RUNTIME.errorAt = nowIso();
    OPENAI_LAST_RUNTIME.lastError = `invalid_key_format:${OPENAI_KEY_HEALTH.reason}`;
    OPENAI_LAST_RUNTIME.durationMs = Date.now() - startedAt;
    return { ok: false, error: `invalid_key_format:${OPENAI_KEY_HEALTH.reason}` };
  }
  if (typeof fetch !== "function") {
    OPENAI_LAST_RUNTIME.errorAt = nowIso();
    OPENAI_LAST_RUNTIME.lastError = "fetch_unavailable";
    OPENAI_LAST_RUNTIME.durationMs = Date.now() - startedAt;
    return { ok: false, error: "fetch_unavailable" };
  }

  const payload = {
    model: OPENAI_TTS_MODEL,
    voice: String(voice || openAiVoiceForLanguage(language)),
    input: content.slice(0, 1000),
    format: "mp3",
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OPENAI_TIMEOUT_MS);
  try {
    const res = await fetch(`${OPENAI_BASE_URL}/audio/speech`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    OPENAI_LAST_RUNTIME.statusCode = Number(res.status || 0) || null;
    if (!res.ok) {
      let errBody = "";
      try {
        errBody = (await res.text()).slice(0, 240);
      } catch {
        errBody = "";
      }
      const reason = `openai_tts_http_${res.status}${errBody ? `:${errBody}` : ""}`;
      OPENAI_LAST_RUNTIME.errorAt = nowIso();
      OPENAI_LAST_RUNTIME.lastError = reason;
      OPENAI_LAST_RUNTIME.durationMs = Date.now() - startedAt;
      return { ok: false, error: reason };
    }
    const audioBuffer = Buffer.from(await res.arrayBuffer());
    if (!audioBuffer.length) {
      OPENAI_LAST_RUNTIME.errorAt = nowIso();
      OPENAI_LAST_RUNTIME.lastError = "openai_tts_empty_audio";
      OPENAI_LAST_RUNTIME.durationMs = Date.now() - startedAt;
      return { ok: false, error: "openai_tts_empty_audio" };
    }
    OPENAI_LAST_RUNTIME.successAt = nowIso();
    OPENAI_LAST_RUNTIME.lastError = null;
    OPENAI_LAST_RUNTIME.durationMs = Date.now() - startedAt;
    return {
      ok: true,
      provider: "openai",
      model: OPENAI_TTS_MODEL,
      voice: payload.voice,
      mimeType: "audio/mpeg",
      audioDataUrl: `data:audio/mpeg;base64,${audioBuffer.toString("base64")}`,
    };
  } catch (err) {
    const reason = err && err.name === "AbortError"
      ? `openai_tts_timeout_${OPENAI_TIMEOUT_MS}ms`
      : `openai_tts_network_error:${String((err && err.message) || err || "unknown").slice(0, 220)}`;
    OPENAI_LAST_RUNTIME.errorAt = nowIso();
    OPENAI_LAST_RUNTIME.lastError = reason;
    OPENAI_LAST_RUNTIME.durationMs = Date.now() - startedAt;
    return { ok: false, error: reason };
  } finally {
    clearTimeout(timer);
  }
}

// ── Intent Classifier ──────────────────────────────────────────────────────
// Separates RAG knowledge queries from booking/trip-planning requests.
// "rag"     → answer from knowledge base (RAG engine)
// "booking" → trigger SSE streaming plan builder with mock APIs
//
// Detect casual chat (greetings, small-talk, non-booking questions) — returns true if chat-only
function detectCasualChatIntent(message) {
  const msg = (message || "").toLowerCase().trim();
  // Pure greetings
  if (/^(hello|hi|hey|哈喽|你好|嗨|早安|早上好|good morning|good afternoon|good evening|greetings|salut|bonjour|hola|ciao|こんにちは|안녕|مرحبا)\s*[!！。.]*$/i.test(msg)) return true;
  // Pleasantries
  if (/^(thank you|thanks|谢谢|感谢|bye|再见|goodbye|nice to meet you|很高兴认识你|you.?re (great|awesome|helpful)|ok|okay|great|perfect|got it|明白了|好的|行|嗯|了解)\s*[!！。.]*$/i.test(msg)) return true;
  // Weather / small-talk (no booking signals)
  const chatOnlyPatterns = [
    /今天.*(天气|冷|热|下雨|晴)/, /weather.*(today|now|like)/, /what.?s.?the.?weather/,
    /need.?to.?tip/, /需要给小费/, /小费/, /tipping/, /how.?do.?i.?say.?please/, /中文怎么说/,
    /what.?time.?is.?it/, /几点/, /what.?year/, /what.?day/,
    /your.?name/, /你叫什么/, /who.?are.?you/, /what.?are.?you/, /你是谁/,
    /can.?you.?help/, /help.?me.?with/, /如何使用/, /how.?does.?this.?work/,
  ];
  const bookingIndicators = /\d+\s*(天|晚|人|元|万|days?|nights?|pax|budget|cnY|rmb)|(?:预算|budget|行程|旅游|旅行|book|trip|itinerary)/i;
  if (chatOnlyPatterns.some((rx) => rx.test(msg)) && !bookingIndicators.test(msg)) return true;
  return false;
}

async function callCasualChat({ message, language, city }) {
  const lang = normalizeLang(language);
  const sysPrompt = `You are CrossX, an AI concierge for foreign visitors in China. You speak in a warm, concise, helpful tone.
- Keep replies SHORT (2-4 sentences max) — this is conversational, not a travel guide
- If the user greets you, greet back naturally and ask how you can help
- Language: respond in the same language as the user (ZH for Chinese, EN for English, etc.)
- City context: ${city || "China"}
- You can answer general questions about China travel, culture, etiquette, weather, tipping, etc.
- Do NOT generate travel plans or itineraries here — that's handled separately`;

  if (!OPENAI_API_KEY || !OPENAI_KEY_HEALTH.looksValid) {
    return pickLang(lang,
      "你好！我是 CrossX，您在中国的 AI 旅行管家。有什么我可以帮您的？",
      "Hello! I'm CrossX, your AI travel concierge in China. How can I help you today?",
      "こんにちは！CrossXです。中国滞在をサポートするAIコンシェルジュです。",
      "안녕하세요! CrossX입니다. 중국 여행을 도와드리는 AI 컨시어지예요.",
    );
  }

  const res = await openAIRequest({
    apiKey: OPENAI_API_KEY,
    model: OPENAI_MODEL,
    systemPrompt: sysPrompt,
    userContent: message,
    temperature: 0.7,
    maxTokens: 150,
    jsonMode: false,
    timeoutMs: 10000,
  });
  return (res.ok && res.text) ? res.text.trim() : pickLang(lang,
    "收到！有什么旅行方面需要帮忙的请告诉我。",
    "Got it! Let me know if you need any help with your travels.",
    "了解しました！旅行について何かお手伝いできることがあればお知らせください。",
    "알겠습니다! 여행에 대해 도움이 필요하시면 알려주세요.",
  );
}

function classifyBookingIntent(message, constraints) {
  const msg = (message || "").toLowerCase();

  // RAG signals: knowledge / how-to / policy questions
  const ragSignals = [
    "怎么", "如何", "是什么", "有什么", "有没有", "能不能", "可以吗",
    "介绍", "说明", "外国人", "政策", "规定", "要求", "条件", "手续",
    "申请", "签证", "退税", "微信支付怎", "支付宝怎", "外卡", "绑卡",
    "how to", "what is", "what are", "how do i", "can i", "do i need",
    "explain", "tell me", "what documents", "is it possible",
    "policy", "requirement", "procedure",
  ];

  // Booking signals: action / trip-planning intent
  // Use specific multi-char strings to avoid false positives (e.g. "人" matching "外国人")
  const bookingSignals = [
    "预订", "找酒", "安排行", "行程规划", "推荐酒店", "住酒店",
    "出行", "旅游", "旅行", "规划行程", "计划行程",
    "预算", "万元", "元预算",
    "trip", "book hotel", "plan trip", "hotel stay", "budget trip",
    "itinerary", "arrange trip", "recommend hotel",
  ];
  // Numeric booking signals (require a digit + keyword)
  const hasNumericBooking = /\d+\s*(?:天|晚|days?|nights?)/i.test(msg) ||
    /\d+\s*(?:人|位|pax|guests?)/i.test(msg) ||
    /\d+\s*(?:元|万|RMB|CNY|预算)/i.test(msg) ||
    /(?:预算|budget)\s*\d+/i.test(msg);

  const hasRag = ragSignals.some((kw) => msg.includes(kw));
  const hasBooking = bookingSignals.some((kw) => msg.includes(kw)) || hasNumericBooking;
  const hasBookingConstraints = !!(
    constraints &&
    (constraints.budget || constraints.party_size ||
     constraints.duration || constraints.days || constraints.destination)
  );

  // Attraction / scenic spot queries → RAG (use local attraction KB)
  const attractionSignals = [
    "景点", "景区", "旅游景点", "推荐景点", "有哪些景点", "好玩的地方",
    "著名景点", "必去", "必玩", "打卡", "值得去", "怎么玩",
    "门票", "开放时间", "几点开门", "能去吗",
    "attraction", "scenic", "sight", "things to do", "places to visit", "must see",
  ];
  const hasSight = attractionSignals.some((kw) => msg.includes(kw));
  if (hasSight && !hasNumericBooking) return "rag";

  // Explicit question mark with no booking numeric signal → RAG
  if ((msg.includes("?") || msg.includes("？")) && !hasNumericBooking) return "rag";
  if (hasBooking || hasBookingConstraints) return "booking";
  if (hasRag) return "rag";
  return "booking"; // Default: drive engagement
}

// ── Quick Action Intent Detector ─────────────────────────────────────────
// Intercepts immediate single-point service needs BEFORE the heavy planning pipeline.
// Returns { type, data } object or null.
function detectQuickActionIntent(message) {
  const msg = (message || "").toLowerCase();

  // Ride-hailing / taxi
  if (/(打车|叫车|叫出租|叫滴滴|网约车|出租车|打的|我要车|帮我.?车|附近.?出租|附近.?滴滴|call.?taxi|get.?taxi|hail.?cab|order.?ride|taxi\b|cab\b|uber\b|grab\b)/i.test(msg)) {
    return { type: "ride_hailing", data: {} };
  }

  // Emergency
  if (/(报警|紧急求助|救命|call.?police|call.?ambulance|emergency\s+help|\b110\b|\b120\b|\b119\b)/i.test(msg)) {
    return { type: "emergency", data: {} };
  }

  // Currency conversion — detect amount + currency pairs
  const currRx = /(\d[\d,\.]*)[\s]*(块|元|人民币|cny|rmb)[^\d]*(?:等于|是|换|折合|多少|=)[^\d]*(美元|欧元|英镑|港元|日元|韩元|usd|eur|gbp|hkd|jpy|krw|法郎|chf|加元|cad|澳元|aud)/i;
  const currMatch = currRx.exec(message);
  const isCurrencyQ = /(汇率|换钱|兑换|exchange.?rate|currency.?convert|how.?much.?(?:rmb|yuan|cny))/i.test(msg);
  if (currMatch || isCurrencyQ) {
    let fromAmount = 0, toCurrency = "USD";
    if (currMatch) {
      fromAmount = parseFloat(String(currMatch[1] || "0").replace(/,/g, ""));
      const toRaw = (currMatch[3] || "").toLowerCase();
      toCurrency = /欧|eur/.test(toRaw) ? "EUR" : /美|usd/.test(toRaw) ? "USD" : /英|gbp/.test(toRaw) ? "GBP"
        : /港|hkd/.test(toRaw) ? "HKD" : /日|jpy/.test(toRaw) ? "JPY" : /韩|krw/.test(toRaw) ? "KRW"
        : /加|cad/.test(toRaw) ? "CAD" : /澳|aud/.test(toRaw) ? "AUD" : "USD";
    }
    return { type: "currency", data: { fromAmount, fromCurrency: "CNY", toCurrency } };
  }

  // Translation — extract phrase to translate
  const translateRx = /(翻译|怎么说|帮我说|告诉.*(司机|服务员|老板|他|她|对方)|how.?do.?you.?say|how.?to.?say|chinese.?for|say.?in.?chinese|how.?to.?tell|translate.?this|translate.?for.?me)/i;
  if (translateRx.test(msg)) {
    const phraseMatch = message.match(/["""「『]([^"""」』]{2,100})["""」』]/);
    const sourceText = phraseMatch ? phraseMatch[1] : message;
    return { type: "translate", data: { sourceText } };
  }

  return null;
}

// Approximate CNY exchange rates (updated periodically)
const CNY_RATES = {
  USD: 0.138, EUR: 0.128, GBP: 0.110, HKD: 1.08, JPY: 20.6,
  KRW: 183.0, CAD: 0.190, AUD: 0.213, CHF: 0.124,
};

async function buildQuickActionResponse(quickAction, message, language, city) {
  const lang = normalizeLang(language);
  const { type, data } = quickAction;

  // ── Ride-hailing ──────────────────────────────────────────────────────
  if (type === "ride_hailing") {
    return {
      response_type: "quick_action",
      action_type: "ride_hailing",
      spoken_text: pickLang(lang,
        "我已为您定位。点击下方即可唤起支付宝·滴滴（英文界面，支持外国信用卡）叫车。",
        "I\'ve located you. Tap below to open DiDi in Alipay — English UI, foreign cards accepted.",
        "位置を確認しました。以下をタップして支付宝の滴滴を起動してください（英語UI対応）。",
        "위치를 확인했습니다. 아래를 탭하여 알리페이 내 디디를 여세요 (영문 UI, 외국 카드 지원).",
      ),
      payload: {
        pickup: "current_location",
        city: city || "China",
        platforms: [
          {
            id: "didi_alipay",
            label: "Open DiDi (English · Alipay)",
            label_zh: "支付宝·滴滴（英文）",
            url: "alipays://platformapi/startapp?appId=2021001152620490",
            fallback_url: "https://page.alipay.com/mini/portal/index?appId=2021001152620490",
            recommended: true,
          },
          {
            id: "didi_app",
            label: "DiDi International App",
            label_zh: "滴滴出行国际版",
            url: "diditaxi://com.sdu.didi.psnger/",
            fallback_url: "https://www.didiglobal.com/download",
            recommended: false,
          },
        ],
        tip: lang === "ZH"
          ? "支付宝内滴滴已绑定外卡，全英文界面，外国游客最推荐。"
          : "DiDi via Alipay supports foreign credit cards and has an English interface — the top choice for international visitors.",
      },
    };
  }

  // ── Emergency ──────────────────────────────────────────────────────────
  if (type === "emergency") {
    return {
      response_type: "quick_action",
      action_type: "emergency",
      spoken_text: pickLang(lang, "中国紧急联络号码", "China Emergency Numbers", "中国の緊急番号", "중국 긴급 연락처"),
      payload: {
        numbers: [
          { label: "Police / 警察", number: "110" },
          { label: "Ambulance / 急救", number: "120" },
          { label: "Fire / 消防", number: "119" },
          { label: "Tourist Hotline / 旅游投诉", number: "12301" },
        ],
      },
    };
  }

  // ── Currency conversion ────────────────────────────────────────────────
  if (type === "currency") {
    const { fromAmount = 0, fromCurrency = "CNY", toCurrency = "USD" } = data;
    const rate = CNY_RATES[toCurrency] || 0.138;
    const toAmount = fromAmount > 0 ? Math.round(fromAmount * rate * 100) / 100 : null;
    return {
      response_type: "quick_action",
      action_type: "currency",
      spoken_text: pickLang(lang,
        fromAmount > 0 ? `¥${fromAmount} CNY ≈ ${toAmount} ${toCurrency}` : "汇率换算",
        fromAmount > 0 ? `¥${fromAmount} CNY ≈ ${toAmount} ${toCurrency}` : "Currency conversion",
        fromAmount > 0 ? `¥${fromAmount} CNY ≈ ${toAmount} ${toCurrency}` : "通貨換算",
        fromAmount > 0 ? `¥${fromAmount} CNY ≈ ${toAmount} ${toCurrency}` : "환율 환산",
      ),
      payload: {
        from_currency: fromCurrency,
        from_amount: fromAmount,
        to_currency: toCurrency,
        to_amount: toAmount,
        rate,
        rate_note: lang === "ZH"
          ? "参考汇率（近似值），实际以银行/支付宝为准。"
          : "Reference rate (approximate). Actual rates may vary.",
      },
    };
  }

  // ── Translation (with OpenAI) ──────────────────────────────────────────
  if (type === "translate") {
    const { sourceText } = data;
    let translatedText = "";
    let translatedEn = sourceText;

    if (OPENAI_API_KEY && OPENAI_KEY_HEALTH.looksValid) {
      try {
        const tRes = await openAIRequest({
          apiKey: OPENAI_API_KEY,
          model: OPENAI_MODEL,
          systemPrompt: `你是一个专业翻译助手。用户是外国游客在中国，需要把一段话翻译成简洁、地道的中文普通话，以便直接展示给中国人看（服务员、司机等）。
输出格式（严格 JSON，无其他文字）：{"zh":"中文翻译（不超过30字，直接、口语化）","en":"原始英文或更清晰的表达（不超过50字）"}
如果输入已是中文，则将 zh 字段保留原中文，en 字段填英文翻译。`,
          userContent: `翻译: "${sourceText.slice(0, 200)}"`,
          temperature: 0.2,
          maxTokens: 120,
          jsonMode: true,
          timeoutMs: 8000,
        });
        const parsed = safeParseJson(tRes.text);
        if (parsed && parsed.zh) {
          translatedText = parsed.zh;
          translatedEn = parsed.en || sourceText;
        }
      } catch (e) {
        console.warn("[quick_action/translate] OpenAI failed:", e.message);
      }
    }

    if (!translatedText) translatedText = sourceText;

    return {
      response_type: "quick_action",
      action_type: "translate",
      spoken_text: pickLang(lang,
        "翻译完成，可直接展示给对方看。",
        "Translation ready — show this screen to the person.",
        "翻訳完了。相手にスクリーンを見せてください。",
        "번역 완료 — 이 화면을 상대방에게 보여주세요.",
      ),
      payload: {
        source_text: translatedEn,
        translated_text: translatedText,
        context_tip: lang === "ZH"
          ? "将此屏幕展示给服务员/司机看即可。"
          : "Show this screen to the waiter / driver.",
      },
    };
  }

  return {
    response_type: "quick_action",
    action_type: type,
    spoken_text: pickLang(lang, "正在为您处理...", "Processing your request...", "処理中...", "처리 중..."),
    payload: {},
  };
}

// ── Mock API Data & Builders ───────────────────────────────────────────────
// All mock data uses real hotel brands and real transport options.
// Every field is populated — NO "ETA -" or placeholder strings.

const MOCK_HOTEL_DB = {
  "深圳": [
    { name: "全季酒店深圳宝安",       nameEn: "Ji Hotel Shenzhen Baoan",          stars: 3, basePrice: 268, area: "宝安",    features: ["近机场", "免费停车", "24h前台"] },
    { name: "亚朵酒店深圳南山",       nameEn: "Atour Hotel Shenzhen Nanshan",     stars: 4, basePrice: 488, area: "科技园",  features: ["含早餐", "健身房", "商务中心"] },
    { name: "深圳前海万豪酒店",       nameEn: "Shenzhen Qianhai Marriott",        stars: 5, basePrice: 1280, area: "南山前海", features: ["海景房", "无边泳池", "行政酒廊"] },
    { name: "深圳JW万豪侯爵酒店",     nameEn: "JW Marriott Marquis Shenzhen",    stars: 5, basePrice: 1680, area: "后海湾",  features: ["顶层泳池", "米其林餐厅", "专属管家"] },
  ],
  "上海": [
    { name: "全季酒店上海徐家汇",     nameEn: "Ji Hotel Shanghai Xujiahui",      stars: 3, basePrice: 298, area: "徐家汇",  features: ["地铁2号线", "商圈步行", "24h前台"] },
    { name: "亚朵酒店上海虹桥",       nameEn: "Atour Hotel Shanghai Hongqiao",   stars: 4, basePrice: 528, area: "虹桥",    features: ["含早餐", "近高铁站", "健身房"] },
    { name: "上海万豪虹桥大酒店",     nameEn: "Shanghai Marriott Hotel Hongqiao",stars: 5, basePrice: 1250, area: "虹桥商务", features: ["会议中心", "行政酒廊", "英文服务"] },
    { name: "外滩茂悦大酒店",         nameEn: "Hyatt on the Bund Shanghai",      stars: 5, basePrice: 1580, area: "外滩黄浦", features: ["外滩景观", "Spa水疗", "旗舰餐厅"] },
  ],
  "北京": [
    { name: "全季酒店北京望京",       nameEn: "Ji Hotel Beijing Wangjing",       stars: 3, basePrice: 288, area: "望京",    features: ["近地铁", "停车场", "24h前台"] },
    { name: "亚朵酒店北京三里屯",     nameEn: "Atour Hotel Beijing Sanlitun",    stars: 4, basePrice: 548, area: "三里屯",  features: ["含早餐", "设计感", "近使馆区"] },
    { name: "北京JW万豪酒店",         nameEn: "JW Marriott Hotel Beijing",       stars: 5, basePrice: 1380, area: "CBD",     features: ["无边泳池", "英文服务", "健身中心"] },
    { name: "北京国贸大酒店",         nameEn: "China World Hotel Beijing",       stars: 5, basePrice: 1480, area: "国贸CBD", features: ["地标建筑", "行政酒廊", "购物中心直连"] },
  ],
  "广州": [
    { name: "全季酒店广州珠江新城",   nameEn: "Ji Hotel Guangzhou Pearl River",  stars: 3, basePrice: 248, area: "珠江新城", features: ["地铁口", "步行商圈", "24h前台"] },
    { name: "亚朵酒店广州天河",       nameEn: "Atour Hotel Guangzhou Tianhe",    stars: 4, basePrice: 448, area: "天河",    features: ["含早餐", "城市中心", "健身房"] },
    { name: "广州W酒店",              nameEn: "W Hotel Guangzhou",              stars: 5, basePrice: 1280, area: "珠江新城", features: ["泳池派对", "潮流餐厅", "WET泳池"] },
    { name: "广州四季酒店",           nameEn: "Four Seasons Hotel Guangzhou",   stars: 5, basePrice: 2200, area: "珠江新城高层", features: ["高空泳池", "顶级餐厅", "管家服务"] },
  ],
  "default": [
    { name: "全季酒店",               nameEn: "Ji Hotel",                        stars: 3, basePrice: 268, area: "市中心",  features: ["24h前台", "免费停车"] },
    { name: "亚朵酒店",               nameEn: "Atour Hotel",                     stars: 4, basePrice: 488, area: "商圈",    features: ["含早餐", "健身房"] },
    { name: "万达嘉华酒店",           nameEn: "Wanda Realm Hotel",              stars: 5, basePrice: 980, area: "万达广场", features: ["Spa水疗", "游泳池", "行政酒廊"] },
    { name: "万豪酒店",               nameEn: "Marriott Hotel",                  stars: 5, basePrice: 1380, area: "核心商务区", features: ["游泳池", "英文服务", "行政酒廊"] },
  ],
};

const MOCK_TRANSPORT_DB = {
  "深圳": {
    airport: { name: "深圳宝安国际机场", code: "SZX" },
    options: [
      { mode: "专车接送", cost: 280, duration: "40分钟", desc: "宝安机场 → 南山/福田，含行李搬运" },
      { mode: "地铁11号线", cost: 36, duration: "65分钟", desc: "机场 → 福田站，转地铁至目的地" },
      { mode: "机场大巴+打车", cost: 68, duration: "55分钟", desc: "大巴至福田汽车站，末段打车约20元" },
    ],
    local: { mode: "地铁+网约车", dailyCost: 80, desc: "滴滴出行+地铁日均约80元/人" },
  },
  "上海": {
    airport: { name: "浦东国际机场", code: "PVG" },
    options: [
      { mode: "磁悬浮+地铁2号线", cost: 60, duration: "50分钟", desc: "浦东机场 → 龙阳路 → 地铁2号线市中心" },
      { mode: "专车接送", cost: 320, duration: "60分钟", desc: "机场 → 市区酒店，含行李，全程英文司机" },
      { mode: "机场大巴7路", cost: 22, duration: "80分钟", desc: "7路大巴至静安寺/徐汇，再打车到酒店" },
    ],
    local: { mode: "地铁+网约车", dailyCost: 100, desc: "滴滴出行+地铁日均约100元/人" },
  },
  "北京": {
    airport: { name: "北京首都国际机场", code: "PEK" },
    options: [
      { mode: "机场快轨", cost: 25, duration: "20分钟", desc: "T2/T3 → 东直门/三元桥，换乘地铁至全城" },
      { mode: "专车接送", cost: 350, duration: "45分钟", desc: "机场 → 市区酒店，含高速费与行李" },
      { mode: "机场快轨+地铁", cost: 30, duration: "55分钟", desc: "东直门换乘10号线，覆盖CBD/三里屯" },
    ],
    local: { mode: "地铁+网约车", dailyCost: 90, desc: "滴滴出行+地铁日均约90元/人" },
  },
  "广州": {
    airport: { name: "广州白云国际机场", code: "CAN" },
    options: [
      { mode: "地铁3号线北延段", cost: 26, duration: "50分钟", desc: "机场北站 → 体育西路，直达天河商圈" },
      { mode: "专车接送", cost: 200, duration: "45分钟", desc: "机场 → 天河/珠江新城，含高速费" },
      { mode: "机场大巴", cost: 24, duration: "60分钟", desc: "直达天河体育中心、广州东站等多站点" },
    ],
    local: { mode: "地铁+网约车", dailyCost: 70, desc: "滴滴出行+地铁日均约70元/人" },
  },
  "default": {
    airport: { name: "当地机场", code: "---" },
    options: [
      { mode: "专车接送", cost: 200, duration: "45分钟", desc: "机场直达酒店，含行李，中英文司机" },
      { mode: "地铁/大巴", cost: 30, duration: "60分钟", desc: "公共交通至市区，经济实惠" },
      { mode: "机场大巴+打车", cost: 60, duration: "55分钟", desc: "大巴至市区换乘，末段打车至酒店" },
    ],
    local: { mode: "地铁+网约车", dailyCost: 80, desc: "滴滴出行+地铁日均约80元/人" },
  },
};

function detectCityKey(city) {
  const c = (city || "").trim();
  if (/深圳|shenzhen/i.test(c)) return "深圳";
  if (/上海|shanghai/i.test(c)) return "上海";
  if (/北京|beijing/i.test(c)) return "北京";
  if (/广州|guangzhou/i.test(c)) return "广州";
  return "default";
}

function mockBuildThreeTierPlans({ city, budget, pax, days }) {
  const cityKey = detectCityKey(city);
  const hotels = MOCK_HOTEL_DB[cityKey] || MOCK_HOTEL_DB.default;
  const transport = MOCK_TRANSPORT_DB[cityKey] || MOCK_TRANSPORT_DB.default;

  // Sort hotels by price ascending
  const sorted = [...hotels].sort((a, b) => a.basePrice - b.basePrice);
  const hotelC = sorted[0];
  const hotelA = sorted[sorted.length - 1];
  // Mid: closest to (budget / days * 0.55) per night
  const targetNightly = (budget / days) * 0.55;
  const hotelB = sorted.reduce((best, h) =>
    Math.abs(h.basePrice - targetNightly) < Math.abs(best.basePrice - targetNightly) ? h : best
  );

  const txA = transport.options[0];
  const txB = transport.options[1] || transport.options[0];
  const txC = transport.options[transport.options.length - 1];
  const localDaily = transport.local.dailyCost;

  const diningA = Math.round(200 * pax * days);
  const diningB = Math.round(110 * pax * days);
  const diningC = Math.round(55  * pax * days);

  const localA = Math.round(localDaily * pax * days * 1.1);
  const localB = Math.round(localDaily * pax * days);
  const localC = Math.round(localDaily * pax * days * 0.8);

  const totalA = hotelA.basePrice * days + txA.cost * pax + diningA + localA;
  const totalB = hotelB.basePrice * days + txB.cost * pax + diningB + localB;
  const totalC = hotelC.basePrice * days + txC.cost * pax + diningC + localC;

  return {
    response_type: "options_card",
    spoken_text: `已为您制定${city}${days}天${pax}人行程的3套定制方案，严格控制在预算梯度内，每套均含酒店、接机和餐饮完整安排：`,
    destination: city,
    duration_days: days,
    pax,
    budget_reference: budget,
    options: [
      {
        id: "opt_a",
        tag: "极致体验",
        hotel_name: `${hotelA.name}（${hotelA.area}）`,
        hotel_price_per_night: hotelA.basePrice,
        transport_plan: txA.desc,
        transport_total: txA.cost * pax,
        dining_plan: `${city}高端餐厅，人均¥150-200（推荐提前美团预订）`,
        translation_service: "随行翻译App（有道/百度）+ 离线高德地图",
        total_cost: totalA,
        features: [...(hotelA.features || []).slice(0, 2), `${txA.mode}直达`].slice(0, 3),
      },
      {
        id: "opt_b",
        tag: "均衡之选",
        hotel_name: `${hotelB.name}（${hotelB.area}）`,
        hotel_price_per_night: hotelB.basePrice,
        transport_plan: txB.desc,
        transport_total: txB.cost * pax,
        dining_plan: `人气餐厅+便利店组合，人均¥80-120，美团/大众点评可英文搜索`,
        translation_service: "百度翻译离线版（支持拍照翻译菜单）",
        total_cost: totalB,
        features: [...(hotelB.features || []).slice(0, 2), "性价比最优"].slice(0, 3),
      },
      {
        id: "opt_c",
        tag: "精打细算",
        hotel_name: `${hotelC.name}（${hotelC.area}）`,
        hotel_price_per_night: hotelC.basePrice,
        transport_plan: txC.desc,
        transport_total: txC.cost * pax,
        dining_plan: `当地小馆+便利店（罗森/全家/711），人均¥40-60，支持微信/现金`,
        translation_service: "谷歌翻译 + 高德地图国际版（免费）",
        total_cost: totalC,
        features: [...(hotelC.features || []).slice(0, 2), "节省开支"].slice(0, 3),
      },
    ],
  };
}

// ── Slot-Filling & Multi-Option JSON Architecture ──────────────────────────
//
// The LLM acts as a strict JSON state machine.
// Output is ALWAYS one of two schemas:
//   { response_type: "clarify", spoken_text, missing_slots }
//   { response_type: "options_card", spoken_text, options: [A, B, C] }
//
// This eliminates template leak ("ETA -, Cost -") and hallucinated plans.




async function callOpenAIChatReply({ message, language, city, constraints, recommendation, conversationHistory }) {
  const startedAt = Date.now();
  OPENAI_LAST_RUNTIME.attemptedAt = nowIso();
  OPENAI_LAST_RUNTIME.statusCode = null;
  if (!OPENAI_API_KEY) {
    OPENAI_LAST_RUNTIME.errorAt = nowIso();
    OPENAI_LAST_RUNTIME.lastError = "missing_api_key";
    OPENAI_LAST_RUNTIME.durationMs = Date.now() - startedAt;
    return { ok: false, error: "missing_api_key" };
  }
  if (!OPENAI_KEY_HEALTH.looksValid) {
    OPENAI_LAST_RUNTIME.errorAt = nowIso();
    OPENAI_LAST_RUNTIME.lastError = `invalid_key_format:${OPENAI_KEY_HEALTH.reason}`;
    OPENAI_LAST_RUNTIME.durationMs = Date.now() - startedAt;
    return { ok: false, error: `invalid_key_format:${OPENAI_KEY_HEALTH.reason}` };
  }
  if (typeof fetch !== "function") {
    OPENAI_LAST_RUNTIME.errorAt = nowIso();
    OPENAI_LAST_RUNTIME.lastError = "fetch_unavailable";
    OPENAI_LAST_RUNTIME.durationMs = Date.now() - startedAt;
    return { ok: false, error: "fetch_unavailable" };
  }
  const lang = normalizeLang(language);
  const knowledgeContext = buildChinaTravelKnowledge();
  const historyMessages = Array.isArray(conversationHistory)
    ? conversationHistory.slice(-6).map((m) => ({
        role: String(m.role) === "assistant" ? "assistant" : "user",
        content: String(m.content || ""),
      }))
    : [];
  // Build a clean, natural-language user context — no raw JSON exposed
  const ctxParts = [];
  if (city) ctxParts.push(`城市: ${city}`);
  if (constraints.budget) ctxParts.push(`预算: ${constraints.budget}`);
  if (constraints.party_size || constraints.guestNum) ctxParts.push(`人数: ${constraints.party_size || constraints.guestNum}人`);
  if (constraints.dietary) ctxParts.push(`饮食: ${constraints.dietary}`);
  if (constraints.duration || constraints.days) ctxParts.push(`天数: ${constraints.duration || constraints.days}天`);
  if (constraints.checkInDate || constraints.check_in_date) ctxParts.push(`入住: ${constraints.checkInDate || constraints.check_in_date}`);
  if (constraints.checkOutDate || constraints.check_out_date) ctxParts.push(`退房: ${constraints.checkOutDate || constraints.check_out_date}`);
  if (constraints.starRating) ctxParts.push(`星级: ${constraints.starRating}星`);
  const contextLine = ctxParts.length ? ctxParts.join(" | ") : "";
  const payload = {
    model: OPENAI_MODEL,
    temperature: 0.4,
    max_tokens: 600,
    messages: [
      {
        role: "system",
        content: [
          "You are CrossX — China's smartest travel assistant for foreign visitors. You give CONCRETE, SPECIFIC, ACTIONABLE recommendations with real names, real prices, and real steps.",
          "RULES:",
          "1. NEVER output raw technical parameters like city:XXX or distance:walk. Speak naturally.",
          "2. ALWAYS give a real specific recommendation — a real restaurant/hotel name, a real transport option with price estimate.",
          "3. Use the Platform Knowledge section below for factual data (prices, transport times, hotel names).",
          "4. Structure every reply with these emoji sections: ⭐ 最优推荐 | 📊 方案对比 | ⚠️ 注意 | ➡️ 立即行动",
          "5. Reply in the user's language (ZH/EN/JA/KO).",
          "6. For EACH option in 方案对比: include name (Chinese+English), price, time/ETA, why it fits.",
          "7. ➡️ 立即行动 must be ultra-specific: exact app name, exact search term, exact steps.",
          "",
          "## Platform Knowledge",
          knowledgeContext,
        ].join("\n"),
      },
      ...historyMessages,
      {
        role: "user",
        content: [
          `用户需求: ${String(message || "")}`,
          contextLine ? `背景信息: ${contextLine}` : "",
          `请给出具体可执行的推荐方案，包含真实的地点名称、价格区间和操作步骤。`,
        ].filter(Boolean).join("\n"),
      },
    ],
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OPENAI_TIMEOUT_MS);
  try {
    const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    OPENAI_LAST_RUNTIME.statusCode = Number(res.status || 0) || null;
    if (!res.ok) {
      let errBody = "";
      try {
        errBody = (await res.text()).slice(0, 240);
      } catch {
        errBody = "";
      }
      const reason = `openai_http_${res.status}${errBody ? `:${errBody}` : ""}`;
      OPENAI_LAST_RUNTIME.errorAt = nowIso();
      OPENAI_LAST_RUNTIME.lastError = reason;
      OPENAI_LAST_RUNTIME.durationMs = Date.now() - startedAt;
      return { ok: false, error: reason };
    }
    const data = await res.json();
    const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (typeof text === "string" && text.trim()) {
      OPENAI_LAST_RUNTIME.successAt = nowIso();
      OPENAI_LAST_RUNTIME.lastError = null;
      OPENAI_LAST_RUNTIME.durationMs = Date.now() - startedAt;
      return { ok: true, text: text.trim() };
    }
    OPENAI_LAST_RUNTIME.errorAt = nowIso();
    OPENAI_LAST_RUNTIME.lastError = "empty_openai_content";
    OPENAI_LAST_RUNTIME.durationMs = Date.now() - startedAt;
    return { ok: false, error: "empty_openai_content" };
  } catch (err) {
    const reason = err && err.name === "AbortError" ? `openai_timeout_${OPENAI_TIMEOUT_MS}ms` : `openai_network_error:${String((err && err.message) || err || "unknown").slice(0, 220)}`;
    OPENAI_LAST_RUNTIME.errorAt = nowIso();
    OPENAI_LAST_RUNTIME.lastError = reason;
    OPENAI_LAST_RUNTIME.durationMs = Date.now() - startedAt;
    return { ok: false, error: reason };
  } finally {
    clearTimeout(timer);
  }
}

// ── Claude subprocess (claude -p) ─────────────────────────────────────────
// Uses the locally installed claude CLI to answer — bypasses proxy restrictions.
// Works when server.js runs as a standalone process (not inside a claude session).
const CLAUDE_BIN = process.env.CLAUDE_BIN || "/Users/kwok/.local/bin/claude";
let CLAUDE_SUB_TIMEOUT_MS = 25000;

function callClaudeSubprocess({ message, language, city, constraints, recommendation, conversationHistory }) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const knowledgeContext = buildChinaTravelKnowledge();
    const lang = normalizeLang(language);
    const constraintsSummary = summarizeConstraintsForReply(lang, constraints);
    const ambiguous = isAmbiguousIntentMessage(message, constraints);
    const choice = recommendation && recommendation.crossXChoice ? recommendation.crossXChoice : null;
    const topLanes = (recommendation && recommendation.options ? recommendation.options : []).slice(0, 3);
    const topLaneLines = topLanes
      .map((item, idx) => {
        const reason = Array.isArray(item.analysis) && item.analysis.length
          ? item.analysis[0]
          : (Array.isArray(item.comments) && item.comments.length ? item.comments[0] : "");
        return `${idx + 1}. ${item.title} - ${item.etaWindow || "-"} - ${reason}`;
      })
      .join("\n");
    // Build conversation history lines
    const historyLines = Array.isArray(conversationHistory)
      ? conversationHistory.slice(-6).map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`).join("\n")
      : "";
    const fullPrompt = [
      "You are CrossX, a China travel assistant for foreign visitors. Reply in the user's language (ZH/EN/JA/KO). Be concise, practical, and culturally aware.",
      "Structure: 1) one-line summary 2) ⭐ CrossX Choice (best pick + why) 3) 2-3 option cards 4) ⚠️ China-specific cautions 5) ➡️ next action",
      "For restaurants: mention reservation need, English menu, payment support (Alipay/WeChat/card). Include Chinese name + English alias.",
      "",
      "## Platform Knowledge",
      knowledgeContext,
      "",
      historyLines ? `## Conversation History\n${historyLines}\n` : "",
      `## Current Request`,
      `Language: ${lang}`,
      `City: ${city || "Shanghai"}`,
      `Constraints: ${constraintsSummary}`,
      `Raw constraints: ${JSON.stringify(constraints || {})}`,
      ambiguous ? "Note: Request is vague — ask 2-3 clarifying questions about duration, preference type, budget." : "",
      choice ? `CrossX Choice hint: ${choice.title} | ${choice.reason}` : "",
      topLaneLines ? `Candidate options:\n${topLaneLines}` : "",
      "",
      `User: ${String(message || "")}`,
    ].filter(Boolean).join("\n");

    // Strip claude session env vars so subprocess can run independently
    const subEnv = Object.assign({}, process.env);
    delete subEnv.CLAUDECODE;
    delete subEnv.CLAUDE_CODE_ENTRYPOINT;

    let stdout = "";
    let stderr = "";
    let finished = false;

    const proc = spawn(
      CLAUDE_BIN,
      ["-p", "--dangerously-skip-permissions", "--no-session-persistence", "--output-format", "text"],
      { env: subEnv, stdio: ["pipe", "pipe", "pipe"] },
    );

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        try { proc.kill("SIGTERM"); } catch {}
        resolve({ ok: false, error: "subprocess_timeout", durationMs: Date.now() - startedAt });
      }
    }, CLAUDE_SUB_TIMEOUT_MS);

    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });

    proc.on("close", (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      const durationMs = Date.now() - startedAt;
      const text = stdout.trim();
      if (code === 0 && text.length > 10) {
        resolve({ ok: true, text, model: "claude-subprocess", durationMs });
      } else {
        const errMsg = stderr.slice(0, 200) || `exit_code_${code}`;
        resolve({ ok: false, error: errMsg, durationMs });
      }
    });

    proc.on("error", (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ ok: false, error: err.message, durationMs: Date.now() - startedAt });
    });

    // Write prompt to stdin
    try {
      proc.stdin.write(fullPrompt, "utf8");
      proc.stdin.end();
    } catch (e) {
      // stdin may already be closed
    }
  });
}

async function callClaudeChatReply({ message, language, city, constraints, recommendation, conversationHistory }) {
  const startedAt = Date.now();
  ANTHROPIC_LAST_RUNTIME.attemptedAt = nowIso();
  ANTHROPIC_LAST_RUNTIME.statusCode = null;
  if (!ANTHROPIC_API_KEY) {
    ANTHROPIC_LAST_RUNTIME.errorAt = nowIso();
    ANTHROPIC_LAST_RUNTIME.lastError = "missing_api_key";
    ANTHROPIC_LAST_RUNTIME.durationMs = Date.now() - startedAt;
    return { ok: false, error: "missing_api_key" };
  }
  if (!ANTHROPIC_KEY_HEALTH.looksValid) {
    ANTHROPIC_LAST_RUNTIME.errorAt = nowIso();
    ANTHROPIC_LAST_RUNTIME.lastError = `invalid_key_format:${ANTHROPIC_KEY_HEALTH.reason}`;
    ANTHROPIC_LAST_RUNTIME.durationMs = Date.now() - startedAt;
    return { ok: false, error: `invalid_key_format:${ANTHROPIC_KEY_HEALTH.reason}` };
  }
  if (typeof fetch !== "function") {
    ANTHROPIC_LAST_RUNTIME.errorAt = nowIso();
    ANTHROPIC_LAST_RUNTIME.lastError = "fetch_unavailable";
    ANTHROPIC_LAST_RUNTIME.durationMs = Date.now() - startedAt;
    return { ok: false, error: "fetch_unavailable" };
  }
  const lang = normalizeLang(language);
  const ambiguous = isAmbiguousIntentMessage(message, constraints);
  const stage = inferConversationStage(message, detectIntentHint(message));
  const choice = recommendation && recommendation.crossXChoice ? recommendation.crossXChoice : null;
  const topLanes = (recommendation && recommendation.options ? recommendation.options : []).slice(0, 3);
  const topLaneLines = topLanes
    .map((item, idx) => {
      const reason = Array.isArray(item.analysis) && item.analysis.length
        ? item.analysis[0]
        : (Array.isArray(item.comments) && item.comments.length ? item.comments[0] : "");
      const details = [
        item.placeDisplay ? `place=${item.placeDisplay}` : item.placeName ? `place=${item.placeName}` : "",
        item.hotelDisplay ? `hotel=${item.hotelDisplay}` : item.hotelName ? `hotel=${item.hotelName}` : "",
        item.transportMode ? `transport=${item.transportMode}` : "",
        item.costRange ? `cost=${item.costRange}` : "",
        item.openHours ? `hours=${item.openHours}` : "",
        item.touristFriendlyScore ? `friendly=${item.touristFriendlyScore}` : "",
      ].filter(Boolean).join(", ");
      return `${idx + 1}. ${item.title} (${item.grade || recommendationGrade(item.score)}) - ${item.etaWindow || "-"} - ${details} - ${reason}`;
    })
    .join("\n");
  const knowledgeContext = buildChinaTravelKnowledge();
  const systemPrompt = [
    "You are CrossX — China's smartest travel assistant for foreign visitors.",
    "You give CONCRETE, SPECIFIC, ACTIONABLE recommendations with real names, real prices, and real steps.",
    "RULES:",
    "1. NEVER output raw technical parameters like city:XXX or distance:walk — speak naturally.",
    "2. ALWAYS give a real specific recommendation: a real restaurant/hotel name, a real transport option with price estimate.",
    "3. Use the Platform Knowledge section for factual data (prices, transport times, hotel names).",
    "4. Structure every reply: ⭐ 最优推荐 | 📊 方案对比 | ⚠️ 注意 | ➡️ 立即行动",
    "5. Reply in the user's language.",
    "6. For EACH option in 方案对比: include real name (Chinese+English), price range, time/ETA, why it fits.",
    "7. ➡️ 立即行动 must be ultra-specific: exact app name, exact search term, exact steps.",
    "",
    "## Platform Knowledge",
    knowledgeContext,
  ].join("\n");
  // Build clean natural-language context — no raw JSON
  const ctxParts = [];
  if (city) ctxParts.push(`城市: ${city}`);
  if (constraints.budget) ctxParts.push(`预算: ${constraints.budget}`);
  if (constraints.party_size || constraints.guestNum) ctxParts.push(`人数: ${constraints.party_size || constraints.guestNum}人`);
  if (constraints.dietary) ctxParts.push(`饮食偏好: ${constraints.dietary}`);
  if (constraints.duration || constraints.days) ctxParts.push(`天数: ${constraints.duration || constraints.days}天`);
  if (constraints.checkInDate || constraints.check_in_date) ctxParts.push(`入住: ${constraints.checkInDate || constraints.check_in_date}`);
  if (constraints.checkOutDate || constraints.check_out_date) ctxParts.push(`退房: ${constraints.checkOutDate || constraints.check_out_date}`);
  if (constraints.starRating) ctxParts.push(`星级: ${constraints.starRating}星`);
  const contextLine = ctxParts.length ? ctxParts.join(" | ") : "";
  const userContent = [
    `用户需求: ${String(message || "")}`,
    contextLine ? `背景信息: ${contextLine}` : "",
    `请给出具体可执行的推荐方案，包含真实地点名称、价格区间和操作步骤。`,
  ].filter(Boolean).join("\n");
  const historyMessages = Array.isArray(conversationHistory)
    ? conversationHistory.slice(-6).map((m) => ({
        role: String(m.role) === "assistant" ? "assistant" : "user",
        content: String(m.content || ""),
      }))
    : [];
  // Anthropic requires alternating user/assistant messages — merge consecutive same-role entries
  const normalizedHistory = [];
  for (const m of historyMessages) {
    if (normalizedHistory.length > 0 && normalizedHistory[normalizedHistory.length - 1].role === m.role) {
      normalizedHistory[normalizedHistory.length - 1].content += "\n" + m.content;
    } else {
      normalizedHistory.push({ role: m.role, content: m.content });
    }
  }
  // Ensure history ends with user turn or is empty before appending current user message
  const messages = [...normalizedHistory, { role: "user", content: userContent }];
  const payload = {
    model: ANTHROPIC_MODEL,
    max_tokens: 3500,
    system: systemPrompt,
    messages,
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ANTHROPIC_TIMEOUT_MS);
  try {
    const res = await fetch(`${ANTHROPIC_BASE_URL}/v1/messages`, {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "user-agent": "claude_code",
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    ANTHROPIC_LAST_RUNTIME.statusCode = Number(res.status || 0) || null;
    if (!res.ok) {
      let errBody = "";
      try { errBody = (await res.text()).slice(0, 240); } catch { errBody = ""; }
      const reason = `claude_http_${res.status}${errBody ? `:${errBody}` : ""}`;
      ANTHROPIC_LAST_RUNTIME.errorAt = nowIso();
      ANTHROPIC_LAST_RUNTIME.lastError = reason;
      ANTHROPIC_LAST_RUNTIME.durationMs = Date.now() - startedAt;
      return { ok: false, error: reason };
    }
    const data = await res.json();
    const text = data && data.content && data.content[0] && data.content[0].text;
    if (typeof text === "string" && text.trim()) {
      ANTHROPIC_LAST_RUNTIME.successAt = nowIso();
      ANTHROPIC_LAST_RUNTIME.lastError = null;
      ANTHROPIC_LAST_RUNTIME.durationMs = Date.now() - startedAt;
      return { ok: true, text: text.trim(), model: data.model || ANTHROPIC_MODEL, durationMs: Date.now() - startedAt };
    }
    ANTHROPIC_LAST_RUNTIME.errorAt = nowIso();
    ANTHROPIC_LAST_RUNTIME.lastError = "empty_claude_content";
    ANTHROPIC_LAST_RUNTIME.durationMs = Date.now() - startedAt;
    return { ok: false, error: "empty_claude_content" };
  } catch (err) {
    const reason = err && err.name === "AbortError"
      ? `claude_timeout_${ANTHROPIC_TIMEOUT_MS}ms`
      : `claude_network_error:${String((err && err.message) || err || "unknown").slice(0, 220)}`;
    ANTHROPIC_LAST_RUNTIME.errorAt = nowIso();
    ANTHROPIC_LAST_RUNTIME.lastError = reason;
    ANTHROPIC_LAST_RUNTIME.durationMs = Date.now() - startedAt;
    return { ok: false, error: reason };
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenAIFreeformReply({ message, language, city, constraints }) {
  const startedAt = Date.now();
  OPENAI_LAST_RUNTIME.attemptedAt = nowIso();
  OPENAI_LAST_RUNTIME.statusCode = null;
  if (!OPENAI_API_KEY) {
    OPENAI_LAST_RUNTIME.errorAt = nowIso();
    OPENAI_LAST_RUNTIME.lastError = "missing_api_key";
    OPENAI_LAST_RUNTIME.durationMs = Date.now() - startedAt;
    return { ok: false, error: "missing_api_key" };
  }
  if (!OPENAI_KEY_HEALTH.looksValid) {
    OPENAI_LAST_RUNTIME.errorAt = nowIso();
    OPENAI_LAST_RUNTIME.lastError = `invalid_key_format:${OPENAI_KEY_HEALTH.reason}`;
    OPENAI_LAST_RUNTIME.durationMs = Date.now() - startedAt;
    return { ok: false, error: `invalid_key_format:${OPENAI_KEY_HEALTH.reason}` };
  }
  if (typeof fetch !== "function") {
    OPENAI_LAST_RUNTIME.errorAt = nowIso();
    OPENAI_LAST_RUNTIME.lastError = "fetch_unavailable";
    OPENAI_LAST_RUNTIME.durationMs = Date.now() - startedAt;
    return { ok: false, error: "fetch_unavailable" };
  }
  const lang = normalizeLang(language || "EN");
  const constraintSummary = summarizeConstraintsForReply(lang, constraints);
  const payload = {
    model: OPENAI_MODEL,
    temperature: 0.55,
    max_tokens: 180,
    messages: [
      {
        role: "system",
        content: [
          "You are Cross X, a practical China travel assistant for inbound visitors.",
          "Reply naturally like a helpful concierge, not a workflow engine.",
          "If user only greets or is vague, ask one concise follow-up question to move toward action.",
          "Keep response short (2-4 sentences), clear, and in the user's language.",
          "Avoid JSON, bullet lists, and technical terms unless user asks for them.",
        ].join(" "),
      },
      {
        role: "user",
        content: `Language:${lang}\nCity:${city || "Shanghai"}\nConstraints:${constraintSummary}\nUser:${String(message || "")}`,
      },
    ],
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OPENAI_TIMEOUT_MS);
  try {
    const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    OPENAI_LAST_RUNTIME.statusCode = Number(res.status || 0) || null;
    if (!res.ok) {
      let errBody = "";
      try {
        errBody = (await res.text()).slice(0, 240);
      } catch {
        errBody = "";
      }
      const reason = `openai_http_${res.status}${errBody ? `:${errBody}` : ""}`;
      OPENAI_LAST_RUNTIME.errorAt = nowIso();
      OPENAI_LAST_RUNTIME.lastError = reason;
      OPENAI_LAST_RUNTIME.durationMs = Date.now() - startedAt;
      return { ok: false, error: reason };
    }
    const data = await res.json();
    const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (typeof text === "string" && text.trim()) {
      OPENAI_LAST_RUNTIME.successAt = nowIso();
      OPENAI_LAST_RUNTIME.lastError = null;
      OPENAI_LAST_RUNTIME.durationMs = Date.now() - startedAt;
      return { ok: true, text: text.trim() };
    }
    OPENAI_LAST_RUNTIME.errorAt = nowIso();
    OPENAI_LAST_RUNTIME.lastError = "empty_openai_content";
    OPENAI_LAST_RUNTIME.durationMs = Date.now() - startedAt;
    return { ok: false, error: "empty_openai_content" };
  } catch (err) {
    const reason = err && err.name === "AbortError"
      ? `openai_timeout_${OPENAI_TIMEOUT_MS}ms`
      : `openai_network_error:${String((err && err.message) || err || "unknown").slice(0, 220)}`;
    OPENAI_LAST_RUNTIME.errorAt = nowIso();
    OPENAI_LAST_RUNTIME.lastError = reason;
    OPENAI_LAST_RUNTIME.durationMs = Date.now() - startedAt;
    return { ok: false, error: reason };
  } finally {
    clearTimeout(timer);
  }
}

async function buildSmartChatReply({ message, language, city, constraints, recommendation, conversationHistory }) {
  const top = (recommendation.options || []).slice(0, 3);
  const stage = inferConversationStage(message, detectIntentHint(message));
  const ambiguous = isAmbiguousIntentMessage(message, constraints);
  const choice = recommendation && recommendation.crossXChoice ? recommendation.crossXChoice : null;
  const constraintSummary = summarizeConstraintsForReply(language, constraints);
  const detailText = (o, langCode) => {
    const detail = [];
    if (o.placeDisplay || o.placeName) detail.push(pickLang(langCode, `餐厅/地点=${o.placeDisplay || o.placeName}`, `place=${o.placeDisplay || o.placeName}`, `店舗/地点=${o.placeDisplay || o.placeName}`, `식당/장소=${o.placeDisplay || o.placeName}`));
    if (o.hotelDisplay || o.hotelName) detail.push(pickLang(langCode, `酒店=${o.hotelDisplay || o.hotelName}`, `hotel=${o.hotelDisplay || o.hotelName}`, `ホテル=${o.hotelDisplay || o.hotelName}`, `호텔=${o.hotelDisplay || o.hotelName}`));
    if (o.transportMode) detail.push(pickLang(langCode, `交通=${o.transportMode}`, `transport=${o.transportMode}`, `交通=${o.transportMode}`, `교통=${o.transportMode}`));
    if (o.costRange) detail.push(pickLang(langCode, `费用=${o.costRange}`, `cost=${o.costRange}`, `費用=${o.costRange}`, `비용=${o.costRange}`));
    if (o.openHours) detail.push(pickLang(langCode, `营业时间=${o.openHours}`, `hours=${o.openHours}`, `営業時間=${o.openHours}`, `운영시간=${o.openHours}`));
    if (o.touristFriendlyScore) {
      detail.push(pickLang(langCode, `友好度=${o.touristFriendlyScore}/5`, `friendly=${o.touristFriendlyScore}/5`, `旅行者フレンドリー=${o.touristFriendlyScore}/5`, `관광객 친화=${o.touristFriendlyScore}/5`));
    }
    return detail.join("，");
  };
  const linesZh = top
    .map((o, idx) => `${idx + 1}. ${o.title}（${o.grade || recommendationGrade(o.score)}）: ${detailText(o, "ZH")}；${(o.analysis && o.analysis[0]) || (o.comments && o.comments[0]) || "可执行路径"}`)
    .join("\n");
  const linesEn = top
    .map((o, idx) => `${idx + 1}. ${o.title} (${o.grade || recommendationGrade(o.score)}): ${detailText(o, "EN")}; ${(o.analysis && o.analysis[0]) || (o.comments && o.comments[0]) || "Executable path"}`)
    .join("\n");
  const linesJa = top
    .map((o, idx) => `${idx + 1}. ${o.title}（${o.grade || recommendationGrade(o.score)}）: ${detailText(o, "JA")}；${(o.analysis && o.analysis[0]) || (o.comments && o.comments[0]) || "実行可能なルート"}`)
    .join("\n");
  const linesKo = top
    .map((o, idx) => `${idx + 1}. ${o.title} (${o.grade || recommendationGrade(o.score)}): ${detailText(o, "KO")}; ${(o.analysis && o.analysis[0]) || (o.comments && o.comments[0]) || "실행 가능한 경로"}`)
    .join("\n");
  const choiceTitle = choice ? choice.title : (top[0] ? top[0].title : "-");
  const choiceReason = choice
    ? choice.reason
    : pickLang(language, "该方案与当前约束匹配度最高且执行链路最短。", "This option best matches current constraints with shortest executable chain.", "現条件に最も適合し、実行チェーンが最短です。", "현재 제약에 가장 잘 맞고 실행 체인이 가장 짧습니다.");
  const actionHint = pickLang(
    language,
    stage === "restaurant_selection"
      ? "下一步按钮建议：确认并开始执行 / 一键打车 / 查看菜单。"
      : stage === "mobility_selection"
        ? "下一步按钮建议：确认并开始执行 / 一键叫车 / 锁定路线。"
        : stage === "hotel_selection"
          ? "下一步按钮建议：确认并开始执行 / 加入酒店行程。"
          : "下一步按钮建议：补充偏好后再执行。",
    stage === "restaurant_selection"
      ? "Suggested next buttons: Confirm & Execute / One-Tap Taxi / View Menu."
      : stage === "mobility_selection"
        ? "Suggested next buttons: Confirm & Execute / One-Tap Ride / Lock Route."
        : stage === "hotel_selection"
          ? "Suggested next buttons: Confirm & Execute / Add to Itinerary."
          : "Suggested next button: Add preferences before execution.",
    stage === "restaurant_selection"
      ? "次のボタン: 確認して実行 / ワンタップ配車 / メニューを見る。"
      : stage === "mobility_selection"
        ? "次のボタン: 確認して実行 / ワンタップ配車 / ルート確定。"
        : stage === "hotel_selection"
          ? "次のボタン: 確認して実行 / ホテル行程に追加。"
          : "次のボタン: 条件を追加してから実行。",
    stage === "restaurant_selection"
      ? "다음 버튼: 확인 후 실행 / 원탭 택시 / 메뉴 보기."
      : stage === "mobility_selection"
        ? "다음 버튼: 확인 후 실행 / 원탭 호출 / 경로 확정."
        : stage === "hotel_selection"
          ? "다음 버튼: 확인 후 실행 / 호텔 일정 추가."
          : "다음 버튼: 조건 추가 후 실행.",
  );
  const clarifyBlock = ambiguous
    ? pickLang(
      language,
      "❓ 为了更精准：请补充 1) 停留天数 2) 偏好（历史文化/现代都市/亲子）3) 预算范围。",
      "❓ To optimize the plan, please add: 1) stay length 2) preference (history/culture vs modern/city) 3) budget range.",
      "❓ 精度向上のため、1) 滞在日数 2) 好み（歴史文化/都市）3) 予算 を教えてください。",
      "❓ 더 정확한 추천을 위해 1) 체류 일수 2) 선호(역사/도시) 3) 예산 범위를 알려주세요.",
    )
    : "";
  const fallback = pickLang(
    language,
    `🧭 摘要：我已理解你的需求，并按可执行闭环给出推荐。\n\n⭐ CrossX Choice：${choiceTitle}\n为什么选它：${choiceReason}\n\n📍 方案卡（含中文名+英文别名，方便问路/打车）：\n${linesZh}\n\n⚠️ 必读：热门门店建议先预订；到店前确认英文菜单与支付方式（Alipay/WeChat/代付）。\n➡️ 下一步：${actionHint}\n${clarifyBlock}`,
    `🧭 Summary: I understood your request and optimized for executable closure.\n\n⭐ CrossX Choice: ${choiceTitle}\nWhy this fits: ${choiceReason}\n\n📍 Option cards (with Chinese names + English aliases for taxi/navigation):\n${linesEn}\n\n⚠️ Read first: reserve popular places early; confirm English menu and payment friendliness (Alipay/WeChat/delegated card).\n➡️ Next step: ${actionHint}\n${clarifyBlock}`,
    `🧭 要約: ご要望を理解し、実行可能なクローズドループで最適化しました。\n\n⭐ CrossX Choice: ${choiceTitle}\n選定理由: ${choiceReason}\n\n📍 オプションカード（中国語名+英語別名つき）:\n${linesJa}\n\n⚠️ 注意: 人気店は事前予約推奨。英語メニューと決済手段（Alipay/WeChat/委任決済）を確認。\n➡️ 次の一手: ${actionHint}\n${clarifyBlock}`,
    `🧭 요약: 요청을 이해했고 실행 가능한 클로즈드 루프로 최적화했습니다.\n\n⭐ CrossX Choice: ${choiceTitle}\n선정 이유: ${choiceReason}\n\n📍 옵션 카드 (중국어 이름 + 영어 별칭 포함):\n${linesKo}\n\n⚠️ 주의: 인기 매장은 사전 예약 권장. 영어 메뉴/결제 방식(Alipay/WeChat/위임결제) 확인 필요.\n➡️ 다음 단계: ${actionHint}\n${clarifyBlock}`,
  );
  // Provider priority: RAG (knowledge queries) → claude-subprocess → Claude HTTP → OpenAI → hardcoded fallback
  let replySource = "fallback";
  let replyText = null;
  let replyModel = "builtin-fallback";
  let fallbackReason = null;
  let replyStructured = null;

  // ── AI-native structured planning (runs FIRST for any trip/itinerary query) ──
  const ragIntentType = ragEngine.classifyIntent(message);
  const isPlanningQuery = /[住行餐预算酒店机场天计划行程三餐早中晚翻译交通出行]/i.test(message)
    || /\d+\s*(天|日|night|day)/i.test(message)
    || /预算|万元|元预算|budget/i.test(message)
    || ragIntentType === "action" || ragIntentType === "both";
  if (isPlanningQuery) {
    const openaiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY;
    if (openaiKey) {
      try {
        const sResult = await generateCrossXResponse({
          message, language, city, constraints, conversationHistory,
          apiKey: openaiKey,
        });
        if (sResult.ok && sResult.structured) {
          const s = sResult.structured;
          if (s.response_type === "clarify") {
            replyText = s.spoken_text || fallback;
          } else if (s.response_type === "options_card" && (s.card_data || (Array.isArray(s.options) && s.options.length))) {
            replyText = JSON.stringify(s);
          }
          if (replyText) {
            replySource = "openai-structured";
            replyModel = OPENAI_MODEL;
            replyStructured = s;
            // Return immediately — skip all other paths
            return {
              source: replySource,
              reply: replyText,
              model: replyModel,
              stage,
              clarifyNeeded: s.response_type === "clarify",
              fallbackReason: null,
              structured: replyStructured,
            };
          }
        }
      } catch (sErr) {
        console.warn("[AI-native] generateCrossXResponse error:", sErr.message);
      }
    }
  }

  // 0. RAG pre-check: if this is a knowledge/policy question, retrieve from knowledge base first
  if (ragIntentType === "rag" || ragIntentType === "both") {
    const openaiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY;
    if (openaiKey) {
      try {
        const ragResult = await ragEngine.retrieveAndGenerate({
          query: message,
          audience: "b2c",
          language,
          openaiApiKey: openaiKey,
          topK: 4,
        });
        if (ragResult.ragUsed && ragResult.answer) {
          // Append citation footer if sources exist
          let ragAnswer = ragResult.answer;
          if (ragResult.citations && ragResult.citations.length > 0) {
            const citationLine = ragResult.citations.map((c) => `[${c.docId}]`).join(" ");
            ragAnswer += `\n\n📚 来源参考 (Source): ${citationLine}`;
          }
          // For "both" intent (has action component too), prepend RAG answer and continue to LLM
          if (ragIntentType === "both") {
            replyText = ragAnswer;
            replySource = "rag";
            replyModel = "rag-engine";
            // Still continue to LLM for the action part if RAG is insufficient
          } else {
            // Pure knowledge query: return RAG answer directly
            return {
              source: "rag",
              reply: ragAnswer,
              model: "rag-engine",
              stage,
              clarifyNeeded: ambiguous,
              fallbackReason: null,
              citations: ragResult.citations || [],
            };
          }
        }
      } catch (ragErr) {
        console.warn("[RAG] Error during pre-check:", ragErr.message);
      }
    }
  }

  // 2. Try Claude subprocess (claude -p, uses local CLI auth — bypasses proxy restrictions)
  if (!replyText) {
    const subResult = await callClaudeSubprocess({ message, language, city, constraints, recommendation, conversationHistory });
    if (subResult && subResult.ok) {
      replySource = "claude";
      replyText = subResult.text;
      replyModel = subResult.model || "claude-subprocess";
    } else {
      fallbackReason = subResult && subResult.error ? subResult.error : null;
      // 3. Try Claude HTTP API (may fail if key is proxy-restricted)
      const claudeResult = await callClaudeChatReply({ message, language, city, constraints, recommendation, conversationHistory });
      if (claudeResult && claudeResult.ok) {
        replySource = "claude";
        replyText = claudeResult.text;
        replyModel = claudeResult.model || ANTHROPIC_MODEL;
        fallbackReason = null;
      } else {
        fallbackReason = fallbackReason || (claudeResult && !claudeResult.ok ? claudeResult.error : null);
        // 4. Try OpenAI freeform (secondary — if structured call above didn't produce result)
        if (!replyText) {
          const openaiResult = await callOpenAIChatReply({ message, language, city, constraints, recommendation, conversationHistory });
          if (openaiResult && openaiResult.ok) {
            replySource = "openai";
            replyText = openaiResult.text;
            replyModel = OPENAI_MODEL;
            fallbackReason = null;
          } else {
            fallbackReason = fallbackReason || (openaiResult && !openaiResult.ok ? openaiResult.error : null);
          }
        }
      }
    }
  }

  return {
    source: replySource,
    reply: replyText || fallback,
    model: replyModel,
    stage,
    clarifyNeeded: ambiguous,
    fallbackReason,
    ...(replyStructured ? { structured: replyStructured } : {}),
  };
}

// ── Agentic Workflow Engine (ReAct / Plan-and-Execute) ─────────────────────
//
// Phases:
//   1. Constraint Completeness → clarify if missing critical info
//   2. Task Decomposition      → break request into ordered sub-tasks
//   3. Cost Aggregation        → sum estimated costs
//   4. Budget Validation       → adjust if over budget
//   5. Structured JSON Output  → clean itinerary + itemized costs for UI

const AGENT_REQUIRED_FIELDS = {
  city:       { label: { ZH: "目的地城市", EN: "destination city", JA: "目的地城市", KO: "목적지 도시" } },
  duration:   { label: { ZH: "行程天数", EN: "trip duration (days)", JA: "旅行日数", KO: "여행 일수" } },
  budget:     { label: { ZH: "总预算（人民币）", EN: "total budget (CNY)", JA: "総予算（人民元）", KO: "총 예산 (CNY)" } },
  party_size: { label: { ZH: "出行人数", EN: "party size", JA: "人数", KO: "인원 수" } },
};

function extractAgentConstraints(message, constraints) {
  const result = {
    city: null, duration: null, budget: null, party_size: null, service_types: [],
  };
  // City
  result.city = constraints.city || constraints.destination || null;
  if (!result.city) {
    const m = message.match(/(?:in|去|在|到)\s*([A-Z][a-z]+|[\u4e00-\u9fa5]{2,6})(?:\s|,|，|$)/);
    if (m) result.city = m[1];
  }
  // Duration
  result.duration = constraints.duration || constraints.days || null;
  if (!result.duration) {
    const m = message.match(/(\d{1,2})\s*(?:days?|天|泊|nights?|晚)/i);
    if (m) result.duration = parseInt(m[1], 10);
  }
  // Budget
  result.budget = constraints.budget || null;
  if (!result.budget) {
    const m = message.match(/(\d[\d,.]*)\s*(?:RMB|CNY|元|rmb|yuan|k\b)/i);
    if (m) {
      let num = parseFloat(m[1].replace(/,/g, ""));
      if (/k\b/i.test(m[0])) num *= 1000;
      result.budget = num;
    }
  } else if (typeof result.budget === "string") {
    const num = parseFloat(result.budget.replace(/[^\d.]/g, ""));
    if (!isNaN(num)) result.budget = num;
  }
  // Party size
  result.party_size = constraints.party_size || constraints.guestNum || constraints.group_size || null;
  if (!result.party_size) {
    const m = message.match(/(\d{1,2})\s*(?:people|person|人|位|名|pax|adults?)/i);
    if (m) result.party_size = parseInt(m[1], 10);
  }
  // Service types (what does the user need?)
  const svcMap = {
    hotel:     /hotel|酒店|住宿|stay|accommodation/i,
    food:      /food|餐|eat|restaurant|dining|meal|lunch|dinner|breakfast/i,
    transport: /transport|交通|taxi|cab|滴滴|地铁|metro|train|flight|机票|高铁/i,
    activity:  /activity|景点|tour|museum|scenic|活动|游览|参观/i,
    translation: /translation|翻译|interpreter|language/i,
  };
  for (const [svc, re] of Object.entries(svcMap)) {
    if (re.test(message)) result.service_types.push(svc);
  }
  if (!result.service_types.length) result.service_types = ["hotel", "food", "transport"];
  return result;
}

function buildClarifyQuestion(missingFields, lang) {
  const labels = missingFields.map((f) => {
    const l = AGENT_REQUIRED_FIELDS[f] && AGENT_REQUIRED_FIELDS[f].label;
    return l ? (l[lang] || l.EN) : f;
  });
  if (lang === "ZH") return `为了给你定制最准确的行程，请补充以下信息：${labels.map((l, i) => `${i + 1}) ${l}`).join("  ")}`;
  if (lang === "JA") return `最適なプランを作るために、以下の情報をお知らせください：${labels.map((l, i) => `${i + 1}) ${l}`).join("  ")}`;
  if (lang === "KO") return `최적의 일정을 위해 다음 정보를 알려주세요: ${labels.map((l, i) => `${i + 1}) ${l}`).join("  ")}`;
  return `To create your perfect itinerary, please share: ${labels.map((l, i) => `${i + 1}) ${l}`).join("  ")}`;
}

function runAgentWorkflow({ message, language, city, constraints, conversationHistory }) {
  return new Promise((resolve) => {
    const lang = normalizeLang(language);
    const agentConstraints = extractAgentConstraints(message, { ...constraints, city });

    // Phase 1: Constraint Completeness Check
    const criticalFields = ["city", "duration", "budget"];
    const missing = criticalFields.filter((f) => !agentConstraints[f]);
    if (missing.length > 0) {
      return resolve({
        type: "clarify",
        clarifyQuestion: buildClarifyQuestion(missing, lang),
        missingFields: missing,
        extractedConstraints: agentConstraints,
      });
    }

    // Phase 2+3+4: LLM generates structured plan
    const partySize = agentConstraints.party_size || 1;
    const budgetPerPerson = Math.round((agentConstraints.budget || 10000) / partySize);
    const knowledgeContext = buildChinaTravelKnowledge();
    const historyLines = Array.isArray(conversationHistory) && conversationHistory.length
      ? conversationHistory.slice(-4).map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`).join("\n")
      : "";

    const jsonSchema = `{
  "type": "plan",
  "itinerary": [
    {
      "day": 1,
      "theme": "string",
      "tasks": [
        {
          "type": "hotel|transport|food|activity|translation",
          "title": "string",
          "description": "string",
          "chineseName": "string",
          "estimatedCost": 500,
          "currency": "CNY",
          "provider": "携程/美团/滴滴/etc",
          "bookingTip": "string",
          "paymentNote": "Alipay/WeChat/card delegation"
        }
      ]
    }
  ],
  "itemizedCosts": [
    { "category": "hotel", "subtotal": 2000, "note": "string" }
  ],
  "totalCost": 8500,
  "budgetStatus": "within|over|under",
  "budgetOverage": 0,
  "reasoning": "one paragraph",
  "adjustments": ["list of changes made to fit budget, empty if not needed"],
  "nextActions": ["Book hotel via Ctrip", "Download Didi app"]
}`;

    const prompt = [
      `You are CrossX travel planning agent. Output ONLY valid JSON — no markdown, no extra text, no code fences.`,
      `Reply language: ${lang} (use ${lang} for all string values).`,
      ``,
      `## Platform Knowledge`,
      knowledgeContext,
      historyLines ? `\n## Conversation History\n${historyLines}\n` : "",
      `## User Request`,
      `Message: ${message}`,
      `City: ${agentConstraints.city}`,
      `Duration: ${agentConstraints.duration} days`,
      `Total budget: ${agentConstraints.budget} CNY (${partySize} people, ~${budgetPerPerson} CNY/person)`,
      `Party size: ${partySize}`,
      `Services needed: ${agentConstraints.service_types.join(", ")}`,
      ``,
      `## Instructions`,
      `1. Create a ${agentConstraints.duration}-day itinerary with specific, bookable tasks.`,
      `2. For each task include estimatedCost in CNY.`,
      `3. Sum all costs into totalCost. If totalCost > ${agentConstraints.budget}, ADJUST choices (cheaper hotel/transport) and document in "adjustments".`,
      `4. Set budgetStatus: "within" if totalCost <= ${agentConstraints.budget}, "over" if exceeds, "under" if significantly below.`,
      `5. Include realistic China-specific booking tips (Ctrip, Meituan, Didi, payment notes for foreigners).`,
      `6. Output ONLY the JSON object matching this schema:`,
      jsonSchema,
    ].filter(Boolean).join("\n");

    // Strip claude session env vars
    const subEnv = Object.assign({}, process.env);
    delete subEnv.CLAUDECODE;
    delete subEnv.CLAUDE_CODE_ENTRYPOINT;

    let stdout = "";
    let stderr = "";
    let finished = false;

    const proc = spawn(
      CLAUDE_BIN,
      ["-p", "--dangerously-skip-permissions", "--no-session-persistence", "--output-format", "text"],
      { env: subEnv, stdio: ["pipe", "pipe", "pipe"] },
    );

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        try { proc.kill("SIGTERM"); } catch {}
        resolve({ type: "error", error: "agent_timeout" });
      }
    }, 30000);

    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });

    proc.on("close", (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      const raw = stdout.trim();
      if (!raw) return resolve({ type: "error", error: `subprocess_empty:${stderr.slice(0, 120)}` });
      // Strip markdown code fences if LLM wrapped it
      const jsonStr = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
      try {
        const plan = JSON.parse(jsonStr);
        // Budget re-validation (in case LLM miscalculated)
        if (plan.itemizedCosts && Array.isArray(plan.itemizedCosts)) {
          const total = plan.itemizedCosts.reduce((s, c) => s + (Number(c.subtotal) || 0), 0);
          if (total > 0) {
            plan.totalCost = total;
            plan.budgetStatus = total > (agentConstraints.budget || Infinity)
              ? "over"
              : total < (agentConstraints.budget || 0) * 0.75
                ? "under"
                : "within";
            plan.budgetOverage = Math.max(0, total - (agentConstraints.budget || 0));
          }
        }
        plan.extractedConstraints = agentConstraints;
        resolve(plan);
      } catch {
        // JSON parse failed — return raw text as a fallback plan
        resolve({ type: "plan_text", text: raw, extractedConstraints: agentConstraints });
      }
    });

    proc.on("error", (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ type: "error", error: err.message });
    });

    try {
      proc.stdin.write(prompt, "utf8");
      proc.stdin.end();
    } catch {}
  });
}

function pushMetricEvent(event) {
  db.metricEvents.push({
    id: `evt_${Date.now()}_${db.metricEvents.length + 1}`,
    at: nowIso(),
    ...event,
  });
  if (db.metricEvents.length > 2000) {
    db.metricEvents = db.metricEvents.slice(-2000);
  }
}

function cleanIdempotencyStore() {
  const now = Date.now();
  const ttlMs = 1000 * 60 * 30;
  for (const [key, value] of Object.entries(db.idempotency || {})) {
    if (!value || !value.at || now - value.at > ttlMs) {
      delete db.idempotency[key];
    }
  }
}

function readIdempotent(req, pathname) {
  const key = req.headers["x-idempotency-key"];
  if (!key) return null;
  const scope = `${req.method}:${pathname}:${String(key)}`;
  const saved = db.idempotency[scope];
  return saved ? saved.payload : null;
}

function writeIdempotent(req, pathname, payload) {
  const key = req.headers["x-idempotency-key"];
  if (!key) return;
  const scope = `${req.method}:${pathname}:${String(key)}`;
  db.idempotency[scope] = { at: Date.now(), payload };
}

function defaultSlaMsForOp(op) {
  const map = {
    Query: 2000,
    Status: 1500,
    Book: 2500,
    Pay: 3000,
    Cancel: 2500,
  };
  return map[op] || 2000;
}

function getMcpContract(source) {
  if (!source) return null;
  const c = db.mcpContracts && db.mcpContracts[source];
  if (!c || typeof c !== "object") return null;
  return c;
}

function buildMcpContractsSummary() {
  const contracts = Object.values(db.mcpContracts || {});
  const calls = db.mcpCalls || [];
  let boundCalls = 0;
  let externalCalls = 0;
  for (const call of calls) {
    const src = call && call.response && call.response.data && call.response.data.source;
    const contract = getMcpContract(src);
    if (!contract) continue;
    boundCalls += 1;
    if (contract.external) externalCalls += 1;
  }
  return {
    totalContracts: contracts.length,
    enforcedContracts: contracts.filter((c) => c.enforced).length,
    boundCalls,
    externalCalls,
    contracts,
  };
}

function getRailCompliance(railId) {
  const rid = normalizeRail(railId);
  const rails = (db.paymentCompliance && db.paymentCompliance.rails) || {};
  return rails[rid] || { certified: false, kycPassed: false, pciDss: false, riskTier: "high", enabled: false };
}

function canUseRail(railId) {
  const policy = (db.paymentCompliance && db.paymentCompliance.policy) || {};
  const compliance = getRailCompliance(railId);
  if (compliance.enabled !== true) {
    return { ok: false, code: "rail_disabled", reason: "Rail is disabled by compliance policy." };
  }
  if (policy.blockUncertifiedRails !== false && compliance.certified !== true) {
    return { ok: false, code: "rail_not_certified", reason: "Rail is not certified." };
  }
  if (policy.requireFraudScreen && compliance.kycPassed !== true) {
    return { ok: false, code: "rail_kyc_missing", reason: "Rail KYC check not passed." };
  }
  return { ok: true, compliance };
}

function buildPaymentComplianceSummary() {
  const rails = db.paymentCompliance && db.paymentCompliance.rails ? db.paymentCompliance.rails : {};
  const policy = (db.paymentCompliance && db.paymentCompliance.policy) || {};
  return {
    policy,
    rails,
  };
}

function ensureOrderPricing(order) {
  if (!order || typeof order !== "object") return false;
  if (order.pricing && typeof order.pricing === "object") return false;
  const currency = order.currency || "CNY";
  const quote = buildQuote({
    intentType: order.type || "eat",
    currency,
    plusActive: false,
    vipFastLane: false,
  });
  const finalPrice = Number(order.price || quote.finalPrice);
  const baseRate = Number(quote.markupRate || 0.18);
  const netPrice = roundMoney(baseRate > 0 ? finalPrice / (1 + baseRate) : finalPrice);
  const markup = roundMoney(finalPrice - netPrice);
  order.pricing = {
    ...quote,
    currency,
    finalPrice,
    netPrice,
    markup,
  };
  return true;
}

function migrateLoadedData() {
  let mutated = false;
  for (const order of Object.values(db.orders || {})) {
    if (ensureOrderPricing(order)) mutated = true;
    if (!Array.isArray(order.lifecycle)) {
      order.lifecycle = [
        {
          state: "created",
          label: "Order created",
          at: order.createdAt || nowIso(),
          note: "Created by Cross X workflow.",
        },
        {
          state: order.status === "canceled" ? "refunded" : "completed",
          label: order.status === "canceled" ? "Refund completed" : "Order completed",
          at: order.updatedAt || order.createdAt || nowIso(),
          note: order.status === "canceled" ? "Refund issued." : "Proof delivered.",
        },
      ];
      mutated = true;
    }
    if (!order.refundPolicy) {
      order.refundPolicy = {
        freeCancelWindowMin: 10,
        estimatedArrival: "T+1 to T+3",
        supportRequired: false,
      };
      mutated = true;
    }
    if (!Array.isArray(order.proofItems)) {
      order.proofItems = [
        {
          id: `${order.id}_proof_order`,
          type: "order_receipt",
          title: "Order receipt",
          hash: `h_${order.id}_order`,
          generatedAt: order.createdAt || nowIso(),
          content: order.proof && order.proof.orderNo ? order.proof.orderNo : order.id,
        },
      ];
      mutated = true;
    }
  }
  for (const call of db.mcpCalls || []) {
    if (!call.response || typeof call.response !== "object") {
      call.response = { op: call.op || "Status", ok: true, status: "success", code: "ok", latency: 0, data: {} };
      mutated = true;
    }
    const response = call.response;
    if (typeof response.slaMs !== "number") {
      response.slaMs = defaultSlaMsForOp(call.op);
      mutated = true;
    }
    if (typeof response.slaMet !== "boolean") {
      response.slaMet = Number(response.latency || 0) <= Number(response.slaMs || defaultSlaMsForOp(call.op));
      mutated = true;
    }
    if (!response.data || typeof response.data !== "object") {
      response.data = {};
      mutated = true;
    }
    if (typeof response.data.provider !== "string") {
      response.data.provider = "Legacy Provider";
      mutated = true;
    }
    if (typeof response.data.source !== "string") {
      response.data.source = "legacy";
      mutated = true;
    }
    if (typeof response.data.sourceTs !== "string") {
      response.data.sourceTs = call.at || nowIso();
      mutated = true;
    }
  }
  for (const task of Object.values(db.tasks || {})) {
    if (!task.pricing && task.plan && task.plan.confirm && task.plan.confirm.pricing) {
      task.pricing = task.plan.confirm.pricing;
      mutated = true;
    }
    if (!task.paymentRailSnapshot) {
      task.paymentRailSnapshot = resolveUserPaymentRail(task.userId || "demo");
      if (task.plan && task.plan.confirm) {
        task.plan.confirm.paymentRail = task.paymentRailSnapshot;
      }
      mutated = true;
    }
    if (task.plan && task.plan.constraints) {
      if (!task.plan.constraints.mcpContracts) {
        task.plan.constraints.mcpContracts = JSON.parse(JSON.stringify(db.mcpContracts || {}));
        mutated = true;
      }
      if (!task.plan.constraints.mcpPolicy) {
        task.plan.constraints.mcpPolicy = { enforceSla: false, simulateBreachRate: 0 };
        mutated = true;
      } else if (typeof task.plan.constraints.mcpPolicy.simulateBreachRate !== "number") {
        task.plan.constraints.mcpPolicy.simulateBreachRate = 0;
        mutated = true;
      }
    }
    if (!Array.isArray(task.steps) || !task.steps.length) {
      task.steps = (task.plan && task.plan.steps ? task.plan.steps : []).map((step) => ({
        ...step,
        status: step.status || "queued",
        etaSec: Number(step.etaSec || 20),
        retryable: step.retryable !== false,
        fallbackPolicy: step.fallbackPolicy || "none",
        inputPreview: step.inputPreview || "",
        outputPreview: step.outputPreview || "",
      }));
      mutated = true;
    } else {
      task.steps = task.steps.map((step) => ({
        ...step,
        status: step.status || "queued",
        etaSec: Number(step.etaSec || 20),
        retryable: step.retryable !== false,
        fallbackPolicy: step.fallbackPolicy || "none",
        inputPreview: step.inputPreview || "",
        outputPreview: step.outputPreview || "",
      }));
    }
    if (task.plan && Array.isArray(task.plan.steps)) {
      task.plan.steps = task.plan.steps.map((step) => ({
        ...step,
        status: step.status || "queued",
        etaSec: Number(step.etaSec || 20),
        retryable: step.retryable !== false,
        fallbackPolicy: step.fallbackPolicy || "none",
        inputPreview: step.inputPreview || "",
        outputPreview: step.outputPreview || "",
      }));
      mutated = true;
    }
    const hadAgentMeta = Boolean(task.sessionState && task.expertRoute);
    syncTaskAgentMeta(task);
    if (!hadAgentMeta) mutated = true;
    if (!task.lifecycle || !Array.isArray(task.lifecycle)) {
      task.lifecycle = [
        {
          state: "created",
          label: "Task created",
          at: task.createdAt || nowIso(),
          note: "Intent received.",
        },
      ];
      mutated = true;
    }
    if (task.tripId && !db.tripPlans[task.tripId]) {
      delete task.tripId;
      mutated = true;
    }
  }
  for (const plan of Object.values(db.tripPlans || {})) {
    if (!Array.isArray(plan.taskIds)) {
      plan.taskIds = [];
      mutated = true;
    }
    if (!Array.isArray(plan.lifecycle)) {
      plan.lifecycle = [
        {
          state: "created",
          label: "Trip plan created",
          at: plan.createdAt || nowIso(),
          note: "Trip lifecycle started.",
        },
      ];
      mutated = true;
    }
    const before = plan.taskIds.length;
    plan.taskIds = plan.taskIds.filter((taskId) => Boolean(db.tasks[taskId]));
    if (before !== plan.taskIds.length) {
      mutated = true;
    }
    for (const taskId of plan.taskIds) {
      const task = db.tasks[taskId];
      if (task && task.tripId !== plan.id) {
        task.tripId = plan.id;
        mutated = true;
      }
    }
    refreshTripPlan(plan);
  }
  if (runSettlementBatch().length) {
    mutated = true;
  }
  if (syncProviderLedgerFromSettlements().length) {
    mutated = true;
  }
  return mutated;
}

function stablePercent(input) {
  const text = String(input || "");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % 100;
}

function evaluateFlagsForUser(userId) {
  const uid = userId || "demo";
  const evaluated = {};
  for (const [flagName, conf] of Object.entries(db.featureFlags || {})) {
    const rollout = Number(conf.rollout || 0);
    const enabled = conf.enabled === true;
    const bucket = stablePercent(`${uid}:${flagName}`);
    const active = enabled && bucket < rollout;
    evaluated[flagName] = {
      enabled,
      rollout,
      bucket,
      active,
    };
  }
  return evaluated;
}

function buildKpiSummary() {
  const tasks = Object.values(db.tasks);
  const completed = tasks.filter((t) => t.status === "completed").length;
  const failed = tasks.filter((t) => t.status === "failed").length;
  const canceled = tasks.filter((t) => t.status === "canceled").length;
  const totalOrders = Object.keys(db.orders).length;
  const completedWithPayment = tasks.filter((t) => t.status === "completed" && t.payments && t.payments.length > 0).length;
  const closedLoopRate = tasks.length ? Number((completedWithPayment / tasks.length).toFixed(3)) : 0;

  const avgStepLatency = (() => {
    const latencies = tasks.flatMap((t) => (t.steps || []).map((s) => Number(s.latency || 0))).filter((v) => v > 0);
    if (!latencies.length) return 0;
    return Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
  })();

  function percentile(values, p) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length) - 1));
    return sorted[idx];
  }

  const firstResponseDurationsMin = db.supportTickets
    .filter((t) => t.acceptedAt)
    .map((t) => Math.max(0, Math.round((new Date(t.acceptedAt).getTime() - new Date(t.createdAt).getTime()) / 60000)));
  const resolveDurationsMin = db.supportTickets
    .filter((t) => t.resolvedAt)
    .map((t) => Math.max(0, Math.round((new Date(t.resolvedAt).getTime() - new Date(t.createdAt).getTime()) / 60000)));

  return {
    northStar: {
      name: "One-Sentence Closed Loop Completion Rate",
      value: closedLoopRate,
      numerator: completedWithPayment,
      denominator: tasks.length,
    },
    totals: {
      tasks: tasks.length,
      completed,
      failed,
      canceled,
      orders: totalOrders,
      settlements: db.settlements.length,
      reconciliationRuns: db.reconciliationRuns.length,
      auditLogs: db.auditLogs.length,
      mcpCalls: db.mcpCalls.length,
      metricEvents: db.metricEvents.length,
      supportTickets: db.supportTickets.length,
    },
    quality: {
      avgStepLatencyMs: avgStepLatency,
      firstResponseMinP50: percentile(firstResponseDurationsMin, 50),
      firstResponseMinP90: percentile(firstResponseDurationsMin, 90),
      resolutionMinP50: percentile(resolveDurationsMin, 50),
      resolutionMinP90: percentile(resolveDurationsMin, 90),
    },
  };
}

function buildFunnelSummary() {
  const tasks = Object.values(db.tasks);
  const stage = {
    intentSubmitted: db.metricEvents.filter((e) => e.kind === "intent_submitted").length,
    planned: tasks.length,
    confirmed: tasks.filter((t) => t.status === "confirmed" || t.status === "executing" || t.status === "completed").length,
    executed: tasks.filter((t) => t.status === "completed" || t.status === "failed" || t.status === "canceled").length,
    paid: tasks.filter((t) => (t.payments || []).some((p) => p.status === "captured")).length,
    delivered: tasks.filter((t) => Boolean(t.orderId && db.orders[t.orderId] && db.orders[t.orderId].proof)).length,
    handoff: tasks.filter((t) => t.handoff && t.handoff.status === "open").length,
    handoffResolved: tasks.filter((t) => t.handoff && t.handoff.status === "resolved").length,
  };
  return stage;
}

function hasSettlementForOrder(orderId) {
  return (db.settlements || []).some((s) => s.orderId === orderId);
}

function createSettlementRecord(order) {
  if (!order.pricing) ensureOrderPricing(order);
  const pricing = order.pricing || null;
  const gross = Number(order.price || 0);
  const net = Number((pricing && pricing.netPrice) || 0);
  const markup = Number((pricing && pricing.markup) || 0);
  const refund = Number((order.refund && order.refund.amount) || 0);
  const settledGross = Math.max(0, roundMoney(gross - refund));
  const settledNet = Math.max(0, roundMoney(net - refund));
  const settledMarkup = Math.max(0, roundMoney(markup));
  return {
    id: `settle_${Date.now().toString().slice(-8)}_${db.settlements.length + 1}`,
    orderId: order.id,
    taskId: order.taskId,
    currency: order.currency || "CNY",
    gross,
    net,
    markup,
    refund,
    settledGross,
    settledNet,
    settledMarkup,
    status: "processed",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function runSettlementBatch() {
  const orders = Object.values(db.orders || {});
  const created = [];
  for (const order of orders) {
    if (!order || !order.id) continue;
    if (hasSettlementForOrder(order.id)) continue;
    if (!(order.status === "confirmed" || order.status === "completed" || order.status === "canceled" || order.status === "refunded")) continue;
    const rec = createSettlementRecord(order);
    db.settlements.push(rec);
    created.push(rec);
  }
  if (db.settlements.length > 1000) {
    db.settlements = db.settlements.slice(-1000);
  }
  return created;
}

function reconcileSettlementForOrder(order) {
  if (!order || !order.id) return;
  const idx = (db.settlements || []).findIndex((s) => s.orderId === order.id);
  const next = createSettlementRecord(order);
  if (idx < 0) {
    db.settlements.push(next);
    return;
  }
  const prev = db.settlements[idx];
  db.settlements[idx] = {
    ...prev,
    ...next,
    id: prev.id,
    createdAt: prev.createdAt,
    updatedAt: nowIso(),
  };
}

function buildSettlementSummary() {
  const rows = db.settlements || [];
  const totalSettledGross = rows.reduce((sum, r) => sum + Number(r.settledGross || 0), 0);
  const totalSettledNet = rows.reduce((sum, r) => sum + Number(r.settledNet || 0), 0);
  const totalSettledMarkup = rows.reduce((sum, r) => sum + Number(r.settledMarkup || 0), 0);
  return {
    count: rows.length,
    totalSettledGross: roundMoney(totalSettledGross),
    totalSettledNet: roundMoney(totalSettledNet),
    totalSettledMarkup: roundMoney(totalSettledMarkup),
    currency: "CNY",
  };
}

function resolveUserPaymentRail(userId) {
  const user = db.users[userId] || db.users.demo;
  const selected = normalizeRail(user && user.paymentRail && user.paymentRail.selected);
  const check = canUseRail(selected);
  if (check.ok) return selected;
  const fallback = paymentRails.listRails().find((rail) => canUseRail(rail.id).ok);
  return fallback ? fallback.id : selected;
}

function buildPaymentRailsStatus(userId) {
  const selected = resolveUserPaymentRail(userId || "demo");
  const compliance = buildPaymentComplianceSummary();
  const rails = paymentRails.listRails().map((rail) => ({
    ...rail,
    compliance: compliance.rails[rail.id] || null,
    selectable: canUseRail(rail.id).ok,
    selected: rail.id === selected,
  }));
  return {
    selected,
    policy: compliance.policy,
    rails,
  };
}

function normalizeStep(step) {
  const safe = step && typeof step === "object" ? step : {};
  return {
    ...safe,
    status: safe.status || "queued",
    etaSec: Number(safe.etaSec || 20),
    retryable: safe.retryable !== false,
    fallbackPolicy: safe.fallbackPolicy || "none",
    inputPreview: safe.inputPreview || "",
    outputPreview: safe.outputPreview || "",
  };
}

function mapTaskStatusToSessionStage(status) {
  const s = String(status || "").toLowerCase();
  if (s === "confirmed") return "confirming";
  if (s === "executing") return "executing";
  if (s === "completed") return "done";
  if (s === "failed" || s === "canceled") return "support";
  if (s === "paused") return "planning";
  return "planning";
}

function syncTaskAgentMeta(task, stageOverride = "") {
  if (!task || typeof task !== "object") return;
  const intentType = (task.plan && task.plan.intentType) || "eat";
  const sourceMeta =
    task.plan && task.plan.sessionState && task.plan.expertRoute
      ? {
          expertRoute: task.plan.expertRoute,
          sessionState: task.plan.sessionState,
        }
      : buildAgentMeta({
          taskId: task.id,
          intent: task.intent || "",
          intentType,
          constraints: task.constraints || (task.plan && task.plan.constraints) || {},
        });
  const stage = stageOverride || mapTaskStatusToSessionStage(task.status);
  task.expertRoute = sourceMeta.expertRoute;
  task.sessionState = {
    ...(sourceMeta.sessionState || {}),
    taskId: task.id,
    intent: intentType,
    stage,
    laneId: (task.plan && task.plan.laneId) || (sourceMeta.sessionState && sourceMeta.sessionState.laneId) || `${intentType}_default`,
    updatedAt: nowIso(),
  };
  if (task.plan && typeof task.plan === "object") {
    task.plan.expertRoute = task.expertRoute;
    task.plan.sessionState = task.sessionState;
    if (!task.plan.laneId) task.plan.laneId = task.sessionState.laneId;
  }
}

function applySessionSlotsToConstraints(task, slots) {
  if (!task || !slots || typeof slots !== "object") return false;
  const next = {
    ...(task.constraints || {}),
  };
  let changed = false;
  const setIf = (key, value) => {
    const v = value === undefined || value === null ? "" : String(value).trim();
    if (!v) return;
    if (String(next[key] || "") === v) return;
    next[key] = v;
    changed = true;
  };

  setIf("city", slots.city);
  setIf("budget", slots.budget);
  setIf("time", slots.eta);
  setIf("origin", slots.origin);
  setIf("destination", slots.destination);
  setIf("dietary", slots.cuisine);
  setIf("paymentConstraint", slots.payment_constraint);
  setIf("group_size", slots.group_size);
  if (slots.transport_mode) {
    const mode = String(slots.transport_mode).toLowerCase();
    const mapped = mode.includes("walk") ? "walk" : mode.includes("ride") || mode.includes("taxi") ? "ride" : mode.includes("metro") ? "metro" : "";
    if (mapped) setIf("distance", mapped);
  }

  if (changed) {
    task.constraints = next;
  }
  return changed;
}

function lifecyclePush(collection, state, label, note) {
  if (!Array.isArray(collection)) return;
  collection.push({
    state,
    label,
    at: nowIso(),
    note,
  });
}

function tripProgress(plan) {
  const taskIds = Array.isArray(plan && plan.taskIds) ? plan.taskIds : [];
  const tasks = taskIds.map((id) => db.tasks[id]).filter(Boolean);
  const total = tasks.length;
  const counts = {
    planned: 0,
    confirmed: 0,
    executing: 0,
    completed: 0,
    failed: 0,
    canceled: 0,
    paused: 0,
    support: 0,
  };
  for (const task of tasks) {
    const status = String(task.status || "planned");
    if (counts[status] !== undefined) {
      counts[status] += 1;
    } else {
      counts.planned += 1;
    }
    if (task.handoff && task.handoff.status && task.handoff.status !== "resolved") {
      counts.support += 1;
    }
  }
  const orderIds = tasks
    .map((task) => task.orderId)
    .filter((id) => typeof id === "string" && db.orders[id]);
  const proofCount = orderIds
    .map((id) => db.orders[id])
    .reduce((sum, order) => sum + (Array.isArray(order.proofItems) ? order.proofItems.length : 0), 0);
  const completedRate = total > 0 ? Number((counts.completed / total).toFixed(3)) : 0;
  return {
    totalTasks: total,
    counts,
    orderCount: orderIds.length,
    proofCount,
    completedRate,
    taskIds,
  };
}

function deriveTripStatus(plan, progress) {
  const manual = String((plan && plan.status) || "active").toLowerCase();
  if (manual === "canceled") return "canceled";
  if (manual === "paused") return "paused";
  if (!progress.totalTasks) return "draft";
  const doneOrClosed = progress.counts.completed + progress.counts.canceled + progress.counts.failed;
  if (doneOrClosed === progress.totalTasks && progress.counts.completed > 0) return "completed";
  if (progress.counts.executing > 0 || progress.counts.confirmed > 0) return "in_progress";
  return "active";
}

function refreshTripPlan(plan) {
  if (!plan || typeof plan !== "object") return null;
  const progress = tripProgress(plan);
  plan.progress = progress;
  plan.derivedStatus = deriveTripStatus(plan, progress);
  plan.updatedAt = nowIso();
  return plan;
}

function refreshTripPlanById(tripId) {
  const plan = db.tripPlans[tripId];
  if (!plan) return null;
  return refreshTripPlan(plan);
}

function refreshTripByTask(task) {
  if (!task || !task.tripId) return null;
  return refreshTripPlanById(task.tripId);
}

function attachTaskToTripPlan(task, tripId) {
  if (!task || !tripId) return null;
  const plan = db.tripPlans[tripId];
  if (!plan) return null;
  if (task.userId !== plan.userId) return null;
  if (!Array.isArray(plan.taskIds)) plan.taskIds = [];
  if (!plan.taskIds.includes(task.id)) {
    plan.taskIds.push(task.id);
    lifecyclePush(plan.lifecycle || [], "task_attached", "Task attached", `Attached ${task.id}`);
  }
  task.tripId = tripId;
  refreshTripPlan(plan);
  return plan;
}

function buildTripSummary(plan) {
  const refreshed = refreshTripPlan(plan);
  const taskIds = (refreshed && refreshed.progress && refreshed.progress.taskIds) || [];
  const latestTask = taskIds
    .map((id) => db.tasks[id])
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))[0];
  const latestOrder =
    latestTask && latestTask.orderId && db.orders[latestTask.orderId]
      ? db.orders[latestTask.orderId]
      : taskIds
          .map((id) => db.tasks[id])
          .filter((task) => task && task.orderId && db.orders[task.orderId])
          .map((task) => db.orders[task.orderId])
          .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0] || null;
  return {
    id: refreshed.id,
    userId: refreshed.userId,
    title: refreshed.title,
    city: refreshed.city,
    note: refreshed.note || "",
    status: refreshed.derivedStatus || refreshed.status || "draft",
    manualStatus: refreshed.status || "active",
    startAt: refreshed.startAt || "",
    endAt: refreshed.endAt || "",
    progress: refreshed.progress || tripProgress(refreshed),
    latestTask: latestTask
      ? {
          id: latestTask.id,
          status: latestTask.status,
          intent: latestTask.intent,
          updatedAt: latestTask.updatedAt,
        }
      : null,
    latestOrder: latestOrder
      ? {
          id: latestOrder.id,
          status: latestOrder.status,
          amount: latestOrder.price,
          currency: latestOrder.currency,
          createdAt: latestOrder.createdAt,
          orderNo: latestOrder.proof && latestOrder.proof.orderNo ? latestOrder.proof.orderNo : latestOrder.id,
        }
      : null,
    createdAt: refreshed.createdAt,
    updatedAt: refreshed.updatedAt,
  };
}

function buildTripDetail(plan) {
  const summary = buildTripSummary(plan);
  const tasks = (summary.progress.taskIds || [])
    .map((id) => db.tasks[id])
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
    .map((task) => {
      const order = task.orderId && db.orders[task.orderId] ? db.orders[task.orderId] : null;
      return {
        taskId: task.id,
        intent: task.intent,
        status: task.status,
        laneId: task.sessionState && task.sessionState.laneId ? task.sessionState.laneId : task.plan && task.plan.laneId,
        type: task.plan && task.plan.intentType ? task.plan.intentType : "eat",
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        order: order
          ? {
              orderId: order.id,
              status: order.status,
              amount: order.price,
              currency: order.currency,
              proofCount: Array.isArray(order.proofItems) ? order.proofItems.length : 0,
              orderNo: order.proof && order.proof.orderNo ? order.proof.orderNo : order.id,
            }
          : null,
      };
    });
  return {
    ...summary,
    tasks,
    lifecycle: Array.isArray(plan.lifecycle) ? plan.lifecycle : [],
  };
}

function makeProofHash(seed) {
  const s = String(seed || "");
  let hash = 5381;
  for (let i = 0; i < s.length; i += 1) {
    hash = (hash * 33) ^ s.charCodeAt(i);
  }
  return `h_${Math.abs(hash >>> 0).toString(16)}`;
}

function applyTaskRuntimePolicy(task) {
  if (!task || typeof task !== "object" || !task.plan) return;
  const userId = task.userId || "demo";
  const user = db.users[userId] || db.users.demo;
  task.flagSnapshot = evaluateFlagsForUser(userId);
  task.plan.constraints = {
    ...(task.plan.constraints || {}),
    flags: task.flagSnapshot,
    mcpPolicy: db.mcpPolicy || { enforceSla: false, simulateBreachRate: 0 },
    mcpContracts: JSON.parse(JSON.stringify(db.mcpContracts || {})),
  };
  task.paymentRailSnapshot = resolveUserPaymentRail(userId);
  const vipFastLane = Boolean(task.flagSnapshot.plusConcierge && task.flagSnapshot.plusConcierge.active);
  const plusActive = Boolean(user && user.plusSubscription && user.plusSubscription.active);
  const quote = buildQuote({
    intentType: task.plan.intentType,
    currency: task.plan.confirm.currency,
    plusActive,
    vipFastLane,
  });
  task.pricing = quote;
  task.plan.confirm.amount = quote.finalPrice;
  task.plan.confirm.pricing = quote;
  task.plan.confirm.merchantModel = quote.merchantModel;
  task.plan.confirm.paymentRail = task.paymentRailSnapshot;
  if (!task.plan.confirm.breakdown || typeof task.plan.confirm.breakdown !== "object") {
    task.plan.confirm.breakdown = {};
  }
  const extraFee = task.paymentRailSnapshot === "card_delegate" ? 2 : 0;
  task.plan.confirm.breakdown.merchantFee = quote.netPrice;
  task.plan.confirm.breakdown.serviceFee = quote.markup;
  task.plan.confirm.breakdown.thirdPartyFee = Number(task.plan.confirm.breakdown.thirdPartyFee || 0);
  task.plan.confirm.breakdown.fxFee = extraFee;
  task.plan.confirm.breakdown.total = quote.finalPrice;
  task.plan.confirm.breakdown.deposit = Math.max(6, Math.round(quote.finalPrice * (task.plan.intentType === "travel" ? 0.2 : 0.3)));
  if (!task.plan.confirm.guarantee || typeof task.plan.confirm.guarantee !== "object") {
    task.plan.confirm.guarantee = {};
  }
  task.plan.confirm.guarantee.freeCancelWindowMin = Number(task.plan.confirm.guarantee.freeCancelWindowMin || 10);
  task.plan.confirm.guarantee.refundEta = task.plan.confirm.guarantee.refundEta || "T+1 to T+3";
  task.plan.confirm.guarantee.policyNote = task.plan.confirm.cancelPolicy;
  task.plan.confirm.guarantee.riskControl = [
    `Single limit ${user.authDomain.singleLimit} CNY`,
    `Daily limit ${user.authDomain.dailyLimit} CNY`,
    user.authDomain.noPinEnabled ? "No-PIN enabled within limits" : "No-PIN disabled",
  ];
  if (vipFastLane) {
    task.plan.confirm.alternative = "Use standard lane without concierge add-on";
    if (!String(task.plan.reasoning || "").includes("Concierge fast-lane applied by rollout.")) {
      task.plan.reasoning = `${task.plan.reasoning} Concierge fast-lane applied by rollout.`;
    }
  }
  task.plan.steps = (task.plan.steps || []).map(normalizeStep);
  syncTaskAgentMeta(task);
}

function canReplanTask(task) {
  if (!task || typeof task !== "object") return false;
  return !["executing", "completed", "failed", "canceled"].includes(task.status);
}

function replanTask(task, payload) {
  const body = payload && typeof payload === "object" ? payload : {};
  const nextIntent = String(body.intent || task.intent || "").trim();
  const nextConstraints = body.constraints && typeof body.constraints === "object" ? body.constraints : task.constraints || {};
  task.intent = nextIntent || task.intent;
  task.constraints = nextConstraints;
  task.plan = orchestrator.planTask({
    taskId: task.id,
    userId: task.userId || "demo",
    intent: task.intent,
    constraints: task.constraints,
  });
  applyTaskRuntimePolicy(task);
  task.confirmed = false;
  task.confirmedAt = null;
  task.confirmPayload = null;
  task.status = "planned";
  task.pauseState = "active";
  task.timeline = [];
  task.steps = (task.plan.steps || []).map(normalizeStep);
  task.payments = [];
  task.mcpCalls = [];
  task.deliverable = null;
  task.orderId = null;
  task.lifecycle = [
    {
      state: "replanned",
      label: "Plan updated",
      at: nowIso(),
      note: "User edited intent/constraints.",
    },
    {
      state: "planned",
      label: "Plan generated",
      at: nowIso(),
      note: "Ready for confirmation.",
    },
  ];
  syncTaskAgentMeta(task, "planning");
  refreshTripByTask(task);
  task.updatedAt = nowIso();
  task.fallbackEvents.push({
    kind: "task_replanned",
    at: nowIso(),
    note: "Plan regenerated after user edits",
  });
  audit.append({
    kind: "task",
    who: task.userId,
    what: "task.replanned",
    taskId: task.id,
    toolInput: body,
    toolOutput: { title: task.plan.title, amount: task.plan.confirm.amount },
  });
  pushMetricEvent({
    kind: "task_replanned",
    userId: task.userId,
    taskId: task.id,
    intentType: task.plan.intentType,
  });
  saveDb();
  return task;
}

function buildReplanPreview(task, payload) {
  const body = payload && typeof payload === "object" ? payload : {};
  const cloned = JSON.parse(JSON.stringify(task || {}));
  const nextIntent = String(body.intent || cloned.intent || "").trim();
  const nextConstraints = body.constraints && typeof body.constraints === "object" ? body.constraints : cloned.constraints || {};
  cloned.intent = nextIntent || cloned.intent;
  cloned.constraints = nextConstraints;
  cloned.plan = orchestrator.planTask({
    taskId: cloned.id,
    userId: cloned.userId || "demo",
    intent: cloned.intent,
    constraints: cloned.constraints,
    silent: true,
  });
  applyTaskRuntimePolicy(cloned);
  return {
    taskId: cloned.id,
    intent: cloned.intent,
    intentType: cloned.plan.intentType,
    constraints: cloned.constraints,
    reasoning: cloned.plan.reasoning,
    stepCount: (cloned.plan.steps || []).length,
    confirm: cloned.plan.confirm,
    pricing: cloned.pricing || null,
    paymentRail: cloned.paymentRailSnapshot || "alipay_cn",
    mcpSummary: cloned.plan.mcpSummary,
  };
}

function buildProviderLedgerEntry(settlement) {
  const gross = Number(settlement.settledGross || 0);
  const feeRate = 0.012;
  const deterministicSkew = stablePercent(`recon:${settlement.orderId}`) === 7 ? 1 : 0;
  const gatewayFee = roundMoney(gross * feeRate);
  const capturedGross = Math.max(0, roundMoney(gross - deterministicSkew));
  const capturedNet = Math.max(0, roundMoney(capturedGross - gatewayFee));
  return {
    id: `prov_${Date.now().toString().slice(-8)}_${db.providerLedger.length + 1}`,
    orderId: settlement.orderId,
    taskId: settlement.taskId,
    provider: "External Billing Provider",
    currency: settlement.currency || "CNY",
    capturedGross,
    gatewayFee,
    capturedNet,
    sourceTs: nowIso(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function syncProviderLedgerFromSettlements() {
  const created = [];
  for (const s of db.settlements || []) {
    if (db.providerLedger.some((item) => item.orderId === s.orderId)) continue;
    const entry = buildProviderLedgerEntry(s);
    db.providerLedger.push(entry);
    created.push(entry);
  }
  if (db.providerLedger.length > 1000) {
    db.providerLedger = db.providerLedger.slice(-1000);
  }
  return created;
}

function buildReconciliationSummary() {
  const providerByOrder = new Map((db.providerLedger || []).map((p) => [p.orderId, p]));
  const mismatches = [];
  let checked = 0;
  let matched = 0;

  for (const s of db.settlements || []) {
    checked += 1;
    const p = providerByOrder.get(s.orderId);
    if (!p) {
      mismatches.push({
        orderId: s.orderId,
        reason: "missing_provider_entry",
        expectedGross: Number(s.settledGross || 0),
        providerGross: null,
        diff: Number(s.settledGross || 0),
      });
      continue;
    }
    const expectedGross = Number(s.settledGross || 0);
    const providerGross = Number(p.capturedGross || 0);
    const diff = roundMoney(expectedGross - providerGross);
    if (Math.abs(diff) > 0.01) {
      mismatches.push({
        orderId: s.orderId,
        reason: "gross_amount_mismatch",
        expectedGross,
        providerGross,
        diff,
      });
      continue;
    }
    matched += 1;
  }

  return {
    checked,
    matched,
    mismatched: mismatches.length,
    matchRate: checked > 0 ? roundMoney(matched / checked) : 1,
    mismatchAmount: roundMoney(mismatches.reduce((sum, m) => sum + Number(m.diff || 0), 0)),
    mismatches,
  };
}

function runReconciliationBatch() {
  const createdProviderEntries = syncProviderLedgerFromSettlements();
  const summary = buildReconciliationSummary();
  const run = {
    id: `recon_${Date.now().toString().slice(-8)}_${(db.reconciliationRuns || []).length + 1}`,
    createdProviderEntries: createdProviderEntries.length,
    summary: {
      checked: summary.checked,
      matched: summary.matched,
      mismatched: summary.mismatched,
      matchRate: summary.matchRate,
      mismatchAmount: summary.mismatchAmount,
    },
    mismatches: summary.mismatches.slice(0, 20),
    createdAt: nowIso(),
  };
  db.reconciliationRuns.push(run);
  if (db.reconciliationRuns.length > 100) {
    db.reconciliationRuns = db.reconciliationRuns.slice(-100);
  }
  return run;
}

function buildRevenueSummary() {
  const orders = Object.values(db.orders || {});
  const paidOrders = orders.filter(
    (o) => o.status === "confirmed" || o.status === "completed" || o.status === "canceled" || o.status === "refunded",
  );
  const gross = paidOrders.reduce((sum, o) => sum + Number(o.price || 0), 0);
  const net = paidOrders.reduce((sum, o) => sum + Number((o.pricing && o.pricing.netPrice) || 0), 0);
  const markup = paidOrders.reduce((sum, o) => sum + Number((o.pricing && o.pricing.markup) || 0), 0);
  const refunds = paidOrders.reduce((sum, o) => sum + Number((o.refund && o.refund.amount) || 0), 0);
  const recon = buildReconciliationSummary();
  const latestRecon = db.reconciliationRuns.length ? db.reconciliationRuns[db.reconciliationRuns.length - 1] : null;
  return {
    orders: paidOrders.length,
    gross: roundMoney(gross),
    net: roundMoney(net),
    markup: roundMoney(markup),
    refunds: roundMoney(refunds),
    netAfterRefund: roundMoney(gross - refunds),
    markupRateRealized: gross > 0 ? roundMoney(markup / gross) : 0,
    settlements: buildSettlementSummary(),
    reconciliation: {
      providerEntries: db.providerLedger.length,
      checked: recon.checked,
      mismatched: recon.mismatched,
      matchRate: recon.matchRate,
      latestRunAt: latestRecon ? latestRecon.createdAt : null,
    },
    currency: "CNY",
  };
}

function buildMcpSlaSummary() {
  const calls = db.mcpCalls || [];
  if (!calls.length) {
    return {
      total: 0,
      met: 0,
      breached: 0,
      metRate: 0,
      contractBound: 0,
      byOp: {},
    };
  }

  const byOp = {};
  let met = 0;
  let breached = 0;
  let contractBound = 0;
  for (const call of calls) {
    const op = call.op || "Status";
    const slaMs = Number(call.response && call.response.slaMs ? call.response.slaMs : 0);
    const latency = Number(call.response && call.response.latency ? call.response.latency : 0);
    const isMet = Boolean(call.response && call.response.slaMet === true) || (slaMs > 0 && latency <= slaMs);
    if (call.response && call.response.contractId) contractBound += 1;
    if (!byOp[op]) byOp[op] = { total: 0, met: 0, breached: 0, avgLatencyMs: 0 };
    byOp[op].total += 1;
    byOp[op].avgLatencyMs += latency;
    if (isMet) {
      byOp[op].met += 1;
      met += 1;
    } else {
      byOp[op].breached += 1;
      breached += 1;
    }
  }

  for (const op of Object.keys(byOp)) {
    byOp[op].avgLatencyMs = Math.round(byOp[op].avgLatencyMs / Math.max(1, byOp[op].total));
  }

  return {
    total: calls.length,
    met,
    breached,
    metRate: roundMoney(met / Math.max(1, calls.length)),
    contractBound,
    byOp,
  };
}

function percentile(values, p) {
  const list = Array.isArray(values) ? values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b) : [];
  if (!list.length) return 0;
  const idx = Math.min(list.length - 1, Math.max(0, Math.ceil((p / 100) * list.length) - 1));
  return list[idx];
}

function classifyProviderCall(call) {
  if (!call) return "unknown";
  const provider = String(call.response && call.response.data && call.response.data.provider ? call.response.data.provider : "").toLowerCase();
  const tool = String(call.toolType || "").toLowerCase();
  if (provider.includes("gaode") || tool.includes("map.") || tool.includes("poi.")) return "gaode";
  if (provider.includes("partner") || tool.includes("queue.") || tool.includes("booking.") || tool.includes("traffic.") || tool.includes("transport.")) {
    return "partnerHub";
  }
  return "unknown";
}

function summarizeProviderCalls(providerKey, calls) {
  const pool = Array.isArray(calls) ? calls.filter((call) => classifyProviderCall(call) === providerKey) : [];
  const latencies = pool.map((call) => Number(call.response && call.response.latency ? call.response.latency : 0));
  const metCount = pool.filter((call) => Boolean(call.response && call.response.slaMet === true)).length;
  return {
    sampleCalls: pool.length,
    avgMs: pool.length ? Math.round(latencies.reduce((sum, item) => sum + item, 0) / pool.length) : 0,
    p95Ms: pool.length ? percentile(latencies, 95) : 0,
    slaMetRate: pool.length ? roundMoney(metCount / pool.length) : 0,
    lastCallAt: pool.length ? pool[pool.length - 1].at : null,
  };
}

function buildProviderProbeSummary() {
  const gaodeKeyPresent = Boolean(process.env.GAODE_KEY || process.env.AMAP_KEY);
  const partnerHubKeyPresent = Boolean(process.env.PARTNER_HUB_KEY);
  const partnerHubBaseUrlConfigured = Boolean(connectors.partnerHub && connectors.partnerHub.baseUrl);
  const partnerHubContractReady = Boolean(connectors.partnerHub && connectors.partnerHub.baseUrl);
  const partnerHubReady = Boolean(connectors.partnerHub && connectors.partnerHub.enabled && (partnerHubKeyPresent || partnerHubBaseUrlConfigured));
  const recentCalls = (db.mcpCalls || []).slice(-240);
  const gaodeStats = summarizeProviderCalls("gaode", recentCalls);
  const partnerStats = summarizeProviderCalls("partnerHub", recentCalls);
  const missing = [
    ...(gaodeKeyPresent ? [] : ["GAODE_KEY or AMAP_KEY"]),
    ...(partnerHubReady ? [] : ["PARTNER_HUB_KEY or PARTNER_HUB_BASE_URL"]),
  ];

  return {
    generatedAt: nowIso(),
    ready: missing.length === 0,
    missing,
    probes: [
      {
        provider: "Gaode LBS",
        mode: connectors.gaode.enabled ? "live_with_fallback" : "mock",
        keyPresent: gaodeKeyPresent,
        connectorEnabled: connectors.gaode.enabled,
        ...gaodeStats,
      },
      {
        provider: "Partner Hub",
        mode: connectors.partnerHub.mode || (connectors.partnerHub.enabled ? "external_contract" : "mock"),
        keyPresent: partnerHubKeyPresent,
        baseUrlConfigured: partnerHubBaseUrlConfigured,
        contractReady: partnerHubContractReady,
        providerAlias: connectors.partnerHub.provider || "generic",
        channels: connectors.partnerHub.channels || [],
        connectorEnabled: connectors.partnerHub.enabled,
        ...partnerStats,
      },
    ],
  };
}

function normalizeCandidateScore(value, fallback = 80) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n > 100) return 100;
  if (n < 0) return 0;
  return Math.round(n);
}

function normalizeCandidateItem(raw, laneType = "eat") {
  if (!raw || typeof raw !== "object") return null;
  const name = String(raw.name || raw.title || "").trim();
  if (!name) return null;
  const category = String(raw.category || (laneType === "travel" ? "Transport" : "Restaurant")).trim();
  const fallbackImage =
    laneType === "travel"
      ? "https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=1200&q=80"
      : "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=1200&q=80";
  return {
    name,
    category,
    imageUrl: String(raw.imageUrl || raw.imagePath || fallbackImage),
    score: normalizeCandidateScore(raw.score, laneType === "travel" ? 86 : 88),
    reason: String(raw.reason || raw.why || raw.analysis || raw.comment || "").trim() || (laneType === "travel" ? "Travel option from live candidate pool." : "Dining option from live candidate pool."),
    priceRange: raw.priceRange ? String(raw.priceRange) : "",
    etaMin: Number.isFinite(Number(raw.etaMin)) ? Number(raw.etaMin) : null,
    riskLevel: raw.riskLevel ? String(raw.riskLevel) : "",
    openHours: raw.openHours ? String(raw.openHours) : "",
    paymentFriendly: raw.paymentFriendly ? String(raw.paymentFriendly) : "",
    englishMenu: raw.englishMenu === true,
    sourceUrl: raw.sourceUrl ? String(raw.sourceUrl) : "",
    providerSource: raw.providerSource ? String(raw.providerSource) : "",
  };
}

function dedupeCandidateItems(items = []) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const normalized = normalizeCandidateItem(item, "eat");
    if (!normalized) continue;
    const key = String(normalized.name || "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function mergeLaneCandidates(staticRows = [], dynamicRows = [], laneType = "eat") {
  const mappedDynamic = (Array.isArray(dynamicRows) ? dynamicRows : [])
    .map((item) => normalizeCandidateItem(item, laneType))
    .filter(Boolean);
  const mappedStatic = (Array.isArray(staticRows) ? staticRows : [])
    .map((item) => normalizeCandidateItem(item, laneType))
    .filter(Boolean);
  const merged = [...mappedDynamic, ...mappedStatic]
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  const seen = new Set();
  const result = [];
  for (const row of merged) {
    const key = String(row.name || "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }
  return result.slice(0, 8);
}

function mergeCandidatePool(staticPool, dynamicPool) {
  const base = staticPool || {};
  const live = dynamicPool || {};
  return {
    eat: mergeLaneCandidates(base.eat || [], live.eat || [], "eat"),
    travel: mergeLaneCandidates(base.travel || [], live.travel || [], "travel"),
    trust: mergeLaneCandidates(base.trust || [], live.trust || [], "trust"),
  };
}

function travelCategoryType(item) {
  const text = `${item && item.name ? item.name : ""} ${item && item.category ? item.category : ""}`.toLowerCase();
  if (/hotel|酒店|ホテル|호텔/.test(text)) return "hotel";
  if (/airport|transfer|transport|taxi|ride|地铁|空港|공항|机场/.test(text)) return "transport";
  return "other";
}

function asCandidateRowsFromPartner(data, laneType = "eat") {
  const rows = Array.isArray(data && data.items) ? data.items : [];
  return rows
    .map((item) => normalizeCandidateItem(item, laneType))
    .filter(Boolean);
}

function asCandidateRowsFromGaodePois(pois = [], laneType = "eat") {
  return (Array.isArray(pois) ? pois : [])
    .slice(0, 6)
    .map((poi, idx) =>
      normalizeCandidateItem(
        {
          name: poi && poi.name ? poi.name : "",
          category: laneType === "travel" ? "POI" : "Restaurant",
          imageUrl:
            laneType === "travel"
              ? "https://images.unsplash.com/photo-1502877338535-766e1452684a?auto=format&fit=crop&w=1200&q=80"
              : "https://images.unsplash.com/photo-1515003197210-e0cd71810b5f?auto=format&fit=crop&w=1200&q=80",
          score: Math.max(72, 94 - idx * 4),
          reason: poi && poi.address ? `Live POI from map: ${poi.address}` : "Live POI from map.",
        },
        laneType,
      ),
    )
    .filter(Boolean);
}

function buildLocalKeywordCandidates({ city = "Shanghai", language = "EN", laneType = "eat", message = "", constraints = {} } = {}) {
  const lang = normalizeLang(language || "EN");
  const cityKey = canonicalCityKey(city);
  const text = `${String(message || "")} ${JSON.stringify(constraints || {})}`.toLowerCase();
  const L = (zh, en, ja, ko) => pickLang(lang, zh, en, ja, ko);
  const rows = [];
  const add = (item) => {
    const normalized = normalizeCandidateItem(item, laneType);
    if (normalized) rows.push(normalized);
  };

  if (laneType === "eat") {
    if (/hotpot|火锅|鍋|훠궈/.test(text)) {
      const name = cityKey === "Beijing"
        ? L("东来顺涮肉（王府井）", "Dong Lai Shun Hotpot (Wangfujing)", "東来順しゃぶしゃぶ（王府井）", "동라이순 훠궈 (왕푸징)")
        : cityKey === "Chengdu"
          ? L("蜀九香火锅（太古里）", "Shu Jiu Xiang Hotpot (Taikoo Li)", "蜀九香火鍋（太古里）", "수지우샹 훠궈 (타이쿠리)")
          : L("海底捞火锅（人民广场）", "Haidilao Hotpot (People's Square)", "海底撈火鍋（人民広場）", "하이디라오 훠궈 (인민광장)");
      add({
        name,
        category: L("火锅", "Hotpot", "火鍋", "훠궈"),
        score: 95,
        imageUrl: "https://images.unsplash.com/photo-1544148103-0773bf10d330?auto=format&fit=crop&w=1200&q=80",
        reason: L("匹配火锅偏好，支持预约与代付。", "Matches hotpot preference with reservation + delegated pay support.", "火鍋嗜好に一致し、予約と委任決済に対応。", "훠궈 선호에 맞고 예약/위임결제를 지원합니다."),
        paymentFriendly: "alipay,wechat,card_delegate",
        englishMenu: true,
      });
    }

    if (/halal|清真/.test(text)) {
      const name = cityKey === "Beijing"
        ? L("聚宝源涮肉（牛街）", "Jubaoyuan Halal Hotpot (Niujie)", "聚宝源しゃぶしゃぶ（牛街）", "쥐바오위안 할랄 훠궈 (니우제)")
        : L("耶里夏丽新疆餐厅（静安）", "Yershari Xinjiang Cuisine (Jing'an)", "イェリシャリ新疆料理（静安）", "예리샤리 신장요리 (징안)");
      add({
        name,
        category: L("清真", "Halal", "ハラール", "할랄"),
        score: 94,
        imageUrl: "https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=1200&q=80",
        reason: L("优先满足清真约束，且英文点单更友好。", "Prioritizes halal constraints with better English ordering.", "ハラール条件を優先し、英語注文も比較的容易。", "할랄 제약을 우선하며 영어 주문도 비교적 용이합니다."),
        paymentFriendly: "alipay,wechat",
        englishMenu: true,
      });
    }

    if (/vegan|vegetarian|素食|纯素/.test(text)) {
      const name = cityKey === "Beijing"
        ? L("京兆尹素食（雍和宫）", "King's Joy Vegetarian (Yonghegong)", "京兆尹精進料理（雍和宮）", "킹스조이 베지테리언 (용허궁)")
        : L("功德林素食（南京西路）", "Gong De Lin Vegetarian (Nanjing West Rd)", "功徳林精進料理（南京西路）", "궁더린 채식 (난징서루)");
      add({
        name,
        category: L("素食", "Vegetarian", "精進料理", "채식"),
        score: 93,
        imageUrl: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=1200&q=80",
        reason: L("符合素食需求并保留可执行订位链路。", "Fits vegetarian needs while keeping executable booking flow.", "精進条件に合致し、実行可能な予約フローを維持。", "채식 요구에 맞고 실행 가능한 예약 흐름을 유지합니다."),
        paymentFriendly: "alipay,wechat,card_delegate",
        englishMenu: true,
      });
    }

    if (/coffee|cafe|咖啡|奶茶|tea/.test(text)) {
      const name = cityKey === "Beijing"
        ? L("%Arabica（三里屯）", "%Arabica (Sanlitun)", "%Arabica（三里屯）", "%아라비카 (싼리툰)")
        : L("M Stand咖啡（新天地）", "M Stand Coffee (Xintiandi)", "M Stand コーヒー（新天地）", "M Stand 커피 (신톈디)");
      add({
        name,
        category: L("咖啡茶饮", "Cafe & Tea", "カフェ・ティー", "카페·티"),
        score: 90,
        imageUrl: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=1200&q=80",
        reason: L("适合轻量会面，等待时间通常更短。", "Good for lightweight meetups with usually shorter wait.", "軽い会合に向き、待ち時間が比較的短い。", "가벼운 미팅에 적합하며 대기 시간이 비교적 짧습니다."),
        paymentFriendly: "alipay,wechat",
        englishMenu: true,
      });
    }

    if (/noodle|面|ramen/.test(text)) {
      const name = cityKey === "Beijing"
        ? L("方砖厂69号炸酱面", "Fangzhuanchang 69 Zhajiangmian", "方磚廠69号ジャージャー麺", "팡좐창69 자장면")
        : L("阿娘面馆（思南路）", "A Niang Noodles (Sinan Rd)", "阿娘面館（思南路）", "아냥 누들 (쓰난루)");
      add({
        name,
        category: L("面馆", "Noodles", "麺類", "면요리"),
        score: 92,
        imageUrl: "https://images.unsplash.com/photo-1611270629569-8b357cb88da9?auto=format&fit=crop&w=1200&q=80",
        reason: L("与你的面食偏好直接匹配。", "Direct match to your noodle preference.", "麺系の嗜好に直接一致。", "면 요리 선호와 직접 일치합니다."),
        paymentFriendly: "alipay,wechat",
        englishMenu: true,
      });
    }
  }

  if (laneType === "travel") {
    if (/airport|flight|赶飞机|机场|terminal/.test(text)) {
      const fastRide = cityKey === "Beijing"
        ? L("大兴机场快线专车", "Daxing Airport Express Ride", "大興空港エクスプレス配車", "다싱공항 익스프레스 라이드")
        : cityKey === "Shenzhen"
          ? L("宝安机场快线专车", "SZX Airport Express Ride", "宝安空港エクスプレス配車", "바오안공항 익스프레스 라이드")
          : L("浦东机场快线专车", "PVG Airport Express Ride", "浦東空港エクスプレス配車", "푸동공항 익스프레스 라이드");
      add({
        name: fastRide,
        category: L("机场接送", "Airport Transfer", "空港送迎", "공항 이동"),
        score: 93,
        imageUrl: "https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=1200&q=80",
        reason: L("时限场景下准点率更优。", "Higher on-time probability for time-bound trips.", "時限制約シーンで定時率が高い。", "시간 제약 상황에서 정시 도착 확률이 높습니다."),
        riskLevel: "medium",
      });
      add({
        name: cityKey === "Beijing"
          ? L("地铁 + 机场快线组合", "Metro + Airport Express Mix", "地下鉄 + 空港快速線", "지하철 + 공항 익스프레스")
          : cityKey === "Shenzhen"
            ? L("地铁11号线 + 网约车", "Metro Line 11 + Ride-hailing", "地下鉄11号線 + 配車", "지하철 11호선 + 택시")
            : L("地铁2号线 + 机场联络线", "Metro Line 2 + Airport Link", "地下鉄2号線 + 空港連絡線", "지하철 2호선 + 공항 링크"),
        category: L("交通组合", "Transport Mix", "交通ミックス", "교통 혼합"),
        score: 88,
        imageUrl: "https://images.unsplash.com/photo-1502877338535-766e1452684a?auto=format&fit=crop&w=1200&q=80",
        reason: L("成本更优，适合时间弹性场景。", "Better cost efficiency for flexible arrival windows.", "コスト効率が高く、時間に余裕がある場合に適合。", "비용 효율이 높아 시간 여유가 있을 때 적합합니다."),
        riskLevel: "medium",
      });
    }

    if (/hotel|住宿|stay|check-?in|酒店/.test(text)) {
      const hotel = cityKey === "Beijing"
        ? L("北京国贸大酒店", "China World Hotel Beijing", "チャイナワールドホテル北京", "차이나월드 호텔 베이징")
        : cityKey === "Shenzhen"
          ? L("深圳四季酒店", "Four Seasons Hotel Shenzhen", "フォーシーズンズ深圳", "포시즌스 호텔 선전")
          : L("上海浦东香格里拉酒店", "Pudong Shangri-La Shanghai", "上海浦東シャングリ・ラ", "푸동 샹그릴라 상하이");
      add({
        name: hotel,
        category: L("酒店", "Hotel", "ホテル", "호텔"),
        score: 91,
        imageUrl: "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=80",
        reason: L("外宾友好度高，接驳与沟通成本低。", "High foreign-visitor friendliness with low coordination cost.", "訪日客対応が高く、連携コストが低い。", "외국인 친화도가 높고 연계 비용이 낮습니다."),
      });
    }
  }

  return rows.slice(0, 6);
}

function buildCandidateQuery(message = "", constraints = {}) {
  const raw = String(message || "").trim();
  if (raw) return raw.slice(0, 80);
  const cuisine = constraints && constraints.cuisine ? String(constraints.cuisine).trim() : "";
  const destination = constraints && constraints.destination ? String(constraints.destination).trim() : "";
  return cuisine || destination || "local";
}

async function fetchDynamicCandidatePool({ message = "", city = "Shanghai", constraints = {}, language = "EN", intentHint = null } = {}) {
  const pool = {
    eat: [],
    travel: [],
    trust: [],
  };
  const query = buildCandidateQuery(message, constraints);
  const lower = `${String(message || "").toLowerCase()} ${String(query || "").toLowerCase()}`;
  const inferredIntent = intentHint || detectIntentHint(message) || (/(airport|flight|机场|赶飞机|route|taxi|metro)/.test(lower) ? "travel" : "eat");
  const needEat = inferredIntent !== "travel" || /restaurant|food|eat|dinner|lunch|餐厅|美食|吃/.test(lower);
  const needTravel = inferredIntent === "travel" || /airport|flight|route|taxi|metro|机场|打车|路线|酒店/.test(lower);

  if (needEat) {
    pool.eat.push(
      ...buildLocalKeywordCandidates({
        city,
        language,
        laneType: "eat",
        message: `${message} ${query}`,
        constraints,
      }),
    );
  }
  if (needTravel) {
    pool.travel.push(
      ...buildLocalKeywordCandidates({
        city,
        language,
        laneType: "travel",
        message: `${message} ${query}`,
        constraints,
      }),
    );
  }

  const tasks = [];
  if (connectors.partnerHub && connectors.partnerHub.enabled && typeof connectors.partnerHub.searchCandidates === "function") {
    if (needEat) {
      tasks.push(
        connectors.partnerHub
          .searchCandidates({
            vertical: "eat",
            city,
            query,
            constraints,
            language,
            limit: 6,
          })
          .then((data) => {
            pool.eat.push(...asCandidateRowsFromPartner(data, "eat"));
          })
          .catch(() => {}),
      );
    }
    if (needTravel) {
      tasks.push(
        connectors.partnerHub
          .searchCandidates({
            vertical: "travel",
            city,
            query,
            constraints,
            language,
            limit: 6,
          })
          .then((data) => {
            const rows = asCandidateRowsFromPartner(data, "travel");
            const hotelRows = rows.filter((item) => travelCategoryType(item) === "hotel");
            const transportRows = rows.filter((item) => travelCategoryType(item) !== "hotel");
            pool.travel.push(...hotelRows, ...transportRows);
          })
          .catch(() => {}),
      );
    }
  }

  if (connectors.gaode && connectors.gaode.enabled && typeof connectors.gaode.searchPoi === "function") {
    if (needEat) {
      tasks.push(
        connectors.gaode
          .searchPoi({
            keywords: query || "restaurant",
            cityName: city,
          })
          .then((live) => {
            pool.eat.push(...asCandidateRowsFromGaodePois(live && live.pois, "eat"));
          })
          .catch(() => {}),
      );
    }
    if (needTravel) {
      tasks.push(
        connectors.gaode
          .searchPoi({
            keywords: /hotel|酒店/.test(lower) ? query : "hotel",
            cityName: city,
          })
          .then((live) => {
            pool.travel.push(...asCandidateRowsFromGaodePois(live && live.pois, "travel"));
          })
          .catch(() => {}),
      );
    }
  }

  if (tasks.length) {
    await Promise.all(tasks);
  }

  pool.eat = mergeLaneCandidates([], pool.eat, "eat");
  pool.travel = mergeLaneCandidates([], pool.travel, "travel");
  pool.trust = mergeLaneCandidates([], pool.trust, "trust");
  return pool;
}

function buildChatDataSources({ hotelSignal = false, dynamicCandidates = null, recommendation = null } = {}) {
  const eatCount = dynamicCandidates && Array.isArray(dynamicCandidates.eat) ? dynamicCandidates.eat.length : 0;
  const travelCount = dynamicCandidates && Array.isArray(dynamicCandidates.travel) ? dynamicCandidates.travel.length : 0;
  const trustCount = dynamicCandidates && Array.isArray(dynamicCandidates.trust) ? dynamicCandidates.trust.length : 0;
  const providerSet = new Set();
  const options = recommendation && Array.isArray(recommendation.options) ? recommendation.options : [];
  for (const option of options) {
    const rows = option && Array.isArray(option.candidates) ? option.candidates : [];
    for (const row of rows) {
      const source = String((row && row.providerSource) || "").trim();
      if (source) providerSet.add(source);
    }
  }
  const partnerHubConfigured = Boolean(
    connectors.partnerHub &&
      connectors.partnerHub.enabled &&
      (process.env.PARTNER_HUB_KEY || connectors.partnerHub.baseUrl),
  );
  return {
    mode: hotelSignal ? "hotel_booking" : "local_life",
    connectors: {
      openai: Boolean(OPENAI_API_KEY),
      gaode: Boolean(connectors.gaode && connectors.gaode.enabled && (process.env.GAODE_KEY || process.env.AMAP_KEY)),
      partnerHub: partnerHubConfigured,
    },
    candidateCounts: {
      eat: eatCount,
      travel: travelCount,
      trust: trustCount,
    },
    providerSources: [...providerSet].slice(0, 8),
  };
}

function buildSolutionRecommendation(taskId = null, intentHint = null, cityOverride = null, language = "EN", contextConstraints = null, dynamicCandidates = null) {
  const lang = normalizeLang(language || "EN");
  const L = (zh, en, ja, ko) => pickLang(lang, zh, en, ja, ko);
  const kpi = buildKpiSummary();
  const funnel = buildFunnelSummary();
  const revenue = buildRevenueSummary();
  const mcpSla = buildMcpSlaSummary();
  const mcpContracts = buildMcpContractsSummary();
  const paymentCompliance = buildPaymentComplianceSummary();
  const certifiedRails = Object.values(paymentCompliance.rails || {}).filter((r) => r && r.certified && r.enabled).length;
  const totalRails = Object.keys(paymentCompliance.rails || {}).length;
  const recon = revenue.reconciliation || {};
  const closedLoopRate = Number(kpi.northStar.value || 0);
  const openHandoffs = Number(funnel.handoff || 0);
  const task = taskId && db.tasks[taskId] ? db.tasks[taskId] : null;
  const taskType = task && task.plan && task.plan.intentType === "travel" ? "travel" : "eat";
  const taskCounts = Object.values(db.tasks || {}).reduce(
    (acc, t) => {
      const type = t && t.plan && t.plan.intentType === "travel" ? "travel" : "eat";
      acc[type] += 1;
      return acc;
    },
    { eat: 0, travel: 0 },
  );
  const portfolioFocus = taskCounts.travel > taskCounts.eat ? "travel" : "eat";
  const normalizedIntentHint = intentHint === "travel" ? "travel" : intentHint === "eat" ? "eat" : null;
  const focusType = task ? taskType : normalizedIntentHint || portfolioFocus;
  const recommendationConstraints = task && task.constraints
    ? task.constraints
    : (contextConstraints && typeof contextConstraints === "object" ? contextConstraints : {});
  const cityRaw =
    String(cityOverride || "").trim() ||
    (task && task.plan && task.plan.constraints && task.plan.constraints.city) ||
    db.users.demo.city ||
    "Shanghai";
  const city = localizedCityName(cityRaw, lang);
  const candidatesByLane = mergeCandidatePool(cityLaneCandidates(cityRaw, lang), dynamicCandidates);
  const mcpCoverage = Number(mcpContracts.totalContracts || 0)
    ? Number((mcpContracts.enforcedContracts || 0) / mcpContracts.totalContracts)
    : 0;
  const markupRate = Number(revenue.markupRateRealized || 0);
  const reconMatch = Number(recon.matchRate || 0);
  const railCertificationRate = totalRails ? Number(certifiedRails / totalRails) : 0;
  const strategySignals = {
    slowClosure: closedLoopRate < 0.8,
    highHandoff: openHandoffs > 3,
    weakSla: Number(mcpSla.metRate || 0) < 0.95,
    billingRisk: Number(recon.mismatched || 0) > 0,
    complianceGap: certifiedRails < totalRails,
  };
  const eatScore = Math.max(
    52,
    70 + (closedLoopRate >= 0.8 ? 8 : -6) + (openHandoffs <= 3 ? 8 : -8) + (markupRate >= 0.15 ? 6 : 0),
  );
  const travelScore = Math.max(
    52,
    70 + (Number(mcpSla.metRate || 0) >= 0.95 ? 12 : -10) + (openHandoffs <= 3 ? 6 : -6) + (reconMatch >= 0.98 ? 8 : -6),
  );
  const trustScore = Math.max(
    52,
    68 + (mcpCoverage >= 0.95 ? 10 : -8) + (railCertificationRate >= 1 ? 12 : -10) + (Number(recon.mismatched || 0) === 0 ? 10 : -8),
  );

  const eatLaneScore = Math.min(100, eatScore);
  const travelLaneScore = Math.min(100, travelScore);
  const trustLaneScore = Math.min(100, trustScore);

  const eatPrimary = candidatesByLane.eat[0] || {};
  const eatSecondary = candidatesByLane.eat[1] || eatPrimary;
  const eatFamily = candidatesByLane.eat[2] || eatSecondary;
  const travelCandidates = Array.isArray(candidatesByLane.travel) ? candidatesByLane.travel : [];
  const hotelPrimary = travelCandidates.find((item) => travelCategoryType(item) === "hotel") || travelCandidates[0] || {};
  const transportCandidates = travelCandidates.filter((item) => item !== hotelPrimary);
  const transferFast = transportCandidates[0] || travelCandidates[1] || {};
  const transferSaver = transportCandidates[1] || transportCandidates[0] || travelCandidates[2] || transferFast;
  const demoUser = db.users.demo || {};
  const savedHotel = String((demoUser.savedPlaces && demoUser.savedPlaces.hotel) || "").trim();
  const hotelName = savedHotel || hotelPrimary.name || L(`${city}滨江精选酒店`, `${city} Riverside Hotel`, `${city} リバーサイドホテル`, `${city} 리버사이드 호텔`);
  const distancePref = String(
    recommendationConstraints.distance ||
      recommendationConstraints.transport_mode ||
      recommendationConstraints.transportMode ||
      "",
  ).toLowerCase();
  const budgetPref = String(recommendationConstraints.budget || "mid").toLowerCase();
  const timePref = String(recommendationConstraints.time || recommendationConstraints.eta || "").toLowerCase();
  const prefersWalk = distancePref.includes("walk");
  const needsAirport = focusType === "travel" || /airport|flight|赶飞机|机场/i.test(String(intentHint || ""));
  const usesSaverRoute = budgetPref === "low" || timePref === "flexible";
  const transferPrimary = usesSaverRoute ? transferSaver : transferFast;
  const transferBackup = usesSaverRoute ? transferFast : transferSaver;
  const transportModeEat = prefersWalk
    ? L("步行", "Walk", "徒歩", "도보")
    : L("打车", "Ride-hailing", "配車", "택시");
  const transportModeTrip = usesSaverRoute
    ? L("地铁 + 短途打车", "Metro + short taxi", "地下鉄 + 短距離タクシー", "지하철 + 단거리 택시")
    : L("网约车 + 高速", "Ride-hailing + expressway", "配車 + 高速", "택시 + 고속도로");
  const mixedScore = Math.min(100, Math.round(eatLaneScore * 0.55 + travelLaneScore * 0.45));
  const travelScoreBoosted = Math.min(100, travelLaneScore + (needsAirport ? 4 : 0));
  const options = [
    {
      id: "eat-specific-fastlane",
      type: "eat",
      title: L(`${eatPrimary.name} 即刻订位`, `${eatPrimary.name} immediate reservation`, `${eatPrimary.name} 即時予約`, `${eatPrimary.name} 즉시 예약`),
      imagePath: eatPrimary.imageUrl || "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1200&q=80",
      prompt: L(
        `去 ${eatPrimary.name}，用${transportModeEat}前往并完成排队、订位、代付和双语导航。`,
        `Go to ${eatPrimary.name} via ${transportModeEat}, and complete queue check, reservation, delegated pay, and bilingual navigation.`,
        `${transportModeEat}で ${eatPrimary.name} へ移動し、待ち確認・予約・委任決済・二言語ナビまで実行。`,
        `${transportModeEat}으로 ${eatPrimary.name} 이동 후 대기 확인, 예약, 위임결제, 이중언어 길안내까지 실행.`,
      ),
      score: eatLaneScore,
      grade: recommendationGrade(eatLaneScore),
      recommendationLevel: recommendationLevel(eatLaneScore, lang),
      etaWindow: prefersWalk ? L("12-22 分钟", "12-22 min", "12-22 分", "12-22분") : L("18-30 分钟", "18-30 min", "18-30 分", "18-30분"),
      successRate7d: 0.92,
      riskLevel: "medium",
      riskLabel: L("中", "Medium", "中", "중간"),
      costRange: budgetPref === "low" ? "CNY 48-88" : budgetPref === "high" ? "CNY 108-188" : "CNY 68-138",
      openHours: "11:00-22:00",
      touristFriendlyScore: 4.7,
      paymentFriendly: L("Alipay / WeChat / 代付卡", "Alipay / WeChat / delegated card", "Alipay / WeChat / 委任カード", "Alipay / WeChat / 위임카드"),
      englishMenu: true,
      requires: ["location", "delegated_payment"],
      placeName: eatPrimary.name || "-",
      hotelName,
      transportMode: transportModeEat,
      executionPlan: [
        L("检索并评分门店", "Query and rank venue", "店舗を検索・評価", "매장을 조회하고 평가"),
        L("查询排队与可订位状态", "Check queue and reservability", "待ち時間と予約可否を確認", "대기열과 예약 가능 여부 확인"),
        L("锁定席位并代付", "Lock table and delegated pay", "席を確保して委任決済", "좌석 잠금 및 위임 결제"),
        L("生成双语导航卡与凭证", "Generate bilingual nav card and proof", "二言語ナビカードと証憑を生成", "이중언어 내비 카드와 증빙 생성"),
      ],
      comments: [
        L(`推荐餐厅：${eatPrimary.name}，匹配「地道 + 可执行」优先级。`, `Recommended restaurant: ${eatPrimary.name}, highest fit for authenticity + executability.`, `推奨店: ${eatPrimary.name}。本場感と実行性の適合が最上位。`, `추천 식당: ${eatPrimary.name}. 현지성+실행가능성 적합도가 가장 높습니다.`),
        L(`备选：${eatSecondary.name}，用于满位或排队突增时无缝切换。`, `Backup: ${eatSecondary.name}, used when seat inventory or queue spikes.`, `予備案: ${eatSecondary.name}。満席/待ち増加時に即切替。`, `대안: ${eatSecondary.name}. 만석/대기 증가 시 즉시 전환.`),
      ],
      analysis: [
        L(`已按你的约束做筛选：预算=${budgetPref}，距离=${distancePref || "-"}，时间=${timePref || "-"}` , `Filtered by your constraints: budget=${budgetPref}, distance=${distancePref || "-"}, time=${timePref || "-"}.`, `条件で絞込済み: budget=${budgetPref}, distance=${distancePref || "-"}, time=${timePref || "-"}.`, `제약 조건으로 필터링 완료: budget=${budgetPref}, distance=${distancePref || "-"}, time=${timePref || "-"}.`),
        L(`当前执行路径会优先锁定 ${eatPrimary.name}，失败时自动切 ${eatSecondary.name} 或人工接管。`, `Execution path locks ${eatPrimary.name} first, then auto-switches to ${eatSecondary.name} or human handoff on failure.`, `まず ${eatPrimary.name} を確保し、失敗時は ${eatSecondary.name} または有人対応へ自動切替。`, `먼저 ${eatPrimary.name}를 잠그고 실패 시 ${eatSecondary.name} 또는 사람 상담으로 자동 전환.`),
        strategySignals.slowClosure
          ? L("当前闭环率偏低，优先采用步骤更短且可逆的订位链路。", "Closure rate is below target, so a shorter and reversible booking chain is prioritized.", "クローズ率が低いため、短く巻き戻し可能な予約チェーンを優先。", "클로즈율이 낮아 짧고 되돌릴 수 있는 예약 체인을 우선합니다.")
          : L("当前闭环率稳定，可优先自动执行并保留人工兜底。", "Closure rate is stable, so automation-first execution remains safe with human fallback.", "クローズ率が安定しており、自動実行優先+有人フォールバックで運用可能。", "클로즈율이 안정적이어서 자동 실행 우선 + 사람 백업으로 운영 가능합니다."),
      ],
      tradeoffs: [
        L("高峰期排队波动时，可能触发备选餐厅或人工接管", "Peak queue volatility can trigger backup restaurant or human handoff", "ピーク時は予備店舗/有人対応へ切替の可能性", "피크 대기 변동 시 대안 매장/사람 상담으로 전환될 수 있음"),
        L("步行优先时，候选范围会更窄", "Walk-first preference narrows candidate radius", "徒歩優先では候補半径が狭くなる", "도보 우선 시 후보 반경이 좁아짐"),
      ],
      candidates: [eatPrimary, eatSecondary, eatFamily].filter(Boolean),
      scoring: [
        { k: "authenticity", v: Number(eatPrimary.score || 88) },
        { k: "queue_stability", v: 89 },
        { k: "distance_fit", v: prefersWalk ? 92 : 84 },
      ],
    },
    {
      id: "dinner-hotel-combo",
      type: "eat",
      title: L(`${eatSecondary.name} 晚餐 + 返回酒店`, `${eatSecondary.name} dinner + return hotel`, `${eatSecondary.name} 夕食 + ホテル帰着`, `${eatSecondary.name} 저녁 + 호텔 복귀`),
      imagePath: eatSecondary.imageUrl || eatPrimary.imageUrl || "https://images.unsplash.com/photo-1515003197210-e0cd71810b5f?auto=format&fit=crop&w=1200&q=80",
      prompt: L(
        `在 ${eatSecondary.name} 完成晚餐后，安排 ${hotelName} 回程并交付全套凭证。`,
        `Finish dinner at ${eatSecondary.name}, then arrange return to ${hotelName} with full proof package.`,
        `${eatSecondary.name} で夕食後、${hotelName} までの帰路を手配し証憑をまとめて交付。`,
        `${eatSecondary.name}에서 저녁 후 ${hotelName} 복귀 이동을 예약하고 증빙 패키지를 전달.`,
      ),
      score: mixedScore,
      grade: recommendationGrade(mixedScore),
      recommendationLevel: recommendationLevel(mixedScore, lang),
      etaWindow: L("30-60 分钟", "30-60 min", "30-60 分", "30-60분"),
      successRate7d: 0.9,
      riskLevel: "medium",
      riskLabel: L("中", "Medium", "中", "중간"),
      costRange: "CNY 98-220",
      openHours: "10:30-22:30",
      touristFriendlyScore: 4.6,
      paymentFriendly: L("Alipay / WeChat / 代付卡", "Alipay / WeChat / delegated card", "Alipay / WeChat / 委任カード", "Alipay / WeChat / 위임카드"),
      englishMenu: true,
      requires: ["location", "delegated_payment", "transport_lock"],
      placeName: eatSecondary.name || "-",
      hotelName,
      transportMode: L("餐后打车返程", "Taxi return after meal", "食後タクシー帰路", "식후 택시 복귀"),
      executionPlan: [
        L("锁定餐厅座位", "Lock restaurant table", "レストラン席を確保", "식당 좌석 잠금"),
        L("支付定金并生成到店凭证", "Pay deposit and issue arrival proof", "デポジット決済と来店証憑生成", "보증금 결제 및 방문 증빙 생성"),
        L("餐后叫车回酒店", "Dispatch ride back to hotel", "食後にホテルへ配車", "식후 호텔 복귀 차량 호출"),
        L("交付订单回执 + 导航 + 付款证明", "Deliver order receipt + navigation + payment proof", "注文控え + ナビ + 決済証明を交付", "주문 영수증 + 길안내 + 결제 증빙 전달"),
      ],
      comments: [
        L(`餐厅：${eatSecondary.name}；酒店：${hotelName}。适合需要完整晚间闭环的人群。`, `Restaurant: ${eatSecondary.name}; Hotel: ${hotelName}. Best for complete evening closure.`, `レストラン: ${eatSecondary.name} / ホテル: ${hotelName}。夜間の一括実行に最適。`, `식당: ${eatSecondary.name}, 호텔: ${hotelName}. 저녁 전체 흐름을 한 번에 끝내기에 적합.`),
        L(`交通会优先使用 ${transportModeTrip}，保证回程 ETA 可解释。`, `Return transport defaults to ${transportModeTrip} for predictable ETA.`, `帰路は ${transportModeTrip} を優先し、ETAの説明可能性を確保。`, `복귀 교통은 ${transportModeTrip} 우선으로 ETA 예측 가능성을 확보.`),
      ],
      analysis: [
        L("该路线把餐饮与返程合并执行，减少用户切换 App 的步骤。", "This lane combines dining and return transport to reduce app switching.", "食事と帰路を一体化し、アプリ切替を削減。", "식사와 복귀 이동을 통합해 앱 전환 단계를 줄입니다."),
        L(`若 ${eatSecondary.name} 满位，会自动切换 ${eatFamily.name} 并保留返程计划。`, `If ${eatSecondary.name} is full, it auto-switches to ${eatFamily.name} while preserving return transport.`, `${eatSecondary.name} が満席なら ${eatFamily.name} へ自動切替し、帰路計画は維持。`, `${eatSecondary.name} 만석 시 ${eatFamily.name}로 자동 전환하며 복귀 계획은 유지.`),
      ],
      tradeoffs: [
        L("总耗时高于单点用餐方案", "Total duration is longer than single dining-only lane", "単独の食事案より総時間は長い", "단일 식사 경로보다 총 소요 시간이 길다"),
        L("会同时依赖餐厅与交通可用性", "Depends on both restaurant and transport availability", "飲食と交通の両方の可用性に依存", "식당과 교통 가용성 모두에 의존"),
      ],
      candidates: [eatSecondary, eatFamily, hotelPrimary, transferPrimary].filter(Boolean),
      scoring: [
        { k: "closure_depth", v: 91 },
        { k: "comfort", v: 86 },
        { k: "cost_efficiency", v: budgetPref === "low" ? 90 : 82 },
      ],
    },
    {
      id: "airport-sla-lane",
      type: "travel",
      title: L(`${hotelName} -> 机场 · ${transferPrimary.name || transportModeTrip}`, `${hotelName} -> airport via ${transferPrimary.name || transportModeTrip}`, `${hotelName} -> 空港 · ${transferPrimary.name || transportModeTrip}`, `${hotelName} -> 공항 · ${transferPrimary.name || transportModeTrip}`),
      imagePath: transferPrimary.imageUrl || hotelPrimary.imageUrl || "https://images.unsplash.com/photo-1468071174046-657d9d351a40?auto=format&fit=crop&w=1200&q=80",
      prompt: L(
        `从 ${hotelName} 出发，使用 ${transferPrimary.name || transportModeTrip} 方案到机场，自动锁单与支付并交付二维码。`,
        `Depart from ${hotelName}, use ${transferPrimary.name || transportModeTrip} to airport, auto-lock and pay, then deliver QR proof.`,
        `${hotelName} から ${transferPrimary.name || transportModeTrip} で空港へ。手配ロックと決済を自動実行し、QR証憑を交付。`,
        `${hotelName}에서 ${transferPrimary.name || transportModeTrip}로 공항 이동, 예약 잠금/결제 자동 실행 후 QR 증빙 전달.`,
      ),
      score: travelScoreBoosted,
      grade: recommendationGrade(travelScoreBoosted),
      recommendationLevel: recommendationLevel(travelScoreBoosted, lang),
      etaWindow: usesSaverRoute ? L("55-90 分钟", "55-90 min", "55-90 分", "55-90분") : L("35-78 分钟", "35-78 min", "35-78 分", "35-78분"),
      successRate7d: usesSaverRoute ? 0.9 : 0.89,
      riskLevel: usesSaverRoute ? "medium" : "high",
      riskLabel: usesSaverRoute ? L("中", "Medium", "中", "중간") : L("高", "High", "高", "높음"),
      costRange: usesSaverRoute ? "CNY 60-118" : "CNY 120-260",
      openHours: "24/7",
      touristFriendlyScore: usesSaverRoute ? 4.5 : 4.6,
      paymentFriendly: L("Alipay / WeChat / 代付卡", "Alipay / WeChat / delegated card", "Alipay / WeChat / 委任カード", "Alipay / WeChat / 위임카드"),
      englishMenu: false,
      requires: ["location", "delegated_payment", "transport_lock"],
      placeName: transferPrimary.name || "-",
      hotelName,
      transportMode: transportModeTrip,
      executionPlan: [
        L("检查拥堵与时限可达性", "Check congestion and on-time feasibility", "渋滞と期限内到着可否を確認", "혼잡도와 정시 도착 가능성 확인"),
        L("锁定交通并预占资源", "Lock transport inventory", "交通リソースを確保", "교통 인벤토리 잠금"),
        L("执行支付并回写订单状态", "Execute payment and update order status", "決済実行後に注文状態を更新", "결제 실행 후 주문 상태 업데이트"),
        L("交付二维码、导航和回执", "Deliver QR, navigation and receipt", "QR・ナビ・レシートを交付", "QR/길안내/영수증 전달"),
      ],
      comments: [
        L(`出发酒店：${hotelName}；主路线：${transferPrimary.name || transportModeTrip}。`, `Origin hotel: ${hotelName}; primary route: ${transferPrimary.name || transportModeTrip}.`, `出発ホテル: ${hotelName} / 主ルート: ${transferPrimary.name || transportModeTrip}。`, `출발 호텔: ${hotelName}, 주 경로: ${transferPrimary.name || transportModeTrip}.`),
        L(`备用路线：${transferBackup.name || transferFast.name || transferSaver.name || "-"}` , `Backup route: ${transferBackup.name || transferFast.name || transferSaver.name || "-"}`, `予備ルート: ${transferBackup.name || transferFast.name || transferSaver.name || "-"}`, `대체 경로: ${transferBackup.name || transferFast.name || transferSaver.name || "-"}`),
      ],
      analysis: [
        needsAirport
          ? L("你当前有机场/时限意图，优先输出准点概率最高的交通方案。", "Airport/time-bound intent detected, prioritizing highest on-time transport lane.", "空港/時限制約の意図を検知し、定時確率の高い交通案を優先。", "공항/시간제약 의도가 감지되어 정시 확률이 높은 교통 경로를 우선합니다.")
          : L("该方案在多站点移动场景下更稳定，且支持自动支付闭环。", "This lane is stable for multi-stop mobility and supports payment closed loop.", "複数地点移動で安定し、決済クローズループに対応。", "다중 경유 이동에서 안정적이며 결제 클로즈 루프를 지원합니다."),
        strategySignals.weakSla
          ? L("当前 MCP SLA 偏弱，系统会更积极触发备选交通与人工兜底。", "MCP SLA is weaker now, so backup transport and human fallback are triggered more aggressively.", "MCP SLAが弱いため、代替交通/有人対応への切替閾値を下げています。", "MCP SLA가 약해 대체 교통/사람 백업 전환을 더 빠르게 수행합니다.")
          : L("当前 MCP SLA 健康，可维持自动化优先执行。", "MCP SLA is healthy, so automation-first execution remains enabled.", "MCP SLAは健全で自動実行優先を維持可能。", "MCP SLA가 안정적이어서 자동화 우선 실행을 유지합니다."),
      ],
      tradeoffs: [
        L("极端拥堵时可能触发路线切换", "Severe congestion may trigger route switching", "極端な渋滞時はルート切替の可能性", "극심한 혼잡 시 경로 전환 가능"),
        L("快线成本通常高于省钱线", "Fast lane usually costs more than saver route", "高速ルートは節約ルートより高コスト", "빠른 경로는 절약 경로보다 비용이 높음"),
      ],
      candidates: [hotelPrimary, transferPrimary, transferBackup, eatPrimary].filter(Boolean),
      scoring: [
        { k: "on_time_rate", v: usesSaverRoute ? 86 : 92 },
        { k: "route_resilience", v: 88 },
        { k: "cost_efficiency", v: usesSaverRoute ? 91 : 80 },
      ],
    },
  ];
  const conversationStage = inferConversationStage(
    String(task ? task.intent : (intentHint || "")),
    normalizedIntentHint || (task ? taskType : null),
  );
  const optionsWithLocalization = options.map((item) => {
    const placeDisplay = formatNameWithCnPinyin(item.placeName || "", lang);
    const hotelDisplay = formatNameWithCnPinyin(item.hotelName || "", lang);
    const actions = buildOptionActions(
      {
        ...item,
        placeDisplay,
        hotelDisplay,
      },
      conversationStage,
      lang,
    );
    return {
      ...item,
      placeDisplay,
      hotelDisplay,
      nextActions: actions,
    };
  });
  const focusPreferredOptionId = focusType === "travel"
    ? "airport-sla-lane"
    : focusType === "eat"
      ? "eat-specific-fastlane"
      : null;
  const rankedOptions = [...optionsWithLocalization].sort((a, b) => {
    const aTypeBoost = a.type === focusType ? 1 : 0;
    const bTypeBoost = b.type === focusType ? 1 : 0;
    if (aTypeBoost !== bTypeBoost) return bTypeBoost - aTypeBoost;
    const aFocusBoost = focusPreferredOptionId && a.id === focusPreferredOptionId ? 1 : 0;
    const bFocusBoost = focusPreferredOptionId && b.id === focusPreferredOptionId ? 1 : 0;
    if (aFocusBoost !== bFocusBoost) return bFocusBoost - aFocusBoost;
    return Number(b.score || 0) - Number(a.score || 0);
  });
  const bestByScore = rankedOptions[0];
  const selected = rankedOptions.find((item) => item.type === focusType) || bestByScore;
  const crossXChoice = {
    optionId: selected.id,
    title: selected.title,
    reason: L(
      `基于你的偏好（预算=${recommendationConstraints.budget || "-"}，距离=${recommendationConstraints.distance || recommendationConstraints.transport_mode || "-"}，时间=${recommendationConstraints.time || recommendationConstraints.eta || "-" }），我建议优先执行「${selected.title}」，它在成功率与执行链路上最稳。`,
      `Based on your preferences (budget=${recommendationConstraints.budget || "-"}, distance=${recommendationConstraints.distance || recommendationConstraints.transport_mode || "-"}, time=${recommendationConstraints.time || recommendationConstraints.eta || "-"}), start with "${selected.title}" because it is strongest on success rate and executable flow.`,
      `条件（budget=${recommendationConstraints.budget || "-"}, distance=${recommendationConstraints.distance || recommendationConstraints.transport_mode || "-"}, time=${recommendationConstraints.time || recommendationConstraints.eta || "-"})に基づき、「${selected.title}」を最優先に推奨します。成功率と実行安定性が最も高いです。`,
      `제약(budget=${recommendationConstraints.budget || "-"}, distance=${recommendationConstraints.distance || recommendationConstraints.transport_mode || "-"}, time=${recommendationConstraints.time || recommendationConstraints.eta || "-"}) 기준으로 "${selected.title}"를 우선 추천합니다. 성공률과 실행 안정성이 가장 높습니다.`,
    ),
    prompt: selected.prompt,
    recommendationLevel: selected.recommendationLevel || recommendationLevel(selected.score, lang),
    score: Number(selected.score || 0),
  };
  const comments = [
    L("当前推荐基于城市候选池，直接输出餐厅/酒店/交通的可执行方案。", "Recommendations now come from city candidate pools with concrete restaurant/hotel/transport execution plans.", "現在の推奨は都市候補プールから生成し、レストラン/ホテル/交通の実行案を直接提示します。", "추천은 도시 후보 풀을 기반으로 식당/호텔/교통 실행안을 직접 제공합니다."),
    L(`已实现毛利率 ${Math.round(markupRate * 100)}%，累计 ${revenue.orders} 笔商业化订单。`, `Realized markup ${Math.round(markupRate * 100)}% with ${revenue.orders} monetized orders.`, `実現マークアップ率 ${Math.round(markupRate * 100)}%、収益化注文 ${revenue.orders} 件。`, `실현 마진율 ${Math.round(markupRate * 100)}%, 수익화 주문 ${revenue.orders}건.`),
    L(`已结算订单对账匹配率 ${(reconMatch * 100).toFixed(1)}%，样本 ${Number(recon.checked || 0)} 笔。`, `Reconciliation match ${(reconMatch * 100).toFixed(1)}% across ${Number(recon.checked || 0)} settled orders.`, `照合一致率 ${(reconMatch * 100).toFixed(1)}%、対象 ${Number(recon.checked || 0)} 件。`, `정산 대사 일치율 ${(reconMatch * 100).toFixed(1)}%, 대상 ${Number(recon.checked || 0)}건.`),
    L(`MCP 合同覆盖 ${mcpContracts.enforcedContracts}/${mcpContracts.totalContracts}。`, `MCP contracts enforced on ${mcpContracts.enforcedContracts}/${mcpContracts.totalContracts} sources.`, `MCP契約適用 ${mcpContracts.enforcedContracts}/${mcpContracts.totalContracts}。`, `MCP 계약 적용 ${mcpContracts.enforcedContracts}/${mcpContracts.totalContracts}.`),
    L(`支付通道认证 ${certifiedRails}/${totalRails}。`, `Payment rail certification ${certifiedRails}/${totalRails} available rails.`, `決済レール認証 ${certifiedRails}/${totalRails}。`, `결제 레일 인증 ${certifiedRails}/${totalRails}.`),
    ...selected.comments,
  ];
  const reasons = [
    task
      ? L(`任务 ${task.id} 属于${taskType === "travel" ? "出行" : "餐饮"}意图，优先推荐「${selected.title}」以更快闭环。`, `Task ${task.id} is ${taskType} intent, so the ${selected.title} lane is prioritized for faster closure.`, `タスク ${task.id} は${taskType === "travel" ? "移動" : "飲食"}意図のため、「${selected.title}」を優先。`, `작업 ${task.id}은 ${taskType} 의도이므로 ${selected.title} 경로를 우선 추천합니다.`)
      : L(`当前产品组合偏向${portfolioFocus === "travel" ? "出行" : "餐饮"}，默认推荐该路线并保留其他备选。`, `Portfolio currently skews ${portfolioFocus}; recommendation defaults to that lane while keeping alternatives visible.`, `現在のポートフォリオは${portfolioFocus === "travel" ? "移動" : "飲食"}寄りのため、同系統を既定推奨。`, `현재 포트폴리오는 ${portfolioFocus} 중심이어서 해당 경로를 기본 추천합니다.`),
    recommendationConstraints && Object.keys(recommendationConstraints).length
      ? L(`已匹配约束：预算=${recommendationConstraints.budget || "-"}，距离=${recommendationConstraints.distance || recommendationConstraints.transport_mode || "-"}，时间=${recommendationConstraints.time || recommendationConstraints.eta || "-"}` , `Matched to constraints: budget=${recommendationConstraints.budget || "-"}, distance=${recommendationConstraints.distance || recommendationConstraints.transport_mode || "-"}, time=${recommendationConstraints.time || recommendationConstraints.eta || "-"}.`, `制約に一致: budget=${recommendationConstraints.budget || "-"}, distance=${recommendationConstraints.distance || recommendationConstraints.transport_mode || "-"}, time=${recommendationConstraints.time || recommendationConstraints.eta || "-"}.`, `제약 매칭: budget=${recommendationConstraints.budget || "-"}, distance=${recommendationConstraints.distance || recommendationConstraints.transport_mode || "-"}, time=${recommendationConstraints.time || recommendationConstraints.eta || "-"}.`)
      : L("当前无任务级约束，推荐基于全局运营信号。", "No task constraints provided; recommendation uses portfolio signals.", "タスク制約がないため、全体シグナルで推奨。", "작업 제약이 없어 포트폴리오 신호로 추천합니다."),
    ...selected.analysis,
    strategySignals.highHandoff
      ? L("当前人工接管工单偏高，建议维持礼宾排班与首响 SLA 监控。", "Open handoffs are elevated; keep concierge staffing and first-response SLA watchlist active.", "有人対応件数が高く、コンシェルジュ体制と初動SLA監視が必要。", "사람 상담 건수가 높아 컨시어지 인력 및 응답 SLA 모니터링이 필요합니다.")
      : L("当前人工接管队列健康，可继续推进自动化优先执行。", "Handoff queue is healthy; continue pushing automation-first execution.", "有人対応キューは健全。自動化優先を継続。", "상담 큐가 안정적이므로 자동화 우선 실행을 유지하세요."),
    L("继续保持 Chat-first 编排，可兼顾转化效率与信任可审计性。", "Keep chat-first orchestration because it preserves conversion while the trust layer remains auditable.", "Chat-first編成を維持し、転換効率と監査可能性を両立。", "채팅 중심 오케스트레이션을 유지해 전환과 감사 가능성을 함께 확보하세요."),
  ];

  return {
    title: L("Cross X 推荐方案", "Cross X Recommended Solution", "Cross X 推奨ソリューション", "Cross X 추천 솔루션"),
    subtitle: task
      ? L(`任务 ${task.id} 专属推荐`, `Task-scoped recommendation for ${task.id}`, `タスク ${task.id} 向け推奨`, `작업 ${task.id} 전용 추천`)
      : L("全局组合级推荐", "Portfolio-level recommendation", "ポートフォリオ推奨", "포트폴리오 추천"),
    taskId: task ? task.id : null,
    taskIntentType: task ? taskType : null,
    recommendedOptionId: selected.id,
    recommendedGrade: selected.grade || recommendationGrade(selected.score),
    recommendedLevel: selected.recommendationLevel || recommendationLevel(selected.score, lang),
    recommendedPrompt: selected.prompt,
    crossXChoice,
    conversationStage,
    imagePath: selected.imagePath,
    options: rankedOptions,
    comments,
    reasons,
    metrics: {
      closedLoopRate,
      openHandoffs,
      resolvedHandoffs: Number(funnel.handoffResolved || 0),
      mcpSlaRate: Number(mcpSla.metRate || 0),
      mcpContractCoverage: mcpCoverage,
      markupRateRealized: Number(revenue.markupRateRealized || 0),
      reconciliationMatchRate: Number(recon.matchRate || 0),
      reconciliationMismatched: Number(recon.mismatched || 0),
      railCertificationRate,
    },
  };
}

function buildPrdCoverage() {
  const releases = (db.miniProgram && db.miniProgram.releases) || [];
  const releaseChannels = new Set(releases.map((r) => r.channel));
  const miniReleasedBoth = releaseChannels.has("alipay") && releaseChannels.has("wechat");
  const contractSummary = buildMcpContractsSummary();
  const mcpSla = buildMcpSlaSummary();
  const compliance = buildPaymentComplianceSummary();
  const recon = buildReconciliationSummary();
  const railCompliance = Object.values(compliance.rails || {});
  const allRailsCertified =
    railCompliance.length > 0 &&
    railCompliance.every((item) => item && item.certified === true && item.kycPassed === true && item.pciDss === true && item.enabled === true);
  const actPolicyReady =
    compliance.policy &&
    compliance.policy.blockUncertifiedRails === true &&
    compliance.policy.requireFraudScreen === true;
  const mcpReady = contractSummary.enforcedContracts >= 5 && Number(mcpSla.metRate || 0) >= 0.95;
  const providersLive = Boolean(connectors.gaode.enabled && connectors.partnerHub && connectors.partnerHub.baseUrl);
  const fallbackExercised = Object.values(db.tasks || {}).some((task) => {
    const events = Array.isArray(task.fallbackEvents) ? task.fallbackEvents : [];
    const steps = Array.isArray(task.steps) ? task.steps : [];
    return events.length > 0 || steps.some((step) => step.status === "fallback_to_human");
  });
  const handoffResolved = (db.supportTickets || []).some((ticket) => ticket.status === "resolved");
  const workflowReady = fallbackExercised && handoffResolved;
  const hasOrders = Object.keys(db.orders || {}).length > 0;
  const hasProofBundle = Object.values(db.orders || {}).some((order) => Array.isArray(order.proofItems) && order.proofItems.length >= 3);
  const routingReady = Object.values(db.tasks || {}).some(
    (task) =>
      task &&
      task.sessionState &&
      Array.isArray(task.sessionState.missingSlots) &&
      task.expertRoute &&
      Array.isArray(task.expertRoute.experts),
  );
  const tripPlans = Object.values(db.tripPlans || {});
  const tripPlanReady = tripPlans.some((plan) => Array.isArray(plan.taskIds) && plan.taskIds.length > 0);
  const settlementReady = Array.isArray(db.settlements) && db.settlements.length > 0;
  const commercialReady = settlementReady && Number(recon.matchRate || 0) >= 0.95;
  const actReady = allRailsCertified && actPolicyReady && hasOrders;
  const miniClientReady = miniReleasedBoth && hasMiniClientPages();
  const modules = [
    {
      name: "Chat as UI",
      status: hasProofBundle ? "done" : "partial",
      done: [
        "Plan/Confirm/Execution/Deliverable cards",
        "Near Me quick intent back to chat",
        "Task replan API and editable plan card workflow",
        "Template-driven replan drawer with non-destructive preview",
        "Step-level status model with ETA, retry, fallback-to-human signals",
        "Confirm card data upgraded with deliverables/breakdown/guarantee fields",
        "Drawer/Modal focus trap + ESC handling",
        "CN/EN/JA/KO language switching",
        "Single-dialog mode + closed-loop progress rail + continuous talk mode",
      ],
      remaining: hasProofBundle ? [] : ["Generate user-facing proof media bundle (not placeholder-only) for every completed task"],
    },
    {
      name: "Routing + Session State",
      status: routingReady ? "done" : "partial",
      done: [
        "Routing-based domain experts (Eat/Mobility/Payment/Trust/Support)",
        "Task session state with slots + missing_slots + stage + laneId",
        "State API for slot patching and partial replan",
      ],
      remaining: routingReady ? [] : ["Need live traffic to verify slot completion quality and missing-slot prompts"],
    },
    {
      name: "Trip Plan",
      status: tripPlanReady ? "done" : "partial",
      done: [
        "Create lightweight trip plan",
        "Attach multiple tasks into one trip timeline",
        "Trip-level progress/order/proof aggregation",
        "Trips API for summary and detail rendering",
      ],
      remaining: tripPlanReady ? [] : ["Create at least one trip with attached tasks and proof records in production-like flow"],
    },
    {
      name: "Agentic Workflow",
      status: workflowReady ? "done" : "partial",
      done: [
        "Eat + Travel atomic steps",
        "Pause/Resume/Cancel + fallback timeline",
        "Step fallback path (fallback_to_human/skipped/retry-requested states)",
        "Human handoff ticket lifecycle hooks",
      ],
      remaining: workflowReady ? [] : ["Need broader failure/handoff drill coverage with resolved ticket loop in live-like flows"],
    },
    {
      name: "MCP Layer",
      status: mcpReady && providersLive ? "done" : "partial",
      done: [
        "Query/Book/Pay/Cancel/Status unified semantics",
        "Request/response/latency call chain",
        "SLA contract fields (slaMs/slaMet/provider/sourceTs)",
        "Strict SLA policy switch (fail on breach)",
        "External source contract registry and runtime SLA override",
        "Provider probe diagnostics (mode/key/sampleCalls/p95/SLA)",
      ],
      remaining: mcpReady && providersLive
        ? []
        : ["Enable both live providers (Gaode + PartnerHub) and keep SLA met rate >=95% under real traffic"],
    },
    {
      name: "ACT Payment Trust",
      status: actReady ? "done" : "partial",
      done: [
        "No-PIN limits and high-amount second factor simulation",
        "Operation chain explainability UI",
        "Proof chain request/response summaries and selection reasons",
        "Selectable ACT payment rails (Alipay/WeChat/Card Delegate) in execution path",
        "Rail compliance policy and certification gating",
      ],
      remaining: actReady ? [] : ["Connect production payment callbacks/receipts and validate refund lifecycle with real gateway states"],
    },
    {
      name: "Mini Program Delivery",
      status: miniClientReady ? "done" : "partial",
      done: [
        "Share-card payload contract for Alipay/WeChat path handoff",
        ...(miniReleasedBoth ? ["Alipay + WeChat release pipeline verified"] : []),
      ],
      remaining: miniClientReady ? [] : ["Implement and pass QA on real mini-program client pages (chat/trips/trust/me)"],
    },
    {
      name: "Commercialization",
      status: commercialReady ? "done" : "partial",
      done: [
        "Plus subscription entry and merchant wording",
        "Net-price markup engine with gross/net/markup dashboard",
        "Settlement ledger and reconciliation batch API",
        "External provider ledger and mismatch detection controls",
      ],
      remaining: commercialReady ? [] : ["Reach stable reconciliation >=95% with settlement batch continuity in ongoing operations"],
    },
  ];

  const score = modules.reduce((sum, m) => sum + (m.status === "done" ? 1 : m.status === "partial" ? 0.5 : 0), 0);
  const percent = Math.round((score / modules.length) * 100);
  const remaining = modules.flatMap((m) => m.remaining.map((r) => `${m.name}: ${r}`));
  return {
    percent,
    modules,
    remaining,
  };
}

function normalizeSupportActor(actor) {
  const raw = String(actor || "user").toLowerCase();
  if (raw === "ops" || raw === "agent" || raw === "human") return "ops";
  if (raw === "system" || raw === "bot") return "system";
  return "user";
}

function normalizeSupportSessionStatus(status) {
  const raw = String(status || "").toLowerCase();
  if (raw === "active" || raw === "waiting" || raw === "closed") return raw;
  return "waiting";
}

function createSupportSessionId() {
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function createSupportMessageId() {
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
}

function ensureSupportSessionShape(session) {
  if (!session || typeof session !== "object") return null;
  if (!Array.isArray(session.messages)) session.messages = [];
  if (!session.unread || typeof session.unread !== "object") session.unread = { user: 0, ops: 0 };
  if (!session.presence || typeof session.presence !== "object") {
    session.presence = {
      user: { online: false, lastSeenAt: null },
      ops: { online: false, lastSeenAt: null },
    };
  }
  if (!session.presence.user) session.presence.user = { online: false, lastSeenAt: null };
  if (!session.presence.ops) session.presence.ops = { online: false, lastSeenAt: null };
  if (!Array.isArray(session.linkedTickets)) session.linkedTickets = [];
  if (!session.createdAt) session.createdAt = nowIso();
  if (!session.updatedAt) session.updatedAt = nowIso();
  session.status = normalizeSupportSessionStatus(session.status);
  return session;
}

function getSupportSessionById(sessionId) {
  const id = String(sessionId || "");
  if (!id) return null;
  const session = db.supportSessions[id];
  if (!session) return null;
  return ensureSupportSessionShape(session);
}

function getSupportSessionByTicketId(ticketId) {
  const tid = String(ticketId || "");
  if (!tid) return null;
  return (
    Object.values(db.supportSessions || {}).find(
      (item) => item && String(item.ticketId || "") === tid,
    ) || null
  );
}

function appendSupportSessionMessage(session, payload = {}) {
  const target = ensureSupportSessionShape(session);
  if (!target) return null;
  const actor = normalizeSupportActor(payload.actor || payload.role || "user");
  const requestedType = String(payload.type || "text").toLowerCase();
  const type = requestedType === "voice" ? "voice" : requestedType === "event" ? "event" : "text";
  const text = String(payload.text || "").trim();
  const audioDataUrl = String(payload.audioDataUrl || "");
  const durationSec = Math.max(0, Number(payload.durationSec || 0));
  const meta = payload.meta && typeof payload.meta === "object" ? payload.meta : {};
  const message = {
    id: createSupportMessageId(),
    actor,
    type,
    text: text.slice(0, 600),
    audioDataUrl: type === "voice" ? audioDataUrl : "",
    durationSec: type === "voice" ? durationSec : 0,
    at: nowIso(),
    meta,
  };
  target.messages.push(message);
  if (target.messages.length > 120) {
    target.messages = target.messages.slice(-120);
  }
  target.updatedAt = nowIso();
  if (actor === "user") {
    target.unread.ops = Math.max(0, Number(target.unread.ops || 0)) + 1;
    target.presence.user = { ...target.presence.user, online: true, lastSeenAt: nowIso() };
  } else if (actor === "ops") {
    target.unread.user = Math.max(0, Number(target.unread.user || 0)) + 1;
    target.presence.ops = { ...target.presence.ops, online: true, lastSeenAt: nowIso() };
  }
  if (target.status === "waiting" && actor === "ops") {
    target.status = "active";
  }
  return message;
}

function buildSupportSessionSummary(session) {
  const target = ensureSupportSessionShape(session);
  if (!target) return null;
  const lastMessage = target.messages.length ? target.messages[target.messages.length - 1] : null;
  return {
    id: target.id,
    ticketId: target.ticketId || null,
    taskId: target.taskId || null,
    status: target.status,
    assignedAgentId: target.assignedAgentId || null,
    assignedAgentName: target.assignedAgentName || null,
    unread: {
      user: Math.max(0, Number(target.unread.user || 0)),
      ops: Math.max(0, Number(target.unread.ops || 0)),
    },
    presence: {
      user: target.presence.user || { online: false, lastSeenAt: null },
      ops: target.presence.ops || { online: false, lastSeenAt: null },
    },
    messageCount: target.messages.length,
    voiceMessageCount: target.messages.filter((item) => item.type === "voice").length,
    lastMessage: lastMessage
      ? {
          actor: lastMessage.actor,
          type: lastMessage.type,
          text: String(lastMessage.text || "").slice(0, 120),
          at: lastMessage.at,
        }
      : null,
    createdAt: target.createdAt,
    updatedAt: target.updatedAt,
  };
}

function ensureSupportSessionForTicket(ticket, opts = {}) {
  if (!ticket || typeof ticket !== "object") return null;
  const currentId = ticket.sessionId ? String(ticket.sessionId) : "";
  if (currentId) {
    const existing = getSupportSessionById(currentId);
    if (existing) {
      if (!existing.ticketId) existing.ticketId = ticket.id;
      if (!existing.taskId && ticket.taskId) existing.taskId = ticket.taskId;
      if (!Array.isArray(existing.linkedTickets)) existing.linkedTickets = [];
      if (!existing.linkedTickets.includes(ticket.id)) existing.linkedTickets.push(ticket.id);
      return existing;
    }
  }
  const fallback = getSupportSessionByTicketId(ticket.id);
  if (fallback) {
    ticket.sessionId = fallback.id;
    if (!Array.isArray(fallback.linkedTickets)) fallback.linkedTickets = [];
    if (!fallback.linkedTickets.includes(ticket.id)) fallback.linkedTickets.push(ticket.id);
    return ensureSupportSessionShape(fallback);
  }
  const sessionId = createSupportSessionId();
  const now = nowIso();
  const session = ensureSupportSessionShape({
    id: sessionId,
    ticketId: ticket.id,
    taskId: ticket.taskId || null,
    linkedTickets: [ticket.id],
    status: ticket.status === "resolved" ? "closed" : ticket.status === "in_progress" ? "active" : "waiting",
    channel: opts.channel || "voice_chat_room",
    startedBy: normalizeSupportActor(opts.startedBy || "user"),
    reason: opts.reason || ticket.reason || "support_requested",
    assignedAgentId: null,
    assignedAgentName: null,
    unread: { user: 0, ops: 0 },
    presence: {
      user: { online: false, lastSeenAt: null },
      ops: { online: false, lastSeenAt: null },
    },
    messages: [],
    createdAt: now,
    updatedAt: now,
  });
  db.supportSessions[session.id] = session;
  ticket.sessionId = session.id;
  if (opts.skipGreeting !== true) {
    appendSupportSessionMessage(session, {
      actor: "system",
      type: "event",
      text: opts.greeting || "Emergency support room is ready. You can send text or voice.",
      meta: { source: ticket.source || "manual", ticketId: ticket.id },
    });
  }
  return session;
}

function findTaskByTicketId(ticketId) {
  return Object.values(db.tasks).find((t) => t.handoff && t.handoff.ticketId === ticketId) || null;
}

function findTicketBySessionId(sessionId) {
  const sid = String(sessionId || "");
  if (!sid) return null;
  return (db.supportTickets || []).find((item) => String(item.sessionId || "") === sid) || null;
}

function touchTicketFromSession(session, note = "session_updated") {
  const target = ensureSupportSessionShape(session);
  if (!target) return null;
  const ticket = findTicketBySessionId(target.id) || ((db.supportTickets || []).find((t) => String(t.id) === String(target.ticketId || "")) || null);
  if (!ticket) return null;
  ticket.sessionId = target.id;
  ticket.updatedAt = nowIso();
  if (!Array.isArray(ticket.history)) ticket.history = [];
  ticket.history.push({ at: nowIso(), status: ticket.status || "open", note: String(note || "session_updated").slice(0, 120) });
  return ticket;
}

function syncTaskByTicket(ticket, lifecycleNote = "") {
  const task = findTaskByTicketId(ticket && ticket.id);
  if (!task || !task.handoff) return null;
  task.handoff.status = ticket.status;
  task.handoff.updatedAt = ticket.updatedAt;
  if (ticket.resolvedAt) task.handoff.resolvedAt = ticket.resolvedAt;
  if (ticket.sessionId) task.handoff.sessionId = ticket.sessionId;
  syncTaskAgentMeta(task, ticket.status === "resolved" ? mapTaskStatusToSessionStage(task.status) : "support");
  refreshTripByTask(task);
  if (lifecycleNote) {
    lifecyclePush(
      task.lifecycle,
      ticket.status === "resolved" ? "handoff_resolved" : "handoff_in_progress",
      ticket.status === "resolved" ? "Human handoff resolved" : "Human handoff in progress",
      lifecycleNote,
    );
  }
  task.updatedAt = nowIso();
  return task;
}

function updateTicketStatus(ticket, toStatus) {
  const from = ticket.status;
  const allowed =
    (from === "open" && toStatus === "in_progress") ||
    (from === "in_progress" && toStatus === "resolved");
  if (!allowed) {
    return { ok: false, error: `Invalid transition: ${from} -> ${toStatus}` };
  }

  ticket.status = toStatus;
  ticket.updatedAt = nowIso();
  if (toStatus === "in_progress") {
    ticket.acceptedAt = nowIso();
    ticket.handler = "human";
    ticket.etaMin = 3;
  }
  if (toStatus === "resolved") {
    ticket.resolvedAt = nowIso();
    ticket.handler = "human";
    ticket.etaMin = 0;
  }
  ticket.history.push({ at: nowIso(), status: toStatus, note: "updated" });
  if (ticket.sessionId) {
    const session = getSupportSessionById(ticket.sessionId);
    if (session) {
      if (toStatus === "in_progress" && session.status === "waiting") session.status = "active";
      if (toStatus === "resolved") session.status = "closed";
      session.updatedAt = nowIso();
    }
  }
  return { ok: true, from, to: toStatus };
}

function createSupportTicket({ reason, taskId = null, source = "manual" }) {
  const botHandled = source === "auto_fallback" ? false : true;
  const ticket = {
    id: `help_${Date.now().toString().slice(-8)}`,
    taskId,
    source,
    reason: reason || "unspecified",
    status: "open",
    channel: "Cross X human concierge",
    eta: "2-5 min",
    etaMin: 5,
    handler: botHandled ? "bot" : "human",
    evidence: [],
    acceptedAt: null,
    resolvedAt: null,
    sessionId: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    history: [{ at: nowIso(), status: "open", note: "created" }],
  };
  db.supportTickets.push(ticket);
  if (db.supportTickets.length > 200) {
    db.supportTickets = db.supportTickets.slice(-200);
  }
  const session = ensureSupportSessionForTicket(ticket, {
    startedBy: source === "emergency_button" ? "user" : "system",
    reason: ticket.reason,
    greeting:
      source === "emergency_button"
        ? "Emergency request received. Human support room opened for voice/text conversation."
        : "Human support room has been created for this ticket.",
  });
  if (session) ticket.sessionId = session.id;
  return ticket;
}

function parseIsoToMs(value) {
  const ts = Date.parse(value || "");
  if (!Number.isFinite(ts)) return Date.now();
  return ts;
}

function supportPriorityWeight(priority) {
  if (priority === "critical") return 3;
  if (priority === "high") return 2;
  if (priority === "normal") return 1;
  return 0;
}

function supportTicketRuntime(ticket) {
  const status = String(ticket.status || "open").toLowerCase();
  const anchorAt = (status === "in_progress" || status === "resolved") && ticket.acceptedAt ? ticket.acceptedAt : ticket.createdAt;
  const startedAtMs = parseIsoToMs(anchorAt);
  const elapsedMin = Math.max(0, Math.round((Date.now() - startedAtMs) / 60000));
  const etaBase = Math.max(0, Number(ticket.etaMin || 0));
  const remainingEtaMin = Math.max(0, etaBase - elapsedMin);
  const overdueMin = etaBase > 0 ? Math.max(0, elapsedMin - etaBase) : 0;
  return {
    elapsedMin,
    remainingEtaMin,
    overdueMin,
  };
}

function buildTicketTaskSnapshot(task) {
  if (!task) return null;
  const constraints = (task.plan && task.plan.constraints) || task.constraints || {};
  return {
    taskId: task.id,
    status: task.status || "unknown",
    intent: task.intent || "",
    city: constraints.city || db.users.demo.city || "Shanghai",
    updatedAt: task.updatedAt || task.createdAt || nowIso(),
  };
}

function deriveTaskIssueReason(task) {
  if (!task) return "manual_review_required";
  const fallback = Array.isArray(task.fallbackEvents) ? task.fallbackEvents[task.fallbackEvents.length - 1] : null;
  if (fallback && fallback.reason) return String(fallback.reason).slice(0, 180);
  const failedStep = Array.isArray(task.steps)
    ? task.steps.find((step) => ["failed", "fallback_to_human"].includes(String(step.status || "").toLowerCase()))
    : null;
  if (failedStep) return `${failedStep.label || failedStep.id || "step"} failed`;
  const failedLifecycle = Array.isArray(task.lifecycle)
    ? [...task.lifecycle].reverse().find((item) => ["failed", "canceled"].includes(String(item.state || "").toLowerCase()))
    : null;
  if (failedLifecycle && failedLifecycle.note) return String(failedLifecycle.note).slice(0, 180);
  return "manual_review_required";
}

function classifySupportTicket(ticket) {
  const liveSession = ensureSupportSessionForTicket(ticket, { skipGreeting: true, startedBy: "system" });
  const status = String(ticket.status || "open").toLowerCase();
  const runtime = supportTicketRuntime(ticket);
  const task = ticket.taskId ? db.tasks[ticket.taskId] || null : null;
  const taskStatus = String((task && task.status) || "");
  const hasFailedStep = Boolean(
    task &&
      Array.isArray(task.steps) &&
      task.steps.some((step) => ["failed", "fallback_to_human"].includes(String(step.status || "").toLowerCase())),
  );
  const reasonText = `${String(ticket.reason || "")} ${String(ticket.source || "")}`.toLowerCase();
  const escalationReasons = [];
  let priority = "normal";

  if (status !== "resolved") {
    if (/emergency|urgent|immediate|asap|priority|紧急|立刻|马上|立即|加急/.test(reasonText) || ticket.source === "emergency_button") {
      priority = "critical";
      escalationReasons.push("emergency_signal");
    }
    if (task && ["failed", "canceled"].includes(taskStatus)) {
      if (priority !== "critical") priority = "high";
      escalationReasons.push("task_failed");
    }
    if (hasFailedStep) {
      if (priority !== "critical") priority = "high";
      escalationReasons.push("step_failed");
    }
    if (status === "open" && runtime.elapsedMin >= 3 && priority === "normal") {
      priority = "high";
      escalationReasons.push("awaiting_claim");
    }
    if (runtime.overdueMin > 0) {
      if (priority !== "critical") priority = "high";
      escalationReasons.push("sla_overdue");
    }
    if (status === "in_progress" && runtime.overdueMin >= 5) {
      priority = "critical";
      escalationReasons.push("in_progress_overdue");
    }
  }

  let nextAction = "view_detail";
  if (status === "open") nextAction = "assign_now";
  if (status === "in_progress") nextAction = "resolve_or_collect_evidence";
  if (status === "resolved") nextAction = "archive_review";

  const needsImmediate = status !== "resolved" && (priority === "critical" || priority === "high");
  return {
    ...ticket,
    sessionId: ticket.sessionId || (liveSession && liveSession.id) || null,
    liveSession: liveSession ? buildSupportSessionSummary(liveSession) : null,
    status,
    priority,
    needsImmediate,
    escalationReasons,
    elapsedMin: runtime.elapsedMin,
    remainingEtaMin: runtime.remainingEtaMin,
    overdueMin: runtime.overdueMin,
    recommendedAction: nextAction,
    task: buildTicketTaskSnapshot(task),
  };
}

function buildSupportOpsBoard(limit = 80) {
  const maxLimit = Math.max(10, Math.min(200, Number(limit || 80)));
  const tickets = (db.supportTickets || [])
    .slice(-maxLimit)
    .map((ticket) => classifySupportTicket(ticket))
    .sort((a, b) => {
      const statusA = String(a.status || "");
      const statusB = String(b.status || "");
      if (statusA === "resolved" && statusB !== "resolved") return 1;
      if (statusB === "resolved" && statusA !== "resolved") return -1;
      const priorityDiff = supportPriorityWeight(b.priority) - supportPriorityWeight(a.priority);
      if (priorityDiff) return priorityDiff;
      const overdueDiff = Number(b.overdueMin || 0) - Number(a.overdueMin || 0);
      if (overdueDiff) return overdueDiff;
      return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
    });

  const immediate = tickets.filter((ticket) => ticket.needsImmediate && ticket.status !== "resolved");
  const pending = tickets.filter((ticket) => ticket.status === "open" && !ticket.needsImmediate);
  const inProgress = tickets.filter((ticket) => ticket.status === "in_progress" && !ticket.needsImmediate);
  const resolved = tickets.filter((ticket) => ticket.status === "resolved");

  const issuesWithoutTicket = Object.values(db.tasks || {})
    .filter((task) => {
      const activeHandoff =
        task &&
        task.handoff &&
        ["open", "in_progress"].includes(String(task.handoff.status || "").toLowerCase());
      if (activeHandoff) return false;
      const status = String(task.status || "").toLowerCase();
      if (["failed", "canceled"].includes(status)) return true;
      if (Array.isArray(task.steps) && task.steps.some((step) => ["failed", "fallback_to_human"].includes(String(step.status || "").toLowerCase()))) {
        return status !== "completed";
      }
      return false;
    })
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
    .slice(0, 40)
    .map((task) => ({
      taskId: task.id,
      intent: task.intent || "",
      status: task.status || "unknown",
      city: ((task.plan && task.plan.constraints && task.plan.constraints.city) || (task.constraints && task.constraints.city) || db.users.demo.city || "Shanghai"),
      updatedAt: task.updatedAt || task.createdAt || nowIso(),
      reason: deriveTaskIssueReason(task),
      suggestedAction: "create_handoff",
    }));

  const firstResponseDurations = (db.supportTickets || [])
    .filter((ticket) => ticket.createdAt && ticket.acceptedAt)
    .map((ticket) => Math.max(0, Math.round((parseIsoToMs(ticket.acceptedAt) - parseIsoToMs(ticket.createdAt)) / 60000)));
  const resolveDurations = (db.supportTickets || [])
    .filter((ticket) => ticket.createdAt && ticket.resolvedAt)
    .map((ticket) => Math.max(0, Math.round((parseIsoToMs(ticket.resolvedAt) - parseIsoToMs(ticket.createdAt)) / 60000)));
  const avg = (arr) => (arr.length ? Number((arr.reduce((sum, val) => sum + val, 0) / arr.length).toFixed(1)) : null);
  const liveSessions = Object.values(db.supportSessions || {})
    .map((session) => ensureSupportSessionShape(session))
    .filter(Boolean);
  const liveOpenCount = liveSessions.filter((session) => ["waiting", "active"].includes(session.status)).length;
  const liveVoiceCount = liveSessions.filter((session) => session.messages.some((item) => item.type === "voice")).length;
  const waitingForOpsCount = liveSessions.filter((session) => Number((session.unread && session.unread.ops) || 0) > 0 && session.status !== "closed").length;

  return {
    generatedAt: nowIso(),
    summary: {
      total: tickets.length,
      immediate: immediate.length,
      pending: pending.length,
      inProgress: inProgress.length,
      resolved: resolved.length,
      overdue: tickets.filter((ticket) => Number(ticket.overdueMin || 0) > 0 && ticket.status !== "resolved").length,
      issuesWithoutTicket: issuesWithoutTicket.length,
      avgFirstResponseMin: avg(firstResponseDurations),
      avgResolveMin: avg(resolveDurations),
      liveSessions: liveOpenCount,
      liveVoiceSessions: liveVoiceCount,
      waitingForOps: waitingForOpsCount,
    },
    queues: {
      immediate,
      pending,
      inProgress,
      resolved,
      issuesWithoutTicket,
    },
  };
}

function applyTicketTransitionAndSync(ticket, toStatus, lifecycleNote = "") {
  const updated = updateTicketStatus(ticket, toStatus);
  if (!updated.ok) return updated;
  syncTaskByTicket(ticket, lifecycleNote || `Ticket ${ticket.id} -> ${ticket.status}`);
  return { ok: true, from: updated.from, to: updated.to, ticket };
}

function listSupportSessions({ actor = "user", statuses = [], limit = 40, ticketId = "", taskId = "" } = {}) {
  const role = normalizeSupportActor(actor);
  const statusSet = new Set(
    (Array.isArray(statuses) ? statuses : String(statuses || "").split(","))
      .map((item) => normalizeSupportSessionStatus(item))
      .filter(Boolean),
  );
  const maxLimit = Math.max(1, Math.min(120, Number(limit || 40)));
  return Object.values(db.supportSessions || {})
    .map((session) => ensureSupportSessionShape(session))
    .filter(Boolean)
    .filter((session) => {
      if (statusSet.size && !statusSet.has(session.status)) return false;
      if (ticketId && String(session.ticketId || "") !== String(ticketId)) return false;
      if (taskId && String(session.taskId || "") !== String(taskId)) return false;
      if (role === "user") return session.status !== "closed" || Number((session.unread && session.unread.user) || 0) > 0;
      return true;
    })
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
    .slice(0, maxLimit);
}

function readSupportSession(session, actor = "user") {
  const target = ensureSupportSessionShape(session);
  if (!target) return null;
  const role = normalizeSupportActor(actor);
  if (role === "user" || role === "ops") {
    target.unread[role] = 0;
    target.presence[role] = { ...target.presence[role], lastSeenAt: nowIso(), online: true };
    target.updatedAt = nowIso();
  }
  return target;
}

function setSupportSessionPresence(session, actor = "user", online = true) {
  const target = ensureSupportSessionShape(session);
  if (!target) return null;
  const role = normalizeSupportActor(actor);
  if (role !== "user" && role !== "ops") return target;
  target.presence[role] = {
    ...target.presence[role],
    online: online === true,
    lastSeenAt: nowIso(),
  };
  target.updatedAt = nowIso();
  return target;
}

function closeSupportSession(session, note = "closed_by_operator") {
  const target = ensureSupportSessionShape(session);
  if (!target) return null;
  target.status = "closed";
  target.updatedAt = nowIso();
  target.presence.user = { ...target.presence.user, online: false, lastSeenAt: nowIso() };
  target.presence.ops = { ...target.presence.ops, online: false, lastSeenAt: nowIso() };
  appendSupportSessionMessage(target, {
    actor: "system",
    type: "event",
    text: note || "Session closed",
    meta: { action: "close" },
  });
  return target;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk.toString("utf8");
      if (data.length > 1e6) reject(new Error("Payload too large"));
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function writeJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "X-CrossX-Build": BUILD_ID,
  });
  res.end(body);
}

function mimeType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  return "text/plain; charset=utf-8";
}

function serveStatic(req, res) {
  const parsed = parseUrl(req.url);
  const rel = parsed.pathname === "/" ? "/index.html" : parsed.pathname;
  const safePath = path.normalize(rel).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) return writeJson(res, 403, { error: "Forbidden" });

  fs.readFile(filePath, (err, content) => {
    if (err) return writeJson(res, 404, { error: "Not found" });
    res.writeHead(200, {
      "Content-Type": mimeType(filePath),
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
      "X-CrossX-Build": BUILD_ID,
    });
    res.end(content);
  });
}

const audit = createAuditLogger({
  appendFn(event) {
    db.auditLogs.push({
      id: `log_${db.auditLogs.length + 1}`,
      at: nowIso(),
      hash: `h_${Date.now()}_${db.auditLogs.length + 1}`,
      ...event,
    });
    saveDb();
  },
  readFn(limit) {
    return db.auditLogs.slice(-limit).reverse();
  },
});

const connectors = {
  gaode: createGaodeConnector({
    key: process.env.GAODE_KEY || process.env.AMAP_KEY || "",
    city: process.env.CITY || "Shanghai",
  }),
  partnerHub: createPartnerHubConnector({
    key: process.env.PARTNER_HUB_KEY || "",
    baseUrl: process.env.PARTNER_HUB_BASE_URL || "",
    provider: process.env.PARTNER_HUB_PROVIDER || "",
    timeoutMs: process.env.PARTNER_HUB_TIMEOUT_MS || "",
    channels: process.env.PARTNER_HUB_CHANNELS || "",
  }),
};
const paymentRails = createPaymentRailManager({
  checkRailAllowed(railId) {
    return canUseRail(railId);
  },
});
const tools = createToolRegistry({ connectors, payments: paymentRails });
const confirmPolicy = createConfirmPolicy({
  getSingleLimit() {
    return db.users.demo.authDomain.singleLimit;
  },
});
const orchestrator = createOrchestrator({ tools, audit });

function createTask(payload) {
  const userId = payload.userId || "demo";
  const user = db.users[userId] || db.users.demo;
  const incomingConstraints = payload.constraints && typeof payload.constraints === "object" ? { ...payload.constraints } : {};
  if (!incomingConstraints.city) incomingConstraints.city = user.city || "Shanghai";
  if (user && user.location && Number.isFinite(Number(user.location.lat)) && Number.isFinite(Number(user.location.lng))) {
    if (!incomingConstraints.originLat) incomingConstraints.originLat = Number(user.location.lat);
    if (!incomingConstraints.originLng) incomingConstraints.originLng = Number(user.location.lng);
    if (!incomingConstraints.origin) incomingConstraints.origin = "current_location";
  }
  const id = `task_${Object.keys(db.tasks).length + 1}`;
  const plan = orchestrator.planTask({
    taskId: id,
    userId,
    intent: payload.intent || "",
    constraints: incomingConstraints,
  });
  const task = {
    id,
    userId,
    intent: payload.intent || "",
    constraints: incomingConstraints,
    status: "planned",
    plan,
    timeline: [],
    steps: (plan.steps || []).map(normalizeStep),
    payments: [],
    mcpCalls: [],
    pricing: null,
    paymentRailSnapshot: "alipay_cn",
    fallbackEvents: [],
    flagSnapshot: {},
    handoff: null,
    pauseState: "active",
    deliverable: null,
    lifecycle: [
      {
        state: "created",
        label: "Task created",
        at: nowIso(),
        note: "Intent captured from one sentence.",
      },
      {
        state: "planned",
        label: "Plan generated",
        at: nowIso(),
        note: "Atomic workflow prepared for execution.",
      },
    ],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  const tripId = payload.tripId ? String(payload.tripId) : "";
  if (tripId) {
    task.tripId = tripId;
  }
  db.tasks[id] = task;
  applyTaskRuntimePolicy(task);
  task.steps = (task.plan.steps || []).map(normalizeStep);
  if (tripId && db.tripPlans[tripId]) {
    const attached = attachTaskToTripPlan(task, tripId);
    if (attached) {
      lifecyclePush(task.lifecycle, "trip_attached", "Attached to trip", `Trip ${tripId}`);
    }
  }

  audit.append({
    kind: "task",
    who: task.userId,
    what: "task.created",
    taskId: id,
    toolInput: { intent: task.intent, constraints: task.constraints },
    toolOutput: { planTitle: task.plan.title, stepCount: task.plan.steps.length },
  });
  pushMetricEvent({
    kind: "task_created",
    userId: task.userId,
    taskId: task.id,
    intentType: task.plan.intentType,
    flags: Object.keys(task.flagSnapshot || {}).filter((k) => task.flagSnapshot[k].active),
  });
  saveDb();
  return task;
}

function createOrderForTask(task, proof) {
  const orderId = `order_${Object.keys(db.orders).length + 1}`;
  const pricing = task.pricing || task.plan.confirm.pricing || buildQuote({ intentType: task.plan.intentType, currency: task.plan.confirm.currency });
  const createdAt = nowIso();
  const proofOrderNo = `CX${Date.now().toString().slice(-8)}`;
  const proofObj = {
    qrText: `CROSSX-${orderId}-${Date.now()}`,
    orderNo: proofOrderNo,
    bilingualAddress: proof?.bilingualAddress || "CN/EN address pending",
    navLink: proof?.navLink || "https://maps.google.com",
    itinerary: proof?.itinerary || "Generated by Cross X",
  };
  const proofItems = [
    {
      id: `${orderId}_receipt`,
      type: "order_receipt",
      title: "Order receipt",
      hash: makeProofHash(`${orderId}:receipt:${proofOrderNo}`),
      generatedAt: createdAt,
      content: proofOrderNo,
    },
    {
      id: `${orderId}_payment`,
      type: "payment_proof",
      title: "Payment voucher",
      hash: makeProofHash(`${orderId}:payment:${pricing.finalPrice}`),
      generatedAt: createdAt,
      content: `${pricing.finalPrice} ${pricing.currency}`,
    },
    {
      id: `${orderId}_nav`,
      type: "navigation_card",
      title: "Bilingual navigation card",
      hash: makeProofHash(`${orderId}:nav:${proofObj.bilingualAddress}`),
      generatedAt: createdAt,
      content: proofObj.bilingualAddress,
    },
  ];
  return {
    id: orderId,
    taskId: task.id,
    tripId: task.tripId || null,
    provider: task.plan.intentType === "eat" ? "Partner Restaurant Network" : "Partner Mobility Network",
    type: task.plan.intentType,
    city: task.plan.constraints.city,
    price: pricing.finalPrice,
    currency: pricing.currency,
    pricing,
    cancelPolicy: task.plan.confirm.cancelPolicy,
    merchant: task.plan.confirm.merchant,
    status: "completed",
    refundable: true,
    refundPolicy: {
      freeCancelWindowMin: Number((task.plan.confirm.guarantee && task.plan.confirm.guarantee.freeCancelWindowMin) || 10),
      estimatedArrival: (task.plan.confirm.guarantee && task.plan.confirm.guarantee.refundEta) || "T+1 to T+3",
      supportRequired: false,
    },
    proof: proofObj,
    proofItems,
    lifecycle: [
      { state: "created", label: "Order created", at: createdAt, note: "Created after plan execution." },
      { state: "confirmed", label: "Order confirmed", at: createdAt, note: "Payment captured and booking lock acquired." },
      { state: "in_progress", label: "Service in progress", at: createdAt, note: "Deliverables are being generated." },
      { state: "completed", label: "Completed", at: createdAt, note: "Proof bundle delivered." },
    ],
    createdAt,
    updatedAt: createdAt,
  };
}

function buildShareCard(order) {
  return {
    orderId: order.id,
    title: order.type === "eat" ? "Cross X dining booking ready" : "Cross X trip ready",
    subtitle: `${order.city || "Shanghai"} · ${order.price} ${order.currency}`,
    summary: `Order ${order.proof && order.proof.orderNo ? order.proof.orderNo : order.id} generated by Cross X`,
    shareImage: "/assets/solution-flow.svg",
    miniProgram: {
      alipayPath: `pages/trips/detail?orderId=${encodeURIComponent(order.id)}`,
      wechatPath: `pages/trips/detail?orderId=${encodeURIComponent(order.id)}`,
    },
    generatedAt: nowIso(),
  };
}

function hasMiniClientPages() {
  const required = [
    "mini/pages/chat/index.html",
    "mini/pages/trips/index.html",
    "mini/pages/trust/index.html",
    "mini/pages/me/index.html",
    "mini/styles.css",
    "mini/app.js",
  ];
  return required.every((relPath) => fs.existsSync(path.join(PUBLIC_DIR, relPath)));
}

function buildMiniProgramPackage() {
  const mp = db.miniProgram || {};
  const releases = Array.isArray(mp.releases) ? mp.releases : [];
  const channels = mp.channels || {};
  const clientPagesReady = hasMiniClientPages();
  return {
    version: mp.version || "0.1.0",
    channels: {
      alipay: {
        ...(channels.alipay || { status: "ready", pathPrefix: "pages/" }),
        launchPath: "pages/chat/index",
      },
      wechat: {
        ...(channels.wechat || { status: "ready", pathPrefix: "pages/" }),
        launchPath: "pages/chat/index",
      },
    },
    pages: [
      "pages/chat/index",
      "pages/trips/index",
      "pages/trust/index",
      "pages/me/index",
    ],
    capabilities: {
      oneSentenceClosure: true,
      shareCard: true,
      trustCenter: true,
      paymentDelegation: true,
    },
    qa: {
      clientPagesReady,
      previewUrls: {
        chat: "/mini/pages/chat/index.html",
        trips: "/mini/pages/trips/index.html",
        trust: "/mini/pages/trust/index.html",
        me: "/mini/pages/me/index.html",
      },
    },
    releases: [...releases].slice(-20).reverse(),
  };
}

function createMiniRelease({ channel, note }) {
  const ch = channel === "wechat" ? "wechat" : "alipay";
  const rel = {
    id: `mini_${Date.now().toString().slice(-8)}_${(db.miniProgram.releases || []).length + 1}`,
    channel: ch,
    version: db.miniProgram.version || "0.1.0",
    note: note || "manual release",
    at: nowIso(),
  };
  db.miniProgram.releases.push(rel);
  if (db.miniProgram.releases.length > 100) {
    db.miniProgram.releases = db.miniProgram.releases.slice(-100);
  }
  if (db.miniProgram.channels && db.miniProgram.channels[ch]) {
    db.miniProgram.channels[ch].status = "released";
    db.miniProgram.channels[ch].lastReleaseAt = rel.at;
  }
  return rel;
}

async function executeTask(task) {
  if (task.pauseState === "paused") {
    throw new Error("Task is paused");
  }
  task.status = "executing";
  task.updatedAt = nowIso();
  syncTaskAgentMeta(task, "executing");
  lifecyclePush(task.lifecycle, "in_progress", "Execution started", "Tools are running.");
  task.steps = (task.plan.steps || []).map(normalizeStep);

  let result;
  try {
    result = await orchestrator.executeTask({ task, userId: task.userId });
  } catch (err) {
    task.status = "failed";
    syncTaskAgentMeta(task, "support");
    task.steps = (task.plan.steps || []).map((step) => normalizeStep({ ...step }));
    lifecyclePush(task.lifecycle, "failed", "Execution failed", err.message || "Execution failed");
    task.fallbackEvents.push({
      kind: "auto_fallback",
      at: nowIso(),
      note: "Primary execution failed, suggested alternate provider/route",
      reason: err.message,
      alternative: task.plan.confirm.alternative,
    });
    task.updatedAt = nowIso();
    audit.append({
      kind: "task",
      who: task.userId,
      what: "task.failed.fallback",
      taskId: task.id,
      toolInput: {},
      toolOutput: { reason: err.message, alternative: task.plan.confirm.alternative },
    });
    pushMetricEvent({
      kind: "task_failed_fallback",
      userId: task.userId,
      taskId: task.id,
      meta: { reason: err.message },
    });

    if (task.flagSnapshot && task.flagSnapshot.manualFallback && task.flagSnapshot.manualFallback.active) {
      const ticket = createSupportTicket({
        reason: "auto_handoff_on_execution_failure",
        taskId: task.id,
        source: "auto_fallback",
      });
      task.handoff = {
        ticketId: ticket.id,
        sessionId: ticket.sessionId || null,
        status: ticket.status,
        source: ticket.source,
        eta: ticket.eta,
        requestedAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
      };
      syncTaskAgentMeta(task, "support");
      lifecyclePush(task.lifecycle, "fallback_to_human", "Switched to human", `Ticket ${ticket.id} created`);
      task.steps = (task.plan.steps || []).map((step) => {
        if (step.status === "failed") return { ...step, status: "fallback_to_human" };
        return step;
      });
      pushMetricEvent({
        kind: "handoff_auto_created",
        userId: task.userId,
        taskId: task.id,
        meta: { ticketId: ticket.id },
      });
      audit.append({
        kind: "support",
        who: task.userId,
        what: "task.handoff.auto_created",
        taskId: task.id,
        toolInput: { reason: "execution_failure" },
        toolOutput: { ticketId: ticket.id },
      });
    }
    refreshTripByTask(task);
    saveDb();
    throw err;
  }
  task.timeline = result.timeline;
  task.steps = (task.plan.steps || []).map((step) => normalizeStep({ ...step }));
  task.mcpCalls = result.stepLogs || [];
  task.mcpCalls.forEach((call, idx) => {
    db.mcpCalls.push({
      id: `mcp_${Date.now()}_${idx}`,
      taskId: task.id,
      at: nowIso(),
      ...call,
    });
  });
  task.deliverable = result.proof || null;

  result.outputs.forEach((o) => {
    audit.append({
      kind: "step",
      who: task.userId,
      what: "step.executed",
      taskId: task.id,
      toolInput: { stepId: o.stepId, toolType: o.toolType },
      toolOutput: { mcpOp: o.mcpOp, latency: o.latency },
    });
  });

  const order = createOrderForTask(task, result.proof);
  db.orders[order.id] = order;
  reconcileSettlementForOrder(order);
  task.orderId = order.id;
  const payOutput = (result.outputs || []).find((o) => o.toolType === "pay.act");
  const payData = (payOutput && payOutput.data) || {};
  task.payments.push({
    orderId: order.id,
    amount: order.price,
    currency: order.currency,
    merchant: order.merchant,
    railId: payData.railId || task.paymentRailSnapshot,
    railLabel: payData.railLabel || task.paymentRailSnapshot,
    gatewayRef: payData.gatewayRef || null,
    status: "captured",
    at: nowIso(),
  });
  task.status = "completed";
  syncTaskAgentMeta(task, "done");
  refreshTripByTask(task);
  lifecyclePush(task.lifecycle, "completed", "Task completed", `Order ${order.id} delivered with proof.`);
  task.updatedAt = nowIso();
  pushMetricEvent({
    kind: "closed_loop_completed",
    userId: task.userId,
    taskId: task.id,
    orderId: order.id,
    amount: order.price,
    currency: order.currency,
    intentType: task.plan.intentType,
  });

  audit.append({
    kind: "task",
    who: task.userId,
    what: "task.completed",
    taskId: task.id,
    toolInput: { steps: task.plan.steps.map((s) => s.id) },
    toolOutput: { orderId: order.id },
  });
  saveDb();

  return { task, order };
}

function requireTask(taskId, res) {
  const task = db.tasks[taskId];
  if (!task) {
    writeJson(res, 404, { error: "Task not found" });
    return null;
  }
  return task;
}

function summarizeRequestPayload(payload, toolType) {
  const p = payload && typeof payload === "object" ? payload : {};
  if (toolType === "map.query" || toolType === "route.plan") {
    return `intent=${String(p.intent || "").slice(0, 48)} city=${p.city || "-"} origin=${p.origin || "-"} destination=${p.destination || "-"}`;
  }
  if (toolType === "queue.status" || toolType === "traffic.live") {
    return `city=${p.city || "-"} origin=${p.origin || "-"} destination=${p.destination || "-"}`;
  }
  if (toolType === "book.lock" || toolType === "transport.lock") {
    return `lock request by constraints budget=${(p.constraints && p.constraints.budget) || "-"} time=${(p.constraints && p.constraints.time) || "-"}`;
  }
  if (toolType === "pay.act") {
    return `amount=${p.amount || 0} ${p.currency || "CNY"} rail=${p.railId || "-"}`;
  }
  if (toolType === "proof.card") {
    return `deliverable language=${(p.constraints && p.constraints.flags && p.constraints.flags.liveTranslation && p.constraints.flags.liveTranslation.active) ? "bilingual+" : "default"}`;
  }
  return JSON.stringify(p).slice(0, 180);
}

function summarizeResponseData(data, toolType) {
  const d = data && typeof data === "object" ? data : {};
  if (toolType === "map.query") {
    return `picks=${Array.isArray(d.picks) ? d.picks.length : 0} provider=${d.provider || "-"}`;
  }
  if (toolType === "queue.status") {
    return `wait=${d.waitMin || 0}min seats=${d.seatsLeft || 0}`;
  }
  if (toolType === "book.lock") {
    return `lockId=${d.lockId || "-"} ttl=${d.expiresInSec || 0}s`;
  }
  if (toolType === "route.plan") {
    return `route=${String(d.route || "-").slice(0, 48)} eta=${d.etaMin || 0}min`;
  }
  if (toolType === "traffic.live") {
    return `congestion=${d.congestionLevel || "-"} risk=${d.risk || "-"}`;
  }
  if (toolType === "transport.lock") {
    return `ticket=${d.ticketRef || "-"} provider=${d.provider || "-"}`;
  }
  if (toolType === "pay.act") {
    return `paid=${d.amount || 0} ${d.currency || "CNY"} ref=${d.paymentRef || "-"} rail=${d.railLabel || d.railId || "-"}`;
  }
  if (toolType === "proof.card") {
    return `address=${String(d.bilingualAddress || "-").slice(0, 42)} itinerary=${String(d.itinerary || "-").slice(0, 42)}`;
  }
  return JSON.stringify(d).slice(0, 180);
}

function deriveSelectionReason(call, task) {
  const toolType = call && call.toolType ? call.toolType : "";
  const d = call && call.response && call.response.data && typeof call.response.data === "object" ? call.response.data : {};
  const c = task && task.plan && task.plan.constraints ? task.plan.constraints : {};
  if (toolType === "map.query") {
    return `Selected by authenticity + ${c.distance || "walk"} distance + budget ${c.budget || "mid"}.`;
  }
  if (toolType === "queue.status") {
    return `Chosen because queue wait ${d.waitMin || 0} min with seats ${d.seatsLeft || 0} supports fast closure.`;
  }
  if (toolType === "book.lock") {
    return "Locked resource before payment to avoid inventory race conditions.";
  }
  if (toolType === "route.plan") {
    return `Route selected for timing objective with ETA ${d.etaMin || 0} min.`;
  }
  if (toolType === "traffic.live") {
    return `Traffic risk ${d.risk || "low"} keeps airport timeline reliable.`;
  }
  if (toolType === "transport.lock") {
    return "Transport lock executed before payment to guarantee dispatch/ticket availability.";
  }
  if (toolType === "pay.act") {
    return `Payment executed on rail ${d.railLabel || d.railId || "-"} under ACT delegation controls.`;
  }
  if (toolType === "proof.card") {
    return "Deliverable generated as bilingual executable proof for immediate action.";
  }
  return "Tool selected by planner confidence and policy constraints.";
}

function buildTaskKeyMoments(task, order) {
  const points = [];
  points.push({ kind: "planned", at: task.createdAt, note: "Intent parsed and workflow planned." });
  if (task.confirmedAt) {
    points.push({ kind: "confirmed", at: task.confirmedAt, note: "User accepted cost/risk constraints." });
  }
  const firstTimeline = (task.timeline || []).find((s) => s.status === "running");
  if (firstTimeline) {
    points.push({ kind: "execution_started", at: firstTimeline.at, note: `Started: ${firstTimeline.label}` });
  }
  const lastTimeline = [...(task.timeline || [])].reverse().find((s) => s.status === "success" || s.status === "failed");
  if (lastTimeline) {
    points.push({
      kind: lastTimeline.status === "success" ? "execution_checkpoint" : "execution_failed",
      at: lastTimeline.at,
      note: `${lastTimeline.label} -> ${lastTimeline.status}`,
    });
  }
  if (order && order.createdAt) {
    points.push({ kind: "delivered", at: order.createdAt, note: `Order ${order.id} proof generated.` });
  }
  if (task.handoff && task.handoff.requestedAt) {
    points.push({ kind: "handoff_requested", at: task.handoff.requestedAt, note: `Ticket ${task.handoff.ticketId} (${task.handoff.status})` });
  }
  return points.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

function buildStepEvidence(step, call) {
  if (step && step.evidence && typeof step.evidence === "object") {
    return step.evidence;
  }
  const ts = (call && call.request && call.request.at) || nowIso();
  return {
    type: step.evidenceType || "api_receipt",
    title: step.label,
    receiptId: `${step.id}_${Date.now().toString().slice(-6)}`,
    generatedAt: ts,
    imagePath: step.toolType === "proof.card" ? "/assets/solution-trust.svg" : "/assets/solution-flow.svg",
    summary: (call && call.response && call.response.code) || step.outputPreview || "pending",
  };
}

function enrichTaskSteps(task, relatedCalls) {
  const callsByTool = new Map();
  for (const call of relatedCalls || []) {
    if (!call || !call.toolType) continue;
    if (!callsByTool.has(call.toolType)) callsByTool.set(call.toolType, call);
  }
  const base = task.steps && task.steps.length ? task.steps : task.plan.steps || [];
  return base.map((raw) => {
    const step = normalizeStep(raw);
    const call = callsByTool.get(step.toolType) || null;
    const inputSummary = step.inputPreview || summarizeRequestPayload(call && call.request ? call.request.payload : null, step.toolType);
    const outputSummary = step.outputPreview || summarizeResponseData(call && call.response ? call.response.data : null, step.toolType);
    return {
      ...step,
      inputSummary,
      outputSummary,
      evidence: buildStepEvidence(step, call),
      actions: {
        retry: step.retryable && (step.status === "failed" || step.status === "fallback_to_human"),
        switchLane: true,
        askHuman: !task.handoff || task.handoff.status !== "open",
        refundPolicy: true,
      },
    };
  });
}

function taskDetail(task) {
  const order = task.orderId ? db.orders[task.orderId] : null;
  const relatedCalls = (task.mcpCalls || []).map((call) => ({
    op: call.op,
    toolType: call.toolType,
    requestAt: call.request?.at,
    responseStatus: call.response?.status,
    latency: call.response?.latency,
    contractId: call.response?.contractId || null,
    contractProvider: call.response?.contractProvider || null,
    requestSummary: summarizeRequestPayload(call.request?.payload, call.toolType),
    responseSummary: summarizeResponseData(call.response?.data, call.toolType),
    selectionReason: deriveSelectionReason(call, task),
    data: call.response?.data,
  }));
  const enrichedSteps = enrichTaskSteps(task, task.mcpCalls || []);
  const progress = {
    total: enrichedSteps.length,
    success: enrichedSteps.filter((s) => s.status === "success").length,
    running: enrichedSteps.filter((s) => s.status === "running").length,
    failed: enrichedSteps.filter((s) => s.status === "failed").length,
    fallback: enrichedSteps.filter((s) => s.status === "fallback_to_human").length,
    skipped: enrichedSteps.filter((s) => s.status === "skipped").length,
    queued: enrichedSteps.filter((s) => s.status === "queued").length,
  };
  return {
    overview: {
      taskId: task.id,
      intent: task.intent,
      type: task.plan.intentType,
      status: task.status,
      pauseState: task.pauseState,
      createdAt: task.createdAt,
      reasoning: task.plan.reasoning,
      pricing: task.pricing || task.plan.confirm.pricing || null,
      paymentRail: task.paymentRailSnapshot || (task.plan.confirm && task.plan.confirm.paymentRail) || "alipay_cn",
      laneId: (task.sessionState && task.sessionState.laneId) || task.plan.laneId || `${task.plan.intentType}_default`,
    },
    sessionState: task.sessionState || (task.plan && task.plan.sessionState) || null,
    expertRoute: task.expertRoute || (task.plan && task.plan.expertRoute) || null,
    steps: enrichedSteps,
    payments: task.payments,
    proof: order ? order.proof : null,
    mcpSummary: task.plan.mcpSummary,
    proofChain: relatedCalls,
    keyMoments: buildTaskKeyMoments(task, order),
    fallbackEvents: task.fallbackEvents || [],
    flagSnapshot: task.flagSnapshot || {},
    handoff: task.handoff || null,
    lifecycle: task.lifecycle || [],
    progress,
    evidenceItems: order && Array.isArray(order.proofItems) ? order.proofItems : [],
  };
}

function buildOrderDetail(order) {
  const task = order && order.taskId ? db.tasks[order.taskId] : null;
  const ticket = task && task.handoff ? db.supportTickets.find((t) => t.id === task.handoff.ticketId) || null : null;
  const lifecycle = Array.isArray(order.lifecycle) ? order.lifecycle : [];
  const refund = order.refund || null;
  const refundStatus = refund ? refund.status || "pending" : "not_requested";
  const refundEta = order.refundPolicy && order.refundPolicy.estimatedArrival ? order.refundPolicy.estimatedArrival : "T+1 to T+3";
  return {
    orderId: order.id,
    taskId: order.taskId,
    tripId: order.tripId || (task && task.tripId) || null,
    status: order.status,
    type: order.type,
    city: order.city,
    amount: order.price,
    currency: order.currency,
    provider: order.provider,
    lifecycle,
    proofItems: order.proofItems || [],
    proof: order.proof || null,
    refund: {
      policy: order.refundPolicy || null,
      status: refundStatus,
      detail: refund,
      eta: refundEta,
    },
    support: ticket
      ? {
          ticketId: ticket.id,
          sessionId: ticket.sessionId || null,
          status: ticket.status,
          handler: ticket.handler || "human",
          eta: ticket.eta,
          etaMin: ticket.etaMin,
          createdAt: ticket.createdAt,
          updatedAt: ticket.updatedAt,
          evidenceCount: Array.isArray(ticket.evidence) ? ticket.evidence.length : 0,
          liveSession: ticket.sessionId ? buildSupportSessionSummary(getSupportSessionById(ticket.sessionId)) : null,
        }
      : null,
  };
}

function createTripPlan(payload, userId = "demo") {
  const body = payload && typeof payload === "object" ? payload : {};
  const id = `trip_${Object.keys(db.tripPlans || {}).length + 1}`;
  const title = String(body.title || "").trim() || `Trip ${Object.keys(db.tripPlans || {}).length + 1}`;
  const city = String(body.city || db.users[userId]?.city || "Shanghai");
  const note = String(body.note || "").trim();
  const createdAt = nowIso();
  const plan = {
    id,
    userId,
    title,
    city,
    note,
    status: "active",
    startAt: body.startAt ? String(body.startAt) : "",
    endAt: body.endAt ? String(body.endAt) : "",
    taskIds: [],
    lifecycle: [
      {
        state: "created",
        label: "Trip plan created",
        at: createdAt,
        note: "Ready to attach tasks.",
      },
    ],
    createdAt,
    updatedAt: createdAt,
  };
  db.tripPlans[id] = plan;
  refreshTripPlan(plan);
  audit.append({
    kind: "trip",
    who: userId,
    what: "trip.created",
    taskId: null,
    toolInput: { title, city, note },
    toolOutput: { tripId: id, status: plan.derivedStatus },
  });
  saveDb();
  return plan;
}

function requireTripPlan(tripId, res) {
  const plan = db.tripPlans[tripId];
  if (!plan) {
    writeJson(res, 404, { error: "Trip not found" });
    return null;
  }
  return plan;
}

function buildUserTrustSummary(user) {
  const today = new Date().toISOString().slice(0, 10);
  const events = (db.auditLogs || []).filter((log) => String(log.at || "").startsWith(today));
  const blocked = events.filter((e) => String(e.what || "").includes("rejected")).length;
  const risky = events.filter((e) => String(e.what || "").includes("failed")).length;
  return {
    date: today,
    protectedPaymentsBlocked: blocked,
    riskyTransactions: risky,
    locationSharing: Boolean(user.privacy && user.privacy.locationEnabled),
    delegation: {
      noPinEnabled: Boolean(user.authDomain && user.authDomain.noPinEnabled),
      singleLimit: Number((user.authDomain && user.authDomain.singleLimit) || 0),
      dailyLimit: Number((user.authDomain && user.authDomain.dailyLimit) || 0),
    },
  };
}

function parsePath(pathname) {
  return pathname.split("/").filter(Boolean);
}


// ── Wire up extracted planner modules ───────────────────────────────────────
setDefaultModel(OPENAI_MODEL);
setDefaultBaseUrl(OPENAI_BASE_URL);
configurePipeline({ buildChinaTravelKnowledge, extractAgentConstraints, sessionItinerary });
const planRouter = createPlanRouter({
  readBody, writeJson, normalizeLang, pickLang, db,
  getOpenAIConfig: () => ({ apiKey: OPENAI_API_KEY, model: OPENAI_MODEL, keyHealth: OPENAI_KEY_HEALTH, baseUrl: OPENAI_BASE_URL }),
  getCozeConfig: () => ({ apiKey: COZE_API_KEY, workflowId: COZE_WORKFLOW_ID }),
  callCozeWorkflow,
  detectQuickActionIntent, buildQuickActionResponse,
  detectCasualChatIntent, callCasualChat,
  classifyBookingIntent, callPythonRagService, searchAttractions,
  ragEngine, sessionItinerary, extractAgentConstraints,
});

const server = http.createServer(async (req, res) => {
  const parsed = parseUrl(req.url, true);
  const { pathname } = parsed;

  const isApiPath = pathname.startsWith("/api/") || pathname.startsWith("/hotel/");
  if (!isApiPath) {
    serveStatic(req, res);
    return;
  }

  try {
    cleanIdempotencyStore();

    if (req.method === "GET" && pathname === "/hotel/district/cityList") {
      const countryCode = String(parsed.query.countryCode || "CN").toUpperCase();
      if (countryCode !== "CN") {
        return writeJson(res, 200, { countryCode, cities: [] });
      }
      return writeJson(res, 200, {
        countryCode: "CN",
        cities: HOTEL_CITY_ROWS.map((item) => ({
          cityCode: item.cityCode,
          cityName: item.cityName,
          cityEn: item.cityEn,
        })),
      });
    }

    if (req.method === "POST" && pathname === "/hotel/search/list") {
      const body = await readBody(req);
      const result = searchHotelsCore({
        cityCode: body.cityCode,
        checkInDate: body.checkInDate,
        checkOutDate: body.checkOutDate,
        pageNum: body.pageNum || 1,
        pageSize: body.pageSize || 10,
        budget: body.budget || body.maxPrice || null,
        starRating: body.starRating || body.star || null,
        keyword: body.keyword || "",
        guestNum: body.guestNum || body.guest || 1,
      });
      return writeJson(res, 200, {
        cityCode: result.city.cityCode,
        cityName: result.city.cityEn,
        checkInDate: result.checkInDate,
        checkOutDate: result.checkOutDate,
        pageNum: result.pageNum,
        pageSize: result.pageSize,
        total: result.total,
        list: result.list.map((item) => ({
          hotelId: item.hotelId,
          hotelName: item.hotelName,
          hotelAddress: item.hotelAddress,
          starRating: item.starRating,
          lowestPrice: item.lowestPrice,
          commentScore: item.commentScore,
          canBook: item.canBook,
          bestRoom: item.bestRoom || null,
          imageUrl: item.imageUrl || "",
        })),
      });
    }

    if (req.method === "POST" && pathname === "/hotel/price/inventory") {
      const body = await readBody(req);
      const quote = buildHotelInventoryQuote({
        hotelId: body.hotelId,
        roomId: body.roomId,
        checkInDate: body.checkInDate,
        checkOutDate: body.checkOutDate,
        guestNum: body.guestNum || body.guest || 1,
      });
      return writeJson(res, 200, {
        hotelId: quote.hotelId,
        roomId: quote.roomId,
        canBook: quote.canBook,
        totalPrice: quote.totalPrice,
        inventoryNum: quote.inventoryNum,
        breakfastInfo: quote.breakfastInfo,
        cancelRule: quote.cancelRule,
        priceValidTime: quote.priceValidTime,
        roomTypeName: quote.roomTypeName,
      });
    }

    if (req.method === "POST" && pathname === "/hotel/order/create") {
      const body = await readBody(req);
      const outOrderNo = String(body.outOrderNo || buildHotelOutOrderNo()).trim();
      const existed = Object.values(db.orders || {}).find((item) => item.outOrderNo && String(item.outOrderNo) === outOrderNo);
      if (existed) {
        return writeJson(res, 200, {
          orderId: existed.id,
          outOrderNo: existed.outOrderNo,
          orderStatus: existed.orderStatus || existed.status,
          payDeadline: existed.payDeadline,
          totalPrice: existed.totalPrice || existed.price,
          duplicated: true,
        });
      }
      const quote = buildHotelInventoryQuote({
        hotelId: body.hotelId,
        roomId: body.roomId,
        checkInDate: body.checkInDate,
        checkOutDate: body.checkOutDate,
        guestNum: body.guestNum || 1,
      });
      if (!quote.canBook) {
        return writeJson(res, 409, { error: "room_not_bookable", canBook: false, inventoryNum: quote.inventoryNum });
      }
      const requestedTotal = Number(body.totalPrice || 0);
      if (requestedTotal > 0 && Math.abs(requestedTotal - Number(quote.totalPrice || 0)) > 2) {
        return writeJson(res, 409, {
          error: "price_changed",
          totalPrice: quote.totalPrice,
          priceValidTime: quote.priceValidTime,
        });
      }
      const city = resolveHotelCityRow(body.cityCode, body.cityName, db.users.demo.city || "Shanghai");
      const { hotel, room } = findHotelAndRoom(body.hotelId, body.roomId);
      if (!hotel || !room) return writeJson(res, 404, { error: "hotel_or_room_not_found" });

      const orderId = `ctrip_${Date.now().toString().slice(-9)}_${Object.keys(db.orders).length + 1}`;
      const createdAt = nowIso();
      const payDeadline = new Date(Date.now() + 1000 * 60 * 15).toISOString();
      const paymentMode = String(body.paymentMode || body.paymentChannel || body.channel || "wechat_c").toLowerCase();
      const b2bMode = /b2b|enterprise|corp|public/.test(paymentMode);
      const autoPaid = b2bMode ? false : body.autoPaid !== false;
      const orderStatus = autoPaid ? "pending_confirmation" : "awaiting_payment";
      const payStatus = autoPaid ? "paid" : "unpaid";
      const order = {
        id: orderId,
        outOrderNo,
        taskId: body.taskId || null,
        tripId: body.tripId || null,
        provider: "Ctrip Hotel",
        type: "hotel",
        city: city.cityEn,
        cityCode: city.cityCode,
        hotelId: hotel.hotelId,
        hotelInfo: {
          hotelId: hotel.hotelId,
          hotelName: hotel.hotelName,
          hotelAddress: hotel.hotelAddress,
          starRating: hotel.starRating,
          roomId: room.roomId,
          roomTypeName: room.roomTypeName,
          checkInDate: normalizeDateRange(body.checkInDate, body.checkOutDate).checkInDate,
          checkOutDate: normalizeDateRange(body.checkInDate, body.checkOutDate).checkOutDate,
          guestNum: Math.max(1, Number(body.guestNum || 1)),
        },
        guestList: Array.isArray(body.guestList) ? body.guestList.slice(0, 6) : [],
        contactName: String(body.contactName || "Guest"),
        contactPhone: String(body.contactPhone || ""),
        arrivalTime: String(body.arrivalTime || "18:00"),
        orderStatus,
        status: orderStatus,
        payStatus,
        payDeadline,
        totalPrice: Number(quote.totalPrice || 0),
        price: Number(quote.totalPrice || 0),
        currency: "CNY",
        cancelRule: quote.cancelRule,
        refundStatus: "none",
        paymentMode: b2bMode ? "b2b" : "wechat",
        payment: b2bMode
          ? {
            mode: "b2b",
            noticeNo: `B2B_${Date.now().toString().slice(-10)}`,
            accountName: "Cross X Travel Services Ltd.",
            accountNo: "6222 **** **** 7788",
            bankName: "ICBC Shanghai Branch",
            instruction: "Upload transfer voucher in chat after remittance.",
          }
          : {
            mode: "wechat",
            payUrl: `https://pay.weixin.qq.com/mock/${orderId}`,
            qrText: `WX_PAY_${orderId}`,
          },
        proof: {
          orderNo: outOrderNo,
          qrText: b2bMode ? `B2B_${orderId}` : `WX_${orderId}`,
          bilingualAddress: `${hotel.hotelAddress} / ${hotel.hotelName}`,
          navLink: "https://maps.google.com",
          itinerary: `${hotel.hotelName} · ${room.roomTypeName}`,
        },
        proofItems: [
          {
            id: `${orderId}_booking`,
            type: "booking_confirmation",
            title: "Booking confirmation",
            hash: makeProofHash(`${orderId}:booking:${outOrderNo}`),
            generatedAt: createdAt,
            content: `${hotel.hotelName} / ${room.roomTypeName}`,
          },
          {
            id: `${orderId}_payment`,
            type: "payment_receipt",
            title: "Payment receipt",
            hash: makeProofHash(`${orderId}:payment:${quote.totalPrice}`),
            generatedAt: createdAt,
            content: `${quote.totalPrice} CNY`,
          },
        ],
        lifecycle: [
          { state: "created", label: "Order created", at: createdAt, note: "Hotel order payload submitted." },
          { state: orderStatus, label: orderStatus, at: createdAt, note: autoPaid ? "Payment accepted, waiting supplier confirmation." : "Waiting for payment completion." },
        ],
        refundPolicy: {
          freeCancelWindowMin: 10,
          estimatedArrival: "T+1 to T+3",
          supportRequired: false,
        },
        polling: {
          active: true,
          cadenceSec: 600,
          nextPollAt: new Date(Date.now() + 1000 * 60 * 10).toISOString(),
          createdByPolicy: "pending_10min_daily_1d",
        },
        createdAt,
        updatedAt: createdAt,
      };
      refreshHotelOrderRuntime(order, "create");
      db.orders[orderId] = order;
      if (autoPaid) {
        pushChatNotification({
          orderId,
          outOrderNo,
          status: "pending_confirmation",
          message: "订单已创建，正在等待酒店确认。",
          messageEn: "Order created. Waiting for hotel confirmation.",
        });
      }
      saveDb();
      return writeJson(res, 200, {
        orderId,
        outOrderNo,
        orderStatus,
        payDeadline,
        totalPrice: order.totalPrice,
        payStatus,
        payment: order.payment,
      });
    }

    if (req.method === "GET" && pathname === "/hotel/order/detail") {
      const orderId = String(parsed.query.orderId || "").trim();
      const outOrderNo = String(parsed.query.outOrderNo || "").trim();
      const order = orderId
        ? db.orders[orderId]
        : Object.values(db.orders || {}).find((item) => item.outOrderNo && String(item.outOrderNo) === outOrderNo);
      if (!order) return writeJson(res, 404, { error: "order_not_found" });
      if (order.type === "hotel") {
        maybeAdvanceHotelOrderStatus(order, "detail");
      }
      order.updatedAt = nowIso();
      saveDb();
      return writeJson(res, 200, {
        orderId: order.id,
        outOrderNo: order.outOrderNo || outOrderNo,
        orderStatus: order.orderStatus || order.status,
        hotelInfo: order.hotelInfo || null,
        totalPrice: Number(order.totalPrice || order.price || 0),
        payStatus: order.payStatus || "unknown",
        cancelRule: order.cancelRule || "",
        payment: order.payment || null,
        polling: order.polling || null,
      });
    }

    if (req.method === "POST" && pathname === "/hotel/order/cancel") {
      const body = await readBody(req);
      const orderId = String(body.orderId || "").trim();
      const outOrderNo = String(body.outOrderNo || "").trim();
      const order = orderId
        ? db.orders[orderId]
        : Object.values(db.orders || {}).find((item) => item.outOrderNo && String(item.outOrderNo) === outOrderNo);
      if (!order) return writeJson(res, 404, { error: "order_not_found" });
      if (order.type !== "hotel") return writeJson(res, 400, { error: "not_hotel_order" });
      const cancelReason = String(body.cancelReason || "user_request").slice(0, 120);
      if (["cancelled", "refunded"].includes(String(order.orderStatus || "").toLowerCase())) {
        return writeJson(res, 200, {
          cancelSuccess: true,
          orderStatus: order.orderStatus,
          refundAmount: Number(order.refundAmount || 0),
          refundDesc: order.refundDesc || "Already canceled",
        });
      }
      order.orderStatus = "cancelled";
      order.status = "cancelled";
      order.refundStatus = "processing";
      order.refundAmount = Number(order.totalPrice || order.price || 0);
      order.refundDesc = `Cancel reason: ${cancelReason}`;
      lifecyclePush(order.lifecycle || [], "cancelled", "Order cancelled", cancelReason);
      order.updatedAt = nowIso();
      refreshHotelOrderRuntime(order, "cancel");
      pushChatNotification({
        orderId: order.id,
        outOrderNo: order.outOrderNo || "",
        status: "cancelled",
        message: "订单已取消，退款处理中。",
        messageEn: "Order canceled. Refund is being processed.",
      });
      saveDb();
      return writeJson(res, 200, {
        cancelSuccess: true,
        orderStatus: order.orderStatus,
        refundAmount: order.refundAmount,
        refundDesc: order.refundDesc,
      });
    }

    if (req.method === "GET" && pathname === "/api/chat/notifications") {
      const since = String(parsed.query.since || "");
      return writeJson(res, 200, {
        notifications: listChatNotificationsSince(since),
        now: nowIso(),
      });
    }

    if (req.method === "GET" && pathname === "/api/health") {
      return writeJson(res, 200, {
        ok: true,
        buildId: BUILD_ID,
        uptimeSec: Math.round(process.uptime()),
        totals: {
          tasks: Object.keys(db.tasks).length,
          orders: Object.keys(db.orders).length,
          settlements: db.settlements.length,
          logs: db.auditLogs.length,
        },
      });
    }

    if (req.method === "GET" && pathname === "/api/dashboard/kpi") {
      return writeJson(res, 200, {
        generatedAt: nowIso(),
        kpi: buildKpiSummary(),
      });
    }

    if (req.method === "GET" && pathname === "/api/dashboard/funnel") {
      return writeJson(res, 200, {
        generatedAt: nowIso(),
        funnel: buildFunnelSummary(),
      });
    }

    if (req.method === "GET" && pathname === "/api/dashboard/prd-coverage") {
      return writeJson(res, 200, {
        generatedAt: nowIso(),
        coverage: buildPrdCoverage(),
      });
    }

    if (req.method === "GET" && pathname === "/api/dashboard/revenue") {
      return writeJson(res, 200, {
        generatedAt: nowIso(),
        revenue: buildRevenueSummary(),
      });
    }

    if (req.method === "GET" && pathname === "/api/dashboard/mcp-sla") {
      return writeJson(res, 200, {
        generatedAt: nowIso(),
        sla: buildMcpSlaSummary(),
      });
    }

    if (req.method === "POST" && pathname === "/api/metrics/events") {
      const body = await readBody(req);
      pushMetricEvent({
        kind: body.kind || "ui_event",
        userId: body.userId || "demo",
        taskId: body.taskId || null,
        meta: body.meta && typeof body.meta === "object" ? body.meta : {},
      });
      saveDb();
      return writeJson(res, 200, { ok: true });
    }

    if (req.method === "GET" && pathname === "/api/system/providers") {
      const contracts = buildMcpContractsSummary();
      const gaodeKeyPresent = Boolean(process.env.GAODE_KEY || process.env.AMAP_KEY);
      const partnerHubKeyPresent = Boolean(process.env.PARTNER_HUB_KEY);
      const partnerHubBaseUrlConfigured = Boolean(connectors.partnerHub && connectors.partnerHub.baseUrl);
      const partnerHubReady = Boolean(connectors.partnerHub && connectors.partnerHub.enabled && (partnerHubKeyPresent || partnerHubBaseUrlConfigured));
      return writeJson(res, 200, {
        gaode: {
          enabled: connectors.gaode.enabled,
          mode: connectors.gaode.enabled ? "live_with_fallback" : "mock",
          keyPresent: gaodeKeyPresent,
          requiredEnv: ["GAODE_KEY or AMAP_KEY"],
        },
        partnerHub: {
          enabled: connectors.partnerHub.enabled,
          mode: connectors.partnerHub.mode || (connectors.partnerHub.enabled ? "external_contract" : "mock"),
          keyPresent: partnerHubKeyPresent,
          baseUrlConfigured: partnerHubBaseUrlConfigured,
          providerAlias: connectors.partnerHub.provider || "generic",
          channels: connectors.partnerHub.channels || [],
          requiredEnv: ["PARTNER_HUB_KEY or PARTNER_HUB_BASE_URL"],
        },
        mcpContracts: {
          total: contracts.totalContracts,
          enforced: contracts.enforcedContracts,
        },
        liveReadiness: {
          ready: gaodeKeyPresent && partnerHubReady,
          missing: [
            ...(gaodeKeyPresent ? [] : ["GAODE_KEY or AMAP_KEY"]),
            ...(partnerHubReady ? [] : ["PARTNER_HUB_KEY or PARTNER_HUB_BASE_URL"]),
          ],
        },
      });
    }

    if (req.method === "GET" && pathname === "/api/system/providers/probe") {
      const summary = buildProviderProbeSummary();
      if (String(parsed.query.refresh || "0") === "1") {
        audit.append({
          kind: "system",
          who: "demo",
          what: "providers.probe.refreshed",
          taskId: null,
          toolInput: { refresh: true },
          toolOutput: {
            ready: summary.ready,
            missing: summary.missing,
            probes: summary.probes.map((item) => ({
              provider: item.provider,
              mode: item.mode,
              sampleCalls: item.sampleCalls,
              p95Ms: item.p95Ms,
              slaMetRate: item.slaMetRate,
            })),
          },
        });
        saveDb();
      }
      return writeJson(res, 200, summary);
    }

    if (req.method === "GET" && pathname === "/api/system/build") {
      return writeJson(res, 200, {
        buildId: BUILD_ID,
        host: HOST,
        port: PORT,
        now: nowIso(),
      });
    }

    // ── API Gateway: FX rates ──────────────────────────────────────────────
    if (req.method === "GET" && pathname === "/api/gateway/fx") {
      try {
        const rates = await fetchFxRates();
        return writeJson(res, 200, { ok: true, rates, source: process.env.JUHE_KEY ? "juhe" : "mock" });
      } catch (e) {
        return writeJson(res, 500, { ok: false, error: e.message });
      }
    }

    // ── API Gateway: Jutui restaurants (via ele/store_list) ───────────────
    if (req.method === "GET" && pathname === "/api/gateway/coupons") {
      const city = String(parsed.query.keyword || "").slice(0, 50);
      try {
        const coupons = await fetchJutuiRestaurants(city, "美食", 4);
        return writeJson(res, 200, { ok: true, coupons, keyword: city });
      } catch (e) {
        return writeJson(res, 500, { ok: false, error: e.message });
      }
    }

    if (req.method === "GET" && pathname === "/api/system/llm-status") {
      const primaryProvider = ANTHROPIC_KEY_HEALTH.looksValid ? "claude" : (OPENAI_KEY_HEALTH.looksValid ? "openai" : "fallback");
      return writeJson(res, 200, {
        // Legacy flat fields (backward-compat)
        configured: Boolean(OPENAI_API_KEY),
        provider: "openai",
        keySource: OPENAI_KEY_SOURCE,
        keyPreview: openAiKeyPreview(OPENAI_API_KEY),
        keyHealth: OPENAI_KEY_HEALTH,
        model: OPENAI_MODEL,
        ttsModel: OPENAI_TTS_MODEL,
        baseUrl: OPENAI_BASE_URL,
        timeoutMs: OPENAI_TIMEOUT_MS,
        lastRuntime: OPENAI_LAST_RUNTIME,
        envFilesLoaded: LOADED_ENV_FILES,
        // Extended multi-provider fields
        primary: primaryProvider,
        coze: {
          configured:   Boolean(COZE_API_KEY),
          keyPreview:   COZE_API_KEY ? COZE_API_KEY.slice(0, 10) + "..." : "(not set)",
          workflowId:   COZE_WORKFLOW_ID,
          workflowReady: Boolean(COZE_API_KEY && COZE_WORKFLOW_ID),
        },
        providers: {
          claude: {
            configured: Boolean(ANTHROPIC_API_KEY),
            keySource: ANTHROPIC_KEY_SOURCE,
            keyPreview: claudeKeyPreview(ANTHROPIC_API_KEY),
            keyHealth: ANTHROPIC_KEY_HEALTH,
            model: ANTHROPIC_MODEL,
            baseUrl: ANTHROPIC_BASE_URL,
            timeoutMs: ANTHROPIC_TIMEOUT_MS,
            lastRuntime: ANTHROPIC_LAST_RUNTIME,
          },
          openai: {
            configured: Boolean(OPENAI_API_KEY),
            keySource: OPENAI_KEY_SOURCE,
            keyPreview: openAiKeyPreview(OPENAI_API_KEY),
            keyHealth: OPENAI_KEY_HEALTH,
            model: OPENAI_MODEL,
            baseUrl: OPENAI_BASE_URL,
            timeoutMs: OPENAI_TIMEOUT_MS,
            lastRuntime: OPENAI_LAST_RUNTIME,
          },
        },
      });
    }

    if (req.method === "POST" && pathname === "/api/system/llm/reload") {
      LOADED_ENV_FILES = loadLocalEnvFiles();
      applyOpenAiConfig();
      applyClaudeConfig();
      applyCozeConfig();
      audit.append({
        kind: "system",
        who: "demo",
        what: "llm.config.reloaded",
        taskId: null,
        toolInput: { source: "env_files_and_process_env" },
        toolOutput: {
          configured: Boolean(OPENAI_API_KEY),
          claudeConfigured: Boolean(ANTHROPIC_API_KEY),
          keySource: OPENAI_KEY_SOURCE,
          model: OPENAI_MODEL,
          envFilesLoaded: LOADED_ENV_FILES,
        },
      });
      saveDb();
      return writeJson(res, 200, {
        ok: true,
        configured: Boolean(OPENAI_API_KEY),
        provider: "openai",
        keySource: OPENAI_KEY_SOURCE,
        keyPreview: openAiKeyPreview(OPENAI_API_KEY),
        keyHealth: OPENAI_KEY_HEALTH,
        model: OPENAI_MODEL,
        ttsModel: OPENAI_TTS_MODEL,
        baseUrl: OPENAI_BASE_URL,
        timeoutMs: OPENAI_TIMEOUT_MS,
        lastRuntime: OPENAI_LAST_RUNTIME,
        envFilesLoaded: LOADED_ENV_FILES,
        claude: {
          configured: Boolean(ANTHROPIC_API_KEY),
          model: ANTHROPIC_MODEL,
        },
      });
    }

    if (req.method === "POST" && pathname === "/api/system/llm/runtime") {
      const body = await readBody(req);
      const payload = body && typeof body === "object" ? body : {};
      const clear = payload.clear === true;
      const persist = payload.persist !== false;
      // OpenAI fields
      const incomingKey = String(payload.apiKey || payload.openaiApiKey || payload.OPENAI_API_KEY || "")
        .replace(/^Bearer\s+/i, "")
        .replace(/^["']+|["']+$/g, "")
        .trim();
      const incomingModel = String(payload.model || payload.OPENAI_MODEL || "").trim();
      const incomingTtsModel = String(payload.ttsModel || payload.OPENAI_TTS_MODEL || "").trim();
      const incomingBaseUrl = String(payload.baseUrl || payload.OPENAI_BASE_URL || "").trim();
      const incomingTimeout = Number(payload.timeoutMs || payload.OPENAI_TIMEOUT_MS || 0);
      // Anthropic/Claude fields
      const incomingAnthropicKey = String(payload.anthropicApiKey || payload.ANTHROPIC_API_KEY || payload.claudeApiKey || payload.CLAUDE_API_KEY || "")
        .replace(/^Bearer\s+/i, "")
        .replace(/^["']+|["']+$/g, "")
        .trim();
      const incomingAnthropicModel = String(payload.anthropicModel || payload.ANTHROPIC_MODEL || "").trim();
      // Amap fields
      const incomingAmapKey = String(payload.amapApiKey || payload.AMAP_API_KEY || payload.gaodeApiKey || payload.GAODE_API_KEY || "").trim();

      if (clear) {
        delete process.env.OPENAI_API_KEY;
        delete process.env.OPENAI_KEY;
        delete process.env.CHATGPT_API_KEY;
        delete process.env.ANTHROPIC_API_KEY;
        delete process.env.CLAUDE_API_KEY;
        delete process.env.CLAUDE_KEY;
      } else {
        if (incomingKey) process.env.OPENAI_API_KEY = incomingKey;
        if (incomingAnthropicKey) process.env.ANTHROPIC_API_KEY = incomingAnthropicKey;
        if (incomingAmapKey) process.env.AMAP_API_KEY = incomingAmapKey;
      }
      if (incomingModel) process.env.OPENAI_MODEL = incomingModel;
      if (incomingTtsModel) process.env.OPENAI_TTS_MODEL = incomingTtsModel;
      if (incomingBaseUrl) process.env.OPENAI_BASE_URL = incomingBaseUrl;
      if (Number.isFinite(incomingTimeout) && incomingTimeout >= 3000) {
        process.env.OPENAI_TIMEOUT_MS = String(Math.round(incomingTimeout));
      }
      if (incomingAnthropicModel) process.env.ANTHROPIC_MODEL = incomingAnthropicModel;

      let persistResult = { ok: true };
      if (persist) {
        const updates = clear
          ? {}
          : {
            OPENAI_API_KEY: incomingKey || process.env.OPENAI_API_KEY || "",
            OPENAI_MODEL: incomingModel || process.env.OPENAI_MODEL || "",
            OPENAI_TTS_MODEL: incomingTtsModel || process.env.OPENAI_TTS_MODEL || "",
            OPENAI_BASE_URL: incomingBaseUrl || process.env.OPENAI_BASE_URL || "",
            OPENAI_TIMEOUT_MS:
              Number.isFinite(incomingTimeout) && incomingTimeout >= 3000
                ? String(Math.round(incomingTimeout))
                : String(process.env.OPENAI_TIMEOUT_MS || ""),
            ANTHROPIC_API_KEY: incomingAnthropicKey || process.env.ANTHROPIC_API_KEY || "",
            ANTHROPIC_MODEL: incomingAnthropicModel || process.env.ANTHROPIC_MODEL || "",
            AMAP_API_KEY: incomingAmapKey || process.env.AMAP_API_KEY || "",
          };
        persistResult = persistOpenAiRuntimeEnv({ clear, updates });
      }

      applyOpenAiConfig();
      applyClaudeConfig();
      applyAmapConfig();
      audit.append({
        kind: "system",
        who: "demo",
        what: "llm.config.runtime_updated",
        taskId: null,
        toolInput: {
          clear,
          modelUpdated: Boolean(incomingModel),
          ttsModelUpdated: Boolean(incomingTtsModel),
          baseUrlUpdated: Boolean(incomingBaseUrl),
          timeoutUpdated: Number.isFinite(incomingTimeout) && incomingTimeout >= 3000,
          keyUpdated: Boolean(incomingKey),
          anthropicKeyUpdated: Boolean(incomingAnthropicKey),
          persisted: persist,
          persistOk: persistResult.ok !== false,
        },
        toolOutput: {
          configured: Boolean(OPENAI_API_KEY),
          claudeConfigured: Boolean(ANTHROPIC_API_KEY),
          keySource: OPENAI_KEY_SOURCE,
          model: OPENAI_MODEL,
          ttsModel: OPENAI_TTS_MODEL,
        },
      });
      saveDb();
      return writeJson(res, 200, {
        ok: true,
        configured: Boolean(OPENAI_API_KEY),
        provider: "openai",
        keySource: OPENAI_KEY_SOURCE,
        keyPreview: openAiKeyPreview(OPENAI_API_KEY),
        keyHealth: OPENAI_KEY_HEALTH,
        model: OPENAI_MODEL,
        ttsModel: OPENAI_TTS_MODEL,
        baseUrl: OPENAI_BASE_URL,
        timeoutMs: OPENAI_TIMEOUT_MS,
        lastRuntime: OPENAI_LAST_RUNTIME,
        persisted: persist,
        persistOk: persistResult.ok !== false,
        persistError: persistResult.ok === false ? persistResult.error : null,
        claude: {
          configured: Boolean(ANTHROPIC_API_KEY),
          keySource: ANTHROPIC_KEY_SOURCE,
          keyPreview: claudeKeyPreview(ANTHROPIC_API_KEY),
          keyHealth: ANTHROPIC_KEY_HEALTH,
          model: ANTHROPIC_MODEL,
        },
      });
    }

    if (req.method === "GET" && pathname === "/api/solution/recommendation") {
      const taskId = parsed.query.taskId || null;
      const intentHint = parsed.query.intentHint || null;
      const city = parsed.query.city ? String(parsed.query.city).trim() : null;
      const language = normalizeLang(parsed.query.language || db.users.demo.language || "EN");
      const query = parsed.query.query ? String(parsed.query.query).trim() : "";
      const contextConstraints = {
        budget: parsed.query.budget ? String(parsed.query.budget) : undefined,
        distance: parsed.query.distance ? String(parsed.query.distance) : undefined,
        time: parsed.query.time ? String(parsed.query.time) : undefined,
        dietary: parsed.query.dietary ? String(parsed.query.dietary) : undefined,
        family: parsed.query.family ? String(parsed.query.family) : undefined,
        accessibility: parsed.query.accessibility ? String(parsed.query.accessibility) : undefined,
      };
      const dynamicCandidates = await fetchDynamicCandidatePool({
        message: query || intentHint || "",
        city: city || db.users.demo.city || "Shanghai",
        constraints: contextConstraints,
        language,
        intentHint,
      });
      return writeJson(res, 200, {
        generatedAt: nowIso(),
        recommendation: buildSolutionRecommendation(taskId, intentHint, city, language, contextConstraints, dynamicCandidates),
      });
    }

    if (req.method === "POST" && pathname === "/api/chat/voice") {
      const body = await readBody(req);
      const text = String(body.text || body.message || "").trim();
      if (!text) return writeJson(res, 400, { error: "text required" });
      const language = normalizeLang(body.language || db.users.demo.language || "EN");
      const voice = String(body.voice || "").trim();
      const tts = await callOpenAITextToSpeech({ text, language, voice });
      if (!tts.ok) {
        return writeJson(res, 200, {
          ok: false,
          provider: "fallback",
          error: tts.error || "tts_unavailable",
        });
      }
      return writeJson(res, 200, tts);
    }

    if (req.method === "POST" && pathname === "/api/chat/translate") {
      const body = await readBody(req);
      const text = String(body.text || "").trim();
      if (!text) return writeJson(res, 400, { error: "text required" });
      const toLang = normalizeLang(body.toLang || "ZH");
      const langNames = { ZH: "Simplified Chinese", EN: "English", JA: "Japanese", KO: "Korean" };
      const targetName = langNames[toLang] || "Simplified Chinese";
      const prompt = `Translate the following text to ${targetName}. Output ONLY the translation, no explanation, no quotes.\n\nText: ${text}`;
      // Try OpenAI first (fast), fall back to subprocess
      let translated = null;
      if (OPENAI_API_KEY && OPENAI_KEY_HEALTH.looksValid) {
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 8000);
          const r = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model: OPENAI_MODEL, messages: [{ role: "user", content: prompt }], max_tokens: 300 }),
            signal: ctrl.signal,
          });
          clearTimeout(t);
          if (r.ok) {
            const d = await r.json();
            translated = (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content || "").trim();
          }
        } catch {}
      }
      if (!translated) {
        // Try subprocess
        const subResult = await callClaudeSubprocess({ message: prompt, language: toLang, city: "", constraints: {}, recommendation: { options: [] }, conversationHistory: [] });
        if (subResult && subResult.ok) translated = subResult.text.trim();
      }
      if (!translated) return writeJson(res, 200, { ok: false, error: "translation_failed" });
      return writeJson(res, 200, { ok: true, translated, toLang });
    }

    if (req.method === "POST" && pathname === "/api/rag/query") {
      const body = await readBody(req);
      const query = String(body.query || body.message || "").trim();
      if (!query) return writeJson(res, 400, { error: "query required" });
      const audience = String(body.audience || "b2c").toLowerCase() === "b2b" ? "b2b" : "b2c";
      const language = normalizeLang(body.language || "ZH");
      const openaiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY;
      try {
        const result = await ragEngine.retrieveAndGenerate({
          query,
          audience,
          language,
          target_country: body.target_country || undefined,
          category: body.category || undefined,
          openaiApiKey: openaiKey,
          topK: Number(body.topK) || 4,
        });
        return writeJson(res, 200, { ok: true, generatedAt: nowIso(), ...result });
      } catch (err) {
        console.error("[RAG] query error:", err);
        return writeJson(res, 500, { ok: false, error: err.message });
      }
    }

    if (req.method === "POST" && pathname === "/api/rag/ingest") {
      // Admin-only: re-ingest all knowledge base docs
      const openaiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY;
      try {
        const count = await ragEngine.ingestAllDocs(openaiKey);
        return writeJson(res, 200, { ok: true, chunks: count, generatedAt: nowIso() });
      } catch (err) {
        return writeJson(res, 500, { ok: false, error: err.message });
      }
    }

    if (req.method === "GET" && pathname === "/api/rag/status") {
      const store = ragEngine.loadStore();
      const chunks = store.chunks || [];
      const embeddedCount = Object.keys(store.embeddingsMap || {}).length;
      const docIds = [...new Set(chunks.map((c) => c.docId))];
      return writeJson(res, 200, {
        totalChunks: chunks.length,
        embeddedChunks: embeddedCount,
        documents: docIds,
        generatedAt: nowIso(),
      });
    }

    if (req.method === "POST" && pathname === "/api/agent/plan") {
      const body = await readBody(req);
      const message = String(body.message || "").trim();
      if (!message) return writeJson(res, 400, { error: "message required" });
      const language = normalizeLang(body.language || db.users.demo.language || "EN");
      const cityRaw = String(body.city || db.users.demo.city || "Shanghai");
      const city = cityRaw.split("·")[0].trim() || "Shanghai";
      const constraints = body.constraints && typeof body.constraints === "object" ? body.constraints : {};
      const conversationHistory = Array.isArray(body.conversationHistory) ? body.conversationHistory : [];
      const plan = await runAgentWorkflow({ message, language, city, constraints, conversationHistory });
      return writeJson(res, 200, { generatedAt: nowIso(), ...plan });
    }

    if (req.method === "POST" && pathname === "/api/chat/reply") {
      const body = await readBody(req);
      const message = String(body.message || "").trim();
      if (!message) return writeJson(res, 400, { error: "message required" });
      const language = normalizeLang(body.language || db.users.demo.language || "EN");
      const cityRaw = String(body.city || db.users.demo.city || "Shanghai");
      const city = cityRaw.split("·")[0].trim() || db.users.demo.city || "Shanghai";
      const constraints = body.constraints && typeof body.constraints === "object" ? body.constraints : {};
      const conversationHistory = Array.isArray(body.conversationHistory) ? body.conversationHistory : [];
      const hotelSignal =
        /(hotel|stay|check[\s-]?in|accommodation|酒店|住宿|住一晚|订酒店|预订酒店)/i.test(message) ||
        Boolean(
          constraints.checkInDate ||
          constraints.checkOutDate ||
          constraints.check_in_date ||
          constraints.check_out_date ||
          constraints.starRating ||
          constraints.keyword,
        );

      let intentHint = detectIntentHint(message);
      let conversationStage = inferConversationStage(message, intentHint);
      let clarifyNeeded = isAmbiguousIntentMessage(message, constraints);
      let recommendation = null;
      let hotelSlots = null;
      let dynamicCandidates = null;

      if (hotelSignal) {
        intentHint = "travel";
        conversationStage = "hotel_selection";
        const slotInfo = extractHotelSlotInfo(message, constraints);
        hotelSlots = slotInfo.slots;
        const hotelRec = buildHotelRecommendationsFromSlots({
          slots: slotInfo.slots,
          language,
          pageNum: 1,
          pageSize: 20,
          refresh: /换一批|refresh|another batch|new options/i.test(message),
        });
        recommendation = {
          imagePath: (hotelRec.options[0] && hotelRec.options[0].imagePath) || "/assets/solution-flow.svg",
          comments: [hotelRec.summary],
          reasons: [
            pickLang(
              language,
              "按匹配度70% + 价格30%排序，并剔除不可售库存。",
              "Ranked by 70% match + 30% price, with non-bookable rooms removed.",
              "一致度70% + 価格30%で並べ替え、販売不可在庫を除外。",
              "일치도 70% + 가격 30%로 정렬하고 판매 불가 재고를 제외했습니다.",
            ),
          ],
          options: hotelRec.options.map((item) => ({
            ...item,
            analysis: Array.isArray(item.reasons) ? item.reasons : [],
          })),
          crossXChoice: hotelRec.crossXChoice,
        };

        const explicitDate =
          /(20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}|明天|后天|今天|tomorrow|today|day after tomorrow)/i.test(message) ||
          Boolean(constraints.checkInDate || constraints.checkOutDate || constraints.check_in_date || constraints.check_out_date);
        const explicitGuest =
          /(\d{1,2}\s*(人|位|people|pax|guest))/i.test(message) ||
          Boolean(constraints.guestNum || constraints.group_size || constraints.party_size);
        clarifyNeeded = !explicitDate || !explicitGuest;
      } else {
        dynamicCandidates = await fetchDynamicCandidatePool({
          message,
          city,
          constraints,
          language,
          intentHint,
        });
        recommendation = buildSolutionRecommendation(null, intentHint, city, language, constraints, dynamicCandidates);
      }

      const smart = await buildSmartChatReply({ message, language, city, constraints, recommendation, conversationHistory });
      const userCue = summarizeUserCue(message, language);
      const thinking = buildThinkingNarrative({ message, language, constraints, recommendation });
      const dataSources = buildChatDataSources({ hotelSignal, dynamicCandidates, recommendation });
      const options = (recommendation.options || []).slice(0, 3).map((item) => ({
        id: item.id,
        title: item.title,
        prompt: item.prompt,
        grade: item.grade || recommendationGrade(item.score),
        recommendationLevel: item.recommendationLevel || recommendationLevel(item.score, language),
        imagePath: item.imagePath,
        placeName: item.placeName,
        placeDisplay: item.placeDisplay || formatNameWithCnPinyin(item.placeName || "", language),
        hotelName: item.hotelName,
        hotelDisplay: item.hotelDisplay || formatNameWithCnPinyin(item.hotelName || "", language),
        transportMode: item.transportMode,
        etaWindow: item.etaWindow,
        costRange: item.costRange,
        openHours: item.openHours || null,
        touristFriendlyScore: item.touristFriendlyScore || null,
        paymentFriendly: item.paymentFriendly || null,
        englishMenu: item.englishMenu === true,
        nextActions: Array.isArray(item.nextActions) && item.nextActions.length
          ? item.nextActions.slice(0, 3)
          : buildOptionActions(item, conversationStage, language),
        executionPlan: Array.isArray(item.executionPlan) ? item.executionPlan.slice(0, 4) : [],
        comments: (item.comments || []).slice(0, 2),
        reasons: (() => {
          const pool = [];
          const seen = new Set();
          const push = (value) => {
            const text = String(value || "").trim();
            if (!text || seen.has(text)) return;
            seen.add(text);
            pool.push(text);
          };
          push(item.reason || "");
          for (const line of (item.analysis || item.reasons || [])) push(line);
          if (!pool.length) {
            push(
              pickLang(
                language,
                `基于你的目标与约束（${userCue}）综合筛选。`,
                `Selected by balancing your constraints (${userCue}).`,
                `あなたの条件（${userCue}）を総合評価して選定。`,
                `요청 제약(${userCue})을 종합 반영해 선별했습니다.`,
              ),
            );
          }
          return pool.slice(0, 3);
        })(),
        candidates: (item.candidates || []).slice(0, 3),
        hotelApi: item.hotelApi || null,
      }));
      audit.append({
        kind: "chat",
        who: "demo",
        what: "chat.smart_reply.generated",
        taskId: null,
        toolInput: { message, language, city, constraints, intentHint },
        toolOutput: { source: smart.source, model: smart.model, options: options.map((o) => ({ id: o.id, grade: o.grade })) },
      });
      saveDb();
      return writeJson(res, 200, {
        source: smart.source,
        model: smart.model,
        thinking,
        reply: smart.reply,
        fallbackReason: smart.fallbackReason || null,
        conversationStage,
        clarifyNeeded,
        hotelSlots,
        crossXChoice: recommendation.crossXChoice || null,
        options,
        dataSources,
        // AI-native structured plan (options_card / clarify) — client renders as itinerary cards
        structured: smart.structured || null,
        llm: {
          configured: Boolean(OPENAI_API_KEY),
          keyHealth: OPENAI_KEY_HEALTH,
          keySource: OPENAI_KEY_SOURCE,
          lastRuntime: OPENAI_LAST_RUNTIME,
        },
      });
    }

    if (req.method === "POST" && pathname === "/api/chat/freeform") {
      const body = await readBody(req);
      const message = String(body.message || "").trim();
      if (!message) return writeJson(res, 400, { error: "message required" });
      const language = normalizeLang(body.language || db.users.demo.language || "EN");
      const cityRaw = String(body.city || db.users.demo.city || "Shanghai");
      const city = cityRaw.split("·")[0].trim() || db.users.demo.city || "Shanghai";
      const constraints = body.constraints && typeof body.constraints === "object" ? body.constraints : {};

      const openai = await callOpenAIFreeformReply({ message, language, city, constraints });
      const fallbackReply = pickLang(
        language,
        "我在。告诉我你现在最想解决的一件事（吃饭、出行或酒店），我会马上给你两套可执行方案。",
        "I'm here. Tell me the one thing you want to solve now (food, travel, or hotel), and I'll return two executable options.",
        "対応できます。今いちばん解決したいこと（食事・移動・ホテル）を1つ教えてください。すぐに実行可能な2案を出します。",
        "도와드릴게요. 지금 가장 먼저 해결할 것(식사/이동/호텔) 한 가지만 말해주시면 실행 가능한 2가지 안을 바로 드릴게요.",
      );
      const reply = openai.ok ? openai.text : fallbackReply;
      const source = openai.ok ? "openai" : "fallback";
      const fallbackReason = openai.ok ? null : openai.error;

      audit.append({
        kind: "chat",
        who: "demo",
        what: "chat.freeform_reply.generated",
        taskId: null,
        toolInput: { message, language, city, constraints },
        toolOutput: { source, fallbackReason },
      });
      saveDb();
      return writeJson(res, 200, {
        source,
        model: source === "openai" ? OPENAI_MODEL : "fallback",
        reply,
        fallbackReason,
      });
    }

    if (req.method === "GET" && pathname === "/api/system/flags") {
      return writeJson(res, 200, { flags: db.featureFlags });
    }

    if (req.method === "GET" && pathname === "/api/system/flags/evaluate") {
      const userId = parsed.query.userId || "demo";
      return writeJson(res, 200, {
        userId,
        evaluated: evaluateFlagsForUser(userId),
      });
    }

    if (req.method === "POST" && pathname === "/api/system/flags") {
      const body = await readBody(req);
      if (!body || typeof body !== "object") {
        return writeJson(res, 400, { error: "Invalid flags payload" });
      }
      db.featureFlags = {
        ...db.featureFlags,
        ...body,
      };
      audit.append({
        kind: "system",
        who: "demo",
        what: "feature_flags.updated",
        taskId: null,
        toolInput: body,
        toolOutput: db.featureFlags,
      });
      saveDb();
      return writeJson(res, 200, { ok: true, flags: db.featureFlags });
    }

    if (req.method === "GET" && pathname === "/api/system/mcp-policy") {
      return writeJson(res, 200, { policy: db.mcpPolicy || { enforceSla: false, simulateBreachRate: 0 } });
    }

    if (req.method === "POST" && pathname === "/api/system/mcp-policy") {
      const body = await readBody(req);
      db.mcpPolicy = {
        enforceSla: body && body.enforceSla === true,
        simulateBreachRate: Math.max(0, Math.min(100, Number(body && body.simulateBreachRate ? body.simulateBreachRate : 0))),
      };
      audit.append({
        kind: "system",
        who: "demo",
        what: "mcp.policy.updated",
        taskId: null,
        toolInput: body,
        toolOutput: db.mcpPolicy,
      });
      saveDb();
      return writeJson(res, 200, { ok: true, policy: db.mcpPolicy });
    }

    if (req.method === "GET" && pathname === "/api/mcp/contracts") {
      return writeJson(res, 200, {
        contracts: buildMcpContractsSummary(),
      });
    }

    if (req.method === "POST" && pathname === "/api/mcp/contracts") {
      const body = await readBody(req);
      if (!body || typeof body !== "object" || !body.id) {
        return writeJson(res, 400, { error: "id required" });
      }
      const id = String(body.id);
      const prev = getMcpContract(id) || { id, provider: body.provider || id, external: body.external !== false };
      db.mcpContracts[id] = {
        ...prev,
        id,
        provider: body.provider || prev.provider,
        external: body.external !== undefined ? body.external === true : prev.external,
        slaMs: Math.max(100, Number(body.slaMs || prev.slaMs || 2000)),
        enforced: body.enforced !== false,
      };
      audit.append({
        kind: "system",
        who: "demo",
        what: "mcp.contract.updated",
        taskId: null,
        toolInput: body,
        toolOutput: db.mcpContracts[id],
      });
      saveDb();
      return writeJson(res, 200, { ok: true, contract: db.mcpContracts[id] });
    }

    if (req.method === "POST" && pathname === "/api/emergency/support") {
      const body = await readBody(req);
      const ticket = createSupportTicket({
        reason: body.reason || "user_clicked_emergency",
        taskId: body.taskId || null,
        source: "emergency_button",
      });
      const session = ensureSupportSessionForTicket(ticket, {
        startedBy: "user",
        reason: body.reason || "user_clicked_emergency",
        greeting: "Emergency request received. Voice/text room is now live.",
      });
      if (session) {
        setSupportSessionPresence(session, "user", true);
        appendSupportSessionMessage(session, {
          actor: "system",
          type: "event",
          text: "Emergency mode enabled. Ops will join shortly.",
          meta: { ticketId: ticket.id },
        });
        if (body && body.note) {
          appendSupportSessionMessage(session, {
            actor: "user",
            type: "text",
            text: String(body.note).slice(0, 320),
          });
        }
        touchTicketFromSession(session, "emergency_room_opened");
      }

      if (body.taskId && db.tasks[body.taskId]) {
        const task = db.tasks[body.taskId];
        task.handoff = {
          ticketId: ticket.id,
          sessionId: ticket.sessionId || (session && session.id) || null,
          status: ticket.status,
          source: ticket.source,
          eta: ticket.eta,
          requestedAt: ticket.createdAt,
          updatedAt: ticket.updatedAt,
        };
        syncTaskAgentMeta(task, "support");
        refreshTripByTask(task);
        lifecyclePush(task.lifecycle, "fallback_to_human", "Emergency human support requested", `Ticket ${ticket.id} opened`);
        task.updatedAt = nowIso();
      }

      pushMetricEvent({
        kind: "emergency_support_requested",
        userId: "demo",
        taskId: body.taskId || null,
        meta: { reason: body.reason || "user_clicked_emergency", ticketId: ticket.id, sessionId: ticket.sessionId || null },
      });
      audit.append({
        kind: "support",
        who: "demo",
        what: "emergency.support.requested",
        taskId: body.taskId || null,
        toolInput: body,
        toolOutput: { ticketId: ticket.id, sessionId: ticket.sessionId || null },
      });
      saveDb();
      return writeJson(res, 200, {
        ok: true,
        ticketId: ticket.id,
        sessionId: ticket.sessionId || null,
        ticket,
        session: session ? buildSupportSessionSummary(session) : null,
        eta: ticket.eta,
        channel: ticket.channel,
      });
    }

    if (req.method === "GET" && pathname === "/api/support/tickets") {
      const now = Date.now();
      const tickets = db.supportTickets
        .slice(-20)
        .reverse()
        .map((ticket) => {
          const session = ensureSupportSessionForTicket(ticket, { skipGreeting: true, startedBy: "system" });
          const created = new Date(ticket.createdAt).getTime();
          const elapsedMin = Math.max(0, Math.round((now - created) / 60000));
          const etaMin = Math.max(0, Number(ticket.etaMin || 5) - elapsedMin);
          return {
            ...ticket,
            etaMin,
            sessionId: ticket.sessionId || (session && session.id) || null,
            liveSession: session ? buildSupportSessionSummary(session) : null,
          };
        });
      return writeJson(res, 200, {
        tickets,
      });
    }

    if (req.method === "GET" && pathname === "/api/support/ops-board") {
      const limit = Number(parsed.query.limit || 80);
      return writeJson(res, 200, buildSupportOpsBoard(limit));
    }

    if (req.method === "POST" && pathname === "/api/support/sessions/start") {
      const body = await readBody(req);
      let ticket = null;
      if (body.ticketId) {
        ticket = db.supportTickets.find((item) => item.id === String(body.ticketId)) || null;
      }
      if (!ticket) {
        ticket = createSupportTicket({
          reason: body.reason || "live_support_started",
          taskId: body.taskId || null,
          source: body.source || "live_support_start",
        });
      }
      const session = ensureSupportSessionForTicket(ticket, {
        startedBy: normalizeSupportActor(body.actor || "user"),
        reason: body.reason || ticket.reason || "live_support_started",
        skipGreeting: true,
      });
      if (!session) return writeJson(res, 500, { error: "Session init failed" });
      setSupportSessionPresence(session, "user", true);
      appendSupportSessionMessage(session, {
        actor: "system",
        type: "event",
        text: body.urgent ? "Urgent live support requested. Ops priority escalated." : "Live support room is open.",
        meta: { ticketId: ticket.id, urgent: body.urgent === true },
      });
      if (body && body.text) {
        appendSupportSessionMessage(session, {
          actor: normalizeSupportActor(body.actor || "user"),
          type: "text",
          text: String(body.text).slice(0, 420),
        });
      }
      touchTicketFromSession(session, body.urgent ? "urgent_room_started" : "room_started");
      pushMetricEvent({
        kind: "support_session_started",
        userId: "demo",
        taskId: ticket.taskId || null,
        meta: { ticketId: ticket.id, sessionId: session.id, urgent: body.urgent === true },
      });
      audit.append({
        kind: "support",
        who: "demo",
        what: "support.session.started",
        taskId: ticket.taskId || null,
        toolInput: body,
        toolOutput: { ticketId: ticket.id, sessionId: session.id },
      });
      saveDb();
      return writeJson(res, 200, {
        ok: true,
        ticket,
        session: {
          ...buildSupportSessionSummary(session),
          messages: session.messages.slice(-60),
        },
      });
    }

    if (req.method === "GET" && pathname === "/api/support/sessions") {
      const statuses = parsed.query.status ? String(parsed.query.status).split(",") : [];
      const sessions = listSupportSessions({
        actor: parsed.query.actor || "user",
        statuses,
        limit: Number(parsed.query.limit || 40),
        ticketId: parsed.query.ticketId || "",
        taskId: parsed.query.taskId || "",
      }).map((session) => {
        const summary = buildSupportSessionSummary(session);
        const linkedTicket = findTicketBySessionId(session.id) || null;
        return {
          ...summary,
          ticketStatus: linkedTicket ? linkedTicket.status : null,
          ticketPriority: linkedTicket ? classifySupportTicket(linkedTicket).priority : null,
        };
      });
      return writeJson(res, 200, { sessions, total: sessions.length });
    }

    if (req.method === "GET" && /^\/api\/support\/sessions\/[^/]+$/.test(pathname)) {
      const sessionId = pathname.split("/")[4];
      const session = getSupportSessionById(sessionId);
      if (!session) return writeJson(res, 404, { error: "Session not found" });
      const actor = parsed.query.actor || "user";
      readSupportSession(session, actor);
      const ticket = findTicketBySessionId(session.id);
      if (ticket) ensureSupportSessionForTicket(ticket, { skipGreeting: true, startedBy: "system" });
      saveDb();
      return writeJson(res, 200, {
        session: {
          ...buildSupportSessionSummary(session),
          messages: session.messages.slice(-100),
        },
        ticket: ticket || null,
      });
    }

    if (req.method === "POST" && /^\/api\/support\/sessions\/[^/]+\/messages$/.test(pathname)) {
      const sessionId = pathname.split("/")[4];
      const session = getSupportSessionById(sessionId);
      if (!session) return writeJson(res, 404, { error: "Session not found" });
      const body = await readBody(req);
      const actor = normalizeSupportActor(body.actor || body.role || "user");
      const type = String(body.type || "text").toLowerCase() === "voice" ? "voice" : "text";
      const text = String(body.text || "").trim();
      const audioDataUrl = String(body.audioDataUrl || "");
      if (type === "voice") {
        if (!audioDataUrl.startsWith("data:audio/")) return writeJson(res, 400, { error: "audioDataUrl must be data:audio/*" });
        if (audioDataUrl.length > 1200000) return writeJson(res, 400, { error: "audioDataUrl too large" });
      } else if (!text) {
        return writeJson(res, 400, { error: "text is required" });
      }

      if (actor === "ops" && body.agentName) {
        session.assignedAgentName = String(body.agentName).slice(0, 80);
      }
      if (actor === "ops" && body.agentId) {
        session.assignedAgentId = String(body.agentId).slice(0, 80);
      }
      if (actor === "ops" && session.status === "waiting") {
        session.status = "active";
      }
      const ticket = findTicketBySessionId(session.id);
      if (ticket && actor === "ops" && ticket.status === "open") {
        const progressed = applyTicketTransitionAndSync(ticket, "in_progress", `Ticket ${ticket.id} -> in_progress`);
        if (!progressed.ok) return writeJson(res, 400, { error: progressed.error });
      }
      const message = appendSupportSessionMessage(session, {
        actor,
        type,
        text,
        audioDataUrl,
        durationSec: Number(body.durationSec || 0),
        meta: body.meta && typeof body.meta === "object" ? body.meta : {},
      });
      touchTicketFromSession(session, actor === "ops" ? "ops_replied" : "user_replied");
      pushMetricEvent({
        kind: actor === "ops" ? "support_ops_reply" : "support_user_reply",
        userId: "demo",
        taskId: (ticket && ticket.taskId) || null,
        meta: { sessionId: session.id, ticketId: ticket && ticket.id, type },
      });
      audit.append({
        kind: "support",
        who: actor === "ops" ? "ops_agent" : "demo",
        what: "support.session.message",
        taskId: (ticket && ticket.taskId) || null,
        toolInput: { actor, type },
        toolOutput: { sessionId: session.id, ticketId: ticket ? ticket.id : null, messageId: message && message.id },
      });
      saveDb();
      return writeJson(res, 200, {
        ok: true,
        message,
        session: {
          ...buildSupportSessionSummary(session),
          messages: session.messages.slice(-100),
        },
        ticket: ticket || null,
      });
    }

    if (req.method === "POST" && /^\/api\/support\/sessions\/[^/]+\/read$/.test(pathname)) {
      const sessionId = pathname.split("/")[4];
      const session = getSupportSessionById(sessionId);
      if (!session) return writeJson(res, 404, { error: "Session not found" });
      const body = await readBody(req);
      readSupportSession(session, body.actor || "user");
      saveDb();
      return writeJson(res, 200, { ok: true, session: buildSupportSessionSummary(session) });
    }

    if (req.method === "POST" && /^\/api\/support\/sessions\/[^/]+\/presence$/.test(pathname)) {
      const sessionId = pathname.split("/")[4];
      const session = getSupportSessionById(sessionId);
      if (!session) return writeJson(res, 404, { error: "Session not found" });
      const body = await readBody(req);
      setSupportSessionPresence(session, body.actor || "user", body.online !== false);
      saveDb();
      return writeJson(res, 200, { ok: true, session: buildSupportSessionSummary(session) });
    }

    if (req.method === "POST" && /^\/api\/support\/sessions\/[^/]+\/claim$/.test(pathname)) {
      const sessionId = pathname.split("/")[4];
      const session = getSupportSessionById(sessionId);
      if (!session) return writeJson(res, 404, { error: "Session not found" });
      const body = await readBody(req);
      session.assignedAgentId = String(body.agentId || "ops_agent").slice(0, 80);
      session.assignedAgentName = String(body.agentName || "Ops Agent").slice(0, 80);
      session.status = "active";
      setSupportSessionPresence(session, "ops", true);
      appendSupportSessionMessage(session, {
        actor: "system",
        type: "event",
        text: `${session.assignedAgentName} joined the room.`,
      });
      const ticket = findTicketBySessionId(session.id);
      if (ticket && ticket.status === "open") {
        const progressed = applyTicketTransitionAndSync(ticket, "in_progress", `Ticket ${ticket.id} -> in_progress`);
        if (!progressed.ok) return writeJson(res, 400, { error: progressed.error });
      }
      pushMetricEvent({
        kind: "support_session_claimed",
        userId: "ops_agent",
        taskId: (ticket && ticket.taskId) || null,
        meta: { sessionId: session.id, ticketId: ticket && ticket.id, agentId: session.assignedAgentId },
      });
      audit.append({
        kind: "support",
        who: "ops_agent",
        what: "support.session.claimed",
        taskId: (ticket && ticket.taskId) || null,
        toolInput: body,
        toolOutput: { sessionId: session.id, ticketId: ticket ? ticket.id : null },
      });
      saveDb();
      return writeJson(res, 200, { ok: true, session: buildSupportSessionSummary(session), ticket: ticket || null });
    }

    if (req.method === "POST" && /^\/api\/support\/sessions\/[^/]+\/close$/.test(pathname)) {
      const sessionId = pathname.split("/")[4];
      const session = getSupportSessionById(sessionId);
      if (!session) return writeJson(res, 404, { error: "Session not found" });
      const body = await readBody(req);
      const ticket = findTicketBySessionId(session.id);
      closeSupportSession(session, body.note || "Session closed");
      if (ticket && body.resolveTicket !== false) {
        if (ticket.status === "open") {
          const progressed = applyTicketTransitionAndSync(ticket, "in_progress", `Ticket ${ticket.id} -> in_progress`);
          if (!progressed.ok) return writeJson(res, 400, { error: progressed.error });
        }
        if (ticket.status === "in_progress") {
          const resolved = applyTicketTransitionAndSync(ticket, "resolved", `Ticket ${ticket.id} -> resolved`);
          if (!resolved.ok) return writeJson(res, 400, { error: resolved.error });
        }
      }
      pushMetricEvent({
        kind: "support_session_closed",
        userId: "ops_agent",
        taskId: (ticket && ticket.taskId) || null,
        meta: { sessionId: session.id, ticketId: ticket && ticket.id, resolved: body.resolveTicket !== false },
      });
      audit.append({
        kind: "support",
        who: "ops_agent",
        what: "support.session.closed",
        taskId: (ticket && ticket.taskId) || null,
        toolInput: body,
        toolOutput: { sessionId: session.id, ticketId: ticket ? ticket.id : null },
      });
      saveDb();
      return writeJson(res, 200, { ok: true, session: buildSupportSessionSummary(session), ticket: ticket || null });
    }

    if (req.method === "POST" && /^\/api\/support\/tickets\/[^/]+\/evidence$/.test(pathname)) {
      const ticketId = pathname.split("/")[4];
      const ticket = db.supportTickets.find((t) => t.id === ticketId);
      if (!ticket) return writeJson(res, 404, { error: "Ticket not found" });
      const body = await readBody(req);
      const item = {
        id: `evi_${Date.now().toString().slice(-8)}_${(ticket.evidence || []).length + 1}`,
        type: String(body.type || "user_note"),
        note: String(body.note || "").slice(0, 240),
        hash: makeProofHash(`${ticket.id}:${body.type || "user_note"}:${Date.now()}`),
        at: nowIso(),
      };
      if (!Array.isArray(ticket.evidence)) ticket.evidence = [];
      ticket.evidence.push(item);
      ticket.updatedAt = nowIso();
      ticket.history.push({ at: nowIso(), status: ticket.status, note: "evidence_uploaded" });
      const session = ensureSupportSessionForTicket(ticket, { skipGreeting: true, startedBy: "system" });
      if (session) {
        appendSupportSessionMessage(session, {
          actor: "system",
          type: "event",
          text: `Evidence added: ${item.type}`,
          meta: { evidenceId: item.id, note: item.note },
        });
      }
      audit.append({
        kind: "support",
        who: "demo",
        what: "support.ticket.evidence.added",
        taskId: ticket.taskId || null,
        toolInput: body,
        toolOutput: { ticketId: ticket.id, evidenceId: item.id },
      });
      saveDb();
      return writeJson(res, 200, { ok: true, ticketId: ticket.id, evidence: item, count: ticket.evidence.length });
    }

    if (req.method === "POST" && /^\/api\/support\/tickets\/[^/]+\/status$/.test(pathname)) {
      const ticketId = pathname.split("/")[4];
      const ticket = db.supportTickets.find((t) => t.id === ticketId);
      if (!ticket) return writeJson(res, 404, { error: "Ticket not found" });
      const body = await readBody(req);
      const toStatus = body.status;
      if (!["in_progress", "resolved"].includes(toStatus)) {
        return writeJson(res, 400, { error: "Unsupported status" });
      }
      const updated = applyTicketTransitionAndSync(ticket, toStatus, `Ticket ${ticket.id} -> ${toStatus}`);
      if (!updated.ok) return writeJson(res, 400, { error: updated.error });
      const task = findTaskByTicketId(ticket.id);

      pushMetricEvent({
        kind: `handoff_${toStatus}`,
        userId: "demo",
        taskId: ticket.taskId || null,
        meta: { ticketId: ticket.id },
      });
      audit.append({
        kind: "support",
        who: "demo",
        what: "support.ticket.status.updated",
        taskId: ticket.taskId || null,
        toolInput: { ticketId: ticket.id, from: updated.from, to: updated.to },
        toolOutput: { status: ticket.status, sessionId: ticket.sessionId || null },
      });
      saveDb();
      return writeJson(res, 200, { ok: true, ticket, taskId: ticket.taskId || null, task: task || null, sessionId: ticket.sessionId || null });
    }

    if (req.method === "POST" && pathname === "/api/tasks") {
      const body = await readBody(req);
      const task = createTask(body);
      return writeJson(res, 200, { taskId: task.id, plan: task.plan, task });
    }

    if (req.method === "GET" && /^\/api\/tasks\/[^/]+$/.test(pathname)) {
      const taskId = pathname.split("/")[3];
      const task = requireTask(taskId, res);
      if (!task) return;
      return writeJson(res, 200, { task });
    }

    if (req.method === "GET" && /^\/api\/tasks\/[^/]+\/state$/.test(pathname)) {
      const taskId = pathname.split("/")[3];
      const task = requireTask(taskId, res);
      if (!task) return;
      syncTaskAgentMeta(task);
      return writeJson(res, 200, {
        taskId: task.id,
        status: task.status,
        constraints: task.constraints || {},
        sessionState: task.sessionState || null,
        expertRoute: task.expertRoute || null,
      });
    }

    if (req.method === "POST" && /^\/api\/tasks\/[^/]+\/state$/.test(pathname)) {
      const taskId = pathname.split("/")[3];
      const task = requireTask(taskId, res);
      if (!task) return;
      const body = await readBody(req);
      const slots = body.slots && typeof body.slots === "object" ? body.slots : {};
      const laneId = body.laneId ? String(body.laneId) : "";
      const stage = body.stage ? String(body.stage) : "";
      const changedBySlots = applySessionSlotsToConstraints(task, slots);
      const shouldReplan = body.replan === true || changedBySlots;
      let updatedTask = task;

      if (shouldReplan && canReplanTask(task)) {
        updatedTask = replanTask(task, {
          intent: String(body.intent || task.intent || "").trim() || task.intent,
          constraints: task.constraints || {},
        });
      } else {
        const intentType = (task.plan && task.plan.intentType) || "eat";
        const meta = buildAgentMeta({
          taskId: task.id,
          intent: task.intent || "",
          intentType,
          constraints: task.constraints || {},
        });
        task.expertRoute = meta.expertRoute;
        task.sessionState = {
          ...meta.sessionState,
          stage: stage || mapTaskStatusToSessionStage(task.status),
          laneId: laneId || (task.sessionState && task.sessionState.laneId) || (task.plan && task.plan.laneId) || `${intentType}_default`,
          updatedAt: nowIso(),
        };
        if (task.plan) {
          task.plan.expertRoute = task.expertRoute;
          task.plan.sessionState = task.sessionState;
          task.plan.laneId = task.sessionState.laneId;
        }
        task.updatedAt = nowIso();
        audit.append({
          kind: "task",
          who: task.userId,
          what: "task.state.updated",
          taskId: task.id,
          toolInput: body,
          toolOutput: { stage: task.sessionState.stage, missingSlots: task.sessionState.missingSlots || [] },
        });
        saveDb();
      }

      if (laneId) {
        if (!updatedTask.sessionState) syncTaskAgentMeta(updatedTask);
        updatedTask.sessionState.laneId = laneId;
        if (updatedTask.plan) updatedTask.plan.laneId = laneId;
      }
      if (stage) {
        syncTaskAgentMeta(updatedTask, stage);
      } else {
        syncTaskAgentMeta(updatedTask);
      }
      refreshTripByTask(updatedTask);
      updatedTask.updatedAt = nowIso();
      saveDb();
      return writeJson(res, 200, {
        ok: true,
        task: updatedTask,
        sessionState: updatedTask.sessionState || null,
        expertRoute: updatedTask.expertRoute || null,
      });
    }

    if (req.method === "POST" && /^\/api\/tasks\/[^/]+\/replan\/preview$/.test(pathname)) {
      const taskId = pathname.split("/")[3];
      const task = requireTask(taskId, res);
      if (!task) return;
      if (!canReplanTask(task)) {
        return writeJson(res, 409, {
          error: `Task ${task.id} cannot be previewed in status ${task.status}`,
          status: task.status,
        });
      }
      const body = await readBody(req);
      const preview = buildReplanPreview(task, body);
      return writeJson(res, 200, { ok: true, preview });
    }

    if (req.method === "POST" && /^\/api\/tasks\/[^/]+\/replan$/.test(pathname)) {
      const taskId = pathname.split("/")[3];
      const task = requireTask(taskId, res);
      if (!task) return;
      if (!canReplanTask(task)) {
        return writeJson(res, 409, {
          error: `Task ${task.id} cannot be replanned in status ${task.status}`,
          status: task.status,
        });
      }
      const body = await readBody(req);
      const nextTask = replanTask(task, body);
      return writeJson(res, 200, { ok: true, task: nextTask, plan: nextTask.plan });
    }

    if (req.method === "POST" && /^\/api\/tasks\/[^/]+\/steps\/[^/]+\/retry$/.test(pathname)) {
      const parts = pathname.split("/");
      const taskId = parts[3];
      const stepId = parts[5];
      const task = requireTask(taskId, res);
      if (!task) return;
      const step = (task.steps || task.plan.steps || []).find((s) => s.id === stepId);
      if (!step) return writeJson(res, 404, { error: "Step not found" });
      if (!task.confirmed) {
        return writeJson(res, 400, { error: "Task is not confirmed yet" });
      }
      if (task.status === "completed") {
        return writeJson(res, 409, { error: "Task already completed. Replan to run a new lane." });
      }
      task.fallbackEvents.push({
        kind: "step_retry_requested",
        at: nowIso(),
        note: `Retry requested for ${stepId}`,
      });
      if (!task.plan.constraints || typeof task.plan.constraints !== "object") {
        task.plan.constraints = {};
      }
      task.plan.constraints.mcpPolicy = db.mcpPolicy || { enforceSla: false, simulateBreachRate: 0 };
      task.plan.constraints.mcpContracts = JSON.parse(JSON.stringify(db.mcpContracts || {}));
      lifecyclePush(task.lifecycle, "retry_requested", "Step retry requested", `${step.label}`);
      step.status = "queued";
      step.latency = 0;
      step.outputPreview = "";
      task.status = "confirmed";
      syncTaskAgentMeta(task, "confirming");
      refreshTripByTask(task);
      task.updatedAt = nowIso();
      audit.append({
        kind: "task",
        who: task.userId,
        what: "task.step.retry.requested",
        taskId: task.id,
        toolInput: { stepId },
        toolOutput: { status: task.status },
      });
      saveDb();
      return writeJson(res, 200, { ok: true, task, stepId, nextAction: "execute_task_again" });
    }

    if (req.method === "GET" && /^\/api\/tasks\/[^/]+\/refund-policy$/.test(pathname)) {
      const taskId = pathname.split("/")[3];
      const task = requireTask(taskId, res);
      if (!task) return;
      const confirm = (task.plan && task.plan.confirm) || {};
      return writeJson(res, 200, {
        taskId,
        policy: {
          cancelPolicy: confirm.cancelPolicy || "Refer to provider policy",
          guarantee: confirm.guarantee || null,
          amount: confirm.amount || 0,
          currency: confirm.currency || "CNY",
        },
      });
    }

    if (req.method === "POST" && /^\/api\/tasks\/[^/]+\/confirm$/.test(pathname)) {
      const taskId = pathname.split("/")[3];
      const task = requireTask(taskId, res);
      if (!task) return;
      const body = await readBody(req);
      task.confirmed = true;
      task.confirmedAt = nowIso();
      task.confirmPayload = body;
      task.status = "confirmed";
      syncTaskAgentMeta(task, "confirming");
      refreshTripByTask(task);
      lifecyclePush(task.lifecycle, "confirmed", "User confirmed", "Cost/risk consent received.");
      task.updatedAt = nowIso();
      audit.append({
        kind: "task",
        who: task.userId,
        what: "task.confirmed",
        taskId: task.id,
        toolInput: body,
        toolOutput: { status: "ok" },
      });
      pushMetricEvent({ kind: "task_confirmed", userId: task.userId, taskId: task.id });
      saveDb();
      return writeJson(res, 200, { ok: true, task });
    }

    if (req.method === "POST" && /^\/api\/tasks\/[^/]+\/pause$/.test(pathname)) {
      const taskId = pathname.split("/")[3];
      const task = requireTask(taskId, res);
      if (!task) return;
      task.pauseState = "paused";
      task.status = task.status === "completed" ? task.status : "paused";
      syncTaskAgentMeta(task, mapTaskStatusToSessionStage(task.status));
      refreshTripByTask(task);
      lifecyclePush(task.lifecycle, "paused", "Task paused", "Paused by user.");
      task.updatedAt = nowIso();
      audit.append({
        kind: "task",
        who: task.userId,
        what: "task.paused",
        taskId: task.id,
        toolInput: {},
        toolOutput: { pauseState: task.pauseState },
      });
      pushMetricEvent({ kind: "task_paused", userId: task.userId, taskId: task.id });
      saveDb();
      return writeJson(res, 200, { ok: true, task });
    }

    if (req.method === "POST" && /^\/api\/tasks\/[^/]+\/resume$/.test(pathname)) {
      const taskId = pathname.split("/")[3];
      const task = requireTask(taskId, res);
      if (!task) return;
      task.pauseState = "active";
      if (task.status === "paused") task.status = "confirmed";
      syncTaskAgentMeta(task, mapTaskStatusToSessionStage(task.status));
      refreshTripByTask(task);
      lifecyclePush(task.lifecycle, "resumed", "Task resumed", "Resumed by user.");
      task.updatedAt = nowIso();
      audit.append({
        kind: "task",
        who: task.userId,
        what: "task.resumed",
        taskId: task.id,
        toolInput: {},
        toolOutput: { pauseState: task.pauseState },
      });
      pushMetricEvent({ kind: "task_resumed", userId: task.userId, taskId: task.id });
      saveDb();
      return writeJson(res, 200, { ok: true, task });
    }

    if (req.method === "POST" && /^\/api\/tasks\/[^/]+\/cancel$/.test(pathname)) {
      const taskId = pathname.split("/")[3];
      const task = requireTask(taskId, res);
      if (!task) return;
      task.status = "canceled";
      task.pauseState = "canceled";
      syncTaskAgentMeta(task, "support");
      refreshTripByTask(task);
      lifecyclePush(task.lifecycle, "canceled", "Task canceled", "Canceled by user.");
      task.updatedAt = nowIso();
      task.fallbackEvents.push({
        kind: "user_cancel",
        at: nowIso(),
        note: "Task canceled before or during execution",
      });
      audit.append({
        kind: "task",
        who: task.userId,
        what: "task.canceled",
        taskId: task.id,
        toolInput: {},
        toolOutput: { status: task.status },
      });
      pushMetricEvent({ kind: "task_canceled", userId: task.userId, taskId: task.id });
      saveDb();
      return writeJson(res, 200, { ok: true, task });
    }

    if (req.method === "POST" && /^\/api\/tasks\/[^/]+\/handoff$/.test(pathname)) {
      const cached = readIdempotent(req, pathname);
      if (cached) return writeJson(res, 200, cached);
      const taskId = pathname.split("/")[3];
      const task = requireTask(taskId, res);
      if (!task) return;
      const body = await readBody(req);
      if (task.handoff && task.handoff.status === "open") {
        const existingTicket = db.supportTickets.find((item) => item.id === task.handoff.ticketId) || null;
        if (existingTicket) {
          const existingSession = ensureSupportSessionForTicket(existingTicket, { skipGreeting: true, startedBy: "system" });
          if (existingSession) task.handoff.sessionId = existingSession.id;
        }
        const payload = { ok: true, task, handoff: task.handoff };
        writeIdempotent(req, pathname, payload);
        return writeJson(res, 200, payload);
      }
      const ticket = createSupportTicket({
        reason: body.reason || "user_requested_handoff",
        taskId: task.id,
        source: "task_handoff",
      });
      task.handoff = {
        ticketId: ticket.id,
        sessionId: ticket.sessionId || null,
        status: ticket.status,
        source: ticket.source,
        eta: ticket.eta,
        requestedAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
      };
      syncTaskAgentMeta(task, "support");
      refreshTripByTask(task);
      lifecyclePush(task.lifecycle, "fallback_to_human", "Human handoff requested", `Ticket ${ticket.id} opened.`);
      task.updatedAt = nowIso();
      pushMetricEvent({
        kind: "handoff_manual_created",
        userId: task.userId,
        taskId: task.id,
        meta: { ticketId: ticket.id },
      });
      audit.append({
        kind: "support",
        who: task.userId,
        what: "task.handoff.requested",
        taskId: task.id,
        toolInput: body,
        toolOutput: { ticketId: ticket.id },
      });
      saveDb();
      const payload = { ok: true, task, handoff: task.handoff };
      writeIdempotent(req, pathname, payload);
      return writeJson(res, 200, payload);
    }

    if (req.method === "POST" && /^\/api\/tasks\/[^/]+\/execute$/.test(pathname)) {
      const cached = readIdempotent(req, pathname);
      if (cached) return writeJson(res, 200, cached);
      const taskId = pathname.split("/")[3];
      const task = requireTask(taskId, res);
      if (!task) return;
      if (!task.confirmed) return writeJson(res, 400, { error: "Task not confirmed" });
      if (task.status === "completed" && task.orderId && db.orders[task.orderId]) {
        return writeJson(res, 200, {
          timeline: task.timeline || [],
          task,
          order: db.orders[task.orderId],
          replay: true,
        });
      }
      const result = await executeTask(task);
      const payload = { timeline: task.timeline, task: result.task, order: result.order };
      writeIdempotent(req, pathname, payload);
      return writeJson(res, 200, payload);
    }

    if (req.method === "GET" && /^\/api\/tasks\/[^/]+\/detail$/.test(pathname)) {
      const taskId = pathname.split("/")[3];
      const task = requireTask(taskId, res);
      if (!task) return;
      return writeJson(res, 200, { detail: taskDetail(task) });
    }

    if (req.method === "GET" && pathname === "/api/tasks") {
      return writeJson(res, 200, { tasks: Object.values(db.tasks).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
    }

    if (req.method === "POST" && pathname === "/api/payments/authorize") {
      const body = await readBody(req);
      const user = db.users.demo;
      user.authDomain = {
        noPinEnabled: body.noPinEnabled !== false,
        dailyLimit: Number(body.dailyLimit || user.authDomain.dailyLimit),
        singleLimit: Number(body.singleLimit || user.authDomain.singleLimit),
      };
      audit.append({
        kind: "payment",
        who: "demo",
        what: "payments.authorize.updated",
        taskId: null,
        toolInput: body,
        toolOutput: user.authDomain,
      });
      saveDb();
      return writeJson(res, 200, { ok: true, authDomain: user.authDomain });
    }

    if (req.method === "GET" && pathname === "/api/payments/compliance") {
      return writeJson(res, 200, {
        compliance: buildPaymentComplianceSummary(),
      });
    }

    if (req.method === "POST" && pathname === "/api/payments/compliance") {
      const body = await readBody(req);
      db.paymentCompliance = {
        ...db.paymentCompliance,
        ...body,
        policy: {
          ...((db.paymentCompliance && db.paymentCompliance.policy) || {}),
          ...((body && body.policy) || {}),
        },
        rails: {
          ...((db.paymentCompliance && db.paymentCompliance.rails) || {}),
          ...((body && body.rails) || {}),
        },
      };
      audit.append({
        kind: "payment",
        who: "demo",
        what: "payments.compliance.updated",
        taskId: null,
        toolInput: body,
        toolOutput: db.paymentCompliance,
      });
      saveDb();
      return writeJson(res, 200, { ok: true, compliance: buildPaymentComplianceSummary() });
    }

    if (req.method === "POST" && pathname === "/api/payments/compliance/certify") {
      const body = await readBody(req);
      const railId = normalizeRail(body.railId);
      const prev = getRailCompliance(railId);
      db.paymentCompliance.rails[railId] = {
        ...prev,
        certified: body.certified !== false,
        kycPassed: body.kycPassed !== false,
        pciDss: body.pciDss !== false,
        enabled: body.enabled !== false,
        riskTier: body.riskTier || prev.riskTier || "medium",
      };
      audit.append({
        kind: "payment",
        who: "demo",
        what: "payments.compliance.certified",
        taskId: null,
        toolInput: body,
        toolOutput: { railId, compliance: db.paymentCompliance.rails[railId] },
      });
      saveDb();
      return writeJson(res, 200, { ok: true, railId, compliance: db.paymentCompliance.rails[railId] });
    }

    if (req.method === "GET" && pathname === "/api/payments/rails") {
      return writeJson(res, 200, buildPaymentRailsStatus("demo"));
    }

    if (req.method === "POST" && pathname === "/api/payments/rails/select") {
      const body = await readBody(req);
      const railId = normalizeRail(body.railId);
      const check = canUseRail(railId);
      if (!check.ok) {
        return writeJson(res, 409, {
          error: check.reason,
          code: check.code,
          railId,
          compliance: getRailCompliance(railId),
        });
      }
      const user = db.users.demo;
      user.paymentRail = { selected: railId };
      audit.append({
        kind: "payment",
        who: "demo",
        what: "payments.rail.selected",
        taskId: null,
        toolInput: body,
        toolOutput: { selected: railId },
      });
      saveDb();
      return writeJson(res, 200, { ok: true, ...buildPaymentRailsStatus("demo") });
    }

    if (req.method === "POST" && pathname === "/api/payments/verify-intent") {
      const body = await readBody(req);
      const result = confirmPolicy.verifyIntent({
        amount: Number(body.amount || 0),
        secondFactor: body.secondFactor,
      });
      return writeJson(res, 200, result);
    }

    if (req.method === "POST" && pathname === "/api/user/privacy") {
      const body = await readBody(req);
      const user = db.users.demo;
      user.privacy = {
        ...user.privacy,
        locationEnabled: body.locationEnabled !== false,
      };
      audit.append({
        kind: "privacy",
        who: "demo",
        what: "user.privacy.updated",
        taskId: null,
        toolInput: body,
        toolOutput: user.privacy,
      });
      saveDb();
      return writeJson(res, 200, { ok: true, privacy: user.privacy });
    }

    if (req.method === "GET" && pathname === "/api/user/export") {
      const tasks = Object.values(db.tasks).filter((t) => t.userId === "demo");
      const tripPlans = Object.values(db.tripPlans || {})
        .filter((trip) => trip.userId === "demo")
        .map((trip) => buildTripDetail(trip));
      const orders = Object.values(db.orders).filter((o) => {
        const task = db.tasks[o.taskId];
        return task && task.userId === "demo";
      });
      return writeJson(res, 200, {
        exportedAt: nowIso(),
        user: db.users.demo,
        tripPlans,
        tasks,
        orders,
        auditLogs: audit.readRecent(20),
      });
    }

    if (req.method === "POST" && pathname === "/api/user/delete-data") {
      db.tasks = {};
      db.tripPlans = {};
      db.orders = {};
      db.settlements = [];
      db.providerLedger = [];
      db.reconciliationRuns = [];
      db.auditLogs = [];
      db.mcpCalls = [];
      db.idempotency = {};
      db.users.demo.plusSubscription = { active: false, plan: "none", benefits: [] };
      db.users.demo.authDomain = { noPinEnabled: true, dailyLimit: 2000, singleLimit: 500 };
      db.users.demo.paymentRail = { selected: "alipay_cn" };
      db.users.demo.viewMode = "user";
      db.users.demo.preferences = {
        budget: "mid",
        dietary: "",
        family: false,
        accessibility: "optional",
        transport: "mixed",
        walking: "walk",
        allergy: "",
      };
      db.users.demo.savedPlaces = {
        hotel: "",
        office: "",
        airport: "PVG",
      };
      db.users.demo.location = {
        lat: null,
        lng: null,
        accuracy: null,
        updatedAt: null,
        source: "none",
      };
      db.users.demo.privacy = { locationEnabled: true };
      db.mcpPolicy = { enforceSla: false, simulateBreachRate: 0 };
      db.mcpContracts = {
        gaode_or_fallback: { id: "gaode_or_fallback", provider: "Gaode LBS", external: true, slaMs: 2200, enforced: true },
        partner_hub_queue: { id: "partner_hub_queue", provider: "Partner Hub Queue API", external: true, slaMs: 1800, enforced: true },
        partner_hub_booking: { id: "partner_hub_booking", provider: "Partner Hub Booking API", external: true, slaMs: 2500, enforced: true },
        partner_hub_traffic: { id: "partner_hub_traffic", provider: "Partner Hub Traffic API", external: true, slaMs: 1800, enforced: true },
        partner_hub_transport: { id: "partner_hub_transport", provider: "Partner Hub Transport API", external: true, slaMs: 2500, enforced: true },
        payment_rail: { id: "payment_rail", provider: "ACT Rail Gateway", external: true, slaMs: 3200, enforced: true },
      };
      db.paymentCompliance = {
        policy: {
          blockUncertifiedRails: true,
          requireFraudScreen: true,
        },
        rails: {
          alipay_cn: { certified: true, kycPassed: true, pciDss: true, riskTier: "low", enabled: true },
          wechat_cn: { certified: true, kycPassed: true, pciDss: true, riskTier: "medium", enabled: true },
          card_delegate: { certified: true, kycPassed: true, pciDss: true, riskTier: "high", enabled: true },
        },
      };
      db.miniProgram = {
        version: "0.1.0",
        channels: {
          alipay: { status: "ready", pathPrefix: "pages/" },
          wechat: { status: "ready", pathPrefix: "pages/" },
        },
        releases: [],
      };
      saveDb();
      return writeJson(res, 200, { ok: true, deletedAt: nowIso() });
    }

    if (req.method === "GET" && pathname === "/api/billing/reconciliation") {
      const current = buildReconciliationSummary();
      return writeJson(res, 200, {
        current: {
          checked: current.checked,
          matched: current.matched,
          mismatched: current.mismatched,
          matchRate: current.matchRate,
          mismatchAmount: current.mismatchAmount,
        },
        mismatches: current.mismatches.slice(0, 20),
        runs: [...db.reconciliationRuns].slice(-20).reverse(),
      });
    }

    if (req.method === "POST" && pathname === "/api/billing/reconciliation/run") {
      const run = runReconciliationBatch();
      audit.append({
        kind: "billing",
        who: "system",
        what: "billing.reconciliation.batch_run",
        taskId: null,
        toolInput: {},
        toolOutput: {
          runId: run.id,
          checked: run.summary.checked,
          mismatched: run.summary.mismatched,
        },
      });
      saveDb();
      return writeJson(res, 200, { ok: true, run });
    }

    if (req.method === "GET" && pathname === "/api/billing/settlements") {
      return writeJson(res, 200, {
        settlements: [...db.settlements].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100),
        summary: buildSettlementSummary(),
      });
    }

    if (req.method === "POST" && pathname === "/api/billing/settlements/run") {
      const created = runSettlementBatch();
      audit.append({
        kind: "billing",
        who: "system",
        what: "billing.settlement.batch_run",
        taskId: null,
        toolInput: {},
        toolOutput: { created: created.length },
      });
      saveDb();
      return writeJson(res, 200, {
        ok: true,
        created: created.length,
        summary: buildSettlementSummary(),
      });
    }

    if (req.method === "GET" && pathname === "/api/trips") {
      const trips = Object.values(db.tripPlans || {})
        .filter((trip) => trip.userId === "demo")
        .map((trip) => buildTripSummary(trip))
        .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
      return writeJson(res, 200, { trips });
    }

    if (req.method === "POST" && pathname === "/api/trips") {
      const body = await readBody(req);
      const trip = createTripPlan(body, "demo");
      return writeJson(res, 200, { ok: true, trip: buildTripSummary(trip) });
    }

    if (req.method === "GET" && /^\/api\/trips\/[^/]+$/.test(pathname)) {
      const tripId = pathname.split("/")[3];
      const trip = requireTripPlan(tripId, res);
      if (!trip) return;
      if (trip.userId !== "demo") return writeJson(res, 403, { error: "Forbidden" });
      return writeJson(res, 200, { trip: buildTripDetail(trip) });
    }

    if (req.method === "POST" && /^\/api\/trips\/[^/]+\/tasks$/.test(pathname)) {
      const tripId = pathname.split("/")[3];
      const trip = requireTripPlan(tripId, res);
      if (!trip) return;
      if (trip.userId !== "demo") return writeJson(res, 403, { error: "Forbidden" });
      const body = await readBody(req);
      const taskId = String(body.taskId || "");
      if (!taskId || !db.tasks[taskId]) return writeJson(res, 400, { error: "taskId is required" });
      const task = db.tasks[taskId];
      const attached = attachTaskToTripPlan(task, tripId);
      if (!attached) return writeJson(res, 400, { error: "Unable to attach task to trip" });
      lifecyclePush(task.lifecycle, "trip_attached", "Attached to trip", `Trip ${tripId}`);
      task.updatedAt = nowIso();
      audit.append({
        kind: "trip",
        who: "demo",
        what: "trip.task.attached",
        taskId: task.id,
        toolInput: { tripId, taskId: task.id },
        toolOutput: { tripStatus: attached.derivedStatus },
      });
      saveDb();
      return writeJson(res, 200, { ok: true, trip: buildTripDetail(attached), task });
    }

    if (req.method === "POST" && /^\/api\/trips\/[^/]+\/status$/.test(pathname)) {
      const tripId = pathname.split("/")[3];
      const trip = requireTripPlan(tripId, res);
      if (!trip) return;
      if (trip.userId !== "demo") return writeJson(res, 403, { error: "Forbidden" });
      const body = await readBody(req);
      const next = String(body.status || "").toLowerCase();
      if (!["active", "paused", "completed", "canceled"].includes(next)) {
        return writeJson(res, 400, { error: "Unsupported status" });
      }
      trip.status = next;
      lifecyclePush(trip.lifecycle, next, `Trip ${next}`, `Updated by user.`);
      refreshTripPlan(trip);
      audit.append({
        kind: "trip",
        who: "demo",
        what: "trip.status.updated",
        taskId: null,
        toolInput: { tripId, status: next },
        toolOutput: { derivedStatus: trip.derivedStatus },
      });
      saveDb();
      return writeJson(res, 200, { ok: true, trip: buildTripSummary(trip) });
    }

    if (req.method === "GET" && pathname === "/api/orders") {
      const orders = Object.values(db.orders).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return writeJson(res, 200, { orders });
    }

    // ── CrossX Consumer Plan Orders (checkout flow) ────────────────────────
    if (req.method === "POST" && pathname === "/api/order/create") {
      const body = await readBody(req);
      const ts  = Date.now();
      const ref = "CXS-" + ts.toString(36).slice(-5).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
      if (!db.crossx_orders) db.crossx_orders = {};
      db.crossx_orders[ref] = {
        ref,
        status: "pending",
        method: String(body.method || "card"),
        destination: String(body.destination || ""),
        total: Number(body.total || 0),
        planId: String(body.plan?.id || ""),
        planTag: String(body.plan?.tag || ""),
        createdAt: new Date(ts).toISOString(),
        ip: req.socket?.remoteAddress || "default",
      };
      saveDb();
      return writeJson(res, 200, { ok: true, ref, status: "pending" });
    }

    if (req.method === "GET" && pathname === "/api/order/status") {
      const ref = String(parsed.query.ref || "");
      if (!ref) return writeJson(res, 400, { error: "missing_ref" });
      if (!db.crossx_orders) db.crossx_orders = {};
      const ord = db.crossx_orders[ref];
      if (!ord) return writeJson(res, 404, { error: "not_found" });
      // Auto-confirm after 2.5 s (mock payment processing)
      if (ord.status === "pending") {
        const age = Date.now() - new Date(ord.createdAt).getTime();
        if (age >= 2500) {
          ord.status = "confirmed";
          ord.confirmedAt = new Date().toISOString();
          saveDb();
        }
      }
      return writeJson(res, 200, {
        ok: true, ref,
        status: ord.status,
        total: ord.total,
        destination: ord.destination,
        planTag: ord.planTag,
      });
    }

    if (req.method === "GET" && /^\/api\/orders\/[^/]+\/detail$/.test(pathname)) {
      const orderId = pathname.split("/")[3];
      const order = db.orders[orderId];
      if (!order) return writeJson(res, 404, { error: "Order not found" });
      return writeJson(res, 200, {
        detail: buildOrderDetail(order),
      });
    }

    if (req.method === "POST" && /^\/api\/orders\/[^/]+\/cancel$/.test(pathname)) {
      const cached = readIdempotent(req, pathname);
      if (cached) return writeJson(res, 200, cached);
      const orderId = pathname.split("/")[3];
      const order = db.orders[orderId];
      if (!order) return writeJson(res, 404, { error: "Order not found" });
      if (order.status === "canceled" || order.status === "refunded") {
        const payload = { ok: true, order, refunded: false };
        writeIdempotent(req, pathname, payload);
        return writeJson(res, 200, payload);
      }
      const body = await readBody(req);
      order.status = "refunding";
      lifecyclePush(order.lifecycle, "refunding", "Refund in progress", `Reason: ${body.reason || "user_request"}`);
      order.refundable = false;
      order.refund = {
        amount: Math.floor(order.price * 0.8),
        currency: order.currency,
        status: "processing",
        eta: (order.refundPolicy && order.refundPolicy.estimatedArrival) || "T+1 to T+3",
        at: nowIso(),
      };
      order.refund.status = "processed";
      order.status = "refunded";
      lifecyclePush(order.lifecycle, "refunded", "Refund completed", `${order.refund.amount} ${order.refund.currency} refunded.`);
      order.updatedAt = nowIso();
      reconcileSettlementForOrder(order);
      const task = db.tasks[order.taskId];
      if (task) {
        task.status = "canceled";
        syncTaskAgentMeta(task, "support");
        refreshTripByTask(task);
        lifecyclePush(task.lifecycle, "refunded", "Order refunded", `Order ${order.id} refunded.`);
      }

      audit.append({
        kind: "order",
        who: "demo",
        what: "order.canceled",
        taskId: order.taskId,
        toolInput: { orderId, reason: body.reason || "user_request" },
        toolOutput: { refund: order.refund },
      });
      db.mcpCalls.push({
        id: `mcp_${Date.now()}_cancel`,
        taskId: order.taskId,
        at: nowIso(),
        op: "Cancel",
        toolType: "order.cancel",
        request: { op: "Cancel", payload: { orderId }, at: nowIso() },
        response: {
          op: "Cancel",
          ok: true,
          status: "success",
          code: "ok",
          latency: 1,
          slaMs: 2500,
          slaMet: true,
          data: {
            provider: "Cross X Core",
            source: "server",
            sourceTs: nowIso(),
            refund: order.refund,
          },
        },
      });
      pushMetricEvent({
        kind: "order_canceled",
        userId: "demo",
        taskId: order.taskId,
        orderId,
      });
      saveDb();
      const payload = { ok: true, order, refunded: true };
      writeIdempotent(req, pathname, payload);
      return writeJson(res, 200, payload);
    }

    if (req.method === "GET" && /^\/api\/orders\/[^/]+\/share-card$/.test(pathname)) {
      const orderId = pathname.split("/")[3];
      const order = db.orders[orderId];
      if (!order) return writeJson(res, 404, { error: "Order not found" });
      return writeJson(res, 200, {
        orderId,
        shareCard: buildShareCard(order),
      });
    }

    if (req.method === "GET" && pathname === "/api/mini-program/package") {
      return writeJson(res, 200, {
        package: buildMiniProgramPackage(),
      });
    }

    if (req.method === "POST" && pathname === "/api/mini-program/release") {
      const body = await readBody(req);
      const release = createMiniRelease({
        channel: body.channel,
        note: body.note,
      });
      audit.append({
        kind: "release",
        who: "system",
        what: "mini_program.release.created",
        taskId: null,
        toolInput: body,
        toolOutput: release,
      });
      saveDb();
      return writeJson(res, 200, {
        ok: true,
        release,
        package: buildMiniProgramPackage(),
      });
    }

    if (req.method === "GET" && /^\/api\/orders\/[^/]+\/proof$/.test(pathname)) {
      const orderId = pathname.split("/")[3];
      const order = db.orders[orderId];
      if (!order) return writeJson(res, 404, { error: "Order not found" });
      const task = order.taskId ? db.tasks[order.taskId] : null;
      const detail = task ? taskDetail(task) : null;
      const language = normalizeLang(parsed.query.language || db.users.demo.language || "EN");
      const recommendation = buildSolutionRecommendation(task ? task.id : null, null, null, language);
      return writeJson(res, 200, {
        orderId,
        proof: order.proof,
        order,
        proofItems: order.proofItems || [],
        insights: {
          imagePath: recommendation.imagePath,
          comments: (recommendation.comments || []).slice(0, 3),
          reasons: (recommendation.reasons || []).slice(0, 3),
          keyMoments: detail ? detail.keyMoments : [],
          proofChain: detail ? detail.proofChain.slice(-5) : [],
        },
      });
    }

    if (req.method === "GET" && pathname === "/api/nearby/suggestions") {
      const user = db.users.demo || {};
      const language = normalizeLang(parsed.query.language || user.language || "EN");
      const L = (zh, en, ja, ko) => pickLang(language, zh, en, ja, ko);
      const cityRaw = String(parsed.query.city || user.city || "Shanghai").split("·")[0].trim() || "Shanghai";
      const city = localizedCityName(cityRaw, language);
      const candidates = cityLaneCandidates(cityRaw, language);
      const originLat = Number.isFinite(Number(user.location && user.location.lat)) ? Number(user.location.lat) : 31.23;
      const originLng = Number.isFinite(Number(user.location && user.location.lng)) ? Number(user.location.lng) : 121.47;
      const p1 = offsetCoords(originLat, originLng, 0.6, -0.3);
      const p2 = offsetCoords(originLat, originLng, 1.8, 0.9);
      const p3 = offsetCoords(originLat, originLng, 3.2, 2.1);
      const p4 = offsetCoords(originLat, originLng, -1.3, 1.2);
      return writeJson(res, 200, {
        city,
        origin: {
          lat: originLat,
          lng: originLng,
          source: (user.location && user.location.source) || "default_city_center",
        },
        filters: {
          distance: ["500m", "1km", "3km"],
          budget: ["low", "mid", "high"],
          queue: ["short", "normal", "any"],
          dietary: ["none", "halal", "vegan", "vegetarian"],
          booking: ["bookable_only", "all"],
          foreignCard: ["supported_only", "all"],
          defaultBudget: (user.preferences && user.preferences.budget) || "mid",
        },
        items: [
          {
            id: "n1",
            type: "eat",
            title: L(`预订 1km 内${city}地道面馆`, `Book ${city} local noodles within 1km`, `${city} のローカル麺店を1km以内で予約`, `${city} 1km 내 로컬 누들 예약`),
            placeName: candidates.eat[0] ? candidates.eat[0].name : `${city} Local Noodle Lab`,
            eta: L("15 分钟", "15 min", "15 分", "15분"),
            successRate7d: 0.93,
            riskCode: "queue_peak",
            risk: L("晚餐高峰排队波动", "Queue fluctuates at dinner peak", "夕食ピーク時は待ち変動あり", "저녁 피크 시간 대기 변동"),
            costRange: "CNY 48-96",
            why: L("匹配你的步行 + 地道偏好。", "Matches your walkable + local preference.", "徒歩圏かつローカル志向に一致。", "도보 + 현지 선호와 일치."),
            recommendationGrade: "S",
            recommendationLevel: recommendationLevel(95, language),
            imageUrl: "https://images.unsplash.com/photo-1525755662778-989d0524087e?auto=format&fit=crop&w=1000&q=80",
            executeWill: L("检索 -> 查排队 -> 锁位 -> 支付定金 -> 交付双语凭证。", "Search -> check queue -> lock booking -> pay deposit -> deliver bilingual proof.", "検索 -> 待ち確認 -> 枠確保 -> デポジット支払い -> 二言語証憑を交付。", "검색 -> 대기 확인 -> 예약 잠금 -> 보증금 결제 -> 이중언어 증빙 전달."),
            map: { lat: p1.lat, lng: p1.lng, route: L("步行 8 分钟", "8 min walk", "徒歩8分", "도보 8분"), distanceKm: 0.6 },
          },
          {
            id: "n2",
            type: "eat",
            title: L("预订亲子友好且排队较短的火锅", "Reserve family hotpot with short queue", "待ち時間の短いファミリーホットポットを予約", "대기 짧은 가족 훠궈 예약"),
            placeName: candidates.eat[2] ? candidates.eat[2].name : `${city} Family Hotpot Garden`,
            eta: L("25 分钟", "25 min", "25 分", "25분"),
            successRate7d: 0.9,
            riskCode: "deposit_peak",
            risk: L("高峰时段可能要求定金", "May require deposit at peak hours", "ピーク時はデポジットが必要な場合あり", "피크 시간 보증금 필요 가능"),
            costRange: "CNY 88-158",
            why: L("亲子座位友好，订位成功率高。", "Family-friendly seating + high success booking rate.", "家族席に適し、予約成功率が高い。", "가족 좌석 친화적이며 예약 성공률 높음."),
            recommendationGrade: "A",
            recommendationLevel: recommendationLevel(88, language),
            imageUrl: "https://images.unsplash.com/photo-1515003197210-e0cd71810b5f?auto=format&fit=crop&w=1000&q=80",
            executeWill: L("筛亲子座位 -> 预测排队 -> 锁座 -> 支付 -> 可分享凭证。", "Filter family tables -> queue prediction -> lock seat -> pay -> shareable proof.", "家族席フィルタ -> 待ち予測 -> 席確保 -> 決済 -> 共有可能証憑。", "가족 좌석 필터 -> 대기 예측 -> 좌석 잠금 -> 결제 -> 공유 증빙."),
            map: { lat: p2.lat, lng: p2.lng, route: L("打车 12 分钟", "12 min taxi", "タクシー12分", "택시 12분"), distanceKm: 2.4 },
          },
          {
            id: "n3",
            type: "travel",
            title: L("酒店 -> 景点 -> 机场（时限安全）", "Hotel -> attraction -> airport (deadline safe)", "ホテル -> 観光地 -> 空港（締切に安全）", "호텔 -> 명소 -> 공항 (시간 여유형)"),
            placeName: candidates.travel[0] ? candidates.travel[0].name : `${city} Riverside Premium Hotel`,
            eta: L("80 分钟", "80 min", "80 分", "80분"),
            successRate7d: 0.88,
            riskCode: "traffic_peak",
            risk: L("滨江路段拥堵波动较大", "Traffic volatility near riverfront", "川沿い区間は渋滞変動が大きい", "강변 구간 교통 변동 큼"),
            costRange: "CNY 120-260",
            why: L("最适合赶时间的机场接驳。", "Best for time-constrained airport transfer.", "時間制約のある空港移動に最適。", "시간 제약 있는 공항 이동에 최적."),
            recommendationGrade: "A",
            recommendationLevel: recommendationLevel(86, language),
            imageUrl: "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1000&q=80",
            executeWill: L("路线规划 -> 拥堵检查 -> 锁车 -> 支付 -> 生成二维码行程卡。", "Plan route -> congestion check -> lock ride -> pay -> generate QR trip card.", "経路計画 -> 渋滞確認 -> 車両確保 -> 決済 -> QR行程カード生成。", "경로 계획 -> 혼잡 확인 -> 차량 잠금 -> 결제 -> QR 일정 카드 생성."),
            map: { lat: p3.lat, lng: p3.lng, route: L("网约车 + 高速", "Car + expressway", "車 + 高速", "차량 + 고속도로"), distanceKm: 38 },
          },
          {
            id: "n4",
            type: "travel",
            title: L("地铁+打车混合路线（更省钱）", "Metro + taxi mixed route for lower cost", "地下鉄+タクシー混合ルート（低コスト）", "지하철+택시 혼합 경로 (저비용)"),
            placeName: candidates.travel[2] ? candidates.travel[2].name : `${city} Metro + Taxi Saver`,
            eta: L("60 分钟", "60 min", "60 分", "60분"),
            successRate7d: 0.91,
            riskCode: "transfer_complex",
            risk: L("高峰站点换乘复杂", "Transfer complexity at peak stations", "ピーク駅での乗換が複雑", "혼잡 역 환승 복잡"),
            costRange: "CNY 60-118",
            why: L("兼顾低成本和可预测 ETA。", "Optimized for lower spend with predictable ETA.", "低コストと予測可能なETAを両立。", "낮은 비용과 예측 가능한 ETA를 함께 충족."),
            recommendationGrade: "B",
            recommendationLevel: recommendationLevel(76, language),
            imageUrl: "https://images.unsplash.com/photo-1502877338535-766e1452684a?auto=format&fit=crop&w=1000&q=80",
            executeWill: L("生成组合路线 -> 锁定交通 -> 支付 -> 双语导航与回执。", "Build mixed route -> lock transport -> pay -> bilingual navigation + receipts.", "混合ルート作成 -> 交通確保 -> 決済 -> 二言語ナビとレシート。", "혼합 경로 생성 -> 교통 잠금 -> 결제 -> 이중언어 길안내/영수증."),
            map: { lat: p4.lat, lng: p4.lng, route: L("地铁 + 短途打车", "Metro + short taxi", "地下鉄 + 短距離タクシー", "지하철 + 단거리 택시"), distanceKm: 24 },
          },
        ],
        mapPreview: {
          center: { lat: originLat, lng: originLng },
          zoom: 12,
          imagePath: "/assets/solution-flow.svg",
        },
      });
    }

    if (req.method === "POST" && pathname === "/api/subscription/plus") {
      const body = await readBody(req);
      const user = db.users.demo;
      user.plusSubscription = {
        active: body.active !== false,
        plan: body.plan || "monthly",
        benefits: ["7x24 human fallback", "Real-time translation", "Scarce resource concierge"],
      };
      audit.append({
        kind: "subscription",
        who: "demo",
        what: "plus.updated",
        taskId: null,
        toolInput: body,
        toolOutput: user.plusSubscription,
      });
      saveDb();
      return writeJson(res, 200, { ok: true, plus: user.plusSubscription });
    }

    if (req.method === "POST" && pathname === "/api/user/preferences") {
      const body = await readBody(req);
      const user = db.users.demo;
      user.language = body.language || user.language;
      user.city = body.city || user.city;
      user.preferences = {
        ...user.preferences,
        ...(body.preferences || {}),
      };
      if (body.savedPlaces && typeof body.savedPlaces === "object") {
        user.savedPlaces = {
          ...(user.savedPlaces || {}),
          ...body.savedPlaces,
        };
      }
      audit.append({
        kind: "user",
        who: "demo",
        what: "user.preferences.updated",
        taskId: null,
        toolInput: body,
        toolOutput: { language: user.language, preferences: user.preferences, savedPlaces: user.savedPlaces },
      });
      saveDb();
      return writeJson(res, 200, { ok: true, user });
    }

    if (req.method === "POST" && pathname === "/api/user/location") {
      const body = await readBody(req);
      const user = db.users.demo;
      const lat = toNumberOrNull(body.lat !== undefined ? body.lat : body.latitude);
      const lng = toNumberOrNull(body.lng !== undefined ? body.lng : body.longitude);
      if (lat === null || lng === null) {
        return writeJson(res, 400, { error: "lat/lng required" });
      }
      const accuracy = toNumberOrNull(body.accuracy);
      // Use real reverse geocoding API (AMap/GaoDe) with WGS-84→GCJ-02 correction
      const inferred = await reverseGeocodeWithAmap(lat, lng);
      const city = String(body.city || inferred.city);
      const cityZh = String(inferred.cityZh || city);
      const province = String(inferred.province || city);
      const provinceZh = String(inferred.provinceZh || cityZh);
      const district = String(inferred.district || "");
      const districtZh = String(inferred.districtZh || "");
      user.city = city;
      user.cityZh = cityZh;
      user.province = province;
      user.provinceZh = provinceZh;
      user.district = district;
      user.districtZh = districtZh;
      user.location = {
        lat: Number(lat.toFixed(6)),
        lng: Number(lng.toFixed(6)),
        accuracy: accuracy === null ? null : Number(accuracy.toFixed(1)),
        updatedAt: nowIso(),
        source: body.source || "browser_geolocation",
        geocodeSource: process.env.GAODE_KEY || process.env.AMAP_KEY ? "amap" : "fallback_lookup",
      };
      audit.append({
        kind: "user",
        who: "demo",
        what: "user.location.updated",
        taskId: null,
        toolInput: { lat, lng, accuracy, source: body.source || "browser_geolocation" },
        toolOutput: { city, cityZh, province, provinceZh, district, districtZh, location: user.location },
      });
      saveDb();
      return writeJson(res, 200, { ok: true, city, cityZh, province, provinceZh, district, districtZh, location: user.location });
    }

    if (req.method === "GET" && pathname === "/api/user/location") {
      const user = db.users.demo;
      return writeJson(res, 200, {
        city: user.city || "Shanghai",
        location: user.location || { lat: null, lng: null, accuracy: null, updatedAt: null, source: "none" },
      });
    }

    if (req.method === "POST" && pathname === "/api/user/view-mode") {
      const body = await readBody(req);
      const mode = body && body.mode === "admin" ? "admin" : "user";
      db.users.demo.viewMode = mode;
      audit.append({
        kind: "user",
        who: "demo",
        what: "user.view_mode.updated",
        taskId: null,
        toolInput: body,
        toolOutput: { mode },
      });
      saveDb();
      return writeJson(res, 200, { ok: true, mode });
    }

    if (req.method === "GET" && pathname === "/api/trust/summary") {
      return writeJson(res, 200, {
        summary: buildUserTrustSummary(db.users.demo),
      });
    }

    if (req.method === "GET" && pathname === "/api/trust/audit-logs") {
      return writeJson(res, 200, { logs: audit.readRecent(20) });
    }

    if (req.method === "GET" && /^\/api\/trust\/audit-logs\/[^/]+$/.test(pathname)) {
      const auditId = pathname.split("/")[4];
      const event = (db.auditLogs || []).find((item) => item.id === auditId);
      if (!event) return writeJson(res, 404, { error: "Audit event not found" });
      const relatedOrders = Object.values(db.orders || {}).filter((order) => order.taskId && order.taskId === event.taskId);
      const relatedProofItems = relatedOrders.flatMap((order) => (Array.isArray(order.proofItems) ? order.proofItems : []));
      return writeJson(res, 200, {
        event: {
          ...event,
          relatedProofItems: relatedProofItems.slice(0, 20),
        },
      });
    }

    if (req.method === "GET" && pathname === "/api/trust/mcp-calls") {
      return writeJson(res, 200, { calls: db.mcpCalls.slice(-20).reverse() });
    }

    if (req.method === "GET" && pathname === "/api/user") {
      return writeJson(res, 200, { user: db.users.demo });
    }

    const parts = parsePath(pathname);
    if (req.method === "GET" && parts[0] === "api" && parts[1] === "tasks" && parts[2]) {
      const task = db.tasks[parts[2]];
      if (!task) return writeJson(res, 404, { error: "Task not found" });
      return writeJson(res, 200, { task });
    }

    // ── POST /api/chat/plan — SSE Streaming Plan Builder ─────────────────────
    // Streams status events: INIT → H_SEARCH → T_CALC → B_CHECK → FINAL
    // Intent classifier routes: RAG queries skip to FINAL directly.
    if (req.method === "POST" && pathname === "/api/chat/plan") {
      const body = await readBody(req);
      const message = String(body.message || "").trim();
      if (!message) return writeJson(res, 400, { error: "message required" });
      const language = normalizeLang(body.language || db.users.demo.language || "ZH");
      const cityRaw = String(body.city || db.users.demo.city || "Shanghai");
      const city = cityRaw.split("·")[0].trim() || "Shanghai";
      const constraints = body.constraints && typeof body.constraints === "object" ? body.constraints : {};
      const conversationHistory = Array.isArray(body.conversationHistory) ? body.conversationHistory : [];

      // SSE headers
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const emit = (data) => { try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch {} };
      const delay = (ms) => new Promise((r) => setTimeout(r, ms));

      try {
        const intent = classifyBookingIntent(message, constraints);

        // ── RAG PATH: knowledge / how-to questions ─────────────────────────
        if (intent === "rag") {
          emit({ type: "status", code: "INIT", label: pickLang(language, "正在查询知识库...", "Searching knowledge base...", "知識ベースを検索中...", "지식 기반 검색 중...") });
          await delay(300);
          // Inject session itinerary context for follow-up Q&A
          const clientIpRag = req.socket?.remoteAddress || req.connection?.remoteAddress || "default";
          const prevItinerary = sessionItinerary.get(clientIpRag);
          const itineraryCtx = prevItinerary && (Date.now() - prevItinerary.storedAt < 7200000)
            ? `

用户已生成的行程计划（上下文参考）:
${JSON.stringify(prevItinerary.card_data, null, 2).slice(0, 1200)}`
            : "";
          const queryWithCtx = itineraryCtx ? message + itineraryCtx : message;
          const openaiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY;
          let ragAnswer = null;
          if (openaiKey) {
            try {
              const ragResult = await ragEngine.retrieveAndGenerate({
                query: queryWithCtx, audience: "b2c", language,
                openaiApiKey: openaiKey, topK: 4,
              });
              if (ragResult.ragUsed && ragResult.answer) {
                ragAnswer = ragResult.answer;
                if (ragResult.citations && ragResult.citations.length) {
                  ragAnswer += `\n\n📚 来源: ${ragResult.citations.map((c) => `[${c.docId}]`).join(" ")}`;
                }
              }
            } catch (e) { console.warn("[plan/rag]", e.message); }
          }
          if (!ragAnswer) {
            try {
              const chatRes = await callCasualChat({ message, language, city });
              if (chatRes.ok) ragAnswer = chatRes.text;
            } catch (e) { console.warn("[plan/rag/fallback]", e.message); }
          }
          emit({
            type: "final",
            response_type: "text",
            text: ragAnswer || pickLang(language,
              "您好！请告诉我您的旅行需求，我来帮您安排。",
              "Hi! Tell me your travel plans and I'll arrange everything for you.",
              "こんにちは！旅行計画を教えてください。",
              "안녕하세요! 여행 계획을 말씀해 주세요.",
            ),
            source: ragAnswer ? "rag" : "fallback",
          });
          res.end();
          return;
        }

        // ── BOOKING PATH: trip planning ─────────────────────────────────────
        emit({ type: "status", code: "INIT", label: "需求拆解中..." });

        // Extract slots from message + constraints
        const slots = extractAgentConstraints(message, constraints);
        const cityResolved = slots.city || constraints.destination || city;
        let days   = slots.duration   || Number(constraints.days)       || 0;
        let pax    = slots.party_size || Number(constraints.party_size) || 0;
        let budget = slots.budget     || Number(constraints.budget)     || 0;

        // Broader budget extraction: "8000预算" / "1万预算" / "8000元" patterns
        if (!budget) {
          const bm = message.match(/(\d[\d,]*)\s*(?:万)?\s*(?:元|预算|budget|RMB|CNY|rmb|cny)/i);
          if (bm) {
            let num = parseFloat(bm[1].replace(/,/g, ""));
            if (/万/.test(bm[0])) num *= 10000;
            budget = num;
          }
        }
        // Also handle "预算8000" / "budget 8000" order
        if (!budget) {
          const bm2 = message.match(/(?:预算|budget)[^\d]*(\d[\d,]+)/i);
          if (bm2) budget = parseFloat(bm2[1].replace(/,/g, ""));
        }
        // Days: also match "5日" / "五天"
        if (!days) {
          const dm = message.match(/([一二三四五六七八九十\d]+)\s*(?:天|日|nights?|days?)/i);
          if (dm) {
            const cjkMap = { "一":1,"二":2,"三":3,"四":4,"五":5,"六":6,"七":7,"八":8,"九":9,"十":10 };
            days = cjkMap[dm[1]] || parseInt(dm[1], 10) || 0;
          }
        }
        // Pax: also match "N口之家" / "N位"
        if (!pax) {
          const pm = message.match(/([一二三四五六七八九十\d]+)\s*(?:人|位|口|guests?|pax)/i);
          if (pm) {
            const cjkMap = { "一":1,"二":2,"三":3,"四":4,"五":5,"六":6,"七":7,"八":8,"九":9,"十":10 };
            pax = cjkMap[pm[1]] || parseInt(pm[1], 10) || 0;
          }
        }

        // Missing slots → clarify immediately
        const missing = [];
        if (!cityResolved || cityResolved === "Shanghai") missing.push("destination");
        if (!days)   missing.push("dates");
        if (!pax)    missing.push("pax");
        if (!budget) missing.push("budget");

        if (missing.length > 0) {
          await delay(500);
          const slotNames = { destination: "目的地城市", dates: "出行天数", pax: "随行人数", budget: "总预算（元）" };
          const clarifyText = `为了给您规划最合适的行程，请问${missing.map((s) => slotNames[s] || s).join("、")}是多少？`;
          emit({ type: "final", response_type: "clarify", spoken_text: clarifyText, missing_slots: missing });
          res.end();
          return;
        }

        await delay(400);

        // H_SEARCH: mock hotel search
        emit({ type: "status", code: "H_SEARCH", label: `正在检索${cityResolved}优质酒店...` });
        await delay(900);

        // T_CALC: mock transport calculation
        emit({ type: "status", code: "T_CALC", label: "核算接机与市内交通费..." });
        await delay(800);

        // B_CHECK: budget validation
        emit({ type: "status", code: "B_CHECK", label: `预算校验中（目标 ¥${Number(budget).toLocaleString()}）...` });
        await delay(600);

        // Build complete three-tier plan with NO empty fields
        const plans = mockBuildThreeTierPlans({ city: cityResolved, budget, pax, days });

        emit({ type: "final", ...plans });
        res.end();
      } catch (err) {
        emit({ type: "error", msg: "服务暂时繁忙，请稍后重试" });
        res.end();
      }
      return;
    }

    // ── POST /api/booking/create — Create pending itinerary order ─────────
    if (req.method === "POST" && pathname === "/api/booking/create") {
      const body = await readBody(req);
      const { optionId, totalCost, currency, planSnapshot } = body || {};
      if (!optionId || !totalCost) return writeJson(res, 400, { error: "optionId and totalCost required" });

      const rand = () => Math.random().toString(36).slice(2, 6).toUpperCase();
      const orderId = `CX-${Date.now().toString(36).toUpperCase()}-${rand()}`;
      const now = nowIso();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

      db.orders[orderId] = {
        orderId, type: "itinerary", source: "itinerary_card",
        optionId: String(optionId), totalCost: Number(totalCost),
        currency: String(currency || "CNY"), status: "awaiting_payment",
        createdAt: now, expiresAt,
        planSnapshot: planSnapshot || null,
      };
      audit.append({ kind: "booking", who: "demo", what: "booking.created", taskId: null,
        toolInput: { optionId, totalCost }, toolOutput: { orderId, status: "awaiting_payment" } });
      saveDb();

      return writeJson(res, 200, {
        status: "awaiting_payment", orderId,
        totalCost: Number(totalCost), currency: String(currency || "CNY"),
        expiresAt, msg: "订单已锁定，请在15分钟内完成支付",
      });
    }

    // ── POST /api/booking/confirm — Confirm payment & issue itinerary ─────
    if (req.method === "POST" && pathname === "/api/booking/confirm") {
      const body = await readBody(req);
      const { orderId } = body || {};
      if (!orderId) return writeJson(res, 400, { error: "orderId required" });
      const order = db.orders[orderId];
      if (!order) return writeJson(res, 404, { error: "Order not found" });

      const itineraryId = `ITN-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      order.status = "confirmed";
      order.itineraryId = itineraryId;
      order.confirmedAt = nowIso();

      audit.append({ kind: "booking", who: "demo", what: "booking.confirmed", taskId: null,
        toolInput: { orderId }, toolOutput: { itineraryId, status: "confirmed" } });
      saveDb();

      return writeJson(res, 200, {
        status: "success", orderId, itineraryId,
        msg: "支付成功！您的行程已确认，电子凭证已发送至您的邮箱。",
      });
    }

    // ── POST /api/plan/coze — OpenAI Planning Pipeline (SSE) ────────────────
    if (req.method === "POST" && pathname === "/api/plan/coze") {
      return planRouter.handleCoze(req, res);
    }

    // ── GET /api/amap/status — Amap API key health check ──────────────────────
    if (req.method === "GET" && pathname === "/api/amap/status") {
      return writeJson(res, 200, {
        configured: Boolean(AMAP_API_KEY),
        keyPreview: AMAP_API_KEY ? `${AMAP_API_KEY.slice(0, 6)}...` : null,
      });
    }

    // ── GET /api/amap/poi — Real-time POI search via Amap ────────────────────
    // Query: city, type (hotel|restaurant|transport|halal), limit
    if (req.method === "GET" && pathname === "/api/amap/poi") {
      if (!AMAP_API_KEY) return writeJson(res, 503, { error: "Amap API not configured" });
      const city  = String(parsed.query.city || "").trim();
      const type  = String(parsed.query.type || "hotel").trim();
      const limit = Math.min(20, Math.max(1, parseInt(parsed.query.limit || "10", 10)));
      if (!city) return writeJson(res, 400, { error: "city required" });
      const pois = await queryAmapPoi(city, type);
      if (!pois) return writeJson(res, 502, { error: "Amap API failed or returned no results" });
      return writeJson(res, 200, { ok: true, city, type, count: pois.length, pois: pois.slice(0, limit) });
    }

    // ── GET /api/attractions/search — Search Sichuan attraction knowledge base ─
    if (req.method === "GET" && pathname === "/api/attractions/search") {
      const city    = String(parsed.query.city || "").trim();
      const keyword = String(parsed.query.keyword || "").trim();
      const limit   = Math.min(20, Math.max(1, parseInt(parsed.query.limit || "8", 10)));
      const results = searchAttractions({ city, keyword, limit });
      return writeJson(res, 200, {
        ok: true, city, keyword, count: results.length, attractions: results,
        source: "sichuan-csv-kb",
      });
    }

    // ── POST /api/attractions/ask — RAG Q&A over Sichuan attraction data ──────
    // Routes to: 1) Python RAG service (if running), 2) local keyword search + OpenAI
    if (req.method === "POST" && pathname === "/api/attractions/ask") {
      const body = await readBody(req);
      const question = String(body.question || body.message || "").trim();
      const sessionId = String(body.session_id || body.sessionId || "crossx-default");
      const language = normalizeLang(body.language || "ZH");
      if (!question) return writeJson(res, 400, { error: "question required" });

      // 1. Try Python RAG service first
      const ragResult = await callPythonRagService(question, sessionId);
      if (ragResult && ragResult.answer) {
        return writeJson(res, 200, {
          ok: true, answer: ragResult.answer,
          sources: ragResult.sources.slice(0, 3),
          provider: "python-rag",
        });
      }

      // 2. Local search: extract city+keyword from question and search CSV
      const cityMatch = question.match(/[\u6210\u90fd\u4e50\u5c71\u9633\u5bdc\u963f\u575d\u96c5\u5b89\u5b9c\u5bbe\u81ea\u8d21\u5e7f\u5143\u5e7f\u5b89\u5357\u5145\u51ef\u8fbe\u5dde\u5185\u6c5f\u51c9\u5c71\u6885\u5c71\u5df4\u4e2d\u5fb7\u9633\u8d44\u9633\u653b\u679d\u82b1]/);
      const localCity = cityMatch ? cityMatch[0] : "";
      const localResults = searchAttractions({ city: localCity, keyword: question, limit: 5 });

      if (!localResults.length) {
        return writeJson(res, 200, {
          ok: true,
          answer: pickLang(language,
            "抱歉，暂时没有找到相关景点信息，建议您直接前往携程或大众点评查询。",
            "Sorry, no matching attractions found. Please check Ctrip or Dianping.",
            "該当する観光地が見つかりませんでした。携程（Ctrip）をご確認ください。",
            "관련 관광지를 찾지 못했습니다. Ctrip을 확인해 주세요.",
          ),
          sources: [], provider: "local-kb-empty",
        });
      }

      // Build context and call OpenAI/Claude for a natural answer
      const ctxText = localResults.map((a, i) =>
        `${i + 1}. ${a.name}（${a.city}，评分${a.rating}）\n地址：${a.address}\n开放时间：${a.hours}\n门票：${a.ticket}\n推荐游玩时间：${a.visit_time}\n简介：${a.intro}`
      ).join("\n\n");

      const sysPrompt = `你是专业四川旅游顾问。根据下方景点资料回答用户问题，保持简洁准确，用中文回答：\n\n${ctxText}`;
      let answer = null;

      const openaiKey = process.env.OPENAI_API_KEY;
      if (openaiKey) {
        try {
          const r = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: OPENAI_MODEL, temperature: 0.3, max_tokens: 600,
              messages: [{ role: "system", content: sysPrompt }, { role: "user", content: question }],
            }),
            signal: AbortSignal.timeout(12000),
          });
          const d = await r.json();
          answer = d.choices?.[0]?.message?.content || null;
        } catch (e) { console.warn("[attractions/ask/openai]", e.message); }
      }

      if (!answer) {
        // Fallback: format top results directly
        answer = `根据景点数据库，为您找到以下相关景点：\n\n${localResults.slice(0, 3).map((a) =>
          `📍 **${a.name}**（${a.city}，⭐${a.rating}）\n🕐 ${a.hours || "请查询官方"}\n🎟 ${a.ticket || "请查询门票"}`
        ).join("\n\n")}`;
      }

      return writeJson(res, 200, {
        ok: true, answer,
        sources: localResults.slice(0, 3).map((a) => ({ name: a.name, city: a.city, rating: a.rating })),
        provider: "local-kb+llm",
      });
    }

    // ── POST /api/plan/detail — On-demand itinerary detail ──────────────────
    if (req.method === "POST" && pathname === "/api/plan/detail") {
      return planRouter.handleDetail(req, res);
    }

    // ── POST /api/coze/bot/refresh — Push updated system prompt to Coze bot ──
    // Useful after enabling Trip.com or other plugins in Coze console.
    if (req.method === "POST" && pathname === "/api/coze/bot/refresh") {
      if (!COZE_API_KEY || !COZE_BOT_ID) {
        return writeJson(res, 503, { error: "Coze not configured (missing COZE_API_KEY or COZE_BOT_ID)" });
      }
      const newPrompt = `你是 CrossX 行程规划引擎。根据用户需求，输出3个差异化方案供对比选择，并附上"最佳平衡"方案的完整逐日行程。

# 核心原则
- 衣食住行全覆盖：每个方案必须包含住宿、交通策略、餐饮、活动
- 三个方案必须有真实差异（酒店档次、交通方式、活动类型不同）
- 所有酒店/餐厅/景点必须是真实存在的
- 逐日行程符合用户目的、兴趣偏好

# 两种输出模式

## 模式 A：信息严重不足
{"response_type":"clarify","spoken_text":"您要去哪个城市？大概预算多少？","missing_slots":["destination","budget"]}

## 模式 B：正常规划 → 三方案对比

{
  "response_type": "options_card",
  "spoken_text": "简短介绍（1-2句话）",
  "card_data": {
    "title": "X天X夜 [城市]定制方案",
    "destination": "城市名（只写城市，不带玩/旅等字）",
    "duration_days": 3,
    "pax": 2,
    "arrival_note": "机场/车站→目的地：具体路线+时间+费用",
    "plans": [
      {
        "id": "budget",
        "tag": "性价比之选",
        "hotel": {"name": "真实酒店名（经济档）","type": "经济","price_per_night": 350,"total": 1050,"image_keyword": "budget hotel"},
        "transport_plan": "全程地铁+共享单车，交通总费用约¥120",
        "total_price": 2800,
        "highlights": ["亮点1(≤12字)","亮点2(≤12字)","亮点3(≤12字)"],
        "budget_breakdown": {"accommodation":1050,"transport":120,"meals":900,"activities":600,"misc":130}
      },
      {
        "id": "balanced",
        "tag": "最佳平衡",
        "is_recommended": true,
        "hotel": {"name": "真实酒店名（商务档）","type": "商务","price_per_night": 700,"total": 2100,"image_keyword": "business hotel"},
        "transport_plan": "地铁+打车结合",
        "total_price": 4500,
        "highlights": ["亮点1","亮点2","亮点3"],
        "budget_breakdown": {"accommodation":2100,"transport":350,"meals":1200,"activities":700,"misc":150}
      },
      {
        "id": "premium",
        "tag": "极致体验",
        "hotel": {"name": "真实酒店名（豪华五星）","type": "豪华","price_per_night": 1500,"total": 4500,"image_keyword": "luxury hotel"},
        "transport_plan": "专属包车全程",
        "total_price": 8000,
        "highlights": ["亮点1","亮点2","亮点3"],
        "budget_breakdown": {"accommodation":4500,"transport":800,"meals":1800,"activities":700,"misc":200}
      }
    ],
    "days": [
      {
        "day": 1,
        "label": "Day 1 · 主题",
        "activities": [
          {"time": "上午","type": "transport","name": "具体路线","note": "交通细节","cost": 50,"image_keyword": "transport"},
          {"time": "下午","type": "activity","name": "景点名","note": "说明+费用","cost": 100,"image_keyword": "attraction","real_vibes": "氛围描述","insider_tips": "实用小技巧"}
        ]
      }
    ],
    "action_button": {"text": "确认行程 · 开始预订","payload": {"action":"initiate_payment"}}
  }
}

# 硬性规则
1. 只输出合法JSON，绝不输出任何非JSON文本
2. 只要用户提到目的地城市，立即生成方案，不得询问出发城市/日期/人数等额外信息
3. plans数组必须有3个，id分别为budget/balanced/premium
4. days数组长度等于duration_days，每天3-4个activities
5. budget_breakdown各项之和 = total_price，三方案total_price差异明显
6. 如有Trip.com/携程插件数据，优先使用真实价格
7. Always respond in the same language the user uses (ZH/EN/JA/KO)`;

      try {
        // Update bot prompt
        const updateRes = await fetch(`${COZE_API_BASE}/v1/bot/update`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${COZE_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            bot_id: COZE_BOT_ID,
            description: "CrossX AI Travel Planner — structured JSON output, China-focused",
            prompt_info: { prompt: newPrompt },
          }),
          signal: AbortSignal.timeout(10000),
        });
        const updateData = await updateRes.json();
        if (updateData.code !== 0) {
          return writeJson(res, 502, { error: "Coze update failed", detail: updateData });
        }
        // Republish
        const pubRes = await fetch(`${COZE_API_BASE}/v1/bot/publish`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${COZE_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ bot_id: COZE_BOT_ID, connector_ids: ["1024"] }),
          signal: AbortSignal.timeout(10000),
        });
        const pubData = await pubRes.json();
        return writeJson(res, 200, {
          ok: true,
          updated: updateData.code === 0,
          published: pubData.code === 0,
          version: pubData.bot_version,
          msg: "Bot prompt updated and republished successfully",
        });
      } catch (e) {
        return writeJson(res, 500, { error: e.message });
      }
    }

    return writeJson(res, 404, { error: "API not found" });
  } catch (err) {
    return writeJson(res, 500, { error: err.message || "Internal error" });
  }
});

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Try: PORT=3001 node server.js`);
    process.exit(1);
  }
  if (err && (err.code === "EACCES" || err.code === "EPERM")) {
    console.error(`Permission denied when binding ${HOST}:${PORT}. Try: HOST=127.0.0.1 PORT=3001 node server.js`);
    process.exit(1);
  }
  console.error("Server failed to start:", err);
  process.exit(1);
});

process.on("SIGINT", () => {
  if (hotelOrderPollTicker) clearInterval(hotelOrderPollTicker);
  saveDb();
  process.exit(0);
});

process.on("SIGTERM", () => {
  if (hotelOrderPollTicker) clearInterval(hotelOrderPollTicker);
  saveDb();
  process.exit(0);
});

let hotelOrderPollTicker = null;
function startHotelOrderPoller() {
  if (hotelOrderPollTicker) clearInterval(hotelOrderPollTicker);
  hotelOrderPollTicker = setInterval(() => {
    try {
      runHotelOrderPollingCycle();
    } catch (err) {
      console.error("hotel poll cycle failed:", err.message || err);
    }
  }, 30000);
}

loadDb();
startHotelOrderPoller();
server.listen(PORT, HOST, () => {
  console.log(`Cross X server running at http://${HOST}:${PORT}`);
  console.log(`Persistent DB: ${DB_FILE}`);
});
