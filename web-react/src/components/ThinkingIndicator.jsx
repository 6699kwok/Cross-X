import React from "react";

export default function ThinkingIndicator({ text }) {
  return (
    <div className="cx-thinking" role="status" aria-live="polite">
      <div className="cx-thinking-dots" aria-hidden="true">
        <span className="cx-thinking-dot" />
        <span className="cx-thinking-dot" />
        <span className="cx-thinking-dot" />
      </div>
      <span>{text || "思考中..."}</span>
    </div>
  );
}
