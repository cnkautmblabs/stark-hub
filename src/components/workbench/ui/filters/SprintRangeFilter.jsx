import React, { useEffect, useRef, useState } from "react";
import { compactSprintLabel, findCurrentSprint, sprintSortValue } from "../../../../utils/sprints.js";
import { FilterField } from "./FilterField.jsx";

/**
 * Fonte unica pro par De/Ate de sprint, usado hoje em 3 telas com 3
 * implementacoes quase identicas (cada uma com seu proprio bug de "valor
 * salvo que nao existe mais nas opcoes atuais" corrigido separadamente
 * essa mesma noite). Ordena cronologicamente (sprintSortValue, nao
 * alfabetico — "Aug26" nao pode vir antes de "Jan26" so por causa do "A"),
 * resolve o default (sprint atual, ou a ultima sprint disponivel) e calcula
 * o range efetivo numa passada so — chame isso tanto pra alimentar a UI
 * quanto pra filtrar os itens de verdade, os dois numeros tem que ser os
 * mesmos sempre.
 */
// defaultFrom/defaultTo (opcionais): nem toda tela quer o mesmo default de
// "so a sprint atual" quando from/to estao vazios — o Dashboard de
// Gerenciamento, por exemplo, historicamente abre com as ultimas 6 sprints
// (uma janela de tendencia), nao 1 sprint so. Passe esses dois pra manter
// o default proprio de uma tela sem duplicar a logica de guarda contra
// valor salvo que nao existe mais nas opcoes atuais (essa parte e sempre
// igual, e a que causou bug de verdade 3x nesta mesma sessao).
export function resolveSprintRange(sprintOptionsRaw = [], from = "", to = "", { defaultFrom, defaultTo } = {}) {
  const sprintOptions = Array.from(new Set(sprintOptionsRaw)).sort((a, b) => sprintSortValue(a) - sprintSortValue(b));
  const currentSprint = findCurrentSprint(sprintOptions);
  const defaultValue = currentSprint || sprintOptions[sprintOptions.length - 1] || "";
  const fromValue = from || defaultFrom || defaultValue;
  const toValue = to || defaultTo || defaultValue;
  if (!sprintOptions.length) return { sprintOptions, fromValue, toValue, effective: [] };
  const fromIndex = sprintOptions.indexOf(fromValue);
  const toIndex = sprintOptions.indexOf(toValue);
  const effective = fromIndex === -1 || toIndex === -1
    ? sprintOptions
    : sprintOptions.slice(Math.min(fromIndex, toIndex), Math.max(fromIndex, toIndex) + 1);
  return { sprintOptions, fromValue, toValue, effective };
}

/**
 * Um unico botao-gatilho que abre um menu com os dois campos De/Ate +
 * resumo do periodo — mesmo padrao visual do combobox "Board" do Quadro de
 * qualidade (que ja existia antes deste componente e o usuario apontou como
 * a referencia certa), em vez de dois FilterField sempre abertos lado a
 * lado. Isso tambem resolve um bug de layout real: dois campos sempre
 * visiveis espremidos numa unica celula da grade (~160px) truncava o
 * rotulo pra so 1 letra ("S"); dentro do menu (~300px+) os dois campos tem
 * espaco de verdade.
 */
export function SprintRangeFilter({
  label = "Sprint",
  sprintOptions,
  fromValue,
  toValue,
  effective,
  onFromChange,
  onToChange,
  fromLabel,
  toLabel,
  hintLabel
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function handleOutsideClick(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [open]);

  const options = sprintOptions.map((sprint) => ({ value: sprint, label: compactSprintLabel(sprint) }));
  const summary = effective.length
    ? (effective.length === 1 ? compactSprintLabel(effective[0]) : `${effective.length} sprints`)
    : "-";

  return (
    <div ref={rootRef} className={`mbw-combobox stark-sprint-range ${open ? "open" : ""}`}>
      <button type="button" className="mbw-combobox-trigger" onClick={() => setOpen((value) => !value)}>
        <span>{label}</span>
        <b>{summary}</b>
        <i className={`bi ${open ? "bi-chevron-up" : "bi-chevron-down"}`} />
      </button>
      {open && (
        <div className="mbw-combobox-menu stark-sprint-range-menu">
          <div className="stark-sprint-range-fields">
            <FilterField label={fromLabel} options={options} values={fromValue ? [fromValue] : []} multiple={false} mode="dropdown" onChange={(value) => onFromChange(value || "")} />
            <FilterField label={toLabel} options={options} values={toValue ? [toValue] : []} multiple={false} mode="dropdown" onChange={(value) => onToChange(value || "")} />
          </div>
          {hintLabel && <span className="stark-sprint-range-hint">{hintLabel(effective)}</span>}
        </div>
      )}
    </div>
  );
}
