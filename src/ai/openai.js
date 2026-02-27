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

function setDefaultModel(model) {
  if (model) _defaultModel = String(model).trim();
}

function setDefaultBaseUrl(url) {
  if (url) _defaultBaseUrl = String(url).replace(/\/+$/, "");
}

/**
 * Single OpenAI chat/completions request.
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
    return { ok: false, text: "" };
  }
}

module.exports = { openAIRequest, setDefaultModel, setDefaultBaseUrl };
