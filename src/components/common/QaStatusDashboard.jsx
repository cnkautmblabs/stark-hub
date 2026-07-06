import React from "react";
import { FiCheck, FiCoffee, FiSend, FiShield } from "react-icons/fi";
import { normalizeStatusKey, countries, flagUrl } from "../../utils/constants.js";

// Ordem e ícone de cada estágio — mesma sequência do dashboard do userscript
// legado (renderSummary/renderStatusChart): In QA -> In BETA -> Ready Beta ->
// HMG CNK -> Ready Prod. "readytobeta" e "readybeta" contam juntos (mesmo rótulo).
const STAGES = [
  { key: "inqa", label: "In QA", color: "#2563eb", icon: FiCheck },
  { key: "inbeta", label: "In BETA", color: "#7c3aed", icon: FiCoffee },
  { key: "readybeta", label: "Ready Beta", color: "#d97706", icon: FiSend, aliases: ["readytobeta"] },
  { key: "hmgcnk", label: "HMG CNK", color: "#0891b2", icon: FiCoffee },
  { key: "readytoprod", label: "Ready Prod", color: "#16a34a", icon: FiShield }
];

function stageKeyFor(state) {
  const key = normalizeStatusKey(state);
  const stage = STAGES.find((s) => s.key === key || (s.aliases || []).includes(key));
  return stage?.key || null;
}

function countByStage(items) {
  const counts = Object.fromEntries(STAGES.map((s) => [s.key, 0]));
  items.forEach((item) => {
    const key = stageKeyFor(item.state);
    if (key) counts[key] += 1;
  });
  return counts;
}

// Dashboard do QA Board — cards de status clicáveis (viram filtro), gráfico
// empilhado por status e matriz país x status. Equivalente a
// renderSummary/renderStatusChart/renderCountryStateChart do userscript legado.
export default function QaStatusDashboard({ allItems, filteredItems, statusKeyFilter, onToggleStage }) {
  const globalCounts = countByStage(allItems);
  const globalTotal = allItems.length;
  const filteredCounts = countByStage(filteredItems);
  const filteredTotal = filteredItems.length;
  const pct = (count, total) => (total ? Math.round((count / total) * 100) : 0);

  const countryCounts = {};
  filteredItems.forEach((item) => {
    const key = stageKeyFor(item.state);
    if (!key) return;
    item.countries.forEach((code) => {
      countryCounts[code] = countryCounts[code] || {};
      countryCounts[code][key] = (countryCounts[code][key] || 0) + 1;
    });
  });
  const countryCodes = Object.keys(countryCounts).sort();
  const maxCountryCellCount = Math.max(1, ...countryCodes.flatMap((code) => STAGES.map((s) => countryCounts[code][s.key] || 0)));

  return (
    <div className="stark-card mb-3 d-flex flex-column gap-3">
      <div className="row g-2">
        <div className="col-6 col-md-2">
          <button
            type="button"
            className={`stark-stat-card w-100 text-start ${!statusKeyFilter.length ? "active" : ""}`}
            onClick={() => onToggleStage(null)}
          >
            <div className="text-muted small">Total</div>
            <div className="d-flex align-items-end justify-content-between">
              <strong className="fs-5">{globalTotal}</strong>
              <span className="text-muted small">100%</span>
            </div>
          </button>
        </div>
        {STAGES.map((stage) => {
          const Icon = stage.icon;
          const active = statusKeyFilter.includes(stage.key);
          return (
            <div className="col-6 col-md-2" key={stage.key}>
              <button
                type="button"
                className={`stark-stat-card w-100 text-start ${active ? "active" : ""}`}
                style={{ "--stat-color": stage.color }}
                onClick={() => onToggleStage(stage.key)}
              >
                <div className="small d-flex align-items-center gap-1" style={{ color: stage.color }}>
                  <Icon size={12} /> {stage.label}
                </div>
                <div className="d-flex align-items-end justify-content-between">
                  <strong className="fs-5">{globalCounts[stage.key]}</strong>
                  <span className="text-muted small">{pct(globalCounts[stage.key], globalTotal)}%</span>
                </div>
              </button>
            </div>
          );
        })}
      </div>

      <div>
        <div className="d-flex rounded overflow-hidden" style={{ height: 14 }}>
          {STAGES.map((stage) => {
            const percent = pct(filteredCounts[stage.key], filteredTotal);
            return percent ? (
              <div
                key={stage.key}
                title={`${stage.label}: ${filteredCounts[stage.key]} / ${percent}%`}
                style={{ width: `${percent}%`, background: stage.color }}
              />
            ) : null;
          })}
        </div>
        <div className="d-flex flex-wrap gap-3 mt-1 small">
          {STAGES.map((stage) => (
            <span key={stage.key} className="d-flex align-items-center gap-1">
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: stage.color, display: "inline-block" }} />
              {stage.label} {filteredCounts[stage.key]}/{pct(filteredCounts[stage.key], filteredTotal)}%
            </span>
          ))}
        </div>
      </div>

      {countryCodes.length > 0 && (
        <div className="overflow-auto">
          <table className="w-100" style={{ borderCollapse: "separate", borderSpacing: 4, fontSize: 11 }}>
            <thead>
              <tr>
                <th className="text-muted text-start fw-normal">Ambiente</th>
                {countryCodes.map((code) => (
                  <th key={code} className="text-center fw-normal">
                    {countries[code] ? <img src={flagUrl(countries[code].iso2)} alt={code} width={20} height={14} className="stark-flag-img" title={code} /> : code}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {STAGES.map((stage) => (
                <tr key={stage.key}>
                  <td className="fw-bold" style={{ color: stage.color }}>{stage.label}</td>
                  {countryCodes.map((code) => {
                    const count = countryCounts[code][stage.key] || 0;
                    const opacity = count ? Math.min(0.18 + (count / maxCountryCellCount) * 0.72, 0.9) : 0.05;
                    return (
                      <td
                        key={code}
                        className="text-center fw-bold"
                        title={`${stage.label} - ${countries[code]?.label || code}: ${count}`}
                        style={{ background: hexToRgba(stage.color, opacity), borderRadius: 4, height: 22 }}
                      >
                        {count || ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function hexToRgba(hex, alpha) {
  const clean = hex.replace("#", "");
  const value = parseInt(clean, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

export { STAGES, stageKeyFor };
