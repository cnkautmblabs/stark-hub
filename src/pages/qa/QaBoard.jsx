import React, { useMemo, useState } from "react";
import { FiGrid, FiList, FiMenu, FiSearch } from "react-icons/fi";
import MultiSelectFilter from "../../components/common/MultiSelectFilter.jsx";
import IframeTaskModal from "../../components/common/IframeTaskModal.jsx";
import EvidenceHistoryModal from "../../components/common/EvidenceHistoryModal.jsx";
import QaStatusDashboard, { stageKeyFor } from "../../components/common/QaStatusDashboard.jsx";
import StatusPill from "../../components/common/StatusPill.jsx";
import EnvironmentBadge from "../../components/common/EnvironmentBadge.jsx";
import PipelineEnvironmentBadge from "../../components/common/PipelineEnvironmentBadge.jsx";
import CountryFlags from "../../components/common/CountryFlags.jsx";
import WorkItemTypeIcon from "../../components/common/WorkItemTypeIcon.jsx";
import TestResultBadge from "../../components/common/TestResultBadge.jsx";
import SprintPill from "../../components/common/SprintPill.jsx";
import AgingPill from "../../components/common/AgingPill.jsx";
import TagPills from "../../components/common/TagPills.jsx";
import Avatar from "../../components/common/Avatar.jsx";
import { useAuth } from "../../contexts/AuthContext.jsx";
import { useWorkItems } from "../../hooks/useWorkItems.js";
import { useCollaborators } from "../../hooks/useCollaborators.js";
import { useTestEvidence } from "../../hooks/useTestEvidence.js";
import { useAppSettings } from "../../hooks/useAppSettings.js";
import { usePipelineStatus } from "../../hooks/usePipelineStatus.js";
import { useFeatureFlags } from "../../contexts/FeatureFlagsContext.jsx";
import { countries, workItemTypes, defaultWorkItemTypeStyle } from "../../utils/constants.js";
import { azureWorkItemUrl } from "../../utils/azure.js";

const testResultOptions = [
  { value: "pending", label: "Pendente" },
  { value: "pass", label: "Pass" },
  { value: "fail", label: "Fail" },
  { value: "limitation", label: "Limitation" }
];

const sortOptions = [
  { value: "changed_desc", label: "Alterados recentemente" },
  { value: "changed_asc", label: "Alterados há mais tempo" },
  { value: "id_desc", label: "ID (maior primeiro)" }
];

const viewModes = [
  { value: "grid", icon: FiGrid, title: "Grade" },
  { value: "list", icon: FiList, title: "Lista" },
  { value: "compact", icon: FiMenu, title: "Compacto" }
];

export default function QaBoard() {
  const { profile, demoMode } = useAuth();
  const { items, updateItem, needsAzureIntegration, error: itemsError } = useWorkItems();
  const { collaborators } = useCollaborators();
  const { evidence, reload: reloadEvidence } = useTestEvidence();
  const { isEnabled } = useFeatureFlags();
  const { getSetting } = useAppSettings();
  const pipelineNames = getSetting("azurePipelines", {});
  const { byWorkItemId: pipelineStatusById } = usePipelineStatus(useMemo(() => items.map((i) => i.id), [items]), pipelineNames);
  const [search, setSearch] = useState("");
  const [statuses, setStatuses] = useState([]);
  const [statusKeyFilter, setStatusKeyFilter] = useState([]);
  const [countryFilter, setCountryFilter] = useState([]);
  const [assigneeFilter, setAssigneeFilter] = useState([]);
  const [qaFilter, setQaFilter] = useState([]);
  const [sprintFilter, setSprintFilter] = useState([]);
  const [resultFilter, setResultFilter] = useState([]);
  const [sort, setSort] = useState("changed_desc");
  const [viewMode, setViewMode] = useState("grid");
  const [showKpis, setShowKpis] = useState(true);
  const [activeItem, setActiveItem] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [showEvidenceHistory, setShowEvidenceHistory] = useState(false);

  const collaboratorsById = useMemo(() => new Map(collaborators.map((c) => [c.id, c])), [collaborators]);
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const qaCollaborators = useMemo(() => collaborators.filter((c) => c.isQa), [collaborators]);
  const myCollaborator = useMemo(() => collaborators.find((c) => c.profileId === profile?.id), [collaborators, profile]);

  // Mesmo escopo do userscript legado (qaStates): o QA Board só mostra itens
  // que já chegaram em QA (In QA em diante), nunca itens ainda em Dev nem
  // itens já totalmente em Produção — aquilo é responsabilidade de "Meus itens".
  const qaStageItems = useMemo(() => items.filter((item) => stageKeyFor(item.state)), [items]);

  const statusOptions = useMemo(() => {
    const values = Array.from(new Set(qaStageItems.map((item) => item.state)));
    return values.map((value) => ({ value, label: value }));
  }, [qaStageItems]);

  const sprintOptions = useMemo(() => {
    const values = Array.from(new Set(qaStageItems.map((item) => item.sprint).filter(Boolean)));
    return values.map((value) => ({ value, label: value }));
  }, [qaStageItems]);

  function toggleResult(value) {
    setResultFilter((current) => (current.includes(value) ? current.filter((v) => v !== value) : [...current, value]));
  }

  function toggleStage(stageKey) {
    if (!stageKey) { setStatusKeyFilter([]); return; }
    setStatusKeyFilter((current) => (current.includes(stageKey) ? current.filter((v) => v !== stageKey) : [...current, stageKey]));
  }

  const filteredBeforeStage = qaStageItems.filter((item) => {
    if (search.trim() && !`${item.id} ${item.title}`.toLowerCase().includes(search.trim().toLowerCase())) return false;
    if (statuses.length && !statuses.includes(item.state)) return false;
    if (countryFilter.length && !item.countries.some((c) => countryFilter.includes(c))) return false;
    if (assigneeFilter.length && !assigneeFilter.includes(item.assigneeId)) return false;
    if (qaFilter.length && !qaFilter.includes(item.qaCollaboratorId)) return false;
    if (sprintFilter.length && !sprintFilter.includes(item.sprint)) return false;
    if (resultFilter.length && !resultFilter.includes(item.lastTestResult || "pending")) return false;
    return true;
  });

  const filtered = filteredBeforeStage
    .filter((item) => !statusKeyFilter.length || statusKeyFilter.includes(stageKeyFor(item.state)))
    .sort((a, b) => {
      if (sort === "id_desc") return b.id - a.id;
      const diff = new Date(b.updatedAt) - new Date(a.updatedAt);
      return sort === "changed_asc" ? -diff : diff;
    });

  const myQaItems = myCollaborator ? items.filter((item) => item.qaCollaboratorId === myCollaborator.id) : [];
  const myKpis = {
    total: myQaItems.length,
    pass: myQaItems.filter((i) => i.lastTestResult === "pass").length,
    fail: myQaItems.filter((i) => i.lastTestResult === "fail").length,
    limitation: myQaItems.filter((i) => i.lastTestResult === "limitation").length,
    pending: myQaItems.filter((i) => !i.lastTestResult).length
  };

  async function setResult(item, result) {
    await updateItem(item.id, { lastTestResult: result === "pending" ? null : result });
    reloadEvidence();
  }

  function assignQa(item, qaCollaboratorId) {
    updateItem(item.id, { qaCollaboratorId: qaCollaboratorId || null });
  }

  function evidenceFor(itemId) {
    return evidence.filter((entry) => entry.workItemId === itemId);
  }

  const listClass = { grid: "row g-3", list: "d-flex flex-column gap-2", compact: "d-flex flex-column gap-1" }[viewMode];

  return (
    <div>
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <h3 className="mb-0">QA Board {demoMode && <span className="stark-badge-demo ms-2">demo</span>}</h3>
        <div className="d-flex gap-2">
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setShowKpis((v) => !v)}>
            {showKpis ? "Ocultar resumo" : "Mostrar resumo"}
          </button>
          {isEnabled("showEvidenceHistory") && (
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setShowEvidenceHistory(true)}>
              Testes
            </button>
          )}
          <div className="btn-group btn-group-sm">
            {viewModes.map(({ value, icon: Icon, title }) => (
              <button
                key={value}
                type="button"
                className={`btn ${viewMode === value ? "btn-secondary" : "btn-outline-secondary"}`}
                onClick={() => setViewMode(value)}
                title={title}
              >
                <Icon />
              </button>
            ))}
          </div>
        </div>
      </div>

      {showKpis && (
        <QaStatusDashboard
          allItems={qaStageItems}
          filteredItems={filteredBeforeStage}
          statusKeyFilter={statusKeyFilter}
          onToggleStage={toggleStage}
        />
      )}

      {showKpis && myCollaborator?.isQa && (
        <div className="stark-card mb-3 d-flex flex-wrap align-items-center gap-4">
          <div className="d-flex align-items-center gap-2">
            <Avatar name={myCollaborator.azureName} color={myCollaborator.color} size={32} />
            <strong>{myCollaborator.azureName}</strong>
          </div>
          {[
            ["Total sob minha QA", myKpis.total, ""],
            ["Pass", myKpis.pass, "text-success"],
            ["Fail", myKpis.fail, "text-danger"],
            ["Limitation", myKpis.limitation, "text-warning"],
            ["Pendentes", myKpis.pending, "text-muted"]
          ].map(([label, value, cls]) => (
            <div key={label}>
              <div className="text-muted small">{label}</div>
              <div className={`fw-bold ${cls}`}>{value}</div>
            </div>
          ))}
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
        <MultiSelectFilter label="Status" selected={statuses} onChange={setStatuses} options={statusOptions} />
        <MultiSelectFilter
          label="País"
          selected={countryFilter}
          onChange={setCountryFilter}
          options={Object.entries(countries).map(([value, c]) => ({ value, label: `${value} - ${c.label}` }))}
        />
        <MultiSelectFilter
          label="Responsável Azure"
          selected={assigneeFilter}
          onChange={setAssigneeFilter}
          options={collaborators.filter((c) => c.isDev).map((c) => ({ value: c.id, label: c.azureName }))}
        />
        <MultiSelectFilter
          label="Responsável QA"
          selected={qaFilter}
          onChange={setQaFilter}
          options={qaCollaborators.map((c) => ({ value: c.id, label: c.azureName }))}
        />
        <MultiSelectFilter label="Sprint" selected={sprintFilter} onChange={setSprintFilter} options={sprintOptions} />
        <select className="form-select form-select-sm" style={{ width: 190 }} value={sort} onChange={(e) => setSort(e.target.value)}>
          {sortOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      <div className="d-flex flex-wrap gap-1 mb-3">
        <span className="text-muted small me-1 align-self-center">Resultado de teste:</span>
        {testResultOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`btn btn-sm ${resultFilter.includes(option.value) ? "btn-secondary" : "btn-outline-secondary"}`}
            onClick={() => toggleResult(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {needsAzureIntegration ? (
        <div className="stark-card text-center text-muted py-5">
          Ainda não conectado à API do Azure DevOps. Configure a integração em Configurações.
        </div>
      ) : itemsError ? (
        <div className="stark-card text-center py-5">
          <div className="alert alert-danger d-inline-block mb-0">{itemsError}</div>
        </div>
      ) : (
        <div className={listClass}>
          {filtered.map((item) => {
            const assignee = collaboratorsById.get(item.assigneeId);
            const evidence = evidenceFor(item.id);
            const expanded = expandedId === item.id;
            const typeStyle = workItemTypes[item.type] || defaultWorkItemTypeStyle;

            if (viewMode === "compact") {
              return (
                <div key={item.id} className="stark-card stark-card-typed d-flex align-items-center justify-content-between gap-2 py-2" style={{ borderLeftColor: typeStyle.color }}>
                  <div className="d-flex align-items-center gap-2 flex-grow-1 min-w-0">
                    <WorkItemTypeIcon type={item.type} />
                    <strong>#{item.id}</strong>
                    <span className="text-truncate small">{item.title}</span>
                  </div>
                  <StatusPill state={item.state} />
                  <CountryFlags codes={item.countries} />
                  <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => setActiveItem(item)}>Ver</button>
                </div>
              );
            }

            const card = (
              <div className="stark-card stark-card-typed h-100 d-flex flex-column gap-2" style={{ borderLeftColor: typeStyle.color }}>
                {/* Linha 1: status (esquerda) + ambiente/aging (direita) */}
                <div className="d-flex justify-content-between align-items-start flex-wrap gap-1">
                  <StatusPill state={item.state} />
                  <div className="d-flex align-items-center gap-1">
                    <EnvironmentBadge env={item.env} />
                    <PipelineEnvironmentBadge status={pipelineStatusById[item.id]} />
                    <AgingPill updatedAt={item.updatedAt} />
                  </div>
                </div>

                {/* Linha 2: ícone do tipo + id + título */}
                <div className="d-flex align-items-center gap-2">
                  <WorkItemTypeIcon type={item.type} size={16} />
                  <strong>#{item.id}</strong>
                </div>
                <p className="text-muted small mb-0">{item.title}</p>

                {/* Linha 3: países + sprint (esquerda) | aging já usado acima, tags (direita) */}
                <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
                  <div className="d-flex align-items-center gap-2 flex-wrap">
                    <CountryFlags codes={item.countries} />
                    <SprintPill sprint={item.sprint} />
                  </div>
                  <TagPills tags={item.tags} />
                </div>

                {/* Linha 4: assignee (esquerda) | resultado + QA picker (direita) */}
                <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 pt-1">
                  <div className="d-flex align-items-center gap-2">
                    <Avatar name={assignee?.azureName || item.assigneeName} color={assignee?.color} size={26} />
                    <span className="small text-muted">{assignee?.azureName || item.assigneeName || "Sem responsável"}</span>
                  </div>
                  <div className="d-flex align-items-center gap-2">
                    <button
                      type="button"
                      className="btn btn-sm btn-link p-0 text-decoration-none"
                      onClick={() => setExpandedId(expanded ? null : item.id)}
                    >
                      {item.lastTestResult ? <TestResultBadge result={item.lastTestResult} /> : <span className="text-muted small">Sem resultado</span>}
                    </button>
                    <select
                      className="stark-qa-picker"
                      value={item.qaCollaboratorId || ""}
                      onChange={(e) => assignQa(item, e.target.value)}
                      title="Responsável QA"
                    >
                      <option value="">Sem QA</option>
                      {qaCollaborators.map((c) => <option key={c.id} value={c.id}>{c.azureName}</option>)}
                    </select>
                  </div>
                </div>

                {expanded && (
                  <div className="stark-card-expand">
                    {isEnabled("showTestResults") && (
                      <div className="btn-group btn-group-sm mb-2">
                        {testResultOptions.filter((o) => o.value !== "pending").map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            className={`btn ${item.lastTestResult === option.value ? "btn-secondary" : "btn-outline-secondary"}`}
                            onClick={() => setResult(item, option.value)}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    )}
                    {isEnabled("showEvidenceHistory") && (
                      <div className="d-flex flex-column gap-1">
                        {evidence.length ? evidence.map((entry) => (
                          <div key={entry.id} className="d-flex align-items-center justify-content-between small border-top pt-1">
                            <span><TestResultBadge result={entry.result} /> {entry.note}</span>
                            <span className="text-muted">{new Date(entry.createdAt).toLocaleDateString("pt-BR")}</span>
                          </div>
                        )) : <span className="text-muted small">Nenhuma evidência registrada.</span>}
                      </div>
                    )}
                    <button type="button" className="btn btn-sm btn-outline-primary mt-2 w-100" onClick={() => setActiveItem(item)}>
                      Ver tarefa
                    </button>
                  </div>
                )}
              </div>
            );

            return viewMode === "grid" ? (
              <div key={item.id} className="col-12 col-md-6 col-lg-4">{card}</div>
            ) : (
              <div key={item.id}>{card}</div>
            );
          })}
          {!filtered.length && <div className="text-muted">Nenhum item para os filtros atuais.</div>}
        </div>
      )}

      {showEvidenceHistory && (
        <EvidenceHistoryModal
          evidence={evidence}
          itemsById={itemsById}
          onOpenItem={setActiveItem}
          onClose={() => setShowEvidenceHistory(false)}
        />
      )}

      {activeItem && (
        <IframeTaskModal
          title={`${activeItem.type} #${activeItem.id}`}
          url={azureWorkItemUrl(profile?.azureOrgUrl || "SUA-ORG", profile?.azureProject || "SEU-PROJETO", activeItem.id)}
          onClose={() => setActiveItem(null)}
        />
      )}
    </div>
  );
}
