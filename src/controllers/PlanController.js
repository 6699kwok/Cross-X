"use strict";
/**
 * src/controllers/PlanController.js
 * Thin orchestration layer around the plan SSE pipeline.
 *
 * Responsibility:
 *   - Guard the SSE connection with an isolated try-catch so that any
 *     unhandled error in the plan pipeline cannot crash the HTTP server
 *   - Enforce content-type headers BEFORE delegating to planRouter
 *   - Expose planRouter as a named factory so server.js stays thin
 *
 * Dependency chain (no cycles):
 *   PlanController → routes/plan (createPlanRouter)
 *                  → utils/http (writeJson for pre-SSE errors)
 *
 * SSO guarantee:
 *   - planRouter reads deviceId / sessionId from body (unchanged)
 *   - Auth tokens are validated inside plan.js via validateUserToken (unchanged)
 *   - No new session state is introduced here
 */

const { writeJson } = require("../utils/http");

/**
 * Build the plan controller, wrapping the planRouter factory.
 * All deps that planRouter needs are injected here so server.js stays thin.
 *
 * @param {object} deps  Same shape as createPlanRouter() expects
 * @returns {function} handle(req, res) — the SSE entry point
 */
function createPlanController(deps) {
  // Lazy import to avoid requiring plan.js before all deps are ready
  const { createPlanRouter } = require("../routes/plan");
  const planRouter = createPlanRouter(deps);

  /**
   * Handle POST /api/plan/coze (main SSE pipeline)
   * Wraps the full SSE pipeline in a try-catch so a crash in any
   * downstream module never kills the main http.createServer handler.
   */
  async function handleCoze(req, res) {
    try {
      // Enforce SSE response headers before any async work
      res.setHeader("Content-Type",  "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection",    "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");  // nginx: disable proxy buffering

      await planRouter.handleCoze(req, res);
    } catch (err) {
      console.error("[PlanController] Unhandled SSE error:", err.message, err.stack);
      // If headers haven't been flushed yet, send a proper JSON error
      if (!res.headersSent) {
        writeJson(res, 500, { error: "plan_pipeline_error", message: "Internal server error" });
        return;
      }
      // Headers already sent (SSE started) — emit an error event and close cleanly
      try {
        res.write(`data: ${JSON.stringify({ type: "error", error: "pipeline_crashed", message: err.message })}\n\n`);
        res.end();
      } catch { /* socket already gone */ }
    }
  }

  /**
   * Handle POST /api/plan/detail (on-demand itinerary detail)
   */
  async function handleDetail(req, res) {
    try {
      await planRouter.handleDetail(req, res);
    } catch (err) {
      console.error("[PlanController] Unhandled detail error:", err.message, err.stack);
      if (!res.headersSent) {
        writeJson(res, 500, { error: "detail_pipeline_error", message: "Internal server error" });
      }
    }
  }

  // handle is the primary SSE entry (backward compat alias for handleCoze)
  return { handle: handleCoze, handleCoze, handleDetail };
}

module.exports = { createPlanController };
