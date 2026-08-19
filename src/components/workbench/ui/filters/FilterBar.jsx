import React from "react";
import { useTranslation } from "react-i18next";
import { usePersistentState } from "../../../../hooks/usePersistentState.js";

/**
 * Casca unica de painel de filtro — accordion colapsavel, contador "N
 * filtros aplicados", agrupamento em secoes com rotulo, botao Limpar.
 * Estende o padrao "Filtrar por" / "Exibicao" que o Quadro de qualidade ja
 * ganhou nesta mesma sessao, agora reutilizavel em qualquer tela.
 *
 * NAO e dono do valor dos filtros — cada tela continua com seu proprio
 * usePersistentState por campo (o Quadro de qualidade te, por exemplo, 6
 * pontos onde clique em grafico muda filtro direto; Gestao da equipe e
 * Meus Itens tem calculo fora do painel que depende do mesmo estado).
 * FilterBar so persiste o proprio estado aberto/fechado — cada campo
 * informa se esta `active` pra o contador ser derivado, nao mantido em
 * paralelo em cada tela.
 */
export function FilterBar({
  persistKey,
  defaultOpen = false,
  title,
  resultCountLabel,
  groups = [],
  onClear,
  clearLabel,
  extra
}) {
  const { t } = useTranslation();
  const [open, setOpen] = usePersistentState(persistKey ? `${persistKey}:filtersOpen` : "", defaultOpen);
  const activeCount = groups.reduce((sum, group) => {
    if (group.countable === false) return sum;
    return sum + (group.fields || []).filter((field) => field.active).length;
  }, 0);

  return (
    <details className="stark-filterbar" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <span className="stark-filterbar-title">
          {title}
          {resultCountLabel ? <small>{resultCountLabel}</small> : null}
        </span>
        <span className="stark-filterbar-count">{t("common.filtersActiveCount", { count: activeCount })}</span>
        <span className="stark-filterbar-chevron" aria-hidden="true"><i className="bi bi-chevron-down" /></span>
      </summary>
      <div className="stark-filterbar-body">
        {groups.map((group, index) => (
          <div key={group.label || index} className="stark-filterbar-group">
            {group.label && <span className="stark-filterbar-group-label">{group.label}</span>}
            <div className="stark-filterbar-grid">
              {(group.fields || []).map((field) => (
                <React.Fragment key={field.key}>{field.node}</React.Fragment>
              ))}
            </div>
          </div>
        ))}
        {extra}
        {onClear && (
          <div className="stark-filterbar-actions">
            <button type="button" className="stark-filterbar-clear-btn" onClick={onClear}>{clearLabel || t("common.clearFilters")}</button>
          </div>
        )}
      </div>
    </details>
  );
}
