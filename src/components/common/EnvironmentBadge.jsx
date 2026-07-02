import React from "react";
import { environments } from "../../utils/constants.js";

// Pill de ambiente (DEV/QA/BETA/PROD) com cor fixa por ambiente, igual ao
// padrão usado no fluxo de QA para identificar rapidamente onde o item está.
export default function EnvironmentBadge({ env }) {
  const config = environments[env];
  if (!config) return null;
  return (
    <span className="stark-pill" style={{ background: config.background, color: config.color }}>
      {config.label}
    </span>
  );
}
