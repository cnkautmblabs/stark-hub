import React, { useState } from "react";

// Filtro padronizado de período: Hoje, 7d, 30d, Custom.
// Reutilizado em relatórios executivos de Dev, QA e Gestão.
export default function PeriodFilter({ value, onChange }) {
  const [showCustom, setShowCustom] = useState(value?.preset === "custom");

  function selectPreset(preset) {
    setShowCustom(preset === "custom");
    const today = new Date();
    if (preset === "today") {
      onChange({ preset, from: today, to: today });
    } else if (preset === "7d") {
      const from = new Date(today);
      from.setDate(from.getDate() - 6);
      onChange({ preset, from, to: today });
    } else if (preset === "30d") {
      const from = new Date(today);
      from.setDate(from.getDate() - 29);
      onChange({ preset, from, to: today });
    } else {
      onChange({ preset: "custom", from: value?.from || today, to: value?.to || today });
    }
  }

  return (
    <div className="d-flex align-items-center gap-2 flex-wrap">
      {["today", "7d", "30d", "custom"].map((preset) => (
        <button
          key={preset}
          type="button"
          className={`btn btn-sm ${value?.preset === preset ? "btn-primary" : "btn-outline-secondary"}`}
          onClick={() => selectPreset(preset)}
        >
          {{ today: "Hoje", "7d": "7 dias", "30d": "30 dias", custom: "Custom" }[preset]}
        </button>
      ))}
      {showCustom && (
        <>
          <input
            type="date"
            className="form-control form-control-sm w-auto"
            value={toInputDate(value?.from)}
            onChange={(e) => onChange({ ...value, preset: "custom", from: new Date(e.target.value) })}
          />
          <span className="text-muted small">até</span>
          <input
            type="date"
            className="form-control form-control-sm w-auto"
            value={toInputDate(value?.to)}
            onChange={(e) => onChange({ ...value, preset: "custom", to: new Date(e.target.value) })}
          />
        </>
      )}
    </div>
  );
}

function toInputDate(date) {
  if (!date) return "";
  const d = new Date(date);
  return d.toISOString().slice(0, 10);
}
