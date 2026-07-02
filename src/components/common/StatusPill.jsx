import React from "react";
import { statusConfig, defaultStatusStyle, normalizeStatusKey } from "../../utils/constants.js";

export default function StatusPill({ state }) {
  const config = statusConfig[normalizeStatusKey(state)] || defaultStatusStyle;
  return (
    <span className="stark-pill stark-pill-outline" style={{ borderColor: config.color, color: config.color, background: config.background }}>
      {config.label || state}
    </span>
  );
}
