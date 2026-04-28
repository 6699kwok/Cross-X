import React, { useEffect, useRef } from "react";
import ChatMessage from "./ChatMessage.jsx";
import ThinkingIndicator from "./ThinkingIndicator.jsx";
import ChipHints from "./ChipHints.jsx";
import PlanOptionsCard from "./PlanOptionsCard.jsx";

/**
 * ChatStream — SSE message feed renderer.
 *
 * Decoupled from App.jsx state logic. Receives the message list and
 * thinking state; handles auto-scroll and renders each message type.
 *
 * Message types:
 *   { type: "user",   text }
 *   { type: "agent",  text }
 *   { type: "chips",  slots, disabled }
 *   { type: "plan",   plans, layout_type, destination, spoken_text }
 *
 * Props:
 *   messages     — array of message objects
 *   thinking     — { text, code } | null — current SSE status
 *   language     — "ZH" | "EN"
 *   city         — user's current city (for plan card fallback hero)
 *   onChipSubmit — (text: string) => void
 *   onPlanSelect — (plan, layoutType, destination) => void
 */
export default function ChatStream({
  messages = [],
  thinking  = null,
  language  = "ZH",
  city      = "",
  onChipSubmit,
  onPlanSelect,
}) {
  const feedRef = useRef(null);

  // Auto-scroll on new content
  useEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }, [messages, thinking]);

  return (
    <div className="cx-chat-feed" ref={feedRef}>
      {messages.map((msg) => {
        switch (msg.type) {
          case "user":
            return <ChatMessage key={msg.id} role="user" text={msg.text} />;

          case "agent":
            return <ChatMessage key={msg.id} role="agent" text={msg.text} />;

          case "chips":
            return (
              <ChipHints
                key={msg.id}
                slots={msg.slots}
                language={language}
                disabled={msg.disabled}
                onSubmit={onChipSubmit}
              />
            );

          case "plan":
            return (
              <PlanOptionsCard
                key={msg.id}
                plans={msg.plans}
                layoutType={msg.layout_type}
                destination={msg.destination}
                city={city}
                spokenText={msg.spoken_text}
                onSelect={(plan) =>
                  onPlanSelect?.(plan, msg.layout_type, msg.destination)
                }
              />
            );

          default:
            return null;
        }
      })}

      {thinking && <ThinkingIndicator text={thinking.text} />}
    </div>
  );
}
