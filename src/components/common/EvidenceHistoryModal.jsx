import React, { useMemo, useState } from "react";
import { FiX, FiExternalLink } from "react-icons/fi";
import PeriodFilter from "./PeriodFilter.jsx";
import MultiSelectFilter from "./MultiSelectFilter.jsx";
import TestResultBadge from "./TestResultBadge.jsx";
import EnvironmentBadge from "./EnvironmentBadge.jsx";
import WorkItemTypeIcon from "./WorkItemTypeIcon.jsx";
import { testResultTypes, environments } from "../../utils/constants.js";

const PAGE_SIZES = [10, 50, "all"];

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}
function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

// Histórico global de evidências de teste — equivalente ao módulo "Testes"
// do userscript legado (busca por ID/título, filtros de status/ambiente/tipo,
// período com atalhos Hoje/7d/30d/Custom e paginação). Diferente do userscript,
// não depende de reconsultar o Azure: os dados já vêm todos do Supabase.
export default function EvidenceHistoryModal({ evidence, itemsById, onOpenItem, onClose }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState([]);
  const [envFilter, setEnvFilter] = useState([]);
  const [typeFilter, setTypeFilter] = useState([]);
  const [period, setPeriod] = useState(() => ({ preset: "today", from: new Date(), to: new Date() }));
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const enriched = useMemo(
    () =>
      evidence.map((entry) => {
        const item = itemsById.get(entry.workItemId) || null;
        return {
          ...entry,
          item,
          qaName: entry.authorName || entry.author || "QA não informado"
        };
      }),
    [evidence, itemsById]
  );

  const typeOptions = useMemo(() => {
    const values = Array.from(new Set(enriched.map((e) => e.item?.type).filter(Boolean)));
    return values.map((value) => ({ value, label: value }));
  }, [enriched]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const from = period?.from ? startOfDay(period.from) : null;
    const to = period?.to ? endOfDay(period.to) : null;
    return enriched.filter((entry) => {
      if (statusFilter.length && !statusFilter.includes(entry.result)) return false;
      if (envFilter.length && !envFilter.includes(entry.environment)) return false;
      if (typeFilter.length && !typeFilter.includes(entry.item?.type)) return false;
      if (from && new Date(entry.createdAt) < from) return false;
      if (to && new Date(entry.createdAt) > to) return false;
      if (query) {
        const haystack = `${entry.workItemId} ${entry.item?.title || ""} ${entry.qaName}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [enriched, search, statusFilter, envFilter, typeFilter, period]);

  const counts = useMemo(() => {
    const base = { total: filtered.length, pass: 0, fail: 0, limitation: 0 };
    filtered.forEach((entry) => {
      if (base[entry.result] !== undefined) base[entry.result] += 1;
    });
    return base;
  }, [filtered]);

  const effectivePageSize = pageSize === "all" ? Math.max(filtered.length, 1) : pageSize;
  const totalPages = Math.max(1, Math.ceil(filtered.length / effectivePageSize));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * effectivePageSize, (safePage - 1) * effectivePageSize + effectivePageSize);

  function updateFilter(setter) {
    return (value) => {
      setter(value);
      setPage(1);
    };
  }

  return (
    <div className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center p-3" style={{ background: "rgba(0,0,0,.55)", zIndex: 1050 }}>
      <div className="stark-card d-flex flex-column" style={{ width: "min(1100px, 96vw)", height: "min(820px, 92vh)", padding: 0, overflow: "hidden" }}>
        <div className="d-flex align-items-center justify-content-between p-3 border-bottom">
          <div>
            <strong>Histórico de evidências de teste</strong>
            <div className="text-muted small">{counts.total} evidência(s) no filtro atual</div>
          </div>
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onClose}><FiX /></button>
        </div>

        <div className="d-flex flex-wrap gap-2 align-items-center p-3 border-bottom">
          <input
            className="form-control form-control-sm"
            style={{ width: 220 }}
            placeholder="Buscar ID, título ou QA"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
          <MultiSelectFilter
            label="Status"
            selected={statusFilter}
            onChange={updateFilter(setStatusFilter)}
            options={Object.entries(testResultTypes).map(([value, cfg]) => ({ value, label: cfg.label }))}
          />
          <MultiSelectFilter
            label="Ambiente"
            selected={envFilter}
            onChange={updateFilter(setEnvFilter)}
            options={Object.entries(environments).map(([value, cfg]) => ({ value, label: cfg.label }))}
          />
          <MultiSelectFilter label="Tipo" selected={typeFilter} onChange={updateFilter(setTypeFilter)} options={typeOptions} />
          <PeriodFilter value={period} onChange={(v) => { setPeriod(v); setPage(1); }} />
        </div>

        <div className="d-flex flex-wrap gap-3 px-3 py-2 border-bottom small">
          <span><strong>{counts.total}</strong> total</span>
          <span className="text-success"><strong>{counts.pass}</strong> pass</span>
          <span className="text-danger"><strong>{counts.fail}</strong> fail</span>
          <span className="text-warning"><strong>{counts.limitation}</strong> limitation</span>
        </div>

        <div className="flex-grow-1 overflow-auto p-3">
          {pageItems.length === 0 && <div className="text-muted text-center py-5">Nenhuma evidência encontrada para os filtros atuais.</div>}
          <div className="d-flex flex-column gap-2">
            {pageItems.map((entry) => (
              <div key={entry.id} className="stark-card d-flex flex-wrap align-items-center justify-content-between gap-2 py-2">
                <div className="d-flex align-items-center gap-2 flex-grow-1 min-w-0">
                  <WorkItemTypeIcon type={entry.item?.type} />
                  <div className="min-w-0">
                    <div className="d-flex align-items-center gap-2">
                      <strong>#{entry.workItemId}</strong>
                      {entry.environment && <EnvironmentBadge env={entry.environment} />}
                      <TestResultBadge result={entry.result} />
                    </div>
                    <div className="text-truncate small text-muted" style={{ maxWidth: 480 }}>
                      {entry.item?.title || "Item não carregado no board atual"}
                    </div>
                  </div>
                </div>
                <div className="d-flex align-items-center gap-3 small text-muted">
                  <span>{entry.qaName}</span>
                  <span>{new Date(entry.createdAt).toLocaleString("pt-BR")}</span>
                  {entry.item && (
                    <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => onOpenItem(entry.item)} title="Abrir tarefa">
                      <FiExternalLink />
                    </button>
                  )}
                </div>
                {entry.note && <div className="w-100 small border-top pt-1 mt-1">{entry.note}</div>}
              </div>
            ))}
          </div>
        </div>

        <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 p-3 border-top">
          <div className="d-flex align-items-center gap-2 small">
            <span>Página {safePage} de {totalPages}</span>
            <button type="button" className="btn btn-sm btn-outline-secondary" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Anterior</button>
            <button type="button" className="btn btn-sm btn-outline-secondary" disabled={safePage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Próxima</button>
          </div>
          <div className="d-flex align-items-center gap-2 small">
            <span>Por página</span>
            <select className="form-select form-select-sm w-auto" value={pageSize} onChange={(e) => { const v = e.target.value === "all" ? "all" : Number(e.target.value); setPageSize(v); setPage(1); }}>
              {PAGE_SIZES.map((size) => <option key={size} value={size}>{size === "all" ? "Todos" : size}</option>)}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
