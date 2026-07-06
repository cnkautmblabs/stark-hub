import React, { useMemo, useState } from "react";
import { FiCopy, FiAlertCircle, FiPlus, FiArrowRight, FiSearch, FiFileText } from "react-icons/fi";
import { copyExecutiveReportText, downloadExecutiveReportPdf } from "../../utils/executiveReport.js";
import PeriodFilter from "../../components/common/PeriodFilter.jsx";
import MultiSelectFilter from "../../components/common/MultiSelectFilter.jsx";
import StatusPill from "../../components/common/StatusPill.jsx";
import EnvironmentBadge from "../../components/common/EnvironmentBadge.jsx";
import CountryFlags from "../../components/common/CountryFlags.jsx";
import WorkItemTypeIcon from "../../components/common/WorkItemTypeIcon.jsx";
import SprintPill from "../../components/common/SprintPill.jsx";
import Avatar from "../../components/common/Avatar.jsx";
import HoursModal from "../../components/common/HoursModal.jsx";
import NewTaskModal from "../../components/common/NewTaskModal.jsx";
import { useAuth } from "../../contexts/AuthContext.jsx";
import { useWorkItems } from "../../hooks/useWorkItems.js";
import { useCollaborators } from "../../hooks/useCollaborators.js";
import { useFeatureFlags } from "../../contexts/FeatureFlagsContext.jsx";
import { useAppSettings } from "../../hooks/useAppSettings.js";
import { countries, nextEnvStep, workItemTypes, defaultWorkItemTypeStyle, defaultGoalHours } from "../../utils/constants.js";

const typeToggleOptions = ["Task", "Bug"];

export default function DevDashboard() {
  const { profile, demoMode } = useAuth();
  const { items, updateItem, addItem, needsAzureIntegration, error: itemsError } = useWorkItems();
  const { collaborators } = useCollaborators();
  const { isEnabled } = useFeatureFlags();
  const { getSetting } = useAppSettings();
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState({ preset: "7d" });
  const [countryFilter, setCountryFilter] = useState([]);
  const [sprintFilter, setSprintFilter] = useState([]);
  const [hoursView, setHoursView] = useState("all");
  const [typeFilter, setTypeFilter] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [advanceItem, setAdvanceItem] = useState(null);
  const [bulkModal, setBulkModal] = useState(false);
  const [newTaskModal, setNewTaskModal] = useState(false);

  const collaboratorsById = useMemo(() => new Map(collaborators.map((c) => [c.id, c])), [collaborators]);
  const myCollaborator = useMemo(() => collaborators.find((c) => c.profileId === profile?.id), [collaborators, profile]);

  const sprintOptions = useMemo(() => {
    const values = Array.from(new Set(items.map((item) => item.sprint).filter(Boolean)));
    return values.map((value) => ({ value, label: value }));
  }, [items]);

  function toggleType(type) {
    setTypeFilter((current) => (current.includes(type) ? current.filter((v) => v !== type) : [...current, type]));
  }

  const filtered = items.filter((item) => {
    // "Meus itens" == itens atribuídos a mim no Azure DevOps, nunca o
    // backlog inteiro do projeto (mesmo escopo do userscript legado). Sem
    // colaborador vinculado ao meu perfil, não há como saber quais são "meus".
    if (!myCollaborator || item.assigneeId !== myCollaborator.id) return false;
    if (search.trim() && !`${item.id} ${item.title}`.toLowerCase().includes(search.trim().toLowerCase())) return false;
    if (typeFilter.length && !typeFilter.includes(item.type)) return false;
    if (countryFilter.length && !item.countries.some((c) => countryFilter.includes(c))) return false;
    if (sprintFilter.length && !sprintFilter.includes(item.sprint)) return false;
    if (hoursView === "with" && item.completedHours == null) return false;
    if (hoursView === "without" && item.completedHours != null) return false;
    return true;
  });

  const totalHours = filtered.reduce((sum, item) => sum + (item.completedHours || 0), 0);
  const missingEstimateCount = filtered.filter((item) => item.completedHours == null).length;
  const goalHours = myCollaborator?.goalHours || getSetting("defaultGoalHours", defaultGoalHours);
  const goalBalance = totalHours - goalHours;

  const myName = myCollaborator?.azureName || profile?.displayName || profile?.fullName || "Dev";
  const myTone = goalBalance < 0 ? "danger" : goalBalance > 0 ? "warning" : "primary";
  const myLabel = goalBalance < 0 ? "Abaixo da meta" : goalBalance > 0 ? "Acima da meta" : "Meta cumprida";
  const reportTotals = {
    developers: 1, cards: filtered.length, hours: totalHours, goal: goalHours,
    missing: Math.max(goalHours - totalHours, 0), extra: Math.max(totalHours - goalHours, 0)
  };
  const reportRows = [{ name: myName, hours: totalHours, goal: goalHours, label: myLabel, tone: myTone }];

  function copyExecutiveReport() {
    copyExecutiveReportText({ title: `Relatório executivo — ${myName}`, period: period.preset, totals: reportTotals, rows: reportRows });
  }

  function downloadPersonalPdf() {
    downloadExecutiveReportPdf({
      title: `Stark Hub — Relatório Executivo (${myName})`,
      period: period.preset,
      totals: reportTotals,
      rows: reportRows,
      filename: `stark-hub-meus-itens-${new Date().toISOString().slice(0, 10)}.pdf`
    });
  }

  function toggleSelected(id) {
    setSelectedIds((current) => (current.includes(id) ? current.filter((v) => v !== id) : [...current, id]));
  }

  function confirmAdvance(hours) {
    const step = nextEnvStep[advanceItem.env];
    updateItem(advanceItem.id, {
      completedHours: (advanceItem.completedHours || 0) + hours,
      ...(step ? { env: step.env, state: step.state } : {}),
      updatedAt: new Date().toISOString()
    });
    setAdvanceItem(null);
  }

  function confirmBulk(hours, alsoAdvance) {
    selectedIds.forEach((id) => {
      const item = items.find((i) => i.id === id);
      if (!item) return;
      const step = nextEnvStep[item.env];
      updateItem(id, {
        completedHours: (item.completedHours || 0) + hours,
        ...(alsoAdvance && step ? { env: step.env, state: step.state } : {}),
        updatedAt: new Date().toISOString()
      });
    });
    setSelectedIds([]);
    setBulkModal(false);
  }

  const bulkSameNextStep = selectedIds.length > 1 &&
    new Set(selectedIds.map((id) => items.find((i) => i.id === id)?.env)).size === 1;

  return (
    <div>
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <h3 className="mb-0">Meus itens {demoMode && <span className="stark-badge-demo ms-2">demo</span>}</h3>
        <div className="d-flex gap-2 flex-wrap">
          {isEnabled("enableNewTask") && (
            <button className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1" onClick={() => setNewTaskModal(true)}>
              <FiPlus /> Nova tarefa
            </button>
          )}
          <button className="btn btn-sm btn-outline-primary d-flex align-items-center gap-1" onClick={copyExecutiveReport}>
            <FiCopy /> Copiar relatório executivo
          </button>
          <button className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1" onClick={downloadPersonalPdf}>
            <FiFileText /> Baixar PDF
          </button>
        </div>
      </div>

      {myCollaborator && (
        <div className="stark-card mb-3 d-flex flex-wrap align-items-center gap-4">
          <div className="d-flex align-items-center gap-2">
            <Avatar name={myCollaborator.azureName} color={myCollaborator.color} size={32} />
            <strong>{myCollaborator.azureName}</strong>
          </div>
          <div>
            <div className="text-muted small">Horas</div>
            <div className="fw-bold">{totalHours}h</div>
          </div>
          <div>
            <div className="text-muted small">Meta</div>
            <div className="fw-bold">{goalHours}h</div>
          </div>
          <div>
            <div className="text-muted small">{goalBalance >= 0 ? "Excedente" : "Restante"}</div>
            <div className={`fw-bold ${goalBalance >= 0 ? "text-success" : "text-warning"}`}>{Math.abs(goalBalance)}h</div>
          </div>
        </div>
      )}

      <div className="d-flex flex-wrap gap-2 mb-3 align-items-center">
        <div className="position-relative">
          <FiSearch className="position-absolute" style={{ left: 10, top: 9, opacity: .5 }} />
          <input
            className="form-control form-control-sm ps-4" style={{ width: 200 }}
            placeholder="Buscar ID ou título" value={search} onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="btn-group btn-group-sm">
          {typeToggleOptions.map((type) => (
            <button
              key={type}
              type="button"
              className={`btn ${typeFilter.includes(type) ? "btn-secondary" : "btn-outline-secondary"}`}
              onClick={() => toggleType(type)}
            >
              {type}
            </button>
          ))}
        </div>
        <PeriodFilter value={period} onChange={setPeriod} />
        <MultiSelectFilter
          label="País"
          selected={countryFilter}
          onChange={setCountryFilter}
          options={Object.entries(countries).map(([value, c]) => ({ value, label: `${value} - ${c.label}` }))}
        />
        <MultiSelectFilter label="Sprint" selected={sprintFilter} onChange={setSprintFilter} options={sprintOptions} />
        <div className="btn-group btn-group-sm">
          {[{ v: "all", l: "Todos" }, { v: "with", l: "Com horas" }, { v: "without", l: "Sem horas" }].map((opt) => (
            <button
              key={opt.v}
              type="button"
              className={`btn ${hoursView === opt.v ? "btn-secondary" : "btn-outline-secondary"}`}
              onClick={() => setHoursView(opt.v)}
            >
              {opt.l}
            </button>
          ))}
        </div>
      </div>

      <div className="row g-3 mb-3">
        <div className="col-6 col-md-3">
          <div className="stark-card">
            <span className="text-muted small">Horas no período</span>
            <h2 className="mb-0">{totalHours}h</h2>
          </div>
        </div>
        <div className="col-6 col-md-3">
          <div className="stark-card">
            <span className="text-muted small">Itens no período</span>
            <h2 className="mb-0">{filtered.length}</h2>
          </div>
        </div>
        <div className="col-6 col-md-3">
          <div className="stark-card">
            <span className="text-muted small">Sem estimativa</span>
            <h2 className="mb-0 d-flex align-items-center gap-2">
              {missingEstimateCount}
              {missingEstimateCount > 0 && <FiAlertCircle className="text-warning" title="Itens sem horas registradas" />}
            </h2>
          </div>
        </div>
        <div className="col-6 col-md-3">
          <div className="stark-card">
            <span className="text-muted small">Sprint atual</span>
            <h2 className="mb-0">{filtered[0]?.sprint || "—"}</h2>
          </div>
        </div>
      </div>

      {isEnabled("enableBulkEdit") && selectedIds.length > 1 && (
        <div className="stark-card mb-3 d-flex align-items-center justify-content-between flex-wrap gap-2">
          <span className="small">{selectedIds.length} itens selecionados</span>
          <button className="btn btn-sm btn-primary" onClick={() => setBulkModal(true)}>Aplicar horas em massa</button>
        </div>
      )}

      {needsAzureIntegration ? (
        <div className="stark-card text-center text-muted py-5">
          Ainda não conectado à API do Azure DevOps. Configure a integração em Configurações.
        </div>
      ) : itemsError ? (
        <div className="stark-card text-center py-5">
          <div className="alert alert-danger d-inline-block mb-0">{itemsError}</div>
        </div>
      ) : !myCollaborator && !demoMode ? (
        <div className="stark-card text-center text-muted py-5">
          Seu perfil ainda não está vinculado a um colaborador (com o nome exato de "Assigned To" no Azure DevOps).
          Peça para a Gestão te cadastrar em Colaboradores.
        </div>
      ) : (
        <div className="d-flex flex-column gap-2">
          {filtered.map((item) => {
            const assignee = collaboratorsById.get(item.assigneeId);
            const qaCollaborator = collaboratorsById.get(item.qaCollaboratorId);
            const step = nextEnvStep[item.env];
            const typeStyle = workItemTypes[item.type] || defaultWorkItemTypeStyle;
            return (
              <div
                key={item.id}
                className="stark-card stark-card-typed d-flex flex-wrap justify-content-between align-items-center gap-3"
                style={{ borderLeftColor: typeStyle.color }}
              >
                <div className="d-flex align-items-start gap-2">
                  {isEnabled("enableBulkEdit") && (
                    <input
                      type="checkbox" className="form-check-input mt-1"
                      checked={selectedIds.includes(item.id)}
                      onChange={() => toggleSelected(item.id)}
                    />
                  )}
                  <div className="d-flex flex-column gap-1">
                    <div className="d-flex align-items-center gap-2 flex-wrap">
                      <WorkItemTypeIcon type={item.type} />
                      <StatusPill state={item.state} />
                      <EnvironmentBadge env={item.env} />
                      <CountryFlags codes={item.countries} />
                      <SprintPill sprint={item.sprint} />
                    </div>
                    <div>
                      <strong>#{item.id}</strong> — {item.title}
                    </div>
                    <div className="d-flex align-items-center gap-3 small text-muted">
                      <span>Dev: {assignee?.azureName || item.assigneeName || "Sem responsável"}</span>
                      <span>QA: {qaCollaborator?.azureName || "Não definido"}</span>
                    </div>
                  </div>
                </div>
                <div className="d-flex align-items-center gap-3">
                  <div className="fw-bold text-end">
                    {item.completedHours != null ? `${item.completedHours}h` : <span className="text-muted small fw-normal">Não estimado</span>}
                  </div>
                  {step && (
                    <button className="btn btn-sm btn-outline-primary d-flex align-items-center gap-1" onClick={() => setAdvanceItem(item)}>
                      {step.state} <FiArrowRight />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {!filtered.length && <div className="text-muted">Nenhum item para os filtros atuais.</div>}
        </div>
      )}

      {advanceItem && (
        <HoursModal
          title={`Avançar #${advanceItem.id} para "${nextEnvStep[advanceItem.env]?.state}"`}
          confirmLabel="Avançar"
          onConfirm={confirmAdvance}
          onClose={() => setAdvanceItem(null)}
        />
      )}

      {bulkModal && (
        <HoursModal
          title={`Aplicar horas a ${selectedIds.length} itens`}
          confirmLabel="Aplicar"
          allowStatusToggle={bulkSameNextStep}
          onConfirm={confirmBulk}
          onClose={() => setBulkModal(false)}
        />
      )}

      {newTaskModal && (
        <NewTaskModal
          items={items}
          myCollaborator={myCollaborator}
          onCreate={(item) => { addItem(item); setNewTaskModal(false); }}
          onClose={() => setNewTaskModal(false)}
        />
      )}
    </div>
  );
}
