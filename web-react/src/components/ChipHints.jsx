import React from "react";

/**
 * Chip quick-reply suggestions — shown below the agent's message bubble.
 * These are OPTIONAL shortcuts; user can always type freely instead.
 */
const SLOT_CHIPS = {
  destination: [
    { label: "北京", value: "去北京" },
    { label: "上海", value: "去上海" },
    { label: "成都", value: "去成都" },
    { label: "西安", value: "去西安" },
    { label: "三亚", value: "去三亚" },
    { label: "杭州", value: "去杭州" },
    { label: "丽江", value: "去丽江" },
    { label: "厦门", value: "去厦门" },
  ],
  duration: [
    { label: "就今天", value: "就今天" },
    { label: "明天", value: "明天" },
    { label: "2天", value: "2天" },
    { label: "3天", value: "3天" },
    { label: "5天", value: "5天" },
    { label: "7天", value: "7天" },
  ],
  budget: [
    { label: "人均100元", value: "人均100元" },
    { label: "人均200元", value: "人均200元" },
    { label: "人均500元", value: "人均500元" },
    { label: "人均1000元", value: "人均1000元" },
    { label: "总预算5000元", value: "总预算5000元" },
    { label: "不限预算", value: "不限预算" },
  ],
};

export default function ChipHints({ slots = [], disabled, onSubmit }) {
  if (!slots.length) return null;

  return (
    <div className="cx-chip-hints" aria-label="快速回复建议">
      {slots.map((slot) => {
        const chips = SLOT_CHIPS[slot];
        if (!chips) return null;
        return (
          <div key={slot} className="cx-hint-row">
            {chips.map((c) => (
              <button
                key={c.value}
                className="cx-hint-chip"
                onClick={() => !disabled && onSubmit(c.value)}
                disabled={disabled}
                type="button"
              >
                {c.label}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
