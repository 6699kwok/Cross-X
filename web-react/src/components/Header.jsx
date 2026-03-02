import React from "react";

const LANGUAGES = [
  { value: "ZH", label: "中文" },
  { value: "EN", label: "EN" },
  { value: "JA", label: "日本語" },
  { value: "KO", label: "한국어" },
];

export default function Header({ city, language, onCityClick, onLanguageChange, onNewChat, hasMessages }) {
  return (
    <header className="cx-header">
      <div className="cx-header-brand">
        <img
          className="cx-header-logo"
          src="/assets/logo-crossx.jpg"
          alt="Cross X"
          onError={(e) => { e.target.style.display = "none"; }}
        />
        <div>
          <div className="cx-header-title">Cross X</div>
          <div className="cx-header-sub">AI 旅行顾问</div>
        </div>
      </div>

      <div className="cx-header-actions">
        {hasMessages && (
          <button className="cx-new-chat-btn" onClick={onNewChat} title="新对话" type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13" aria-hidden="true">
              <path d="M12 5v14M5 12h14"/>
            </svg>
            新对话
          </button>
        )}

        <button className="cx-location-pill" onClick={onCityClick} title="点击更改城市">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12" aria-hidden="true">
            <circle cx="12" cy="10" r="3" />
            <path d="M12 2a8 8 0 0 1 8 8c0 5.25-8 13-8 13S4 15.25 4 10a8 8 0 0 1 8-8z" />
          </svg>
          {city}
        </button>

        <select
          className="cx-lang-select"
          value={language}
          onChange={(e) => onLanguageChange(e.target.value)}
          aria-label="语言"
        >
          {LANGUAGES.map((l) => (
            <option key={l.value} value={l.value}>{l.label}</option>
          ))}
        </select>
      </div>
    </header>
  );
}
