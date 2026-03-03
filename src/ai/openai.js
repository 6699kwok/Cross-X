"use strict";
/**
 * src/ai/openai.js
 * OpenAI HTTP client — extracted from server.js
 * 唯一职责：发 OpenAI chat/completions 请求，返回 {ok, text}
 *
 * Uses global fetch (Node 18+) + configurable base URL so OPENAI_BASE_URL
 * is honoured instead of hard-coding api.openai.com.
 */

// ── Module-level config (set once at startup) ─────────────────────────────
let _defaultModel   = "gpt-4o-mini";
let _defaultBaseUrl = "https://api.openai.com/v1";

// ── Retry helper ──────────────────────────────────────────────────────────
/** Returns true for HTTP status codes that are safe to retry. */
function _isRetryable(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

/** Exponential backoff: attempt 0→0ms, 1→1000ms, 2→2000ms */
function _backoffMs(attempt) {
  return attempt * 1000;
}

function setDefaultModel(model) {
  if (model) _defaultModel = String(model).trim();
}

function setDefaultBaseUrl(url) {
  if (url) _defaultBaseUrl = String(url).replace(/\/+$/, "");
}

/**
 * Single OpenAI chat/completions request with automatic retry.
 * Retries up to 2 times on 429 / 5xx with exponential backoff (1s, 2s).
 * Network errors and timeouts are NOT retried (already failed fast).
 * @returns {Promise<{ok: boolean, text: string}>}
 */
async function openAIRequest({
  apiKey,
  model,
  systemPrompt,
  userContent,
  temperature = 0.4,
  maxTokens = 800,
  jsonMode = false,
  timeoutMs = 25000,
  baseUrl,
}) {
  const endpoint = `${baseUrl || _defaultBaseUrl}/chat/completions`;
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user",   content: userContent  },
  ];
  const body = JSON.stringify({
    model: model || _defaultModel,
    messages,
    temperature,
    max_tokens: maxTokens,
    ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
  });

  const MAX_ATTEMPTS = 3; // 1 initial + 2 retries
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, _backoffMs(attempt)));
    }
    try {
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!resp.ok) {
        if (_isRetryable(resp.status) && attempt < MAX_ATTEMPTS - 1) {
          console.warn(`[openAIRequest] HTTP ${resp.status}, retrying (attempt ${attempt + 1})`);
          continue;
        }
        console.warn("[openAIRequest] HTTP error:", resp.status);
        return { ok: false, text: "" };
      }

      const data = await resp.text();
      const parsed = JSON.parse(data);

      if (parsed.error) {
        console.warn("[openAIRequest] API error:", JSON.stringify(parsed.error).slice(0, 200));
        return { ok: false, text: "" };
      }

      const text        = parsed.choices?.[0]?.message?.content || "";
      const finishReason = parsed.choices?.[0]?.finish_reason  || "";
      if (finishReason === "length") {
        console.warn("[openAIRequest] Response truncated (finish_reason=length), maxTokens:", maxTokens);
      }
      return { ok: Boolean(text), text };

    } catch (e) {
      if (e.name === "TimeoutError" || e.name === "AbortError") {
        console.warn("[openAIRequest] timeout after", timeoutMs, "ms");
      } else {
        console.warn("[openAIRequest] req error:", e.message);
      }
      return { ok: false, text: "" }; // network/timeout errors — no retry
    }
  }
  return { ok: false, text: "" };
}

/**
 * Streaming OpenAI chat/completions request with optional function/tool calling.
 *
 * @param {object} opts
 * @param {string}   opts.apiKey
 * @param {string}   [opts.model]
 * @param {string}   [opts.baseUrl]
 * @param {Array}    opts.messages      Full messages array (system+history+user)
 * @param {Array}    [opts.tools]       OpenAI tool definitions
 * @param {number}   [opts.temperature]
 * @param {number}   [opts.maxTokens]
 * @param {number}   [opts.timeoutMs]
 * @param {function} [opts.onChunk]     (text: string) => void — called for each text delta
 * @returns {Promise<{ok: boolean, text: string, tool_calls: Array}>}
 */
async function openAIStream({
  apiKey,
  model,
  baseUrl,
  messages,
  tools,
  temperature = 0.5,
  maxTokens = 2200,
  timeoutMs = 55000,
  jsonMode = false,
  onChunk,
}) {
  const endpoint = `${baseUrl || _defaultBaseUrl}/chat/completions`;
  const body = JSON.stringify({
    model: model || _defaultModel,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: true,
    ...(tools && tools.length ? { tools, tool_choice: "auto" } : {}),
    ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
  });

  const MAX_STREAM_ATTEMPTS = 3;
  let resp;
  for (let attempt = 0; attempt < MAX_STREAM_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, _backoffMs(attempt)));
    }
    try {
      resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${apiKey}`,
          "Accept":        "text/event-stream",
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!resp.ok && _isRetryable(resp.status) && attempt < MAX_STREAM_ATTEMPTS - 1) {
        console.warn(`[openAIStream] HTTP ${resp.status}, retrying (attempt ${attempt + 1})`);
        continue;
      }
      break; // success or non-retryable error
    } catch (e) {
      if (e.name === "TimeoutError" || e.name === "AbortError") {
        console.warn("[openAIStream] timeout after", timeoutMs, "ms");
      } else {
        console.warn("[openAIStream] req error:", e.message);
      }
      return { ok: false, text: "", tool_calls: [] };
    }
  }

  try {
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      console.warn("[openAIStream] HTTP error:", resp.status, errText.slice(0, 200));
      return { ok: false, text: "", tool_calls: [] };
    }

    // Parse SSE stream
    let textAccum = "";
    // tool_calls accumulator: Map<index, {id, name, arguments_raw}>
    const toolCallMap = new Map();

    const decoder = new TextDecoder();
    let buffer = "";

    for await (const chunk of resp.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop(); // keep incomplete line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;

        let parsed;
        try { parsed = JSON.parse(payload); } catch { continue; }

        const delta = parsed?.choices?.[0]?.delta;
        if (!delta) continue;

        // Accumulate text content
        if (delta.content) {
          textAccum += delta.content;
          if (onChunk) {
            try { onChunk(delta.content); } catch {}
          }
        }

        // Accumulate tool_calls (streamed in fragments)
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCallMap.has(idx)) {
              toolCallMap.set(idx, { id: "", name: "", arguments_raw: "" });
            }
            const entry = toolCallMap.get(idx);
            if (tc.id)                       entry.id   += tc.id;
            if (tc.function?.name)           entry.name += tc.function.name;
            if (tc.function?.arguments)      entry.arguments_raw += tc.function.arguments;
          }
        }

        // Check finish reason
        const finishReason = parsed?.choices?.[0]?.finish_reason;
        if (finishReason === "length") {
          console.warn("[openAIStream] Response truncated (finish_reason=length)");
        }
      }
    }

    // Build tool_calls array
    const tool_calls = [];
    for (const [, entry] of [...toolCallMap.entries()].sort((a, b) => a[0] - b[0])) {
      let args = {};
      try { args = JSON.parse(entry.arguments_raw || "{}"); } catch {}
      tool_calls.push({ id: entry.id, name: entry.name, arguments: args });
    }

    return { ok: true, text: textAccum, tool_calls };

  } catch (e) {
    if (e.name === "TimeoutError" || e.name === "AbortError") {
      console.warn("[openAIStream] timeout after", timeoutMs, "ms");
    } else {
      console.warn("[openAIStream] req error:", e.message);
    }
    return { ok: false, text: "", tool_calls: [] };
  }
}

module.exports = { openAIRequest, openAIStream, setDefaultModel, setDefaultBaseUrl };
