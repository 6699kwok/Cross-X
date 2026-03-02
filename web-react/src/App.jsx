import React, { useState, useCallback, useRef, useEffect } from "react";
import Header from "./components/Header.jsx";
import ChatMessage from "./components/ChatMessage.jsx";
import ThinkingIndicator from "./components/ThinkingIndicator.jsx";
import ChipHints from "./components/ChipHints.jsx";
import PlanOptionsCard from "./components/PlanOptionsCard.jsx";
import ChatInput from "./components/ChatInput.jsx";
import DetailModal from "./components/DetailModal.jsx";
import { usePlanStream } from "./hooks/usePlanStream.js";

let msgCounter = 0;
function mkId() { return ++msgCounter; }

function extractDestination(finalEvent, userText) {
  const coze = finalEvent?.coze_data;
  if (coze?.destination) return coze.destination;
  if (coze?.dest_city)   return coze.dest_city;
  const CITIES = ["北京","上海","深圳","广州","成都","重庆","杭州","苏州","西安","南京",
    "三亚","丽江","大理","桂林","张家界","黄山","青岛","厦门","拉萨","哈尔滨","武汉","长沙",
    "昆明","东京","大阪","首尔","曼谷","新加坡","巴黎","伦敦","纽约"];
  for (const c of CITIES) {
    if ((userText || "").includes(c)) return c;
  }
  return null;
}

const QUICK_PROMPTS = [
  "推荐西安美食3天，人均200元",
  "深圳去成都5天，预算8000元",
  "带我去丽江古镇3天，人均300元",
  "附近有什么好吃的",
];

export default function App() {
  const [messages, setMessages] = useState([]);
  const [sessionId, setSessionId] = useState(null);
  const [city, setCity] = useState("深圳");
  const [language, setLanguage] = useState("ZH");
  const [inputText, setInputText] = useState("");
  const [detailTarget, setDetailTarget] = useState(null);
  const [cityPrompt, setCityPrompt] = useState(false);

  const feedRef = useRef(null);
  const { submit, thinking, isLoading } = usePlanStream();

  // Auto-scroll on new messages
  useEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }, [messages, thinking]);

  // Geolocation on mount
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&accept-language=zh`,
            { headers: { "User-Agent": "CrossX-App" } }
          );
          if (!res.ok) return;
          const data = await res.json();
          const raw = data.address?.city || data.address?.county || data.address?.state || "";
          const detected = raw.replace(/市$/, "");
          if (detected) setCity(detected);
        } catch { /* ignore */ }
      },
      () => { setCityPrompt(true); setTimeout(() => setCityPrompt(false), 4000); },
      { timeout: 6000, maximumAge: 5 * 60 * 1000 }
    );
  }, []);

  /**
   * Core submit — used by input box, chip taps, and quick prompts
   */
  const handleSubmit = useCallback((text) => {
    if (!text?.trim() || isLoading) return;
    const trimmed = text.trim();

    // Disable any pending chip rows and add user message
    setMessages((prev) => [
      ...prev.map((m) => m.type === "chips" ? { ...m, disabled: true } : m),
      { id: mkId(), type: "user", text: trimmed },
    ]);
    setInputText("");

    submit(
      { message: trimmed, city, language, sessionId },
      {
        onFinal: (ev) => {
          if (ev.sessionId) setSessionId(ev.sessionId);

          const rt = ev.response_type;
          const spoken = ev.spoken_text || "";
          const dest = extractDestination(ev, trimmed);

          if (rt === "clarify") {
            // 1. Agent speaks naturally (chat bubble)
            // 2. Chip quick-replies below as optional shortcut
            setMessages((prev) => [
              ...prev,
              { id: mkId(), type: "agent", text: spoken },
              { id: mkId(), type: "chips", slots: ev.missing_slots || [], disabled: false },
            ]);
          } else if (rt === "options_card") {
            const plans = ev.card_data?.plans || [];
            setMessages((prev) => [
              ...prev,
              { id: mkId(), type: "plan", spoken_text: spoken, plans,
                layout_type: ev.layout_type || "travel_full", destination: dest },
            ]);
          } else {
            const agentText = spoken ||
              (ev.source === "input-guard"
                ? "⚠️ 您的消息包含不安全内容，已被系统拦截。"
                : "已收到您的消息。");
            setMessages((prev) => [
              ...prev,
              { id: mkId(), type: "agent", text: agentText },
            ]);
          }
        },
        onError: () => {
          setMessages((prev) => [
            ...prev,
            { id: mkId(), type: "agent", text: "网络异常，请稍后重试。" },
          ]);
        },
      }
    );
  }, [isLoading, city, language, sessionId, submit]);

  const handleCityClick = useCallback(() => {
    const c = prompt("请输入您当前所在城市（如：深圳、上海）", city);
    if (c?.trim()) setCity(c.trim().replace(/市$/, ""));
  }, [city]);

  const handleReset = useCallback(() => {
    setMessages([]);
    setSessionId(null);
    setInputText("");
    setDetailTarget(null);
  }, []);

  return (
    <div className="cx-app">
      <Header
        city={city}
        language={language}
        onCityClick={handleCityClick}
        onLanguageChange={setLanguage}
        onNewChat={handleReset}
        hasMessages={messages.length > 0}
      />

      {messages.length === 0 ? (
        <WelcomeScreen city={city} onPromptClick={handleSubmit} />
      ) : (
        <div className="cx-chat-feed" ref={feedRef}>
          {messages.map((msg) => {
            if (msg.type === "user") {
              return <ChatMessage key={msg.id} role="user" text={msg.text} />;
            }
            if (msg.type === "agent") {
              return <ChatMessage key={msg.id} role="agent" text={msg.text} />;
            }
            if (msg.type === "chips") {
              return (
                <ChipHints
                  key={msg.id}
                  slots={msg.slots}
                  language={language}
                  disabled={msg.disabled}
                  onSubmit={handleSubmit}
                />
              );
            }
            if (msg.type === "plan") {
              return (
                <PlanOptionsCard
                  key={msg.id}
                  plans={msg.plans}
                  layoutType={msg.layout_type}
                  destination={msg.destination}
                  city={city}
                  spokenText={msg.spoken_text}
                  onSelect={(plan) =>
                    setDetailTarget({ plan, layoutType: msg.layout_type, destination: msg.destination })
                  }
                />
              );
            }
            return null;
          })}
          {thinking && <ThinkingIndicator text={thinking.text} />}
        </div>
      )}

      <ChatInput
        value={inputText}
        onChange={setInputText}
        onSubmit={handleSubmit}
        disabled={isLoading}
        placeholder={language === "EN" ? "Tell me where you want to go..." : "告诉我你想去哪里，想吃什么..."}
      />

      {detailTarget && (
        <DetailModal
          plan={detailTarget.plan}
          layoutType={detailTarget.layoutType}
          destination={detailTarget.destination}
          onClose={() => setDetailTarget(null)}
        />
      )}

      {cityPrompt && (
        <div className="cx-toast">📍 无法获取位置，请点击顶部城市标签手动设置</div>
      )}
    </div>
  );
}

function WelcomeScreen({ city, onPromptClick }) {
  return (
    <div className="cx-welcome">
      <img
        className="cx-welcome-icon"
        src="/assets/logo-crossx.jpg"
        alt="Cross X"
        onError={(e) => { e.target.style.display = "none"; }}
      />
      <div>
        <div className="cx-welcome-title">你好！我是 Cross X</div>
        <div className="cx-welcome-title" style={{ color: "var(--brand-light)" }}>你的 AI 旅行顾问</div>
      </div>
      <div className="cx-welcome-sub">
        告诉我你想去哪里、想吃什么、预算多少，我来为你定制专属方案。
      </div>
      <div className="cx-quick-prompts">
        {QUICK_PROMPTS.map((p) => (
          <button key={p} className="cx-quick-prompt" onClick={() => onPromptClick(p)} type="button">
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
