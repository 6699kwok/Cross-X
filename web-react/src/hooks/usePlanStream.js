import { useState, useCallback, useRef } from "react";

/**
 * usePlanStream — SSE streaming hook for /api/plan/coze
 *
 * Returns:
 *   submit(payload, handlers) — starts a streaming request
 *   thinking {text, code} — current thinking status
 *   isLoading — true while streaming
 *   abort() — cancel in-flight request
 */
export function usePlanStream() {
  const [thinking, setThinking] = useState(null); // { text, code }
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef(null);

  const abort = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsLoading(false);
    setThinking(null);
  }, []);

  /**
   * submit({ message, city, language, sessionId? }, { onStatus, onFinal })
   */
  const submit = useCallback(async (payload, handlers = {}) => {
    // Cancel any existing request
    if (abortRef.current) abortRef.current.abort();

    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setThinking({ text: "核心方案精算中...", code: "init" });

    try {
      const res = await fetch("/api/plan/coze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: payload.message,
          city: payload.city || "深圳",
          language: payload.language || "ZH",
          ...(payload.sessionId ? { sessionId: payload.sessionId } : {}),
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop(); // keep partial line

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          try {
            const ev = JSON.parse(line.slice(5).trim());

            if (ev.type === "status" || ev.type === "thinking") {
              const text = ev.text || ev.message || "";
              setThinking({ text, code: ev.code || ev.type });
              handlers.onStatus?.(ev);
            } else if (ev.type === "final") {
              setThinking(null);
              setIsLoading(false);
              abortRef.current = null;
              handlers.onFinal?.(ev);
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch (err) {
      if (err.name === "AbortError") return;
      console.error("[usePlanStream] error:", err);
      handlers.onError?.(err);
    } finally {
      setIsLoading(false);
      setThinking(null);
    }
  }, []);

  return { submit, thinking, isLoading, abort };
}
