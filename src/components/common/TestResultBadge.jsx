import React from "react";
import { testResultTypes } from "../../utils/constants.js";

// Selo de resultado de teste (Pass/Fail/Limitation), usado no histórico de
// evidências e no menu de "Resultado" do card do QA Board.
export default function TestResultBadge({ result }) {
  const config = testResultTypes[result];
  if (!config) return null;
  return (
    <span className="stark-pill stark-pill-outline" style={{ borderColor: config.color, color: config.color, background: config.background }}>
      <span aria-hidden="true">{config.icon}</span> {config.label}
    </span>
  );
}
