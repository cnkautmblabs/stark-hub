import { countries } from "../../../utils/constants.js";
import { shortName } from "../../../utils/workbench/formatters.js";
import { CountryVisual } from "./WorkbenchPrimitives.jsx";

export function CountryStateMatrix({ countriesInBoard, items, statusOrder, statusConfig, resolveStatus }) {
  if (!countriesInBoard.length) return <div id="mbaz-country-state" className="mbaz-country-state"><div className="mbaz-empty">Sem paises para cruzar com status</div></div>;
  const maxCount = Math.max(1, ...statusOrder.flatMap((status) => countriesInBoard.map((country) => items.filter((item) => resolveStatus(item.state).key === status && (item.countries || []).includes(country)).length)));
  return (
    <div id="mbaz-country-state" className="mbaz-country-state">
      <div className="mbaz-cs-table">
        <div className="mbaz-cs-row mbaz-cs-head" style={{ gridTemplateColumns: `76px repeat(${countriesInBoard.length}, minmax(34px, 1fr))` }}>
          <span>Ambiente</span>
          {countriesInBoard.map((country) => (
            <span key={country} className="mbaz-cs-country-head" title={`${countries[country]?.label || country} - ${country}`}>
              <CountryVisual code={country} compact />
            </span>
          ))}
        </div>
        {statusOrder.map((status) => (
          <div key={status} className="mbaz-cs-row" style={{ gridTemplateColumns: `76px repeat(${countriesInBoard.length}, minmax(34px, 1fr))` }}>
            <strong style={{ color: statusConfig[status].color }}>{statusConfig[status].label}</strong>
            {countriesInBoard.map((country) => {
              const count = items.filter((item) => resolveStatus(item.state).key === status && (item.countries || []).includes(country)).length;
              const alpha = count ? Math.min(.18 + (count / maxCount) * .72, .9) : .05;
              return <span key={country} className="mbaz-cs-cell" style={{ background: `color-mix(in srgb, ${statusConfig[status].color} ${Math.round(alpha * 100)}%, transparent)` }}>{count || ""}</span>;
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function CollaboratorCountryMatrix({ developers }) {
  const countriesInBoard = Array.from(new Set(developers.flatMap((dev) => Object.keys(dev.countries || {})))).sort();
  if (!countriesInBoard.length) return <div className="mbdhc-country-matrix-empty">Sem paises para cruzar com colaboradores</div>;
  const maxCount = Math.max(1, ...developers.flatMap((dev) => countriesInBoard.map((country) => dev.countries?.[country] || 0)));
  return (
    <div className="mbdhc-collab-country-matrix mbaz-country-state">
      <div className="mbaz-cs-table">
        <div className="mbaz-cs-row mbaz-cs-head" style={{ gridTemplateColumns: `96px repeat(${countriesInBoard.length}, minmax(34px, 1fr))` }}>
          <span>Colaborador</span>
          {countriesInBoard.map((country) => (
            <span key={country} className="mbaz-cs-country-head" title={`${countries[country]?.label || country} - ${country}`}>
              <CountryVisual code={country} compact />
            </span>
          ))}
        </div>
        {developers.map((dev) => (
          <div key={dev.key} className="mbaz-cs-row" style={{ gridTemplateColumns: `96px repeat(${countriesInBoard.length}, minmax(34px, 1fr))` }}>
            <strong title={dev.displayName}>{shortName(dev.displayName)}</strong>
            {countriesInBoard.map((country) => {
              const count = dev.countries?.[country] || 0;
              const alpha = count ? Math.min(.16 + (count / maxCount) * .74, .9) : .05;
              return <span key={country} className="mbaz-cs-cell" style={{ background: `color-mix(in srgb, #0b9fb8 ${Math.round(alpha * 100)}%, transparent)` }}>{count || ""}</span>;
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
