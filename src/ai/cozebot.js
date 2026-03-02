"use strict";
/**
 * src/ai/cozebot.js
 * Coze Bot streaming chat client.
 *
 * Calls Coze v3 chat API with stream:true, parses SSE events,
 * and extracts the options_card JSON from the bot's final answer.
 *
 * The bot (COZE_BOT_ID) generates a complete travel plan using real
 * plugins (猫途鹰/TripAdvisor, etc.) and returns our exact card format.
 * Falls back to the OpenAI pipeline when it fails or times out.
 *
 * Exports: callCozeBotStreaming
 */

/**
 * Stream a Coze bot chat and extract options_card JSON from the answer.
 *
 * @param {object}   opts
 * @param {string}   opts.apiKey      Coze PAT token
 * @param {string}   opts.apiBase     e.g. "https://api.coze.cn"
 * @param {string}   opts.botId       COZE_BOT_ID
 * @param {string}   opts.message     Full user message (capped to 800 chars)
 * @param {string}   [opts.userId]    Stable per-user ID (deviceId preferred)
 * @param {function} [opts.onStatus]  (text: string) => void — SSE thinking updates
 * @param {number}   [opts.timeoutMs] Default 50s
 * @returns {Promise<{ok:boolean, card_data:object|null, spoken_text:string}>}
 */
async function callCozeBotStreaming({
  apiKey,
  apiBase = "https://api.coze.cn",
  botId,
  message,
  userId = "crossx_user",
  onStatus,
  timeoutMs = 50000,
}) {
  if (!apiKey || !botId || !message) {
    return { ok: false, card_data: null, spoken_text: "" };
  }

  const endpoint = `${apiBase}/v3/chat`;

  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        bot_id:  botId,
        user_id: String(userId).slice(0, 64),
        stream:  true,
        additional_messages: [{
          role:         "user",
          content:      message.slice(0, 800),
          content_type: "text",
        }],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    console.log("[cozebot] HTTP status:", resp.status, "content-type:", resp.headers.get("content-type"));

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      console.warn("[cozebot] HTTP error:", resp.status, errText.slice(0, 200));
      return { ok: false, card_data: null, spoken_text: "" };
    }

    let answerContent = "";
    let lastStatusAt  = 0;
    let toolCallCount = 0;
    const decoder = new TextDecoder();
    let buffer       = "";
    let currentEvent = ""; // SSE event: field (separate line from data:)

    let chunkCount = 0;
    for await (const chunk of resp.body) {
      chunkCount++;
      buffer += decoder.decode(chunk, { stream: true });
      if (chunkCount <= 2) console.log("[cozebot/raw] chunk", chunkCount, ":", buffer.slice(0, 300));
      const lines = buffer.split("\n");
      buffer = lines.pop(); // keep incomplete line

      for (const line of lines) {
        const trimmed = line.trim();

        // Track SSE event type (comes on its own line before data:)
        if (trimmed.startsWith("event:")) {
          currentEvent = trimmed.slice(6).trim();
          continue;
        }

        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;

        let parsed;
        try { parsed = JSON.parse(payload); } catch { continue; }

        // Coze v3 streaming: event type from SSE event: line; data JSON has type/content directly
        const msgType    = parsed.type    || "";
        const msgContent = parsed.content || "";
        // Debug: log first few events to understand actual format
        if (toolCallCount === 0 && !answerContent) {
          console.log(`[cozebot/debug] event=${currentEvent} type=${msgType} keys=${Object.keys(parsed).join(",")}`);
        }

        // Emit thinking status on tool calls
        if (msgType === "function_call") {
          toolCallCount++;
          const now = Date.now();
          if (onStatus && now - lastStatusAt > 4000) {
            onStatus("\u6b63\u5728\u67e5\u8be2\u5b9e\u65f6\u65c5\u6e38\u8d44\u6e90...");  // 正在查询实时旅游资源...
            lastStatusAt = now;
          }
        }

        // Capture the completed answer message
        if (currentEvent === "conversation.message.completed" && msgType === "answer") {
          answerContent = msgContent;
          console.log("[cozebot] Answer captured, length:", answerContent.length);
        }

        // Abort early on chat failure
        if (currentEvent === "conversation.chat.failed") {
          console.warn("[cozebot] Chat failed:", JSON.stringify(parsed).slice(0, 200));
          return { ok: false, card_data: null, spoken_text: "" };
        }
      }
    }

    if (!answerContent) {
      console.warn("[cozebot] No answer content in bot response");
      return { ok: false, card_data: null, spoken_text: "" };
    }

    // Extract JSON from answer (bot may prefix with text)
    const s = answerContent.indexOf("{");
    const e = answerContent.lastIndexOf("}");
    if (s === -1 || e === -1) {
      console.warn("[cozebot] No JSON found in answer:", answerContent.slice(0, 200));
      return { ok: false, card_data: null, spoken_text: "" };
    }

    let parsed;
    try {
      parsed = JSON.parse(answerContent.slice(s, e + 1));
    } catch (err) {
      console.warn("[cozebot] JSON parse error:", err.message, "— snippet:", answerContent.slice(s, s + 100));
      return { ok: false, card_data: null, spoken_text: "" };
    }

    if (parsed.response_type !== "options_card" || !parsed.card_data) {
      console.warn("[cozebot] Unexpected response_type:", parsed.response_type);
      return { ok: false, card_data: null, spoken_text: "" };
    }

    console.log(`[cozebot] \u2705 options_card OK — dest=${parsed.card_data?.destination} tools=${toolCallCount}`);
    return {
      ok:          true,
      card_data:   parsed.card_data,
      spoken_text: parsed.spoken_text || "",
    };

  } catch (e) {
    if (e.name === "TimeoutError" || e.name === "AbortError") {
      console.warn("[cozebot] Timeout after", timeoutMs, "ms — falling back to pipeline");
    } else {
      console.warn("[cozebot] Error:", e.message);
    }
    return { ok: false, card_data: null, spoken_text: "" };
  }
}

module.exports = { callCozeBotStreaming };
