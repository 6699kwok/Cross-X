#!/usr/bin/env node
"use strict";
/**
 * scripts/migrate_json_to_sqlite.js
 * One-time migration: data/db.json → data/crossx.db
 *
 * Run: node scripts/migrate_json_to_sqlite.js
 * The original db.json is renamed to db.json.bak after success.
 * Safe to re-run: uses INSERT OR REPLACE (idempotent).
 */

const path = require("path");
const fs   = require("fs");

const DB_JSON = path.join(__dirname, "../data/db.json");
const DB_BAK  = path.join(__dirname, "../data/db.json.bak");

if (!fs.existsSync(DB_JSON)) {
  console.log("data/db.json not found — nothing to migrate.");
  process.exit(0);
}

console.log("Loading db.json...");
const old = JSON.parse(fs.readFileSync(DB_JSON, "utf8"));

// Import new db module (triggers SQLite schema creation)
const db = require("../src/services/db");
const sql = db.sqliteDb;

console.log("Running migration in a single transaction...");
const migrate = sql.transaction(() => {

  // 1. Demo user
  const demoUser = old.users?.demo;
  if (demoUser) {
    db.updateUser("demo", {
      language: demoUser.language,
      city: demoUser.city,
      cityZh: demoUser.cityZh,
      province: demoUser.province,
      provinceZh: demoUser.provinceZh,
      district: demoUser.district,
      districtZh: demoUser.districtZh,
      viewMode: demoUser.viewMode,
      preferences: demoUser.preferences,
      savedPlaces: demoUser.savedPlaces,
      location: demoUser.location,
      privacy: demoUser.privacy,
      authDomain: demoUser.authDomain,
      paymentRail: demoUser.paymentRail,
      plusSubscription: demoUser.plusSubscription,
    });
    console.log("  ✓ users: 1 (demo)");
  }

  // 2. Tasks
  const tasks = Object.values(old.tasks || {});
  for (const task of tasks) db.upsertTask(task);
  console.log(`  ✓ tasks: ${tasks.length}`);

  // 3. Trip Plans
  const tripPlans = Object.values(old.tripPlans || {});
  for (const plan of tripPlans) db.upsertTripPlan(plan);
  console.log(`  ✓ tripPlans: ${tripPlans.length}`);

  // 4. Orders
  const orders = Object.values(old.orders || {});
  for (const order of orders) db.upsertOrder(order);
  console.log(`  ✓ orders: ${orders.length}`);

  // 5. Settlements
  const settlements = old.settlements || [];
  for (const s of settlements) db.appendSettlement(s);
  console.log(`  ✓ settlements: ${settlements.length}`);

  // 6. Provider Ledger
  const ledger = old.providerLedger || [];
  for (const e of ledger) db.appendProviderLedgerEntry(e);
  console.log(`  ✓ providerLedger: ${ledger.length}`);

  // 7. Reconciliation Runs
  const recRuns = old.reconciliationRuns || [];
  for (const r of recRuns) db.appendReconciliationRun(r);
  console.log(`  ✓ reconciliationRuns: ${recRuns.length}`);

  // 8. Audit Logs
  const auditLogs = old.auditLogs || [];
  for (const log of auditLogs) db.appendAuditLog(log);
  console.log(`  ✓ auditLogs: ${auditLogs.length}`);

  // 9. MCP Calls
  const mcpCalls = old.mcpCalls || [];
  for (const c of mcpCalls) db.appendMcpCall(c);
  console.log(`  ✓ mcpCalls: ${mcpCalls.length}`);

  // 10. Metric Events
  const metricEvents = old.metricEvents || [];
  for (const e of metricEvents) db.appendMetricEvent(e);
  console.log(`  ✓ metricEvents: ${metricEvents.length}`);

  // 11. Support Tickets
  const tickets = old.supportTickets || [];
  for (const t of tickets) db.appendSupportTicket(t);
  console.log(`  ✓ supportTickets: ${tickets.length}`);

  // 12. Support Sessions
  const sessions = Object.values(old.supportSessions || {});
  for (const s of sessions) db.upsertSupportSession(s);
  console.log(`  ✓ supportSessions: ${sessions.length}`);

  // 13. Config sidecar (featureFlags, mcpPolicy, mcpContracts, paymentCompliance, miniProgram)
  const cfgPatch = {};
  if (old.featureFlags)      cfgPatch.featureFlags      = old.featureFlags;
  if (old.mcpPolicy)         cfgPatch.mcpPolicy         = old.mcpPolicy;
  if (old.mcpContracts)      cfgPatch.mcpContracts      = old.mcpContracts;
  if (old.paymentCompliance) cfgPatch.paymentCompliance = old.paymentCompliance;
  if (old.miniProgram)       cfgPatch.miniProgram       = old.miniProgram;
  if (Object.keys(cfgPatch).length) db.updateConfig(cfgPatch);
  console.log("  ✓ config sidecar: featureFlags, mcpPolicy, mcpContracts, paymentCompliance, miniProgram");

});

migrate();

// Flush config sidecar synchronously
setTimeout(() => {
  // Rename original json
  fs.renameSync(DB_JSON, DB_BAK);
  console.log(`\nMigration complete!`);
  console.log(`  SQLite DB: data/crossx.db`);
  console.log(`  Original:  data/db.json → data/db.json.bak (safe, can delete later)`);
  console.log(`\nTo verify: node -e "const d = require('./src/services/db'); console.log('tasks:', d.getAllTasks().length, 'orders:', d.getAllOrders().length, 'auditLogs:', d.getAuditLogs(1).length)"`);
  process.exit(0);
}, 600);
