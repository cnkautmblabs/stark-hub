import { useEffect, useState } from "react";
import { flagUrl } from "../../../utils/constants.js";
import { hcStatusStyle } from "../../../utils/workbench/healthcheck.js";
import { EmptyState } from "../ui/WorkbenchPrimitives.jsx";

// Peças visuais compartilhadas entre o Health Check autenticado
// (HealthCheckWorkbench) e a status page pública (PublicHealthStatus) — um
// único lugar garante que as duas telas nunca desalinham visualmente.

const flagPalette = ["#2563eb", "#16a34a", "#d97706", "#7c3aed", "#0891b2", "#dc2626", "#4f46e5"];

export function colorForCode(code) {
  const value = String(code || "").split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return flagPalette[value % flagPalette.length];
}

export function formatDateTime(value, language) {
  if (!value) return "-";
  try {
    return new Intl.DateTimeFormat(language, {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Sao_Paulo"
    }).format(new Date(value)).replace(".", "");
  } catch {
    return "-";
  }
}

export function formatBlockLabel(block, t, language) {
  if (block.granularity === "day") {
    try {
      const formatted = new Intl.DateTimeFormat(language, { day: "2-digit", month: "short" }).format(new Date(`${block.at}T12:00:00`));
      return `${formatted} · ${t(`healthCheck.status.${block.overall}`)}`;
    } catch {
      return t(`healthCheck.status.${block.overall}`);
    }
  }
  return `${formatDateTime(block.at, language)} · ${t(`healthCheck.status.${block.overall}`)}`;
}

export function formatCountdown(totalSeconds) {
  const clamped = Math.max(0, totalSeconds);
  const minutes = Math.floor(clamped / 60).toString().padStart(2, "0");
  const seconds = Math.floor(clamped % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

// Ticka a cada 1s isolado num componente-folha — se isso vivesse no estado
// do hook/pagina, cada tick re-renderizaria a arvore inteira (heatmaps,
// graficos Recharts) e as barras reanimariam do zero sem parar (o "piscar"
// reportado pelo usuario). Aqui so este texto pequeno re-renderiza.
export function AutoRefreshCountdown({ nextRefreshAt, t }) {
  const [secondsLeft, setSecondsLeft] = useState(() => Math.round((nextRefreshAt - Date.now()) / 1000));

  useEffect(() => {
    setSecondsLeft(Math.round((nextRefreshAt - Date.now()) / 1000));
    const timer = window.setInterval(() => {
      setSecondsLeft(Math.round((nextRefreshAt - Date.now()) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [nextRefreshAt]);

  return <>{t("healthCheck.nextCheckIn", { time: formatCountdown(secondsLeft) })}</>;
}

export function HcFlag({ iso2, code, size = 20 }) {
  const [failed, setFailed] = useState(false);
  if (!iso2 || failed) {
    return <span className="stark-hc-flag fallback" style={{ background: colorForCode(code) }}>{String(code || "?").slice(0, 2)}</span>;
  }
  return <img className="stark-hc-flag" src={flagUrl(iso2, size)} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

export function StatusDot({ status }) {
  const style = hcStatusStyle[status] || hcStatusStyle.unknown;
  return <i className={`stark-hc-dot bi ${style.icon}`} style={{ color: style.color }} aria-hidden="true" />;
}

export function StatusPill({ status, t }) {
  const style = hcStatusStyle[status] || hcStatusStyle.unknown;
  return (
    <span className="stark-hc-status-pill" style={{ color: style.color, background: style.background }}>
      <StatusDot status={status} /> {t(`healthCheck.status.${status}`)}
    </span>
  );
}

export function SystemStatusBanner({ status, t, lastCheckedLabel }) {
  return (
    <div className={`stark-hc-banner ${status}`} role="status" aria-live="polite">
      <StatusDot status={status} />
      <div>
        <strong>{t(`healthCheck.banner.${status}`)}</strong>
        <span>{lastCheckedLabel}</span>
      </div>
    </div>
  );
}

export function Heatmap({ blocks, t, language, compact = false }) {
  if (!blocks.length) return <EmptyState title={t("healthCheck.noHistory")} />;
  return (
    <div className={`stark-hc-heatmap ${compact ? "compact" : ""}`} role="img" aria-label={t("healthCheck.historySubtitle")}>
      {blocks.map((block) => {
        const style = hcStatusStyle[block.overall] || hcStatusStyle.unknown;
        return <span key={block.at} className="stark-hc-heatmap-block" style={{ background: style.color }} title={formatBlockLabel(block, t, language)} />;
      })}
    </div>
  );
}
