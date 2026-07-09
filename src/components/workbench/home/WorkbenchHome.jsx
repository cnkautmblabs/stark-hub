import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { FiCheckCircle, FiClock, FiCopy, FiDownload, FiPlus, FiPrinter, FiShield, FiUser } from "react-icons/fi";
import { useAuth } from "../../../contexts/AuthContext.jsx";
import { useWorkItems } from "../../../hooks/useWorkItems.js";
import { useTestEvidence } from "../../../hooks/useTestEvidence.js";
import { useCollaborators } from "../../../hooks/useCollaborators.js";
import { useAppSettings } from "../../../hooks/useAppSettings.js";
import { accessLevelLabels, accessLevels, defaultGoalHours, hasManagementAccess } from "../../../utils/constants.js";
import { formatHours, normalize } from "../../../utils/workbench/formatters.js";
import { compactSprintLabel, findCurrentSprint } from "../../../utils/sprints.js";
import { dateStamp, downloadCsv } from "../../../utils/csvExport.js";
import {
  buildExecutiveReportText,
  buildPersonalSummaryText,
  buildQaTestEvidenceReportText,
  copyExecutiveReportText,
  copyPersonalSummaryText,
  copyQaTestEvidenceReportText,
  downloadExecutiveReportPdf,
  downloadPersonalSummaryPdf
} from "../../../utils/executiveReport.js";
import { buildGovernanceSlackText, buildPersonalSummarySlackText, sendSlackWebhook } from "../../../utils/slackReport.js";
import { Button, Kpi, KpiSkeleton, WorkbenchCardSkeleton, WorkbenchHeader } from "../ui/WorkbenchPrimitives.jsx";

const widgetIcons = { note: "bi-sticky", link: "bi-link-45deg", shortcut: "bi-rocket-takeoff" };
const widgetTitles = { note: "Nota", link: "Link", shortcut: "Atalho" };

function escapeHtml(text) {
  return String(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Markdown minimo (negrito/italico/quebra de linha) sem depender de lib externa —
// conteudo e sempre local (localStorage do proprio usuario), nunca compartilhado.
function renderMiniMarkdown(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\n/g, "<br/>");
}

function storageKey(prefix, userKey) {
  return `starkHub${prefix}:${userKey || "anonymous"}`;
}

function readLocal(key, fallback) {
  if (typeof window === "undefined") return fallback;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || "null");
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(key, value) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function useOutsideClick(open, onClose) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    function handleClick(event) {
      if (ref.current && !ref.current.contains(event.target)) onClose();
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open, onClose]);
  return ref;
}

function AddWidgetMenu({ onPick }) {
  const [open, setOpen] = useState(false);
  const rootRef = useOutsideClick(open, () => setOpen(false));
  return (
    <div ref={rootRef} className="mb-home-add-menu">
      <Button tone="primary" onClick={() => setOpen((value) => !value)}><FiPlus /> Adicionar</Button>
      {open && (
        <div className="mb-home-add-options">
          <button type="button" onClick={() => { onPick("note"); setOpen(false); }}><i className="bi bi-sticky" /> Nota</button>
          <button type="button" onClick={() => { onPick("link"); setOpen(false); }}><i className="bi bi-link-45deg" /> Link</button>
          <button type="button" onClick={() => { onPick("shortcut"); setOpen(false); }}><i className="bi bi-rocket-takeoff" /> Atalho</button>
        </div>
      )}
    </div>
  );
}

const notePresetColors = ["#fde68a", "#fdba74", "#fbcfe8", "#bbf7d0", "#bfdbfe", "#ddd6fe", "#e5e7eb"];

function WidgetModal({ type, initial, onClose, onSave }) {
  const isEdit = Boolean(initial);
  const [title, setTitle] = useState(initial?.title || "");
  const [url, setUrl] = useState(initial?.url || "");
  const [text, setText] = useState(initial?.text || "");
  const [imageUrl, setImageUrl] = useState(initial?.imageUrl || "");
  const [color, setColor] = useState(initial?.color || (type === "note" ? notePresetColors[0] : ""));
  const [notePreview, setNotePreview] = useState(false);
  const textareaRef = useRef(null);
  const isNote = type === "note";
  const isShortcut = type === "shortcut";

  function submit(event) {
    event.preventDefault();
    if (!title.trim()) return;
    if (!isNote && !url.trim()) return;
    onSave({
      id: initial?.id ?? Date.now(),
      type,
      title: title.trim(),
      url: url.trim(),
      text: text.trim(),
      imageUrl: imageUrl.trim(),
      color: isShortcut ? undefined : (color || undefined),
      createdAt: initial?.createdAt || new Date().toISOString()
    });
  }

  function wrapSelection(marker) {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const selected = text.slice(start, end) || "texto";
    const next = `${text.slice(0, start)}${marker}${selected}${marker}${text.slice(end)}`;
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + marker.length, start + marker.length + selected.length);
    });
  }

  return (
    <div className="mb-home-modal-overlay" onClick={onClose}>
      <form data-allow-submit="true"
        className={`mb-home-modal ${isNote ? "note" : ""}`}
        style={isNote ? { background: color || notePresetColors[0] } : undefined}
        onClick={(event) => event.stopPropagation()}
        onSubmit={submit}
      >
        <header>
          <strong>{isEdit ? `Editar ${widgetTitles[type].toLowerCase()}` : `Nova ${widgetTitles[type].toLowerCase()}`}</strong>
          <button type="button" onClick={onClose}><i className="bi bi-x-lg" /></button>
        </header>
        <div className="mb-home-modal-body">
          <label><span>Titulo *</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: Board do time" autoFocus /></label>
          {!isNote && <label><span>URL *</span><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://..." /></label>}
          {isNote && (
            <label>
              <span className="mb-home-modal-note-label">
                Nota
                <button type="button" className="mb-home-modal-note-toggle" onClick={() => setNotePreview((value) => !value)}>
                  {notePreview ? "Editar" : "Pre-visualizar"}
                </button>
              </span>
              {!notePreview && (
                <div className="mb-home-modal-note-toolbar">
                  <button type="button" onClick={() => wrapSelection("**")} title="Negrito"><i className="bi bi-type-bold" /></button>
                  <button type="button" onClick={() => wrapSelection("*")} title="Italico"><i className="bi bi-type-italic" /></button>
                </div>
              )}
              {notePreview
                ? <div className="mb-home-modal-note-preview" dangerouslySetInnerHTML={{ __html: renderMiniMarkdown(text) || "<em>Nada para mostrar</em>" }} />
                : <textarea ref={textareaRef} value={text} onChange={(event) => setText(event.target.value)} rows={6} placeholder="Escreva sua nota..." />}
            </label>
          )}
          {!isNote && <label><span>Imagem {isShortcut ? "(ocupa o card inteiro)" : "(opcional)"}</span><input value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="https://... (URL de uma imagem)" /></label>}
          {isNote && (
            <label>
              <span>Cor do post-it</span>
              <div className="mb-home-modal-note-colors">
                {notePresetColors.map((preset) => (
                  <button key={preset} type="button" className={`mb-home-modal-note-swatch ${color === preset ? "active" : ""}`} style={{ background: preset }} onClick={() => setColor(preset)} title={preset} />
                ))}
              </div>
            </label>
          )}
          {!isNote && !isShortcut && (
            <label className="mb-home-modal-color-row">
              <span>Cor do card</span>
              <input type="color" value={color || "#64748b"} onChange={(event) => setColor(event.target.value)} />
            </label>
          )}
        </div>
        <footer><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button type="submit" className="primary">Salvar</button></footer>
      </form>
    </div>
  );
}

function ImagePlaceholder() {
  return (
    <svg className="mb-home-widget-placeholder-svg" viewBox="0 0 64 64" role="img" aria-label="Sem imagem">
      <rect x="3" y="3" width="58" height="58" rx="10" fill="none" stroke="currentColor" strokeOpacity=".3" strokeWidth="2.5" />
      <circle cx="23" cy="23" r="6" fill="currentColor" fillOpacity=".28" />
      <path d="M8 46 24 30 36 42 46 28 58 44" fill="none" stroke="currentColor" strokeOpacity=".4" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function WidgetImage({ src, alt = "" }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return <div className="mb-home-widget-placeholder"><ImagePlaceholder /></div>;
  }
  return <img src={src} alt={alt} onError={() => setFailed(true)} />;
}

function WidgetToolbar({ onEdit, onRemove, widget }) {
  return (
    <div className="mb-home-widget-toolbar">
      <span className="mb-home-widget-drag" title="Arraste para reordenar"><i className="bi bi-grip-vertical" /></span>
      <button type="button" className="mb-home-widget-edit" onClick={() => onEdit(widget)} title="Editar"><i className="bi bi-pencil" /></button>
      <button type="button" className="mb-home-widget-remove" onClick={() => onRemove(widget.id)} title="Remover"><i className="bi bi-x" /></button>
    </div>
  );
}

function WidgetCard({ widget, onRemove, onEdit, onDragStart, onDragOver, onDrop, onDragEnd, dragging }) {
  const icon = widgetIcons[widget.type] || "bi-star";
  const dragProps = { draggable: true, onDragStart, onDragOver, onDrop, onDragEnd };

  if (widget.type === "shortcut") {
    return (
      <article className={`mb-home-widget shortcut ${dragging ? "dragging" : ""}`} {...dragProps}>
        <WidgetToolbar widget={widget} onEdit={onEdit} onRemove={onRemove} />
        <a href={widget.url} target="_blank" rel="noreferrer" className="mb-home-widget-shortcut-body">
          <WidgetImage src={widget.imageUrl} />
          <span className="mb-home-widget-shortcut-caption">{widget.title}</span>
        </a>
      </article>
    );
  }

  if (widget.type === "note") {
    return (
      <article className={`mb-home-widget note ${dragging ? "dragging" : ""}`} style={{ background: widget.color || "#fde68a" }} {...dragProps}>
        <WidgetToolbar widget={widget} onEdit={onEdit} onRemove={onRemove} />
        <button type="button" className="mb-home-widget-note-body" onClick={() => onEdit(widget)} title="Clique para ver/editar a nota inteira">
          <strong>{widget.title}</strong>
          {widget.text && <p dangerouslySetInnerHTML={{ __html: renderMiniMarkdown(widget.text) }} />}
        </button>
      </article>
    );
  }

  return (
    <article className={`mb-home-widget ${dragging ? "dragging" : ""}`} style={widget.color ? { borderLeft: `4px solid ${widget.color}` } : undefined} {...dragProps}>
      <WidgetToolbar widget={widget} onEdit={onEdit} onRemove={onRemove} />
      <a href={widget.url} target="_blank" rel="noreferrer" className="mb-home-widget-body">
        {widget.imageUrl ? <WidgetImage src={widget.imageUrl} /> : <span className="mb-home-widget-icon"><i className={`bi ${icon}`} /></span>}
        <span className="mb-home-widget-text"><strong>{widget.title}</strong></span>
      </a>
    </article>
  );
}

function WidgetsGrid({ widgets, onRemove, onReorder, onEdit }) {
  const [dragId, setDragId] = useState(null);

  function handleDrop(targetId) {
    if (dragId === null || dragId === targetId) return;
    const fromIndex = widgets.findIndex((widget) => widget.id === dragId);
    const toIndex = widgets.findIndex((widget) => widget.id === targetId);
    if (fromIndex === -1 || toIndex === -1) return;
    const next = widgets.slice();
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    onReorder(next);
    setDragId(null);
  }

  return (
    <div className="mb-home-widgets">
      {widgets.map((widget) => (
        <WidgetCard
          key={widget.id}
          widget={widget}
          onRemove={onRemove}
          onEdit={onEdit}
          dragging={dragId === widget.id}
          onDragStart={() => setDragId(widget.id)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => { event.preventDefault(); handleDrop(widget.id); }}
          onDragEnd={() => setDragId(null)}
        />
      ))}
      {!widgets.length && <span className="mb-home-empty">Nada fixado ainda. Use "Adicionar" para criar uma nota, link ou atalho.</span>}
    </div>
  );
}

function DevPanel({ loading, myItems, completedHours, goalHours, hoursPercent }) {
  const tasks = myItems.filter((item) => item.type === "Task").length;
  const bugs = myItems.filter((item) => item.type === "Bug").length;
  return (
    <section className="mb-home-panel">
      <header><div><strong>Painel Dev</strong><small>Cards atribuidos e horas do periodo.</small></div></header>
      <div className="mb-home-kpis">
        {loading ? <KpiSkeleton count={4} /> : (
          <>
            <Kpi icon="bi-kanban" label="Cards atribuidos" value={myItems.length} />
            <Kpi icon="bi-hammer" label="Tasks" value={tasks} tone="gold" />
            <Kpi icon="bi-bug-fill" label="Bugs" value={bugs} tone="red" />
            <Kpi icon="bi-clock" label="Horas" value={`${formatHours(completedHours)} / ${formatHours(goalHours)}`} color="#2563eb" />
          </>
        )}
      </div>
      {loading ? <span className="mbw-skeleton-block" style={{ height: 10, borderRadius: 999 }} /> : <div className="mb-home-hours-bar"><b style={{ width: `${hoursPercent}%` }} /></div>}
    </section>
  );
}

function QaPanel({ loading, availableForTesting, evidenceToday, currentSprintLabel }) {
  return (
    <section className="mb-home-panel">
      <header><div><strong>Painel QA</strong><small>Dados da sprint atual{currentSprintLabel ? ` (${currentSprintLabel})` : ""} e resultados de hoje.</small></div></header>
      <div className="mb-home-kpis">
        {loading ? <KpiSkeleton count={3} /> : (
          <>
            <Kpi icon="bi-check2-circle" label="Para testar na sprint" value={availableForTesting} color="#7c3aed" />
            <Kpi icon="bi-calendar-check" label="Testados hoje" value={evidenceToday} color="#2563eb" />
            <Kpi icon="bi-clipboard2-pulse" label="Foco do dia" value={availableForTesting ? "QA" : "Livre"} color="#16a34a" />
          </>
        )}
      </div>
    </section>
  );
}

const reportTypeLabels = { dev: "Dev (PRs)", qa: "QA (testes)", gestao: "Gestao (Gestao)" };

function ExecutiveSummary({ entries, name, role, autoEntries, autoLabel, reportType, previewText, canOverrideReportType, onReportTypeChange, onAdd, onRemove, onCopy, onPdf, onPrint, onSlack }) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState("temporaria");
  const [showPreview, setShowPreview] = useState(true);

  function submit(event) {
    event.preventDefault();
    if (!title.trim()) return;
    onAdd({ id: Date.now(), title: title.trim(), type, createdAt: new Date().toISOString() });
    setTitle("");
  }

  return (
    <section className="mb-home-panel">
      <header>
        <div><strong>Resumo executivo</strong><small>Itens recorrentes, do dia e atualizacoes automaticas, prontos para copiar, imprimir ou exportar.</small></div>
        <div className="mb-home-summary-actions">
          {canOverrideReportType && (
            <div className="mb-home-summary-type admin">
              {Object.entries(reportTypeLabels).map(([key, label]) => (
                <button key={key} type="button" className={reportType === key ? "active" : ""} onClick={() => onReportTypeChange(key)}>{label}</button>
              ))}
            </div>
          )}
          <Button onClick={onCopy}><FiCopy /> Copiar</Button>
          <Button onClick={onSlack}><i className="bi bi-slack" /> Slack</Button>
          <Button onClick={onPrint}><FiPrinter /> Imprimir</Button>
          <Button onClick={onPdf}><FiDownload /> PDF</Button>
        </div>
      </header>
      <form data-allow-submit="true" className="mb-home-summary-form" onSubmit={submit}>
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: 1:1 com Nat" />
        <div className="mb-home-summary-type">
          <button type="button" className={type === "temporaria" ? "active" : ""} onClick={() => setType("temporaria")}>Hoje</button>
          <button type="button" className={type === "recorrente" ? "active" : ""} onClick={() => setType("recorrente")}>Recorrente</button>
        </div>
        <button type="submit" className="mb-home-summary-submit"><FiPlus /> Adicionar</button>
      </form>
      <div className="mb-home-summary-list">
        {entries.map((entry) => (
          <div key={entry.id} className={`mb-home-summary-item ${entry.type}`}>
            <span className="mb-home-summary-tag">{entry.type === "recorrente" ? "Recorrente" : "Hoje"}</span>
            <span className="mb-home-summary-title">{entry.title}</span>
            <button type="button" onClick={() => onRemove(entry.id)} title="Remover"><i className="bi bi-x" /></button>
          </div>
        ))}
        {autoEntries.map((entry, index) => (
          <div key={`auto-${index}`} className="mb-home-summary-item auto">
            <span className="mb-home-summary-tag">{autoLabel}</span>
            <span className="mb-home-summary-title">{entry.title}</span>
          </div>
        ))}
        {!entries.length && !autoEntries.length && <span className="mb-home-empty">Nenhum item no resumo. Adicione acima.</span>}
      </div>
      <div className="mb-home-summary-preview">
        <button type="button" className="mb-home-summary-preview-toggle" onClick={() => setShowPreview((value) => !value)}>
          <span>Previa do resumo</span><i className={`bi ${showPreview ? "bi-chevron-up" : "bi-chevron-down"}`} />
        </button>
        {showPreview && <pre>{previewText}</pre>}
      </div>
    </section>
  );
}

export function WorkbenchHome() {
  const { profile, user, demoMode } = useAuth();
  const { items, loading } = useWorkItems();
  const { evidence } = useTestEvidence();
  const { collaborators } = useCollaborators();
  const { getSetting } = useAppSettings();
  const [now] = useState(() => new Date());
  const [widgetModalType, setWidgetModalType] = useState(null);
  const [editingWidget, setEditingWidget] = useState(null);

  const displayName = profile?.displayName || profile?.fullName || user?.email || "Stark Hub";
  const access = profile?.accessLevel;
  const isDev = access === accessLevels.dev;
  const isQa = access === accessLevels.qa;
  const isAdmin = Boolean(profile?.isAdmin || access === accessLevels.admin);
  const isGestao = hasManagementAccess(access, isAdmin);
  const isGerente = access === accessLevels.gerente;
  const accessLabel = isAdmin && isQa ? `${accessLevelLabels[access]} (Admin)` : accessLevelLabels[access] || "Acesso";
  const userKey = profile?.id || user?.email || "anonymous";
  const goalDefault = getSetting("defaultGoalHours", defaultGoalHours);
  const adminEmail = import.meta.env.VITE_ADMIN_EMAIL || "";
  const canOverrideReportType = isAdmin || (Boolean(adminEmail) && (profile?.email === adminEmail || user?.email === adminEmail));
  const defaultReportType = isDev ? "dev" : isQa ? "qa" : isGestao ? "gestao" : "dev";
  const [reportTypeOverride, setReportTypeOverride] = useState(() => readLocal(storageKey("HomeReportTypeOverride", userKey), null));
  const reportType = (canOverrideReportType && reportTypeOverride) || defaultReportType;
  const today = now.toISOString().slice(0, 10);

  const [widgets, setWidgets] = useState(() => readLocal(storageKey("HomeWidgets", userKey), []));
  const [summaryEntries, setSummaryEntries] = useState(() => readLocal(storageKey("HomeSummary", userKey), []));

  useEffect(() => { writeLocal(storageKey("HomeWidgets", userKey), widgets); }, [widgets, userKey]);
  useEffect(() => { writeLocal(storageKey("HomeSummary", userKey), summaryEntries); }, [summaryEntries, userKey]);
  useEffect(() => {
    if (canOverrideReportType) {
      writeLocal(storageKey("HomeReportTypeOverride", userKey), reportTypeOverride);
    }
  }, [canOverrideReportType, reportTypeOverride, userKey]);

  const quickLinks = [
    { to: "/dev", label: "Meus itens", icon: FiUser, show: [accessLevels.dev, accessLevels.qa, accessLevels.gestao, accessLevels.gerente].includes(access) },
    { to: "/qa", label: "Quality Board", icon: FiCheckCircle, show: [accessLevels.qa, accessLevels.gestao, accessLevels.gerente].includes(access) },
    { to: "/management", label: "Gestao da equipe", icon: FiShield, show: isGestao },
    { to: "/management/dashboard", label: "Gerenciamento", icon: FiShield, show: isGerente },
    { to: "/settings", label: "Conexoes", icon: FiPlus, show: true }
  ].filter((item) => item.show);

  const myItems = useMemo(
    () => items.filter((item) => item.assigneeName === displayName || item.assignedTo === displayName || item.assigneeEmail === user?.email),
    [items, displayName, user?.email]
  );
  const myItemIds = useMemo(() => new Set(myItems.map((item) => Number(item.id))), [myItems]);
  const myRecentEvidence = useMemo(
    () => evidence.filter((entry) => myItemIds.has(Number(entry.workItemId))).slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))),
    [evidence, myItemIds]
  );
  const availableForTesting = useMemo(
    () => items.filter((item) => /in qa|in beta/i.test(String(item.state || ""))).slice().sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))),
    [items]
  );

  const activityFeed = useMemo(() => {
    const entries = [];
    const source = isQa ? availableForTesting : myItems.slice().sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    source.slice(0, 6).forEach((item) => entries.push({
      id: `item-${item.id}`,
      icon: isQa ? "bi-check2-circle" : "bi-kanban",
      text: `#${item.id} ${item.title}`,
      meta: isQa ? `${item.state || "Sem status"} · disponivel para teste` : `${item.state || "Sem status"} · ${item.sprint || "Sem sprint"}`,
      date: item.updatedAt
    }));
    myRecentEvidence.slice(0, 4).forEach((entry) => entries.push({
      id: `evidence-${entry.id}`,
      icon: "bi-clipboard2-check",
      text: `Novo resultado no #${entry.workItemId}`,
      meta: `${entry.result || "resultado"} · ${entry.authorName || "QA"}`,
      date: entry.createdAt
    }));
    return entries.sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))).slice(0, 8);
  }, [availableForTesting, isQa, myItems, myRecentEvidence]);

  const myCollaborator = collaborators.find((person) => person.id === profile?.id)
    || collaborators.find((person) => normalize(person.azureName) === normalize(displayName));
  const goalHours = Number(myCollaborator?.goalHours || goalDefault);
  const completedHours = myItems.reduce((sum, item) => sum + Number(item.completedHours || 0), 0);
  const hoursPercent = goalHours ? Math.min(100, Math.round((completedHours / goalHours) * 100)) : 0;
  const evidenceToday = evidence.filter((entry) => String(entry.createdAt || "").slice(0, 10) === today).length;
  const sprintOptions = Array.from(new Set(items.map((item) => item.sprint || item.iteration).filter(Boolean)));
  const currentSprintLabel = compactSprintLabel(findCurrentSprint(sprintOptions));

  const developerRows = useMemo(() => {
    if (!isGestao && !(canOverrideReportType && reportType === "gestao")) return [];
    const map = new Map();
    collaborators.filter((person) => person.isDev || person.isQa || person.isManagement).forEach((person) => {
      map.set(person.id, { name: person.azureName, hours: 0, goal: Number(person.goalHours || goalDefault) });
    });
    items.forEach((item) => {
      const person = collaborators.find((entry) => entry.id === item.assigneeId) || collaborators.find((entry) => normalize(entry.azureName) === normalize(item.assigneeName));
      const key = person?.id || item.assigneeName || "unassigned";
      if (!map.has(key)) map.set(key, { name: item.assigneeName || "Nao atribuido", hours: 0, goal: goalDefault });
      map.get(key).hours += Number(item.completedHours || 0);
    });
    return Array.from(map.values()).map((row) => ({
      ...row,
      label: row.hours < row.goal ? "Abaixo" : row.hours > row.goal ? "Acima" : "Cumprida",
      tone: row.hours < row.goal ? "danger" : row.hours > row.goal ? "warning" : "primary"
    }));
  }, [collaborators, goalDefault, isGestao, items]);

  const governanceTotals = useMemo(() => ({
    developers: developerRows.length,
    cards: items.length,
    hours: developerRows.reduce((sum, row) => sum + row.hours, 0),
    goal: developerRows.reduce((sum, row) => sum + row.goal, 0),
    missing: developerRows.reduce((sum, row) => sum + Math.max(row.goal - row.hours, 0), 0),
    extra: developerRows.reduce((sum, row) => sum + Math.max(row.hours - row.goal, 0), 0)
  }), [developerRows, items]);

  const autoLabel = { dev: "PRs de hoje", qa: "Testes de hoje", gestao: "Gestao (snapshot)" }[reportType];
  const autoEntries = useMemo(() => {
    if (reportType === "qa") {
      return evidence
        .filter((entry) => String(entry.createdAt || "").slice(0, 10) === today)
        .map((entry) => ({ title: `#${entry.workItemId} — ${entry.result || "resultado"} (${entry.authorName || "QA"})` }));
    }
    if (reportType === "gestao") {
      if (!governanceTotals.developers) return [];
      return [{ title: `${governanceTotals.developers} colaborador(es), ${governanceTotals.cards} card(s), ${formatHours(governanceTotals.hours)} registradas, ${formatHours(governanceTotals.missing)} pendentes` }];
    }
    return myItems
      .filter((item) => String(item.updatedAt || "").slice(0, 10) === today)
      .map((item) => ({ title: `#${item.id} ${item.title} — ${item.state || "sem status"}` }));
  }, [evidence, governanceTotals, myItems, reportType, today]);

  function saveWidget(widget) {
    setWidgets((current) => (
      current.some((entry) => entry.id === widget.id)
        ? current.map((entry) => (entry.id === widget.id ? widget : entry))
        : [widget, ...current]
    ));
    setWidgetModalType(null);
    setEditingWidget(null);
  }
  function removeWidget(id) {
    setWidgets((current) => current.filter((widget) => widget.id !== id));
  }
  function reorderWidgets(next) {
    setWidgets(next);
  }
  function addSummaryEntry(entry) {
    setSummaryEntries((current) => [entry, ...current]);
  }
  function removeSummaryEntry(id) {
    setSummaryEntries((current) => current.filter((entry) => entry.id !== id));
  }
  function copySummary() {
    if (reportType === 'qa') {
      return copyQaTestEvidenceReportText({ generatedAt: now, scope: 'Filtered records', records: evidence, workItems: items, collaborators });
    }
    if (reportType === 'gestao') {
      return copyExecutiveReportText({
        title: 'Gestao da equipe — Resumo rapido',
        period: 'Atual',
        totals: governanceTotals,
        rows: developerRows
      });
    }
    return copyPersonalSummaryText({ name: displayName, role: accessLabel, entries: summaryEntries, autoEntries, autoLabel });
  }
  function pdfSummary() {
    if (reportType === 'gestao') {
      return downloadExecutiveReportPdf({
        title: 'Gestao da equipe — Resumo rapido',
        period: 'Atual',
        totals: governanceTotals,
        rows: developerRows,
        filename: `stark-hub-Gestao-resumo-${new Date().toISOString().slice(0, 10)}.pdf`
      });
    }
    return downloadPersonalSummaryPdf({ name: displayName, role: accessLabel, entries: summaryEntries, autoEntries, autoLabel, filename: `stark-hub-resumo-${displayName.split(" ")[0].toLowerCase()}-${new Date().toISOString().slice(0, 10)}.pdf` });
  }
  function printSummary() {
    let text;
    if (reportType === 'qa') {
      text = buildQaTestEvidenceReportText({ generatedAt: now, scope: 'Filtered records', records: evidence, workItems: items, collaborators });
    } else if (reportType === 'gestao') {
      text = buildExecutiveReportText({
        title: 'Gestao da equipe — Resumo rapido',
        period: 'Atual',
        totals: governanceTotals,
        rows: developerRows
      });
    } else {
      text = buildPersonalSummaryText({ name: displayName, role: accessLabel, entries: summaryEntries, autoEntries, autoLabel });
    }
    const printWindow = window.open("", "_blank", "width=640,height=800");
    if (!printWindow) return;
    const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    printWindow.document.write(`<!doctype html><html><head><title>Resumo executivo - ${displayName}</title><style>body{font-family:Arial,Helvetica,sans-serif;padding:28px;white-space:pre-wrap;font-size:13px;line-height:1.7;color:#111;}</style></head><body>${escaped}</body></html>`);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }
  function copyGovernance() {
    copyExecutiveReportText({ title: "Gestao da equipe - Resumo rapido", period: "Atual", totals: governanceTotals, rows: developerRows });
  }
  function pdfGovernance() {
    downloadExecutiveReportPdf({ title: "Stark Hub - Gestao da equipe (resumo rapido)", period: "Atual", totals: governanceTotals, rows: developerRows, filename: `stark-hub-Gestao-resumo-${new Date().toISOString().slice(0, 10)}.pdf` });
  }
  async function sendSlack(text) {
    const webhookUrl = getSetting("slackWebhookUrl", "");
    const { error } = await sendSlackWebhook(webhookUrl, text);
    if (error) alert(`Nao foi possivel enviar ao Slack: ${error.message}`);
  }
  function slackSummary() {
    if (reportType === 'qa') {
      const text = buildQaTestEvidenceReportText({ generatedAt: now, scope: 'Filtered records', records: evidence, workItems: items, collaborators });
      sendSlack(text);
      return;
    }
    if (reportType === 'gestao') {
      const text = buildGovernanceSlackText({ totals: governanceTotals, rows: developerRows });
      sendSlack(text);
      return;
    }
    sendSlack(buildPersonalSummarySlackText({ name: displayName, role: accessLabel, entries: summaryEntries, autoEntries, autoLabel }));
  }
  function slackGovernance() {
    sendSlack(buildGovernanceSlackText({ totals: governanceTotals, rows: developerRows }));
  }

  const summaryPreviewText = reportType === 'qa'
    ? buildQaTestEvidenceReportText({ generatedAt: now, scope: 'Filtered records', records: evidence, workItems: items, collaborators })
    : reportType === 'gestao'
      ? buildExecutiveReportText({ title: 'Gestao da equipe — Resumo rapido', period: 'Atual', totals: governanceTotals, rows: developerRows })
      : buildPersonalSummaryText({ name: displayName, role: accessLabel, entries: summaryEntries, autoEntries, autoLabel });

  function exportHomeCsv() {
    downloadCsv(`home-${dateStamp()}.csv`, ["Secao", "Tipo", "Titulo", "Detalhe"], [
      ...widgets.map((widget) => ["Painel", widget.type, widget.title, widget.url || widget.text || ""]),
      ...activityFeed.map((entry) => ["Atualizacoes recentes", "atividade", entry.text, entry.meta]),
      ...autoEntries.map((entry) => ["Relatorio executivo", autoLabel, entry.title, "automatico"]),
      ...summaryEntries.map((entry) => ["Relatorio executivo", entry.type || "manual", entry.title, entry.text || ""])
    ]);
  }

  return (
    <section className="mbw-page mb-home-page">
      <WorkbenchHeader
        kicker="Stark Hub"
        title={`Ola, ${displayName.split(" ")[0] || "time"}`}
        subtitle={`${accessLabel} · ${now.toLocaleDateString("pt-BR")} · ${now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`}
        demoMode={demoMode}
        actions={<Button onClick={exportHomeCsv}><FiDownload /> CSV</Button>}
      />
      <section className="mb-home-quick">
        {quickLinks.map(({ to, label, icon: Icon }) => <Link key={to} to={to}><Icon /> {label}</Link>)}
      </section>
      <section className="mb-home-panel">
        <header>
          <div><strong>Painel</strong><small>Notas, links e atalhos que voce fixar aqui ficam salvos neste navegador.</small></div>
          <AddWidgetMenu onPick={setWidgetModalType} />
        </header>
        <WidgetsGrid widgets={widgets} onRemove={removeWidget} onReorder={reorderWidgets} onEdit={setEditingWidget} />
      </section>

      {/* Painel Dev so pra Dev, Painel QA so pra QA — pedido explicito do
          usuario pra nao misturar os dois pra Gestao/Gerente/Admin, que ja
          tem o proprio dashboard dedicado (Gestao da equipe). */}
      {isDev && (
        <DevPanel loading={loading} myItems={myItems} completedHours={completedHours} goalHours={goalHours} hoursPercent={hoursPercent} />
      )}
      {isQa && (
        <QaPanel loading={loading} availableForTesting={availableForTesting.length} evidenceToday={evidenceToday} currentSprintLabel={currentSprintLabel} />
      )}

      <section className="mb-home-panel">
        <header><div><strong>Atualizacoes recentes</strong><small>{isQa ? "Cards novos disponiveis para teste e seus resultados recentes." : "Resumo objetivo do que mudou por ultimo nos seus itens."}</small></div></header>
        {loading ? <WorkbenchCardSkeleton rows={4} mode="compact" /> : (
          <div className="mb-home-activity">
            {activityFeed.map((entry) => (
              <Link key={entry.id} to="/dev">
                <i className={`bi ${entry.icon}`} />
                <span><strong>{entry.text}</strong><small>{entry.meta}</small></span>
              </Link>
            ))}
            {!activityFeed.length && <span className="mb-home-empty">Nenhuma atualizacao recente.</span>}
          </div>
        )}
      </section>

      {isGestao && (
        <section className="mb-home-panel">
          <header>
            <div><strong>Gestao da equipe</strong><small>Resumo rapido da sprint atual. Use Ver mais para abrir todos os dados.</small></div>
            <div className="mb-home-summary-actions">
              <Button onClick={copyGovernance}><FiCopy /> Copiar</Button>
              <Button onClick={slackGovernance}><i className="bi bi-slack" /> Slack</Button>
              <Button onClick={pdfGovernance}><FiDownload /> PDF</Button>
              <Link to="/management" className="mbw-btn default"><FiShield /> Ver mais</Link>
            </div>
          </header>
          <div className="mb-home-kpis">
            {loading ? <KpiSkeleton count={4} /> : (
              <>
                <Kpi icon="bi-people" label="Colaboradores" value={governanceTotals.developers} />
                <Kpi icon="bi-kanban" label="Cards" value={governanceTotals.cards} />
                <Kpi icon="bi-clock" label="Horas registradas" value={formatHours(governanceTotals.hours)} color="#2563eb" />
                <Kpi icon="bi-dash-lg" label="Horas pendentes" value={formatHours(governanceTotals.missing)} color="#dc2626" />
              </>
            )}
          </div>
          {!loading && (
            <div className="mb-home-governance-mini">
              <div>
                <span>Horas</span>
                <div className="mb-home-mini-track"><b style={{ width: `${governanceTotals.goal ? Math.min(100, (governanceTotals.hours / governanceTotals.goal) * 100) : 0}%` }} /></div>
                <small>{formatHours(governanceTotals.hours)} de {formatHours(governanceTotals.goal)}</small>
              </div>
              <div>
                <span>Saude da meta</span>
                <div className="mb-home-mini-bars">
                  <b className="ok" style={{ width: `${governanceTotals.developers ? (governanceTotals.goalMet / governanceTotals.developers) * 100 : 0}%` }} />
                  <b className="warn" style={{ width: `${governanceTotals.developers ? (governanceTotals.goalAbove / governanceTotals.developers) * 100 : 0}%` }} />
                  <b className="danger" style={{ width: `${governanceTotals.developers ? (governanceTotals.goalBelow / governanceTotals.developers) * 100 : 0}%` }} />
                </div>
                <small>{governanceTotals.goalBelow} abaixo, {governanceTotals.goalMet} na meta, {governanceTotals.goalAbove} acima</small>
              </div>
            </div>
          )}
        </section>
      )}

      <ExecutiveSummary
        entries={summaryEntries}
        name={displayName}
        role={accessLabel}
        autoEntries={autoEntries}
        autoLabel={autoLabel}
        reportType={reportType}
        previewText={summaryPreviewText}
        canOverrideReportType={canOverrideReportType}
        onReportTypeChange={setReportTypeOverride}
        onAdd={addSummaryEntry}
        onRemove={removeSummaryEntry}
        onCopy={copySummary}
        onPdf={pdfSummary}
        onPrint={printSummary}
        onSlack={slackSummary}
      />

      {(widgetModalType || editingWidget) && (
        <WidgetModal
          type={editingWidget?.type || widgetModalType}
          initial={editingWidget}
          onClose={() => { setWidgetModalType(null); setEditingWidget(null); }}
          onSave={saveWidget}
        />
      )}
    </section>
  );
}


