import { useEffect, useMemo, useState } from "react";
import { I18nextProvider, useTranslation } from "react-i18next";
import ReactorLogo from "../../components/layout/ReactorLogo.jsx";
import publicI18n, { publicSupportedLanguages } from "../../i18n/publicInstance.js";
import {
  AutoRefreshCountdown,
  HcFlag,
  Heatmap,
  StatusPill,
  SystemStatusBanner,
  formatDateTime
} from "../../components/workbench/healthcheck/healthcheckUi.jsx";
import {
  hcBlocksFromLiveRows,
  hcCalculateSystemStatus,
  hcDateRangeForPreset,
  hcDeriveActiveIncidents,
  hcDownsampleBlocks,
  hcLiveBlocksForRange,
  hcNormalizeLiveResult,
  hcRefreshIntervalSeconds,
  hcSeedCountries,
  hcUptimeForBlocks
} from "../../utils/workbench/healthcheck.js";

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL || ""}/functions/v1/healthcheckPublicStatus`;
const countries = hcSeedCountries();
const ninetyDayRange = hcDateRangeForPreset("90d");

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

function WhatWeMonitor({ t }) {
  const steps = [
    { icon: "bi-box-arrow-in-right", titleKey: "stepLoginTitle", descKey: "stepLoginDesc" },
    { icon: "bi-person-vcard", titleKey: "stepMemberTitle", descKey: "stepMemberDesc" },
    { icon: "bi-box-arrow-right", titleKey: "stepSignoutTitle", descKey: "stepSignoutDesc" }
  ];
  return (
    <section className="stark-public-status-explainer">
      <h2>{t("publicStatus.whatWeMonitorTitle")}</h2>
      <p>{t("publicStatus.whatWeMonitorBody")}</p>
      <div className="stark-public-status-steps">
        {steps.map((step) => (
          <div key={step.titleKey} className="stark-public-status-step">
            <i className={`bi ${step.icon}`} />
            <div>
              <strong>{t(`publicStatus.${step.titleKey}`)}</strong>
              <span>{t(`publicStatus.${step.descKey}`)}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function PublicHealthStatusContent() {
  const { t, i18n } = useTranslation();
  const [state, setState] = useState({ loading: true, enabled: true, rows: [] });
  const [nextRefreshAt, setNextRefreshAt] = useState(() => Date.now() + hcRefreshIntervalSeconds * 1000);

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

      <WhatWeMonitor t={t} />

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
                  <span className="stark-hc-country-row-main"><HcFlag iso2={incident.iso2} code={incident.countryCode} /> <strong>{incident.countryName}</strong></span>
                  <span>{t("healthCheck.failedEndpoint")}: <code>{incident.endpoint}</code></span>
                </div>
              ))}
            </div>
          )}

          <section className="stark-public-status-components">
            {countries.map((country) => {
              const countryBlocks = hcDownsampleBlocks(hcLiveBlocksForRange(blocks, ninetyDayRange.from, ninetyDayRange.to, country.code));
              const uptime = hcUptimeForBlocks(hcLiveBlocksForRange(blocks, ninetyDayRange.from, ninetyDayRange.to, country.code));
              const countryResult = resultByCountry.get(country.code);
              return (
                <div key={country.id} className="stark-public-status-row">
                  <div className="stark-public-status-row-top">
                    <span className="stark-hc-country-row-main"><HcFlag iso2={country.iso2} code={country.code} /> <strong>{country.name}</strong></span>
                    <StatusPill status={countryResult?.status || "unknown"} t={t} />
                  </div>
                  <Heatmap blocks={countryBlocks} t={t} language={i18n.language} compact />
                  <div className="stark-public-status-row-bottom">
                    <span>{t("healthCheck.periodPreset.90d")}</span>
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
