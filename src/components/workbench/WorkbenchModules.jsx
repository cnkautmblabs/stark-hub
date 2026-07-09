import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  FiCopy,
  FiDownload,
  FiRefreshCw,
  FiSearch,
  FiUpload
} from "react-icons/fi";
import AzureConnectionForm from "../common/AzureConnectionForm.jsx";
import { ErrorBoundary } from "../common/ErrorBoundary.jsx";
import {
  AvatarDot,
  Button,
  ChartSkeleton,
  ConnectionGate,
  CountryPills,
  CountryVisual,
  EmptyState,
  FilterCombobox,
  IconButton,
  Kpi,
  KpiSkeleton,
  ProfileCombobox,
  QaPicker,
  RoleBadgeIcon,
  TextField,
  WorkbenchCardSkeleton,
  WorkbenchHeader,
  envIconSrc,
  typeIconSrc,
} from "./ui/WorkbenchPrimitives.jsx";
import { AzureWorkItemModal, workItemUrl } from "./ui/AzureWorkItemModal.jsx";
import { CollaboratorCountryMatrix, CountryStateMatrix } from "./ui/MatrixCharts.jsx";
import { useAuth } from "../../contexts/AuthContext.jsx";
import { useFeatureFlags } from "../../contexts/FeatureFlagsContext.jsx";
import { useWorkItems } from "../../hooks/useWorkItems.js";
import { useCollaborators } from "../../hooks/useCollaborators.js";
import { useTestEvidence } from "../../hooks/useTestEvidence.js";
import { useAppSettings } from "../../hooks/useAppSettings.js";
import { usePersistentState } from "../../hooks/usePersistentState.js";
import { usePersistentActiveWorkItem } from "../../hooks/usePersistentActiveWorkItem.js";
import { consumePendingWorkItemHighlight, highlightWorkItem, readWorkItemHash } from "../../utils/workbench/highlight.js";
import { notificationTypes, playTone, readPersonalSetting as readNotificationSetting, soundOptions, writePersonalSetting as writeNotificationSetting } from "../../utils/notificationSounds.js";
import {
  accessLevelLabels,
  accessLevels,
  countries,
  defaultGoalHours,
  formatWorkItemCode,
  hasManagementAccess,
  nextEnvStep,
  workItemTypes
} from "../../utils/constants.js";
import { copyExecutiveReportText, downloadExecutiveReportPdf } from "../../utils/executiveReport.js";
import { buildGovernanceSlackText, buildHoursNoticeText, sendSlackWebhook } from "../../utils/slackReport.js";
import { compactSprintLabel, findCurrentSprint } from "../../utils/sprints.js";
import { dateStamp, downloadCsv, exportWorkItemsCsv } from "../../utils/csvExport.js";
import {
  evidenceDedupeKey,
  evidenceEnv,
  evidenceEnvironments as parseEvidenceEnvironments,
  isQaEvidenceEntry,
  evidenceResultInfo,
  formatHours,
  itemAgeDays,
  normalizeResult,
  normalize,
  shortName
} from "../../utils/workbench/formatters.js";

const qaStatusConfig = {
  inQa: { label: "In QA", color: "#2563eb", bg: "#eff6ff", icon: "bi-check2-circle" },
  inBeta: { label: "In BETA", color: "#7c3aed", bg: "#f5f3ff", icon: "bi-flask" },
  readyBeta: { label: "Ready Beta", color: "#d97706", bg: "#fffbeb", icon: "bi-rocket-takeoff" },
  hmgCnk: { label: "HMG CNK", color: "#0891b2", bg: "#ecfeff", icon: "bi-flask" },
  readyProd: { label: "Ready Prod", color: "#16a34a", bg: "#f0fdf4", icon: "bi-shield-check" }
};

const qaStatusOrder = ["inQa", "inBeta", "readyBeta", "hmgCnk", "readyProd"];

function qaStatusInfo(state) {
  const key = normalize(state).replace(/[\s_-]+/g, "");
  const aliases = {
    inqa: "inQa",
    qa: "inQa",
    inbeta: "inBeta",
    beta: "inBeta",
    readytobeta: "readyBeta",
    readybeta: "readyBeta",
    readyforbeta: "readyBeta",
    hmgcnk: "hmgCnk",
    readytoprod: "readyProd",
    readyprod: "readyProd",
    readyforprod: "readyProd",
    readytoproduction: "readyProd"
  };
  const statusKeyValue = aliases[key] || "";
  return statusKeyValue ? { key: statusKeyValue, ...qaStatusConfig[statusKeyValue] } : { key: "", label: state || "-", color: "#64748b", bg: "#f8fafc", icon: "bi-list-check" };
}

function workTypeInfo(type) {
  const info = workItemTypes[type] || {};
  const icon = type === "Bug" ? "bi-bug-fill" : type === "Task" ? "bi-hammer" : type === "Feature" ? "bi-puzzle-fill" : type === "Epic" ? "bi-lightning-charge-fill" : "bi-book-fill";
  return { color: info.color || "#64748b", bg: info.background || "#f8fafc", icon, image: typeIconSrc(type) };
}

function exportQaCsv(itemsToExport) {
  exportWorkItemsCsv("qa-board", itemsToExport);
}

function identityNameVariants(value) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  const variants = [raw];
  const parenthesized = raw.match(/^([^()]+)\s*\(([^()]+)\)/);
  if (parenthesized) {
    variants.push(`${parenthesized[2]} ${parenthesized[1]}`);
    variants.push(`${parenthesized[1]} ${parenthesized[2]}`);
  }
  const parts = raw.replace(/[()]/g, " ").split(/\s+/).filter(Boolean);
  if (parts.length === 2) variants.push(`${parts[1]} ${parts[0]}`);
  if (parts.length > 2) variants.push(`${parts[parts.length - 1]} ${parts.slice(0, -1).join(" ")}`);
  return variants;
}

function qaIdentityTokens({ profile, user, collaborator }) {
  return [
    collaborator?.id,
    collaborator?.profileId,
    ...identityNameVariants(collaborator?.azureName),
    ...identityNameVariants(collaborator?.slackName),
    collaborator?.email,
    ...(collaborator?.aliases || []),
    profile?.id,
    ...identityNameVariants(profile?.displayName),
    ...identityNameVariants(profile?.fullName),
    profile?.email,
    user?.email
  ].filter(Boolean).map((value) => normalize(value)).filter(Boolean);
}

function identityMatches(tokens, ...values) {
  const haystack = normalize(values.filter(Boolean).join(" "));
  return Boolean(haystack) && tokens.some((token) => token && (haystack.includes(token) || token.includes(haystack)));
}

function collaboratorMatchesTokens(person, tokens) {
  return identityMatches(tokens, person?.id, person?.profileId, person?.azureName, person?.slackName, person?.email, ...(person?.aliases || []));
}

// Indexa colaboradores por TODO nome/apelido conhecido (azureName, slackName,
// aliases cadastrados e variacoes de ordem "Sobrenome, Nome"), nao apenas o
// azureName exato — evita criar um card duplicado quando o nome exibido pelo
// Azure para a mesma pessoa nao bate 100% com o azureName cadastrado.
function buildCollaboratorNameIndex(collaborators) {
  const map = new Map();
  (collaborators || []).forEach((person) => {
    const names = [
      person.azureName,
      ...identityNameVariants(person.azureName),
      person.slackName,
      ...identityNameVariants(person.slackName),
      ...(person.aliases || [])
    ].filter(Boolean);
    names.forEach((name) => {
      const key = normalize(name);
      if (key && !map.has(key)) map.set(key, person);
    });
  });
  return map;
}

function findCollaboratorByName(index, rawName) {
  if (!rawName) return null;
  const direct = index.get(normalize(rawName));
  if (direct) return direct;
  return identityNameVariants(rawName).map((variant) => index.get(normalize(variant))).find(Boolean) || null;
}

function evidenceMatchesTokens(entry, tokens) {
  return identityMatches(
    tokens,
    entry?.authorId,
    entry?.author,
    entry?.authorName,
    entry?.authorEmail,
    entry?.authorUniqueName,
    entry?.qaName,
    entry?.createdBy,
    entry?.modifiedBy
  );
}

function normalizeEvidenceResult(result) {
  const value = normalize(result);
  if (["approved", "approve", "pass", "passed", "ok"].includes(value)) return "pass";
  if (["fail", "failed", "reproved", "reprovado"].includes(value)) return "fail";
  if (["limitation", "limitacao", "limitação", "blocked"].includes(value)) return "limitation";
  return value || "pending";
}

// Sempre mescla test_evidence (fonte confiavel, gravada pelo proprio Stark
// Hub) com discussionEvidence (best-effort, extraida de comentarios do
// Azure) — usar so o segundo deixava os resumos de teste vazios sempre que
// o fetch em lote de discussions falhava (ver azureWorkItemDetail).
function recordsForItem(item, evidence = []) {
  const own = evidence.filter((entry) => String(entry.workItemId) === String(item.id));
  const fromDiscussion = (item.discussionEvidence || item.evidence || []).filter((entry) => normalizeEvidenceResult(entry.result || entry.status) !== "pending" && isQaEvidenceEntry(entry));
  const source = fromDiscussion.length ? fromDiscussion : own;
  const seen = new Set();
  return source.filter((entry) => {
    const key = evidenceDedupeKey({ ...entry, workItemId: entry.workItemId || item.id });
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sortedEvidenceRecords(records = []) {
  return records.slice().sort((a, b) => String(a.createdAt || a.createdDate || "").localeCompare(String(b.createdAt || b.createdDate || "")));
}

function evidenceTransitionLabel(records = []) {
  const labels = sortedEvidenceRecords(records).map((entry) => evidenceResultInfo(entry.result || entry.status).label);
  const compressed = [];
  labels.forEach((label) => {
    const last = compressed[compressed.length - 1];
    if (last?.label === label) last.count += 1;
    else compressed.push({ label, count: 1 });
  });
  return compressed.map((entry) => `${entry.label}${entry.count > 1 ? ` x${entry.count}` : ""}`).join(" -> ");
}

function evidenceTooltip(records = []) {
  return sortedEvidenceRecords(records).map((entry) => {
    const info = evidenceResultInfo(entry.result || entry.status);
    const when = entry.createdAt || entry.createdDate ? new Date(entry.createdAt || entry.createdDate).toLocaleString("pt-BR") : "-";
    return `${info.label} ${evidenceEnvironments(entry).join("/") || "N/A"} - ${entry.authorName || entry.author || "QA"} - ${when}`;
  }).join("\n") || "Sem evidencias";
}

function EvidenceRunFlow({ records = [], limit = 8 }) {
  const ordered = sortedEvidenceRecords(records).slice(-limit);
  if (!ordered.length) return <span className="mbaz-evidence-pending"><i className="bi bi-dash-lg mbaz-evidence-pending-icon" /></span>;
  return (
    <span className="mbaz-evidence-run-flow">
      {ordered.map((entry, index) => {
        const info = evidenceResultInfo(entry.result || entry.status);
        return (
          <React.Fragment key={entry.id || `${entry.workItemId}-${entry.createdAt || index}`}>
            {index > 0 && <span className="mbaz-evidence-run-arrow">-&gt;</span>}
            <span className={`mbaz-evidence-run-group ${info.className}`}><i className={`bi ${info.icon}`} /></span>
          </React.Fragment>
        );
      })}
    </span>
  );
}

function environmentsWithEvidence(records = []) {
  return ["QA", "BETA", "DEV", "PROD"].filter((environment, index) => index < 2 || records.some((entry) => evidenceRecordHasEnvironment(entry, environment)));
}

function evidenceEnvironments(entry) {
  return parseEvidenceEnvironments(entry);
}

function evidenceRecordHasEnvironment(entry, environment) {
  return evidenceEnvironments(entry).includes(environment);
}

function evidenceRecordsForEnvironment(records = [], environment) {
  return records.filter((entry) => evidenceRecordHasEnvironment(entry, environment));
}

export function QaBoardWorkbench() {
  const { profile, demoMode } = useAuth();
  const { items, updateItem, addItem, reload, loading, refreshing, needsAzureIntegration, error } = useWorkItems();
  const { collaborators } = useCollaborators();
  const { evidence, reload: reloadEvidence } = useTestEvidence();
  const [search, setSearch] = usePersistentState("starkHubFilters:qaBoard:search", "");
  const [showCreate, setShowCreate] = useState(false);
  const [viewMode, setViewMode] = usePersistentState("starkHubFilters:qaBoard:viewMode", "grid");
  const [filtersOpen, setFiltersOpen] = usePersistentState("starkHubFilters:qaBoard:filtersOpen", false);
  const [showExcluded, setShowExcluded] = usePersistentState("starkHubFilters:qaBoard:showExcluded", false);
  const [personFilter, setPersonFilter] = usePersistentState("starkHubFilters:qaBoard:person", []);
  const [countryFilter, setCountryFilter] = usePersistentState("starkHubFilters:qaBoard:country", []);
  const [qaFilter, setQaFilter] = usePersistentState("starkHubFilters:qaBoard:qa", []);
  const [statusFilter, setStatusFilter] = usePersistentState("starkHubFilters:qaBoard:status", []);
  const [resultFilter, setResultFilter] = usePersistentState("starkHubFilters:qaBoard:result", []);
  const [sprintFilter, setSprintFilter] = usePersistentState("starkHubFilters:qaBoard:sprint", []);
  const [sprintSearch, setSprintSearch] = useState("");
  const [sprintOpen, setSprintOpen] = useState(false);
  const sprintFilterRef = useRef(null);
  const [iterationFrom, setIterationFrom] = usePersistentState("starkHubFilters:qaBoard:iterationFrom", "");
  const [iterationTo, setIterationTo] = usePersistentState("starkHubFilters:qaBoard:iterationTo", "");
  const [sort, setSort] = usePersistentState("starkHubFilters:qaBoard:sort", "changed_desc");
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [chartsCollapsed, setChartsCollapsed] = usePersistentState("starkHubFilters:qaBoard:chartsCollapsed", false);
  const [newItem, setNewItem] = useState({ type: "Bug", country: "BR", title: "", state: "In QA" });
  const { activeItem, openItem: setActiveItem, closeItem: closeActiveItem } = usePersistentActiveWorkItem("starkHubActiveWorkItem:qaBoard", items);

  const byId = useMemo(() => new Map(collaborators.map((person) => [person.id, person])), [collaborators]);
  const devPeople = collaborators.filter((person) => person.isDev);
  const qaPeople = collaborators.filter((person) => person.isQa);
  const evidenceById = useMemo(() => {
    const map = new Map();
    items.forEach((item) => {
      map.set(Number(item.id), recordsForItem(item, evidence));
    });
    map.forEach((records, key) => {
      map.set(key, records.slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))));
    });
    return map;
  }, [evidence, items]);

  const boardItems = items.filter((item) => {
    const hasQaState = Boolean(qaStatusInfo(item.state).key);
    const excluded = (item.tags || []).some((tag) => /untestable|technical debt|not testable/i.test(tag));
    const testableType = ["Bug", "User Story"].includes(item.type);
    return testableType && hasQaState && (showExcluded || !excluded);
  });

  const sprintOptions = Array.from(new Set(boardItems.map((item) => item.sprint || item.iteration).filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b), "pt-BR"));
  const currentSprint = findCurrentSprint(sprintOptions);
  const filteredSprintOptions = sprintOptions.filter((sprint) => normalize(sprint).includes(normalize(sprintSearch)));
  const personOptions = devPeople.map((person) => ({ value: person.id, label: person.azureName, person }));
  const countryOptions = Object.keys(countries).map((code) => ({ value: code, label: `${code} - ${countries[code].label}` }));
  const qaOptions = [{ value: "", label: "Nao definido" }, ...qaPeople.map((person) => ({ value: person.id, label: person.azureName, person }))];
  const statusOptions = qaStatusOrder.map((key) => ({ value: key, label: qaStatusConfig[key].label }));
  const resultOptions = [
    { value: "pending", label: "Pending" },
    { value: "pass", label: "Approved" },
    { value: "fail", label: "Fail" },
    { value: "limitation", label: "Limitation" }
  ];

  const activeSprintRange = useMemo(() => {
    if (!iterationFrom && !iterationTo) return [];
    const fromIndex = iterationFrom ? sprintOptions.indexOf(iterationFrom) : 0;
    const toIndex = iterationTo ? sprintOptions.indexOf(iterationTo) : sprintOptions.length - 1;
    if (fromIndex < 0 || toIndex < 0) return [];
    const start = Math.min(fromIndex, toIndex);
    const end = Math.max(fromIndex, toIndex);
    return sprintOptions.slice(start, end + 1);
  }, [iterationFrom, iterationTo, sprintOptions]);

  const effectiveSprintFilter = sprintFilter.length ? sprintFilter : activeSprintRange.length ? activeSprintRange : currentSprint ? [currentSprint] : [];
  const filterCount = [personFilter, countryFilter, qaFilter, statusFilter, resultFilter, effectiveSprintFilter].filter((value) => value.length).length + (showExcluded ? 1 : 0);

  const filtered = boardItems
    .filter((item) => {
      const query = normalize(search);
      if (query && !normalize(`${item.id} ${item.title} ${item.assigneeName} ${(item.countries || []).join(" ")}`).includes(query)) return false;
      if (personFilter.length && !personFilter.includes(item.assigneeId)) return false;
      if (countryFilter.length && !(item.countries || []).some((country) => countryFilter.includes(country))) return false;
      if (qaFilter.length && !qaFilter.includes(item.qaCollaboratorId || "")) return false;
      if (statusFilter.length && !statusFilter.includes(qaStatusInfo(item.state).key)) return false;
      const records = evidenceById.get(Number(item.id)) || [];
      const effectiveResult = records[0]?.result || item.lastTestResult || "pending";
      if (resultFilter.length && !resultFilter.includes(effectiveResult)) return false;
      if (effectiveSprintFilter.length && !effectiveSprintFilter.includes(item.sprint || item.iteration)) return false;
      return true;
    })
    .sort((a, b) => {
      if (sort === "title_asc") return String(a.title).localeCompare(String(b.title), "pt-BR");
      if (sort === "title_desc") return String(b.title).localeCompare(String(a.title), "pt-BR");
      if (sort === "bug_first") return (a.type === "Bug" ? -1 : 1) - (b.type === "Bug" ? -1 : 1);
      if (sort === "story_first") return (a.type === "User Story" ? -1 : 1) - (b.type === "User Story" ? -1 : 1);
      return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
    });

  const filteredCounts = qaStatusOrder.reduce((acc, key) => ({ ...acc, [key]: filtered.filter((item) => qaStatusInfo(item.state).key === key).length }), {});
  const qaMetrics = ["", ...qaPeople.map((person) => person.id)].map((id, index) => {
    const person = byId.get(id);
    const count = filtered.filter((item) => (item.qaCollaboratorId || "") === id).length;
    return { id, label: person?.azureName || "Nao definido", count, color: person?.color || ["#64748b", "#2563eb", "#16a34a", "#d97706", "#7c3aed"][index % 5] };
  });
  const countriesInBoard = Array.from(new Set(filtered.flatMap((item) => item.countries || []))).sort();

  useEffect(() => {
    const target = consumePendingWorkItemHighlight() || readWorkItemHash();
    if (target) window.setTimeout(() => highlightWorkItem(target), 250);
  }, [filtered.length]);

  function clearFilters() {
    setPersonFilter([]);
    setCountryFilter([]);
    setQaFilter([]);
    setStatusFilter([]);
    setResultFilter([]);
    setSprintFilter([]);
    setIterationFrom("");
    setIterationTo("");
    setShowExcluded(false);
  }

  useEffect(() => {
    if (!sprintOpen) return undefined;
    function handleOutsideClick(event) {
      if (sprintFilterRef.current && !sprintFilterRef.current.contains(event.target)) setSprintOpen(false);
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [sprintOpen]);

  function toggleAllTests() {
    setExpandedIds((current) => current.size === filtered.length ? new Set() : new Set(filtered.map((item) => Number(item.id))));
  }

  function toggleExpanded(id) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(Number(id))) next.delete(Number(id));
      else next.add(Number(id));
      return next;
    });
  }

  async function createItem(event) {
    event.preventDefault();
    if (!newItem.title.trim()) return;
    await addItem({
      id: Date.now(),
      type: newItem.type,
      title: newItem.title.trim(),
      state: newItem.state,
      env: "qa",
      countries: [newItem.country],
      assigneeId: devPeople[0]?.id,
      assigneeName: devPeople[0]?.azureName,
      updatedAt: new Date().toISOString()
    });
    setNewItem((current) => ({ ...current, title: "" }));
    setShowCreate(false);
  }

  function renderEvidenceJourney(item, environment) {
    const records = evidenceRecordsForEnvironment(evidenceById.get(Number(item.id)) || [], environment);
    if (!records.length) return <div className="mbaz-evidence-pending"><i className="bi bi-dash-lg mbaz-evidence-pending-icon" /></div>;
    return (
      <button type="button" className="mbaz-evidence-journey" title={`${evidenceTransitionLabel(records)}\n\n${evidenceTooltip(records)}`}>
        <EvidenceRunFlow records={records} limit={8} />
      </button>
    );
  }

  function prBadgeFor(item) {
    const env = String(item.pipelineEnv || item.prEnvironment || item.env || "").toUpperCase();
    const label = env === "QA" || env === "BETA" || env === "PROD" ? env : "N/A";
    const url = item.prUrl || item.pullRequestUrl || item.pipelineUrl || "";
    const className = label === "N/A" ? "none" : label.toLowerCase();
    return (
      <button
        type="button"
        className={`mbaz-pr-env-pill ${className}`}
        disabled={!url}
        title={url ? `Abrir PR/Pipeline: ${label}` : "Nenhuma evidencia de PR/Pipeline localizada"}
        onClick={() => url && window.open(url, "_blank", "noopener,noreferrer")}
      >
        <i className="bi bi-git" />
        <span>{label}</span>
      </button>
    );
  }

  function renderCard(item) {
    const status = qaStatusInfo(item.state);
    const type = workTypeInfo(item.type);
    const assignee = byId.get(item.assigneeId) || (item.assigneeName || item.assigneeImageUrl ? { azureName: item.assigneeName, imageUrl: item.assigneeImageUrl } : null);
    const records = evidenceById.get(Number(item.id)) || [];
    const latest = records[0];
    const latestInfo = evidenceResultInfo(latest?.result || item.lastTestResult);
    const age = itemAgeDays(item);
    const expanded = expandedIds.has(Number(item.id));
    const visibleTags = (item.tags || []).filter((tag) => !/^0-/.test(tag));

    return (
      <article key={item.id} className={`mbaz-card ${expanded ? "expanded" : ""} ${age >= 7 ? "mbaz-critical-highlight" : ""}`} data-id={item.id} data-work-item-id={item.id} data-work-item-type={String(item.type || "work item").toLowerCase()} style={{ borderLeftColor: type.color, "--wi-type-color": type.color, "--wi-type-bg": type.bg }}>
        <div className="mbaz-card-row mbaz-card-topline">
          <div className="mbaz-card-left">
            <span className={`mbaz-pill state ${status.key?.startsWith("ready") ? "ready" : ""}`} style={{ background: status.bg, color: status.color }}><i className={`bi ${status.icon}`} />{status.label}</span>
          </div>
          <div className="mbaz-card-right">{prBadgeFor(item)}</div>
        </div>
        <div className="mbaz-card-row mbaz-card-title-row">
          <div className="mbaz-card-left">
            <span className="mbaz-type-icon" title={item.type}><img src={type.image} alt={item.type} /></span>
            <button className="mbaz-id" type="button" onClick={() => setActiveItem(item)}>{formatWorkItemCode(item.id, item.type)}</button>
            <span className="mbaz-item-title" title={item.title}>{item.title}</span>
          </div>
        </div>
        <div className="mbaz-card-row">
          <div className="mbaz-card-left">
            <CountryPills codes={item.countries || []} />
            <span className="mbaz-sprint-pill" title={item.sprint || item.iteration || ""}>{compactSprintLabel(item.sprint || item.iteration)}</span>
          </div>
          <div className="mbaz-card-right mbaz-meta">
            {age > 0 && <span className={`mbaz-pill ${age >= 7 ? "hot" : ""}`} title="Ultima alteracao">{age}d</span>}
            {visibleTags.slice(0, 2).map((tag) => <span key={tag} className={`mbaz-pill ${/block|imped|critical|hotfix/i.test(tag) ? "hot" : ""}`}>{tag}</span>)}
          </div>
        </div>
        <div className="mbaz-card-row mbaz-card-people-row">
          <div className="mbaz-card-left"><AvatarDot person={assignee} name={item.assigneeName} /></div>
          <div className="mbaz-card-right mbaz-card-test-owner">
            <button type="button" className={`mbaz-test-summary ${latestInfo.className}`} onClick={() => toggleExpanded(item.id)} aria-expanded={expanded}>
              <i className={`bi ${latestInfo.icon}`} /><span>{latest ? evidenceEnvironments(latest)[0] || "N/A" : "Pending"}</span>{records.length > 1 && <span>+{records.length - 1}</span>}
            </button>
            <QaPicker value={item.qaCollaboratorId || ""} onChange={(qaCollaboratorId) => updateItem(item.id, { qaCollaboratorId: qaCollaboratorId || null })} people={qaPeople} />
          </div>
        </div>
        <div className="mbaz-card-expand-panel" hidden={!expanded}>
          <div className="mbaz-card-test-details mbaz-card-test-journeys">
            {environmentsWithEvidence(records).map((environment) => {
              const envRecords = evidenceRecordsForEnvironment(records, environment);
              return (
                <div key={environment} className="mbaz-evidence-env-block mbaz-card-test-env" data-env={environment}>
                  <div className="mbaz-evidence-env-label">
                    <span className="mbaz-evidence-env-count">{envRecords.length}</span>
                    <span className="mbaz-evidence-env-name">{environment}</span>
                    <span className="mbaz-evidence-help" title="Cada icone representa a sequencia dos resultados registrados.">?</span>
                  </div>
                  {renderEvidenceJourney(item, environment)}
                </div>
              );
            })}
            {!environmentsWithEvidence(records).length && <div className="mbaz-evidence-pending"><i className="bi bi-dash-lg mbaz-evidence-pending-icon" /> Sem testes registrados</div>}
          </div>
        </div>
      </article>
    );
  }

  return (
    <section className="mbaz-react-shell">
      <aside id="mbaz-sidebar" className="open fullscreen">
        <div className="mbaz-header">
          <div className="mbaz-title">
            <strong>Stark Hub</strong><small>Quality Board</small>
            <span id="mbaz-context">{profile?.azureOrgUrl || "Azure DevOps"} / {profile?.azureProject || "Projeto"} / {profile?.azureTeam || "Time"}</span>
          </div>
          <div className="mbaz-actions">
            {demoMode && <span className="stark-badge-demo">demo</span>}
            <button className="mbaz-icon-btn" type="button" title="Tela cheia"><i className="bi bi-arrows-fullscreen" /></button>
          </div>
        </div>
        <div className="mbaz-tabs">
          <div className="mbaz-search"><FiSearch /><input id="mbaz-search" className="mbaz-input" placeholder="Buscar por id, titulo, pessoa, pais..." value={search} onChange={(event) => setSearch(event.target.value)} /></div>
          <button id="mbaz-toggle-create" className="mbaz-btn" type="button" onClick={() => setShowCreate((value) => !value)}>Novo</button>
          <button id="mbaz-view-toggle" className="mbaz-icon-btn" type="button" title="Alternar grid" onClick={() => setViewMode((value) => value === "grid" ? "list" : "grid")}><i className={`bi ${viewMode === "grid" ? "bi-view-list" : "bi-grid-3x3-gap"}`} /></button>
          <button id="mbaz-refresh" className="mbaz-btn mbaz-primary" type="button" onClick={reload}><i className={`bi bi-arrow-clockwise ${refreshing ? "mbw-spin" : ""}`} /> Atualizar</button>
          <button id="mbaz-export" className="mbaz-icon-btn" type="button" title="Exportar CSV" onClick={() => exportQaCsv(filtered)}><i className="bi bi-download" /></button>
        </div>
        <div className="mbaz-content">
          <ConnectionGate needsAzureIntegration={needsAzureIntegration} error={error}>
            <details id="mbaz-filter-acc" className="mbaz-filter-acc" open={filtersOpen} onToggle={(event) => setFiltersOpen(event.currentTarget.open)}>
              <summary><span>Filtros <small id="mbaz-filter-summary">{filterCount ? `${filterCount} aplicado(s)` : ""}</small></span><span id="mbaz-filter-count">{filterCount} ativos</span></summary>
              <div className="mbaz-filter-body">
                <div id="mbaz-normal-filters" className="mbaz-filters">
                  <FilterCombobox label="Pessoa" options={personOptions} values={personFilter} onChange={setPersonFilter} placeholder="Buscar pessoa" renderOption={(option) => option.person ? <AvatarDot person={option.person} name={option.label} /> : option.label} />
                  <FilterCombobox label="Pais" options={countryOptions} values={countryFilter} onChange={setCountryFilter} placeholder="Buscar pais" renderOption={(option) => <span className="mbw-combobox-country"><CountryVisual code={option.value} compact /> {option.label}</span>} />
                  <FilterCombobox label="QA" options={qaOptions} values={qaFilter} onChange={setQaFilter} placeholder="Buscar QA" renderOption={(option) => option.person ? <AvatarDot person={option.person} name={option.label} /> : option.label} />
                  <FilterCombobox label="Status" options={statusOptions} values={statusFilter} onChange={setStatusFilter} placeholder="Buscar status" />
                  <FilterCombobox label="Resultado" options={resultOptions} values={resultFilter} onChange={setResultFilter} placeholder="Buscar resultado" />
                  <div className="mbaz-sort-wrap"><label>Detalhes dos testes</label><button id="mbaz-toggle-all-tests" className="mbaz-btn" type="button" aria-pressed={expandedIds.size > 0} onClick={toggleAllTests}>{expandedIds.size === filtered.length && filtered.length ? "Recolher todos" : "Expandir todos"}</button></div>
                  <div className="mbaz-sort-wrap"><label>Ordenar</label><select id="mbaz-sort" className="mbaz-select" value={sort} onChange={(event) => setSort(event.target.value)}><option value="changed_desc">Mais recentes</option><option value="title_asc">A-Z</option><option value="title_desc">Z-A</option><option value="bug_first">Bug primeiro</option><option value="story_first">User Story primeiro</option></select></div>
                  <div id="mbaz-sprint-filter" ref={sprintFilterRef} className={`mbw-combobox ${sprintOpen ? "open" : ""}`} data-kind="sprint">
                    <button type="button" className="mbw-combobox-trigger" onClick={() => setSprintOpen((value) => !value)}>
                      <span>Board</span>
                      <b>{effectiveSprintFilter.length ? `${effectiveSprintFilter.length} sprint(s)` : "selecione"}</b>
                      <i className={`bi ${sprintOpen ? "bi-chevron-up" : "bi-chevron-down"}`} />
                    </button>
                    {sprintOpen && (
                      <div className="mbw-combobox-menu">
                        <input id="mbaz-sprint-search" value={sprintSearch} onChange={(event) => setSprintSearch(event.target.value)} placeholder="Buscar sprint" autoFocus />
                        <div className="mbaz-dd-grid">
                          <div>
                            <label htmlFor="mbaz-iteration-from">DE</label>
                            <select id="mbaz-iteration-from" className="mbaz-select" value={iterationFrom} onChange={(event) => { setIterationFrom(event.target.value); setSprintFilter([]); }}>
                              <option value="">Primeira</option>
                              {sprintOptions.map((sprint) => <option key={sprint} value={sprint}>{compactSprintLabel(sprint)}</option>)}
                            </select>
                          </div>
                          <div>
                            <label htmlFor="mbaz-iteration-to">ATE</label>
                            <select id="mbaz-iteration-to" className="mbaz-select" value={iterationTo} onChange={(event) => { setIterationTo(event.target.value); setSprintFilter([]); }}>
                              <option value="">Ultima</option>
                              {sprintOptions.map((sprint) => <option key={sprint} value={sprint}>{compactSprintLabel(sprint)}</option>)}
                            </select>
                          </div>
                        </div>
                        <div id="mbaz-sprint-list" className="mbw-combobox-options">
                          {filteredSprintOptions.map((sprint) => {
                            const checked = sprintFilter.includes(sprint);
                            return (
                              <button key={sprint} type="button" className={`mbw-combobox-option ${checked ? "active" : ""}`} onClick={() => { setIterationFrom(""); setIterationTo(""); setSprintFilter((current) => current.includes(sprint) ? current.filter((item) => item !== sprint) : [...current, sprint]); }}>
                                <span className="mbw-combobox-check">{checked && <i className="bi bi-check-lg" />}</span>
                                <span className="mbw-combobox-label">{compactSprintLabel(sprint)}</span>
                              </button>
                            );
                          })}
                          {!filteredSprintOptions.length && <span className="mbw-combobox-empty">Nenhuma sprint</span>}
                        </div>
                        <div className="mbw-combobox-actions">
                          <button id="mbaz-sprint-all" type="button" onClick={() => { setSprintFilter(sprintOptions); setIterationFrom(""); setIterationTo(""); }}>Todas as sprints</button>
                          <button id="mbaz-sprint-clear" type="button" onClick={() => { setSprintFilter([]); setIterationFrom(""); setIterationTo(""); }}>Limpar</button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="mbaz-filter-actions">
                  <label className="mbaz-filter-checkbox"><input type="checkbox" checked={showExcluded} onChange={(event) => setShowExcluded(event.target.checked)} /><span>Mostrar itens nao testaveis / divida tecnica</span></label>
                  <button id="mbaz-clear-filters" className="mbaz-btn" type="button" onClick={clearFilters}>Limpar filtros</button>
                </div>
              </div>
            </details>
            <div id="mbaz-dashboard" className={`mbaz-dashboard ${chartsCollapsed ? "collapsed" : ""}`}>
              <div id="mbaz-summary" className="mbaz-summary">
                {loading ? <KpiSkeleton count={6} /> : (
                  <>
                    <Kpi label="Total" value={filtered.length} percent={100} icon="bi-list-check" active={!statusFilter.length} onClick={() => setStatusFilter([])} />
                    {qaStatusOrder.map((key) => <Kpi key={key} label={qaStatusConfig[key].label} value={filteredCounts[key]} percent={filtered.length ? Math.round((filteredCounts[key] / filtered.length) * 100) : 0} active={statusFilter.includes(key)} color={qaStatusConfig[key].color} icon={qaStatusConfig[key].icon} onClick={() => setStatusFilter((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])} />)}
                  </>
                )}
              </div>
              {loading ? (
                <div className="mbaz-chart"><ChartSkeleton rows={3} /></div>
              ) : (
                <div id="mbaz-chart" className="mbaz-chart">
                  <div className="mbaz-chart-head"><h3>Distribuicao por status</h3><span>{filtered.length} item(s)</span></div>
                  <div className="mbaz-stacked">
                    {qaStatusOrder.map((key) => {
                      const percent = filtered.length ? Math.round((filteredCounts[key] / filtered.length) * 100) : 0;
                      return (
                        <span key={key} className="mbaz-stack-seg" title={`${qaStatusConfig[key].label}: ${filteredCounts[key]} (${percent}%)`} style={{ width: `${filtered.length ? Math.max(2, (filteredCounts[key] / filtered.length) * 100) : 0}%`, background: qaStatusConfig[key].color }}>
                          {percent >= 10 && <em>{filteredCounts[key]}</em>}
                        </span>
                      );
                    })}
                  </div>
                  <div className="mbaz-legend">{qaStatusOrder.map((key) => <span key={key} className="mbaz-legend-item"><i className="mbaz-legend-dot" style={{ background: qaStatusConfig[key].color }} />{qaStatusConfig[key].label} {filteredCounts[key]}/{filtered.length ? Math.round((filteredCounts[key] / filtered.length) * 100) : 0}%</span>)}</div>
                </div>
              )}
              {loading ? (
                <div className="mbaz-qa-metrics"><ChartSkeleton rows={3} /></div>
              ) : (
                <div id="mbaz-qa-metrics" className="mbaz-qa-metrics">
                  <div className="mbaz-chart-head"><h3>Carga por QA</h3><span>{filtered.length} item(s)</span></div>
                  <div className="mbaz-qa-bar">
                    {qaMetrics.map((row) => {
                      const percent = filtered.length ? Math.round((row.count / filtered.length) * 100) : 0;
                      return (
                        <span key={row.id || "none"} className={`mbaz-qa-seg ${qaFilter.includes(row.id) ? "active" : ""}`} title={`${row.label}: ${row.count} (${percent}%)`} style={{ width: `${filtered.length ? Math.max(row.count ? 2 : 0, (row.count / filtered.length) * 100) : 0}%`, background: row.color }}>
                          {percent >= 10 && <em>{row.count}</em>}
                        </span>
                      );
                    })}
                  </div>
                  <div className="mbaz-qa-legend">{qaMetrics.map((row) => <button key={row.id || "none"} type="button" className={`mbaz-qa-legend-item ${qaFilter.includes(row.id) ? "active" : ""}`} onClick={() => setQaFilter((current) => current.includes(row.id) ? current.filter((item) => item !== row.id) : [...current, row.id])}><i className="mbaz-legend-dot" style={{ background: row.color }} />{row.label} <strong>{row.count}</strong></button>)}</div>
                </div>
              )}
              {loading ? (
                <div className="mbaz-country-state"><ChartSkeleton rows={5} /></div>
              ) : (
                <CountryStateMatrix countriesInBoard={countriesInBoard} items={filtered} statusOrder={qaStatusOrder} statusConfig={qaStatusConfig} resolveStatus={qaStatusInfo} />
              )}
              <div id="mbaz-refresh-history" className="mbaz-refresh-history">Ultima atualizacao: {new Date().toLocaleTimeString("pt-BR")}</div>
              <button id="mbaz-toggle-charts" className="mbaz-btn mbaz-chart-toggle" type="button" onClick={() => setChartsCollapsed((value) => !value)}>
                <i className={`bi ${chartsCollapsed ? "bi-chevron-down" : "bi-chevron-up"}`} />
                <span>{chartsCollapsed ? "Mostrar graficos" : "Ocultar graficos"}</span>
              </button>
            </div>
            <div id="mbaz-panel-board" className="mbaz-panel">
              <form id="mbaz-create-form" className={`mbaz-create ${showCreate ? "open" : ""}`} onSubmit={createItem}>
                <div className="mbaz-create-grid">
                  <label>Tipo<select className="mbaz-select" value={newItem.type} onChange={(event) => setNewItem((current) => ({ ...current, type: event.target.value }))}><option value="Bug">Bug</option><option value="Task">Task</option><option value="User Story">User Story</option></select></label>
                  <label>Pais<select className="mbaz-select" value={newItem.country} onChange={(event) => setNewItem((current) => ({ ...current, country: event.target.value }))}>{Object.keys(countries).map((code) => <option key={code} value={code}>{code}</option>)}</select></label>
                  <label className="mbaz-field-full">Titulo<input className="mbaz-input" value={newItem.title} onChange={(event) => setNewItem((current) => ({ ...current, title: event.target.value }))} /></label>
                  <button className="mbaz-btn mbaz-primary" type="submit">Criar</button>
                </div>
              </form>
              <div id="mbaz-results" className={`mbaz-results ${viewMode === "grid" ? "grid" : ""}`}>
                {loading ? <WorkbenchCardSkeleton rows={8} mode={viewMode === "grid" ? "grid" : "list"} /> : filtered.length ? filtered.map(renderCard) : <div className="mbaz-empty">Nenhum work item encontrado.</div>}
              </div>
            </div>
          </ConnectionGate>
        </div>
      </aside>
      {activeItem && (
        <ErrorBoundary
          fallback={(error) => (
            <div className="mbaz-new-modal-overlay">
              <div className="stark-error-boundary" onClick={(event) => event.stopPropagation()}>
                <strong>Nao foi possivel abrir este Work Item.</strong>
                <p>{error?.message || "Erro desconhecido ao renderizar o modal."}</p>
                <button type="button" onClick={closeActiveItem}>Fechar</button>
              </div>
            </div>
          )}
        >
          <AzureWorkItemModal
            profile={profile}
            item={activeItem}
            evidence={evidence}
            onClose={closeActiveItem}
            onTestResult={(item, patch) => updateItem(item.id, patch)}
            onUpdateItem={(patch) => updateItem(activeItem.id, patch)}
          />
        </ErrorBoundary>
      )}
    </section>
  );
}

export function MyItemsWorkbench() {
  const { profile, user, demoMode } = useAuth();
  const { items, loading, refreshing, updateItem, addItem, reload, needsAzureIntegration, error } = useWorkItems();
  const { collaborators } = useCollaborators();
  const { evidence } = useTestEvidence();
  const { getSetting } = useAppSettings();
  const [search, setSearch] = usePersistentState("starkHubFilters:myItems:search", "");
  const [hoursFilter, setHoursFilter] = usePersistentState("starkHubFilters:myItems:hours", "all");
  const [types, setTypes] = usePersistentState("starkHubFilters:myItems:types", () => profile?.accessLevel === accessLevels.qa ? ["Task", "Bug", "User Story"] : ["Task", "Bug"]);
  const [countryFilter, setCountryFilter] = usePersistentState("starkHubFilters:myItems:country", []);
  const [tagFilter, setTagFilter] = usePersistentState("starkHubFilters:myItems:tag", []);
  const [statusFilter, setStatusFilter] = usePersistentState("starkHubFilters:myItems:status", []);
  const [sprintFilter, setSprintFilter] = usePersistentState("starkHubFilters:myItems:sprint", []);
  const [environmentFilter, setEnvironmentFilter] = usePersistentState("starkHubFilters:myItems:environment", []);
  const [testResultFilter, setTestResultFilter] = usePersistentState("starkHubFilters:myItems:result", []);
  const [groupBy, setGroupBy] = usePersistentState("starkHubFilters:myItems:groupBy", "none");
  const [summaryCollapsed, setSummaryCollapsed] = usePersistentState("starkHubFilters:myItems:summaryCollapsed", false);
  const [filtersCollapsed, setFiltersCollapsed] = usePersistentState("starkHubFilters:myItems:filtersCollapsed", false);
  const [insightsCollapsed, setInsightsCollapsed] = usePersistentState("starkHubFilters:myItems:insightsCollapsed", false);
  const [viewMode, setViewMode] = usePersistentState("starkHubFilters:myItems:viewMode", "list");
  const [fullscreen, setFullscreen] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const { activeItem, openItem: setActiveItem, closeItem: closeActiveItem } = usePersistentActiveWorkItem("starkHubActiveWorkItem:myItems", items);
  const [hoursTarget, setHoursTarget] = useState(null);
  const [workedHours, setWorkedHours] = useState("");
  const [hoursError, setHoursError] = useState("");
  const myCollaborator = collaborators.find((person) => person.profileId === profile?.id)
    || collaborators.find((person) => normalize(person.azureName) && normalize(person.azureName) === normalize(profile?.displayName || profile?.fullName))
    || collaborators.find((person) => collaboratorMatchesTokens(person, qaIdentityTokens({ profile, user, collaborator: null })))
    || null;
  const isQaUser = profile?.accessLevel === accessLevels.qa || Boolean(myCollaborator?.isQa);
  useEffect(() => {
    if (isQaUser) setTypes((current) => Array.from(new Set([...current, "User Story"])));
  }, [isQaUser]);
  const identityName = profile?.displayName || profile?.fullName || user?.email || "Usuario logado";
  const identityNeedle = normalize(`${identityName} ${user?.email || ""}`);
  const assignedToMe = items.filter((item) => {
    const tokens = qaIdentityTokens({ profile, user, collaborator: myCollaborator });
    if (demoMode) return item.assigneeId === myCollaborator?.id || item.assigneeName === identityName || item.assigneeId || !myCollaborator;
    if (myCollaborator && item.assigneeId === myCollaborator.id) return true;
    if (identityMatches(tokens, item.assigneeId, item.assigneeName, item.assigneeEmail, item.assignedTo, item.assignedToEmail)) return true;
    if (item.assigneeName && identityNeedle.includes(normalize(item.assigneeName))) return true;
    if (item.assigneeName && normalize(item.assigneeName).includes(normalize(identityName))) return true;
    return false;
  });
  const localEvidenceByWorkItem = useMemo(() => {
    const map = new Map();
    evidence.forEach((entry) => {
      const key = String(entry.workItemId);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(entry);
    });
    return map;
  }, [evidence]);
  const qaTokens = useMemo(() => qaIdentityTokens({ profile, user, collaborator: myCollaborator }), [myCollaborator, profile, user]);
  const qaAssignedToMe = isQaUser
    ? items.filter((item) => {
      if (myCollaborator && item.qaCollaboratorId === myCollaborator.id) return true;
      const qaPerson = collaborators.find((person) => person.id === item.qaCollaboratorId);
      if (qaPerson && collaboratorMatchesTokens(qaPerson, qaTokens)) return true;
      return identityMatches(qaTokens, item.qaCollaboratorId, item.qaName, item.qaResponsible, item.qaResponsibleName, item.qaResponsibleEmail);
    })
    : [];
  const qaTestedByMe = isQaUser
    ? items.filter((item) => {
      const records = recordsForItem(item, evidence);
      return records.some((entry) => evidenceMatchesTokens(entry, qaTokens));
    })
    : [];
  const mineById = new Map();
  function addMine(item, source) {
    const current = mineById.get(item.id);
    mineById.set(item.id, {
      ...(current || item),
      ...item,
      myItemSources: Array.from(new Set([...(current?.myItemSources || []), source]))
    });
  }
  assignedToMe.forEach((item) => addMine({ ...item, myItemCardType: "dev" }, "azure"));
  qaAssignedToMe.forEach((item) => addMine({ ...item, myItemCardType: "qa" }, "qa-responsavel"));
  qaTestedByMe.forEach((item) => addMine({ ...item, myItemCardType: "qa" }, "qa-testado"));
  const allMine = Array.from(mineById.values());
  const countryOptions = Array.from(new Set(allMine.flatMap((item) => item.countries || []))).sort();
  const tagOptions = Array.from(new Set(allMine.flatMap((item) => item.tags || []).filter((tag) => !/^0-[A-Z]{2}$/i.test(String(tag))))).sort((a, b) => a.localeCompare(b, "pt-BR"));
  const statusOptions = Array.from(new Set(allMine.map((item) => item.state).filter(Boolean))).sort((a, b) => a.localeCompare(b, "pt-BR"));
  const sprintOptions = Array.from(new Set(allMine.map((item) => item.sprint || item.iteration).filter(Boolean))).sort((a, b) => String(b).localeCompare(String(a), "pt-BR"));
  const currentSprint = findCurrentSprint(sprintOptions);
  const effectiveSprintFilter = sprintFilter.length ? sprintFilter : currentSprint ? [currentSprint] : [];
  const testResultOptions = [
    { key: "pass", label: "Approved", icon: "bi-check-lg" },
    { key: "fail", label: "Fail", icon: "bi-x-lg" },
    { key: "limitation", label: "Limitation", icon: "bi-exclamation-triangle-fill" },
    { key: "pending", label: "Pending", icon: "bi-dash-lg" }
  ];
  const environmentOptions = ["DEV", "QA", "BETA", "PROD"];
  const visibleItems = allMine.filter((item) => {
    const itemRecords = recordsForItem(item, evidence);
    const itemResults = itemRecords.length ? itemRecords.map((entry) => normalizeResult(entry.result || entry.status)) : ["pending"];
    const itemEnvironments = itemRecords.flatMap(evidenceEnvironments);
    if (search && !normalize(`${item.id} ${item.title}`).includes(normalize(search))) return false;
    if (types.length && !types.includes(item.type)) return false;
    if (countryFilter.length && !(item.countries || []).some((country) => countryFilter.includes(country))) return false;
    if (tagFilter.length && !(item.tags || []).some((tag) => tagFilter.includes(tag))) return false;
    if (statusFilter.length && !statusFilter.includes(item.state)) return false;
    if (effectiveSprintFilter.length && !effectiveSprintFilter.includes(item.sprint || item.iteration)) return false;
    if (environmentFilter.length && !itemEnvironments.some((env) => environmentFilter.includes(env))) return false;
    if (testResultFilter.length && !itemResults.some((result) => testResultFilter.includes(result))) return false;
    if (hoursFilter === "with" && Number(item.completedHours || 0) <= 0) return false;
    if (hoursFilter === "without" && Number(item.completedHours || 0) > 0) return false;
    return true;
  });
  const totalHours = allMine.reduce((sum, item) => sum + (Number(item.completedHours) || 0), 0);
  const goal = myCollaborator?.goalHours || getSetting("defaultGoalHours", defaultGoalHours);
  const balance = totalHours - goal;
  const tasks = allMine.filter((item) => item.type === "Task").length;
  const bugs = allMine.filter((item) => item.type === "Bug").length;
  const withHours = allMine.filter((item) => Number(item.completedHours || 0) > 0).length;
  const withoutHours = allMine.length - withHours;
  const testedByMe = allMine.filter((item) => (item.myItemSources || []).includes("qa-testado")).length;
  const testedTotal = allMine.filter((item) => recordsForItem(item, evidence).length > 0).length;
  const azureAssignedTotal = allMine.filter((item) => (item.myItemSources || []).includes("azure")).length;
  const qaResponsibleTotal = allMine.filter((item) => (item.myItemSources || []).includes("qa-responsavel")).length;
  const filteredTestCounts = visibleItems.reduce((acc, item) => {
    recordsForItem(item, evidence).forEach((entry) => {
      const result = normalizeResult(entry.result || entry.status);
      const envs = evidenceEnvironments(entry);
      if (!envs.length) return;
      acc.total += 1;
      acc[result] = (acc[result] || 0) + 1;
      envs.forEach((env) => {
        const key = evidenceEnv({ environment: env });
        acc.environments[key] = acc.environments[key] || { total: 0, pass: 0, fail: 0, limitation: 0, pending: 0 };
        acc.environments[key].total += 1;
        acc.environments[key][result] = (acc.environments[key][result] || 0) + 1;
      });
    });
    return acc;
  }, { total: 0, pass: 0, fail: 0, limitation: 0, pending: 0, environments: {} });
  const selectedItems = visibleItems.filter((item) => selectedIds.includes(item.id));
  const isQa = isQaUser;

  useEffect(() => {
    const target = consumePendingWorkItemHighlight() || readWorkItemHash();
    if (target) window.setTimeout(() => highlightWorkItem(target), 250);
  }, [visibleItems.length]);
  const collaboratorById = useMemo(() => new Map(collaborators.map((person) => [person.id, person])), [collaborators]);
  const qaPeople = collaborators.filter((person) => person.isQa);

  function toggleType(type) {
    setTypes((current) => current.includes(type) ? current.filter((value) => value !== type) : [...current, type]);
  }

  function toggleFilter(kind, value) {
    const setter = { country: setCountryFilter, tag: setTagFilter, status: setStatusFilter, sprint: setSprintFilter, environment: setEnvironmentFilter, result: setTestResultFilter }[kind];
    setter((current) => current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value]);
  }

  function resetMyItemsFilters() {
    setHoursFilter("all");
    setTypes(isQa ? ["Task", "Bug", "User Story"] : ["Task", "Bug"]);
    setCountryFilter([]);
    setTagFilter([]);
    setStatusFilter([]);
    setSprintFilter([]);
    setEnvironmentFilter([]);
    setTestResultFilter([]);
    setGroupBy("none");
    setSearch("");
  }

  function nextStateFor(item) {
    return nextEnvStep[item.env]?.state || (normalize(item.type) === "bug" ? bugFallbackNext(item.state) : taskFallbackNext(item.state));
  }

  function openHours(item) {
    const nextState = nextStateFor(item);
    if (!nextState) return;
    setHoursTarget({ item, nextState, items: [item] });
    setWorkedHours("");
    setHoursError("");
  }

  async function saveHours() {
    const hours = Number(workedHours);
    if (!Number.isFinite(hours) || hours <= 0) {
      setHoursError("Informe uma quantidade de horas maior que zero.");
      return;
    }
    const targets = hoursTarget?.items || [];
    for (const item of targets) {
      const next = hoursTarget.nextState && targets.length === 1 ? hoursTarget.nextState : nextStateFor(item);
      const step = nextEnvStep[item.env];
      await updateItem(item.id, {
        completedHours: Number(item.completedHours || 0) + hours,
        ...(next ? { state: next } : {}),
        ...(step ? { env: step.env } : {})
      });
    }
    setSelectedIds([]);
    setHoursTarget(null);
  }

  function openBulkHours() {
    if (!selectedItems.length) return;
    setHoursTarget({ item: null, nextState: "", items: selectedItems });
    setWorkedHours("");
    setHoursError("");
  }

  function toggleSelected(id, checked) {
    setSelectedIds((current) => checked ? Array.from(new Set([...current, id])) : current.filter((value) => value !== id));
  }

  function createDemoTask() {
    addItem({
      id: Date.now(),
      type: "Task",
      title: "Nova tarefa manual",
      state: "To Do",
      env: "dev",
      countries: ["BR"],
      assigneeId: myCollaborator?.id,
      updatedAt: new Date().toISOString()
    });
  }

  function renderMyCard(item) {
    return isQa && item.myItemCardType === "qa"
      ? <MyQaBoardItemCard key={item.id} item={item} collaboratorsById={collaboratorById} qaPeople={qaPeople} onOpen={setActiveItem} onQaChange={(qaCollaboratorId) => updateItem(item.id, { qaCollaboratorId })} evidence={evidence} />
      : <MyItemCard key={item.id} item={item} checked={selectedIds.includes(item.id)} onCheck={toggleSelected} onOpen={setActiveItem} onHours={openHours} />;
  }

  function groupsForItems(list) {
    if (groupBy === "hours") {
      return [
        { key: "with-hours", label: "Cards com horas", count: list.filter((item) => Number(item.completedHours || 0) > 0).length, items: list.filter((item) => Number(item.completedHours || 0) > 0) },
        { key: "without-hours", label: "Cards sem horas", count: list.filter((item) => Number(item.completedHours || 0) <= 0).length, items: list.filter((item) => Number(item.completedHours || 0) <= 0) }
      ];
    }
    if (groupBy === "source") {
      return [
        { key: "azure", label: "Cards do Azure", count: list.filter((item) => (item.myItemSources || []).includes("azure")).length, items: list.filter((item) => (item.myItemSources || []).includes("azure")) },
        { key: "tested", label: "Cards testados por mim", count: list.filter((item) => (item.myItemSources || []).includes("qa-testado")).length, items: list.filter((item) => (item.myItemSources || []).includes("qa-testado")) },
        { key: "qa-owner", label: "Cards como QA responsavel", count: list.filter((item) => (item.myItemSources || []).includes("qa-responsavel")).length, items: list.filter((item) => (item.myItemSources || []).includes("qa-responsavel")) }
      ];
    }
    return [{ key: "all", label: "Meus itens", count: list.length, items: list }];
  }

  return (
    <section className={`mbw-page mb-my-page mb-my-items-sidebar mode-${viewMode} ${fullscreen ? "is-fullscreen" : ""}`}>
      <WorkbenchHeader
        kicker="Stark Hub"
        title="Meus itens"
        subtitle={isQa ? "Cards atribuidos no Azure, cards como QA responsavel e historico de testes." : "Work Items atribuidos ao usuario logado"}
        demoMode={demoMode}
        actions={<>
          <IconButton title={summaryCollapsed ? "Mostrar resumo" : "Ocultar resumo"} onClick={() => setSummaryCollapsed((value) => !value)}><i className={`bi ${summaryCollapsed ? "bi-layout-text-window" : "bi-layout-sidebar-inset"}`} /></IconButton>
          <IconButton title={filtersCollapsed ? "Mostrar filtros" : "Ocultar filtros"} onClick={() => setFiltersCollapsed((value) => !value)}><i className={`bi ${filtersCollapsed ? "bi-funnel-fill" : "bi-funnel"}`} /></IconButton>
          <IconButton title="Lista" onClick={() => setViewMode("list")}><i className="bi bi-list-ul" /></IconButton>
          <IconButton title="Grid" onClick={() => setViewMode("grid")}><i className="bi bi-grid-3x3-gap" /></IconButton>
          <IconButton title="Compacto" onClick={() => setViewMode("compact")}><i className="bi bi-list" /></IconButton>
          <IconButton title="Exportar CSV" onClick={() => exportWorkItemsCsv("meus-itens", visibleItems)}><FiDownload /></IconButton>
          {demoMode && <IconButton title="Nova tarefa" onClick={createDemoTask}><i className="bi bi-plus-lg" /></IconButton>}
          <IconButton title="Atualizar" onClick={reload}><FiRefreshCw className={refreshing ? "mbw-spin" : ""} /></IconButton>
        </>}
      />
      <ConnectionGate needsAzureIntegration={needsAzureIntegration} error={error}>
        {!summaryCollapsed && <section className="mb-my-items-summary">
          <div className="mb-my-summary-top">
            <div className="mb-my-summary-user">
              <AvatarDot person={myCollaborator || { azureName: identityName, imageUrl: profile?.avatarUrl }} name={identityName} />
              <small>{visibleItems.length} de {allMine.length} item(ns) no filtro atual</small>
            </div>
            <div className="mb-my-summary-card-kpis"><span><small>Total</small><b>{allMine.length}</b></span><span><small>Tasks</small><b>{tasks}</b></span><span><small>Bugs</small><b>{bugs}</b></span>{isQa && <><span><small>Testados por mim</small><b>{testedByMe}</b></span><span><small>Testados</small><b>{testedTotal}</b></span><span><small>QA responsavel</small><b>{qaResponsibleTotal}</b></span><span><small>Atribuidos Azure</small><b>{azureAssignedTotal}</b></span></>}</div>
          </div>
          <div className="mb-my-summary-hours-row">
            <div className="mb-my-summary-hour-kpis"><span><small>Horas</small><b>{formatHours(totalHours)}</b></span><span><small>Meta</small><b>{formatHours(goal)}</b></span><span className={balance > 0 ? "above" : balance < 0 ? "below" : "met"}><small>{balance > 0 ? "Excedente" : balance < 0 ? "Restante" : "Meta"}</small><b>{formatHours(Math.abs(balance))}</b></span></div>
            <div className="mb-my-summary-links">
              <button type="button" className={hoursFilter === "with" ? "active" : ""} onClick={() => setHoursFilter("with")}><span>Com horas</span><b>{withHours}</b><em>Ver</em></button>
              <button type="button" className={hoursFilter === "without" ? "active" : ""} onClick={() => setHoursFilter("without")}><span>Sem horas</span><b>{withoutHours}</b><em>Ver</em></button>
              <button type="button" className={hoursFilter === "all" ? "active" : ""} onClick={() => setHoursFilter("all")}><span>Todos</span><b>{allMine.length}</b><em>Ver</em></button>
            </div>
          </div>
        </section>}
        {selectedIds.length > 0 && <section className="mb-my-bulk-bar"><span>{selectedIds.length} selecionado(s)</span><button type="button" onClick={openBulkHours}>Alterar em massa</button><button type="button" onClick={() => setSelectedIds([])}>Limpar selecao</button></section>}
        {!filtersCollapsed && <section className="mb-my-items-filters">
          {isQa && (
            <section className={`mb-my-insights ${insightsCollapsed ? "is-collapsed" : ""}`}>
              <header>
                <div><strong>Resumo de testes</strong><small>{filteredTestCounts.total} evidencia(s) nos filtros atuais</small></div>
                <button type="button" onClick={() => setInsightsCollapsed((value) => !value)}>{insightsCollapsed ? "Mostrar graficos" : "Ocultar graficos"}</button>
              </header>
              {!insightsCollapsed && <div className="mb-my-test-dashboard">
                <div className="mb-my-test-chart">
                  <div className="mb-my-test-chart-bar">
                    {["pass", "fail", "limitation"].map((key) => filteredTestCounts[key] ? <span key={key} className={key} style={{ width: `${Math.max(5, (filteredTestCounts[key] / Math.max(filteredTestCounts.total, 1)) * 100)}%` }}><i className={`bi ${key === "pass" ? "bi-check-lg" : key === "fail" ? "bi-x-lg" : "bi-exclamation-triangle-fill"}`} /> {filteredTestCounts[key]}</span> : null)}
                  </div>
                  <div className="mb-my-test-legend"><span><i className="bi bi-check-lg" /> Approved {filteredTestCounts.pass}</span><span><i className="bi bi-x-lg" /> Fail {filteredTestCounts.fail}</span><span><i className="bi bi-exclamation-triangle-fill" /> Limitation {filteredTestCounts.limitation}</span><strong>{filteredTestCounts.total} evidencia(s)</strong></div>
                </div>
                <div className="mb-my-env-kpis">
                  {environmentOptions.map((env) => {
                    const row = filteredTestCounts.environments[env] || {};
                    return <span key={env}><strong><img className="mb-my-env-icon" src={envIconSrc(env)} alt={env} />{env}</strong><small><i className="bi bi-check-lg" /> {row.pass || 0}</small><small><i className="bi bi-x-lg" /> {row.fail || 0}</small><small><i className="bi bi-exclamation-triangle-fill" /> {row.limitation || 0}</small><em>Total {row.total || 0}</em></span>;
                  })}
                </div>
              </div>}
            </section>
          )}
          <div className="mb-my-filter-heading"><strong>Filtros</strong><span>Combine tipo, sprint, status, ambiente e origem sem duplicar contexto.</span></div>
          <div className="mb-my-items-filter-row">
            <div className="mb-my-type-toggles">
              <button type="button" data-my-type="Task" className={`${types.includes("Task") ? "active" : ""} task`} onClick={() => toggleType("Task")}><img src={typeIconSrc("Task")} alt="" /> Task</button>
              <button type="button" data-my-type="Bug" className={`${types.includes("Bug") ? "active" : ""} bug`} onClick={() => toggleType("Bug")}><img src={typeIconSrc("Bug")} alt="" /> Bug</button>
              {isQa && <button type="button" data-my-type="User Story" className={`${types.includes("User Story") ? "active" : ""} story`} onClick={() => toggleType("User Story")}><img src={typeIconSrc("User Story")} alt="" /> User Story</button>}
            </div>
            <FilterCombobox label="Pais" options={countryOptions} values={countryFilter} onChange={setCountryFilter} placeholder="Buscar pais" renderOption={(option) => <span className="mbw-combobox-country"><CountryVisual code={option} compact /> {countries[option]?.label || option}</span>} />
            <FilterCombobox label="Tag" options={tagOptions} values={tagFilter} onChange={setTagFilter} placeholder="Buscar tag" />
            <FilterCombobox label="Status" options={statusOptions} values={statusFilter} onChange={setStatusFilter} placeholder="Buscar status" />
            <FilterCombobox label="Sprint" options={sprintOptions} values={effectiveSprintFilter} onChange={setSprintFilter} placeholder="Buscar sprint" allLabel="Sprint atual" renderOption={(option) => compactSprintLabel(option)} />
            {isQa && <div className="mb-my-filter-pills"><strong>Ambiente</strong>{environmentOptions.map((env) => <button key={env} type="button" className={environmentFilter.includes(env) ? "active" : ""} onClick={() => toggleFilter("environment", env)}><img src={envIconSrc(env)} alt="" /> {env}</button>)}</div>}
            {isQa && <div className="mb-my-filter-pills"><strong>Teste</strong>{testResultOptions.map((option) => <button key={option.key} type="button" className={`${testResultFilter.includes(option.key) ? "active" : ""} ${option.key}`} onClick={() => toggleFilter("result", option.key)}><i className={`bi ${option.icon}`} /> {option.label}</button>)}</div>}
            <FilterCombobox label="Agrupar" options={[{ value: "none", label: "Sem agrupamento" }, { value: "hours", label: "Com/Sem horas" }, { value: "source", label: "Origem do card" }]} values={[groupBy]} multiple={false} onChange={(value) => setGroupBy(value || "none")} />
            <button type="button" className="mb-my-clear-filters" onClick={resetMyItemsFilters}>Limpar filtros</button>
          </div>
          <label className="mb-my-items-search"><FiSearch /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pesquisar ID ou titulo" /></label>
        </section>}
        <main className="mb-my-items-content">
          {loading && <WorkbenchCardSkeleton rows={viewMode === "grid" ? 8 : 5} mode={viewMode} />}
          <div className={`mb-my-items-list ${groupBy !== "none" ? "is-grouped" : ""}`}>
            {!loading && groupsForItems(visibleItems).map((group) => groupBy === "none" ? group.items.map(renderMyCard) : (
              <details key={group.key} className="mb-my-group" open>
                <summary><span>{group.label}</span><b>{group.count}</b></summary>
                <div className="mb-my-group-body">{group.items.length ? group.items.map(renderMyCard) : <EmptyState title="Nenhum card neste grupo." />}</div>
              </details>
            ))}
            {!loading && !visibleItems.length && <EmptyState title="Nenhum Work Item encontrado para os filtros atuais." />}
          </div>
        </main>
      </ConnectionGate>
      {activeItem && (
        <ErrorBoundary
          fallback={(error) => (
            <div className="mbaz-new-modal-overlay">
              <div className="stark-error-boundary" onClick={(event) => event.stopPropagation()}>
                <strong>Nao foi possivel abrir este Work Item.</strong>
                <p>{error?.message || "Erro desconhecido ao renderizar o modal."}</p>
                <button type="button" onClick={closeActiveItem}>Fechar</button>
              </div>
            </div>
          )}
        >
          <AzureWorkItemModal
            profile={profile}
            item={activeItem}
            evidence={evidence}
            onClose={closeActiveItem}
            onTestResult={(item, patch) => updateItem(item.id, patch)}
            onUpdateItem={(patch) => updateItem(activeItem.id, patch)}
          />
        </ErrorBoundary>
      )}
      {hoursTarget && (
        <div className="mb-my-hours-overlay">
          <div className="mb-my-hours-backdrop" onClick={() => setHoursTarget(null)} />
          <section className="mb-my-hours-modal">
            <header><div><strong>{hoursTarget.items.length > 1 ? `Alterar ${hoursTarget.items.length} itens em massa` : `Atualizar ${formatWorkItemCode(hoursTarget.items[0]?.id, hoursTarget.items[0]?.type)}`}</strong><small>{hoursTarget.items.length > 1 ? "Horas em massa com status opcional" : `${hoursTarget.items[0]?.state} -> ${hoursTarget.nextState}`}</small></div><button type="button" onClick={() => setHoursTarget(null)}><i className="bi bi-x-lg" /></button></header>
            <div className="mb-my-hours-body">
              {hoursTarget.items.length === 1 && <p>{hoursTarget.items[0]?.title}</p>}
              <label><span>Horas trabalhadas neste avanco *</span><input type="number" min="0.25" step="0.25" value={workedHours} onChange={(event) => setWorkedHours(event.target.value)} placeholder="Ex.: 4" autoFocus /></label>
              {hoursTarget.items.length === 1 && <div className="mb-my-hours-comparison"><span><small>Valor atual</small><strong>{formatHours(hoursTarget.items[0]?.completedHours)}</strong></span><b>{"->"}</b><span><small>Apos atualizar</small><strong>{formatHours(Number(hoursTarget.items[0]?.completedHours || 0) + (Number(workedHours) || 0))}</strong></span></div>}
              <div className="mb-my-hours-note">O valor informado sera somado ao Completed Work atual. O status so sera alterado apos o preenchimento.</div>
              {hoursError && <div className="mb-my-hours-error">{hoursError}</div>}
            </div>
            <footer><button type="button" className="secondary" onClick={() => setHoursTarget(null)}>Cancelar</button><button type="button" className="primary" onClick={saveHours}>Salvar horas e avancar</button></footer>
          </section>
        </div>
      )}
    </section>
  );
}

function taskFallbackNext(state) {
  const flow = ["New", "Active", "Closed"];
  const index = flow.findIndex((entry) => normalize(entry) === normalize(state));
  return index >= 0 && index < flow.length - 1 ? flow[index + 1] : "";
}

function bugFallbackNext(state) {
  const flow = ["New", "Active", "Resolved", "Closed"];
  const index = flow.findIndex((entry) => normalize(entry) === normalize(state));
  return index >= 0 && index < flow.length - 1 ? flow[index + 1] : "";
}

function testSummaryForItem(item, evidence = []) {
  const records = recordsForItem(item, evidence);
  return records.reduce((acc, entry) => {
    const key = normalizeEvidenceResult(entry.result || entry.status);
    const envs = evidenceEnvironments(entry);
    if (!envs.length) return acc;
    acc.total += 1;
    acc[key] = (acc[key] || 0) + 1;
    envs.forEach((env) => {
      acc.byEnv[env] = acc.byEnv[env] || { total: 0, pass: 0, fail: 0, limitation: 0, pending: 0 };
      acc.byEnv[env].total += 1;
      acc.byEnv[env][key] = (acc.byEnv[env][key] || 0) + 1;
    });
    return acc;
  }, { total: 0, pass: 0, fail: 0, limitation: 0, pending: 0, byEnv: {} });
}

function MyQaBoardItemCard({ item, collaboratorsById, qaPeople, onOpen, onQaChange, evidence = [] }) {
  const [expanded, setExpanded] = useState(false);
  const status = qaStatusInfo(item.state);
  const type = workTypeInfo(item.type);
  const records = recordsForItem(item, evidence).slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const latest = records[0];
  const latestInfo = evidenceResultInfo(latest?.result || item.lastTestResult);
  const assignee = collaboratorsById.get(item.assigneeId) || (item.assigneeName || item.assigneeImageUrl ? { azureName: item.assigneeName, imageUrl: item.assigneeImageUrl } : null);
  const age = itemAgeDays(item);
  const visibleTags = (item.tags || []).filter((tag) => !/^0-/.test(String(tag)));
  const sourceLabels = {
    azure: "Azure atribuido",
    "qa-responsavel": "QA responsavel",
    "qa-testado": "Testado por mim"
  };
  const prEnv = String(item.pipelineEnv || item.prEnvironment || item.env || "").toUpperCase();
  const prLabel = prEnv === "QA" || prEnv === "BETA" || prEnv === "PROD" ? prEnv : "N/A";
  const prUrl = item.prUrl || item.pullRequestUrl || item.pipelineUrl || "";

  return (
    <article className={`mbaz-card mb-my-qa-board-card ${expanded ? "expanded" : ""} ${age >= 7 ? "mbaz-critical-highlight" : ""}`} data-id={item.id} data-work-item-id={item.id} data-work-item-type={String(item.type || "work item").toLowerCase()} style={{ borderLeftColor: type.color, "--wi-type-color": type.color, "--wi-type-bg": type.bg }}>
      <div className="mbaz-card-row mbaz-card-topline">
        <div className="mbaz-card-left">
          <span className={`mbaz-pill state ${status.key?.startsWith("ready") ? "ready" : ""}`} style={{ background: status.bg, color: status.color }}><i className={`bi ${status.icon}`} />{status.label}</span>
          {(item.myItemSources || []).map((source) => <span key={source} className={`mb-my-source-pill ${source}`}>{sourceLabels[source] || source}</span>)}
        </div>
        <div className="mbaz-card-right">
          <button
            type="button"
            className={`mbaz-pr-env-pill ${prLabel === "N/A" ? "none" : prLabel.toLowerCase()}`}
            disabled={!prUrl}
            title={prUrl ? `Abrir PR/Pipeline: ${prLabel}` : "Nenhuma evidencia de PR/Pipeline localizada"}
            onClick={() => prUrl && window.open(prUrl, "_blank", "noopener,noreferrer")}
          >
            <i className="bi bi-git" /><span>{prLabel}</span>
          </button>
        </div>
      </div>
      <div className="mbaz-card-row mbaz-card-title-row">
        <div className="mbaz-card-left">
          <span className="mbaz-type-icon" title={item.type}><img src={type.image} alt={item.type} /></span>
          <button className="mbaz-id" type="button" onClick={() => onOpen(item)}>{formatWorkItemCode(item.id, item.type)}</button>
          <span className="mbaz-item-title" title={item.title}>{item.title}</span>
        </div>
      </div>
      <div className="mbaz-card-row">
        <div className="mbaz-card-left">
          <CountryPills codes={item.countries || []} />
          <span className="mbaz-sprint-pill" title={item.sprint || item.iteration || ""}>{compactSprintLabel(item.sprint || item.iteration)}</span>
        </div>
        <div className="mbaz-card-right mbaz-meta">
          {age > 0 && <span className={`mbaz-pill ${age >= 7 ? "hot" : ""}`} title="Ultima alteracao">{age}d</span>}
          {visibleTags.slice(0, 2).map((tag) => <span key={tag} className={`mbaz-pill ${/block|imped|critical|hotfix/i.test(tag) ? "hot" : ""}`}>{tag}</span>)}
        </div>
      </div>
      <div className="mbaz-card-row mbaz-card-people-row">
        <div className="mbaz-card-left"><AvatarDot person={assignee} name={item.assigneeName} /></div>
        <div className="mbaz-card-right mbaz-card-test-owner">
          <button type="button" className={`mbaz-test-summary ${latestInfo.className}`} onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
            <i className={`bi ${latestInfo.icon}`} /><span>{latest ? evidenceEnvironments(latest)[0] || "N/A" : "Pending"}</span>{records.length > 1 && <span>+{records.length - 1}</span>}
          </button>
          <QaPicker value={item.qaCollaboratorId || ""} onChange={(qaCollaboratorId) => onQaChange(qaCollaboratorId || null)} people={qaPeople} />
        </div>
      </div>
      <div className="mbaz-card-expand-panel" hidden={!expanded}>
        <div className="mbaz-card-test-details mbaz-card-test-journeys">
          {environmentsWithEvidence(records).map((environment) => {
            const envRecords = evidenceRecordsForEnvironment(records, environment);
            return (
              <div key={environment} className="mbaz-evidence-env-block mbaz-card-test-env" data-env={environment}>
                <div className="mbaz-evidence-env-label">
                  <span className="mbaz-evidence-env-count">{envRecords.length}</span>
                  <span className="mbaz-evidence-env-name">{environment}</span>
                  <span className="mbaz-evidence-help" title={`${evidenceTransitionLabel(envRecords)}\n\n${evidenceTooltip(envRecords)}`}>?</span>
                </div>
                <div className="mbaz-evidence-journey mb-my-qa-env-summary" title={`${evidenceTransitionLabel(envRecords)}\n\n${evidenceTooltip(envRecords)}`}>
                  {envRecords.length ? <EvidenceRunFlow records={envRecords} limit={8} /> : <i className="bi bi-dash-lg mbaz-evidence-pending-icon" />}
                </div>
              </div>
            );
          })}
          {!environmentsWithEvidence(records).length && <div className="mbaz-evidence-pending"><i className="bi bi-dash-lg mbaz-evidence-pending-icon" /> Sem testes registrados</div>}
        </div>
      </div>
    </article>
  );
}

function MyItemCard({ item, checked, onCheck, onOpen, onHours }) {
  const typeClass = normalize(item.type) === "bug" ? "bug" : "task";
  const typeInfo = workItemTypes[item.type] || workItemTypes.Task;
  const visibleTags = (item.tags || []).filter((tag) => !/^0-[A-Z]{2}$/i.test(String(tag).trim()));
  const critical = visibleTags.some((tag) => /^(critico|crítico|critical)$/i.test(String(tag)));
  const nextLabel = nextEnvStep[item.env]?.state || (typeClass === "bug" ? bugFallbackNext(item.state) : taskFallbackNext(item.state));
  const itemUrl = item.url || "#";
  const testSummary = testSummaryForItem(item);
  const sourceLabels = {
    azure: "Azure atribuido",
    "qa-responsavel": "QA responsavel",
    "qa-testado": "Testado por mim"
  };
  return (
    <article className={`mb-my-item-card ${typeClass} ${critical ? "is-critical" : ""}`} data-id={item.id} data-work-item-id={item.id} data-work-item-type={item.type} style={{ "--wi-type-color": typeInfo.color || "#64748b", "--wi-type-bg": typeInfo.background || "#f8fafc" }}>
      <label className="mb-my-item-check" title="Selecionar"><input className="mb-my-item-select" type="checkbox" checked={checked} onChange={(event) => onCheck(item.id, event.target.checked)} /><span /></label>
      <div className="mb-my-item-main">
        <div className="mb-my-item-normal-content">
          <div className="mb-my-item-topline">
            <div className="mb-my-item-type"><img className="mb-my-item-type-icon" src={typeIconSrc(item.type)} alt={item.type} /><strong>{String(item.type || "Work Item").toUpperCase()}</strong><button type="button" className="mb-my-item-id" onClick={() => onOpen(item)}>{formatWorkItemCode(item.id, item.type)}</button></div>
            <div className="mb-my-item-right">
              <div className="mb-my-item-country-tags">{(item.countries || []).length ? (item.countries || []).map((country) => <span key={country} className="mb-country-pill"><CountryVisual code={country} /></span>) : <span className="mb-country-pill na">N/A</span>}{(item.myItemSources || []).map((source) => <span key={source} className={`mb-my-source-pill ${source}`}>{sourceLabels[source] || source}</span>)}</div>
              <div className="mb-my-item-tags">{visibleTags.map((tag) => <span key={tag} className={/^(critico|crítico|critical)$/i.test(String(tag)) ? "critical" : ""}>{tag}</span>)}</div>
            </div>
          </div>
          <button type="button" className="mb-my-item-title-link" onClick={() => onOpen(item)}>{item.title}</button>
          <div className="mb-my-item-bottomline">
            <div className="mb-my-item-meta"><span>{compactSprintLabel(item.sprint || item.iteration) || "Sem sprint"}</span><span>Completed: {formatHours(item.completedHours)}</span><span>Remaining: {"remainingHours" in item ? formatHours(item.remainingHours) : "-"}</span></div>
            <button className="mb-my-item-status" type="button" onClick={() => onHours(item)} disabled={!nextLabel}><strong>{item.state}</strong><i>{nextLabel ? "->" : "-"}</i><small>{nextLabel || "Fluxo concluido"}</small></button>
          </div>
          {testSummary.total > 0 && (
            <div className="mb-my-item-test-summary">
              <span><i className="bi bi-check-lg" /> {testSummary.pass}</span>
              <span><i className="bi bi-x-lg" /> {testSummary.fail}</span>
              <span><i className="bi bi-exclamation-triangle-fill" /> {testSummary.limitation}</span>
              <strong>{testSummary.total} resultado(s)</strong>
            </div>
          )}
        </div>
        <div className="mb-my-item-compact-row">
          <a className="mb-my-item-compact-id" href={itemUrl} target="_blank" rel="noopener noreferrer">{formatWorkItemCode(item.id, item.type)}</a>
          <div className="mb-my-item-compact-country">{(item.countries || []).map((country) => <CountryVisual key={country} code={country} compact />)}</div>
          <button className="mb-my-item-status mb-my-item-status-compact" type="button" onClick={() => onHours(item)} disabled={!nextLabel}><strong>{item.state}</strong><i>{nextLabel ? "->" : "-"}</i><small>{nextLabel || "Fim"}</small></button>
        </div>
      </div>
    </article>
  );
}

function goalStatus(hours, goal) {
  if (hours < goal) return { key: "below", label: "Abaixo", tone: "amber" };
  if (hours > goal) return { key: "above", label: "Acima", tone: "green" };
  return { key: "met", label: "Na meta", tone: "blue" };
}

function governanceRoleLevel(person) {
  return person?.accessLevel || person?.linkedProfile?.accessLevel
    || (person?.isManagement ? "gestao" : person?.isQa ? "qa" : person?.isDev ? "dev" : null);
}

function governanceRoleLabel(person) {
  const level = governanceRoleLevel(person);
  return accessLevelLabels[level] || (person?.isQa ? "QA" : person?.isDev ? "Dev" : person?.isManagement ? "Gestao" : "Sem funcao");
}

export function HoursWorkbench() {
  const { profile, demoMode } = useAuth();
  const { items, error, loading, refreshing, reload } = useWorkItems();
  const { collaborators } = useCollaborators();
  const { evidence } = useTestEvidence();
  const { getSetting } = useAppSettings();
  const [search, setSearch] = usePersistentState("starkHubFilters:governance:search", "");
  const [collaboratorFilter, setCollaboratorFilter] = usePersistentState("starkHubFilters:governance:collaborator", []);
  const [typeFilter, setTypeFilter] = usePersistentState("starkHubFilters:governance:type", "all");
  const [sprintFilter, setSprintFilter] = usePersistentState("starkHubFilters:governance:sprint", []);
  const [hourStatus, setHourStatus] = usePersistentState("starkHubFilters:governance:hours", "all");
  const [goalFilter, setGoalFilter] = usePersistentState("starkHubFilters:governance:goal", "all");
  const [roleGroup, setRoleGroup] = usePersistentState("starkHubFilters:governance:roleGroup", "all");
  const [viewMode, setViewMode] = usePersistentState("starkHubFilters:governance:viewMode", "grid");
  const [chartsCollapsed, setChartsCollapsed] = usePersistentState("starkHubFilters:governance:chartsCollapsed", false);
  const [expanded, setExpanded] = useState(() => new Set());
  const [expandedTests, setExpandedTests] = useState(() => new Set());
  const goalDefault = getSetting("defaultGoalHours", defaultGoalHours);
  const peopleById = useMemo(() => new Map(collaborators.map((person) => [person.id, person])), [collaborators]);
  const peopleByName = useMemo(() => buildCollaboratorNameIndex(collaborators), [collaborators]);
  const sprintOptions = Array.from(new Set(items.map((item) => item.sprint || item.iteration).filter(Boolean))).sort((a, b) => String(b).localeCompare(String(a), "pt-BR"));
  const currentSprint = findCurrentSprint(sprintOptions);
  const effectiveSprintFilter = sprintFilter.length ? sprintFilter : currentSprint ? [currentSprint] : [];

  // Gestao deve refletir o periodo filtrado (sprint atual por padrao),
  // nao o historico completo do time. O escopo de periodo (sprint/tipo/
  // horas) e aplicado UMA vez aqui, antes de agregar metricas por
  // colaborador — assim horas, work items e testes ficam todos coerentes
  // com o mesmo recorte. Filtros de lista (busca, colaborador, meta) sao
  // aplicados depois, sobre os colaboradores ja agregados no periodo.
  const periodItems = useMemo(() => items.filter((item) => {
    if (typeFilter !== "all" && item.type !== typeFilter) return false;
    if (effectiveSprintFilter.length && !effectiveSprintFilter.includes(item.sprint || item.iteration)) return false;
    if (hourStatus === "with" && Number(item.completedHours || 0) <= 0) return false;
    if (hourStatus === "without" && Number(item.completedHours || 0) > 0) return false;
    return true;
  }), [items, typeFilter, effectiveSprintFilter, hourStatus]);

  const developers = useMemo(() => {
    const map = new Map();
    const ensure = (key, seed = {}) => {
      if (!map.has(key)) {
        const person = seed.person || null;
        map.set(key, {
          key,
          person,
          displayName: person?.azureName || seed.displayName || "Nao atribuido",
          uniqueName: seed.uniqueName || person?.email || "",
          avatarUrl: person?.imageUrl || seed.imageUrl || "",
          color: person?.color || "#0b74de",
          goalHours: Number(person?.goalHours || goalDefault),
          items: []
        });
      }
      return map.get(key);
    };

    collaborators.filter((person) => person.isDev || person.isManagement || person.isQa).forEach((person) => ensure(person.id, { person }));
    periodItems.forEach((item) => {
      const person = peopleById.get(item.assigneeId) || findCollaboratorByName(peopleByName, item.assigneeName);
      const key = person?.id || item.assigneeName || "unassigned";
      ensure(key, { person, displayName: item.assigneeName || "Nao atribuido", imageUrl: item.assigneeImageUrl }).items.push(item);
      const qaPerson = peopleById.get(item.qaCollaboratorId);
      if (qaPerson && qaPerson.id !== key) {
        ensure(qaPerson.id, { person: qaPerson }).items.push({ ...item, qaGovernanceCard: true });
      }
    });

    return Array.from(map.values()).map((dev) => {
      const devItems = dev.items.slice().sort((a, b) => Number(a.completedHours > 0) - Number(b.completedHours > 0) || new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
      const testMetrics = devItems.reduce((acc, item) => {
        if (!["Bug", "User Story"].includes(item.type)) return acc;
        const records = recordsForItem(item, evidence);
        records.forEach((entry) => {
          const result = entry.result === "approved" ? "pass" : entry.result || "pending";
          const envs = evidenceEnvironments(entry);
          if (!envs.length) return;
          acc.total += 1;
          acc[result] = (acc[result] || 0) + 1;
          envs.forEach((env) => {
            acc.byEnv[env] = acc.byEnv[env] || { total: 0, pass: 0, fail: 0, limitation: 0, pending: 0 };
            acc.byEnv[env].total += 1;
            acc.byEnv[env][result] = (acc.byEnv[env][result] || 0) + 1;
          });
        });
        return acc;
      }, { total: 0, pass: 0, fail: 0, limitation: 0, pending: 0, byEnv: {} });
      // Card do colaborador QA: "Testando" = itens onde a pessoa e responsavel
      // de QA (marcados qaGovernanceCard na agregacao acima); "Atribuido Azure"
      // = itens onde ela e a atribuida de verdade no Azure (o resto). "Para
      // testar" = dos itens que ela e responsavel, quantos ainda nao tem
      // nenhum resultado registrado.
      const qaResponsibleItems = devItems.filter((item) => item.qaGovernanceCard);
      const azureAssignedCount = devItems.length - qaResponsibleItems.length;
      const pendingToTestCount = qaResponsibleItems.filter((item) => !recordsForItem(item, evidence).length).length;
      const completed = devItems.reduce((sum, item) => sum + Number(item.completedHours || 0), 0);
      const tasks = devItems.filter((item) => String(item.type).toLowerCase() === "task").length;
      const bugs = devItems.filter((item) => String(item.type).toLowerCase() === "bug").length;
      const userStories = devItems.filter((item) => String(item.type).toLowerCase() === "user story").length;
      const features = devItems.filter((item) => String(item.type).toLowerCase() === "feature").length;
      const testableItems = devItems.filter((item) => ["Bug", "User Story"].includes(item.type)).length;
      const nonTestableItems = devItems.length - testableItems;
      const testedItems = devItems.filter((item) => recordsForItem(item, evidence).length > 0).length;
      const cardsWithHours = devItems.filter((item) => Number(item.completedHours || 0) > 0).length;
      const cardsWithoutHours = devItems.length - cardsWithHours;
      const goal = Math.max(Number(dev.goalHours) || 0, 0);
      const missingHours = Math.max(goal - completed, 0);
      const extraHours = Math.max(completed - goal, 0);
      const progressPercent = goal ? (completed / goal) * 100 : 0;
      const status = progressPercent < 100 ? "below" : progressPercent > 100 ? "above" : "met";
      const countryCounts = {};
      devItems.forEach((item) => (item.countries || ["N/A"]).forEach((country) => { countryCounts[country] = (countryCounts[country] || 0) + 1; }));
      return { ...dev, items: devItems, completed, tasks, bugs, userStories, features, testableItems, nonTestableItems, testedItems, cardsWithHours, cardsWithoutHours, missingHours, extraHours, progressPercent, goalStatus: status, countries: countryCounts, testMetrics, qaResponsibleCount: qaResponsibleItems.length, azureAssignedCount, pendingToTestCount };
    }).sort((a, b) => a.displayName.localeCompare(b.displayName, "pt-BR"));
  }, [collaborators, goalDefault, periodItems, peopleById, peopleByName, evidence]);

  // Tipo/periodo/horas ja foram aplicados na agregacao (periodItems); aqui
  // sobram apenas os filtros de exibicao da lista (busca, colaborador, meta).
  const filteredDevelopers = developers.filter((dev) => {
    const q = normalize(search);
    if (q && !normalize(`${dev.displayName} ${dev.uniqueName} ${dev.items.map((item) => `${item.id} ${item.title}`).join(" ")}`).includes(q)) return false;
    if (collaboratorFilter.length && !collaboratorFilter.includes(dev.key)) return false;
    if (roleGroup !== "all" && governanceRoleLevel(dev.person) !== roleGroup) return false;
    if ((typeFilter !== "all" || hourStatus !== "all") && dev.items.length === 0) return false;
    if (goalFilter !== "all" && dev.goalStatus !== goalFilter) return false;
    return true;
  });

  const totals = filteredDevelopers.reduce((acc, dev) => ({
    developers: acc.developers + 1,
    cards: acc.cards + dev.items.length,
    tasks: acc.tasks + dev.items.filter((item) => String(item.type).toLowerCase() === "task").length,
    bugs: acc.bugs + dev.items.filter((item) => String(item.type).toLowerCase() === "bug").length,
    userStories: acc.userStories + dev.userStories,
    features: acc.features + dev.features,
    testable: acc.testable + dev.testableItems,
    nonTestable: acc.nonTestable + dev.nonTestableItems,
    tests: acc.tests + dev.testMetrics.total,
    pass: acc.pass + dev.testMetrics.pass,
    fail: acc.fail + dev.testMetrics.fail,
    limitation: acc.limitation + dev.testMetrics.limitation,
    completed: acc.completed + dev.items.reduce((sum, item) => sum + Number(item.completedHours || 0), 0),
    goal: acc.goal + dev.goalHours,
    missing: acc.missing + dev.missingHours,
    extra: acc.extra + dev.extraHours
  }), { developers: 0, cards: 0, tasks: 0, bugs: 0, userStories: 0, features: 0, testable: 0, nonTestable: 0, tests: 0, pass: 0, fail: 0, limitation: 0, completed: 0, goal: 0, missing: 0, extra: 0 });

  const countryTotals = Object.entries(filteredDevelopers.reduce((acc, dev) => {
    Object.entries(dev.countries).forEach(([country, count]) => { acc[country] = (acc[country] || 0) + count; });
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]);

  const goalCounts = filteredDevelopers.reduce((acc, dev) => ({ ...acc, [dev.goalStatus]: (acc[dev.goalStatus] || 0) + 1 }), { below: 0, met: 0, above: 0 });
  const maxCompleted = Math.max(1, ...filteredDevelopers.map((dev) => Math.max(dev.completed, dev.goalHours)));
  const maxCountry = Math.max(1, ...countryTotals.map(([, count]) => count));
  // Card "Pai": o proprio usuario logado, sempre visivel (nao depende dos
  // filtros ativos). QA ve metricas de teste no lugar de Tasks/Bugs — para
  // QA, o que importa e o que ele testou, nao o que ele "entregou" como dev.
  const ownDev = developers.find((dev) => dev.person?.profileId === profile?.id)
    || developers.find((dev) => normalize(dev.displayName) === normalize(profile?.displayName || profile?.fullName || ""));
  const ownIsQaOnly = profile?.accessLevel === accessLevels.qa;

  function toggleDeveloper(key) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleTestExpanded(key) {
    setExpandedTests((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function copyReport() {
    const rows = filteredDevelopers.map((dev) => ({
      name: dev.displayName,
      hours: dev.completed,
      goal: dev.goalHours,
      label: dev.goalStatus === "below" ? "Abaixo" : dev.goalStatus === "above" ? "Acima" : "Cumprida",
      tone: dev.goalStatus === "below" ? "danger" : dev.goalStatus === "above" ? "warning" : "primary"
    }));
    copyExecutiveReportText({ title: "Gestao da equipe - Horas", period: "Atual", totals: { hours: totals.completed, goal: totals.goal, missing: totals.missing, extra: totals.extra }, rows });
  }

  function pdfReport() {
    const rows = filteredDevelopers.map((dev) => ({ name: dev.displayName, hours: dev.completed, goal: dev.goalHours, label: dev.goalStatus, tone: dev.goalStatus === "below" ? "danger" : dev.goalStatus === "above" ? "warning" : "primary" }));
    downloadExecutiveReportPdf({ title: "Stark Hub - Gestao da equipe", period: "Atual", totals: { hours: totals.completed, goal: totals.goal, missing: totals.missing, extra: totals.extra }, rows, filename: `stark-hub-Gestao-horas-${new Date().toISOString().slice(0, 10)}.pdf` });
  }

  async function sendGovernanceSlack() {
    const rows = filteredDevelopers.map((dev) => ({
      name: dev.displayName,
      hours: dev.completed,
      goal: dev.goalHours,
      tone: dev.goalStatus === "below" ? "danger" : dev.goalStatus === "above" ? "warning" : "primary"
    }));
    const text = buildGovernanceSlackText({ totals: { developers: totals.developers, cards: totals.cards, hours: totals.completed, goal: totals.goal, missing: totals.missing, extra: totals.extra }, rows });
    const webhookUrl = getSetting("slackWebhookUrl", "");
    const { error } = await sendSlackWebhook(webhookUrl, text);
    if (error) alert(`Nao foi possivel enviar ao Slack: ${error.message}`);
  }

  function copyHoursNotice(dev) {
    const period = getSetting("governancePeriod", {});
    const itemsWithUrl = dev.items.map((item) => ({ ...item, url: workItemUrl(profile, item) }));
    const text = buildHoursNoticeText({ dev: { ...dev, items: itemsWithUrl }, periodStart: period.start, periodEnd: period.end, formatHours });
    navigator.clipboard?.writeText(text);
  }

  function resetFilters() {
    setSearch("");
    setCollaboratorFilter([]);
    setTypeFilter("all");
    setSprintFilter([]);
    setHourStatus("all");
    setGoalFilter("all");
    setRoleGroup("all");
  }

  useEffect(() => {
    const target = consumePendingWorkItemHighlight() || readWorkItemHash();
    if (target) window.setTimeout(() => highlightWorkItem(target), 250);
  }, [filteredDevelopers.length]);

  function renderWorkItem(item) {
    const type = workTypeInfo(item.type);
    const noHours = Number(item.completedHours || 0) <= 0;
    const itemKey = `${item.id}-${item.qaGovernanceCard ? "qa" : "azure"}`;
    // Pedido explicito: so Bug/User Story mostram o componente de resultado
    // de teste no card do colaborador (Task nao passa por QA neste fluxo).
    const testable = item.type === "Bug" || item.type === "User Story";
    const records = testable ? recordsForItem(item, evidence).slice().sort((a, b) => String(b.createdAt || b.createdDate || "").localeCompare(String(a.createdAt || a.createdDate || ""))) : [];
    const latest = records[0];
    const latestInfo = latest ? evidenceResultInfo(latest.result || latest.status) : null;
    const lastEnv = latest ? evidenceEnvironments(latest)[0] || null : null;
    const isTestExpanded = expandedTests.has(itemKey);
    return (
      <article key={itemKey} className={`mbdhc-work-card ${String(item.type || "").toLowerCase()} ${noHours ? "missing-hours" : ""} ${item.qaGovernanceCard ? "qa-card" : ""}`} data-id={item.id} data-work-item-id={item.id} data-work-item-type={String(item.type || "").toLowerCase()} style={{ "--wi-type-color": type.color, "--wi-type-bg": type.bg, borderLeftColor: type.color }}>
        <a className="mbdhc-work-card-link" href={workItemUrl(profile, item)} target="_blank" rel="noopener noreferrer">
          <div className="mbdhc-work-main">
            <div className={`mbdhc-work-type-line ${String(item.type || "").toLowerCase()}`}><img className="mbdhc-work-type-icon" src={type.image} alt={item.type} /><strong>{formatWorkItemCode(item.id, item.type)}</strong><span>{item.type}</span></div>
            <h4 title={item.title}>{item.title}</h4>
            <div className="mbdhc-work-country-row"><CountryPills codes={item.countries || []} />{item.sprint && <span className="mbdhc-work-sprint">{compactSprintLabel(item.sprint)}</span>}</div>
            <small>{item.qaGovernanceCard ? "QA responsavel" : "Azure atribuido"} - {item.state || "Sem status"} - {item.areaPath || "Sem area"}</small>
          </div>
          <div className="mbdhc-work-hours">
            <strong>{formatHours(item.completedHours)}</strong>
            <span>Completed</span>
            {noHours && <em>Sem horas</em>}
          </div>
        </a>
        {testable && (
          <button
            type="button"
            className={`mbdhc-work-test-toggle ${latestInfo?.className || "pending"}`}
            title={evidenceTooltip(records)}
            onClick={() => toggleTestExpanded(itemKey)}
          >
            {latestInfo ? <i className={`bi ${latestInfo.icon}`} /> : <i className="bi bi-dash-lg" />}
            <span>{latestInfo ? latestInfo.label : "Sem teste"}</span>
            {lastEnv && <em>{lastEnv}</em>}
            {records.length > 0 && <b>{records.length}</b>}
            <i className={`bi ${isTestExpanded ? "bi-chevron-up" : "bi-chevron-down"}`} />
          </button>
        )}
        {testable && isTestExpanded && (
          <div className="mbdhc-work-test-panel mbaz-card-test-details mbaz-card-test-journeys">
            {environmentsWithEvidence(records).map((environment) => {
              const envRecords = evidenceRecordsForEnvironment(records, environment);
              return (
                <div key={environment} className="mbaz-evidence-env-block mbaz-card-test-env" data-env={environment}>
                  <div className="mbaz-evidence-env-label">
                    <span className="mbaz-evidence-env-count">{envRecords.length}</span>
                    <span className="mbaz-evidence-env-name">{environment}</span>
                    <span className="mbaz-evidence-help" title={`${evidenceTransitionLabel(envRecords)}\n\n${evidenceTooltip(envRecords)}`}>?</span>
                  </div>
                  <div className="mbaz-evidence-journey mb-my-qa-env-summary" title={`${evidenceTransitionLabel(envRecords)}\n\n${evidenceTooltip(envRecords)}`}>
                    {envRecords.length ? <EvidenceRunFlow records={envRecords} limit={8} /> : <i className="bi bi-dash-lg mbaz-evidence-pending-icon" />}
                  </div>
                </div>
              );
            })}
            {!environmentsWithEvidence(records).length && <div className="mbaz-evidence-pending"><i className="bi bi-dash-lg mbaz-evidence-pending-icon" /> Sem testes registrados</div>}
          </div>
        )}
      </article>
    );
  }

  function renderDeveloper(dev, { pinned = false } = {}) {
    const isOpen = expanded.has(dev.key);
    const statusLabel = dev.goalStatus === "below" ? "Abaixo da meta" : dev.goalStatus === "above" ? "Acima da meta" : "Meta cumprida";
    const progressWidth = Math.min(100, Math.max(0, dev.progressPercent));
    const itemPreview = dev.items;
    const testPassRate = dev.testMetrics.total ? Math.round((dev.testMetrics.pass / dev.testMetrics.total) * 100) : 0;
    const roleLevel = governanceRoleLevel(dev.person);
    const useTestMetrics = roleLevel === accessLevels.qa;
    const countryEntries = Object.entries(dev.countries).sort((a, b) => b[1] - a[1]);
    const visibleCountries = countryEntries.slice(0, 5);
    const hiddenCountryCount = Math.max(0, countryEntries.length - visibleCountries.length);
    const envStats = ["DEV", "QA", "BETA", "PROD"].map((env) => ({ env, ...(dev.testMetrics.byEnv[env] || { total: 0, pass: 0, fail: 0, limitation: 0, pending: 0 }) })).filter((row) => row.total > 0);
    return (
      <article key={dev.key} className={`mbdhc-dev-card status-${dev.goalStatus} ${dev.goalStatus === "above" ? "pulse-over" : ""} ${pinned ? "mbdhc-dev-card-pinned" : ""}`}>
        {pinned && <div className="mbdhc-dev-pinned-label"><i className="bi bi-person-fill" /> Seu card</div>}
        <div className="mbdhc-dev-head">
          <div className="mbdhc-dev-identity">
            <AvatarDot person={dev.person || { azureName: dev.displayName, imageUrl: dev.avatarUrl, color: dev.color }} name={dev.displayName} />
            {roleLevel && <span className={`mbdhc-role-pill role-${roleLevel}`}><RoleBadgeIcon level={roleLevel} /> {accessLevelLabels[roleLevel] || roleLevel}</span>}
          </div>
          <div className="mbdhc-dev-status"><strong>{formatHours(dev.completed)}</strong><span>de {formatHours(dev.goalHours)}</span><em>{statusLabel}</em></div>
        </div>
        <div className="mbdhc-country-pills">
          {visibleCountries.map(([country, count]) => <span key={country} className="mbdhc-country-pill"><CountryVisual code={country} compact /><strong>{count}</strong></span>)}
          {hiddenCountryCount > 0 && <span className="mbdhc-country-pill more">+{hiddenCountryCount}</span>}
        </div>
        <div className="mbdhc-progress"><span style={{ width: `${progressWidth}%` }} /></div>
        <div className="mbdhc-dev-focus-metrics">
          {useTestMetrics ? (
            <>
              <span><small>Total</small><b>{dev.testMetrics.total}</b></span>
              <span><small>Feitos</small><b>{dev.testedItems}</b></span>
              <span className="approved"><small>Pass</small><b>{dev.testMetrics.pass}</b></span>
              <span className="fail"><small>Fail</small><b>{dev.testMetrics.fail}</b></span>
              <span className="limitation"><small>Limitation</small><b>{dev.testMetrics.limitation}</b></span>
            </>
          ) : (
            <>
              <span><small>Testaveis</small><b>{dev.testableItems}</b></span>
              <span><small>Nao testaveis</small><b>{dev.nonTestableItems}</b></span>
              <span><small>Testes</small><b>{dev.testMetrics.total}</b></span>
              <span className="approved"><small>Pass</small><b>{dev.testMetrics.pass}</b></span>
              <span className="fail"><small>Fail</small><b>{dev.testMetrics.fail}</b></span>
              <span className="limitation"><small>Limitation</small><b>{dev.testMetrics.limitation}</b></span>
            </>
          )}
        </div>
        {envStats.length > 0 && (
          <details className="mbdhc-dev-env-details">
            <summary>Detalhes por ambiente <i className="bi bi-chevron-down" /></summary>
            <div>
              {envStats.map((row) => (
                <span key={row.env}><img src={envIconSrc(row.env)} alt="" /><b>{row.env}</b><small><i className="bi bi-check-lg" /> {row.pass || 0}</small><small><i className="bi bi-x-lg" /> {row.fail || 0}</small><small><i className="bi bi-exclamation-triangle-fill" /> {row.limitation || 0}</small></span>
              ))}
            </div>
          </details>
        )}
        <div className="mbdhc-dev-mini-stats">
          {useTestMetrics ? (
            <>
              <span><small>QA resp.</small><b>{dev.qaResponsibleCount}</b></span>
              <span><small>Azure</small><b>{dev.azureAssignedCount}</b></span>
              <span><small>P/ testar</small><b>{dev.pendingToTestCount}</b></span>
              <span><small>Pass rate</small><b>{testPassRate}%</b></span>
            </>
          ) : (
            <>
              <span><small>Cards</small><b>{dev.items.length}</b></span>
              <span><small>Tasks</small><b>{dev.tasks}</b></span>
              <span><small>Bugs</small><b>{dev.bugs}</b></span>
              <span><small>Saldo</small><b>{dev.goalStatus === "above" ? `+${formatHours(dev.extraHours)}` : `-${formatHours(dev.missingHours)}`}</b></span>
            </>
          )}
        </div>
        <div className="mbdhc-dev-actions">
          <button className="mbdhc-button secondary" type="button" onClick={() => copyHoursNotice(dev)} title="Copiar aviso de horas para enviar ao colaborador"><i className="bi bi-clipboard-check" /> Copiar aviso</button>
          {!pinned && <button className="mbdhc-button secondary" type="button" onClick={() => toggleDeveloper(dev.key)}>{isOpen ? "Ocultar" : "Ver mais"} <i className={`bi ${isOpen ? "bi-chevron-up" : "bi-chevron-down"}`} /></button>}
        </div>
        {/* No card fixo (pinned) o usuario ja tem "Meus itens" pra ver o
            detalhe card a card — a lista aqui ficava sempre aberta (sem
            botao "Ver mais"/"Ocultar") e poluia o card fixo, que deveria
            ser so o resumo. Removida do pinned; continua disponivel via
            "Ver mais" nos cards normais do time. */}
        {!pinned && (
          <div className="mbdhc-dev-items" hidden={!isOpen}>
            <div className="mbdhc-dev-items-head"><strong>Cards do colaborador</strong><small>{dev.cardsWithoutHours} sem horas</small></div>
            <div className="mbdhc-dev-items-scroll">{itemPreview.map(renderWorkItem)}</div>
          </div>
        )}
      </article>
    );
  }

  return (
    <section className="mbw-page mbdhc-page mbdhc-governance">
      <WorkbenchHeader
        kicker="Modulo 4"
        title={ownIsQaOnly ? "Minhas metricas" : "Gestao da equipe"}
        subtitle={ownIsQaOnly ? "Seu card com metricas de teste. A visao completa do time e restrita a Gestao/Gerente." : "Horas, metas, cards sem apontamento e distribuicao por pais."}
        demoMode={demoMode}
        actions={ownIsQaOnly
          ? <><Button onClick={() => downloadCsv(`minhas-metricas-${dateStamp()}.csv`, ["Colaborador", "Cards", "Tasks", "Bugs", "Horas", "Meta", "Sem horas"], ownDev ? [[ownDev.displayName, ownDev.items.length, ownDev.tasks, ownDev.bugs, ownDev.completed, ownDev.goalHours, ownDev.cardsWithoutHours]] : [])}><FiDownload /> CSV</Button><Button onClick={reload}><FiRefreshCw className={refreshing ? "mbw-spin" : ""} /> Atualizar</Button></>
          : <><Button onClick={() => downloadCsv(`Gestao-equipe-${dateStamp()}.csv`, ["Colaborador", "Papel", "Cards", "Tasks", "Bugs", "User Stories", "Features", "Horas", "Meta", "Com horas", "Sem horas", "Saldo"], filteredDevelopers.map((dev) => [dev.displayName, accessLevelLabels[dev.person?.accessLevel || dev.person?.linkedProfile?.accessLevel] || (dev.person?.isQa ? "QA" : dev.person?.isDev ? "Dev" : dev.person?.isManagement ? "Gestao" : ""), dev.items.length, dev.tasks, dev.bugs, dev.userStories, dev.features, dev.completed, dev.goalHours, dev.cardsWithHours, dev.cardsWithoutHours, dev.completed - dev.goalHours]))}><FiDownload /> CSV</Button><Button onClick={reload}><FiRefreshCw className={refreshing ? "mbw-spin" : ""} /> Atualizar</Button><Button onClick={copyReport}><FiCopy /> Copiar</Button><Button onClick={sendGovernanceSlack}><i className="bi bi-slack" /> Slack</Button><Button onClick={pdfReport}><FiDownload /> PDF</Button></>}
      />
      {error && <div className="mbw-alert error">{error}</div>}
      {/* O card fixo so faz sentido pra QA: pra ele e o UNICO conteudo desta
          tela (o resto fica escondido logo abaixo). Gestao/Gerente ja se
          veem no grid completo do time (sao seedados como "developer" por
          terem isManagement/isQa) — pinar de novo em cima so duplicava a
          propria pessoa com metricas de meta de horas sem sentido pra quem
          nao e Dev. */}
      {ownIsQaOnly && (ownDev
        ? <div className="mbdhc-own-card-wrap">{renderDeveloper(ownDev, { pinned: true })}</div>
        : <EmptyState title="Sua conta ainda nao foi vinculada a um colaborador" />)}
      {!ownIsQaOnly && (
      <>
      <details className="mbdhc-filters" open>
        <summary><span>Filtros <small>{filteredDevelopers.length} colaborador(es)</small></span><b>{[search, collaboratorFilter.length, typeFilter !== "all", hourStatus !== "all", goalFilter !== "all", roleGroup !== "all"].filter(Boolean).length} ativos</b></summary>
        <div className="mbdhc-filter-grid">
          <label className="mbdhc-field"><span>Buscar</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pessoa, card, titulo..." /></label>
          <ProfileCombobox label="Colaborador" people={developers.map((dev) => ({ id: dev.key, azureName: dev.displayName, color: dev.color }))} values={collaboratorFilter} multiple onChange={setCollaboratorFilter} />
          <FilterCombobox label="Funcao" options={[{ value: accessLevels.dev, label: "Dev" }, { value: accessLevels.qa, label: "QA" }, { value: accessLevels.gestao, label: "Gestao" }, { value: accessLevels.gerente, label: "Gerente" }]} values={roleGroup === "all" ? [] : [roleGroup]} multiple={false} onChange={(value) => setRoleGroup(value || "all")} />
          <FilterCombobox label="Tipo" options={["Task", "Bug", "User Story", "Feature"].map((value) => ({ value, label: value }))} values={typeFilter === "all" ? [] : [typeFilter]} multiple={false} onChange={(value) => setTypeFilter(value || "all")} />
          <FilterCombobox label="Sprint" options={sprintOptions.map((sprint) => ({ value: sprint, label: compactSprintLabel(sprint) }))} values={effectiveSprintFilter[0] ? [effectiveSprintFilter[0]] : []} multiple={false} allLabel="Sprint atual" onChange={(value) => setSprintFilter(value ? [value] : [])} />
          <FilterCombobox label="Horas" options={[{ value: "with", label: "Com horas" }, { value: "without", label: "Sem horas" }]} values={hourStatus === "all" ? [] : [hourStatus]} multiple={false} onChange={(value) => setHourStatus(value || "all")} />
          <FilterCombobox label="Status da meta" options={[{ value: "below", label: "Abaixo" }, { value: "met", label: "Cumprida" }, { value: "above", label: "Acima" }]} values={goalFilter === "all" ? [] : [goalFilter]} multiple={false} onChange={(value) => setGoalFilter(value || "all")} />
          <div className="mbdhc-filter-actions"><button className="mbdhc-button secondary" type="button" onClick={resetFilters}>Limpar filtros</button></div>
        </div>
      </details>
      <section className="mbdhc-kpi-grid">
        {loading ? <KpiSkeleton count={8} /> : (
          <>
            <Kpi icon="bi-people" label="Colaboradores" value={totals.developers} />
            <Kpi icon="bi-kanban" label="Cards" value={totals.cards} />
            <Kpi icon="bi-hammer" label="Tasks" value={totals.tasks} tone="gold" />
            <Kpi icon="bi-bug-fill" label="Bugs" value={totals.bugs} tone="red" />
            <Kpi icon="bi-clock" label="Horas registradas" value={formatHours(totals.completed)} tone="blue" />
            <Kpi icon="bi-bullseye" label="Meta total" value={formatHours(totals.goal)} />
            <Kpi icon="bi-dash-lg" label="Horas pendentes" value={formatHours(totals.missing)} tone="red" />
            <Kpi icon="bi-plus-lg" label="Excedente" value={`+${formatHours(totals.extra)}`} tone="gold" />
          </>
        )}
      </section>
      <section className={`mbdhc-section mbdhc-charts-section ${chartsCollapsed ? "collapsed" : ""}`}>
        <div className="mbdhc-section-header"><div><h3>Dashboard da equipe</h3><p>Horas, volume de itens e qualidade do ciclo atual.</p></div><button className="mbdhc-icon-button" type="button" onClick={() => setChartsCollapsed((value) => !value)}><i className={`bi ${chartsCollapsed ? "bi-chevron-down" : "bi-chevron-up"}`} /></button></div>
        {!chartsCollapsed && !loading && (
          <div className="mbdhc-dashboard-overview">
            <section className="mbdhc-overview-card hours">
              <header><span>Horas</span><strong>{formatHours(totals.completed)}</strong><small>de {formatHours(totals.goal)}</small></header>
              <div className="mbdhc-overview-track"><b style={{ width: `${totals.goal ? Math.min(100, (totals.completed / totals.goal) * 100) : 0}%` }} /></div>
              <footer><span>Pendente {formatHours(totals.missing)}</span><span>Excedente +{formatHours(totals.extra)}</span></footer>
            </section>
            <section className="mbdhc-overview-card volume">
              <header><span>Quantidade</span><strong>{totals.cards}</strong><small>{totals.testable} testaveis</small></header>
              <div className="mbdhc-segment-track">
                <b className="task" style={{ width: `${totals.cards ? (totals.tasks / totals.cards) * 100 : 0}%` }} />
                <b className="bug" style={{ width: `${totals.cards ? (totals.bugs / totals.cards) * 100 : 0}%` }} />
                <b className="story" style={{ width: `${totals.cards ? (totals.userStories / totals.cards) * 100 : 0}%` }} />
                <b className="feature" style={{ width: `${totals.cards ? (totals.features / totals.cards) * 100 : 0}%` }} />
              </div>
              <footer><span>Tasks {totals.tasks}</span><span>Bugs {totals.bugs}</span><span>US {totals.userStories}</span><span>Feat {totals.features}</span></footer>
            </section>
            <section className="mbdhc-overview-card quality">
              <header><span>Testes</span><strong>{totals.tests}</strong><small>{totals.nonTestable} nao testaveis</small></header>
              <div className="mbdhc-segment-track">
                <b className="pass" style={{ width: `${totals.tests ? (totals.pass / totals.tests) * 100 : 0}%` }} />
                <b className="fail" style={{ width: `${totals.tests ? (totals.fail / totals.tests) * 100 : 0}%` }} />
                <b className="limitation" style={{ width: `${totals.tests ? (totals.limitation / totals.tests) * 100 : 0}%` }} />
              </div>
              <footer><span>Pass {totals.pass}</span><span>Fail {totals.fail}</span><span>Limitation {totals.limitation}</span></footer>
            </section>
          </div>
        )}
        {!chartsCollapsed && <div className="mbdhc-dashboard-grid">
          {loading ? (
            <>
              <section className="mbdhc-chart-card"><ChartSkeleton rows={6} /></section>
              <section className="mbdhc-chart-card"><ChartSkeleton variant="donut" /></section>
              <section className="mbdhc-chart-card"><ChartSkeleton rows={6} /></section>
              <section className="mbdhc-chart-card mbdhc-collab-country-card"><ChartSkeleton rows={6} /></section>
            </>
          ) : (
            <>
              <section className="mbdhc-chart-card"><h3>Meta x realizado</h3><div className="mbdhc-bars">{filteredDevelopers.slice(0, 12).map((dev) => <div key={dev.key} className="mbdhc-bar-row"><span>{shortName(dev.displayName)}</span><div><b className={dev.goalStatus} style={{ width: `${Math.min(100, (Math.max(dev.completed, 1) / maxCompleted) * 100)}%` }} /></div><strong>{formatHours(dev.completed)}</strong></div>)}</div></section>
              <section className="mbdhc-chart-card"><h3>Status das metas</h3><div className="mbdhc-donut-wrap"><div className="mbdhc-donut" style={{ "--below": totals.developers ? (goalCounts.below / totals.developers) * 100 : 0, "--met": totals.developers ? (goalCounts.met / totals.developers) * 100 : 0 }} /><div className="mbdhc-legend"><span><i className="red" />Abaixo: {goalCounts.below}</span><span><i className="blue" />Cumprida: {goalCounts.met}</span><span><i className="gold" />Acima: {goalCounts.above}</span></div></div></section>
              <section className="mbdhc-chart-card"><h3>Distribuicao por pais</h3><div className="mbdhc-country-bars">{countryTotals.map(([country, count]) => <div key={country} className="mbdhc-country-bar"><span><CountryVisual code={country} compact /></span><i><b style={{ width: `${(count / maxCountry) * 100}%` }} /></i><strong>{count}</strong></div>)}</div></section>
              <section className="mbdhc-chart-card mbdhc-collab-country-card"><h3>Colaborador x pais</h3><CollaboratorCountryMatrix developers={filteredDevelopers} /></section>
            </>
          )}
        </div>}
      </section>
      <section className="mbdhc-section">
        <div className="mbdhc-section-header"><div><h3>Resumo por colaborador</h3><p>{loading ? "Consultando Azure DevOps..." : `${filteredDevelopers.length} colaborador(es) no filtro atual.`}</p></div><div className="mbdhc-view-controls"><button className={viewMode === "list" ? "active" : ""} onClick={() => setViewMode("list")} type="button"><i className="bi bi-list-ul" /></button><button className={viewMode === "grid" ? "active" : ""} onClick={() => setViewMode("grid")} type="button"><i className="bi bi-grid-3x3-gap" /></button><button className={viewMode === "compact" ? "active" : ""} onClick={() => setViewMode("compact")} type="button"><i className="bi bi-layout-sidebar" /></button></div></div>
        <div className={`mbdhc-dev-grid mode-${viewMode}`}>{loading ? <WorkbenchCardSkeleton rows={6} mode={viewMode} /> : filteredDevelopers.length ? filteredDevelopers.map(renderDeveloper) : <EmptyState title="Nenhum colaborador encontrado" />}</div>
      </section>
      </>
      )}
    </section>
  );
}

export function SettingsWorkbench() {
  const { profile, user, demoMode } = useAuth();
  const { flags, isEnabled, setFlag } = useFeatureFlags();
  const { collaborators } = useCollaborators();
  const { getSetting, updateSetting, loading: settingsLoading } = useAppSettings();
  const isGestao = hasManagementAccess(profile?.accessLevel);
  const personalSettingsKey = `starkHubPersonalConnections:${profile?.id || user?.email || "anonymous"}`;
  function readPersonalSetting(key, fallback = "") {
    if (typeof window === "undefined") return fallback;
    try {
      const data = JSON.parse(window.localStorage.getItem(personalSettingsKey) || "{}");
      return data[key] ?? fallback;
    } catch {
      return fallback;
    }
  }
  function writePersonalSettings(payload) {
    if (typeof window === "undefined") return;
    let current = {};
    try {
      current = JSON.parse(window.localStorage.getItem(personalSettingsKey) || "{}");
    } catch {
      current = {};
    }
    window.localStorage.setItem(personalSettingsKey, JSON.stringify({ ...current, ...payload }));
  }
  const importRef = useRef(null);
  const [productName, setProductName] = useState(getSetting("productName", "Stark Hub"));
  const [goalHours, setGoalHours] = useState(getSetting("defaultGoalHours", defaultGoalHours));
  const [azureMaxItems, setAzureMaxItems] = useState(getSetting("azureMaxItems", 200));
  const [azureAutoRefreshSeconds, setAzureAutoRefreshSeconds] = useState(getSetting("azureAutoRefreshSeconds", 60));
  const [notificationSoundsMuted, setNotificationSoundsMuted] = useState(() => Boolean(readNotificationSetting(profile, user, "notificationSoundsMuted", false)));
  const [notificationSoundPrefs, setNotificationSoundPrefs] = useState(() =>
    Object.fromEntries(notificationTypes.map(({ key }) => [key, readNotificationSetting(profile, user, `notificationSound:${key}`, "ping")]))
  );
  const [iterationPattern, setIterationPattern] = useState(getSetting("azureIterationPattern", ""));
  const [periodStart, setPeriodStart] = useState(getSetting("governancePeriod", {})?.start || "");
  const [periodEnd, setPeriodEnd] = useState(getSetting("governancePeriod", {})?.end || "");
  const [slackWebhookUrl, setSlackWebhookUrl] = useState(getSetting("slackWebhookUrl", ""));
  const [slackTestMode, setSlackTestMode] = useState(Boolean(getSetting("slackTestMode", false)));
  const [slackTestWebhookUrl, setSlackTestWebhookUrl] = useState(getSetting("slackTestWebhookUrl", ""));
  const [slackPrimaryWebhookName, setSlackPrimaryWebhookName] = useState(getSetting("slackPrimaryWebhookName", "Canal principal"));
  const [pipelineQaName, setPipelineQaName] = useState(() => isGestao ? getSetting("azurePipelines", {})?.qa || "" : readPersonalSetting("pipelineQaName", ""));
  const [pipelineBetaName, setPipelineBetaName] = useState(() => isGestao ? getSetting("azurePipelines", {})?.beta || "" : readPersonalSetting("pipelineBetaName", ""));
  const [personalSlackWebhookUrl, setPersonalSlackWebhookUrl] = useState(() => readPersonalSetting("slackWebhookUrl", ""));
  const [personalSlackTestWebhookUrl, setPersonalSlackTestWebhookUrl] = useState(() => readPersonalSetting("slackTestWebhookUrl", ""));
  const [personalSlackTestMode, setPersonalSlackTestMode] = useState(() => Boolean(readPersonalSetting("slackTestMode", false)));
  const [personalSlackPrimaryWebhookName, setPersonalSlackPrimaryWebhookName] = useState(() => readPersonalSetting("slackPrimaryWebhookName", "Canal pessoal"));
  const [configScope, setConfigScope] = usePersistentState("starkHubFilters:settings:configScope", profile?.accessLevel || accessLevels.dev);
  const [showSecrets, setShowSecrets] = useState(false);
  const [saving, setSaving] = useState("");
  const [preview, setPreview] = useState("");
  const [saveStatus, setSaveStatus] = useState(null);

  // Os campos globais (Gestao/Gerente) acima sao inicializados com
  // getSetting() no primeiro render, ANTES do useAppSettings terminar de
  // buscar app_settings no Supabase (settingsLoading ainda true) — nesse
  // momento settings esta vazio, entao o valor exibido e sempre o fallback
  // (ex.: 60s de auto-refresh), nunca o que esta realmente salvo. Sem este
  // resync, o campo parece "nao aceitar" alteracao: some ao trocar de tela e
  // volta pro fallback. Sincroniza uma unica vez quando o carregamento
  // termina.
  useEffect(() => {
    if (settingsLoading) return;
    setProductName(getSetting("productName", "Stark Hub"));
    setGoalHours(getSetting("defaultGoalHours", defaultGoalHours));
    setAzureMaxItems(getSetting("azureMaxItems", 200));
    setAzureAutoRefreshSeconds(getSetting("azureAutoRefreshSeconds", 60));
    setIterationPattern(getSetting("azureIterationPattern", ""));
    setSlackWebhookUrl(getSetting("slackWebhookUrl", ""));
    setSlackTestMode(Boolean(getSetting("slackTestMode", false)));
    setSlackTestWebhookUrl(getSetting("slackTestWebhookUrl", ""));
    setSlackPrimaryWebhookName(getSetting("slackPrimaryWebhookName", "Canal principal"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsLoading]);

  const featureLabels = {
    showQaBoard: ["Quality Board", "Cards disponiveis para validacao"],
    showMyItems: ["Meus itens", "Work Items do usuario logado"],
    showTestResults: ["Resultado", "Resultado de QA/Beta nos cards"],
    showEvidenceHistory: ["Historico de testes", "Evidencias dentro de Meus itens para QA"],
    showGovernance: ["Gestao da equipe", "Horas, metas e indicadores"],
    enableBulkEdit: ["Alteracao em massa", "Acoes coletivas do workbench"],
    enableNewTask: ["Nova tarefa", "Criacao rapida de Work Items"],
    showImportWorkItems: ["Import Work Items", "Criacao hierarquica no Azure"],
    enableReadyBetaNotifications: ["Alertas Ready to Beta", "Slack e notificacoes quando aplicavel"]
  };

  async function saveSettings() {
    setSaving("settings");
    setSaveStatus(null);
    // Sons de notificacao sao preferencia individual: salvos sempre, para
    // qualquer nivel de acesso, independente do restante do formulario ser
    // pessoal (Dev/QA) ou global (Gestao).
    writeNotificationSetting(profile, user, "notificationSoundsMuted", notificationSoundsMuted);
    notificationTypes.forEach(({ key }) => writeNotificationSetting(profile, user, `notificationSound:${key}`, notificationSoundPrefs[key]));
    if (!isGestao) {
      try {
        writePersonalSettings({
          pipelineQaName,
          pipelineBetaName,
          slackWebhookUrl: personalSlackWebhookUrl,
          slackTestWebhookUrl: personalSlackTestWebhookUrl,
          slackTestMode: personalSlackTestMode,
          slackPrimaryWebhookName: personalSlackPrimaryWebhookName,
          updatedAt: new Date().toISOString()
        });
        setSaveStatus({ type: "success", message: "Configuracoes aplicadas com sucesso." });
      } catch (error) {
        setSaveStatus({ type: "error", message: `Falha ao aplicar: ${error.message}` });
      }
      setSaving("");
      return;
    }
    const results = await Promise.all([
      updateSetting("productName", productName),
      updateSetting("defaultGoalHours", Number(goalHours) || defaultGoalHours),
      updateSetting("azureMaxItems", Number(azureMaxItems) || 200),
      updateSetting("azureAutoRefreshSeconds", Number(azureAutoRefreshSeconds) || 60),
      updateSetting("azureIterationPattern", iterationPattern),
      updateSetting("azurePipelines", { qa: pipelineQaName, beta: pipelineBetaName }),
      updateSetting("slackWebhookUrl", slackWebhookUrl),
      updateSetting("slackTestMode", slackTestMode),
      updateSetting("slackTestWebhookUrl", slackTestWebhookUrl),
      updateSetting("slackPrimaryWebhookName", slackPrimaryWebhookName)
    ]);
    const failed = results.filter((result) => result?.error);
    setSaveStatus(failed.length
      ? { type: "error", message: `Falha ao aplicar ${failed.length} configuracao(oes): ${failed[0].error.message}` }
      : { type: "success", message: "Configuracoes aplicadas com sucesso." });
    setSaving("");
  }
  function exportConfig() {
    const scope = isGestao ? configScope : profile?.accessLevel || accessLevels.dev;
    const base = {
      schema: "stark-hub-config",
      version: 1,
      scope,
      exportedAt: new Date().toISOString(),
      securityNote: "Export scoped by access level. Secrets are included only when they belong to the exporting user scope."
    };
    const personalPayload = {
      ...base,
      type: "personal-connections",
      connections: {
        pipelineQaName,
        pipelineBetaName,
        slackWebhookUrl: isGestao ? "" : personalSlackWebhookUrl,
        slackTestWebhookUrl: isGestao ? "" : personalSlackTestWebhookUrl,
        slackTestMode: isGestao ? false : personalSlackTestMode,
        slackPrimaryWebhookName: isGestao ? "" : personalSlackPrimaryWebhookName
      }
    };
    const payload = !isGestao || scope !== accessLevels.gestao ? personalPayload : {
      ...base,
      type: "management-settings",
      product: { productName },
      features: flags,
      governance: {
        goalHours: Number(goalHours) || defaultGoalHours,
        azureMaxItems: Number(azureMaxItems) || 200,
        iterationPattern,
        governancePeriod: { start: periodStart, end: periodEnd }
      },
      connections: {
        azurePipelines: { qa: pipelineQaName, beta: pipelineBetaName },
        slackPrimaryWebhookName,
        slackTestMode
      },
      collaborators: collaborators.map(({ id, azureName, slackName, slackMemberId, aliases, color, imageUrl, isQa, isDev, isManagement, goalHours }) => ({ id, azureName, slackName, slackMemberId, aliases, color, imageUrl, isQa, isDev, isManagement, goalHours }))
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stark-hub-config-${scope}-${payload.type}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportSettingsCsv() {
    const rows = [
      ["Escopo", isGestao ? configScope : profile?.accessLevel || accessLevels.dev],
      ["Produto", isGestao ? productName : "Configuracao pessoal"],
      ["Pipeline QA", pipelineQaName],
      ["Pipeline BETA", pipelineBetaName],
      ["Slack modo teste", isGestao ? slackTestMode : personalSlackTestMode],
      ["Canal Slack principal", isGestao ? slackPrimaryWebhookName : personalSlackPrimaryWebhookName],
      ["Webhook Slack", isGestao ? "Configurado no banco (oculto)" : (personalSlackWebhookUrl ? "Configurado localmente (oculto)" : "Nao configurado")],
      ["Webhook testes", isGestao ? (slackTestWebhookUrl ? "Configurado no banco (oculto)" : "Nao configurado") : (personalSlackTestWebhookUrl ? "Configurado localmente (oculto)" : "Nao configurado")]
    ];
    if (isGestao) {
      rows.push(
        ["Meta padrao de horas", goalHours],
        ["Limite Azure", azureMaxItems],
        ["Auto-refresh segundos", azureAutoRefreshSeconds],
        ["Iteration pattern", iterationPattern],
        ["Colaboradores", collaborators.length]
      );
    }
    downloadCsv(`configuracoes-${dateStamp()}.csv`, ["Campo", "Valor"], rows);
  }

  async function importConfig(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      if (payload.schema !== "stark-hub-config") throw new Error("Arquivo de configuracao invalido.");
      if (!isGestao && payload.scope !== profile?.accessLevel) throw new Error("Este arquivo pertence a outro nivel de acesso.");
      if (!isGestao && payload.type !== "personal-connections") throw new Error("Seu acesso permite importar somente conexoes pessoais.");
      if (payload.type === "personal-connections") {
        const connections = payload.connections || {};
        setPipelineQaName(connections.pipelineQaName || "");
        setPipelineBetaName(connections.pipelineBetaName || "");
        if (!isGestao) {
          setPersonalSlackWebhookUrl(connections.slackWebhookUrl || "");
          setPersonalSlackTestWebhookUrl(connections.slackTestWebhookUrl || "");
          setPersonalSlackTestMode(Boolean(connections.slackTestMode));
          setPersonalSlackPrimaryWebhookName(connections.slackPrimaryWebhookName || "Canal pessoal");
        }
        setPreview("Conexoes importadas para a tela. Revise e clique em Salvar.");
      } else if (isGestao && payload.type === "management-settings") {
        if (payload.product?.productName) setProductName(payload.product.productName);
        if (payload.governance?.goalHours) setGoalHours(payload.governance.goalHours);
        if (payload.governance?.azureMaxItems) setAzureMaxItems(payload.governance.azureMaxItems);
        if (payload.governance?.iterationPattern) setIterationPattern(payload.governance.iterationPattern);
        if (payload.connections?.azurePipelines) {
          setPipelineQaName(payload.connections.azurePipelines.qa || "");
          setPipelineBetaName(payload.connections.azurePipelines.beta || "");
        }
        if (payload.governance?.governancePeriod) {
          setPeriodStart(payload.governance.governancePeriod.start || "");
          setPeriodEnd(payload.governance.governancePeriod.end || "");
        }
        if (payload.connections) {
          setSlackPrimaryWebhookName(payload.connections.slackPrimaryWebhookName || "Canal principal");
          setSlackTestMode(Boolean(payload.connections.slackTestMode));
        }
        setPreview("Configuracao de gestao importada para a tela. Revise e clique em Salvar.");
      } else {
        throw new Error("Seu acesso nao permite importar este arquivo.");
      }
    } catch (error) {
      setPreview(`Falha ao importar: ${error.message}`);
    } finally {
      event.target.value = "";
    }
  }

  function previewSlack() {
    if (!isGestao) {
      setPreview(personalSlackWebhookUrl || personalSlackTestWebhookUrl ? "Webhook pessoal/local configurado neste navegador." : "Nenhum webhook pessoal/local configurado.");
      return;
    }
    const people = collaborators.filter((person) => person.slackMemberId || person.slackName || person.azureName).slice(0, 12);
    setPreview(people.map((person) => `${person.azureName || "Sem nome"} -> ${person.slackMemberId ? `<@${person.slackMemberId}>` : person.slackName || "sem Slack"}`).join("\n") || "Nenhum colaborador configurado para Slack.");
  }

  function SettingsSection({ title, description, children, open = false }) {
    return (
      <details className="mb-settings-accordion-card" open={open}>
        <summary className="mb-settings-accordion-header">
          <span className="mb-settings-accordion-copy"><strong>{title}</strong><small>{description}</small></span>
          <span className="mb-settings-accordion-chevron" aria-hidden="true" />
        </summary>
        <div className="mb-settings-accordion-content">{children}</div>
      </details>
    );
  }

  return (
    <section className="mbw-page mb-settings-page mb-settings-workbench">
      <WorkbenchHeader
        kicker="Produto"
        title="Configuracoes"
        subtitle={isGestao ? "Produto, funcionalidades, conexoes e Gestao." : "Conexoes pessoais do Azure, pipelines e Slack."}
        demoMode={demoMode}
        actions={<>{isGestao && <div className="mb-settings-scope"><FilterCombobox label="Escopo" options={[{ value: accessLevels.dev, label: "Dev" }, { value: accessLevels.qa, label: "QA" }, { value: accessLevels.gestao, label: "Gestao" }, { value: accessLevels.gerente, label: "Gerente" }]} values={[configScope]} multiple={false} onChange={(value) => setConfigScope(value || accessLevels.gestao)} /></div>}<Button onClick={() => importRef.current?.click()}><FiUpload /> Importar</Button><Button onClick={exportSettingsCsv}><FiDownload /> CSV</Button><Button onClick={exportConfig}><FiDownload /> Exportar</Button><Button onClick={previewSlack}><FiCopy /> Testar Slack</Button><Button onClick={saveSettings} tone="primary">{saving ? "Aplicando..." : "Aplicar"}</Button></>}
      />
      <input ref={importRef} type="file" accept="application/json" hidden onChange={importConfig} />
      {saveStatus && <div className={`mb-settings-save-status ${saveStatus.type}`}><i className={`bi ${saveStatus.type === "error" ? "bi-exclamation-triangle-fill" : "bi-check-circle-fill"}`} /> {saveStatus.message}</div>}
      <div className="mb-settings-grid">
        {isGestao && <SettingsSection title="Produto e funcionalidades" description="Identidade do produto e feature flags." open>
          <label className="mb-form-row"><span>Nome do produto</span><input value={productName} onChange={(event) => setProductName(event.target.value)} /></label>
          <label className="mb-form-row"><span>Intervalo de atualizacao automatica (segundos)</span><input type="number" min="0" step="10" value={azureAutoRefreshSeconds} onChange={(event) => setAzureAutoRefreshSeconds(event.target.value)} /></label>
          <small className="mb-settings-note">Tempo entre cada atualizacao automatica do Quality Board e Meus itens. Use 0 para desativar o auto-reload.</small>
          <div className="mb-settings-subtitle">Funcionalidades</div>
          <div className="mb-featureflag-grid">
            {Object.entries(featureLabels).map(([key, [label, description]]) => (
              <label key={key} className="mb-switch-row">
                <span><strong>{label}</strong><small>{description}</small></span>
                <span className="mb-switch"><input type="checkbox" checked={isEnabled(key)} disabled={!isGestao} onChange={(event) => setFlag(key, event.target.checked)} /><span className="mb-switch-slider" /></span>
              </label>
            ))}
          </div>
        </SettingsSection>}

        <SettingsSection title={isGestao ? "Conexoes globais" : "Conexoes"} description={isGestao ? "Azure DevOps, pipelines e Slack compartilhados." : "Azure DevOps, pipelines e Slack locais deste usuario."} open={!isGestao}>
          {!demoMode && (
            <details className="mb-inner-accordion" open>
              <summary><span>Azure</span><small>Organizacao, projeto, time e autenticacao</small></summary>
              <div className="mb-inner-accordion-body"><AzureConnectionForm submitLabel="Testar e atualizar" /></div>
            </details>
          )}
          {isGestao && (
            <details className="mb-inner-accordion">
              <summary><span>Sincronizacao Azure</span><small>Escopo da busca de work items (todas as telas)</small></summary>
              <div className="mb-inner-accordion-body">
                <label className="mb-form-row"><span>Limite de itens buscados</span><input type="number" min="100" step="100" value={azureMaxItems} onChange={(event) => setAzureMaxItems(event.target.value)} /></label>
                <label className="mb-form-row"><span>Iteration pattern</span><input value={iterationPattern} onChange={(event) => setIterationPattern(event.target.value)} placeholder="MB Labs" /></label>
                <small className="mb-settings-note">Afeta Quality Board, Meus itens e Gestao — nao e especifico de nenhuma tela.</small>
              </div>
            </details>
          )}
          <details className="mb-inner-accordion">
            <summary><span>Pipelines</span><small>Nomes das pipelines QA e BETA</small></summary>
            <div className="mb-inner-accordion-body">
              <label className="mb-form-row"><span>Pipeline QA</span><input value={pipelineQaName} onChange={(event) => setPipelineQaName(event.target.value)} placeholder="Preencha nas configuracoes" /></label>
              <label className="mb-form-row"><span>Pipeline BETA</span><input value={pipelineBetaName} onChange={(event) => setPipelineBetaName(event.target.value)} placeholder="Preencha nas configuracoes" /></label>
              {!isGestao && <small className="mb-settings-note">Estas informacoes ficam salvas localmente no navegador deste usuario.</small>}
            </div>
          </details>
          <details className="mb-inner-accordion">
            <summary><span>Slack</span><small>Webhook, teste e canal principal</small></summary>
            <div className="mb-inner-accordion-body">
              <label className="mb-switch-row"><span><strong>Modo teste</strong><small>Usar webhook de teste quando disponivel</small></span><span className="mb-switch"><input type="checkbox" checked={isGestao ? slackTestMode : personalSlackTestMode} onChange={(event) => isGestao ? setSlackTestMode(event.target.checked) : setPersonalSlackTestMode(event.target.checked)} /><span className="mb-switch-slider" /></span></label>
              <label className="mb-form-row"><span>Nome do canal principal</span><input value={isGestao ? slackPrimaryWebhookName : personalSlackPrimaryWebhookName} onChange={(event) => isGestao ? setSlackPrimaryWebhookName(event.target.value) : setPersonalSlackPrimaryWebhookName(event.target.value)} /></label>
              <label className="mb-form-row"><span>Webhook principal</span><div className="mb-secret-field"><input type={showSecrets ? "text" : "password"} value={isGestao ? slackWebhookUrl : personalSlackWebhookUrl} onChange={(event) => isGestao ? setSlackWebhookUrl(event.target.value) : setPersonalSlackWebhookUrl(event.target.value)} placeholder="Cole o webhook nas configuracoes" /><button type="button" className={`mb-secret-toggle ${showSecrets ? "is-revealed" : ""}`} onClick={() => setShowSecrets((value) => !value)} /></div></label>
              <label className="mb-form-row"><span>Webhook de teste</span><div className="mb-secret-field"><input type={showSecrets ? "text" : "password"} value={isGestao ? slackTestWebhookUrl : personalSlackTestWebhookUrl} onChange={(event) => isGestao ? setSlackTestWebhookUrl(event.target.value) : setPersonalSlackTestWebhookUrl(event.target.value)} placeholder="Cole o webhook de teste nas configuracoes" /><button type="button" className={`mb-secret-toggle ${showSecrets ? "is-revealed" : ""}`} onClick={() => setShowSecrets((value) => !value)} /></div></label>
              {!isGestao && <small className="mb-settings-note">Webhooks pessoais ficam somente no localStorage deste navegador.</small>}
            </div>
          </details>
        </SettingsSection>

        {isGestao && <SettingsSection title="Gestao" description="Meta padrao de horas usada quando um colaborador nao tem meta propria.">
          <div className="mb-governance-grid">
            <label className="mb-form-row"><span>Meta padrao de horas</span><input type="number" min="0" step="0.5" value={goalHours} onChange={(event) => setGoalHours(event.target.value)} /></label>
          </div>
          <small className="mb-settings-note">Periodo, limite de itens e sprint agora sao filtros dentro da propria tela de Gestao da equipe, nao configuracoes globais.</small>
        </SettingsSection>}

        <SettingsSection title="Notificacoes sonoras" description="Escolha o som de cada notificacao ou desative por completo. Preferencia individual, salva neste navegador.">
          <label className="mb-switch-row">
            <span><strong>Silenciar todas</strong><small>Desliga qualquer som de notificacao para este usuario</small></span>
            <span className="mb-switch"><input type="checkbox" checked={notificationSoundsMuted} onChange={(event) => setNotificationSoundsMuted(event.target.checked)} /><span className="mb-switch-slider" /></span>
          </label>
          <div className="mb-notification-sound-grid">
            {notificationTypes.map(({ key, label, description }) => (
              <div key={key} className="mb-notification-sound-row">
                <span><strong>{label}</strong><small>{description}</small></span>
                <select value={notificationSoundPrefs[key]} disabled={notificationSoundsMuted} onChange={(event) => setNotificationSoundPrefs((current) => ({ ...current, [key]: event.target.value }))}>
                  {soundOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                <Button onClick={() => playTone(notificationSoundPrefs[key])} disabled={notificationSoundsMuted || notificationSoundPrefs[key] === "none"}>Testar</Button>
              </div>
            ))}
          </div>
        </SettingsSection>
        {preview && <pre className="mb-settings-preview">{preview}</pre>}
      </div>
    </section>
  );
}

