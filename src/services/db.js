"use strict";
/**
 * src/services/db.js — SQLite-backed data layer for CrossX.
 * Replaces the old in-memory JSON object with better-sqlite3.
 * Exports `db` (legacyDb Proxy) for zero-change server.js compat,
 * plus named getter/setter functions for direct callers.
 */

const Database = require("better-sqlite3");
const path     = require("path");
const fs       = require("fs");

const DATA_DIR = path.join(__dirname, "../../data");
const DB_PATH  = path.join(DATA_DIR, "crossx.db");
const CFG_PATH = path.join(DATA_DIR, "config.json");
const DB_FILE  = path.join(DATA_DIR, "db.json"); // kept for compat export

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── SQLite init ────────────────────────────────────────────────────────────
const sqliteDb = new Database(DB_PATH);
sqliteDb.pragma("journal_mode = WAL");
sqliteDb.pragma("foreign_keys = ON");

sqliteDb.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, language TEXT NOT NULL DEFAULT 'EN',
  city TEXT NOT NULL DEFAULT 'Shanghai', city_zh TEXT NOT NULL DEFAULT '',
  province TEXT NOT NULL DEFAULT '', province_zh TEXT NOT NULL DEFAULT '',
  district TEXT NOT NULL DEFAULT '', district_zh TEXT NOT NULL DEFAULT '',
  view_mode TEXT NOT NULL DEFAULT 'user',
  pref_budget TEXT NOT NULL DEFAULT 'mid', pref_dietary TEXT NOT NULL DEFAULT '',
  pref_family INTEGER NOT NULL DEFAULT 0, pref_accessibility TEXT NOT NULL DEFAULT 'optional',
  pref_transport TEXT NOT NULL DEFAULT 'mixed', pref_walking TEXT NOT NULL DEFAULT 'walk',
  pref_allergy TEXT NOT NULL DEFAULT '',
  place_hotel TEXT NOT NULL DEFAULT '', place_office TEXT NOT NULL DEFAULT '',
  place_airport TEXT NOT NULL DEFAULT 'PVG',
  loc_lat REAL, loc_lng REAL, loc_accuracy REAL, loc_updated_at TEXT,
  loc_source TEXT NOT NULL DEFAULT 'none', loc_geocode_source TEXT NOT NULL DEFAULT '',
  location_enabled INTEGER NOT NULL DEFAULT 1,
  no_pin_enabled INTEGER NOT NULL DEFAULT 1, daily_limit REAL NOT NULL DEFAULT 2000,
  single_limit REAL NOT NULL DEFAULT 500, payment_rail TEXT NOT NULL DEFAULT 'alipay_cn',
  plus_active INTEGER NOT NULL DEFAULT 0, plus_plan TEXT NOT NULL DEFAULT 'none',
  plus_benefits TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL DEFAULT 'demo',
  intent TEXT NOT NULL DEFAULT '', constraints_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'planned',
  plan_json TEXT NOT NULL DEFAULT '{}', plan_intent_type TEXT NOT NULL DEFAULT '',
  plan_lane_id TEXT NOT NULL DEFAULT '', plan_estimated_cost REAL,
  plan_confirm_amount REAL, plan_confirm_currency TEXT NOT NULL DEFAULT 'CNY',
  session_intent TEXT NOT NULL DEFAULT '', session_stage TEXT NOT NULL DEFAULT '',
  session_slots_json TEXT NOT NULL DEFAULT '{}',
  session_missing_slots TEXT NOT NULL DEFAULT '[]',
  session_lane_id TEXT NOT NULL DEFAULT '', session_updated_at TEXT,
  expert_route_json TEXT NOT NULL DEFAULT '{}', flag_snapshot_json TEXT NOT NULL DEFAULT '{}',
  pause_state TEXT NOT NULL DEFAULT 'active',
  payment_rail_snapshot TEXT NOT NULL DEFAULT 'alipay_cn',
  handoff_json TEXT, deliverable_json TEXT,
  confirmed INTEGER NOT NULL DEFAULT 0, confirmed_at TEXT, confirm_payload_json TEXT,
  order_id TEXT, trip_id TEXT,
  steps_json TEXT NOT NULL DEFAULT '[]', timeline_json TEXT NOT NULL DEFAULT '[]',
  payments_json TEXT NOT NULL DEFAULT '[]', task_mcp_calls_json TEXT NOT NULL DEFAULT '[]',
  lifecycle_json TEXT NOT NULL DEFAULT '[]', fallback_events_json TEXT NOT NULL DEFAULT '[]',
  pricing_json TEXT NOT NULL DEFAULT 'null',
  created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_tasks_user_id    ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status     ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_order_id   ON tasks(order_id);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY, task_id TEXT,
  provider TEXT NOT NULL DEFAULT '', type TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '', price REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'CNY', cancel_policy TEXT NOT NULL DEFAULT '',
  merchant TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending',
  refundable INTEGER NOT NULL DEFAULT 1,
  proof_json TEXT, pricing_json TEXT, refund_policy_json TEXT,
  proof_items_json TEXT NOT NULL DEFAULT '[]', lifecycle_json TEXT NOT NULL DEFAULT '[]',
  itinerary_id TEXT, option_id TEXT, out_order_no TEXT, source TEXT,
  total_cost REAL, plan_snapshot_json TEXT,
  confirmed_at TEXT, expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_orders_task_id    ON orders(task_id);
CREATE INDEX IF NOT EXISTS idx_orders_status     ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_out_no     ON orders(out_order_no);

CREATE TABLE IF NOT EXISTS settlements (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL DEFAULT '', task_id TEXT,
  currency TEXT NOT NULL DEFAULT 'CNY',
  gross REAL NOT NULL DEFAULT 0, net REAL NOT NULL DEFAULT 0,
  markup REAL NOT NULL DEFAULT 0, refund REAL NOT NULL DEFAULT 0,
  settled_gross REAL NOT NULL DEFAULT 0, settled_net REAL NOT NULL DEFAULT 0,
  settled_markup REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_settlements_order_id ON settlements(order_id);

CREATE TABLE IF NOT EXISTS provider_ledger (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL DEFAULT '', task_id TEXT,
  provider TEXT NOT NULL DEFAULT '', currency TEXT NOT NULL DEFAULT 'CNY',
  captured_gross REAL NOT NULL DEFAULT 0, gateway_fee REAL NOT NULL DEFAULT 0,
  captured_net REAL NOT NULL DEFAULT 0, source_ts TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'ok',
  summary_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY, at TEXT NOT NULL DEFAULT '',
  hash TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT '',
  who TEXT NOT NULL DEFAULT '', what TEXT NOT NULL DEFAULT '',
  task_id TEXT, tool_input_json TEXT, tool_output_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_at      ON audit_logs(at);
CREATE INDEX IF NOT EXISTS idx_audit_kind    ON audit_logs(kind);
CREATE INDEX IF NOT EXISTS idx_audit_task_id ON audit_logs(task_id);

CREATE TABLE IF NOT EXISTS mcp_calls (
  id TEXT PRIMARY KEY, task_id TEXT, at TEXT NOT NULL DEFAULT '',
  op TEXT NOT NULL DEFAULT '', tool_type TEXT NOT NULL DEFAULT '',
  request_json TEXT, response_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_mcp_calls_at ON mcp_calls(at);

CREATE TABLE IF NOT EXISTS metric_events (
  id TEXT PRIMARY KEY, at TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT '', user_id TEXT, task_id TEXT, meta_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_metric_events_kind ON metric_events(kind);
CREATE INDEX IF NOT EXISTS idx_metric_events_at   ON metric_events(at);

CREATE TABLE IF NOT EXISTS support_tickets (
  id TEXT PRIMARY KEY, task_id TEXT, session_id TEXT,
  source TEXT NOT NULL DEFAULT 'task_handoff', reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open', channel TEXT NOT NULL DEFAULT '',
  eta TEXT NOT NULL DEFAULT '', handler TEXT, eta_min INTEGER NOT NULL DEFAULT 0,
  history_json TEXT NOT NULL DEFAULT '[]', accepted_at TEXT, resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_support_tickets_task_id ON support_tickets(task_id);

CREATE TABLE IF NOT EXISTS support_sessions (
  id TEXT PRIMARY KEY, ticket_id TEXT, task_id TEXT,
  linked_tickets_json TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'open',
  channel TEXT NOT NULL DEFAULT '', started_by TEXT NOT NULL DEFAULT 'system',
  reason TEXT NOT NULL DEFAULT '', assigned_agent_id TEXT, assigned_agent_name TEXT,
  unread_json TEXT NOT NULL DEFAULT '{"user":0,"ops":0}',
  presence_json TEXT NOT NULL DEFAULT '{}', messages_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_support_sessions_task_id ON support_sessions(task_id);

CREATE TABLE IF NOT EXISTS trip_plans (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL DEFAULT 'demo',
  title TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active',
  start_at TEXT NOT NULL DEFAULT '', end_at TEXT NOT NULL DEFAULT '',
  task_ids_json TEXT NOT NULL DEFAULT '[]', lifecycle_json TEXT NOT NULL DEFAULT '[]',
  progress_json TEXT NOT NULL DEFAULT '{}', derived_status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY, device_id TEXT NOT NULL DEFAULT 'demo',
  city TEXT NOT NULL DEFAULT '', area TEXT NOT NULL DEFAULT '',
  intent TEXT NOT NULL DEFAULT '', place TEXT NOT NULL DEFAULT '',
  amount REAL NOT NULL DEFAULT 0, rail_id TEXT NOT NULL DEFAULT 'alipay_cn',
  slots_json TEXT NOT NULL DEFAULT '{}', executed_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_trips_device_id ON trips(device_id);

CREATE TABLE IF NOT EXISTS idempotency (
  scope TEXT PRIMARY KEY, at INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS chat_notifications (
  id TEXT PRIMARY KEY, at TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT '', task_id TEXT, payload_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_chat_notifications_at ON chat_notifications(at);

CREATE TABLE IF NOT EXISTS crossx_orders (
  ref TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'pending',
  method TEXT NOT NULL DEFAULT 'card', destination TEXT NOT NULL DEFAULT '',
  total REAL NOT NULL DEFAULT 0, plan_id TEXT NOT NULL DEFAULT '',
  plan_tag TEXT NOT NULL DEFAULT '', ip TEXT NOT NULL DEFAULT '',
  confirmed_at TEXT, created_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'text/html',
  body TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_receipts_order_id ON receipts(order_id);

CREATE TABLE IF NOT EXISTS consent_log (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  purposes TEXT NOT NULL DEFAULT '[]',
  lawful_basis TEXT NOT NULL DEFAULT 'consent',
  ip_hash TEXT,
  user_agent_hash TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_consent_log_device ON consent_log(device_id);
CREATE INDEX IF NOT EXISTS idx_consent_log_at     ON consent_log(created_at);

CREATE TABLE IF NOT EXISTS gdpr_requests (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  request_json TEXT,
  response_json TEXT,
  deadline_at TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_gdpr_requests_device ON gdpr_requests(device_id);
CREATE INDEX IF NOT EXISTS idx_gdpr_requests_status ON gdpr_requests(status);

CREATE TABLE IF NOT EXISTS training_feedback (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  signal_type TEXT NOT NULL DEFAULT 'explicit',
  destination TEXT,
  duration_days INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_train_feedback_plan   ON training_feedback(plan_id);
CREATE INDEX IF NOT EXISTS idx_train_feedback_device ON training_feedback(device_id);

CREATE TABLE IF NOT EXISTS training_examples (
  id TEXT PRIMARY KEY,
  user_message TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  assistant_response TEXT NOT NULL,
  quality_score REAL NOT NULL DEFAULT 0.5,
  source TEXT NOT NULL DEFAULT 'openai',
  destination TEXT,
  duration_days INTEGER,
  used_in_run TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_train_examples_score ON training_examples(quality_score);
CREATE INDEX IF NOT EXISTS idx_train_examples_dest  ON training_examples(destination);

CREATE TABLE IF NOT EXISTS prompt_experiments (
  prompt_id TEXT NOT NULL,
  variant TEXT NOT NULL,
  win_count INTEGER NOT NULL DEFAULT 0,
  loss_count INTEGER NOT NULL DEFAULT 0,
  total_count INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (prompt_id, variant)
);

CREATE TABLE IF NOT EXISTS capability_benchmarks (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  query TEXT NOT NULL,
  expected_intent TEXT,
  actual_intent TEXT,
  expected_destination TEXT,
  actual_destination TEXT,
  score REAL,
  latency_ms INTEGER,
  model TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cap_bench_run_id ON capability_benchmarks(run_id);
`);

// ── GDPR + Security: extend users table (idempotent ALTER TABLE) ─────────────
for (const col of [
  "ALTER TABLE users ADD COLUMN consent_version TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE users ADD COLUMN consent_date TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE users ADD COLUMN data_processing_restricted INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE users ADD COLUMN deletion_requested_at TEXT",
  "ALTER TABLE users ADD COLUMN deletion_scheduled_at TEXT",
  // RBAC role
  "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'",
  // Encrypted PII shadow columns (original plaintext columns kept for migration)
  "ALTER TABLE users ADD COLUMN pii_enc_dietary TEXT",
  "ALTER TABLE users ADD COLUMN pii_enc_allergy TEXT",
  "ALTER TABLE users ADD COLUMN pii_enc_place_hotel TEXT",
  "ALTER TABLE users ADD COLUMN pii_enc_place_office TEXT",
  "ALTER TABLE users ADD COLUMN pii_enc_loc TEXT",   // JSON {lat,lng,accuracy} encrypted
]) {
  try { sqliteDb.exec(col); } catch (_) { /* column already exists — ignore */ }
}

// ── Training tables: idempotent extensions ────────────────────────────────
for (const col of [
  "ALTER TABLE training_examples ADD COLUMN session_id TEXT",
  "ALTER TABLE training_feedback ADD COLUMN example_id TEXT",
]) {
  try { sqliteDb.exec(col); } catch (_) { /* column already exists */ }
}
try {
  sqliteDb.exec("CREATE INDEX IF NOT EXISTS idx_train_examples_session ON training_examples(session_id)");
} catch (_) {}

// ── Helpers ────────────────────────────────────────────────────────────────
function nowIso() { return new Date().toISOString(); }
function j(v)  { return v != null ? JSON.stringify(v) : null; }
function p(v)  { try { return v ? JSON.parse(v) : null; } catch { return null; } }
function pa(v) { const r = p(v); return Array.isArray(r) ? r : []; }
function po(v) { const r = p(v); return (r && typeof r === "object" && !Array.isArray(r)) ? r : {}; }

// ── Field Encryption (lazy-required to avoid circular deps) ─────────────────
let _fe = null;
function _fieldEncrypt() {
  if (!_fe) _fe = require("../crypto/fieldEncrypt");
  return _fe;
}
function _enc(v)  { return v ? _fieldEncrypt().enc(String(v)) : v; }
function _dec(v)  { return v ? _fieldEncrypt().dec(v) : v; }
function _encJ(v) { return _fieldEncrypt().encJson(v); }
function _decJ(v) { return _fieldEncrypt().decJson(v); }

// ── RBAC helpers ────────────────────────────────────────────────────────────
function getUserRole(deviceId) {
  const row = sqliteDb.prepare("SELECT role FROM users WHERE id = ?").get(deviceId);
  return row ? (row.role || "user") : "user";
}
function setUserRole(deviceId, role) {
  const allowed = ["user", "operator", "admin", "finance"];
  if (!allowed.includes(role)) throw new Error(`Invalid role: ${role}`);
  sqliteDb.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, deviceId);
}

/**
 * One-time migration: encrypt plaintext PII columns into *_enc shadow columns.
 * Safe to call repeatedly — skips rows that already have pii_enc_loc set.
 * Called on server startup when CROSSX_DB_ENCRYPTION_KEY is set.
 * @returns {{ migrated: number, skipped: number }}
 */
function migratePiiEncryption() {
  if (!process.env.CROSSX_DB_ENCRYPTION_KEY) return { migrated: 0, skipped: 0 };
  // Only rows missing encrypted columns need migration
  const rows = sqliteDb.prepare(
    "SELECT id, pref_dietary, pref_allergy, place_hotel, place_office, loc_lat, loc_lng, loc_accuracy FROM users WHERE pii_enc_loc IS NULL"
  ).all();
  let migrated = 0;
  const stmt = sqliteDb.prepare(
    "UPDATE users SET pii_enc_dietary=?, pii_enc_allergy=?, pii_enc_place_hotel=?, pii_enc_place_office=?, pii_enc_loc=? WHERE id=?"
  );
  for (const row of rows) {
    try {
      const locObj = (row.loc_lat != null) ? { lat: row.loc_lat, lng: row.loc_lng, accuracy: row.loc_accuracy } : null;
      stmt.run(
        _enc(row.pref_dietary || ""),
        _enc(row.pref_allergy || ""),
        _enc(row.place_hotel  || ""),
        _enc(row.place_office || ""),
        locObj ? _encJ(locObj) : null,
        row.id
      );
      migrated++;
    } catch (e) {
      console.warn("[db] migratePiiEncryption: failed for", row.id, e.message);
    }
  }
  if (migrated > 0) console.log(`[db] migratePiiEncryption: encrypted ${migrated} user rows`);
  return { migrated, skipped: rows.length - migrated };
}

// ── Config sidecar ─────────────────────────────────────────────────────────
const CONFIG_DEFAULTS = {
  featureFlags: {
    plusConcierge:   { enabled: false, rollout: 0 },
    manualFallback:  { enabled: true,  rollout: 100 },
    liveTranslation: { enabled: false, rollout: 10 },
  },
  mcpContracts: {
    gaode_or_fallback:    { id: "gaode_or_fallback",     provider: "Gaode LBS",                 external: true, slaMs: 2200, enforced: true },
    partner_hub_queue:    { id: "partner_hub_queue",     provider: "Partner Hub Queue API",      external: true, slaMs: 1800, enforced: true },
    partner_hub_booking:  { id: "partner_hub_booking",   provider: "Partner Hub Booking API",   external: true, slaMs: 2500, enforced: true },
    partner_hub_traffic:  { id: "partner_hub_traffic",   provider: "Partner Hub Traffic API",   external: true, slaMs: 1800, enforced: true },
    partner_hub_transport:{ id: "partner_hub_transport", provider: "Partner Hub Transport API", external: true, slaMs: 2500, enforced: true },
    payment_rail:         { id: "payment_rail",           provider: "ACT Rail Gateway",          external: true, slaMs: 3200, enforced: true },
  },
  mcpPolicy:  { enforceSla: false, simulateBreachRate: 0 },
  paymentCompliance: {
    policy:  { blockUncertifiedRails: true, requireFraudScreen: true },
    rails:   {
      alipay_cn:    { certified: true, kycPassed: true, pciDss: true, riskTier: "low",    enabled: true },
      wechat_cn:    { certified: true, kycPassed: true, pciDss: true, riskTier: "medium", enabled: true },
      card_delegate:{ certified: true, kycPassed: true, pciDss: true, riskTier: "high",   enabled: true },
    },
  },
  miniProgram: {
    version: "0.1.0",
    channels: { alipay: { status: "ready", pathPrefix: "pages/" }, wechat: { status: "ready", pathPrefix: "pages/" } },
    releases: [],
  },
};

let _config = null;
let _cfgFlush = null;

function getConfig() {
  if (_config) return _config;
  try {
    _config = fs.existsSync(CFG_PATH)
      ? { ...CONFIG_DEFAULTS, ...JSON.parse(fs.readFileSync(CFG_PATH, "utf8")) }
      : JSON.parse(JSON.stringify(CONFIG_DEFAULTS));
  } catch { _config = JSON.parse(JSON.stringify(CONFIG_DEFAULTS)); }
  return _config;
}

function updateConfig(patch) {
  const cfg = getConfig();
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === "object" && !Array.isArray(v) && cfg[k] && typeof cfg[k] === "object")
      cfg[k] = { ...cfg[k], ...v };
    else cfg[k] = v;
  }
  if (!_cfgFlush) _cfgFlush = setTimeout(() => {
    try { fs.writeFileSync(CFG_PATH, JSON.stringify(_config, null, 2), "utf8"); } catch {}
    _cfgFlush = null;
  }, 500);
}

// ── Users ──────────────────────────────────────────────────────────────────
function _rowToUser(row) {
  if (!row) return null;
  // Prefer encrypted columns when present, fall back to plaintext (backwards compat)
  const dietary      = row.pii_enc_dietary    ? _dec(row.pii_enc_dietary)    : (row.pref_dietary    || "");
  const allergy      = row.pii_enc_allergy    ? _dec(row.pii_enc_allergy)    : (row.pref_allergy    || "");
  const placeHotel   = row.pii_enc_place_hotel  ? _dec(row.pii_enc_place_hotel)  : (row.place_hotel  || "");
  const placeOffice  = row.pii_enc_place_office ? _dec(row.pii_enc_place_office) : (row.place_office || "");
  const encLoc       = row.pii_enc_loc ? _decJ(row.pii_enc_loc) : null;
  return {
    id: row.id, language: row.language, city: row.city, cityZh: row.city_zh,
    province: row.province, provinceZh: row.province_zh,
    district: row.district, districtZh: row.district_zh, viewMode: row.view_mode,
    role: row.role || "user",
    preferences: { budget: row.pref_budget, dietary, family: Boolean(row.pref_family),
      accessibility: row.pref_accessibility, transport: row.pref_transport,
      walking: row.pref_walking, allergy },
    savedPlaces: { hotel: placeHotel, office: placeOffice, airport: row.place_airport },
    location: {
      lat:     encLoc ? encLoc.lat     : row.loc_lat,
      lng:     encLoc ? encLoc.lng     : row.loc_lng,
      accuracy:encLoc ? encLoc.accuracy: row.loc_accuracy,
      updatedAt: row.loc_updated_at, source: row.loc_source, geocodeSource: row.loc_geocode_source,
    },
    privacy: { locationEnabled: Boolean(row.location_enabled) },
    authDomain: { noPinEnabled: Boolean(row.no_pin_enabled), dailyLimit: row.daily_limit, singleLimit: row.single_limit },
    paymentRail: { selected: row.payment_rail },
    plusSubscription: { active: Boolean(row.plus_active), plan: row.plus_plan, benefits: pa(row.plus_benefits) },
  };
}

function _userToRow(u) {
  const pr = u.preferences || {}, sp = u.savedPlaces || {}, loc = u.location || {};
  const auth = u.authDomain || {}, rail = u.paymentRail || {}, plus = u.plusSubscription || {};
  const dietary     = pr.dietary  || "";
  const allergy     = pr.allergy  || "";
  const placeHotel  = sp.hotel    || "";
  const placeOffice = sp.office   || "";
  const locObj      = { lat: loc.lat ?? null, lng: loc.lng ?? null, accuracy: loc.accuracy ?? null };
  return {
    id: u.id, language: u.language || "EN", city: u.city || "Shanghai",
    city_zh: u.cityZh || "", province: u.province || "", province_zh: u.provinceZh || "",
    district: u.district || "", district_zh: u.districtZh || "", view_mode: u.viewMode || "user",
    pref_budget: pr.budget || "mid",
    pref_dietary: dietary,   // keep plaintext for migration fallback
    pref_family: pr.family ? 1 : 0, pref_accessibility: pr.accessibility || "optional",
    pref_transport: pr.transport || "mixed", pref_walking: pr.walking || "walk",
    pref_allergy: allergy,   // keep plaintext for migration fallback
    place_hotel: placeHotel, place_office: placeOffice, place_airport: sp.airport || "PVG",
    loc_lat: loc.lat ?? null, loc_lng: loc.lng ?? null, loc_accuracy: loc.accuracy ?? null,
    loc_updated_at: loc.updatedAt || null, loc_source: loc.source || "none",
    loc_geocode_source: loc.geocodeSource || "",
    location_enabled: (u.privacy?.locationEnabled !== false) ? 1 : 0,
    no_pin_enabled: auth.noPinEnabled !== false ? 1 : 0,
    daily_limit: auth.dailyLimit ?? 2000, single_limit: auth.singleLimit ?? 500,
    payment_rail: rail.selected || "alipay_cn",
    plus_active: plus.active ? 1 : 0, plus_plan: plus.plan || "none",
    plus_benefits: j(plus.benefits || []),
    // Encrypted PII shadow columns
    pii_enc_dietary:     _enc(dietary),
    pii_enc_allergy:     _enc(allergy),
    pii_enc_place_hotel: _enc(placeHotel),
    pii_enc_place_office:_enc(placeOffice),
    pii_enc_loc:         (locObj.lat != null) ? _encJ(locObj) : null,
  };
}

const _stmtGetUser    = sqliteDb.prepare("SELECT * FROM users WHERE id = ?");
const _stmtUpsertUser = sqliteDb.prepare(`
  INSERT OR REPLACE INTO users (id,language,city,city_zh,province,province_zh,district,district_zh,view_mode,
    pref_budget,pref_dietary,pref_family,pref_accessibility,pref_transport,pref_walking,pref_allergy,
    place_hotel,place_office,place_airport,loc_lat,loc_lng,loc_accuracy,loc_updated_at,loc_source,
    loc_geocode_source,location_enabled,no_pin_enabled,daily_limit,single_limit,payment_rail,
    plus_active,plus_plan,plus_benefits,
    pii_enc_dietary,pii_enc_allergy,pii_enc_place_hotel,pii_enc_place_office,pii_enc_loc)
  VALUES (@id,@language,@city,@city_zh,@province,@province_zh,@district,@district_zh,@view_mode,
    @pref_budget,@pref_dietary,@pref_family,@pref_accessibility,@pref_transport,@pref_walking,@pref_allergy,
    @place_hotel,@place_office,@place_airport,@loc_lat,@loc_lng,@loc_accuracy,@loc_updated_at,@loc_source,
    @loc_geocode_source,@location_enabled,@no_pin_enabled,@daily_limit,@single_limit,@payment_rail,
    @plus_active,@plus_plan,@plus_benefits,
    @pii_enc_dietary,@pii_enc_allergy,@pii_enc_place_hotel,@pii_enc_place_office,@pii_enc_loc)
`);

// Seed demo user if absent
if (!_stmtGetUser.get("demo")) {
  _stmtUpsertUser.run(_userToRow({ id: "demo" }));
}

function getUser(userId = "demo") { return _rowToUser(_stmtGetUser.get(userId)); }
function getDemoUser() { return getUser("demo"); }
function updateUser(userId, fields) {
  const base = getUser(userId) || { id: userId };
  function dm(b, patch) {
    const out = { ...b };
    for (const [k, v] of Object.entries(patch)) {
      if (v && typeof v === "object" && !Array.isArray(v) && b[k] && typeof b[k] === "object")
        out[k] = dm(b[k], v);
      else out[k] = v;
    }
    return out;
  }
  const merged = dm(base, fields);
  merged.id = userId;
  _stmtUpsertUser.run(_userToRow(merged));
  return getUser(userId);
}

// ── Tasks ──────────────────────────────────────────────────────────────────
function _taskToRow(task) {
  const ss = task.sessionState || {}, plan = task.plan || {}, confirm = plan.confirm || {};
  const { steps, sessionState, mcpCalls, timeline, payments, lifecycle, fallbackEvents, pricing, ...planRest } = plan;
  return {
    id: task.id, user_id: task.userId || "demo",
    intent: task.intent || "", constraints_json: j(task.constraints || {}),
    status: task.status || "planned",
    plan_json: j(planRest || {}),
    plan_intent_type: plan.intentType || "", plan_lane_id: plan.laneId || "",
    plan_estimated_cost: plan.estimatedCost ?? null,
    plan_confirm_amount: confirm.amount ?? null, plan_confirm_currency: confirm.currency || "CNY",
    session_intent: ss.intent || "", session_stage: ss.stage || "",
    session_slots_json: j(ss.slots || {}), session_missing_slots: j(ss.missingSlots || []),
    session_lane_id: ss.laneId || "", session_updated_at: ss.updatedAt || null,
    expert_route_json: j(task.expertRoute || {}), flag_snapshot_json: j(task.flagSnapshot || {}),
    pause_state: task.pauseState || "active",
    payment_rail_snapshot: task.paymentRailSnapshot || "alipay_cn",
    handoff_json: task.handoff ? j(task.handoff) : null,
    deliverable_json: task.deliverable ? j(task.deliverable) : null,
    confirmed: task.confirmed ? 1 : 0, confirmed_at: task.confirmedAt || null,
    confirm_payload_json: task.confirmPayload ? j(task.confirmPayload) : null,
    order_id: task.orderId || null, trip_id: task.tripId || null,
    steps_json: j(task.steps || steps || []),
    timeline_json: j(task.timeline || timeline || []),
    payments_json: j(task.payments || payments || []),
    task_mcp_calls_json: j(task.mcpCalls || mcpCalls || []),
    lifecycle_json: j(task.lifecycle || []),
    fallback_events_json: j(task.fallbackEvents || []),
    pricing_json: j(task.pricing ?? pricing ?? null),
    created_at: task.createdAt || nowIso(), updated_at: task.updatedAt || nowIso(),
  };
}

function _rowToTask(row) {
  if (!row) return null;
  const planBase = po(row.plan_json);
  const plan = {
    ...planBase,
    intentType: row.plan_intent_type || planBase.intentType,
    laneId: row.plan_lane_id || planBase.laneId,
    estimatedCost: row.plan_estimated_cost ?? planBase.estimatedCost,
    confirm: { ...(planBase.confirm || {}), amount: row.plan_confirm_amount, currency: row.plan_confirm_currency },
    steps: pa(row.steps_json), timeline: pa(row.timeline_json),
    payments: pa(row.payments_json), mcpCalls: pa(row.task_mcp_calls_json),
  };
  return {
    id: row.id, userId: row.user_id, intent: row.intent,
    constraints: po(row.constraints_json), status: row.status, plan,
    sessionState: { intent: row.session_intent, stage: row.session_stage,
      slots: po(row.session_slots_json), missingSlots: pa(row.session_missing_slots),
      laneId: row.session_lane_id, updatedAt: row.session_updated_at },
    expertRoute: po(row.expert_route_json), flagSnapshot: po(row.flag_snapshot_json),
    pauseState: row.pause_state, paymentRailSnapshot: row.payment_rail_snapshot,
    handoff: p(row.handoff_json), deliverable: p(row.deliverable_json),
    confirmed: Boolean(row.confirmed), confirmedAt: row.confirmed_at,
    confirmPayload: p(row.confirm_payload_json),
    orderId: row.order_id, tripId: row.trip_id,
    steps: pa(row.steps_json), timeline: pa(row.timeline_json),
    payments: pa(row.payments_json), mcpCalls: pa(row.task_mcp_calls_json),
    lifecycle: pa(row.lifecycle_json), fallbackEvents: pa(row.fallback_events_json),
    pricing: p(row.pricing_json),
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

const _stmtGetTask    = sqliteDb.prepare("SELECT * FROM tasks WHERE id = ?");
const _stmtAllTasks   = sqliteDb.prepare("SELECT * FROM tasks ORDER BY created_at DESC");
const _stmtDelTasks   = sqliteDb.prepare("DELETE FROM tasks");
const _stmtUpsertTask = sqliteDb.prepare(`
  INSERT OR REPLACE INTO tasks (id,user_id,intent,constraints_json,status,plan_json,plan_intent_type,
    plan_lane_id,plan_estimated_cost,plan_confirm_amount,plan_confirm_currency,session_intent,session_stage,
    session_slots_json,session_missing_slots,session_lane_id,session_updated_at,expert_route_json,
    flag_snapshot_json,pause_state,payment_rail_snapshot,handoff_json,deliverable_json,confirmed,
    confirmed_at,confirm_payload_json,order_id,trip_id,steps_json,timeline_json,payments_json,
    task_mcp_calls_json,lifecycle_json,fallback_events_json,pricing_json,created_at,updated_at)
  VALUES (@id,@user_id,@intent,@constraints_json,@status,@plan_json,@plan_intent_type,@plan_lane_id,
    @plan_estimated_cost,@plan_confirm_amount,@plan_confirm_currency,@session_intent,@session_stage,
    @session_slots_json,@session_missing_slots,@session_lane_id,@session_updated_at,@expert_route_json,
    @flag_snapshot_json,@pause_state,@payment_rail_snapshot,@handoff_json,@deliverable_json,@confirmed,
    @confirmed_at,@confirm_payload_json,@order_id,@trip_id,@steps_json,@timeline_json,@payments_json,
    @task_mcp_calls_json,@lifecycle_json,@fallback_events_json,@pricing_json,@created_at,@updated_at)
`);

function getTask(id)    { return _rowToTask(_stmtGetTask.get(id)); }
function getAllTasks()   { return _stmtAllTasks.all().map(_rowToTask); }
function getAllTasksMap(){ return Object.fromEntries(getAllTasks().map(t => [t.id, t])); }
function deleteAllTasks(){ _stmtDelTasks.run(); }
function upsertTask(t)  { _stmtUpsertTask.run(_taskToRow(t)); }

// ── Orders ─────────────────────────────────────────────────────────────────
function _orderToRow(o) {
  return {
    id: o.id, task_id: o.taskId || o.task_id || null,
    provider: o.provider || "", type: o.type || "", city: o.city || "",
    price: o.price ?? 0, currency: o.currency || "CNY",
    cancel_policy: o.cancelPolicy || o.cancel_policy || "",
    merchant: o.merchant || "", status: o.paymentStatus || o.status || "pending",
    refundable: o.refundable !== false ? 1 : 0,
    proof_json: o.proof ? j(o.proof) : null,
    pricing_json: o.pricing ? j(o.pricing) : null,
    refund_policy_json: o.refundPolicy ? j(o.refundPolicy) : null,
    proof_items_json: j(o.proofItems || []),
    lifecycle_json: j(o.lifecycle || []),
    itinerary_id: o.itineraryId || o.itinerary_id || null,
    option_id: o.optionId || o.option_id || null,
    out_order_no: o.outOrderNo || o.out_order_no || null,
    source: o.source || null, total_cost: o.totalCost || o.total_cost || null,
    plan_snapshot_json: o.planSnapshot ? j(o.planSnapshot) : null,
    confirmed_at: o.confirmedAt || o.confirmed_at || o.paidAt || null,
    expires_at: o.expiresAt || o.expires_at || null,
    created_at: o.createdAt || o.created_at || nowIso(),
    updated_at: o.updatedAt || o.updated_at || nowIso(),
  };
}

function _rowToOrder(row) {
  if (!row) return null;
  return {
    id: row.id, taskId: row.task_id, provider: row.provider, type: row.type,
    city: row.city, price: row.price, currency: row.currency,
    cancelPolicy: row.cancel_policy, merchant: row.merchant, status: row.status,
    refundable: Boolean(row.refundable),
    proof: p(row.proof_json), pricing: p(row.pricing_json),
    refundPolicy: p(row.refund_policy_json),
    proofItems: pa(row.proof_items_json), lifecycle: pa(row.lifecycle_json),
    itineraryId: row.itinerary_id, optionId: row.option_id,
    outOrderNo: row.out_order_no, source: row.source,
    totalCost: row.total_cost, planSnapshot: p(row.plan_snapshot_json),
    confirmedAt: row.confirmed_at, expiresAt: row.expires_at,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

const _stmtGetOrder    = sqliteDb.prepare("SELECT * FROM orders WHERE id = ?");
const _stmtAllOrders   = sqliteDb.prepare("SELECT * FROM orders ORDER BY created_at DESC");
const _stmtUpsertOrder = sqliteDb.prepare(`
  INSERT OR REPLACE INTO orders (id,task_id,provider,type,city,price,currency,cancel_policy,merchant,
    status,refundable,proof_json,pricing_json,refund_policy_json,proof_items_json,lifecycle_json,
    itinerary_id,option_id,out_order_no,source,total_cost,plan_snapshot_json,confirmed_at,expires_at,
    created_at,updated_at)
  VALUES (@id,@task_id,@provider,@type,@city,@price,@currency,@cancel_policy,@merchant,@status,
    @refundable,@proof_json,@pricing_json,@refund_policy_json,@proof_items_json,@lifecycle_json,
    @itinerary_id,@option_id,@out_order_no,@source,@total_cost,@plan_snapshot_json,@confirmed_at,
    @expires_at,@created_at,@updated_at)
`);

function getOrder(id)              { return _rowToOrder(_stmtGetOrder.get(id)); }
function getAllOrders()             { return _stmtAllOrders.all().map(_rowToOrder); }
function getAllOrdersMap()          { return Object.fromEntries(getAllOrders().map(o => [o.id, o])); }
function upsertOrder(o)            { _stmtUpsertOrder.run(_orderToRow(o)); }
function findOrderByOutOrderNo(no) { return _rowToOrder(sqliteDb.prepare("SELECT * FROM orders WHERE out_order_no = ?").get(no)); }

// ── Settlements ────────────────────────────────────────────────────────────
function getSettlements() { return sqliteDb.prepare("SELECT * FROM settlements ORDER BY created_at ASC").all(); }
function appendSettlement(s) {
  sqliteDb.prepare(`INSERT OR REPLACE INTO settlements (id,order_id,task_id,currency,gross,net,markup,refund,settled_gross,settled_net,settled_markup,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    s.id || `stl_${Date.now().toString(36)}`,
    s.orderId||s.order_id||"", s.taskId||s.task_id||null,
    s.currency||"CNY", s.gross??0, s.net??0, s.markup??0, s.refund??0,
    s.settledGross??s.settled_gross??0, s.settledNet??s.settled_net??0, s.settledMarkup??s.settled_markup??0,
    s.status||"pending", s.createdAt||s.created_at||nowIso(), s.updatedAt||s.updated_at||nowIso()
  );
}
function hasSettlement(orderId) { return !!sqliteDb.prepare("SELECT id FROM settlements WHERE order_id = ?").get(orderId); }
function updateSettlement(orderId, fields) {
  const row = sqliteDb.prepare("SELECT * FROM settlements WHERE order_id = ?").get(orderId);
  if (row) appendSettlement({ ...row, order_id: row.order_id, ...fields });
}

// ── Provider Ledger ────────────────────────────────────────────────────────
function getProviderLedger() { return sqliteDb.prepare("SELECT * FROM provider_ledger ORDER BY created_at ASC").all(); }
function appendProviderLedgerEntry(e) {
  sqliteDb.prepare(`INSERT OR REPLACE INTO provider_ledger (id,order_id,task_id,provider,currency,captured_gross,gateway_fee,captured_net,source_ts,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    e.id||`pl_${Date.now().toString(36)}`, e.orderId||e.order_id||"", e.taskId||e.task_id||null,
    e.provider||"", e.currency||"CNY",
    e.capturedGross??e.captured_gross??0, e.gatewayFee??e.gateway_fee??0, e.capturedNet??e.captured_net??0,
    e.sourceTs||e.source_ts||nowIso(), e.createdAt||e.created_at||nowIso(), e.updatedAt||e.updated_at||nowIso()
  );
}
function hasProviderEntry(orderId) { return !!sqliteDb.prepare("SELECT id FROM provider_ledger WHERE order_id = ?").get(orderId); }

// ── Reconciliation Runs ────────────────────────────────────────────────────
function getReconciliationRuns() {
  return sqliteDb.prepare("SELECT * FROM reconciliation_runs ORDER BY created_at ASC").all()
    .map(r => ({ ...r, summary: po(r.summary_json) }));
}
function appendReconciliationRun(r) {
  sqliteDb.prepare(`INSERT OR REPLACE INTO reconciliation_runs (id,status,summary_json,created_at) VALUES (?,?,?,?)`).run(
    r.id||`rec_${Date.now().toString(36)}`, r.status||"ok", j(r.summary||r), r.createdAt||r.created_at||nowIso()
  );
}

// ── Audit Logs ─────────────────────────────────────────────────────────────
const _stmtAudit = sqliteDb.prepare(`INSERT OR IGNORE INTO audit_logs (id,at,hash,kind,who,what,task_id,tool_input_json,tool_output_json) VALUES (?,?,?,?,?,?,?,?,?)`);
function appendAuditLog(e) {
  _stmtAudit.run(
    e.id||`al_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,5)}`,
    e.at||nowIso(), e.hash||"", e.kind||"", e.who||"", e.what||"",
    e.taskId||e.task_id||null,
    e.toolInput ? j(e.toolInput) : null, e.toolOutput ? j(e.toolOutput) : null
  );
}
function getAuditLogs(limit = 50) {
  return sqliteDb.prepare("SELECT * FROM audit_logs ORDER BY at DESC LIMIT ?").all(limit)
    .map(r => ({ id: r.id, at: r.at, hash: r.hash, kind: r.kind, who: r.who, what: r.what,
      taskId: r.task_id, toolInput: p(r.tool_input_json), toolOutput: p(r.tool_output_json) }));
}
function getAuditLogArray(limit = 2000) { return getAuditLogs(limit); }

// ── MCP Calls ──────────────────────────────────────────────────────────────
const _stmtMcp = sqliteDb.prepare(`INSERT OR IGNORE INTO mcp_calls (id,task_id,at,op,tool_type,request_json,response_json) VALUES (?,?,?,?,?,?,?)`);
function appendMcpCall(c) {
  _stmtMcp.run(
    c.id||`mcp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,5)}`,
    c.taskId||c.task_id||null, c.at||nowIso(), c.op||"", c.toolType||c.tool_type||"",
    c.request ? j(c.request) : null, c.response ? j(c.response) : null
  );
}
function getMcpCalls(limit = 240) {
  return sqliteDb.prepare("SELECT * FROM mcp_calls ORDER BY at DESC LIMIT ?").all(limit)
    .map(r => ({ id: r.id, taskId: r.task_id, at: r.at, op: r.op, toolType: r.tool_type,
      request: p(r.request_json), response: p(r.response_json) }));
}

// ── Metric Events ──────────────────────────────────────────────────────────
const _stmtMetric = sqliteDb.prepare(`INSERT OR IGNORE INTO metric_events (id,at,kind,user_id,task_id,meta_json) VALUES (?,?,?,?,?,?)`);
function appendMetricEvent(e) {
  _stmtMetric.run(
    e.id||`me_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,5)}`,
    e.at||e.ts||nowIso(), e.kind||e.event||"",
    e.userId||e.user_id||null, e.taskId||e.task_id||null, j(e.meta||null)
  );
}
function getMetricEvents(limit = 2000) {
  return sqliteDb.prepare("SELECT * FROM metric_events ORDER BY at DESC LIMIT ?").all(limit)
    .map(r => ({ id: r.id, at: r.at, kind: r.kind, userId: r.user_id, taskId: r.task_id, meta: p(r.meta_json) }));
}
function getMetricEventCount(kind) {
  return sqliteDb.prepare("SELECT COUNT(*) as n FROM metric_events WHERE kind = ?").get(kind)?.n ?? 0;
}

// ── Idempotency ────────────────────────────────────────────────────────────
function getIdempotencyEntry(scope) {
  const r = sqliteDb.prepare("SELECT * FROM idempotency WHERE scope = ?").get(scope);
  return r ? { at: r.at, ...po(r.payload_json) } : null;
}
function setIdempotencyEntry(scope, payload) {
  sqliteDb.prepare("INSERT OR REPLACE INTO idempotency (scope,at,payload_json) VALUES (?,?,?)").run(scope, Date.now(), j(payload||{}));
}
function purgeExpiredIdempotency(beforeMs) {
  sqliteDb.prepare("DELETE FROM idempotency WHERE at < ?").run(beforeMs);
}
function getIdempotencyAsObject() {
  return Object.fromEntries(sqliteDb.prepare("SELECT * FROM idempotency").all().map(r => [r.scope, { at: r.at, ...po(r.payload_json) }]));
}

// ── Support Tickets ────────────────────────────────────────────────────────
function _rowToTicket(r) {
  if (!r) return null;
  return { id: r.id, taskId: r.task_id, sessionId: r.session_id, source: r.source,
    reason: r.reason, status: r.status, channel: r.channel, eta: r.eta, handler: r.handler,
    etaMin: r.eta_min, history: pa(r.history_json), acceptedAt: r.accepted_at,
    resolvedAt: r.resolved_at, createdAt: r.created_at, updatedAt: r.updated_at };
}
function getSupportTickets() {
  return sqliteDb.prepare("SELECT * FROM support_tickets ORDER BY created_at DESC").all().map(_rowToTicket);
}
function appendSupportTicket(t) {
  sqliteDb.prepare(`INSERT OR REPLACE INTO support_tickets (id,task_id,session_id,source,reason,status,channel,eta,handler,eta_min,history_json,accepted_at,resolved_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    t.id, t.taskId||t.task_id||null, t.sessionId||t.session_id||null,
    t.source||"task_handoff", t.reason||"", t.status||"open", t.channel||"", t.eta||"",
    t.handler||null, t.etaMin||t.eta_min||0, j(t.history||[]),
    t.acceptedAt||t.accepted_at||null, t.resolvedAt||t.resolved_at||null,
    t.createdAt||t.created_at||nowIso(), t.updatedAt||t.updated_at||nowIso()
  );
}
function updateSupportTicket(ticketId, fields) {
  const ex = _rowToTicket(sqliteDb.prepare("SELECT * FROM support_tickets WHERE id = ?").get(ticketId));
  if (ex) appendSupportTicket({ ...ex, ...fields, id: ticketId });
}

// ── Support Sessions ───────────────────────────────────────────────────────
function _rowToSess(r) {
  if (!r) return null;
  return { id: r.id, ticketId: r.ticket_id, taskId: r.task_id,
    linkedTickets: pa(r.linked_tickets_json), status: r.status, channel: r.channel,
    startedBy: r.started_by, reason: r.reason, assignedAgentId: r.assigned_agent_id,
    assignedAgentName: r.assigned_agent_name, unread: po(r.unread_json),
    presence: po(r.presence_json), messages: pa(r.messages_json),
    createdAt: r.created_at, updatedAt: r.updated_at };
}
const _stmtUpsertSess = sqliteDb.prepare(`INSERT OR REPLACE INTO support_sessions (id,ticket_id,task_id,linked_tickets_json,status,channel,started_by,reason,assigned_agent_id,assigned_agent_name,unread_json,presence_json,messages_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
function upsertSupportSession(s) {
  _stmtUpsertSess.run(
    s.id, s.ticketId||s.ticket_id||null, s.taskId||s.task_id||null,
    j(s.linkedTickets||s.linked_tickets||[]), s.status||"open", s.channel||"",
    s.startedBy||s.started_by||"system", s.reason||"",
    s.assignedAgentId||s.assigned_agent_id||null, s.assignedAgentName||s.assigned_agent_name||null,
    j(s.unread||{user:0,ops:0}), j(s.presence||{}), j(s.messages||[]),
    s.createdAt||s.created_at||nowIso(), s.updatedAt||s.updated_at||nowIso()
  );
}
function getSupportSession(id)       { return _rowToSess(sqliteDb.prepare("SELECT * FROM support_sessions WHERE id = ?").get(id)); }
function getAllSupportSessions()      { return sqliteDb.prepare("SELECT * FROM support_sessions ORDER BY created_at DESC").all().map(_rowToSess); }
function getAllSupportSessionsMap()   { return Object.fromEntries(getAllSupportSessions().map(s => [s.id, s])); }

// ── Trip Plans ─────────────────────────────────────────────────────────────
function _rowToTripPlan(r) {
  if (!r) return null;
  return { id: r.id, userId: r.user_id, title: r.title, city: r.city, note: r.note,
    status: r.status, startAt: r.start_at, endAt: r.end_at,
    taskIds: pa(r.task_ids_json), lifecycle: pa(r.lifecycle_json),
    progress: po(r.progress_json), derivedStatus: r.derived_status,
    createdAt: r.created_at, updatedAt: r.updated_at };
}
const _stmtUpsertTP = sqliteDb.prepare(`INSERT OR REPLACE INTO trip_plans (id,user_id,title,city,note,status,start_at,end_at,task_ids_json,lifecycle_json,progress_json,derived_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
function upsertTripPlan(plan) {
  _stmtUpsertTP.run(
    plan.id, plan.userId||plan.user_id||"demo", plan.title||"", plan.city||"", plan.note||"",
    plan.status||"active", plan.startAt||plan.start_at||"", plan.endAt||plan.end_at||"",
    j(plan.taskIds||plan.task_ids||[]), j(plan.lifecycle||[]), j(plan.progress||{}),
    plan.derivedStatus||plan.derived_status||"draft",
    plan.createdAt||plan.created_at||nowIso(), plan.updatedAt||plan.updated_at||nowIso()
  );
}
function getTripPlan(id)            { return _rowToTripPlan(sqliteDb.prepare("SELECT * FROM trip_plans WHERE id = ?").get(id)); }
function getAllTripPlans()           { return sqliteDb.prepare("SELECT * FROM trip_plans ORDER BY created_at DESC").all().map(_rowToTripPlan); }
function getAllTripPlansMap()        { return Object.fromEntries(getAllTripPlans().map(p => [p.id, p])); }
function getTripPlansForUser(uid)   { return sqliteDb.prepare("SELECT * FROM trip_plans WHERE user_id = ? ORDER BY created_at DESC").all(uid).map(_rowToTripPlan); }

// ── Trips Log ──────────────────────────────────────────────────────────────
function insertTrip({ deviceId, city, area, intent, place, amount, railId, slots, orderId }) {
  const trip = {
    id: orderId || `trip_${Date.now().toString(36)}`,
    deviceId: String(deviceId || "demo"), city: String(city || ""),
    area: String(area || ""), intent: String(intent || "eat"),
    place: String(place || ""), amount: Number(amount || 0),
    railId: String(railId || "alipay_cn"), slots: slots || {}, executedAt: nowIso(),
  };
  sqliteDb.prepare(`INSERT OR REPLACE INTO trips (id,device_id,city,area,intent,place,amount,rail_id,slots_json,executed_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    trip.id, trip.deviceId, trip.city, trip.area, trip.intent, trip.place, trip.amount, trip.railId, j(trip.slots), trip.executedAt
  );
  return trip;
}
function getRecentTrips(deviceId, limit = 5) {
  return sqliteDb.prepare("SELECT * FROM trips WHERE device_id = ? ORDER BY executed_at DESC LIMIT ?")
    .all(String(deviceId || "demo"), limit)
    .map(r => ({ id: r.id, deviceId: r.device_id, city: r.city, area: r.area, intent: r.intent,
      place: r.place, amount: r.amount, railId: r.rail_id, slots: po(r.slots_json), executedAt: r.executed_at }));
}

// ── Chat Notifications ─────────────────────────────────────────────────────
function getChatNotifications(sinceTs) {
  const rows = sinceTs
    ? sqliteDb.prepare("SELECT * FROM chat_notifications WHERE at > ? ORDER BY at ASC").all(sinceTs)
    : sqliteDb.prepare("SELECT * FROM chat_notifications ORDER BY at DESC LIMIT 100").all();
  return rows.map(r => ({ id: r.id, at: r.at, kind: r.kind, taskId: r.task_id, ...po(r.payload_json) }));
}
function appendChatNotification(n) {
  sqliteDb.prepare(`INSERT OR IGNORE INTO chat_notifications (id,at,kind,task_id,payload_json) VALUES (?,?,?,?,?)`).run(
    n.id||`cn_${Date.now().toString(36)}`, n.at||nowIso(), n.kind||"", n.taskId||n.task_id||null, j(n)
  );
}

// ── CrossX Orders ──────────────────────────────────────────────────────────
function getCrossXOrder(ref) {
  const r = sqliteDb.prepare("SELECT * FROM crossx_orders WHERE ref = ?").get(ref);
  return r ? { ref: r.ref, status: r.status, method: r.method, destination: r.destination,
    total: r.total, planId: r.plan_id, planTag: r.plan_tag, ip: r.ip,
    confirmedAt: r.confirmed_at, createdAt: r.created_at } : null;
}
function upsertCrossXOrder(ref, data) {
  sqliteDb.prepare(`INSERT OR REPLACE INTO crossx_orders (ref,status,method,destination,total,plan_id,plan_tag,ip,confirmed_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    ref, data.status||"pending", data.method||"card", data.destination||"", data.total||0,
    data.planId||data.plan_id||"", data.planTag||data.plan_tag||"", data.ip||"",
    data.confirmedAt||data.confirmed_at||null, data.createdAt||data.created_at||nowIso()
  );
}

// ── Backwards-compat helpers ───────────────────────────────────────────────
function lifecyclePush(collection, state, label, note) {
  if (!Array.isArray(collection)) return;
  collection.push({ state, label, at: nowIso(), note });
}
// ── Write-through proxy machinery for legacy mutation+saveDb() pattern ────────
const _dirty = {
  orders:    new Map(),
  tasks:     new Map(),
  sessions:  new Map(),
  tripPlans: new Map(),
};

/** Returns a Proxy of `obj` that marks it dirty in `dirtyMap` on any property set. */
function _liveProxy(obj, dirtyMap) {
  const id = obj.id;
  return new Proxy(obj, {
    set(target, prop, value) {
      target[prop] = value;
      dirtyMap.set(id, target);
      return true;
    },
  });
}

/**
 * Returns a write-through collection Proxy.
 * - get(id)   → getOne(id) wrapped in _liveProxy
 * - set(id,v) → upsertOne(v) immediately
 * - has(id)   → boolean
 * - ownKeys() → all IDs (supports Object.keys/values)
 */
function _collProxy(getOne, getAllMap, upsertOne, dirtyMap) {
  return new Proxy({}, {
    get(_, key) {
      if (typeof key === "symbol" || key === "then") return undefined;
      const item = getOne(String(key));
      return item ? _liveProxy(item, dirtyMap) : undefined;
    },
    set(_, key, value) {
      const norm = { ...value };
      if (!norm.id) norm.id = String(key);
      upsertOne(norm);
      return true;
    },
    has(_, key) { return !!getOne(String(key)); },
    ownKeys(_)  { return Object.keys(getAllMap()); },
    getOwnPropertyDescriptor(_, key) {
      const item = getOne(String(key));
      if (!item) return undefined;
      return { value: _liveProxy(item, dirtyMap), writable: true, enumerable: true, configurable: true };
    },
  });
}

/** Flush all dirty objects accumulated by _liveProxy mutations. */
function saveDb() {
  for (const [id, o] of _dirty.orders)    { try { upsertOrder(o); }         catch (e) { console.error("[db] saveDb: upsertOrder failed for", id, e.message); } }
  _dirty.orders.clear();
  for (const [id, t] of _dirty.tasks)     { try { upsertTask(t); }           catch (e) { console.error("[db] saveDb: upsertTask failed for", id, e.message); } }
  _dirty.tasks.clear();
  for (const [id, s] of _dirty.sessions)  { try { upsertSupportSession(s); } catch (e) { console.error("[db] saveDb: upsertSession failed for", id, e.message); } }
  _dirty.sessions.clear();
  for (const [id, p] of _dirty.tripPlans) { try { upsertTripPlan(p); }       catch (e) { console.error("[db] saveDb: upsertTripPlan failed for", id, e.message); } }
  _dirty.tripPlans.clear();
}
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ── GDPR helpers ────────────────────────────────────────────────────────────
const _stmtInsertConsent = sqliteDb.prepare(`
  INSERT INTO consent_log (id,device_id,event_type,consent_version,purposes,lawful_basis,ip_hash,user_agent_hash,created_at)
  VALUES (@id,@device_id,@event_type,@consent_version,@purposes,@lawful_basis,@ip_hash,@user_agent_hash,@created_at)
`);
function appendConsentLog(entry) {
  _stmtInsertConsent.run({
    id: entry.id, device_id: entry.device_id, event_type: entry.event_type,
    consent_version: entry.consent_version, purposes: j(entry.purposes) || entry.purposes,
    lawful_basis: entry.lawful_basis || "consent",
    ip_hash: entry.ip_hash || null, user_agent_hash: entry.user_agent_hash || null,
    created_at: entry.created_at || nowIso(),
  });
}
function getConsentLog(deviceId) {
  return sqliteDb.prepare("SELECT * FROM consent_log WHERE device_id = ? ORDER BY created_at DESC").all(deviceId);
}

const _stmtInsertGdpr = sqliteDb.prepare(`
  INSERT INTO gdpr_requests (id,device_id,type,status,request_json,deadline_at,created_at)
  VALUES (@id,@device_id,@type,@status,@request_json,@deadline_at,@created_at)
`);
const _stmtUpdateGdpr = sqliteDb.prepare(`
  UPDATE gdpr_requests SET status=@status, response_json=@response_json, completed_at=@completed_at WHERE id=@id
`);
function createGdprRequest(entry) {
  _stmtInsertGdpr.run({
    id: entry.id, device_id: entry.device_id, type: entry.type,
    status: entry.status || "pending", request_json: j(entry.request || {}),
    deadline_at: entry.deadline_at || null, created_at: entry.created_at || nowIso(),
  });
}
function updateGdprRequest(id, patch) {
  _stmtUpdateGdpr.run({
    id, status: patch.status || "completed",
    response_json: patch.response_json || null,
    completed_at: patch.completed_at || nowIso(),
  });
}
function getGdprRequests(deviceId) {
  return sqliteDb.prepare("SELECT * FROM gdpr_requests WHERE device_id = ? ORDER BY created_at DESC").all(deviceId);
}
function getPendingErasures() {
  return sqliteDb.prepare(
    "SELECT * FROM gdpr_requests WHERE type='erase' AND status='pending' AND deadline_at <= ?"
  ).all(nowIso());
}
function updateUserGdprFields(deviceId, patch) {
  // Ensure user row exists first (GDPR ops can happen before any explicit profile save)
  const existing = sqliteDb.prepare("SELECT id FROM users WHERE id=?").get(deviceId);
  if (!existing) {
    sqliteDb.prepare("INSERT OR IGNORE INTO users (id,language,city,city_zh,province,province_zh,district,district_zh,view_mode,pref_budget,pref_dietary,pref_family,pref_accessibility,pref_transport,pref_walking,pref_allergy,place_hotel,place_office,place_airport,loc_source,no_pin_enabled,daily_limit,single_limit,payment_rail,plus_plan,plus_benefits,location_enabled) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(deviceId,"EN","Shanghai","","","","","","user","mid","",0,"optional","mixed","walk","","","","PVG","none",1,2000,500,"alipay_cn","none","[]",1);
  }
  const sets = [];
  const vals = {};
  if (patch.consent_version !== undefined) { sets.push("consent_version=@cv"); vals.cv = patch.consent_version; }
  if (patch.consent_date    !== undefined) { sets.push("consent_date=@cd");    vals.cd = patch.consent_date; }
  if (patch.data_processing_restricted !== undefined) { sets.push("data_processing_restricted=@dpr"); vals.dpr = patch.data_processing_restricted ? 1 : 0; }
  if (patch.deletion_requested_at !== undefined) { sets.push("deletion_requested_at=@dra"); vals.dra = patch.deletion_requested_at; }
  if (patch.deletion_scheduled_at !== undefined) { sets.push("deletion_scheduled_at=@dsa"); vals.dsa = patch.deletion_scheduled_at; }
  if (!sets.length) return;
  vals.id = deviceId;
  sqliteDb.prepare(`UPDATE users SET ${sets.join(",")} WHERE id=@id`).run(vals);
}
function getUserGdprFields(deviceId) {
  const row = sqliteDb.prepare(
    "SELECT consent_version,consent_date,data_processing_restricted,deletion_requested_at,deletion_scheduled_at FROM users WHERE id=?"
  ).get(deviceId);
  return row || {};
}

// ── Data retention pruner (call on GC intervals) ────────────────────────────
function pruneOldData() {
  const now = Date.now();
  const cutAudit  = new Date(now - 730 * 86400000).toISOString(); // 2 years
  const cutMetric = new Date(now - 90  * 86400000).toISOString(); // 90 days
  const cutMcp    = new Date(now - 180 * 86400000).toISOString(); // 180 days
  const cutConsent= new Date(now - 365 * 86400000).toISOString(); // 1 year for granted records
  sqliteDb.prepare("DELETE FROM audit_logs   WHERE at < ?").run(cutAudit);
  sqliteDb.prepare("DELETE FROM metric_events WHERE at < ?").run(cutMetric);
  sqliteDb.prepare("DELETE FROM mcp_calls    WHERE at < ?").run(cutMcp);
  // Retain all consent logs (legal record) — only archive withdrawn ones older than 1yr
  sqliteDb.prepare("DELETE FROM consent_log WHERE event_type='withdrawn' AND created_at < ?").run(cutConsent);
}

// ── legacyDb Proxy (drop-in for old `db` object) ──────────────────────────
const legacyDb = new Proxy({}, {
  get(target, prop) {
    const cfg = getConfig();
    switch (prop) {
      case "users":              return { demo: getDemoUser() };
      // Write-through collection proxies — reads from SQLite, writes persist immediately
      case "orders":             return _collProxy(getOrder,         getAllOrdersMap,         upsertOrder,         _dirty.orders);
      case "tasks":              return _collProxy(getTask,          getAllTasksMap,          upsertTask,          _dirty.tasks);
      case "tripPlans":          return _collProxy(getTripPlan,      getAllTripPlansMap,      upsertTripPlan,      _dirty.tripPlans);
      case "supportSessions":    return _collProxy(getSupportSession,getAllSupportSessionsMap,upsertSupportSession,_dirty.sessions);
      // supportTickets: array proxy — push writes to SQLite
      case "supportTickets": {
        const arr = getSupportTickets();
        return new Proxy(arr, {
          get(t, p2) {
            if (p2 === "push") {
              return function(...items) {
                for (const item of items) appendSupportTicket(item);
                return t.length + items.length;
              };
            }
            const v = t[p2];
            return typeof v === "function" ? v.bind(t) : v;
          },
          set(t, p2, v) { t[p2] = v; return true; },
        });
      }
      // Plain reads
      case "settlements":        return getSettlements();
      case "providerLedger":     return getProviderLedger();
      case "reconciliationRuns": return getReconciliationRuns();
      case "auditLogs":          return getAuditLogArray(2000);
      case "mcpCalls":           return getMcpCalls(1000);
      case "metricEvents":       return getMetricEvents(2000);
      case "chatNotifications":  return getChatNotifications(null);
      case "idempotency":        return getIdempotencyAsObject();
      case "trips":              return [];
      case "featureFlags":       return cfg.featureFlags;
      case "mcpContracts":       return cfg.mcpContracts;
      case "mcpPolicy":          return cfg.mcpPolicy;
      case "paymentCompliance":  return cfg.paymentCompliance;
      case "miniProgram":        return cfg.miniProgram;
      default:                   return target[prop];
    }
  },
  set(target, prop, value) {
    switch (prop) {
      case "featureFlags":      updateConfig({ featureFlags: value });      return true;
      case "mcpPolicy":         updateConfig({ mcpPolicy: value });          return true;
      case "mcpContracts":      updateConfig({ mcpContracts: value });       return true;
      case "paymentCompliance": updateConfig({ paymentCompliance: value });  return true;
      case "miniProgram":       updateConfig({ miniProgram: value });        return true;
      case "supportTickets":    // Bulk replace (size-limit / loadDb migration)
        if (Array.isArray(value)) {
          sqliteDb.exec("DELETE FROM support_tickets");
          for (const t of value) appendSupportTicket(t);
        }
        return true;
      case "tasks":
        if (value && typeof value === "object" && Object.keys(value).length === 0) {
          deleteAllTasks(); return true;
        }
        break;
    }
    target[prop] = value;
    return true;
  },
});

// ── Training Data & Benchmarks ─────────────────────────────────────────────
function appendTrainingFeedback({ id, plan_id, device_id, rating, comment, signal_type, destination, duration_days }) {
  const _id = id || "tf_" + require("crypto").randomBytes(8).toString("hex");
  sqliteDb.prepare(`
    INSERT OR IGNORE INTO training_feedback (id, plan_id, device_id, rating, comment, signal_type, destination, duration_days)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(_id, plan_id, device_id, rating || null, comment || null, signal_type || "explicit", destination || null, duration_days || null);
  return _id;
}

function upsertTrainingExample({ id, user_message, system_prompt, assistant_response, quality_score, source, destination, duration_days, session_id }) {
  const _id = id || "ex_" + require("crypto").randomBytes(8).toString("hex");
  sqliteDb.prepare(`
    INSERT OR REPLACE INTO training_examples
      (id, user_message, system_prompt, assistant_response, quality_score, source, destination, duration_days, session_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(_id, user_message, system_prompt, assistant_response, quality_score ?? 0.5, source || "openai", destination || null, duration_days || null, session_id || null);
  return _id;
}

function getTrainingExampleBySession(sessionId) {
  if (!sessionId) return null;
  return sqliteDb.prepare("SELECT * FROM training_examples WHERE session_id=? ORDER BY created_at DESC LIMIT 1").get(sessionId);
}

function updateTrainingExampleScore(id, qualityScore) {
  sqliteDb.prepare("UPDATE training_examples SET quality_score=? WHERE id=?").run(qualityScore, id);
}

function getTrainingExamples({ minScore = 0, limit = 1000, destination } = {}) {
  if (destination) {
    return sqliteDb.prepare(
      "SELECT * FROM training_examples WHERE quality_score >= ? AND destination LIKE ? ORDER BY quality_score DESC LIMIT ?"
    ).all(minScore, `%${destination}%`, limit);
  }
  return sqliteDb.prepare(
    "SELECT * FROM training_examples WHERE quality_score >= ? ORDER BY quality_score DESC LIMIT ?"
  ).all(minScore, limit);
}

function getTrainingFeedback(deviceId) {
  if (deviceId) return sqliteDb.prepare("SELECT * FROM training_feedback WHERE device_id=? ORDER BY created_at DESC").all(deviceId);
  return sqliteDb.prepare("SELECT * FROM training_feedback ORDER BY created_at DESC LIMIT 500").all();
}

function upsertPromptExperiment({ prompt_id, variant, won }) {
  sqliteDb.prepare(`
    INSERT INTO prompt_experiments (prompt_id, variant, win_count, loss_count, total_count)
    VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(prompt_id, variant) DO UPDATE SET
      win_count   = win_count   + excluded.win_count,
      loss_count  = loss_count  + excluded.loss_count,
      total_count = total_count + 1
  `).run(prompt_id, variant, won ? 1 : 0, won ? 0 : 1);
}

function getPromptExperiments(promptId) {
  if (promptId) return sqliteDb.prepare("SELECT * FROM prompt_experiments WHERE prompt_id=? AND is_active=1").all(promptId);
  return sqliteDb.prepare("SELECT * FROM prompt_experiments ORDER BY prompt_id, total_count DESC").all();
}

function appendCapabilityBenchmark({ id, run_id, query, expected_intent, actual_intent, expected_destination, actual_destination, score, latency_ms, model }) {
  const _id = id || "cb_" + require("crypto").randomBytes(6).toString("hex");
  sqliteDb.prepare(`
    INSERT OR IGNORE INTO capability_benchmarks
      (id, run_id, query, expected_intent, actual_intent, expected_destination, actual_destination, score, latency_ms, model)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(_id, run_id, query, expected_intent || null, actual_intent || null,
    expected_destination || null, actual_destination || null, score ?? null, latency_ms || null, model || null);
  return _id;
}

function getBenchmarkRuns(limit = 10) {
  return sqliteDb.prepare(`
    SELECT run_id, model,
           ROUND(AVG(score), 3) as avg_score,
           COUNT(*) as cases,
           SUM(CASE WHEN score >= 0.7 THEN 1 ELSE 0 END) as pass_count,
           ROUND(AVG(latency_ms)) as avg_latency_ms,
           MIN(created_at) as run_at
    FROM capability_benchmarks
    GROUP BY run_id
    ORDER BY run_at DESC LIMIT ?
  `).all(limit);
}

// ── Receipts ────────────────────────────────────────────────────────────────
function upsertReceipt(orderId, contentType, body) {
  const id = `rcpt_${orderId}`;
  sqliteDb.prepare(
    "INSERT OR REPLACE INTO receipts (id, order_id, content_type, body, created_at) VALUES (?,?,?,?,?)"
  ).run(id, orderId, contentType || "text/html", body || "", nowIso());
  return id;
}
function getReceipt(orderId) {
  return sqliteDb.prepare("SELECT * FROM receipts WHERE order_id=? ORDER BY created_at DESC LIMIT 1").get(orderId) || null;
}

// ── Exports ────────────────────────────────────────────────────────────────
module.exports = {
  sqliteDb, db: legacyDb, legacyDb,
  DATA_DIR, DB_FILE, ensureDataDir, nowIso, saveDb, lifecyclePush,
  getUser, getDemoUser, updateUser,
  getTask, getAllTasks, getAllTasksMap, upsertTask, deleteAllTasks,
  getOrder, getAllOrders, getAllOrdersMap, upsertOrder, findOrderByOutOrderNo,
  getSettlements, appendSettlement, updateSettlement, hasSettlement,
  getProviderLedger, appendProviderLedgerEntry, hasProviderEntry,
  getReconciliationRuns, appendReconciliationRun,
  appendAuditLog, getAuditLogs, getAuditLogArray,
  appendMcpCall, getMcpCalls,
  appendMetricEvent, getMetricEvents, getMetricEventCount,
  getIdempotencyEntry, setIdempotencyEntry, purgeExpiredIdempotency, getIdempotencyAsObject,
  getSupportTickets, appendSupportTicket, updateSupportTicket,
  getSupportSession, upsertSupportSession, getAllSupportSessions, getAllSupportSessionsMap,
  getTripPlan, getAllTripPlans, getAllTripPlansMap, getTripPlansForUser, upsertTripPlan,
  insertTrip, getRecentTrips,
  getChatNotifications, appendChatNotification,
  getCrossXOrder, upsertCrossXOrder,
  getConfig, updateConfig,
  appendConsentLog, getConsentLog,
  createGdprRequest, updateGdprRequest, getGdprRequests, getPendingErasures,
  updateUserGdprFields, getUserGdprFields,
  getUserRole, setUserRole, migratePiiEncryption,
  upsertReceipt, getReceipt,
  pruneOldData,
  appendTrainingFeedback, getTrainingFeedback,
  upsertTrainingExample, updateTrainingExampleScore, getTrainingExamples, getTrainingExampleBySession,
  upsertPromptExperiment, getPromptExperiments,
  appendCapabilityBenchmark, getBenchmarkRuns,
};
