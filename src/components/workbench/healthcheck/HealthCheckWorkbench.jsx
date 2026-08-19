import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useAuth } from "../../../contexts/AuthContext.jsx";
import { useHealthcheck } from "../../../hooks/useHealthcheck.js";
import { flagUrl, hasManagementAccess } from "../../../utils/constants.js";
import {
  hcEnvironments,
  hcPeriodPresets,
  hcScenarios,
  hcStatusOrder
} from "../../../utils/workbench/healthcheck.js";
import { Button, EmptyState, IconButton, InfoTooltip, RechartsTooltip, WorkbenchHeader } from "../ui/WorkbenchPrimitives.jsx";
import {
  AutoRefreshCountdown,
  HcFlag,
  Heatmap,
  StatusDot,
  StatusPill,
  SystemStatusBanner,
  formatDateTime
} from "./healthcheckUi.jsx";

function PeriodFilter({ hc, t }) {
  return (
    <div className="stark-hc-period-filter">
      <div className="stark-hc-period-presets">
        {hcPeriodPresets.filter((preset) => preset !== "custom").map((preset) => (
          <button key={preset} type="button" className={`stark-hc-period-preset ${hc.periodPreset === preset ? "active" : ""}`} onClick={() => hc.applyPeriodPreset(preset)}>
            {t(`healthCheck.periodPreset.${preset}`)}
          </button>
        ))}
        <button type="button" className={`stark-hc-period-preset ${hc.periodPreset === "custom" ? "active" : ""}`} onClick={() => hc.applyPeriodPreset("custom")}>
          {t("healthCheck.periodPreset.custom")}
        </button>
      </div>
      {hc.periodPreset === "custom" && (
        <div className="stark-hc-period-custom">
          <label>{t("healthCheck.periodFrom")}<input type="date" value={hc.periodFrom} max={hc.periodTo} onChange={(event) => hc.setCustomPeriod(event.target.value, null)} /></label>
          <label>{t("healthCheck.periodTo")}<input type="date" value={hc.periodTo} min={hc.periodFrom} onChange={(event) => hc.setCustomPeriod(null, event.target.value)} /></label>
        </div>
      )}
    </div>
  );
}

function CountryRow({ country, countryResult, t, onOpen }) {
  const status = countryResult?.status || "unknown";
  const durationMs = countryResult?.durationMs;
  return (
    <button type="button" className="stark-hc-country-row" onClick={() => onOpen(country)}>
      <span className="stark-hc-country-row-main">
        <HcFlag iso2={country.iso2} code={country.code} />
        <span className="stark-hc-country-name">{country.name}</span>
      </span>
      <span className="stark-hc-country-row-meta">
        {typeof durationMs === "number" && <small>{durationMs} ms</small>}
        <StatusPill status={status} t={t} />
      </span>
    </button>
  );
}

function CountryDetailDrawer({ country, countryResult, t, language, onClose }) {
  if (!country) return null;
  const status = countryResult?.status || "unknown";
  return (
    <div className="stark-hc-drawer-overlay" onClick={onClose}>
      <section className="stark-hc-drawer" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={country.name}>
        <header className="stark-hc-drawer-header">
          <span className="stark-hc-country-row-main">
            <HcFlag iso2={country.iso2} code={country.code} size={24} />
            <h3>{country.name}</h3>
          </span>
          <IconButton title={t("common.close")} onClick={onClose}><i className="bi bi-x-lg" /></IconButton>
        </header>
        <div className="stark-hc-drawer-body">
          <StatusPill status={status} t={t} />
          <dl className="stark-hc-drawer-links">
            <div><dt>{t("healthCheck.detailBffLabel")}</dt><dd>{country.bffUrl ? <a href={country.bffUrl} target="_blank" rel="noreferrer">{country.bffUrl}</a> : "-"}</dd></div>
            <div><dt>{t("healthCheck.detailWebLabel")}</dt><dd>{country.webUrl ? <a href={country.webUrl} target="_blank" rel="noreferrer">{country.webUrl}</a> : "-"}</dd></div>
          </dl>
          <h4>{t("healthCheck.detailEndpointsTitle")}</h4>
          <div className="stark-hc-endpoint-list">
            {(countryResult?.steps || []).map((step) => {
              const stepStatus = step.ok ? "operational" : (step.httpStatus >= 500 || step.httpStatus === 0 ? "outage" : "degraded");
              return (
                <div key={step.key} className="stark-hc-endpoint-row">
                  <div>
                    <strong>{step.name}</strong>
                    <small>{step.endpoint}</small>
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
            {!countryResult && <EmptyState title={t("healthCheck.noHealthcheckData")} />}
          </div>
        </div>
      </section>
    </div>
  );
}

function ManageCountriesPanel({ hc, t, onClose }) {
  const [editing, setEditing] = useState(null); // country object or "new"
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [form, setForm] = useState({ name: "", code: "", iso2: "", webUrl: "", bffUrl: "", active: true });

  function startEdit(country) {
    setEditing(country.id);
    setForm({ name: country.name, code: country.code, iso2: country.iso2, webUrl: country.webUrl, bffUrl: country.bffUrl, active: country.active });
  }

  function startNew() {
    setEditing("new");
    setForm({ name: "", code: "", iso2: "", webUrl: "", bffUrl: "", active: true });
  }

  function cancelEdit() {
    setEditing(null);
  }

  function save() {
    if (!form.name.trim() || !form.code.trim()) return;
    if (editing === "new") hc.addCountry(form);
    else hc.updateCountry(editing, form);
    setEditing(null);
  }

  const deleteTarget = confirmDeleteId ? hc.countries.find((country) => country.id === confirmDeleteId) : null;

  return (
    <div className="stark-hc-drawer-overlay" onClick={onClose}>
      <section className="stark-hc-drawer wide" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={t("healthCheck.manageCountriesTitle")}>
        <header className="stark-hc-drawer-header">
          <h3>{t("healthCheck.manageCountriesTitle")}</h3>
          <IconButton title={t("common.close")} onClick={onClose}><i className="bi bi-x-lg" /></IconButton>
        </header>
        <div className="stark-hc-drawer-body">
          <p className="stark-hc-muted">{t("healthCheck.manageCountriesSubtitle")}</p>
          <div className="stark-hc-admin-table-wrap">
            <table className="stark-hc-admin-table">
              <thead>
                <tr>
                  <th>{t("healthCheck.fieldName")}</th>
                  <th>{t("healthCheck.fieldCode")}</th>
                  <th>{t("healthCheck.fieldActive")}</th>
                  <th>{t("healthCheck.maintenanceLabel")}</th>
                  <th aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {hc.countries.map((country) => (
                  <tr key={country.id}>
                    <td><span className="stark-hc-admin-name-cell"><HcFlag iso2={country.iso2} code={country.code} size={16} /> {country.name}</span></td>
                    <td>{country.code}</td>
                    <td>
                      <button type="button" className={`stark-hc-toggle ${country.active ? "on" : ""}`} onClick={() => hc.toggleCountryActive(country.id)} aria-pressed={country.active}>
                        {country.active ? t("common.on") : t("common.off")}
                      </button>
                    </td>
                    <td>
                      <button type="button" className={`stark-hc-toggle ${country.maintenance ? "on" : ""}`} onClick={() => hc.toggleCountryMaintenance(country.id)} aria-pressed={country.maintenance}>
                        {country.maintenance ? t("common.on") : t("common.off")}
                      </button>
                    </td>
                    <td>
                      <span className="stark-hc-admin-actions">
                        <IconButton title={t("healthCheck.editCountryTitle")} onClick={() => startEdit(country)}><i className="bi bi-pencil" /></IconButton>
                        <IconButton title={t("healthCheck.deleteButton")} onClick={() => setConfirmDeleteId(country.id)}><i className="bi bi-trash" /></IconButton>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!hc.countries.length && <EmptyState title={t("healthCheck.noCountries")}>{t("healthCheck.noCountriesBody")}</EmptyState>}
          </div>

          {editing ? (
            <div className="stark-hc-country-form">
              <h4>{editing === "new" ? t("healthCheck.addCountryTitle") : t("healthCheck.editCountryTitle")}</h4>
              <div className="stark-hc-form-grid">
                <label>{t("healthCheck.fieldName")}<input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label>
                <label>{t("healthCheck.fieldCode")}<input value={form.code} maxLength={3} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value.toUpperCase() }))} /></label>
                <label>{t("healthCheck.fieldFlag")}<input value={form.iso2} maxLength={2} placeholder="co" onChange={(event) => setForm((current) => ({ ...current, iso2: event.target.value.toLowerCase() }))} /></label>
                <label>{t("healthCheck.fieldWebUrl")}<input value={form.webUrl} onChange={(event) => setForm((current) => ({ ...current, webUrl: event.target.value }))} /></label>
                <label>{t("healthCheck.fieldBffUrl")}<input value={form.bffUrl} onChange={(event) => setForm((current) => ({ ...current, bffUrl: event.target.value }))} /></label>
                <label className="stark-hc-form-check"><input type="checkbox" checked={form.active} onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))} /> {t("healthCheck.fieldActive")}</label>
              </div>
              <div className="stark-hc-form-actions">
                <Button onClick={cancelEdit}>{t("healthCheck.cancelButton")}</Button>
                <Button tone="primary" onClick={save} disabled={!form.name.trim() || !form.code.trim()}>{t("healthCheck.saveButton")}</Button>
              </div>
            </div>
          ) : (
            <Button tone="primary" onClick={startNew}><i className="bi bi-plus-lg" /> {t("healthCheck.addCountryButton")}</Button>
          )}

          {deleteTarget && (
            <div className="stark-hc-confirm">
              <p><strong>{t("healthCheck.deleteConfirmTitle", { name: deleteTarget.name })}</strong></p>
              <p className="stark-hc-muted">{t("healthCheck.deleteConfirmBody")}</p>
              <div className="stark-hc-form-actions">
                <Button onClick={() => setConfirmDeleteId(null)}>{t("healthCheck.cancelButton")}</Button>
                <Button tone="danger" onClick={() => { hc.removeCountry(deleteTarget.id); setConfirmDeleteId(null); }}>{t("healthCheck.deleteButton")}</Button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

// Tick de eixo Y com bandeira — mesmo padrao do CountryFlagAxisTick
// compartilhado (WorkbenchPrimitives), mas lendo iso2 da lista de paises
// DESTE modulo (cadastro dinamico do Health Check), nao do dicionario
// estatico global de paises do resto do app.
function HcCountryAxisTick({ x, y, payload, countries, width = 46 }) {
  const code = String(payload?.value ?? "");
  const country = (countries || []).find((entry) => entry.code === code);
  return (
    <g transform={`translate(${x},${y})`}>
      <title>{country?.name || code}</title>
      {country?.iso2 && <image href={flagUrl(country.iso2, 20)} x={-width} y={-7} width={16} height={11} />}
      <text x={-width + 22} y={0} dy={4} textAnchor="start" fontSize={11} fill="var(--starkMuted)">{code}</text>
    </g>
  );
}

function uptimeBarColor(value) {
  if (value >= 99.9) return "#16a34a";
  if (value >= 99) return "#d97706";
  return "#dc2626";
}

function DashboardCharts({ hc, t }) {
  // Memoizado nas dependencias reais (nao recriar o array a cada render) —
  // a pagina re-renderiza toda vez que o countdown do proximo refresh muda
  // de contexto (ex. troca de ambiente), e um array novo a cada render fazia
  // o Recharts tratar como "dado novo" e reanimar as barras do zero.
  const uptimeData = useMemo(() => hc.countries
    .filter((country) => country.active)
    .map((country) => ({ code: country.code, uptime: hc.periodUptimeByCountry[country.code] ?? 100 }))
    .sort((a, b) => a.uptime - b.uptime), [hc.countries, hc.periodUptimeByCountry]);

  const latencyData = useMemo(() => hc.countries
    .filter((country) => country.active)
    .map((country) => {
      const row = (hc.result?.countries || []).find((entry) => entry.country === country.code);
      return { code: country.code, latency: row?.durationMs ?? 0 };
    }), [hc.countries, hc.result]);

  return (
    <div className="stark-hc-dashboard-grid">
      <section className="stark-hc-card">
        <header><strong>{t("healthCheck.chartUptimeTitle")}</strong><small>{t("healthCheck.chartUptimeSubtitle")}</small></header>
        {uptimeData.length ? (
          <ResponsiveContainer width="100%" height={Math.max(120, uptimeData.length * 34)}>
            <BarChart data={uptimeData} layout="vertical" margin={{ top: 4, right: 34, bottom: 4, left: 4 }}>
              <XAxis type="number" domain={[Math.min(95, ...uptimeData.map((row) => row.uptime)), 100]} hide />
              <YAxis type="category" dataKey="code" width={54} tick={<HcCountryAxisTick countries={hc.countries} width={48} />} axisLine={false} tickLine={false} />
              <Tooltip content={<RechartsTooltip />} cursor={{ fill: "var(--starkSurfaceAlt)" }} />
              <Bar dataKey="uptime" name={t("healthCheck.uptimeTitle")} radius={[0, 6, 6, 0]} barSize={12} isAnimationActive={false}>
                {uptimeData.map((row) => <Cell key={row.code} fill={uptimeBarColor(row.uptime)} />)}
                <LabelList dataKey="uptime" position="right" formatter={(value) => `${value.toFixed(2)}%`} style={{ fill: "var(--starkMuted)", fontSize: 11 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : <EmptyState title={t("healthCheck.noCountries")} />}
      </section>

      <section className="stark-hc-card">
        <header><strong>{t("healthCheck.chartLatencyTitle")}</strong><small>{t("healthCheck.chartLatencySubtitle")}</small></header>
        {latencyData.length ? (
          <ResponsiveContainer width="100%" height={Math.max(120, latencyData.length * 34)}>
            <BarChart data={latencyData} layout="vertical" margin={{ top: 4, right: 34, bottom: 4, left: 4 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="code" width={54} tick={<HcCountryAxisTick countries={hc.countries} width={48} />} axisLine={false} tickLine={false} />
              <Tooltip content={<RechartsTooltip />} cursor={{ fill: "var(--starkSurfaceAlt)" }} />
              <Bar dataKey="latency" name="ms" fill="#0ea5e9" radius={[0, 6, 6, 0]} barSize={12} isAnimationActive={false}>
                <LabelList dataKey="latency" position="right" formatter={(value) => `${value} ms`} style={{ fill: "var(--starkMuted)", fontSize: 11 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : <EmptyState title={t("healthCheck.noCountries")} />}
      </section>
    </div>
  );
}

export function HealthCheckWorkbench() {
  const { t, i18n } = useTranslation();
  const { profile, demoMode } = useAuth();
  const hc = useHealthcheck();
  const [statusFilter, setStatusFilter] = useState("all");
  const [openCountry, setOpenCountry] = useState(null);
  const [manageOpen, setManageOpen] = useState(false);
  const canManage = hasManagementAccess(profile?.accessLevel, profile?.isAdmin);

  const resultByCountry = useMemo(() => {
    const map = new Map();
    (hc.result?.countries || []).forEach((row) => map.set(row.country, row));
    return map;
  }, [hc.result]);

  const visibleCountries = useMemo(() => {
    return hc.countries.filter((country) => {
      if (statusFilter === "all") return true;
      const status = country.maintenance ? "maintenance" : (resultByCountry.get(country.code)?.status || "unknown");
      return status === statusFilter;
    });
  }, [hc.countries, statusFilter, resultByCountry]);

  const lastCheckedLabel = hc.result?.finishedAt
    ? t("healthCheck.lastChecked", { time: formatDateTime(hc.result.finishedAt, i18n.language) })
    : t("common.loading");

  return (
    <section className="mbw-page stark-hc-page">
      <WorkbenchHeader
        kicker={t("healthCheck.kicker")}
        title={t("pages.healthCheck.title")}
        subtitle={t("pages.healthCheck.subtitle")}
        demoMode={demoMode}
        actions={
          <>
            {canManage && <Button onClick={() => setManageOpen(true)}><i className="bi bi-globe2" /> {t("healthCheck.manageCountriesButton")}</Button>}
            <Button onClick={hc.refresh}><i className={`bi bi-arrow-clockwise ${hc.loading ? "mbw-spin" : ""}`} /> {t("common.refresh")}</Button>
          </>
        }
      />

      <div className="stark-hc-toolbar">
        <SystemStatusBanner status={hc.systemStatus} t={t} lastCheckedLabel={lastCheckedLabel} />
        <div className="stark-hc-toolbar-controls">
          <label className="stark-hc-select">
            <span>{t("healthCheck.environmentLabel")}</span>
            <select value={hc.environment} onChange={(event) => hc.setEnvironment(event.target.value)}>
              {hcEnvironments.map((env) => <option key={env} value={env}>{env}</option>)}
            </select>
          </label>
          {hc.hasLiveData ? (
            <span className="stark-hc-live-badge" title={t("healthCheck.liveDataHelp")}>
              <i className="bi bi-broadcast" /> {t("healthCheck.liveDataLabel")}
            </span>
          ) : (
            <label className="stark-hc-select demo">
              <span>
                <span className="stark-badge-demo">demo</span> {t("healthCheck.demoScenarioLabel")}
                <InfoTooltip text={t("healthCheck.demoScenarioHelp")} />
              </span>
              <select value={hc.scenario} onChange={(event) => hc.setScenario(event.target.value)}>
                {hcScenarios.map((scenario) => <option key={scenario} value={scenario}>{t(`healthCheck.demoScenario.${scenario}`)}</option>)}
              </select>
            </label>
          )}
          <button type="button" className={`stark-hc-autorefresh ${hc.autoRefresh ? "on" : ""}`} onClick={() => hc.setAutoRefresh((value) => !value)} aria-pressed={hc.autoRefresh}>
            <i className={`bi ${hc.autoRefresh ? "bi-toggle-on" : "bi-toggle-off"}`} />
            {hc.autoRefresh ? <AutoRefreshCountdown nextRefreshAt={hc.nextRefreshAt} t={t} /> : t("healthCheck.autoRefreshOff")}
          </button>
        </div>
      </div>

      {hc.activeIncidents.length > 0 && (
        <div className="stark-hc-active-incident" role="alert">
          <div className="stark-hc-active-incident-title">
            <i className="bi bi-exclamation-triangle-fill" />
            <strong>{t("healthCheck.activeIncidentTitle", { count: hc.activeIncidents.length })}</strong>
          </div>
          {hc.activeIncidents.map((incident) => (
            <div key={incident.id} className="stark-hc-active-incident-row">
              <span className="stark-hc-country-row-main"><HcFlag iso2={incident.iso2} code={incident.countryCode} /> <strong>{incident.countryName}</strong></span>
              <span>{t("healthCheck.failedEndpoint")}: <code>{incident.endpoint}</code></span>
              <span>{t("healthCheck.httpLabel")}: {incident.httpStatus || t("healthCheck.errorLabel")}</span>
              <span className="stark-hc-muted">{t("healthCheck.startedLabel")} {formatDateTime(incident.startedAt, i18n.language)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="stark-hc-filters" role="group" aria-label={t("healthCheck.filterAll")}>
        {["all", ...hcStatusOrder].map((key) => (
          <button key={key} type="button" className={`stark-hc-filter-chip ${statusFilter === key ? "active" : ""}`} onClick={() => setStatusFilter(key)}>
            {key === "all" ? t("healthCheck.filterAll") : t(`healthCheck.status.${key}`)}
          </button>
        ))}
      </div>

      <section className="stark-hc-card">
        <header><strong>{t("healthCheck.countriesTitle")}</strong><small>{t("healthCheck.countriesSubtitle")}</small></header>
        <div className="stark-hc-country-list">
          {visibleCountries.map((country) => (
            <CountryRow
              key={country.id}
              country={country}
              countryResult={country.maintenance ? { status: "maintenance" } : resultByCountry.get(country.code)}
              t={t}
              onOpen={setOpenCountry}
            />
          ))}
          {!visibleCountries.length && <EmptyState title={t("healthCheck.noCountries")}>{t("healthCheck.noCountriesBody")}</EmptyState>}
        </div>
      </section>

      <section className="stark-hc-card">
        <header><strong>{t("healthCheck.dashboardTitle")}</strong><small>{t("healthCheck.dashboardSubtitle")}</small></header>
        <DashboardCharts hc={hc} t={t} />
      </section>

      <section className="stark-hc-card">
        <header><strong>{t("healthCheck.historyTitle")}</strong><small>{t("healthCheck.historyPerCountrySubtitle")}</small></header>
        <PeriodFilter hc={hc} t={t} />
        <div className="stark-hc-history-countries">
          <div className="stark-hc-history-country-row overall">
            <span className="stark-hc-history-country-label">{t("healthCheck.overallLabel")}</span>
            <Heatmap blocks={hc.periodBlocksByCountry.overall || []} t={t} language={i18n.language} compact />
            <strong>{(hc.periodUptimeByCountry.overall ?? 100).toFixed(2)}%</strong>
          </div>
          {hc.countries.map((country) => (
            <div key={country.id} className="stark-hc-history-country-row">
              <span className="stark-hc-history-country-label"><HcFlag iso2={country.iso2} code={country.code} /> <b>{country.name}</b></span>
              <Heatmap blocks={hc.periodBlocksByCountry[country.code] || []} t={t} language={i18n.language} compact />
              <strong>{(hc.periodUptimeByCountry[country.code] ?? 100).toFixed(2)}%</strong>
            </div>
          ))}
          {!hc.countries.length && <EmptyState title={t("healthCheck.noCountries")}>{t("healthCheck.noCountriesBody")}</EmptyState>}
        </div>
      </section>

      <section className="stark-hc-card">
        <header><strong>{t("healthCheck.uptimeTitle")}</strong></header>
        <div className="stark-hc-uptime-grid">
          <div><span>{t("healthCheck.uptime24h")}</span><strong>{hc.uptime.h24.toFixed(2)}%</strong></div>
          <div><span>{t("healthCheck.uptime7d")}</span><strong>{hc.uptime.d7.toFixed(2)}%</strong></div>
          <div><span>{t("healthCheck.uptime30d")}</span><strong>{hc.uptime.d30.toFixed(2)}%</strong></div>
          <div><span>{t("healthCheck.uptime90d")}</span><strong>{hc.uptime.d90.toFixed(2)}%</strong></div>
        </div>
      </section>

      <section className="stark-hc-card">
        <header><strong>{t("healthCheck.incidentsTitle")}</strong></header>
        {hc.incidentLog.length ? (
          <div className="stark-hc-incident-log">
            {hc.incidentLog.map((incident) => (
              <div key={incident.id} className="stark-hc-incident-log-row">
                <StatusDot status="operational" />
                <span><strong>{incident.countryName}</strong> {t("healthCheck.resolvedLabel")}</span>
                <span className="stark-hc-muted">{formatDateTime(incident.resolvedAt, i18n.language)}</span>
              </div>
            ))}
          </div>
        ) : <EmptyState title={t("healthCheck.noIncidents")} />}
      </section>

      <footer className="stark-hc-footer">
        <strong>{t("healthCheck.footerTitle")}</strong>
        <span>{t("healthCheck.footerAutomated")}</span>
        <span>{lastCheckedLabel}</span>
      </footer>

      {openCountry && (
        <CountryDetailDrawer
          country={openCountry}
          countryResult={openCountry.maintenance ? { status: "maintenance" } : resultByCountry.get(openCountry.code)}
          t={t}
          language={i18n.language}
          onClose={() => setOpenCountry(null)}
        />
      )}

      {manageOpen && canManage && <ManageCountriesPanel hc={hc} t={t} onClose={() => setManageOpen(false)} />}
    </section>
  );
}
