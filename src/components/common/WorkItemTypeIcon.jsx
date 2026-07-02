import React from "react";
import { workItemTypes, defaultWorkItemTypeStyle } from "../../utils/constants.js";

// Ícone colorido do tipo de work item (martelo/bug/livro/quebra-cabeça/raio),
// usado ao lado do ID — mesmo padrão do card original (displayWorkItemKey()).
export default function WorkItemTypeIcon({ type, size = 14 }) {
  const config = workItemTypes[type] || defaultWorkItemTypeStyle;
  return <i className={`bi ${config.icon}`} style={{ color: config.color, fontSize: size }} title={type} />;
}
