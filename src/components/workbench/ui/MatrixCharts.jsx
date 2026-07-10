import { useTranslation } from "react-i18next";
import { countries } from "../../../utils/constants.js";
import { shortName } from "../../../utils/workbench/formatters.js";
import { CountryVisual } from "./WorkbenchPrimitives.jsx";

export function CountryStateMatrix({ countriesInBoard, items, statusOrder, statusConfig, resolveStatus }) {
  const { t } = useTranslation();
  if (!countriesInBoard.length) return <div id="mbaz-country-state" className="mbaz-country-state"><div className="mbaz-chart-head"><h3>{t("matrix.envByCountryTitle")}</h3><span>{t("matrix.itemsCount", { count: 0 })}</span></div><div className="mbaz-empty">{t("matrix.noCountriesStatus")}</div></div>;
  const maxCount = Math.max(1, ...statusOrder.flatMap((status) => countriesInBoard.map((country) => items.filter((item) => resolveStatus(item.state).key === status && (item.countries || []).includes(country)).length)));
  return (
    <div id="mbaz-country-state" className="mbaz-country-state">
      <div className="mbaz-chart-head"><h3>{t("matrix.envByCountryTitle")}</h3><span>{t("matrix.itemsCount", { count: items.length })}</span></div>
      <div className="mbaz-cs-table">
        <div className="mbaz-cs-row mbaz-cs-head" style={{ gridTemplateColumns: `76px repeat(${countriesInBoard.length}, minmax(34px, 1fr))` }}>
          <span>{t("matrix.environmentLabel")}</span>
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
              return <span key={country} className="mbaz-cs-cell" title={`${statusConfig[status].label} / ${countries[country]?.label || country}: ${count} item(s)`} style={{ background: `color-mix(in srgb, ${statusConfig[status].color} ${Math.round(alpha * 100)}%, transparent)` }}>{count || ""}</span>;
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function CollaboratorCountryMatrix({ developers, metric = "count" }) {
  const { t } = useTranslation();
  const countriesInBoard = Array.from(new Set(developers.flatMap((dev) => Object.keys(dev.countries || {})))).sort();
  if (!countriesInBoard.length) return <div className="mbdhc-country-matrix-empty">{t("matrix.noCountriesCollaborators")}</div>;
  const valueFor = (dev, country) => metric === "hours" ? (dev.countryHours?.[country] || 0) : (dev.countries?.[country] || 0);
  const maxCount = Math.max(1, ...developers.flatMap((dev) => countriesInBoard.map((country) => valueFor(dev, country))));
  const visibleDevelopers = developers.slice(0, 12);
  return (
    <div className="mbdhc-collab-country-matrix mbaz-country-state">
      <div className="mbaz-cs-table">
        <div className="mbaz-cs-row mbaz-cs-head" style={{ gridTemplateColumns: `76px repeat(${visibleDevelopers.length}, minmax(52px, 1fr))` }}>
          <span>{t("matrix.countryLabel")}</span>
          {visibleDevelopers.map((dev) => (
            <span key={dev.key} className="mbaz-cs-country-head" title={dev.displayName}>
              {shortName(dev.displayName)}
            </span>
          ))}
        </div>
        {countriesInBoard.map((country) => (
          <div key={country} className="mbaz-cs-row" style={{ gridTemplateColumns: `76px repeat(${visibleDevelopers.length}, minmax(52px, 1fr))` }}>
            <strong title={`${countries[country]?.label || country} - ${country}`}><CountryVisual code={country} compact /></strong>
            {visibleDevelopers.map((dev) => {
              const count = valueFor(dev, country);
              const alpha = count ? Math.min(.16 + (count / maxCount) * .74, .9) : .05;
              return <span key={dev.key} className="mbaz-cs-cell" title={`${dev.displayName} / ${countries[country]?.label || country}: ${metric === "hours" ? `${count}h` : `${count} item(s)`}`} style={{ background: `color-mix(in srgb, #0b9fb8 ${Math.round(alpha * 100)}%, transparent)` }}>{count ? (metric === "hours" ? `${count}h` : count) : ""}</span>;
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
