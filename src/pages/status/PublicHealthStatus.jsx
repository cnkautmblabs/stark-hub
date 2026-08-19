import { useEffect, useMemo, useState } from "react";
import { I18nextProvider, useTranslation } from "react-i18next";
import ReactorLogo from "../../components/layout/ReactorLogo.jsx";
import publicI18n, { publicSupportedLanguages } from "../../i18n/publicInstance.js";
import {
  AutoRefreshCountdown,
  HcExecutionModal,
  HcFlag,
  Heatmap,
  HttpStatusNote,
  PartnerBadge,
  StatusLegendDetails,
  StatusPill,
  SystemStatusBanner,
  formatDateTime
} from "../../components/workbench/healthcheck/healthcheckUi.jsx";
import {
  hcAverageDuration,
  hcBlocksFromLiveRows,
  hcCalculateSystemStatus,
  hcDateRangeForPreset,
  hcDeriveActiveIncidents,
  hcDownsampleBlocks,
  hcLiveBlocksForRange,
  hcNormalizeLiveResult,
  hcPeriodPresets,
  hcRefreshIntervalSeconds,
  hcSeedCountries,
  hcUptimeForBlocks
} from "../../utils/workbench/healthcheck.js";

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL || ""}/functions/v1/healthcheckPublicStatus`;
const countries = hcSeedCountries();
const defaultRange = hcDateRangeForPreset("90d");

async function fetchPublicStatus() {
  try {
    const response = await fetch(`${FUNCTIONS_URL}?environment=PROD`, { cache: "no-store" });
    if (!response.ok) return { enabled: true, rows: [] };
    return await response.json();
  } catch {
    return { enabled: true, rows: [] };
  }
}

function LanguageSelect({ t, i18n }) {
  return (
    <label className="stark-public-status-lang">
      <span className="visually-hidden">{t("publicStatus.languageLabel")}</span>
      <i className="bi bi-globe2" />
      <select value={i18n.resolvedLanguage || i18n.language} onChange={(event) => i18n.changeLanguage(event.target.value)}>
        {publicSupportedLanguages.map((lang) => <option key={lang.code} value={lang.code}>{lang.label}</option>)}
      </select>
    </label>
  );
}

// Minimalista de proposito (feedback do usuario: "nao quero 3 cards") — uma
// unica linha recolhida, uma frase quando aberta, sem grid de cards.
function WhatWeMonitor({ t }) {
  return (
    <details className="stark-public-status-explainer">
      <summary>{t("publicStatus.whatWeMonitorTitle")}</summary>
      <p>{t("publicStatus.whatWeMonitorBody")}</p>
    </details>
  );
}

function PeriodFilter({ preset, from, to, onPreset, onCustom, t }) {
  return (
    <div className="stark-hc-period-filter">
      <div className="stark-hc-period-presets">
        {hcPeriodPresets.filter((entry) => entry !== "custom").map((entry) => (
          <button key={entry} type="button" className={`stark-hc-period-preset ${preset === entry ? "active" : ""}`} onClick={() => onPreset(entry)}>
            {t(`healthCheck.periodPreset.${entry}`)}
          </button>
        ))}
        <button type="button" className={`stark-hc-period-preset ${preset === "custom" ? "active" : ""}`} onClick={() => onPreset("custom")}>
          {t("healthCheck.periodPreset.custom")}
        </button>
      </div>
      {preset === "custom" && (
        <div className="stark-hc-period-custom">
          <label>{t("healthCheck.periodFrom")}<input type="date" value={from} max={to} onChange={(event) => onCustom(event.target.value, to)} /></label>
          <label>{t("healthCheck.periodTo")}<input type="date" value={to} min={from} onChange={(event) => onCustom(from, event.target.value)} /></label>
        </div>
      )}
    </div>
  );
}

function PublicHealthStatusContent() {
  const { t, i18n } = useTranslation();
  const [state, setState] = useState({ loading: true, enabled: true, rows: [] });
  const [nextRefreshAt, setNextRefreshAt] = useState(() => Date.now() + hcRefreshIntervalSeconds * 1000);
  const [periodPreset, setPeriodPreset] = useState("90d");
  const [periodFrom, setPeriodFrom] = useState(defaultRange.from);
  const [periodTo, setPeriodTo] = useState(defaultRange.to);
  const [execution, setExecution] = useState(null); // { block, country } — modal do heatmap

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const payload = await fetchPublicStatus();
      if (cancelled) return;
      setState({ loading: false, enabled: payload.enabled !== false, rows: payload.rows || [] });
      setNextRefreshAt(Date.now() + hcRefreshIntervalSeconds * 1000);
    }
    load();
    const timer = window.setInterval(load, hcRefreshIntervalSeconds * 1000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  function applyPreset(preset) {
    setPeriodPreset(preset);
    if (preset === "custom") return;
    const range = hcDateRangeForPreset(preset);
    setPeriodFrom(range.from);
    setPeriodTo(range.to);
  }

  function applyCustom(from, to) {
    setPeriodPreset("custom");
    if (from) setPeriodFrom(from);
    if (to) setPeriodTo(to);
  }

  const blocks = useMemo(() => hcBlocksFromLiveRows(state.rows), [state.rows]);
  const latestRow = state.rows[0];
  const result = useMemo(() => (latestRow ? hcNormalizeLiveResult(latestRow, countries) : null), [latestRow]);
  const resultByCountry = useMemo(() => {
    const map = new Map();
    (result?.countries || []).forEach((row) => map.set(row.country, row));
    return map;
  }, [result]);
  const systemStatus = result ? hcCalculateSystemStatus(result.countries.map((row) => row.status)) : "unknown";
  const activeIncidents = useMemo(() => (result ? hcDeriveActiveIncidents(result, countries) : []), [result]);
  const lastCheckedLabel = result?.finishedAt
    ? t("healthCheck.lastChecked", { time: formatDateTime(result.finishedAt, i18n.language) })
    : t("publicStatus.noDataYet");

  if (!state.loading && !state.enabled) {
    return (
      <div className="stark-public-status-page stark-public-status-disabled">
        <ReactorLogo size={36} />
        <h1>{t("publicStatus.disabledTitle")}</h1>
        <p>{t("publicStatus.disabledBody")}</p>
      </div>
    );
  }

  return (
    <div className="stark-public-status-page">
      <header className="stark-public-status-header">
        <div className="stark-public-status-brand">
          <ReactorLogo size={28} />
          <div>
            <strong>{t("healthCheck.footerTitle")}</strong>
            <span>{t("pages.healthCheck.subtitle")}</span>
          </div>
        </div>
        <div className="stark-public-status-header-actions">
          <LanguageSelect t={t} i18n={i18n} />
          <span className="stark-public-status-refresh">
            <i className="bi bi-arrow-repeat" /> <AutoRefreshCountdown nextRefreshAt={nextRefreshAt} t={t} />
          </span>
        </div>
      </header>

      <div className="stark-public-status-info-rows">
        <WhatWeMonitor t={t} />
        <StatusLegendDetails t={t} />
      </div>

      {state.loading ? (
        <div className="stark-public-status-loading">{t("common.loading")}</div>
      ) : !result ? (
        <div className="stark-public-status-empty">
          <i className="bi bi-hourglass-split" />
          <p>{t("publicStatus.noDataYet")}</p>
        </div>
      ) : (
        <>
          <SystemStatusBanner status={systemStatus} t={t} lastCheckedLabel={lastCheckedLabel} />

          {activeIncidents.length > 0 && (
            <div className="stark-hc-active-incident" role="alert">
              <div className="stark-hc-active-incident-title">
                <i className="bi bi-exclamation-triangle-fill" />
                <strong>{t("healthCheck.activeIncidentTitle", { count: activeIncidents.length })}</strong>
              </div>
              {activeIncidents.map((incident) => (
                <div key={incident.id} className="stark-hc-active-incident-row">
                  <div className="stark-hc-active-incident-row-top">
                    <span className="stark-hc-country-row-main"><HcFlag iso2={incident.iso2} code={incident.countryCode} /> <strong>{incident.countryName}</strong> <PartnerBadge partner={incident.partner} /></span>
                  </div>
                  <span>{t("healthCheck.failedEndpoint")}: <code>{incident.endpoint}</code></span>
                  <HttpStatusNote httpStatus={incident.httpStatus} t={t} />
                </div>
              ))}
            </div>
          )}

          <PeriodFilter preset={periodPreset} from={periodFrom} to={periodTo} onPreset={applyPreset} onCustom={applyCustom} t={t} />

          <section className="stark-public-status-components">
            {countries.map((country) => {
              const rangeBlocks = hcLiveBlocksForRange(blocks, periodFrom, periodTo, country.code);
              const countryBlocks = hcDownsampleBlocks(rangeBlocks);
              const uptime = hcUptimeForBlocks(rangeBlocks);
              const avgMs = hcAverageDuration(rangeBlocks);
              const countryResult = resultByCountry.get(country.code);
              return (
                <div key={country.id} className="stark-public-status-row">
                  <div className="stark-public-status-row-top">
                    <span className="stark-hc-country-row-main"><HcFlag iso2={country.iso2} code={country.code} /> <strong>{country.name}</strong> <PartnerBadge partner={country.partner} /></span>
                    <StatusPill status={countryResult?.status || "unknown"} t={t} />
                  </div>
                  <Heatmap blocks={countryBlocks} t={t} language={i18n.language} compact onBlockClick={(block) => setExecution({ block, country })} />
                  <div className="stark-public-status-row-bottom">
                    {typeof avgMs === "number" && <span>{t("healthCheck.avgMsLabel", { ms: avgMs })}</span>}
                    <span>{uptime.toFixed(2)}% {t("publicStatus.uptimeLabel")}</span>
                  </div>
                </div>
              );
            })}
          </section>
        </>
      )}

      <footer className="stark-public-status-footer">
        <span>{t("publicStatus.poweredBy")}</span>
      </footer>

      {execution && (
        <HcExecutionModal
          block={execution.block}
          country={execution.country}
          countries={countries}
          t={t}
          language={i18n.language}
          onClose={() => setExecution(null)}
        />
      )}
    </div>
  );
}

export default function PublicHealthStatus() {
  return (
    <I18nextProvider i18n={publicI18n}>
      <PublicHealthStatusContent />
    </I18nextProvider>
  );
}
