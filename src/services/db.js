"use strict";
const path = require("path");
const fs   = require("fs");

// ── Paths ──────────────────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, "../../data");
const DB_FILE  = path.join(DATA_DIR, "db.json");

// ── In-memory store (single shared object — mutated in-place by loadDb) ───
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
  trips: [],
  auditLogs: [],
  mcpCalls: [],
  metricEvents: [],
  chatNotifications: [],
  supportTickets: [],
  supportSessions: {},
  idempotency: {},
  featureFlags: {
    plusConcierge:  { enabled: false, rollout: 0 },
    manualFallback: { enabled: true,  rollout: 100 },
    liveTranslation:{ enabled: false, rollout: 10 },
  },
  mcpContracts: {
    gaode_or_fallback:    { id: "gaode_or_fallback",    provider: "Gaode LBS",                    external: true, slaMs: 2200, enforced: true },
    partner_hub_queue:    { id: "partner_hub_queue",    provider: "Partner Hub Queue API",         external: true, slaMs: 1800, enforced: true },
    partner_hub_booking:  { id: "partner_hub_booking",  provider: "Partner Hub Booking API",      external: true, slaMs: 2500, enforced: true },
    partner_hub_traffic:  { id: "partner_hub_traffic",  provider: "Partner Hub Traffic API",      external: true, slaMs: 1800, enforced: true },
    partner_hub_transport:{ id: "partner_hub_transport",provider: "Partner Hub Transport API",    external: true, slaMs: 2500, enforced: true },
    payment_rail:         { id: "payment_rail",          provider: "ACT Rail Gateway",             external: true, slaMs: 3200, enforced: true },
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
      alipay_cn:    { certified: true, kycPassed: true, pciDss: true, riskTier: "low",    enabled: true },
      wechat_cn:    { certified: true, kycPassed: true, pciDss: true, riskTier: "medium", enabled: true },
      card_delegate:{ certified: true, kycPassed: true, pciDss: true, riskTier: "high",   enabled: true },
    },
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function saveDb() {
  try {
    ensureDataDir();
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
  } catch (err) {
    console.error("Failed to save db:", err.message);
  }
}

function lifecyclePush(collection, state, label, note) {
  if (!Array.isArray(collection)) return;
  collection.push({ state, label, at: nowIso(), note });
}

/** Insert a completed agent trip into the trips log and persist. */
function insertTrip({ deviceId, city, area, intent, place, amount, railId, slots, orderId }) {
  const trip = {
    id: orderId || `trip_${Date.now().toString(36)}`,
    deviceId: String(deviceId || "demo"),
    city: String(city || ""),
    area: String(area || ""),
    intent: String(intent || "eat"),
    place: String(place || ""),
    amount: Number(amount || 0),
    railId: String(railId || "alipay_cn"),
    slots: slots || {},
    executedAt: nowIso(),
  };
  if (!Array.isArray(db.trips)) db.trips = [];
  db.trips.unshift(trip); // newest first
  if (db.trips.length > 200) db.trips = db.trips.slice(0, 200); // cap
  saveDb();
  return trip;
}

/** Return the N most recent trips for a device (default 5). */
function getRecentTrips(deviceId, limit = 5) {
  if (!Array.isArray(db.trips)) return [];
  const id = String(deviceId || "demo");
  return db.trips.filter((t) => t.deviceId === id).slice(0, limit);
}

module.exports = { db, DATA_DIR, DB_FILE, ensureDataDir, nowIso, saveDb, lifecyclePush, insertTrip, getRecentTrips };
