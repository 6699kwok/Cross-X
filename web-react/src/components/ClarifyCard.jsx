import React, { useState } from "react";

/**
 * Slot chip options per slot type
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
    { label: "1天", value: "1天" },
    { label: "2天", value: "2天" },
    { label: "3天", value: "3天" },
    { label: "5天", value: "5天" },
    { label: "7天", value: "7天" },
    { label: "10天", value: "10天" },
  ],
  budget: [
    { label: "人均200元", value: "人均200元" },
    { label: "人均500元", value: "人均500元" },
    { label: "人均1000元", value: "人均1000元" },
    { label: "人均2000元", value: "人均2000元" },
    { label: "总预算3000元", value: "总预算3000元" },
    { label: "总预算8000元", value: "总预算8000元" },
    { label: "总预算15000元", value: "总预算15000元" },
  ],
};

const SLOT_LABELS_ZH = {
  destination: "目的地",
  duration:    "行程天数",
  budget:      "旅行预算",
};

const SLOT_LABELS_EN = {
  destination: "Destination",
  duration:    "Trip Duration",
  budget:      "Budget",
};

/**
 * ClarifyCard — renders slot-filling chips
 *
 * Props:
 *   spokenText   — what the agent said
 *   missingSlots — ["destination"] | ["duration","budget"] | ["budget"] etc.
 *   language     — "ZH" | "EN"
 *   onSubmit(text) — called with the text to send
 *   disabled     — true after already submitted
 */
export default function ClarifyCard({ spokenText, missingSlots = [], language = "ZH", onSubmit, disabled }) {
  const slotLabels = language === "EN" ? SLOT_LABELS_EN : SLOT_LABELS_ZH;
  const isDualSlot = missingSlots.length >= 2;

  // For dual-slot mode: track selected value per slot
  const [selected, setSelected] = useState({});

  // Single-slot mode: tap chip → immediate submit
  function handleSingleChip(value) {
    if (disabled) return;
    onSubmit(value);
  }

  // Dual-slot mode: toggle selection, enable confirm when all picked
  function handleDualChip(slot, value) {
    if (disabled) return;
    setSelected((prev) => ({ ...prev, [slot]: value }));
  }

  function handleConfirm() {
    if (disabled) return;
    const parts = missingSlots
      .map((s) => selected[s])
      .filter(Boolean);
    if (parts.length === missingSlots.length) {
      onSubmit(parts.join(" "));
    }
  }

  const allPicked = missingSlots.every((s) => selected[s]);

  return (
    <div className="cx-clarify-card" aria-label="clarify-card">
      <div className="cx-clarify-title">Cross X 想了解</div>
      {spokenText && (
        <div className="cx-clarify-question">{spokenText}</div>
      )}

      {isDualSlot ? (
        // Multi-select: one group per missing slot
        <>
          {missingSlots.map((slot) => {
            const chips = SLOT_CHIPS[slot] || [];
            return (
              <div key={slot} className="cx-slot-group">
                <div className="cx-slot-label">{slotLabels[slot] || slot}</div>
                <div className="cx-chips">
                  {chips.map((c) => (
                    <button
                      key={c.value}
                      className={`cx-chip${selected[slot] === c.value ? " cx-chip--selected" : ""}`}
                      onClick={() => handleDualChip(slot, c.value)}
                      disabled={disabled}
                      type="button"
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          <button
            className="cx-gate-confirm"
            onClick={handleConfirm}
            disabled={!allPicked || disabled}
            type="button"
          >
            生成我的方案 →
          </button>
        </>
      ) : (
        // Single slot: single chip row, tap = immediate
        missingSlots.map((slot) => {
          const chips = SLOT_CHIPS[slot] || [];
          return (
            <div key={slot} className="cx-slot-group">
              {missingSlots.length > 1 && (
                <div className="cx-slot-label">{slotLabels[slot] || slot}</div>
              )}
              <div className="cx-chips">
                {chips.map((c) => (
                  <button
                    key={c.value}
                    className="cx-chip"
                    onClick={() => handleSingleChip(c.value)}
                    disabled={disabled}
                    type="button"
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
