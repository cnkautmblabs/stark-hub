import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FiCopy,
  FiDownload,
  FiRefreshCw,
  FiSearch,
  FiUpload
} from "react-icons/fi";
import { Bar, BarChart, Cell, LabelList, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import AzureConnectionForm from "../common/AzureConnectionForm.jsx";
import { ErrorBoundary } from "../common/ErrorBoundary.jsx";
import {
  AvatarDot,
  Button,
  ChartSkeleton,
  CompactAxisTick,
  ConnectionGate,
  CountryFlagAxisTick,
  CountryPills,
  CountryVisual,
  EmptyState,
  FilterCombobox,
  IconButton,
  Kpi,
  KpiSkeleton,
  ProfileCombobox,
  QaPicker,
  RechartsTooltip,
  RoleBadgeIcon,
  TextField,
  WorkbenchCardSkeleton,
  WorkbenchHeader,
  envIconSrc,
  typeIconSrc,
} from "./ui/WorkbenchPrimitives.jsx";
import { AzureWorkItemModal, workItemUrl } from "./ui/AzureWorkItemModal.jsx";
import { CreateWorkItemWizard } from "./import/CreateWorkItemWizard.jsx";
import { CollaboratorCountryMatrix, CountryStateMatrix } from "./ui/MatrixCharts.jsx";
import { supabase } from "../../lib/supabaseClient.js";
import { useAuth } from "../../contexts/AuthContext.jsx";
import { useFeatureFlags } from "../../contexts/FeatureFlagsContext.jsx";
import { useWorkItems } from "../../hooks/useWorkItems.js";
import { usePipelineStatus } from "../../hooks/usePipelineStatus.js";
import { useCollaborators } from "../../hooks/useCollaborators.js";
import { useTestEvidence } from "../../hooks/useTestEvidence.js";
import { useAppSettings } from "../../hooks/useAppSettings.js";
import { useToast } from "../../contexts/ToastContext.jsx";
import { usePersistentState } from "../../hooks/usePersistentState.js";
import { usePersistentActiveWorkItem } from "../../hooks/usePersistentActiveWorkItem.js";
import { consumePendingWorkItemHighlight, highlightWorkItem, readWorkItemHash } from "../../utils/workbench/highlight.js";
import { notificationTypes, playSoundFile, readPersonalSetting as readNotificationSetting, writePersonalSetting as writeNotificationSetting } from "../../utils/notificationSounds.js";
import { readPersonalSetting as readPersonalSettingShared, writePersonalSettings as writePersonalSettingsShared } from "../../utils/personalSettings.js";
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
import { buildGovernanceSlackText, buildHoursNoticeText } from "../../utils/slackReport.js";
import { resolveSlackWebhooks } from "../../utils/slack.js";
import { compactSprintLabel, findCurrentSprint } from "../../utils/sprints.js";
import { dateStamp, downloadCsv, exportWorkItemsCsv } from "../../utils/csvExport.js";
import {
  collaboratorRoleLevels,
  evidenceDedupeKey,
  evidenceEnv,
  evidenceEnvironments as parseEvidenceEnvironments,
  isQaEvidenceEntry,
  evidenceResultInfo,
  formatHours,
  itemAgeDays,
  normalizeResult,
  normalize,
  qaStatusConfig,
  qaStatusInfo,
  qaStatusOrder,
  shortName
} from "../../utils/workbench/formatters.js";

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
    collaborator?.authUserId,
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
  return identityMatches(tokens, person?.id, person?.authUserId, person?.azureName, person?.slackName, person?.email, ...(person?.aliases || []));
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

// Badge de ambiente confirmado por Pipeline (equivalente ao "mbaz-pr-env-pill"
// do userscript legado). "pipeline" vem do hook usePipelineStatus (Edge
// Function azurePipelineStatus); os campos item.prUrl/pipelineEnv nunca sao
// preenchidos por nenhum fluxo do app, entao sem esse dado real o pill ficava
// sempre travado em "N/A" — pedido do usuario: "configurei a pipeline mas nao
// funciona".
function PipelineEnvPill({ item, pipeline }) {
  const kind = pipeline?.kind ? String(pipeline.kind).toUpperCase() : "";
  const legacyEnv = String(item?.pipelineEnv || item?.prEnvironment || item?.env || "").toUpperCase();
  const label = kind === "QA" || kind === "BETA" ? kind : (legacyEnv === "PROD" ? "PROD" : "N/A");
  const url = pipeline?.url || item?.prUrl || item?.pullRequestUrl || item?.pipelineUrl || "";
  const className = label === "N/A" ? "none" : label.toLowerCase();
  const statusIcon = pipeline?.status === "error" ? "bi-exclamation-triangle" : pipeline?.status === "active" ? "bi-arrow-repeat" : "bi-git";
  const title = pipeline
    ? `${pipeline.definitionName || "Pipeline"}${pipeline.buildNumber ? ` #${pipeline.buildNumber}` : ""} - ${pipeline.status === "completed" ? "Build concluido" : pipeline.status === "active" ? "Build em execucao" : "Falha no build"}`
    : (url ? `Abrir PR/Pipeline: ${label}` : "Nenhuma pipeline confirmada para este item");
  return (
    <button
      type="button"
      className={`mbaz-pr-env-pill ${className}`}
      disabled={!url}
      title={title}
      onClick={() => url && window.open(url, "_blank", "noopener,noreferrer")}
    >
      <i className={`bi ${statusIcon}`} />
      <span>{label}</span>
    </button>
  );
}

export function QaBoardWorkbench() {
  const { profile, demoMode } = useAuth();
  const { items, updateItem, reload, loading, refreshing, needsAzureIntegration, error } = useWorkItems();
  const { collaborators } = useCollaborators();
  const { evidence, reload: reloadEvidence } = useTestEvidence();
  const { getSetting } = useAppSettings();
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
  const [groupBy, setGroupBy] = usePersistentState("starkHubFilters:qaBoard:groupBy", "none");
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [chartsCollapsed, setChartsCollapsed] = usePersistentState("starkHubFilters:qaBoard:chartsCollapsed", false);
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

  const pipelineNames = getSetting("azurePipelines", {});
  const { byWorkItemId: pipelineByWorkItemId } = usePipelineStatus(boardItems.map((item) => item.id), pipelineNames);

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
    return { id, label: person?.azureName || "Nao definido", count, color: person?.color || ["#64748b", "#2563eb", "#16a34a", "#d97706", "#7c3aed"][index % 5], person };
  });
  const qaBarData = [{ name: "carga", ...Object.fromEntries(qaMetrics.map((row) => [String(row.id || "none"), row.count])) }];
  // O dominio do eixo TEM que ser a soma real dos buckets (nao filtered.length)
  // — se algum item tiver qaCollaboratorId de alguem que nao esta mais em
  // qaPeople (trocou de funcao, saiu do time), esse item nao cai em NENHUM
  // bucket e a soma fica menor que filtered.length, deixando uma barra
  // "incompleta" com um vao vazio no final mesmo a legenda batendo 100% do
  // que ela mesma mostra — bug reportado em producao.
  const qaBarTotal = qaMetrics.reduce((sum, row) => sum + row.count, 0);
  const testResultConfig = {
    pass: { label: "Approved", color: "#16a34a" },
    fail: { label: "Fail", color: "#dc2626" },
    limitation: { label: "Limitation", color: "#d97706" },
    pending: { label: "Pending", color: "#64748b" }
  };
  const testResultOrder = ["pass", "fail", "limitation", "pending"];
  const testResultCounts = filtered.reduce((acc, item) => {
    const records = evidenceById.get(Number(item.id)) || [];
    const key = normalizeResult(records[0]?.result || item.lastTestResult || "pending");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, { pass: 0, fail: 0, limitation: 0, pending: 0 });
  const countriesInBoard = Array.from(new Set(filtered.flatMap((item) => item.countries || []))).sort();
  const testedCount = testResultCounts.pass + testResultCounts.fail + testResultCounts.limitation;
  const resultRate = filtered.length ? Math.round((testedCount / filtered.length) * 100) : 0;
  const passRate = testedCount ? Math.round((testResultCounts.pass / testedCount) * 100) : 0;
  const blockedCount = filtered.filter((item) => (item.tags || []).some((tag) => /block|imped|critical|hotfix/i.test(tag))).length;
  const staleCount = filtered.filter((item) => itemAgeDays(item) >= 7).length;
  const qaActiveCount = qaMetrics.filter((row) => row.count > 0).length;
  const topCountry = countriesInBoard
    .map((country) => ({ country, count: filtered.filter((item) => (item.countries || []).includes(country)).length }))
    .sort((a, b) => b.count - a.count)[0];

  // Agrupamento do board — pedido explicito do usuario ("filtros por
  // agrupamento": ambiente, QA responsavel, assignee, pais). Mesmo padrao
  // ja usado em Meus Itens (groupsForItems: hours/source), so troca as
  // dimensoes. Um item pode pertencer a mais de um pais, entao aparece em
  // mais de um grupo quando agrupado por pais — intencional.
  function groupsForBoard(list) {
    if (groupBy === "ambiente") {
      return qaStatusOrder.map((key) => ({ key, label: qaStatusConfig[key].label, items: list.filter((item) => qaStatusInfo(item.state).key === key) }));
    }
    if (groupBy === "qa") {
      return ["", ...qaPeople.map((person) => person.id)].map((id) => {
        const person = byId.get(id);
        return { key: id || "none", label: person?.azureName || "Nao definido", items: list.filter((item) => (item.qaCollaboratorId || "") === id) };
      });
    }
    if (groupBy === "assignee") {
      const ids = Array.from(new Set(list.map((item) => item.assigneeId).filter(Boolean)));
      const groups = ids.map((id) => ({ key: id, label: byId.get(id)?.azureName || "Sem responsavel", items: list.filter((item) => item.assigneeId === id) }))
        .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
      const unassigned = list.filter((item) => !item.assigneeId);
      return unassigned.length ? [...groups, { key: "none", label: "Sem responsavel", items: unassigned }] : groups;
    }
    if (groupBy === "country") {
      return countriesInBoard.map((country) => ({ key: country, label: country, items: list.filter((item) => (item.countries || []).includes(country)) }));
    }
    return [{ key: "all", label: "Todos", items: list }];
  }

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
    return <PipelineEnvPill item={item} pipeline={pipelineByWorkItemId[item.id]} />;
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
        <div className="mbaz-card-compact-row">
          <div className="mbaz-card-compact-top">
            <span className="mbaz-type-icon" title={item.type}><img src={type.image} alt={item.type} /></span>
            <button className="mbaz-id" type="button" onClick={() => setActiveItem(item)}>{formatWorkItemCode(item.id, item.type)}</button>
            <span className={`mbaz-pill state`} style={{ background: status.bg, color: status.color }}>{status.label}</span>
            <AvatarDot person={assignee} name={item.assigneeName} compact />
          </div>
          <button type="button" className="mbaz-card-compact-title" onClick={() => setActiveItem(item)} title={item.title}>{item.title}</button>
        </div>
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
          </div>
        </div>
        <div className="mbaz-tabs">
          <div className="mbaz-search"><FiSearch /><input id="mbaz-search" className="mbaz-input" placeholder="Buscar por id, titulo, pessoa, pais..." value={search} onChange={(event) => setSearch(event.target.value)} /></div>
          <button id="mbaz-toggle-create" className="mbaz-btn" type="button" onClick={() => setShowCreate(true)}><i className="bi bi-magic" /> Criar Work Item</button>
          <button id="mbaz-view-toggle" className={`mbaz-icon-btn ${viewMode === "list" ? "active" : ""}`} type="button" title="Lista" onClick={() => setViewMode("list")}><i className="bi bi-view-list" /></button>
          <button className={`mbaz-icon-btn ${viewMode === "grid" ? "active" : ""}`} type="button" title="Grid" onClick={() => setViewMode("grid")}><i className="bi bi-grid-3x3-gap" /></button>
          <button className={`mbaz-icon-btn ${viewMode === "compact" ? "active" : ""}`} type="button" title="Compacto" onClick={() => setViewMode("compact")}><i className="bi bi-list" /></button>
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
                  <FilterCombobox label="Agrupar" options={[{ value: "none", label: "Sem agrupamento" }, { value: "ambiente", label: "Por ambiente" }, { value: "qa", label: "Por Tested by" }, { value: "assignee", label: "Por Assigned" }, { value: "country", label: "Por pais" }]} values={[groupBy]} multiple={false} onChange={(value) => setGroupBy(value || "none")} />
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
              {!loading && !chartsCollapsed && (
                <div className="mbaz-insight-strip">
                  <button type="button" className="mbaz-insight-card" onClick={() => setStatusFilter([])}><span>Itens</span><strong>{filtered.length}</strong><small>{boardItems.length} no board</small><i style={{ width: "100%" }} /></button>
                  <button type="button" className="mbaz-insight-card good" onClick={() => setResultFilter(["pass"])}><span>Result rate</span><strong>{resultRate}%</strong><small>{testedCount} testado(s)</small><i style={{ width: `${resultRate}%` }} /></button>
                  <button type="button" className="mbaz-insight-card pass" onClick={() => setResultFilter(["pass"])}><span>Pass rate</span><strong>{passRate}%</strong><small>{testResultCounts.pass} approved</small><i style={{ width: `${passRate}%` }} /></button>
                  <button type="button" className="mbaz-insight-card warn" onClick={() => setResultFilter(["pending"])}><span>Pendentes</span><strong>{testResultCounts.pending}</strong><small>{filtered.length ? Math.round((testResultCounts.pending / filtered.length) * 100) : 0}% do filtro</small><i style={{ width: `${filtered.length ? (testResultCounts.pending / filtered.length) * 100 : 0}%` }} /></button>
                  <button type="button" className="mbaz-insight-card danger"><span>Risco</span><strong>{blockedCount + staleCount}</strong><small>{blockedCount} tags, {staleCount} antigos</small><i style={{ width: `${filtered.length ? Math.min(100, ((blockedCount + staleCount) / filtered.length) * 100) : 0}%` }} /></button>
                  <button type="button" className="mbaz-insight-card info"><span>Cobertura</span><strong>{topCountry?.country || "-"}</strong><small>{qaActiveCount} QA, {countriesInBoard.length} paises</small><i style={{ width: `${countriesInBoard.length ? Math.min(100, (topCountry?.count || 0) / Math.max(1, filtered.length) * 100) : 0}%` }} /></button>
                </div>
              )}
              {loading ? (
                <div className="mbaz-chart"><ChartSkeleton rows={3} /></div>
              ) : (
                <div id="mbaz-chart" className="mbaz-chart">
                  <div className="mbaz-chart-head"><h3>Distribuicao por status</h3><span>{filtered.length} item(s)</span></div>
                  <div className="mbaz-status-layout">
                    <div className="mbaz-mini-stats">
                      <button type="button" className={`mbaz-mini-stat ${!statusFilter.length ? "active" : ""}`} onClick={() => setStatusFilter([])}>
                        <i style={{ background: "var(--starkMuted)" }} /><span>Total</span><b>{filtered.length}</b>
                      </button>
                      {qaStatusOrder.map((key) => (
                        <button key={key} type="button" className={`mbaz-mini-stat ${statusFilter.includes(key) ? "active" : ""}`} onClick={() => setStatusFilter((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])}>
                          <i style={{ background: qaStatusConfig[key].color }} /><span>{qaStatusConfig[key].label}</span><b>{filteredCounts[key]}</b>
                        </button>
                      ))}
                    </div>
                    <div className="mbaz-donut-wrap">
                      <ResponsiveContainer width="100%" height={126}>
                        <PieChart>
                          <Pie
                            data={qaStatusOrder.map((key) => ({ key, name: qaStatusConfig[key].label, value: filteredCounts[key] }))}
                            dataKey="value"
                            nameKey="name"
                            innerRadius="58%"
                            outerRadius="90%"
                            paddingAngle={filteredCounts && filtered.length ? 2 : 0}
                            onClick={(entry) => { const key = entry?.payload?.key; setStatusFilter((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]); }}
                          >
                            {qaStatusOrder.map((key) => (
                              <Cell key={key} fill={qaStatusConfig[key].color} opacity={statusFilter.length && !statusFilter.includes(key) ? 0.3 : 1} cursor="pointer" stroke="var(--starkSurface)" strokeWidth={2} />
                            ))}
                          </Pie>
                          <Tooltip content={<RechartsTooltip />} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="mbaz-donut-center"><strong>{filtered.length}</strong><small>{filtered.length === 1 ? "item" : "itens"}</small></div>
                    </div>
                  </div>
                </div>
              )}
              {loading ? (
                <div className="mbaz-qa-metrics"><ChartSkeleton rows={3} /></div>
              ) : (
                <div id="mbaz-qa-metrics" className="mbaz-qa-metrics">
                  <div className="mbaz-chart-head"><h3>Carga por QA</h3><span>{qaBarTotal} item(s)</span></div>
                  <div className="mbaz-qa-stack-wrap">
                    <ResponsiveContainer width="100%" height={30}>
                      <BarChart data={qaBarData} layout="vertical" margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                        <XAxis type="number" hide domain={[0, Math.max(1, qaBarTotal)]} />
                        <YAxis type="category" dataKey="name" hide />
                        <Tooltip content={<RechartsTooltip />} cursor={{ fill: "var(--starkSurfaceAlt)" }} />
                        {qaMetrics.map((row) => (
                          <Bar
                            key={row.id || "none"}
                            dataKey={String(row.id || "none")}
                            name={row.label}
                            stackId="qa"
                            fill={row.color}
                            opacity={qaFilter.length && !qaFilter.includes(row.id) ? 0.3 : 1}
                            cursor="pointer"
                            onClick={() => setQaFilter((current) => current.includes(row.id) ? current.filter((item) => item !== row.id) : [...current, row.id])}
                          />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mbaz-qa-legend">{qaMetrics.map((row) => <button key={row.id || "none"} type="button" className={`mbaz-qa-legend-item ${qaFilter.includes(row.id) ? "active" : ""}`} onClick={() => setQaFilter((current) => current.includes(row.id) ? current.filter((item) => item !== row.id) : [...current, row.id])}>{row.id ? <AvatarDot person={row.person} name={row.label} compact /> : <i className="mbaz-legend-dot" style={{ background: row.color }} />}<span>{shortName(row.label)}</span><strong>{row.count}</strong></button>)}</div>
                </div>
              )}
              {loading ? (
                <div className="mbaz-chart"><ChartSkeleton rows={3} /></div>
              ) : (
                <div id="mbaz-test-results" className="mbaz-chart">
                  <div className="mbaz-chart-head"><h3>Resultado de teste</h3><span>{filtered.length} item(s)</span></div>
                  <ResponsiveContainer width="100%" height={118}>
                    <BarChart data={testResultOrder.map((key) => ({ key, name: testResultConfig[key].label, value: testResultCounts[key] || 0 }))} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--starkMuted)" }} axisLine={false} tickLine={false} />
                      <YAxis hide />
                      <Tooltip content={<RechartsTooltip />} cursor={{ fill: "var(--starkSurfaceAlt)" }} />
                      <Bar dataKey="value" radius={[6, 6, 0, 0]} cursor="pointer" onClick={(entry) => { const key = entry?.payload?.key; setResultFilter((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]); }}>
                        {testResultOrder.map((key) => (
                          <Cell key={key} fill={testResultConfig[key].color} opacity={resultFilter.length && !resultFilter.includes(key) ? 0.3 : 1} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
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
              {showCreate && <CreateWorkItemWizard onClose={() => setShowCreate(false)} />}
              <div id="mbaz-results" className={`mbaz-results mode-${viewMode} ${viewMode === "grid" ? "grid" : ""} ${groupBy !== "none" ? "is-grouped" : ""}`}>
                {loading ? <WorkbenchCardSkeleton rows={8} mode={viewMode === "grid" ? "grid" : viewMode} /> : filtered.length ? groupsForBoard(filtered).map((group) => groupBy === "none" ? group.items.map(renderCard) : (
                  <details key={group.key} className="mb-my-group" open>
                    <summary><span>{group.label}</span><b>{group.items.length}</b></summary>
                    <div className="mb-my-group-body">{group.items.length ? group.items.map(renderCard) : <EmptyState title="Nenhum card neste grupo." />}</div>
                  </details>
                )) : <div className="mbaz-empty">Nenhum work item encontrado.</div>}
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
  const { t } = useTranslation();
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
  const myCollaborator = collaborators.find((person) => person.id === profile?.id)
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
  const myTestResultConfig = {
    pass: { label: "Approved", color: "#16a34a", icon: "bi-check-lg" },
    fail: { label: "Fail", color: "#dc2626", icon: "bi-x-lg" },
    limitation: { label: "Limitation", color: "#d97706", icon: "bi-exclamation-triangle-fill" },
    pending: { label: "Pending", color: "#94a3b8", icon: "bi-dash-lg" }
  };
  const myTestResultOrder = ["pass", "fail", "limitation", "pending"];
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
  const pipelineNames = getSetting("azurePipelines", {});
  const { byWorkItemId: pipelineByWorkItemId } = usePipelineStatus(visibleItems.map((item) => item.id), pipelineNames);
  const pipelineConfirmedTotal = visibleItems.filter((item) => Boolean(pipelineByWorkItemId[item.id])).length;
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
      ? <MyQaBoardItemCard key={item.id} item={item} collaboratorsById={collaboratorById} qaPeople={qaPeople} onOpen={setActiveItem} onQaChange={(qaCollaboratorId) => updateItem(item.id, { qaCollaboratorId })} evidence={evidence} pipeline={pipelineByWorkItemId[item.id]} />
      : <MyItemCard key={item.id} item={item} checked={selectedIds.includes(item.id)} onCheck={toggleSelected} onOpen={setActiveItem} onHours={openHours} pipeline={pipelineByWorkItemId[item.id]} />;
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
        { key: "qa-owner", label: "Cards como Tested by", count: list.filter((item) => (item.myItemSources || []).includes("qa-responsavel")).length, items: list.filter((item) => (item.myItemSources || []).includes("qa-responsavel")) }
      ];
    }
    return [{ key: "all", label: "Meus itens", count: list.length, items: list }];
  }

  return (
    <section className={`mbw-page mb-my-page mb-my-items-sidebar mode-${viewMode} ${fullscreen ? "is-fullscreen" : ""}`}>
      <WorkbenchHeader
        kicker="Stark Hub"
        title={t("pages.myItems.title")}
        subtitle={isQa ? t("pages.myItems.subtitleQa") : t("pages.myItems.subtitleDev")}
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
            {/* Eram ate 7 mini-cards soltos pra QA (mesmo problema de excesso
                de metricas do dashboard de Gestao de equipe) — agrupados em
                2 clusters com rotulo proprio: o que foi atribuido a mim, e o
                que eu fiz como QA. */}
            <div className="mb-my-summary-card-kpis">
              <div className="mb-my-metric-cluster primary">
                <strong>Meus itens</strong>
                <span><b>{allMine.length}</b><small>total</small></span>
                <span><b>{tasks}</b><small>tasks</small></span>
                <span><b>{bugs}</b><small>bugs</small></span>
                {!isQa && <span title="Itens com build confirmado via Pipeline (QA/BETA)"><b>{pipelineConfirmedTotal}</b><small>confirmados</small></span>}
              </div>
              {isQa && (
                <div className="mb-my-metric-cluster quality">
                  <strong>Atividade de QA</strong>
                  <span><b>{testedByMe}</b><small>testados por mim</small></span>
                  <span><b>{testedTotal}</b><small>testados</small></span>
                  <span><b>{qaResponsibleTotal}</b><small>Tested by</small></span>
                  <span><b>{azureAssignedTotal}</b><small>Assigned</small></span>
                </div>
              )}
            </div>
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
                  {/* Barra antiga so desenhava pass/fail/limitation mas dividia
                      pela largura de TODAS as evidencias (incluindo "pending"),
                      entao qualquer evidencia sem resultado claro deixava um
                      vao vazio na barra sem nenhuma explicacao — mesma familia
                      de bug do "Carga por QA" do Quality Board. Agora "pending"
                      vira um 4o segmento visivel e os segmentos sempre somam
                      exatamente o total mostrado ao lado. */}
                  <div className="mbaz-qa-stack-wrap">
                    <ResponsiveContainer width="100%" height={40}>
                      <BarChart data={[{ name: "resultado", ...Object.fromEntries(myTestResultOrder.map((key) => [key, filteredTestCounts[key] || 0])) }]} layout="vertical" margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                        <XAxis type="number" hide domain={[0, Math.max(1, filteredTestCounts.total)]} />
                        <YAxis type="category" dataKey="name" hide />
                        <Tooltip content={<RechartsTooltip />} cursor={{ fill: "var(--starkSurfaceAlt)" }} />
                        {myTestResultOrder.map((key) => (
                          <Bar key={key} dataKey={key} name={myTestResultConfig[key].label} stackId="result" fill={myTestResultConfig[key].color} />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mb-my-test-legend">
                    {myTestResultOrder.map((key) => <span key={key}><i className={`bi ${myTestResultConfig[key].icon}`} /> {myTestResultConfig[key].label} {filteredTestCounts[key] || 0}</span>)}
                    <strong>{filteredTestCounts.total} evidencia(s)</strong>
                  </div>
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

function MyQaBoardItemCard({ item, collaboratorsById, qaPeople, onOpen, onQaChange, evidence = [], pipeline }) {
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
    azure: "Assigned",
    "qa-responsavel": "Tested by",
    "qa-testado": "Testado por mim"
  };

  return (
    <article className={`mbaz-card mb-my-qa-board-card ${expanded ? "expanded" : ""} ${age >= 7 ? "mbaz-critical-highlight" : ""}`} data-id={item.id} data-work-item-id={item.id} data-work-item-type={String(item.type || "work item").toLowerCase()} style={{ borderLeftColor: type.color, "--wi-type-color": type.color, "--wi-type-bg": type.bg }}>
      <div className="mbaz-card-row mbaz-card-topline">
        <div className="mbaz-card-left">
          <span className={`mbaz-pill state ${status.key?.startsWith("ready") ? "ready" : ""}`} style={{ background: status.bg, color: status.color }}><i className={`bi ${status.icon}`} />{status.label}</span>
          {(item.myItemSources || []).map((source) => <span key={source} className={`mb-my-source-pill ${source}`}>{sourceLabels[source] || source}</span>)}
        </div>
        <div className="mbaz-card-right">
          <PipelineEnvPill item={item} pipeline={pipeline} />
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

function MyItemCard({ item, checked, onCheck, onOpen, onHours, pipeline }) {
  const typeClass = normalize(item.type) === "bug" ? "bug" : "task";
  const typeInfo = workItemTypes[item.type] || workItemTypes.Task;
  const visibleTags = (item.tags || []).filter((tag) => !/^0-[A-Z]{2}$/i.test(String(tag).trim()));
  const critical = visibleTags.some((tag) => /^(critico|crítico|critical)$/i.test(String(tag)));
  const nextLabel = nextEnvStep[item.env]?.state || (typeClass === "bug" ? bugFallbackNext(item.state) : taskFallbackNext(item.state));
  const itemUrl = item.url || "#";
  const testSummary = testSummaryForItem(item);
  const sourceLabels = {
    azure: "Assigned",
    "qa-responsavel": "Tested by",
    "qa-testado": "Testado por mim"
  };
  return (
    <article className={`mb-my-item-card ${typeClass} ${critical ? "is-critical" : ""}`} data-id={item.id} data-work-item-id={item.id} data-work-item-type={item.type} style={{ "--wi-type-color": typeInfo.color || "#64748b", "--wi-type-bg": typeInfo.background || "#f8fafc" }}>
      <label className="mb-my-item-check" title="Selecionar"><input className="mb-my-item-select" type="checkbox" checked={checked} onChange={(event) => onCheck(item.id, event.target.checked)} /><span /></label>
      <div className="mb-my-item-main">
        <div className="mb-my-item-normal-content">
          <div className="mb-my-item-topline">
            <div className="mb-my-item-type"><img className="mb-my-item-type-icon" src={typeIconSrc(item.type)} alt={item.type} /><strong>{String(item.type || "Work Item").toUpperCase()}</strong><button type="button" className="mb-my-item-id" onClick={() => onOpen(item)}>{formatWorkItemCode(item.id, item.type)}</button>{pipeline && <PipelineEnvPill item={item} pipeline={pipeline} />}</div>
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

// Mesmas cores do --mbdhc-red/blue/gold ja usadas nas barras/legenda CSS de
// Gestao de equipe — os graficos Recharts reaproveitam em vez de duplicar.
function goalStatusColor(status) {
  if (status === "below") return "#d14343";
  if (status === "above") return "#c99a00";
  return "#0078d4";
}

function governanceRoleLevel(person) {
  return person?.accessLevel
    || (person?.isManagement ? "gestao" : person?.isQa ? "qa" : person?.isDev ? "dev" : null);
}

function governanceRoleLabel(person) {
  const level = governanceRoleLevel(person);
  return accessLevelLabels[level] || (person?.isQa ? "QA" : person?.isDev ? "Dev" : person?.isManagement ? "Gestao" : "Sem funcao");
}

function mixHexColor(from, to, ratio) {
  const clamp = Math.max(0, Math.min(1, ratio));
  const parse = (hex) => hex.replace("#", "").match(/.{1,2}/g).map((part) => parseInt(part, 16));
  const [r1, g1, b1] = parse(from);
  const [r2, g2, b2] = parse(to);
  const blend = (a, b) => Math.round(a + (b - a) * clamp).toString(16).padStart(2, "0");
  return `#${blend(r1, r2)}${blend(g1, g2)}${blend(b1, b2)}`;
}

function goalProgressColor(percent) {
  if (percent > 100) return "#d69e00";
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  if (value < 45) return mixHexColor("#dc2626", "#f59e0b", value / 45);
  if (value < 85) return mixHexColor("#f59e0b", "#22c55e", (value - 45) / 40);
  return mixHexColor("#22c55e", "#2563eb", (value - 85) / 15);
}

export function HoursWorkbench() {
  const { t } = useTranslation();
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
  const [metaMetric, setMetaMetric] = usePersistentState("starkHubFilters:governance:metaMetric", "hours");
  const [countryMetric, setCountryMetric] = usePersistentState("starkHubFilters:governance:countryMetric", "count");
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
      const countryHours = {};
      devItems.forEach((item) => (item.countries || ["N/A"]).forEach((country) => {
        countryCounts[country] = (countryCounts[country] || 0) + 1;
        countryHours[country] = (countryHours[country] || 0) + Number(item.completedHours || 0);
      }));
      return { ...dev, items: devItems, completed, tasks, bugs, userStories, features, testableItems, nonTestableItems, testedItems, cardsWithHours, cardsWithoutHours, missingHours, extraHours, progressPercent, goalStatus: status, countries: countryCounts, countryHours, testMetrics, qaResponsibleCount: qaResponsibleItems.length, azureAssignedCount, pendingToTestCount };
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

  const countryCountTotals = Object.entries(filteredDevelopers.reduce((acc, dev) => {
    Object.entries(dev.countries).forEach(([country, count]) => { acc[country] = (acc[country] || 0) + count; });
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]);
  const countryHoursTotals = Object.entries(filteredDevelopers.reduce((acc, dev) => {
    Object.entries(dev.countryHours).forEach(([country, hours]) => { acc[country] = (acc[country] || 0) + hours; });
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]);
  const countryTotals = countryMetric === "hours" ? countryHoursTotals : countryCountTotals;

  const goalCounts = filteredDevelopers.reduce((acc, dev) => ({ ...acc, [dev.goalStatus]: (acc[dev.goalStatus] || 0) + 1 }), { below: 0, met: 0, above: 0 });
  const maxCompleted = Math.max(1, ...filteredDevelopers.map((dev) => Math.max(dev.completed, dev.goalHours)));
  const maxCards = Math.max(1, ...filteredDevelopers.map((dev) => dev.items.length));
  const maxCountry = Math.max(1, ...countryTotals.map(([, count]) => count));
  // Card "Pai": o proprio usuario logado, sempre visivel (nao depende dos
  // filtros ativos). QA ve metricas de teste no lugar de Tasks/Bugs — para
  // QA, o que importa e o que ele testou, nao o que ele "entregou" como dev.
  const ownDev = developers.find((dev) => dev.person?.id === profile?.id)
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
    const webhooks = resolveSlackWebhooks(getSetting);
    if (!webhooks.length) { alert("Nenhum webhook do Slack configurado. Configure em Configuracoes > Slack."); return; }
    const { data, error } = await supabase.functions.invoke("slackNotify", { body: { webhooks, text } });
    if (error || !data?.ok) alert(`Nao foi possivel enviar ao Slack: ${error?.message || "verifique o webhook configurado."}`);
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
    const testTooltip = records.length ? `${evidenceTransitionLabel(records)}\n\n${evidenceTooltip(records)}` : "Sem testes registrados";
    const isTestExpanded = expandedTests.has(itemKey);
    const completedHours = Number(item.completedHours || 0);
    const remainingHours = Number(item.remainingHours || 0);
    const itemProgress = completedHours + remainingHours > 0 ? Math.min(100, (completedHours / (completedHours + remainingHours)) * 100) : (completedHours > 0 ? 100 : 0);
    const itemProgressColor = goalProgressColor(itemProgress);
    return (
      <article key={itemKey} className={`mbdhc-work-card ${String(item.type || "").toLowerCase()} ${noHours ? "missing-hours" : ""} ${item.qaGovernanceCard ? "qa-card" : "dev-card"}`} data-id={item.id} data-work-item-id={item.id} data-work-item-type={String(item.type || "").toLowerCase()} style={{ "--wi-type-color": type.color, "--wi-type-bg": type.bg, "--item-progress": `${itemProgress}%`, "--item-progress-color": itemProgressColor, borderLeftColor: type.color }}>
        <a className="mbdhc-work-card-link" href={workItemUrl(profile, item)} target="_blank" rel="noopener noreferrer">
          <div className="mbdhc-work-main">
            <div className={`mbdhc-work-type-line ${String(item.type || "").toLowerCase()}`}><img className="mbdhc-work-type-icon" src={type.image} alt={item.type} /><strong>{formatWorkItemCode(item.id, item.type)}</strong><span>{item.type}</span></div>
            <h4 title={item.title}>{item.title}</h4>
            <div className="mbdhc-work-country-row"><CountryPills codes={item.countries || []} />{item.sprint && <span className="mbdhc-work-sprint">{compactSprintLabel(item.sprint)}</span>}</div>
            <small>{item.qaGovernanceCard ? "Tested by" : "Assigned"} - {item.state || "Sem status"} - {item.areaPath || "Sem area"}</small>
          </div>
          <div className="mbdhc-work-hours">
            <strong>{formatHours(item.completedHours)}</strong>
            <span>Completed</span>
            {noHours && <em>Sem horas</em>}
            <i className="mbdhc-work-hour-progress" aria-hidden="true" />
          </div>
        </a>
        {testable && (
          <button
            type="button"
            className={`mbdhc-work-test-toggle ${latestInfo?.className || "pending"}`}
            title={testTooltip}
            data-tooltip={testTooltip}
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
    // Gestao/Gerente "puros" (sem Dev/QA acumulado) nao entregam nem testam
    // cards de verdade — mostrar "Entrega"/"Qualidade" pra eles fingia um
    // trabalho que nao existe. Pedido do usuario: metricas de Gestao podem
    // ser genericas, so as de Dev/QA precisam provar o que cada um fez.
    const isManagementOnly = (roleLevel === accessLevels.gestao || roleLevel === accessLevels.gerente) && !dev.person?.isDev && !dev.person?.isQa;
    const countryEntries = Object.entries(dev.countries).sort((a, b) => b[1] - a[1]);
    const visibleCountries = countryEntries.slice(0, 5);
    const hiddenCountryCount = Math.max(0, countryEntries.length - visibleCountries.length);
    const hiddenCountryTitle = countryEntries.slice(5).map(([country, count]) => `${country}: ${count}`).join("\n");
    const envStats = ["DEV", "QA", "BETA", "PROD"].map((env) => ({ env, ...(dev.testMetrics.byEnv[env] || { total: 0, pass: 0, fail: 0, limitation: 0, pending: 0 }) })).filter((row) => row.total > 0);
    const progressColor = goalProgressColor(dev.progressPercent);
    // Uma pessoa pode ter mais de uma funcao (ex.: Dev + Admin) — mostra
    // todos os selos que se aplicam, nunca um rotulo solto tipo
    // "Desenvolvimento"/"Trilha de testes" duplicando o que o selo ja diz.
    const rolePillLevels = collaboratorRoleLevels(dev.person).length ? collaboratorRoleLevels(dev.person) : (roleLevel ? [roleLevel] : []);
    return (
      <article key={dev.key} className={`mbdhc-dev-card role-${roleLevel || "none"} status-${dev.goalStatus} ${dev.goalStatus === "above" ? "pulse-over" : ""} ${pinned ? "mbdhc-dev-card-pinned" : ""}`} style={{ "--goal-progress": `${progressWidth}%`, "--goal-progress-color": progressColor }}>
        {pinned && <div className="mbdhc-dev-pinned-label"><i className="bi bi-person-fill" /> Seu card</div>}
        <div className="mbdhc-dev-head">
          <div className="mbdhc-dev-identity">
            <AvatarDot person={dev.person || { azureName: dev.displayName, imageUrl: dev.avatarUrl, color: dev.color }} name={dev.displayName} />
            {rolePillLevels.map((level) => (
              <span key={level} className={`mbdhc-role-pill role-${level}`}><RoleBadgeIcon level={level} /> {accessLevelLabels[level] || level}</span>
            ))}
          </div>
          <div className="mbdhc-dev-status"><strong>{formatHours(dev.completed)}</strong><span>de {formatHours(dev.goalHours)}</span><em>{statusLabel}</em></div>
        </div>
        <div className="mbdhc-country-pills">
          {visibleCountries.map(([country, count]) => <span key={country} className="mbdhc-country-pill"><CountryVisual code={country} compact /><strong>{count}</strong></span>)}
          {hiddenCountryCount > 0 && <button type="button" className="mbdhc-country-pill more" title={hiddenCountryTitle} data-tooltip={hiddenCountryTitle}>+{hiddenCountryCount}</button>}
        </div>
        <div className="mbdhc-progress" title={`${Math.round(dev.progressPercent)}% da meta`}><span /></div>
        {/* Cards de Dev/QA mostravam os MESMOS 3 clusters (com um rotulo
            generico "Resultado" repetido nos dois), o que dava a impressao
            de que QA desenvolve e Dev testa. Agora cada papel tem exatamente
            2 clusters com rotulo proprio provando o que a pessoa fez de
            verdade: Dev = entrega + taxa de aprovacao nos proprios itens;
            QA = cobertura de teste + resultados que ela encontrou. Gestao
            "pura" (sem Dev/QA acumulado) fica com um resumo generico —
            ela nao entrega nem testa cards, entao fingir essas metricas so
            confundia. */}
        <div className="mbdhc-dev-metric-clusters">
          {isManagementOnly ? (
            <div className="mbdhc-metric-cluster primary"><strong>Resumo</strong><span><b>{dev.items.length}</b><small>cards no periodo</small></span><span><b>{formatHours(dev.completed)}</b><small>horas</small></span></div>
          ) : useTestMetrics ? (
            <>
              <div className="mbdhc-metric-cluster primary"><strong>Testes</strong><span><b>{dev.testMetrics.total}</b><small>feitos</small></span><span><b>{dev.pendingToTestCount}</b><small>fila</small></span><span><b>{dev.qaResponsibleCount}</b><small>QA resp.</small></span></div>
              <div className="mbdhc-metric-cluster quality"><strong>Resultado</strong><span className="approved"><i className="bi bi-check-lg" /><b>{dev.testMetrics.pass}</b><small>pass</small></span><span className="fail"><i className="bi bi-x-lg" /><b>{dev.testMetrics.fail}</b><small>fail</small></span><span className="limitation"><i className="bi bi-exclamation-triangle-fill" /><b>{dev.testMetrics.limitation}</b><small>lim.</small></span></div>
            </>
          ) : (
            <>
              <div className="mbdhc-metric-cluster primary"><strong>Entrega</strong><span><b>{dev.items.length}</b><small>cards</small></span><span><b>{dev.tasks}</b><small>tasks</small></span><span><b>{dev.bugs}</b><small>bugs</small></span></div>
              <div className="mbdhc-metric-cluster quality"><strong>Qualidade · {testPassRate}% aprovacao</strong><span className="approved"><b>{dev.testMetrics.pass}</b><small>aprovados</small></span><span className="fail"><b>{dev.testMetrics.fail}</b><small>reprovados</small></span><span className="limitation"><b>{dev.testMetrics.limitation}</b><small>limitacao</small></span></div>
            </>
          )}
        </div>
        {(envStats.length > 0 || useTestMetrics) && (
          <details className="mbdhc-dev-env-details">
            <summary><span>Ambientes</span><small>{dev.items.length} cards</small><i className="bi bi-chevron-down" /></summary>
            <div>
              {(envStats.length ? envStats : ["DEV", "QA", "BETA", "PROD"].map((env) => ({ env, total: 0, pass: 0, fail: 0, limitation: 0 }))).map((row) => (
                <span key={row.env} title={`${row.env}: ${row.total || 0} teste(s)`}><img src={envIconSrc(row.env)} alt="" /><b>{row.env}</b><small className="approved"><i className="bi bi-check-lg" />{row.pass || 0}</small><small className="fail"><i className="bi bi-x-lg" />{row.fail || 0}</small><small className="limitation"><i className="bi bi-exclamation-triangle-fill" />{row.limitation || 0}</small></span>
              ))}
            </div>
          </details>
        )}
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
        title={ownIsQaOnly ? t("nav.myMetrics") : t("pages.governance.title")}
        subtitle={ownIsQaOnly ? "Seu card com metricas de teste. A visao completa do time e restrita a Gestao/Gerente." : t("pages.governance.subtitle")}
        demoMode={demoMode}
        actions={ownIsQaOnly
          ? <><Button onClick={() => downloadCsv(`minhas-metricas-${dateStamp()}.csv`, ["Colaborador", "Cards", "Tasks", "Bugs", "Horas", "Meta", "Sem horas"], ownDev ? [[ownDev.displayName, ownDev.items.length, ownDev.tasks, ownDev.bugs, ownDev.completed, ownDev.goalHours, ownDev.cardsWithoutHours]] : [])}><FiDownload /> CSV</Button><Button onClick={reload}><FiRefreshCw className={refreshing ? "mbw-spin" : ""} /> Atualizar</Button></>
          : <><Button onClick={() => downloadCsv(`Gestao-equipe-${dateStamp()}.csv`, ["Colaborador", "Papel", "Cards", "Tasks", "Bugs", "User Stories", "Features", "Horas", "Meta", "Com horas", "Sem horas", "Saldo"], filteredDevelopers.map((dev) => [dev.displayName, accessLevelLabels[dev.person?.accessLevel] || (dev.person?.isQa ? "QA" : dev.person?.isDev ? "Dev" : dev.person?.isManagement ? "Gestao" : ""), dev.items.length, dev.tasks, dev.bugs, dev.userStories, dev.features, dev.completed, dev.goalHours, dev.cardsWithHours, dev.cardsWithoutHours, dev.completed - dev.goalHours]))}><FiDownload /> CSV</Button><Button onClick={reload}><FiRefreshCw className={refreshing ? "mbw-spin" : ""} /> Atualizar</Button><Button onClick={copyReport}><FiCopy /> Copiar</Button><Button onClick={sendGovernanceSlack}><i className="bi bi-slack" /> Slack</Button><Button onClick={pdfReport}><FiDownload /> PDF</Button></>}
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
      {/* Eram 8 cards KPI soltos e identicos em peso visual — o usuario
          pediu menos quantidade e melhor apresentacao. Agrupados em 2
          clusters (Equipe/Entregas e Horas), no mesmo estilo compacto ja
          usado nos cards de pessoa abaixo (mbdhc-metric-cluster). */}
      <section className="mbdhc-kpi-clusters">
        {loading ? <KpiSkeleton count={2} /> : (
          <>
            <div className="mbdhc-metric-cluster primary">
              <strong>Equipe &amp; entregas</strong>
              <span><b>{totals.developers}</b><small>colaboradores</small></span>
              <span><b>{totals.cards}</b><small>cards</small></span>
              <span><b>{totals.tasks}</b><small>tasks</small></span>
              <span><b>{totals.bugs}</b><small>bugs</small></span>
            </div>
            <div className="mbdhc-metric-cluster quality">
              <strong>Horas</strong>
              <span><b>{formatHours(totals.completed)}</b><small>registradas</small></span>
              <span><b>{formatHours(totals.goal)}</b><small>meta total</small></span>
              <span className="fail"><b>{formatHours(totals.missing)}</b><small>pendentes</small></span>
              <span className="limitation"><b>+{formatHours(totals.extra)}</b><small>excedente</small></span>
            </div>
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
              <section className="mbdhc-chart-card">
                <div className="mbdhc-chart-card-head">
                  <h3>Meta x realizado</h3>
                  <div className="mbdhc-metric-toggle">
                    <button type="button" className={metaMetric === "hours" ? "active" : ""} onClick={() => setMetaMetric("hours")}>Horas</button>
                    <button type="button" className={metaMetric === "qty" ? "active" : ""} onClick={() => setMetaMetric("qty")}>Qtd</button>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={filteredDevelopers.slice(0, 12).map((dev) => ({ key: dev.key, name: shortName(dev.displayName), value: metaMetric === "hours" ? dev.completed : dev.items.length, status: dev.goalStatus }))} layout="vertical" margin={{ top: 4, right: 36, bottom: 4, left: 4 }}>
                    <XAxis type="number" hide domain={[0, metaMetric === "hours" ? maxCompleted : maxCards]} />
                    <YAxis type="category" dataKey="name" width={90} tick={<CompactAxisTick width={82} />} axisLine={false} tickLine={false} />
                    <Tooltip content={<RechartsTooltip />} cursor={{ fill: "var(--starkSurfaceAlt)" }} />
                    <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                      {filteredDevelopers.slice(0, 12).map((dev) => <Cell key={dev.key} fill={metaMetric === "hours" ? goalStatusColor(dev.goalStatus) : "#0078d4"} />)}
                      <LabelList dataKey="value" position="right" formatter={metaMetric === "hours" ? formatHours : undefined} style={{ fill: "var(--starkMuted)", fontSize: 11 }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                {metaMetric === "hours" && <div className="mbdhc-legend discreet"><span><i className="red" />Abaixo da meta</span><span><i className="blue" />Meta cumprida</span><span><i className="gold" />Acima da meta</span></div>}
              </section>
              <section className="mbdhc-chart-card">
                <h3>Status das metas</h3>
                <div className="mbaz-donut-wrap">
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie data={[{ key: "below", name: "Abaixo", value: goalCounts.below }, { key: "met", name: "Cumprida", value: goalCounts.met }, { key: "above", name: "Acima", value: goalCounts.above }]} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={2}>
                        <Cell fill={goalStatusColor("below")} stroke="var(--starkSurface)" strokeWidth={2} />
                        <Cell fill={goalStatusColor("met")} stroke="var(--starkSurface)" strokeWidth={2} />
                        <Cell fill={goalStatusColor("above")} stroke="var(--starkSurface)" strokeWidth={2} />
                      </Pie>
                      <Tooltip content={<RechartsTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="mbaz-donut-center"><strong>{totals.developers}</strong><small>Equipe</small></div>
                </div>
                <div className="mbdhc-legend discreet"><span><i className="red" />Abaixo: {goalCounts.below}</span><span><i className="blue" />Cumprida: {goalCounts.met}</span><span><i className="gold" />Acima: {goalCounts.above}</span></div>
              </section>
              <section className="mbdhc-chart-card">
                <div className="mbdhc-chart-card-head">
                  <h3>Distribuicao por pais</h3>
                  <div className="mbdhc-metric-toggle">
                    <button type="button" className={countryMetric === "count" ? "active" : ""} onClick={() => setCountryMetric("count")}>Qtd</button>
                    <button type="button" className={countryMetric === "hours" ? "active" : ""} onClick={() => setCountryMetric("hours")}>Horas</button>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={countryTotals.map(([country, value]) => ({ country, value }))} layout="vertical" margin={{ top: 4, right: 36, bottom: 4, left: 4 }}>
                    <XAxis type="number" hide domain={[0, maxCountry]} />
                    <YAxis type="category" dataKey="country" width={50} tick={<CountryFlagAxisTick width={46} />} axisLine={false} tickLine={false} />
                    <Tooltip content={<RechartsTooltip />} cursor={{ fill: "var(--starkSurfaceAlt)" }} />
                    <Bar dataKey="value" radius={[0, 6, 6, 0]} fill="#0078d4">
                      <LabelList dataKey="value" position="right" formatter={countryMetric === "hours" ? formatHours : undefined} style={{ fill: "var(--starkMuted)", fontSize: 11 }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </section>
              <section className="mbdhc-chart-card mbdhc-collab-country-card">
                <div className="mbdhc-chart-card-head">
                  <h3>Pais x colaborador</h3>
                  <div className="mbdhc-metric-toggle">
                    <button type="button" className={countryMetric === "count" ? "active" : ""} onClick={() => setCountryMetric("count")}>Qtd</button>
                    <button type="button" className={countryMetric === "hours" ? "active" : ""} onClick={() => setCountryMetric("hours")}>Horas</button>
                  </div>
                </div>
                <CollaboratorCountryMatrix developers={filteredDevelopers} metric={countryMetric} />
              </section>
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

// Precisa viver FORA de SettingsWorkbench: definida dentro, virava uma
// funcao/componente NOVO a cada render (qualquer digitacao num campo do
// formulario ja causa um re-render do componente pai) — o React via isso
// como um tipo de componente diferente e desmontava/remontava TODOS os
// <details> (e os inputs focados dentro deles) a cada tecla, fechando os
// acordeões e derrubando o foco/valor digitado no meio da digitação.
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

export function SettingsWorkbench() {
  const { profile, user, demoMode, updateLocalAzureConnection } = useAuth();
  const { flags, isEnabled, setFlag } = useFeatureFlags();
  const { collaborators } = useCollaborators();
  const { getSetting, updateSetting, loading: settingsLoading } = useAppSettings();
  // Feature flags ligam/desligam telas inteiras pra todo mundo — pedido
  // explicito do usuario pra restringir isso a Admin, nao a Gestao/Gerente
  // (que ja podia mexer aqui antes). Admin tambem herda tudo que Gestao ve
  // nesta tela, mesmo com nivel de acesso formal Dev/QA/pending.
  const isAdmin = Boolean(profile?.isAdmin || profile?.accessLevel === accessLevels.admin);
  const isGestao = hasManagementAccess(profile?.accessLevel, isAdmin);
  const { pushToast } = useToast();
  const initialSettingsSynced = useRef(false);
  const settingsRef = useRef(null);

  // Prevent native form submissions inside the settings panel (capture phase)
  useEffect(() => {
    function handleSubmit(e) {
      if (!settingsRef.current) return;
      if (settingsRef.current.contains(e.target)) {
        const form = e.target.closest && e.target.closest("form");
        if (form && form.dataset && form.dataset.allowSubmit === "true") return; // allow explicit forms
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }
    document.addEventListener("submit", handleSubmit, true);
    return () => document.removeEventListener("submit", handleSubmit, true);
  }, []);
  function readPersonalSetting(key, fallback = "") {
    return readPersonalSettingShared(profile, user, key, fallback);
  }
  function writePersonalSettings(payload) {
    writePersonalSettingsShared(profile, user, payload);
  }
  const importRef = useRef(null);
  const [productName, setProductName] = useState(getSetting("productName", "Stark Hub"));
  const [goalHours, setGoalHours] = useState(getSetting("defaultGoalHours", defaultGoalHours));
  const [azureMaxItems, setAzureMaxItems] = useState(getSetting("azureMaxItems", 200));
  const [azureAutoRefreshSeconds, setAzureAutoRefreshSeconds] = useState(getSetting("azureAutoRefreshSeconds", 60));
  const [notificationSoundsMuted, setNotificationSoundsMuted] = useState(() => Boolean(readNotificationSetting(profile, user, "notificationSoundsMuted", false)));
  const [notificationSoundPrefs, setNotificationSoundPrefs] = useState(() =>
    Object.fromEntries(notificationTypes.map(({ key }) => [key, Boolean(readNotificationSetting(profile, user, `notificationSoundEnabled:${key}`, true))]))
  );
  // Permissao do navegador e um efeito colateral imediato (nao da pra "adiar
  // e confirmar depois" como o resto de Configuracoes) — por isso este
  // bloco escreve direto, sem draft/dirty/Confirmar.
  const [browserNotifPermission, setBrowserNotifPermission] = useState(() => (typeof Notification === "undefined" ? "unsupported" : Notification.permission));
  const [browserNotifEnabled, setBrowserNotifEnabled] = useState(() => Boolean(readNotificationSetting(profile, user, "browserNotificationsEnabled", false)));

  async function requestBrowserNotifications() {
    if (typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    setBrowserNotifPermission(result);
    if (result === "granted") {
      setBrowserNotifEnabled(true);
      writeNotificationSetting(profile, user, "browserNotificationsEnabled", true);
    }
  }

  function toggleBrowserNotifEnabled(value) {
    setBrowserNotifEnabled(value);
    writeNotificationSetting(profile, user, "browserNotificationsEnabled", value);
  }
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
  const [slackWebhooks, setSlackWebhooks] = useState(() => readPersonalSetting("slackWebhooks", []));
  const [configScope, setConfigScope] = usePersistentState("starkHubFilters:settings:configScope", profile?.accessLevel || accessLevels.dev);
  const [showSecrets, setShowSecrets] = useState(false);
  const [saving, setSaving] = useState("");
  const [preview, setPreview] = useState("");
  // global inline saveStatus removed; using toasts instead

  // Local drafts for per-section confirm behavior
  const [productDraft, setProductDraft] = useState(productName);
  const [azureAutoRefreshDraft, setAzureAutoRefreshDraft] = useState(azureAutoRefreshSeconds);
  const [localFlags, setLocalFlags] = useState(flags || {});
  // per-section inline status removed in favor of toasts

  // Drafts for other sections
  const [azureMaxItemsDraft, setAzureMaxItemsDraft] = useState(azureMaxItems);
  const [iterationPatternDraft, setIterationPatternDraft] = useState(iterationPattern);

  const [pipelineQaDraft, setPipelineQaDraft] = useState(pipelineQaName);
  const [pipelineBetaDraft, setPipelineBetaDraft] = useState(pipelineBetaName);

  const [slackTestModeDraft, setSlackTestModeDraft] = useState(isGestao ? slackTestMode : personalSlackTestMode);
  const [slackPrimaryNameDraft, setSlackPrimaryNameDraft] = useState(isGestao ? slackPrimaryWebhookName : personalSlackPrimaryWebhookName);
  const [slackWebhookDraft, setSlackWebhookDraft] = useState(isGestao ? slackWebhookUrl : personalSlackWebhookUrl);
  const [slackTestWebhookDraft, setSlackTestWebhookDraft] = useState(isGestao ? slackTestWebhookUrl : personalSlackTestWebhookUrl);
  const [slackResultWebhookDraft, setSlackResultWebhookDraft] = useState(() => (slackWebhooks || []).find((entry) => entry.purpose === "testResult")?.url || "");
  const [slackCreationWebhookDraft, setSlackCreationWebhookDraft] = useState(() => (slackWebhooks || []).find((entry) => entry.purpose === "workItemCreation")?.url || "");
  const [slackCustomWebhookDraft, setSlackCustomWebhookDraft] = useState(() => (slackWebhooks || []).find((entry) => entry.purpose === "custom")?.url || "");

  const [goalHoursDraft, setGoalHoursDraft] = useState(goalHours);

  const [notificationSoundsMutedDraft, setNotificationSoundsMutedDraft] = useState(notificationSoundsMuted);
  const [notificationSoundPrefsDraft, setNotificationSoundPrefsDraft] = useState(notificationSoundPrefs);

  // per-section inline status removed in favor of toasts

  useEffect(() => setProductDraft(productName), [productName]);
  useEffect(() => setAzureAutoRefreshDraft(azureAutoRefreshSeconds), [azureAutoRefreshSeconds]);
  useEffect(() => setLocalFlags(flags || {}), [flags]);
  useEffect(() => setAzureMaxItemsDraft(azureMaxItems), [azureMaxItems]);
  useEffect(() => setIterationPatternDraft(iterationPattern), [iterationPattern]);
  useEffect(() => setPipelineQaDraft(pipelineQaName), [pipelineQaName]);
  useEffect(() => setPipelineBetaDraft(pipelineBetaName), [pipelineBetaName]);
  useEffect(() => setSlackTestModeDraft(isGestao ? slackTestMode : personalSlackTestMode), [slackTestMode, personalSlackTestMode, isGestao]);
  useEffect(() => setSlackPrimaryNameDraft(isGestao ? slackPrimaryWebhookName : personalSlackPrimaryWebhookName), [slackPrimaryWebhookName, personalSlackPrimaryWebhookName, isGestao]);
  useEffect(() => setSlackWebhookDraft(isGestao ? slackWebhookUrl : personalSlackWebhookUrl), [slackWebhookUrl, personalSlackWebhookUrl, isGestao]);
  useEffect(() => setSlackTestWebhookDraft(isGestao ? slackTestWebhookUrl : personalSlackTestWebhookUrl), [slackTestWebhookUrl, personalSlackTestWebhookUrl, isGestao]);
  useEffect(() => {
    setSlackResultWebhookDraft((slackWebhooks || []).find((entry) => entry.purpose === "testResult")?.url || "");
    setSlackCreationWebhookDraft((slackWebhooks || []).find((entry) => entry.purpose === "workItemCreation")?.url || "");
    setSlackCustomWebhookDraft((slackWebhooks || []).find((entry) => entry.purpose === "custom")?.url || "");
  }, [slackWebhooks]);
  useEffect(() => setGoalHoursDraft(goalHours), [goalHours]);
  useEffect(() => setNotificationSoundsMutedDraft(notificationSoundsMuted), [notificationSoundsMuted]);
  useEffect(() => setNotificationSoundPrefsDraft(notificationSoundPrefs), [notificationSoundPrefs]);

  function applyProductSection() {
    // Apply product draft to global state and persist via saveSettings()
    (async () => {
      try {
        setProductName(productDraft);
        setAzureAutoRefreshSeconds(Number(azureAutoRefreshDraft) || 0);
        // update flags via API immediately
        await Promise.all(Object.entries(localFlags).filter(([k, v]) => flags?.[k] !== v).map(([k, v]) => setFlag(k, v)));
        await saveSettings();
        pushToast({ title: "Configurações", body: "Alterações aplicadas com sucesso.", tone: "success" });
      } catch (err) {
        pushToast({ title: "Erro", body: err?.message || String(err), tone: "danger" });
      }
    })();
  }

  function cancelProductSection() {
    setProductDraft(productName);
    setAzureAutoRefreshDraft(azureAutoRefreshSeconds);
    setLocalFlags(flags || {});
  }

  async function applyConnectionsSection() {
    try {
      setAzureMaxItems(Number(azureMaxItemsDraft) || 200);
      setIterationPattern(iterationPatternDraft);
      await saveSettings();
      pushToast({ title: "Conexões", body: "Conexões aplicadas.", tone: "success" });
    } catch (err) {
      pushToast({ title: "Erro", body: err?.message || String(err), tone: "danger" });
    }
  }

  function cancelConnectionsSection() {
    setAzureMaxItemsDraft(azureMaxItems);
    setIterationPatternDraft(iterationPattern);
  }

  async function applyPipelinesSection() {
    try {
      setPipelineQaName(pipelineQaDraft);
      setPipelineBetaName(pipelineBetaDraft);
      await saveSettings();
      pushToast({ title: "Pipelines", body: "Pipelines aplicadas.", tone: "success" });
    } catch (err) {
      pushToast({ title: "Erro", body: err?.message || String(err), tone: "danger" });
    }
  }

  function cancelPipelinesSection() {
    setPipelineQaDraft(pipelineQaName);
    setPipelineBetaDraft(pipelineBetaName);
  }

  async function applySlackSection() {
    try {
      if (isGestao) {
        setSlackTestMode(slackTestModeDraft);
        setSlackPrimaryWebhookName(slackPrimaryNameDraft);
        setSlackWebhookUrl(slackWebhookDraft);
        setSlackTestWebhookUrl(slackTestWebhookDraft);
      } else {
        setPersonalSlackTestMode(slackTestModeDraft);
        setPersonalSlackPrimaryWebhookName(slackPrimaryNameDraft);
        setPersonalSlackWebhookUrl(slackWebhookDraft);
        setPersonalSlackTestWebhookUrl(slackTestWebhookDraft);
      }
      setSlackWebhooks(buildSlackWebhookEntries());
      await saveSettings();
      pushToast({ title: "Slack", body: "Slack aplicado.", tone: "success" });
    } catch (err) {
      pushToast({ title: "Erro", body: err?.message || String(err), tone: "danger" });
    }
  }

  function cancelSlackSection() {
    setSlackTestModeDraft(isGestao ? slackTestMode : personalSlackTestMode);
    setSlackPrimaryNameDraft(isGestao ? slackPrimaryWebhookName : personalSlackPrimaryWebhookName);
    setSlackWebhookDraft(isGestao ? slackWebhookUrl : personalSlackWebhookUrl);
    setSlackTestWebhookDraft(isGestao ? slackTestWebhookUrl : personalSlackTestWebhookUrl);
    setSlackResultWebhookDraft((slackWebhooks || []).find((entry) => entry.purpose === "testResult")?.url || "");
    setSlackCreationWebhookDraft((slackWebhooks || []).find((entry) => entry.purpose === "workItemCreation")?.url || "");
    setSlackCustomWebhookDraft((slackWebhooks || []).find((entry) => entry.purpose === "custom")?.url || "");
  }

  function buildSlackWebhookEntries() {
    return [
      { purpose: "testResult", name: "Resultado de testes", url: slackResultWebhookDraft, enabled: Boolean(slackResultWebhookDraft) },
      { purpose: "workItemCreation", name: "QA Demand Notification", url: slackCreationWebhookDraft, enabled: Boolean(slackCreationWebhookDraft) },
      { purpose: "custom", name: "Custom", url: slackCustomWebhookDraft, enabled: Boolean(slackCustomWebhookDraft) }
    ].filter((entry) => entry.url);
  }

  async function testSlackWebhook(url, label) {
    if (!url) {
      pushToast({ title: "Slack", body: `Preencha o webhook de ${label} antes de testar.`, tone: "warning" });
      return;
    }
    await supabase.functions.invoke("slackNotify", { body: { webhooks: [url], text: `:test-tag: Teste Stark Hub - ${label}` } });
    pushToast({ title: "Slack", body: `Mensagem de teste enviada para ${label}.`, tone: "success" });
  }

  async function applyGovernanceSection() {
    try {
      setGoalHours(goalHoursDraft);
      await saveSettings();
      pushToast({ title: "Governança", body: "Governança aplicada.", tone: "success" });
    } catch (err) {
      pushToast({ title: "Erro", body: err?.message || String(err), tone: "danger" });
    }
  }

  function cancelGovernanceSection() {
    setGoalHoursDraft(goalHours);
  }

  async function applyNotificationsSection() {
    try {
      setNotificationSoundsMuted(notificationSoundsMutedDraft);
      setNotificationSoundPrefs(notificationSoundPrefsDraft);
      // saveSettings writes notification preferences
      await saveSettings();
      pushToast({ title: "Notificações", body: "Notificações aplicadas.", tone: "success" });
    } catch (err) {
      pushToast({ title: "Erro", body: err?.message || String(err), tone: "danger" });
    }
  }

  function cancelNotificationsSection() {
    setNotificationSoundsMutedDraft(notificationSoundsMuted);
    setNotificationSoundPrefsDraft(notificationSoundPrefs);
  }

  // Apply all drafts to global state and persist
  async function applyAllAndSave() {
    setSaving("settings");
    // copy drafts into state
    setProductName(productDraft);
    setAzureAutoRefreshSeconds(Number(azureAutoRefreshDraft) || 0);
    setAzureMaxItems(Number(azureMaxItemsDraft) || 200);
    setIterationPattern(iterationPatternDraft);
    setPipelineQaName(pipelineQaDraft);
    setPipelineBetaName(pipelineBetaDraft);
    if (isGestao) {
      setSlackTestMode(slackTestModeDraft);
      setSlackPrimaryWebhookName(slackPrimaryNameDraft);
      setSlackWebhookUrl(slackWebhookDraft);
      setSlackTestWebhookUrl(slackTestWebhookDraft);
    } else {
      setPersonalSlackTestMode(slackTestModeDraft);
      setPersonalSlackPrimaryWebhookName(slackPrimaryNameDraft);
      setPersonalSlackWebhookUrl(slackWebhookDraft);
      setPersonalSlackTestWebhookUrl(slackTestWebhookDraft);
    }
    setSlackWebhooks(buildSlackWebhookEntries());
    setGoalHours(Number(goalHoursDraft) || defaultGoalHours);
    setNotificationSoundsMuted(notificationSoundsMutedDraft);
    setNotificationSoundPrefs(notificationSoundPrefsDraft);
    // apply feature flags
    await Promise.all(Object.entries(localFlags).filter(([k, v]) => flags?.[k] !== v).map(([k, v]) => setFlag(k, v)));
    // Persist everything
    await saveSettings();
    setSaving("");
    pushToast({ title: "Configurações", body: "Todas as alterações aplicadas.", tone: "success" });
  }

  function cancelAllDrafts() {
    // reset drafts to current state
    setProductDraft(productName);
    setAzureAutoRefreshDraft(azureAutoRefreshSeconds);
    setAzureMaxItemsDraft(azureMaxItems);
    setIterationPatternDraft(iterationPattern);
    setPipelineQaDraft(pipelineQaName);
    setPipelineBetaDraft(pipelineBetaName);
    setSlackTestModeDraft(isGestao ? slackTestMode : personalSlackTestMode);
    setSlackPrimaryNameDraft(isGestao ? slackPrimaryWebhookName : personalSlackPrimaryWebhookName);
    setSlackWebhookDraft(isGestao ? slackWebhookUrl : personalSlackWebhookUrl);
    setSlackTestWebhookDraft(isGestao ? slackTestWebhookUrl : personalSlackTestWebhookUrl);
    setGoalHoursDraft(goalHours);
    setNotificationSoundsMutedDraft(notificationSoundsMuted);
    setNotificationSoundPrefsDraft(notificationSoundPrefs);
    setLocalFlags(flags || {});
    pushToast({ title: "Rascunhos", body: "Todas as alterações locais foram descartadas.", tone: "warning" });
  }

  function cancelProductSection() {
    setProductDraft(productName);
    setAzureAutoRefreshDraft(azureAutoRefreshSeconds);
    setLocalFlags(flags || {});
  }

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
    if (initialSettingsSynced.current) return; // only resync once to avoid resetting drafts on subsequent reloads
    setProductName(getSetting("productName", "Stark Hub"));
    setGoalHours(getSetting("defaultGoalHours", defaultGoalHours));
    setAzureMaxItems(getSetting("azureMaxItems", 200));
    setAzureAutoRefreshSeconds(getSetting("azureAutoRefreshSeconds", 60));
    setIterationPattern(getSetting("azureIterationPattern", ""));
    setSlackWebhookUrl(getSetting("slackWebhookUrl", ""));
    setSlackTestMode(Boolean(getSetting("slackTestMode", false)));
    setSlackTestWebhookUrl(getSetting("slackTestWebhookUrl", ""));
    setSlackPrimaryWebhookName(getSetting("slackPrimaryWebhookName", "Canal principal"));
    initialSettingsSynced.current = true;
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
    // clear any inline status; toasts will show results
    // Sons de notificacao sao preferencia individual: salvos sempre, para
    // qualquer nivel de acesso, independente do restante do formulario ser
    // pessoal (Dev/QA) ou global (Gestao).
    writeNotificationSetting(profile, user, "notificationSoundsMuted", notificationSoundsMuted);
    notificationTypes.forEach(({ key }) => writeNotificationSetting(profile, user, `notificationSoundEnabled:${key}`, notificationSoundPrefs[key]));
    // Webhook do Slack e um segredo (qualquer um que o tenha pode postar no
    // canal) — nunca vai para `app_settings`, tabela que qualquer usuario
    // autenticado pode ler (ver policy app_settings_read_authenticated no
    // schema.sql). Fica sempre so no localStorage deste navegador, seja
    // Gestao ou nao; os demais campos nao sensiveis (nome do canal, modo
    // teste, pipelines) continuam compartilhados via Supabase quando quem
    // salva e Gestao.
    try {
      writePersonalSettings(isGestao
        ? { slackWebhookUrl, slackTestWebhookUrl, slackWebhooks: buildSlackWebhookEntries(), updatedAt: new Date().toISOString() }
        : {
          pipelineQaName,
          pipelineBetaName,
          slackWebhookUrl: personalSlackWebhookUrl,
          slackTestWebhookUrl: personalSlackTestWebhookUrl,
          slackWebhooks: buildSlackWebhookEntries(),
          slackTestMode: personalSlackTestMode,
          slackPrimaryWebhookName: personalSlackPrimaryWebhookName,
          updatedAt: new Date().toISOString()
        });
    } catch (error) {
      pushToast({ title: "Erro", body: `Falha ao aplicar: ${error.message}`, tone: "danger" });
      setSaving("");
      return;
    }
    if (!isGestao) {
      pushToast({ title: "Configurações", body: "Configurações aplicadas com sucesso.", tone: "success" });
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
      updateSetting("slackTestMode", slackTestMode),
      updateSetting("slackPrimaryWebhookName", slackPrimaryWebhookName)
    ]);
    const failed = results.filter((result) => result?.error);
    if (failed.length) {
      pushToast({ title: "Erro", body: `Falha ao aplicar ${failed.length} configuracao(oes): ${failed[0].error.message}`, tone: "danger" });
    } else {
      pushToast({ title: "Configurações", body: "Configurações aplicadas com sucesso.", tone: "success" });
    }
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

  // Arquivo de "primeiro acesso" pra mandar a qualquer colaborador, de
  // qualquer nivel de acesso — organizacao/projeto/time do Azure, nomes de
  // pipeline e os webhooks do Slack, tudo que hoje precisa ser digitado do
  // zero por cada pessoa nova. De proposito SEM o PAT: e uma credencial
  // pessoal, cada um gera e cola a propria (ver AzureConnectionForm.jsx).
  function exportTeamOnboardingConfig() {
    const payload = {
      schema: "stark-hub-config",
      version: 1,
      type: "team-onboarding",
      exportedAt: new Date().toISOString(),
      securityNote: "Contem o webhook do Slack da equipe (sem PAT pessoal). Nao commitar em repositorio; enviar so por um canal seguro (DM) para o colaborador.",
      azure: {
        orgUrl: profile?.azureOrgUrl || "",
        project: profile?.azureProject || "",
        team: profile?.azureTeam || "",
        pipelineQaName,
        pipelineBetaName
      },
      slack: {
        webhookUrl: isGestao ? slackWebhookUrl : personalSlackWebhookUrl,
        testWebhookUrl: isGestao ? slackTestWebhookUrl : personalSlackTestWebhookUrl,
        testMode: isGestao ? slackTestMode : personalSlackTestMode,
        primaryWebhookName: isGestao ? slackPrimaryWebhookName : personalSlackPrimaryWebhookName
      }
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "stark-hub-config-equipe.json";
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
      ["Webhook Slack", (isGestao ? slackWebhookUrl : personalSlackWebhookUrl) ? "Configurado localmente (oculto)" : "Nao configurado"],
      ["Webhook testes", (isGestao ? slackTestWebhookUrl : personalSlackTestWebhookUrl) ? "Configurado localmente (oculto)" : "Nao configurado"]
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
      // "team-onboarding" e de proposito sem restricao de escopo/nivel de
      // acesso — e o arquivo pensado pra ser mandado a qualquer colaborador
      // novo, de qualquer papel, pra nao precisar digitar org/projeto/time/
      // pipelines/webhook do zero.
      if (payload.type === "team-onboarding") {
        const azure = payload.azure || {};
        const slack = payload.slack || {};
        updateLocalAzureConnection({
          azureOrgUrl: azure.orgUrl || "",
          azureProject: azure.project || "",
          azureTeam: azure.team || ""
        });
        setPipelineQaName(azure.pipelineQaName || "");
        setPipelineBetaName(azure.pipelineBetaName || "");
        if (isGestao) {
          setSlackWebhookUrl(slack.webhookUrl || "");
          setSlackTestWebhookUrl(slack.testWebhookUrl || "");
          setSlackTestMode(Boolean(slack.testMode));
          setSlackPrimaryWebhookName(slack.primaryWebhookName || "Canal principal");
        } else {
          setPersonalSlackWebhookUrl(slack.webhookUrl || "");
          setPersonalSlackTestWebhookUrl(slack.testWebhookUrl || "");
          setPersonalSlackTestMode(Boolean(slack.testMode));
          setPersonalSlackPrimaryWebhookName(slack.primaryWebhookName || "Canal pessoal");
        }
        setPreview("Configuracao da equipe importada. Revise e clique em Salvar. Falta so colar seu PAT pessoal do Azure DevOps na tela de conexao.");
        return;
      }
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

  return (
    <section ref={settingsRef} className="mbw-page mb-settings-page mb-settings-workbench">
      {/* determine if any draft differs from current state */}
      {
        (() => {
          const flagsDirty = Object.entries(localFlags).some(([k, v]) => flags?.[k] !== v);
          const notifDirty = notificationSoundsMutedDraft !== notificationSoundsMuted || Object.entries(notificationSoundPrefsDraft).some(([k, v]) => notificationSoundPrefs[k] !== v);
          const anyDirty = (
            productDraft !== productName ||
            String(azureAutoRefreshDraft) !== String(azureAutoRefreshSeconds) ||
            String(azureMaxItemsDraft) !== String(azureMaxItems) ||
            iterationPatternDraft !== iterationPattern ||
            pipelineQaDraft !== pipelineQaName ||
            pipelineBetaDraft !== pipelineBetaName ||
            slackTestModeDraft !== (isGestao ? slackTestMode : personalSlackTestMode) ||
            slackPrimaryNameDraft !== (isGestao ? slackPrimaryWebhookName : personalSlackPrimaryWebhookName) ||
            slackWebhookDraft !== (isGestao ? slackWebhookUrl : personalSlackWebhookUrl) ||
            slackTestWebhookDraft !== (isGestao ? slackTestWebhookUrl : personalSlackTestWebhookUrl) ||
            String(goalHoursDraft) !== String(goalHours) ||
            flagsDirty || notifDirty
          );
          return (
            <WorkbenchHeader
              kicker="Produto"
              title="Configuracoes"
              subtitle={isGestao ? "Produto, funcionalidades, conexoes e Gestao." : "Conexoes pessoais do Azure, pipelines e Slack."}
              demoMode={demoMode}
              actions={<>
                {isGestao && <div className="mb-settings-scope"><FilterCombobox label="Escopo" options={[{ value: accessLevels.dev, label: "Dev" }, { value: accessLevels.qa, label: "QA" }, { value: accessLevels.gestao, label: "Gestao" }, { value: accessLevels.gerente, label: "Gerente" }]} values={[configScope]} multiple={false} onChange={(value) => setConfigScope(value || accessLevels.gestao)} /></div>}
                <Button onClick={() => importRef.current?.click()}><FiUpload /> Importar</Button>
                <Button onClick={exportSettingsCsv}><FiDownload /> CSV</Button>
                <Button onClick={exportConfig}><FiDownload /> Exportar</Button>
                <Button onClick={exportTeamOnboardingConfig} title="Gera um arquivo com org/projeto/pipelines/webhook (sem PAT) pra mandar a qualquer colaborador novo"><FiDownload /> Config. p/ equipe</Button>
                <Button onClick={previewSlack}><FiCopy /> Testar Slack</Button>
                <Button onClick={applyAllAndSave} tone="primary" disabled={!anyDirty}>{saving ? "Aplicando..." : "Aplicar tudo"}</Button>
                <Button onClick={cancelAllDrafts} disabled={!anyDirty}>Cancelar tudo</Button>
              </>}
            />
          );
        })()
      }
      <input ref={importRef} type="file" accept="application/json" hidden onChange={importConfig} />
      <div className="mb-settings-grid">
        {isGestao && <SettingsSection title="Produto e funcionalidades" description="Identidade do produto e feature flags." open>
            <label className="mb-form-row"><span>Nome do produto</span><input value={productDraft} onChange={(event) => setProductDraft(event.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()} /></label>
            <label className="mb-form-row"><span>Intervalo de atualizacao automatica (segundos)</span><input type="number" min="0" step="10" value={azureAutoRefreshDraft} onChange={(event) => setAzureAutoRefreshDraft(event.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()} /></label>
          <small className="mb-settings-note">Tempo entre cada atualizacao automatica do Quality Board e Meus itens. Use 0 para desativar o auto-reload.</small>
          {isAdmin && (
            <>
              <div className="mb-settings-subtitle">Funcionalidades</div>
              <div className="mb-featureflag-grid">
                {Object.entries(featureLabels).map(([key, [label, description]]) => (
                  <label key={key} className="mb-switch-row">
                    <span><strong>{label}</strong><small>{description}</small></span>
                    <span className="mb-switch"><input type="checkbox" checked={Boolean(localFlags?.[key])} disabled={!isAdmin} onChange={(event) => setLocalFlags((prev) => ({ ...prev, [key]: event.target.checked }))} /><span className="mb-switch-slider" /></span>
                  </label>
                ))}
              </div>
            </>
          )}
          {(() => {
            const dirty = productDraft !== productName || String(azureAutoRefreshDraft) !== String(azureAutoRefreshSeconds) || Object.entries(localFlags).some(([k, v]) => flags?.[k] !== v);
            return (
              dirty && (
                <div className="mb-settings-actions" style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <Button tone="primary" onClick={applyProductSection}>Confirmar</Button>
                  <Button onClick={cancelProductSection}>Cancelar</Button>
                </div>
              )
            );
          })()}
          {/* success/error shown as toasts */}
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
                <label className="mb-form-row"><span>Limite de itens buscados</span><input type="number" min="100" step="100" value={azureMaxItemsDraft} onChange={(event) => setAzureMaxItemsDraft(event.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()} /></label>
                <label className="mb-form-row"><span>Iteration pattern</span><input value={iterationPatternDraft} onChange={(event) => setIterationPatternDraft(event.target.value)} placeholder="MB Labs" onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()} /></label>
                <small className="mb-settings-note">Afeta Quality Board, Meus itens e Gestao — nao e especifico de nenhuma tela.</small>
                {(() => {
                  const dirty = String(azureMaxItemsDraft) !== String(azureMaxItems) || iterationPatternDraft !== iterationPattern;
                  return dirty && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <Button tone="primary" onClick={applyConnectionsSection}>Confirmar</Button>
                      <Button onClick={cancelConnectionsSection}>Cancelar</Button>
                    </div>
                  );
                })()}
                {/* status shown as toast */}
              </div>
            </details>
          )}
          <details className="mb-inner-accordion">
            <summary><span>Pipelines</span><small>Nomes das pipelines QA e BETA</small></summary>
            <div className="mb-inner-accordion-body">
              <label className="mb-form-row"><span>Pipeline QA</span><input value={pipelineQaDraft} onChange={(event) => setPipelineQaDraft(event.target.value)} placeholder="Preencha nas configuracoes" onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()} /></label>
              <label className="mb-form-row"><span>Pipeline BETA</span><input value={pipelineBetaDraft} onChange={(event) => setPipelineBetaDraft(event.target.value)} placeholder="Preencha nas configuracoes" onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()} /></label>
              {!isGestao && <small className="mb-settings-note">Estas informacoes ficam salvas localmente no navegador deste usuario.</small>}
              {(() => {
                const dirty = pipelineQaDraft !== pipelineQaName || pipelineBetaDraft !== pipelineBetaName;
                return dirty && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <Button tone="primary" onClick={applyPipelinesSection}>Confirmar</Button>
                    <Button onClick={cancelPipelinesSection}>Cancelar</Button>
                  </div>
                );
              })()}
                {/* status shown as toast */}
            </div>
          </details>
          <details className="mb-inner-accordion">
            <summary><span>Slack</span><small>Webhook, teste e canal principal</small></summary>
            <div className="mb-inner-accordion-body">
              <label className="mb-switch-row"><span><strong>Modo teste</strong><small>Usar webhook de teste quando disponivel</small></span><span className="mb-switch"><input type="checkbox" checked={slackTestModeDraft} onChange={(event) => setSlackTestModeDraft(event.target.checked)} /><span className="mb-switch-slider" /></span></label>
              <label className="mb-form-row"><span>Nome do canal principal</span><input value={slackPrimaryNameDraft} onChange={(event) => setSlackPrimaryNameDraft(event.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()} /></label>
              <label className="mb-form-row"><span>Webhook principal</span><div className="mb-secret-field"><input type={showSecrets ? "text" : "password"} value={slackWebhookDraft} onChange={(event) => setSlackWebhookDraft(event.target.value)} placeholder="Cole o webhook nas configuracoes" onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()} /><button type="button" className={`mb-secret-toggle ${showSecrets ? "is-revealed" : ""}`} onClick={() => setShowSecrets((value) => !value)} /></div></label>
              <label className="mb-form-row"><span>Webhook de teste</span><div className="mb-secret-field"><input type={showSecrets ? "text" : "password"} value={slackTestWebhookDraft} onChange={(event) => setSlackTestWebhookDraft(event.target.value)} placeholder="Cole o webhook de teste nas configuracoes" onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()} /><button type="button" className={`mb-secret-toggle ${showSecrets ? "is-revealed" : ""}`} onClick={() => setShowSecrets((value) => !value)} /></div></label>
              <div className="mb-settings-webhook-grid">
                <label className="mb-form-row"><span>Resultado de testes</span><div className="mb-secret-field"><input type={showSecrets ? "text" : "password"} value={slackResultWebhookDraft} onChange={(event) => setSlackResultWebhookDraft(event.target.value)} placeholder="Webhook para resultados QA" onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()} /><button type="button" onClick={() => testSlackWebhook(slackResultWebhookDraft, "resultado de testes")}>Testar</button></div></label>
                <label className="mb-form-row"><span>Criação de Work Items</span><div className="mb-secret-field"><input type={showSecrets ? "text" : "password"} value={slackCreationWebhookDraft} onChange={(event) => setSlackCreationWebhookDraft(event.target.value)} placeholder="Webhook qa-demand-notification" onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()} /><button type="button" onClick={() => testSlackWebhook(slackCreationWebhookDraft, "criacao de Work Items")}>Testar</button></div></label>
                <label className="mb-form-row"><span>Custom</span><div className="mb-secret-field"><input type={showSecrets ? "text" : "password"} value={slackCustomWebhookDraft} onChange={(event) => setSlackCustomWebhookDraft(event.target.value)} placeholder="Webhook opcional" onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()} /><button type="button" onClick={() => testSlackWebhook(slackCustomWebhookDraft, "custom")}>Testar</button></div></label>
              </div>
              {!isGestao && <small className="mb-settings-note">Webhooks pessoais ficam somente no localStorage deste navegador.</small>}
              {(() => {
                const currentPurposeWebhooks = slackWebhooks || [];
                const dirty = slackTestModeDraft !== (isGestao ? slackTestMode : personalSlackTestMode)
                  || slackPrimaryNameDraft !== (isGestao ? slackPrimaryWebhookName : personalSlackPrimaryWebhookName)
                  || slackWebhookDraft !== (isGestao ? slackWebhookUrl : personalSlackWebhookUrl)
                  || slackTestWebhookDraft !== (isGestao ? slackTestWebhookUrl : personalSlackTestWebhookUrl)
                  || slackResultWebhookDraft !== (currentPurposeWebhooks.find((entry) => entry.purpose === "testResult")?.url || "")
                  || slackCreationWebhookDraft !== (currentPurposeWebhooks.find((entry) => entry.purpose === "workItemCreation")?.url || "")
                  || slackCustomWebhookDraft !== (currentPurposeWebhooks.find((entry) => entry.purpose === "custom")?.url || "");
                return dirty && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <Button tone="primary" onClick={applySlackSection}>Confirmar</Button>
                    <Button onClick={cancelSlackSection}>Cancelar</Button>
                  </div>
                );
              })()}
              {/* status shown as toast */}
            </div>
          </details>
        </SettingsSection>

        {isGestao && <SettingsSection title="Gestao" description="Meta padrao de horas usada quando um colaborador nao tem meta propria.">
          <div className="mb-governance-grid">
            <label className="mb-form-row"><span>Meta padrao de horas</span><input type="number" min="0" step="0.5" value={goalHoursDraft} onChange={(event) => setGoalHoursDraft(event.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()} /></label>
            {(() => {
              const dirty = String(goalHoursDraft) !== String(goalHours);
              return dirty && (
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <Button tone="primary" onClick={applyGovernanceSection}>Confirmar</Button>
                  <Button onClick={cancelGovernanceSection}>Cancelar</Button>
                </div>
              );
            })()}
            {/* status shown as toast */}
          </div>
          <small className="mb-settings-note">Periodo, limite de itens e sprint agora sao filtros dentro da propria tela de Gestao da equipe, nao configuracoes globais.</small>
        </SettingsSection>}

        <SettingsSection title="Notificacoes sonoras" description="Ative ou desative o som de cada notificacao. Preferencia individual, salva neste navegador.">
          <label className="mb-switch-row">
            <span><strong>Silenciar todas</strong><small>Desliga qualquer som de notificacao para este usuario</small></span>
            <span className="mb-switch"><input type="checkbox" checked={notificationSoundsMutedDraft} onChange={(event) => setNotificationSoundsMutedDraft(event.target.checked)} /><span className="mb-switch-slider" /></span>
          </label>
          <div className="mb-notification-sound-grid">
            {notificationTypes.map(({ key, label, description }) => (
              <div key={key} className="mb-notification-sound-row">
                <span><strong>{label}</strong><small>{description}</small></span>
                <span className="mb-switch"><input type="checkbox" checked={notificationSoundPrefsDraft[key]} disabled={notificationSoundsMutedDraft} onChange={(event) => setNotificationSoundPrefsDraft((current) => ({ ...current, [key]: event.target.checked }))} /><span className="mb-switch-slider" /></span>
                <Button onClick={() => playSoundFile(key)} disabled={notificationSoundsMutedDraft}>Testar</Button>
              </div>
            ))}
          </div>
          {(() => {
            const dirty = notificationSoundsMutedDraft !== notificationSoundsMuted || Object.entries(notificationSoundPrefsDraft).some(([k, v]) => notificationSoundPrefs[k] !== v);
            return dirty && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <Button tone="primary" onClick={applyNotificationsSection}>Confirmar</Button>
                <Button onClick={cancelNotificationsSection}>Cancelar</Button>
              </div>
            );
          })()}
          {/* status shown as toast */}
        </SettingsSection>

        <SettingsSection title="Notificacoes do navegador" description="Alerta do sistema operacional quando algo relevante para o seu papel mudar, mesmo com a aba em segundo plano.">
          {browserNotifPermission === "unsupported" && <small className="mb-settings-note">Este navegador nao suporta notificacoes.</small>}
          {browserNotifPermission !== "unsupported" && (
            <>
              <label className="mb-switch-row">
                <span>
                  <strong>Ativar notificacoes</strong>
                  <small>
                    {browserNotifPermission === "denied" && "Bloqueado pelo navegador — libere manualmente nas configuracoes do site para reativar."}
                    {browserNotifPermission === "granted" && "Permissao concedida."}
                    {browserNotifPermission === "default" && "Ainda nao solicitado."}
                  </small>
                </span>
                {browserNotifPermission === "granted"
                  ? <span className="mb-switch"><input type="checkbox" checked={browserNotifEnabled} onChange={(event) => toggleBrowserNotifEnabled(event.target.checked)} /><span className="mb-switch-slider" /></span>
                  : <Button tone="primary" onClick={requestBrowserNotifications} disabled={browserNotifPermission === "denied"}>Ativar</Button>}
              </label>
              <small className="mb-settings-note">Dev ve quando um QA pega um item seu para teste. QA ve itens que entram em In QA/In BETA/Ready Beta/HMG CNK. So funciona com o Stark Hub aberto em alguma aba do navegador.</small>
            </>
          )}
        </SettingsSection>
        {preview && <pre className="mb-settings-preview">{preview}</pre>}
      </div>
    </section>
  );
}

