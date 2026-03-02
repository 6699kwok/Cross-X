"use strict";
/**
 * src/mcp/server.js
 * Model Context Protocol (MCP) server — port 8788.
 *
 * Implements MCP 2024-11-05 specification:
 *   • Streamable HTTP  →  POST /mcp          (simple clients: Cursor, Windsurf)
 *   • HTTP + SSE       →  GET  /sse          (server→client stream)
 *                         POST /message      (client→server, response via SSE)
 *
 * Capabilities exposed:
 *   tools     — 5 travel tools (search_hotels, search_restaurants, get_route, etc.)
 *   resources — 2 knowledge base entries (china-travel, visa-info)
 *   prompts   — 2 preset prompt templates (trip-planner, food-explorer)
 */

const http   = require("http");
const crypto = require("crypto");
const { TOOL_DEFINITIONS, executeTool } = require("../agent/tools");

const MCP_PORT = Number(process.env.MCP_PORT || 8788);
const MCP_HOST = process.env.MCP_HOST || "127.0.0.1";

// ── MCP tool schema (OpenAI → MCP format) ────────────────────────────────────
const MCP_TOOLS = TOOL_DEFINITIONS.map((t) => ({
  name:        t.function.name,
  description: t.function.description,
  inputSchema: {
    type:       "object",
    properties: t.function.parameters?.properties || {},
    required:   t.function.parameters?.required   || [],
  },
}));

// ── MCP resources ─────────────────────────────────────────────────────────────
const MCP_RESOURCES = [
  {
    uri:         "crossx://knowledge/china-travel",
    name:        "China Travel Knowledge Base",
    description: "General travel tips for mainland China: visa, transport, safety, culture.",
    mimeType:    "text/plain",
  },
  {
    uri:         "crossx://knowledge/visa-info",
    name:        "China Visa Information",
    description: "Visa-on-arrival, e-visa, and standard visa requirements by nationality.",
    mimeType:    "text/plain",
  },
];

const RESOURCE_CONTENT = {
  "crossx://knowledge/china-travel": `
# China Travel — Key Tips

## Transport
- High-speed rail (HSR): covers most major cities; book via 12306.cn or trip.com
- Flights: CAAC carriers dominate; budget carriers include Air Asia China, West Air
- Didi (ride-hailing): works in all tier-1 and most tier-2 cities; cash rarely accepted

## Payments
- WeChat Pay & Alipay dominate; link a foreign Visa/Mastercard to both
- Cash (CNY) still works in markets and small restaurants

## Connectivity
- VPN required to access Google/YouTube/WhatsApp; set up before arrival
- Local SIM: China Unicom / China Mobile sell tourist SIMs at airports

## Safety
- Overall very safe; standard city crime precautions apply
- Emergency: 110 (police), 120 (ambulance), 119 (fire)

## Culture
- Tipping is not customary
- Bargaining accepted in markets, not in malls
- Photography restrictions in some temples and military sites
`.trim(),

  "crossx://knowledge/visa-info": `
# China Visa Information

## Visa-Free / Visa-on-Arrival (2024-2025)
- 144-hour transit visa-free: Beijing, Shanghai, Guangzhou, Chengdu, Wuhan, Xi'an + others
- 15-day visa-free: Citizens of France, Germany, Italy, Spain, Netherlands, Switzerland, Ireland,
  Hungary, Austria, Belgium, Luxembourg, Malaysia, Singapore, Thailand, Brunei, UAE, Saudi Arabia,
  Australia, New Zealand (check official list as policy updates frequently)
- 30-day visa-free: Several ASEAN nations

## Standard Tourist Visa (L Visa)
- Apply at Chinese embassy/consulate in home country
- Processing: 4–7 business days
- Materials: passport, photo, flight/hotel booking, bank statement, application form

## e-Visa
- Available for Hong Kong entry from most countries (not required for BNO, UK, many EU)
- Mainland China e-Visa pilot expanding but not universally available yet

## Note
Policies change frequently — verify at visaforchina.cn or local embassy website.
`.trim(),
};

// ── MCP prompts ───────────────────────────────────────────────────────────────
const MCP_PROMPTS = [
  {
    name:        "trip-planner",
    description: "Generate a full multi-day China travel itinerary with hotels, transport, and activities.",
    arguments:   [
      { name: "destination", description: "City or region in China", required: true },
      { name: "duration_days", description: "Number of days (e.g. 5)", required: true },
      { name: "budget_cny",   description: "Total budget in CNY (e.g. 8000)", required: false },
      { name: "party_size",   description: "Number of travellers (e.g. 2)", required: false },
    ],
  },
  {
    name:        "food-explorer",
    description: "Recommend authentic local restaurants and food experiences for a city.",
    arguments:   [
      { name: "city",        description: "City name in Chinese or English", required: true },
      { name: "cuisine",     description: "Preferred cuisine type (optional)", required: false },
      { name: "budget_per_person", description: "Per-person budget in CNY (optional)", required: false },
    ],
  },
];

function getPromptMessages(name, args) {
  if (name === "trip-planner") {
    const dest  = args?.destination || "your destination";
    const days  = args?.duration_days || 5;
    const budget = args?.budget_cny ? `Total budget: ¥${args.budget_cny} CNY.` : "";
    const pax   = args?.party_size  ? `Party size: ${args.party_size} people.` : "";
    return [
      {
        role:    "user",
        content: {
          type: "text",
          text: `Please create a detailed ${days}-day travel itinerary for ${dest}. ${budget} ${pax}
Include: daily schedule, hotel recommendations (3 tiers), transport options, must-see attractions, and local food tips.`,
        },
      },
    ];
  }
  if (name === "food-explorer") {
    const city    = args?.city    || "the city";
    const cuisine = args?.cuisine ? ` focusing on ${args.cuisine}` : "";
    const budget  = args?.budget_per_person ? ` Budget: ¥${args.budget_per_person}/person.` : "";
    return [
      {
        role:    "user",
        content: {
          type: "text",
          text: `Recommend the best authentic local restaurants and food experiences in ${city}${cuisine}.${budget}
Include: restaurant names, signature dishes, average price, queue times, and neighbourhood tips.`,
        },
      },
    ];
  }
  return [{ role: "user", content: { type: "text", text: `Help me with ${name}.` } }];
}

// ── JSON-RPC 2.0 helpers ──────────────────────────────────────────────────────
function rpcOk(id, result)          { return { jsonrpc: "2.0", id, result }; }
function rpcErr(id, code, message)  { return { jsonrpc: "2.0", id, error: { code, message } }; }

// ── Body reader ───────────────────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8"))); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

// ── Core JSON-RPC dispatcher ──────────────────────────────────────────────────
async function handleRpc(body, deps) {
  const { method, id, params } = body;

  switch (method) {

    case "initialize":
      return rpcOk(id, {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools:     {},
          resources: { subscribe: false, listChanged: false },
          prompts:   { listChanged: false },
        },
        serverInfo: { name: "crossx-travel", version: "1.1.0" },
      });

    case "ping":
      return rpcOk(id, {});

    case "tools/list":
      return rpcOk(id, { tools: MCP_TOOLS });

    case "tools/call": {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};
      if (!toolName) return rpcErr(id, -32602, "Missing tool name");
      const known = TOOL_DEFINITIONS.map((t) => t.function.name);
      if (!known.includes(toolName)) return rpcErr(id, -32601, `Unknown tool: ${toolName}`);
      try {
        const result = await executeTool(toolName, toolArgs, deps);
        return rpcOk(id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: Boolean(result?.error),
        });
      } catch (e) {
        console.warn(`[MCP] tool error (${toolName}):`, e.message);
        return rpcErr(id, -32000, e.message);
      }
    }

    case "resources/list":
      return rpcOk(id, { resources: MCP_RESOURCES });

    case "resources/read": {
      const uri     = params?.uri;
      const content = RESOURCE_CONTENT[uri];
      if (!content) return rpcErr(id, -32602, `Unknown resource: ${uri}`);
      return rpcOk(id, {
        contents: [{ uri, mimeType: "text/plain", text: content }],
      });
    }

    case "prompts/list":
      return rpcOk(id, { prompts: MCP_PROMPTS });

    case "prompts/get": {
      const name   = params?.name;
      const prompt = MCP_PROMPTS.find((p) => p.name === name);
      if (!prompt) return rpcErr(id, -32602, `Unknown prompt: ${name}`);
      return rpcOk(id, {
        description: prompt.description,
        messages:    getPromptMessages(name, params?.arguments || {}),
      });
    }

    default:
      // Notifications are fire-and-forget
      if (typeof method === "string" && method.startsWith("notifications/")) return null;
      return rpcErr(id, -32601, `Method not found: ${method}`);
  }
}

// ── SSE session manager ───────────────────────────────────────────────────────
// Maps sessionId → { res: http.ServerResponse, timer: NodeJS.Timer }
const _sseSessions = new Map();
const SSE_PING_MS  = 25000; // keep-alive ping interval

function _sseWrite(res, event, data) {
  try {
    if (event) res.write(`event: ${event}\n`);
    res.write(`data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`);
  } catch {}
}

function _createSseSession(res) {
  const sessionId = crypto.randomBytes(8).toString("hex");
  const timer = setInterval(() => {
    _sseWrite(res, "ping", { ts: Date.now() });
  }, SSE_PING_MS);
  timer.unref();
  _sseSessions.set(sessionId, { res, timer });
  res.on("close", () => {
    clearInterval(timer);
    _sseSessions.delete(sessionId);
    console.log(`[MCP/SSE] Session ${sessionId} closed`);
  });
  console.log(`[MCP/SSE] Session ${sessionId} opened`);
  return sessionId;
}

// ── HTTP server ───────────────────────────────────────────────────────────────
function startMcpServer(deps) {
  const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin",  "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");

    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    // ── GET /sse — Open SSE stream (HTTP+SSE transport) ─────────────────────
    if (req.method === "GET" && url.pathname === "/sse") {
      res.writeHead(200, {
        "Content-Type":  "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection":    "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const sessionId = _createSseSession(res);
      // Send endpoint event — client will POST messages to this URL
      const msgUrl = `http://${MCP_HOST}:${MCP_PORT}/message?sessionId=${sessionId}`;
      _sseWrite(res, "endpoint", msgUrl);
      // Don't end — keep open
      return;
    }

    // ── POST /message — Receive message from client, reply over SSE ─────────
    if (req.method === "POST" && url.pathname === "/message") {
      const sessionId = url.searchParams.get("sessionId");
      const session   = sessionId ? _sseSessions.get(sessionId) : null;

      // Return 202 immediately — response will come via SSE
      res.writeHead(202);
      res.end();

      let body;
      try { body = await readBody(req); } catch { return; }

      const msgs = Array.isArray(body) ? body : [body];
      await Promise.all(msgs.map(async (msg) => {
        const response = await handleRpc(msg, deps);
        if (response === null) return; // notification
        if (session) {
          _sseWrite(session.res, "message", response);
        }
      }));
      return;
    }

    // ── POST /mcp — Streamable HTTP transport (simple clients) ──────────────
    if (req.method === "POST" && url.pathname === "/mcp") {
      let body;
      try { body = await readBody(req); }
      catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify(rpcErr(null, -32700, "Parse error: " + e.message)));
        return;
      }

      let response;
      if (Array.isArray(body)) {
        const results = await Promise.all(body.map((r) => handleRpc(r, deps)));
        response = results.filter(Boolean);
      } else {
        response = await handleRpc(body, deps);
      }

      if (response === null) { res.writeHead(204); res.end(); return; }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response));
      return;
    }

    // ── 404 ──────────────────────────────────────────────────────────────────
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found. Endpoints: GET /sse, POST /message, POST /mcp" }));
  });

  server.listen(MCP_PORT, MCP_HOST, () => {
    console.log(
      `[MCP] server listening :${MCP_PORT} — ${MCP_TOOLS.length} tools, ` +
      `${MCP_RESOURCES.length} resources, ${MCP_PROMPTS.length} prompts`
    );
  });
  server.on("error", (e) => console.error("[MCP] server error:", e.message));

  return server;
}

module.exports = { startMcpServer };
