"use strict";
/**
 * src/utils/logger.js
 * Lightweight structured JSON logger.
 * Replaces scattered console.log/error calls with leveled, parseable output.
 *
 * Usage:
 *   const { logger } = require("./src/utils/logger");
 *   logger.info("request", { method: "GET", path: "/api/user", latencyMs: 12 });
 *   logger.warn("rate_limit", { ip: "1.2.3.4", tier: "agent" });
 *   logger.error("db_error", { err: error.message });
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL = LEVELS[process.env.LOG_LEVEL] ?? (process.env.NODE_ENV === "production" ? LEVELS.info : LEVELS.debug);

function _log(level, event, meta = {}) {
  if (LEVELS[level] < MIN_LEVEL) return;
  const entry = {
    ts:    new Date().toISOString(),
    level,
    event,
    ...meta,
  };
  const out = JSON.stringify(entry);
  if (level === "error") {
    process.stderr.write(out + "\n");
  } else {
    process.stdout.write(out + "\n");
  }
}

const logger = {
  debug: (event, meta) => _log("debug", event, meta),
  info:  (event, meta) => _log("info",  event, meta),
  warn:  (event, meta) => _log("warn",  event, meta),
  error: (event, meta) => _log("error", event, meta),
};

module.exports = { logger };
