import React from "react";
import { countries, flagUrl } from "../../utils/constants.js";

// Lista compacta de bandeiras + código do país. Aceita um ou vários países
// (rollout gradual), por isso sempre recebe um array. Quando o item atende
// quase toda a região, resume em um único selo "LT" (América Latina), igual
// ao padrão original — evita uma fileira de 6 bandeiras no card.
//
// Usa imagens reais (flagcdn.com) em vez de emoji: bandeiras de país são
// emoji que o Windows não renderiza (mostra a sigla em texto no lugar).
export default function CountryFlags({ codes = [], size = 16 }) {
  const list = Array.isArray(codes) ? codes : [codes];
  if (!list.length) return <span className="text-muted small">Sem países</span>;

  if (list.length >= 4) {
    return (
      <span className="stark-flag-pill stark-flag-pill-lt" title={list.map((c) => countries[c]?.label || c).join(", ")}>
        <i className="bi bi-globe-americas" aria-hidden="true" /> LT
      </span>
    );
  }

  return (
    <span className="d-inline-flex align-items-center gap-1 flex-wrap">
      {list.map((code) => {
        const country = countries[code];
        return (
          <span key={code} className="stark-flag-pill" title={country?.label || code}>
            {country ? (
              <img src={flagUrl(country.iso2, size)} alt="" width={size * 1.4} height={size} className="stark-flag-img" />
            ) : (
              <i className="bi bi-flag" aria-hidden="true" />
            )}
            <span className="stark-flag-code">{code}</span>
          </span>
        );
      })}
    </span>
  );
}
