import React from "react";

export default function ChatMessage({ role, text }) {
  const isUser = role === "user";
  return (
    <div className={`cx-msg cx-msg--${isUser ? "user" : "agent"}`}>
      <div className="cx-msg-avatar" aria-hidden="true">
        {isUser ? "我" : "✦"}
      </div>
      <div className="cx-msg-bubble">{text}</div>
    </div>
  );
}
