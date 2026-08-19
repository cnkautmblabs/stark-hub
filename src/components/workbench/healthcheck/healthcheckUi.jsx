import { useEffect, useState } from "react";
import { flagUrl } from "../../../utils/constants.js";
import { hcHttpStatusExplain, hcNormalizeLiveResult, hcPartnerShortLabel, hcStatusStyle } from "../../../utils/workbench/healthcheck.js";
import { EmptyState, IconButton } from "../ui/WorkbenchPrimitives.jsx";

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
  const durationSuffix = typeof block.durationMs === "number" ? ` · ${block.durationMs} ms` : "";
  if (block.granularity === "day") {
    try {
      const formatted = new Intl.DateTimeFormat(language, { day: "2-digit", month: "short" }).format(new Date(`${block.at}T12:00:00`));
      return `${formatted} · ${t(`healthCheck.status.${block.overall}`)}${durationSuffix}`;
    } catch {
      return t(`healthCheck.status.${block.overall}`);
    }
  }
  return `${formatDateTime(block.at, language)} · ${t(`healthCheck.status.${block.overall}`)}${durationSuffix}${block.row ? ` · ${t("healthCheck.clickForDetails")}` : ""}`;
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

export function PartnerBadge({ partner }) {
  if (!partner) return null;
  return <span className="stark-hc-partner-badge" title={partner}>{hcPartnerShortLabel(partner)}</span>;
}

// Explica a FAIXA do HTTP status sem nunca apontar culpa a um parceiro
// especifico — "não da pra definir se o problema é do parceiro ou não"
// (pedido explicito do usuario). So descreve o que aquela faixa costuma
// significar, no mesmo espirito das mensagens ja usadas no Slack.
export function HttpStatusNote({ httpStatus, t }) {
  const { range } = hcHttpStatusExplain(httpStatus);
  return (
    <p className="stark-hc-status-note">
      <strong>{t(`healthCheck.httpExplain.${range}.label`)}</strong> — {t(`healthCheck.httpExplain.${range}.description`)}
    </p>
  );
}

const statusLegendRanges = ["2xx", "3xx", "4xx", "5xx", "timeout"];

export function StatusLegendDetails({ t }) {
  return (
    <details className="stark-hc-status-legend">
      <summary>{t("healthCheck.statusLegendTitle")}</summary>
      <p className="stark-hc-status-legend-intro">{t("healthCheck.statusLegendIntro")}</p>
      {statusLegendRanges.map((range) => (
        <div key={range} className="stark-hc-status-legend-row">
          <code>{range === "timeout" ? "—" : range}</code>
          <div>
            <strong>{t(`healthCheck.httpExplain.${range}.label`)}</strong>
            <span>{t(`healthCheck.httpExplain.${range}.description`)}</span>
          </div>
        </div>
      ))}
    </details>
  );
}

// onBlockClick e opcional — quando presente, cada bloco que tem uma
// execucao real associada (block.row, ver hcBlocksFromLiveRows) vira
// clicavel e abre o modal de detalhe daquela execucao especifica (brief:
// "se clicar mostrar um modal com os detalhes do resultado").
export function Heatmap({ blocks, t, language, compact = false, onBlockClick }) {
  if (!blocks.length) return <EmptyState title={t("healthCheck.noHistory")} />;
  return (
    <div className={`stark-hc-heatmap ${compact ? "compact" : ""}`} role="img" aria-label={t("healthCheck.historySubtitle")}>
      {blocks.map((block) => {
        const style = hcStatusStyle[block.overall] || hcStatusStyle.unknown;
        const label = formatBlockLabel(block, t, language);
        if (onBlockClick && block.row) {
          return (
            <button
              key={block.at}
              type="button"
              className="stark-hc-heatmap-block clickable"
              style={{ background: style.color }}
              title={label}
              aria-label={label}
              onClick={() => onBlockClick(block)}
            />
          );
        }
        return <span key={block.at} className="stark-hc-heatmap-block" style={{ background: style.color }} title={label} />;
      })}
    </div>
  );
}

// Modal com o detalhe de UMA execucao especifica (aberto ao clicar num
// bloco do heatmap) — mesma lista de steps do drawer de pais "ao vivo",
// mas pra um resultado historico qualquer, nao so o mais recente.
export function HcExecutionModal({ block, country, countries, onClose, t, language }) {
  if (!block?.row) return null;
  const normalized = hcNormalizeLiveResult(block.row, countries);
  const countryResult = normalized.countries.find((entry) => entry.country === country.code);
  return (
    <div className="stark-hc-drawer-overlay" onClick={onClose}>
      <section className="stark-hc-drawer" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={country.name}>
        <header className="stark-hc-drawer-header">
          <span className="stark-hc-country-row-main">
            <HcFlag iso2={country.iso2} code={country.code} size={24} />
            <h3>{country.name}</h3>
            <PartnerBadge partner={country.partner} />
          </span>
          <IconButton title={t("common.close")} onClick={onClose}><i className="bi bi-x-lg" /></IconButton>
        </header>
        <div className="stark-hc-drawer-body">
          <div className="stark-hc-execution-meta">
            <StatusPill status={countryResult?.status || "unknown"} t={t} />
            <div className="stark-hc-execution-meta-right">
              {typeof countryResult?.durationMs === "number" && <strong>{countryResult.durationMs} ms</strong>}
              <span>{formatDateTime(normalized.finishedAt, language)}</span>
            </div>
          </div>
          <h4>{t("healthCheck.detailEndpointsTitle")}</h4>
          <EndpointStepList steps={countryResult?.steps} t={t} />
          {!countryResult && <EmptyState title={t("healthCheck.noHealthcheckData")} />}
        </div>
      </section>
    </div>
  );
}

export function EndpointStepList({ steps, t }) {
  return (
    <div className="stark-hc-endpoint-list">
      {(steps || []).map((step) => {
        const stepStatus = step.ok ? "operational" : (step.httpStatus >= 500 || step.httpStatus === 0 ? "outage" : "degraded");
        return (
          <div key={step.key} className="stark-hc-endpoint-row">
            <div>
              <strong>{step.name}</strong>
              <small>{step.endpoint}</small>
              {!step.ok && <HttpStatusNote httpStatus={step.httpStatus} t={t} />}
            </div>
            <StatusPill status={stepStatus} t={t} />
            <div className="stark-hc-endpoint-metrics">
              <span>HTTP {step.httpStatus}</span>
              <span>{step.durationMs} ms</span>
              <span>{t("healthCheck.attemptsLabel", { count: step.attempts })}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
