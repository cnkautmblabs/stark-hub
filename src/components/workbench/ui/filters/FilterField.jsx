import React from "react";
import { useTranslation } from "react-i18next";
import { AvatarDot, CountryVisual, FilterCombobox, envIconSrc, typeIconSrc } from "../WorkbenchPrimitives.jsx";
import { qaStatusConfig } from "../../../../utils/workbench/formatters.js";
import { testResultTypes } from "../../../../utils/constants.js";

// Um filtro de "pessoa"/"tipo"/"ambiente"/"pais" hoje mostra so texto (ou
// reimplementa icone/avatar na mao em cada tela) — variant torna isso
// automatico e consistente em qualquer FilterField, nos dois modos
// (dropdown ou chips). Explicito, nao adivinhado pelo formato da opcao:
// nada no shape de {value:"pass",label:"Approved"} diferencia um Resultado
// de um Status por acaso terem a mesma forma.
function OptionContent({ variant, option, compact = false }) {
  // Sentinela "todos/qualquer valor" (varias telas usam "all" como a
  // primeira opcao de um filtro) nao tem icone de tipo/ambiente que faca
  // sentido — sem essa guarda, typeIconSrc/envIconSrc caem no icone
  // fallback deles (ex.: User Story) do lado de "Todos", enganoso.
  if (option.value === "all" && (variant === "type" || variant === "environment" || variant === "status" || variant === "result")) {
    return <>{option.label}</>;
  }
  if (variant === "person") return <AvatarDot person={option.person} name={option.label} compact={compact} />;
  if (variant === "country") {
    if (compact) return <CountryVisual code={option.value} compact />;
    return <span className="mbw-combobox-country"><CountryVisual code={option.value} compact /> {option.label}</span>;
  }
  if (variant === "type") {
    return <><img className="stark-filter-icon" src={typeIconSrc(option.value)} alt="" /><span>{option.label}</span></>;
  }
  if (variant === "environment") {
    return <><img className="stark-filter-icon" src={envIconSrc(option.value)} alt="" /><span>{option.label}</span></>;
  }
  if (variant === "status") {
    const info = qaStatusConfig[option.value];
    return <>{info && <i className={`bi ${info.icon} stark-filter-status-icon`} style={{ color: info.color }} />}<span>{option.label}</span></>;
  }
  if (variant === "result") {
    const info = testResultTypes[option.value];
    return <>{info && <span className="stark-filter-dot" style={{ background: info.color }} />}<span>{option.label}</span></>;
  }
  return <>{option.label}</>;
}

/**
 * Atomo unico de filtro do app — substitui FilterCombobox chamado direto
 * com renderOption manual, os 4 conjuntos de pill/chip reimplementados
 * (Meus Itens, wizard, Testes) e a duplicacao de "como desenhar uma
 * pessoa/tipo/ambiente/pais" que cada tela fazia sozinha.
 *
 * mode="dropdown" delega pro FilterCombobox existente (nao reimplementa
 * abrir/fechar/busca) — apropriado pra conjuntos grandes/que crescem
 * (Pessoa, Pais, Tag). mode="chips" mostra todas as opcoes numa fileira de
 * pills sempre visiveis — apropriado pra conjuntos pequenos fixos (Status,
 * Ambiente, Resultado, Tipo). A escolha e sempre explicita: quem chama ja
 * sabe qual dos dois faz sentido pro campo, nao deveria ser adivinhado
 * pela quantidade de opcoes (isso mudaria o layout sozinho se o conjunto
 * crescer, sem ninguem decidir).
 */
export function FilterField({
  label,
  options = [],
  values = [],
  onChange,
  multiple = true,
  mode = "dropdown",
  variant = "default",
  people,
  placeholder,
  allLabel,
  className = ""
}) {
  const { t } = useTranslation();
  const resolvedOptions = variant === "person" && people
    ? people.map((person) => ({ value: person.id || person.key, label: person.azureName || person.displayName || person.name, person }))
    : options;

  if (mode === "chips") {
    const selected = (Array.isArray(values) ? values : values ? [values] : []).map(String);
    function toggle(option) {
      const value = option.value;
      if (multiple) {
        const exists = selected.includes(String(value));
        onChange(exists ? selected.filter((entry) => entry !== String(value)) : [...selected, value]);
        return;
      }
      // Selecao unica em chips e um grupo de radio, nao um toggle — clicar
      // na opcao ja ativa mantem ela selecionada (nao esvazia pra ""). Ha
      // telas onde o proprio "Todos"/"all" e uma opcao clicavel do grupo
      // (ex.: Testes), entao desmarcar-pra-vazio deixaria o filtro num
      // estado que nenhuma opcao visivel representa.
      onChange(value);
    }
    return (
      <div className={`stark-filter-field chips ${className}`}>
        <span className="stark-filter-field-label">{label}</span>
        <div className="stark-filter-chip-row">
          {resolvedOptions.map((option) => {
            const active = selected.includes(String(option.value));
            return (
              <button key={String(option.value)} type="button" className={`stark-filter-chip ${active ? "active" : ""}`} onClick={() => toggle(option)} aria-pressed={active}>
                <OptionContent variant={variant} option={option} compact />
              </button>
            );
          })}
          {!resolvedOptions.length && <span className="stark-filter-chip-empty">{t("common.noOptions")}</span>}
        </div>
      </div>
    );
  }

  return (
    <FilterCombobox
      label={label}
      options={resolvedOptions}
      values={values}
      onChange={onChange}
      multiple={multiple}
      placeholder={placeholder ?? (variant === "person" ? t("common.searchPerson") : undefined)}
      allLabel={allLabel}
      className={`stark-filter-field-dropdown ${className}`}
      renderOption={(option) => <OptionContent variant={variant} option={option} />}
    />
  );
}
