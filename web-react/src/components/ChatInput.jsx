import React, { useRef, useEffect, useCallback } from "react";

/**
 * ChatInput — auto-growing textarea with send button
 *
 * Props:
 *   value, onChange
 *   onSubmit(text) — called on Enter or send button
 *   disabled — true while loading
 *   placeholder
 */
export default function ChatInput({ value, onChange, onSubmit, disabled, placeholder }) {
  const textareaRef = useRef(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }, [value]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && value.trim()) onSubmit(value.trim());
    }
  }, [disabled, value, onSubmit]);

  const handleSend = useCallback(() => {
    if (!disabled && value.trim()) onSubmit(value.trim());
  }, [disabled, value, onSubmit]);

  return (
    <div className="cx-input-area">
      <div className="cx-input-row">
        <textarea
          ref={textareaRef}
          className="cx-textarea"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || "告诉我你想去哪里..."}
          rows={1}
          maxLength={500}
          disabled={disabled}
          aria-label="发送消息"
        />
        <button
          className="cx-send-btn"
          onClick={handleSend}
          disabled={disabled || !value.trim()}
          aria-label="发送"
          type="button"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="16" height="16" aria-hidden="true">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
