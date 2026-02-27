"use strict";
/**
 * src/ai/openai.js
 * OpenAI HTTP client — extracted from server.js
 * 唯一职责：发 OpenAI chat/completions 请求，返回 {ok, text}
 */

const https = require("https");

// ── Module-level config (set by configureOpenAI at startup) ──────────────────
let _defaultModel = "gpt-4o-mini";

/**
 * Called by applyOpenAiConfig() after env is loaded.
 * @param {string} model  e.g. "gpt-4o-mini"
 */
function setDefaultModel(model) {
  if (model) _defaultModel = String(model).trim();
}

/**
 * Single OpenAI chat/completions request.
 * @returns {Promise<{ok: boolean, text: string}>}
 */
function openAIRequest({
  apiKey,
  model,
  systemPrompt,
  userContent,
  temperature = 0.4,
  maxTokens = 800,
  jsonMode = false,
  timeoutMs = 25000,
}) {
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];
  const requestBody = JSON.stringify({
    model: model || _defaultModel,
    messages,
    temperature,
    max_tokens: maxTokens,
    ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
  });

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: "api.openai.com",
        path: "/v1/chat/completions",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
          "Content-Length": Buffer.byteLength(requestBody),
        },
      },
      (apiRes) => {
        let data = "";
        apiRes.on("data", (chunk) => (data += chunk));
        apiRes.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              console.warn("[openAIRequest] API error:", JSON.stringify(parsed.error).slice(0, 200));
              resolve({ ok: false, text: "" });
              return;
            }
            const text = parsed.choices?.[0]?.message?.content || "";
            const finishReason = parsed.choices?.[0]?.finish_reason || "";
            if (finishReason === "length") {
              console.warn("[openAIRequest] Response truncated (finish_reason=length), maxTokens:", maxTokens);
            }
            resolve({ ok: Boolean(text), text });
          } catch (e) {
            console.warn("[openAIRequest] JSON parse error:", e.message, "raw:", data.slice(0, 200));
            resolve({ ok: false, text: "" });
          }
        });
      },
    );
    req.on("error", (e) => {
      console.warn("[openAIRequest] req error:", e.message);
      resolve({ ok: false, text: "" });
    });
    req.setTimeout(timeoutMs, () => {
      console.warn("[openAIRequest] timeout after", timeoutMs, "ms");
      req.destroy();
      resolve({ ok: false, text: "" });
    });
    req.write(requestBody);
    req.end();
  });
}

module.exports = { openAIRequest, setDefaultModel };
