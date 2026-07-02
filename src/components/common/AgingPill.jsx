import React from "react";

// Dias desde a última mudança do item. Fica em destaque ("hot") quando o
// item está parado há uma semana ou mais, sinalizando que precisa de atenção.
export default function AgingPill({ updatedAt }) {
  if (!updatedAt) return null;
  const days = Math.max(0, Math.floor((Date.now() - new Date(updatedAt).getTime()) / 86400000));
  const hot = days >= 7;
  return (
    <span className={`stark-aging-pill ${hot ? "hot" : ""}`} title={`Última alteração há ${days} dia(s)`}>
      {days}d
    </span>
  );
}
