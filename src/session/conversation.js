"use strict";
/**
 * src/session/conversation.js
 * Multi-turn conversation turn storage and context building.
 *
 * Turns are stored inside the session object (sessions are persisted in sessions.json).
 * Max 20 turns per session (FIFO) to bound memory.
 */

const { getSession, setSession } = require("./store");
// Alias: conversation.js uses setSession under the name saveSession
function saveSession(id, data) { return setSession(id, data); }

const MAX_TURNS = 20;

/**
 * Append a conversation turn to the session.
 * @param {string} sessionId
 * @param {{ role: 'user'|'agent', content: string, intent?: object, slots?: object }} turn
 */
function addTurn(sessionId, { role, content, intent = null, slots = null }) {
  const session = getSession(sessionId);
  if (!session) { console.warn("[conversation/addTurn] session not found or expired:", sessionId); return; }

  if (!Array.isArray(session.turns)) session.turns = [];
  session.turns.push({
    role,
    content: String(content || "").slice(0, 2000), // cap at 2000 chars
    intent,
    slots,
    at: new Date().toISOString(),
  });

  // FIFO cap
  if (session.turns.length > MAX_TURNS) {
    session.turns = session.turns.slice(-MAX_TURNS);
  }

  saveSession(sessionId, session);
}

/**
 * Get last N turns for a session.
 * @param {string} sessionId
 * @param {number} limit
 * @returns {object[]}
 */
function getTurns(sessionId, limit = 10) {
  const session = getSession(sessionId);
  if (!session || !Array.isArray(session.turns)) return [];
  return session.turns.slice(-limit);
}

/**
 * Build a multi-turn context prefix string for LLM system prompt injection.
 * @param {object[]} turns
 * @returns {string}
 */
function buildContextPrefix(turns) {
  if (!turns || turns.length === 0) return "";

  const lines = turns.map(t => {
    const speaker = t.role === "user" ? "用户" : "助手";
    return `${speaker}: ${t.content}`;
  });

  return `【对话历史 — 最近${turns.length}轮】\n${lines.join("\n")}\n\n`;
}

module.exports = { addTurn, getTurns, buildContextPrefix };
