import React from "react";
import { workItemTypes, defaultWorkItemTypeStyle } from "../../utils/constants.js";

export default function WorkItemTypeBadge({ type }) {
  const config = workItemTypes[type] || defaultWorkItemTypeStyle;
  return (
    <span className="stark-pill stark-pill-outline" style={{ borderColor: config.color, color: config.color, background: config.background }}>
      {type}
    </span>
  );
}
