import React from "react";

const STYLES = {
  qa: { completed: { bg: "#fff8dc", color: "#8a6900", border: "#f6c344" }, active: { bg: "#dbeafe", color: "#1d4ed8", border: "#60a5fa" } },
  beta: { completed: { bg: "#ecfdf3", color: "#166534", border: "#86efac" }, active: { bg: "#dbeafe", color: "#1d4ed8", border: "#60a5fa" } },
  error: { bg: "#fee2e2", color: "#991b1b", border: "#fecaca" }
};

const LABELS = { qa: "QA", beta: "BETA" };

// Badge de ambiente confirmado por Pipeline — distinto do EnvironmentBadge
// (que reflete o System.State do item): esse aqui mostra o que a Pipeline
// realmente confirmou/está implantando, igual ao "mbaz-pr-env-pill" do
// userscript legado.
export default function PipelineEnvironmentBadge({ status }) {
  if (!status) return null;

  if (status.status === "error") {
    const style = STYLES.error;
    return (
      <span className="stark-pill" style={{ background: style.bg, color: style.color, border: `1px solid ${style.border}` }} title="Última execução de Pipeline falhou ou foi cancelada">
        Error
      </span>
    );
  }

  const style = STYLES[status.kind]?.[status.status];
  if (!style) return null;

  const icon = status.status === "completed" ? "✓" : "⬆";
  const label = LABELS[status.kind] || status.kind;
  const title = `${status.status === "completed" ? "Confirmado" : "Implantando"} via Pipeline ${status.definitionName || ""} · build #${status.buildNumber || "?"}`;

  const content = (
    <span
      className="stark-pill"
      style={{ background: style.bg, color: style.color, border: `1px solid ${style.border}`, cursor: status.url ? "pointer" : "default" }}
      title={title}
    >
      {icon} {label}
    </span>
  );

  if (!status.url) return content;
  return (
    <a href={status.url} target="_blank" rel="noreferrer" className="text-decoration-none">
      {content}
    </a>
  );
}
