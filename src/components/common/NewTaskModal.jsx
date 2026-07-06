import React, { useMemo, useState } from "react";
import { FiX, FiSearch } from "react-icons/fi";
import PeriodFilter from "./PeriodFilter.jsx";
import WorkItemTypeIcon from "./WorkItemTypeIcon.jsx";
import CountryFlags from "./CountryFlags.jsx";

const PARENT_TYPES = ["User Story", "Bug"];

function stripHtml(value) {
  const div = document.createElement("div");
  div.innerHTML = String(value || "");
  return (div.textContent || div.innerText || "").trim();
}

// Fluxo real do userscript legado: em vez de criar uma Task do zero, o dev
// escolhe uma User Story/Bug (Parent) dentro de um período, e o app copia
// título/descrição/tags/área/iteração para uma nova Task, já vinculada como
// filha e atribuída a ele mesmo.
export default function NewTaskModal({ items, myCollaborator, onCreate, onClose }) {
  const [period, setPeriod] = useState({ preset: "30d" });
  const [search, setSearch] = useState("");
  const [selectedParent, setSelectedParent] = useState(null);

  const candidates = useMemo(() => {
    const from = period?.from ? new Date(period.from) : null;
    const to = period?.to ? new Date(period.to) : null;
    if (to) to.setHours(23, 59, 59, 999);
    const query = search.trim().toLowerCase();
    return items
      .filter((item) => PARENT_TYPES.includes(item.type))
      .filter((item) => {
        const changed = item.updatedAt ? new Date(item.updatedAt) : null;
        if (from && changed && changed < from) return false;
        if (to && changed && changed > to) return false;
        if (query && !`${item.id} ${item.title}`.toLowerCase().includes(query)) return false;
        return true;
      })
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }, [items, period, search]);

  function handleConfirm() {
    if (!selectedParent) return;
    onCreate({
      title: selectedParent.title,
      type: "Task",
      description: selectedParent.description || "",
      areaPath: selectedParent.areaPath || null,
      sprint: selectedParent.sprint || null,
      tags: selectedParent.tags || [],
      countries: selectedParent.countries || [],
      parentId: selectedParent.id,
      assigneeAlias: myCollaborator?.azureName || null,
      state: "New",
      env: "dev",
      completedHours: null,
      assigneeId: myCollaborator?.id || null,
      qaCollaboratorId: null,
      lastTestResult: null
    });
  }

  return (
    <div className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center p-3" style={{ background: "rgba(0,0,0,.55)", zIndex: 1060 }}>
      <div className="stark-card d-flex flex-column" style={{ width: "min(760px, 96vw)", height: "min(640px, 92vh)", overflow: "hidden" }}>
        <div className="d-flex align-items-center justify-content-between mb-2">
          <strong>Nova tarefa a partir de uma User Story/Bug</strong>
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onClose}><FiX /></button>
        </div>

        <div className="d-flex flex-wrap gap-2 align-items-center mb-2">
          <div className="position-relative">
            <FiSearch className="position-absolute" style={{ left: 10, top: 9, opacity: .5 }} />
            <input
              className="form-control form-control-sm ps-4" style={{ width: 200 }}
              placeholder="Buscar ID ou título" value={search} onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <PeriodFilter value={period} onChange={setPeriod} />
        </div>

        <div className="flex-grow-1 overflow-auto d-flex flex-column gap-2" style={{ minHeight: 0 }}>
          {!selectedParent && (
            <>
              {candidates.length === 0 && <div className="text-muted small">Nenhuma User Story/Bug encontrada no período.</div>}
              {candidates.map((parent) => (
                <button
                  key={parent.id}
                  type="button"
                  className="stark-card d-flex align-items-center gap-2 text-start"
                  style={{ borderLeft: "4px solid var(--bs-primary)" }}
                  onClick={() => setSelectedParent(parent)}
                >
                  <WorkItemTypeIcon type={parent.type} />
                  <div className="min-w-0 flex-grow-1">
                    <div><strong>#{parent.id}</strong> {parent.title}</div>
                    <div className="d-flex align-items-center gap-2 small text-muted">
                      <span>{parent.type}</span>
                      {parent.sprint && <span>· {parent.sprint}</span>}
                      <CountryFlags codes={parent.countries} />
                    </div>
                  </div>
                </button>
              ))}
            </>
          )}

          {selectedParent && (
            <div className="d-flex flex-column gap-2">
              <button type="button" className="btn btn-sm btn-link p-0 align-self-start" onClick={() => setSelectedParent(null)}>
                ← Escolher outro Parent
              </button>
              <div className="stark-card">
                <div className="text-muted small text-uppercase mb-1">Prévia da nova Task</div>
                <div className="d-flex align-items-center gap-2 mb-2">
                  <WorkItemTypeIcon type="Task" />
                  <strong>{selectedParent.title}</strong>
                </div>
                <div className="row g-2 small mb-2">
                  <div className="col-6"><span className="text-muted">Parent:</span> {selectedParent.type} #{selectedParent.id}</div>
                  <div className="col-6"><span className="text-muted">Atribuído a:</span> {myCollaborator?.azureName || "—"}</div>
                  <div className="col-6"><span className="text-muted">Iteration:</span> {selectedParent.sprint || "—"}</div>
                  <div className="col-6"><span className="text-muted">Area Path:</span> {selectedParent.areaPath || "—"}</div>
                </div>
                <div className="text-muted small text-uppercase mb-1">Descrição copiada do Parent</div>
                <div className="border rounded p-2 small" style={{ maxHeight: 180, overflow: "auto", whiteSpace: "pre-wrap" }}>
                  {stripHtml(selectedParent.description) || <em className="text-muted">Sem descrição</em>}
                </div>
              </div>
              <button type="button" className="btn btn-primary" onClick={handleConfirm}>Confirmar e criar Task</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
