import { useEffect, useMemo, useState } from "react";
import { FiCopy, FiRefreshCw, FiSearch } from "react-icons/fi";
import { useAuth } from "../../../contexts/AuthContext.jsx";
import { useTestEvidence } from "../../../hooks/useTestEvidence.js";
import { useWorkItems } from "../../../hooks/useWorkItems.js";
import { usePersistentState } from "../../../hooks/usePersistentState.js";
import { usePersistentActiveWorkItem } from "../../../hooks/usePersistentActiveWorkItem.js";
import { compactSprintLabel, findCurrentSprint } from "../../../utils/sprints.js";
import {
  evidenceDateRangeForPreset,
  evidenceDedupeKey,
  evidenceEnvironments,
  evidenceEnvironmentOrder,
  isQaEvidenceEntry,
  isEvidenceInsideRange,
  normalize,
  normalizeEvidenceEnvironment,
  normalizeResult,
  resultInfo
} from "../../../utils/workbench/formatters.js";
import { AzureWorkItemModal, workItemUrl } from "../ui/AzureWorkItemModal.jsx";
import { Button, ChartSkeleton, EmptyState, IconButton, WorkbenchCardSkeleton, WorkbenchHeader } from "../ui/WorkbenchPrimitives.jsx";
import { EvidenceCard, EvidenceFilterBox, EvidenceMultiFilterBox, ResultIcon } from "./EvidenceComponents.jsx";
import { consumePendingWorkItemHighlight, highlightWorkItem, readWorkItemHash } from "../../../utils/workbench/highlight.js";

export function TestsWorkbench() {
  const { profile, demoMode } = useAuth();
  const { items, loading, error, reload: reloadItems } = useWorkItems();
  const { evidence, reload: reloadEvidence } = useTestEvidence();
  const [search, setSearch] = usePersistentState("starkHubFilters:tests:search", "");
  const [result, setResult] = usePersistentState("starkHubFilters:tests:result", "all");
  const [environmentsFilter, setEnvironmentsFilter] = usePersistentState("starkHubFilters:tests:environment", ["QA", "BETA"]);
  const [type, setType] = usePersistentState("starkHubFilters:tests:type", "all");
  const [qa, setQa] = usePersistentState("starkHubFilters:tests:qa", "all");
  const [sprint, setSprint] = usePersistentState("starkHubFilters:tests:sprint", "all");
  const [periodPreset, setPeriodPreset] = usePersistentState("starkHubFilters:tests:periodPreset", "today");
  const initialRange = evidenceDateRangeForPreset("today");
  const [dateFrom, setDateFrom] = usePersistentState("starkHubFilters:tests:dateFrom", initialRange.from);
  const [dateTo, setDateTo] = usePersistentState("starkHubFilters:tests:dateTo", initialRange.to);
  const [viewMode, setViewMode] = usePersistentState("starkHubFilters:tests:viewMode", "list");
  const { activeItem, openItem: setActiveItem, closeItem: closeActiveItem } = usePersistentActiveWorkItem("starkHubActiveWorkItem:tests", items);
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const discussionRecords = items.flatMap((item) => (item.discussionEvidence || []).filter(isQaEvidenceEntry).map((entry) => ({
    ...entry,
    result: entry.result === "approved" ? "pass" : entry.result,
    source: entry.source || "azure-discussion",
    item
  })));
  const records = [
    ...evidence.map((entry) => ({ ...entry, item: byId.get(entry.workItemId), source: entry.source || "stark-hub" })),
    ...discussionRecords
  ];
  const dedupedRecords = Array.from(records.reduce((map, entry) => {
    const key = evidenceDedupeKey(entry);
    const current = map.get(key);
    if (!current || String(entry.createdAt || "").localeCompare(String(current.createdAt || "")) > 0) map.set(key, entry);
    return map;
  }, new Map()).values()).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const recordsInsidePeriod = dedupedRecords.filter((entry) => isEvidenceInsideRange(entry, dateFrom, dateTo));
  const qaOptions = Array.from(new Set(dedupedRecords.map((entry) => entry.authorName).filter(Boolean))).sort((a, b) => a.localeCompare(b, "pt-BR"));
  const typeOptions = Array.from(new Set(dedupedRecords.map((entry) => entry.item?.type).filter(Boolean))).sort((a, b) => a.localeCompare(b, "pt-BR"));
  const envOptions = evidenceEnvironmentOrder;
  const sprintOptions = Array.from(new Set(dedupedRecords.map((entry) => entry.item?.sprint || entry.item?.iteration).filter(Boolean))).sort((a, b) => b.localeCompare(a, "pt-BR"));
  const currentSprint = findCurrentSprint(sprintOptions);
  const effectiveSprint = sprint === "all" && currentSprint ? currentSprint : sprint;
  const rows = dedupedRecords.filter((entry) => {
    const entryResult = normalizeResult(entry.result);
    const entryEnvs = evidenceEnvironments(entry);
    if (result !== "all" && entryResult !== result) return false;
    if (environmentsFilter.length && !entryEnvs.some((env) => environmentsFilter.includes(normalizeEvidenceEnvironment(env)))) return false;
    if (type !== "all" && entry.item?.type !== type) return false;
    if (qa !== "all" && entry.authorName !== qa) return false;
    if (effectiveSprint !== "all" && (entry.item?.sprint || entry.item?.iteration) !== effectiveSprint) return false;
    if (!isEvidenceInsideRange(entry, dateFrom, dateTo)) return false;
    if (search && !normalize(`${entry.workItemId} ${entry.item?.title || ""} ${entry.authorName || ""} ${entry.note || ""}`).includes(normalize(search))) return false;
    return true;
  });
  const counts = rows.reduce((acc, entry) => {
    const key = normalizeResult(entry.result);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, { pass: 0, fail: 0, limitation: 0 });
  const groupedRows = Array.from(rows.reduce((map, entry) => {
    const id = Number(entry.workItemId);
    if (!map.has(id)) map.set(id, { workItemId: id, item: entry.item || byId.get(id), records: [] });
    map.get(id).records.push(entry);
    return map;
  }, new Map()).values()).map((group) => ({
    ...group,
    latest: group.records.slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0]
  })).sort((a, b) => String(b.latest?.createdAt || "").localeCompare(String(a.latest?.createdAt || "")));

  function reloadAll() {
    reloadItems();
    reloadEvidence();
  }

  useEffect(() => {
    const target = consumePendingWorkItemHighlight() || readWorkItemHash();
    if (target) window.setTimeout(() => highlightWorkItem(target), 250);
  }, [groupedRows.length]);

  function applyPeriodPreset(preset) {
    setPeriodPreset(preset);
    if (preset === "custom") return;
    const range = evidenceDateRangeForPreset(preset);
    setDateFrom(range.from);
    setDateTo(range.to);
  }

  function toggleEnvironmentFilter(env) {
    setEnvironmentsFilter((current) => current.includes(env) ? current.filter((value) => value !== env) : [...current, env]);
  }

  function copyRows() {
    const lines = rows.map((entry) => {
      const item = entry.item || byId.get(entry.workItemId) || {};
      return `${entry.createdAt || ""} - ${item.type || "Work Item"} ${entry.workItemId} - ${item.title || ""} - ${entry.authorName || "QA"} - ${(evidenceEnvironments(entry).length ? evidenceEnvironments(entry) : ["N/A"]).join("/")} - ${resultInfo(entry.result).label}`;
    });
    navigator.clipboard?.writeText(lines.join("\n"));
  }

  return (
    <section className="mbw-page mbaz-tests-page mbaz-evidence-modal open">
      <div className="mbaz-evidence-panel">
        <WorkbenchHeader
          kicker="Stark Hub"
          title="Testes"
          subtitle="Historico de evidencias por Work Item, incluindo Discussions do Azure."
          demoMode={demoMode}
          actions={<><IconButton title="Lista" onClick={() => setViewMode("list")}><i className="bi bi-list-ul" /></IconButton><IconButton title="Grid" onClick={() => setViewMode("grid")}><i className="bi bi-grid-3x3-gap" /></IconButton><IconButton title="Compacto" onClick={() => setViewMode("compact")}><i className="bi bi-view-stacked" /></IconButton><Button onClick={copyRows}><FiCopy /> Copiar</Button><IconButton title="Atualizar" onClick={reloadAll}><FiRefreshCw /></IconButton></>}
        />
        <div className="mbaz-evidence-filter-accordion">
          <div className="mbaz-evidence-filter-body">
            <div className="mbaz-evidence-filter-top">
              <label className="mbaz-evidence-search"><FiSearch /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por ID, titulo, QA ou nota" /></label>
              <div className="mbaz-evidence-period-wrap">
                <div className="mbaz-evidence-periods">
                  <button type="button" className={`mbaz-evidence-filter ${periodPreset === "today" ? "active" : ""}`} onClick={() => applyPeriodPreset("today")}>Hoje</button>
                  <button type="button" className={`mbaz-evidence-filter ${periodPreset === "week" ? "active" : ""}`} onClick={() => applyPeriodPreset("week")}>7 dias correntes</button>
                  <button type="button" className={`mbaz-evidence-filter ${periodPreset === "month" ? "active" : ""}`} onClick={() => applyPeriodPreset("month")}>30 dias correntes</button>
                  <button type="button" className={`mbaz-evidence-filter ${periodPreset === "custom" ? "active" : ""}`} onClick={() => applyPeriodPreset("custom")}>Custom</button>
                </div>
                {periodPreset === "custom" && (
                  <div className="mbaz-evidence-date-group">
                    <label className="mbaz-evidence-date-field">De<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
                    <label className="mbaz-evidence-date-field">Ate<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
                  </div>
                )}
              </div>
            </div>
            <div className="mbaz-evidence-filter-grid">
              <EvidenceFilterBox label="Resultado" value={result} onChange={setResult} options={[["all", "Todos"], ["pass", "Approved"], ["fail", "Fail"], ["limitation", "Limitation"]]} />
              <EvidenceMultiFilterBox label="Ambiente" values={environmentsFilter} onToggle={toggleEnvironmentFilter} onAll={() => setEnvironmentsFilter(envOptions)} onClear={() => setEnvironmentsFilter([])} options={envOptions.map((value) => [value, value])} />
              <EvidenceFilterBox label="Tipo" value={type} onChange={setType} options={[["all", "Todos"], ...typeOptions.map((value) => [value, value])]} />
              <EvidenceFilterBox label="QA" value={qa} onChange={setQa} options={[["all", "Todos"], ...qaOptions.map((value) => [value, value])]} />
              <EvidenceFilterBox label="Sprint" value={effectiveSprint} onChange={setSprint} options={[["all", "Todas"], ...sprintOptions.map((value) => [value, compactSprintLabel(value)])]} />
            </div>
          </div>
        </div>
        <div className="mbaz-evidence-summary">
          <span><strong>{groupedRows.length}</strong> Work Item(s)</span>
          <span><strong>{rows.length}</strong> evidencias</span>
          <span><strong>{recordsInsidePeriod.length}</strong> no periodo</span>
          <span><strong>{dedupedRecords.length}</strong> carregadas</span>
          <span style={{ color: "#166534" }}><strong>{counts.pass || 0}</strong> approved</span>
          <span style={{ color: "#991b1b" }}><strong>{counts.fail || 0}</strong> fail</span>
          <span style={{ color: "#9a6700" }}><strong>{counts.limitation || 0}</strong> limitation</span>
          {loading && <span>Consultando Azure DevOps...</span>}
          {error && <span style={{ color: "#b42318" }}>{error}</span>}
        </div>
        <div className="mbaz-evidence-env-summary">
          {["DEV", "QA", "BETA", "PROD"].map((env) => {
            const envRows = rows.filter((entry) => evidenceEnvironments(entry).includes(env));
            const envCounts = envRows.reduce((acc, entry) => ({ ...acc, [normalizeResult(entry.result)]: (acc[normalizeResult(entry.result)] || 0) + 1 }), {});
            return <span key={env} className="mbaz-evidence-env-chip"><strong>{env}</strong><span><ResultIcon result="pass" /> {envCounts.pass || 0}</span><span><ResultIcon result="fail" /> {envCounts.fail || 0}</span><span><ResultIcon result="limitation" /> {envCounts.limitation || 0}</span><span>Total {envRows.length}</span></span>;
          })}
        </div>
        <div className="mbaz-evidence-chart">
          {loading ? <ChartSkeleton rows={3} /> : (
            <>
              <div className="mbaz-evidence-chart-bar">{["pass", "fail", "limitation"].map((key) => counts[key] ? <span key={key} className={`mbaz-evidence-chart-segment ${resultInfo(key).className}`} style={{ width: `${Math.max(4, (counts[key] / Math.max(rows.length, 1)) * 100)}%` }}><ResultIcon result={key} /> {counts[key]}</span> : null)}</div>
              <div className="mbaz-evidence-chart-legend">{["pass", "fail", "limitation"].map((key) => <span key={key}><ResultIcon result={key} /> {resultInfo(key).label}: {counts[key] || 0}</span>)}</div>
            </>
          )}
        </div>
        <div className="mbaz-evidence-list">
          {loading && <WorkbenchCardSkeleton rows={4} mode={viewMode} />}
          <div className={`mbaz-evidence-cards ${viewMode}`}>
            {groupedRows.map((group) => <EvidenceCard key={group.workItemId} group={group} profile={profile} visibleEnvironments={environmentsFilter.length ? environmentsFilter : envOptions} resolveWorkItemUrl={workItemUrl} onOpen={setActiveItem} />)}
          </div>
          {!groupedRows.length && <EmptyState title={loading ? "Consultando evidencias..." : "Nenhuma evidencia encontrada"} />}
        </div>
      </div>
      {activeItem && <AzureWorkItemModal profile={profile} item={activeItem} onClose={closeActiveItem} />}
    </section>
  );
}
