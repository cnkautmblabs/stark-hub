import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FiCheckCircle, FiClock, FiCopy, FiDownload, FiPlus, FiPrinter, FiShield, FiUser } from "react-icons/fi";
import { supabase } from "../../../lib/supabaseClient.js";
import { useAuth } from "../../../contexts/AuthContext.jsx";
import { useWorkItems } from "../../../hooks/useWorkItems.js";
import { useTestEvidence } from "../../../hooks/useTestEvidence.js";
import { useCollaborators } from "../../../hooks/useCollaborators.js";
import { useAppSettings } from "../../../hooks/useAppSettings.js";
import { accessLevelLabels, accessLevels, defaultGoalHours, hasManagementAccess } from "../../../utils/constants.js";
import { buildCollaboratorNameIndex, findCollaboratorByName, formatHours, qaStatusInfo } from "../../../utils/workbench/formatters.js";
import { compactSprintLabel, findCurrentSprint } from "../../../utils/sprints.js";
import { savePendingWorkItemHighlight } from "../../../utils/workbench/highlight.js";
import { dateStamp, downloadCsv } from "../../../utils/csvExport.js";
import {
  buildPersonalSummaryText,
  copyExecutiveReportText,
  copyPersonalSummaryText,
  downloadExecutiveReportPdf,
  downloadPersonalSummaryPdf
} from "../../../utils/executiveReport.js";
import { buildGovernanceSlackText, buildPersonalSummarySlackText } from "../../../utils/slackReport.js";
import { resolveSlackWebhooks } from "../../../utils/slack.js";
import { useToast } from "../../../contexts/ToastContext.jsx";
import { Button, Kpi, KpiSkeleton, WorkbenchCardSkeleton, WorkbenchHeader } from "../ui/WorkbenchPrimitives.jsx";

const SHORTCUT_TITLE_MAX = 10;

const HOME_SECTION_DEFAULT_ORDER = ["widgets", "devPanel", "qaPanel", "activity", "governance", "summary"];

function escapeHtml(text) {
  return String(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Markdown minimo (negrito/italico/quebra de linha), mantido so pra notas
// antigas ja salvas no formato anterior (texto puro com ** e *) — o editor
// novo grava HTML de verdade e nunca produz esse formato.
function renderMiniMarkdown(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\n/g, "<br/>");
}

function looksLikeHtml(value) {
  return /<[a-z][\s\S]*>/i.test(String(value || ""));
}

// Post-it grava HTML puro (contentEditable) agora; notas antigas salvas como
// texto simples com marcadores ** / * ainda renderizam via renderMiniMarkdown.
function renderNoteHtml(text) {
  return looksLikeHtml(text) ? text : renderMiniMarkdown(text);
}

// Favicon publico do Google — nao precisa de backend nem CORS pra um <img>,
// e cobre "link"/"atalho" sem exigir que o usuario cole uma URL de imagem.
function faviconUrl(url) {
  try {
    const host = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(host)}`;
  } catch {
    return "";
  }
}

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
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
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useOutsideClick(open, () => setOpen(false));
  return (
    <div ref={rootRef} className="mb-home-add-menu">
      <Button tone="primary" onClick={() => setOpen((value) => !value)}><FiPlus /> {t("home.addButton")}</Button>
      {open && (
        <div className="mb-home-add-options">
          <button type="button" onClick={() => { onPick("note"); setOpen(false); }}><i className="bi bi-sticky" /> {t("home.addNote")}</button>
          <button type="button" onClick={() => { onPick("link"); setOpen(false); }}><i className="bi bi-link-45deg" /> {t("home.addLink")}</button>
          <button type="button" onClick={() => { onPick("shortcut"); setOpen(false); }}><i className="bi bi-rocket-takeoff" /> {t("home.addShortcut")}</button>
        </div>
      )}
    </div>
  );
}

// Um atalho importado invalido nao pode virar um card quebrado (sem link,
// sem titulo, titulo estourando o layout do botao) — valida campo a campo
// antes de aceitar, e reporta exatamente quais entradas foram rejeitadas.
function validateShortcutEntry(entry, t) {
  if (!entry || typeof entry !== "object") return t("home.shortcutInvalidEntry");
  if (!entry.title || !String(entry.title).trim()) return t("home.shortcutMissingTitle");
  if (String(entry.title).trim().length > SHORTCUT_TITLE_MAX) return t("home.shortcutTitleTooLong", { max: SHORTCUT_TITLE_MAX });
  if (!entry.url || !isValidHttpUrl(entry.url)) return t("home.shortcutInvalidUrl");
  return null;
}

function exportShortcutsTemplate(widgets) {
  const shortcuts = widgets.filter((widget) => widget.type === "shortcut").map((widget) => ({ title: widget.title, url: widget.url, imageUrl: widget.imageUrl || "" }));
  const blob = new Blob([JSON.stringify(shortcuts, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `stark-hub-atalhos-${dateStamp()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function ShortcutTemplateActions({ widgets, onImport }) {
  const { t } = useTranslation();
  const fileRef = useRef(null);

  async function handleFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      onImport({ accepted: [], rejected: [{ title: file.name, reason: t("home.invalidJson") }] });
      return;
    }
    const list = Array.isArray(parsed) ? parsed : [parsed];
    const accepted = [];
    const rejected = [];
    list.forEach((entry, index) => {
      const reason = validateShortcutEntry(entry, t);
      if (reason) rejected.push({ title: entry?.title || `item ${index + 1}`, reason });
      else accepted.push({ id: Date.now() + index, type: "shortcut", title: String(entry.title).trim(), url: entry.url.trim(), text: "", imageUrl: entry.imageUrl || "", createdAt: new Date().toISOString() });
    });
    onImport({ accepted, rejected });
  }

  return (
    <div className="mb-home-template-actions">
      <input ref={fileRef} type="file" accept="application/json" hidden onChange={handleFile} />
      <Button onClick={() => fileRef.current?.click()}><i className="bi bi-upload" /> {t("home.importShortcuts")}</Button>
      <Button onClick={() => exportShortcutsTemplate(widgets)}><i className="bi bi-download" /> {t("home.exportShortcuts")}</Button>
    </div>
  );
}

const notePresetColors = ["#fde68a", "#fdba74", "#fbcfe8", "#bbf7d0", "#bfdbfe", "#ddd6fe", "#e5e7eb"];

// Editor WYSIWYG minimo pro post-it: sem preview separada, sem markdown
// visivel — o que o usuario ve digitando e exatamente o HTML salvo. Usa
// document.execCommand (suportado em todos os navegadores evergreen pra
// esse tipo de edicao simples) em vez de trazer uma lib de editor inteira.
function RichNoteEditor({ initialValue, onChange, highlightColor = "#fff59d" }) {
  const { t } = useTranslation();
  const contentRef = useRef(null);
  const [textColor, setTextColor] = useState("#111111");

  useEffect(() => {
    if (contentRef.current) contentRef.current.innerHTML = initialValue || "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function exec(command, value) {
    contentRef.current?.focus();
    document.execCommand(command, false, value);
    onChange(contentRef.current?.innerHTML || "");
  }

  return (
    <div className="mb-home-note-editor">
      <div className="mb-home-note-toolbar">
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => exec("bold")} title={t("home.boldTitle")}><i className="bi bi-type-bold" /></button>
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => exec("italic")} title={t("home.italicTitle")}><i className="bi bi-type-italic" /></button>
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => exec("underline")} title={t("home.underlineTitle")}><i className="bi bi-type-underline" /></button>
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => exec("hiliteColor", highlightColor)} title={t("home.highlightTitle")}><i className="bi bi-vector-pen" /></button>
        <label className="mb-home-note-color" title={t("home.textColorTitle")} onMouseDown={(event) => event.preventDefault()}>
          <i className="bi bi-palette-fill" />
          <input type="color" value={textColor} onChange={(event) => { setTextColor(event.target.value); exec("foreColor", event.target.value); }} />
        </label>
      </div>
      <div
        ref={contentRef}
        className="mb-home-note-content"
        contentEditable
        suppressContentEditableWarning
        onInput={() => onChange(contentRef.current?.innerHTML || "")}
        data-placeholder={t("home.notePlaceholder")}
      />
    </div>
  );
}

function WidgetModal({ type, initial, onClose, onSave, onDelete }) {
  const { t } = useTranslation();
  const widgetTypeLabels = { note: t("home.widgetTypeNote"), link: t("home.widgetTypeLink"), shortcut: t("home.widgetTypeShortcut") };
  const isEdit = Boolean(initial);
  const [title, setTitle] = useState(initial?.title || "");
  const [url, setUrl] = useState(initial?.url || "");
  const [text, setText] = useState(initial?.text || "");
  const [imageUrl, setImageUrl] = useState(initial?.imageUrl || "");
  const [color, setColor] = useState(initial?.color || (type === "note" ? notePresetColors[0] : ""));
  const [error, setError] = useState("");
  const isNote = type === "note";
  const isShortcut = type === "shortcut";
  const titleMax = isShortcut ? SHORTCUT_TITLE_MAX : undefined;

  function submit(event) {
    event.preventDefault();
    if (!title.trim()) { setError(t("home.titleRequired")); return; }
    if (isShortcut && title.trim().length > SHORTCUT_TITLE_MAX) { setError(t("home.shortcutTitleTooLongError", { max: SHORTCUT_TITLE_MAX })); return; }
    if (!isNote && !isValidHttpUrl(url.trim())) { setError(t("home.invalidUrlError")); return; }
    onSave({
      id: initial?.id ?? Date.now(),
      type,
      title: title.trim(),
      url: url.trim(),
      text,
      imageUrl: imageUrl.trim(),
      color: isShortcut ? undefined : (color || undefined),
      createdAt: initial?.createdAt || new Date().toISOString()
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
        {isNote && <span className="mb-home-modal-note-fold" aria-hidden="true" />}
        <header>
          <strong>{isEdit ? t("home.editWidgetTitle", { type: widgetTypeLabels[type].toLowerCase() }) : t("home.newWidgetTitle", { type: widgetTypeLabels[type].toLowerCase() })}</strong>
          <button type="button" onClick={onClose}><i className="bi bi-x-lg" /></button>
        </header>
        <div className="mb-home-modal-body">
          <label>
            <span>{t("home.titleLabel")} {titleMax && <em className="mb-home-modal-counter">{title.length}/{titleMax}</em>}</span>
            <input value={title} maxLength={titleMax} onChange={(event) => setTitle(event.target.value)} placeholder={isShortcut ? t("home.shortcutTitlePlaceholder") : t("home.genericTitlePlaceholder")} autoFocus />
          </label>
          {!isNote && <label><span>{t("home.urlLabel")}</span><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://..." /></label>}
          {isNote && (
            <label>
              <span>{t("home.noteLabel")}</span>
              <RichNoteEditor initialValue={text} onChange={setText} />
            </label>
          )}
          {!isNote && (
            <label>
              <span>{isShortcut ? t("home.iconLabelCentered") : t("home.iconLabelOptional")}</span>
              <input value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder={t("home.iconPlaceholder")} />
              {!imageUrl && isValidHttpUrl(url) && (
                <span className="mb-home-modal-favicon-preview"><img src={faviconUrl(url)} alt="" /> {t("home.faviconDetected")}</span>
              )}
            </label>
          )}
          {isNote && (
            <label>
              <span>{t("home.noteColorLabel")}</span>
              <div className="mb-home-modal-note-colors">
                {notePresetColors.map((preset) => (
                  <button key={preset} type="button" className={`mb-home-modal-note-swatch ${color === preset ? "active" : ""}`} style={{ background: preset }} onClick={() => setColor(preset)} title={preset} />
                ))}
              </div>
            </label>
          )}
          {!isNote && !isShortcut && (
            <label className="mb-home-modal-color-row">
              <span>{t("home.cardColorLabel")}</span>
              <input type="color" value={color || "#64748b"} onChange={(event) => setColor(event.target.value)} />
            </label>
          )}
          {error && <div className="mb-home-modal-error">{error}</div>}
        </div>
        <footer>
          {isEdit && <button type="button" className="danger" onClick={() => onDelete(initial.id)}><i className="bi bi-trash" /> {t("home.deleteButton")}</button>}
          <button type="button" className="secondary" onClick={onClose}>{t("home.cancelButton")}</button>
          <button type="submit" className="primary">{t("home.saveButton")}</button>
        </footer>
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
  const { t } = useTranslation();
  return (
    <div className="mb-home-widget-toolbar">
      <span className="mb-home-widget-drag" title={t("home.dragReorder")}><i className="bi bi-grip-vertical" /></span>
      <button type="button" className="mb-home-widget-edit" onClick={() => onEdit(widget)} title={t("home.editTitle")}><i className="bi bi-pencil" /></button>
      <button type="button" className="mb-home-widget-remove" onClick={() => onRemove(widget.id)} title={t("home.removeTitle")}><i className="bi bi-x" /></button>
    </div>
  );
}

function WidgetCard({ widget, onRemove, onEdit, onDragStart, onDragOver, onDrop, onDragEnd, dragging }) {
  const { t } = useTranslation();
  const dragProps = { draggable: true, onDragStart, onDragOver, onDrop, onDragEnd };

  if (widget.type === "shortcut" || widget.type === "link") {
    const hostname = (() => { try { return new URL(widget.url).hostname; } catch { return widget.url; } })();
    return (
      <article className={`mb-home-widget shortcut ${dragging ? "dragging" : ""}`} {...dragProps}>
        <WidgetToolbar widget={widget} onEdit={onEdit} onRemove={onRemove} />
        <a href={widget.url} target="_blank" rel="noreferrer" className="mb-home-widget-shortcut-body">
          <WidgetImage src={widget.imageUrl || faviconUrl(widget.url)} />
          <span className="mb-home-widget-shortcut-caption"><strong>{widget.title}</strong>{widget.type === "link" && <small>{hostname}</small>}</span>
        </a>
      </article>
    );
  }

  if (widget.type === "note") {
    return (
      <article className={`mb-home-widget note ${dragging ? "dragging" : ""}`} style={{ background: widget.color || "#fde68a" }} {...dragProps}>
        <span className="mb-home-widget-note-fold" aria-hidden="true" />
        <WidgetToolbar widget={widget} onEdit={onEdit} onRemove={onRemove} />
        <button type="button" className="mb-home-widget-note-body" onClick={() => onEdit(widget)} title={t("home.clickToEditNote")}>
          <strong>{widget.title}</strong>
          {widget.text && <p dangerouslySetInnerHTML={{ __html: renderNoteHtml(widget.text) }} />}
        </button>
      </article>
    );
  }

  return null;
}

function WidgetsGrid({ widgets, onRemove, onReorder, onEdit }) {
  const { t } = useTranslation();
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
      {!widgets.length && <span className="mb-home-empty">{t("home.noWidgetsYet")}</span>}
    </div>
  );
}

function DevPanel({ loading, myItems, completedHours, goalHours, hoursPercent }) {
  const { t } = useTranslation();
  const tasks = myItems.filter((item) => item.type === "Task").length;
  const bugs = myItems.filter((item) => item.type === "Bug").length;
  return (
    <>
      <div className="mb-home-kpis">
        {loading ? <KpiSkeleton count={4} /> : (
          <>
            <Kpi icon="bi-kanban" label={t("home.kpiAssigned")} value={myItems.length} />
            <Kpi icon="bi-hammer" label={t("home.kpiTasks")} value={tasks} tone="gold" />
            <Kpi icon="bi-bug-fill" label={t("home.kpiBugs")} value={bugs} tone="red" />
            <Kpi icon="bi-clock" label={t("home.kpiHours")} value={`${formatHours(completedHours)} / ${formatHours(goalHours)}`} color="#2563eb" />
          </>
        )}
      </div>
      {loading ? <span className="mbw-skeleton-block" style={{ height: 10, borderRadius: 999 }} /> : <div className="mb-home-hours-bar"><b style={{ width: `${hoursPercent}%` }} /></div>}
    </>
  );
}

function QaPanel({ loading, availableForTesting, evidenceToday }) {
  const { t } = useTranslation();
  return (
    <div className="mb-home-kpis">
      {loading ? <KpiSkeleton count={3} /> : (
        <>
          <Kpi icon="bi-check2-circle" label={t("home.kpiToTestSprint")} value={availableForTesting} color="#7c3aed" />
          <Kpi icon="bi-calendar-check" label={t("home.kpiTestedToday")} value={evidenceToday} color="#2563eb" />
          <Kpi icon="bi-clipboard2-pulse" label={t("home.kpiFocusToday")} value={availableForTesting ? t("home.focusQa") : t("home.focusFree")} color="#16a34a" />
        </>
      )}
    </div>
  );
}

// Reordenavel (drag nativo, mesmo padrao ja usado em WidgetsGrid) e
// colapsavel como accordion — pedido explicito do usuario pra TODOS os
// painelzinhos da Home, com um resumo minimalista quando fechado (em vez
// de simplesmente sumir o conteudo sem indicar o que tem la dentro).
function HomeSection({ title, subtitle, summary, collapsed, onToggleCollapse, dragging, onDragStart, onDragOver, onDrop, onDragEnd, actions, children }) {
  const { t } = useTranslation();
  return (
    <section className={`mb-home-panel mb-home-section ${dragging ? "dragging" : ""} ${collapsed ? "collapsed" : ""}`} onDragOver={onDragOver} onDrop={onDrop}>
      <header>
        <div className="mb-home-section-heading">
          <span className="mb-home-section-drag" draggable onDragStart={onDragStart} onDragEnd={onDragEnd} title={t("home.dragReorder")} aria-label={t("home.dragReorder")}><i className="bi bi-grip-vertical" /></span>
          <button type="button" className="mb-home-section-toggle" onClick={onToggleCollapse} aria-expanded={!collapsed} title={collapsed ? t("home.expand") : t("home.collapse")}>
            <i className={`bi ${collapsed ? "bi-chevron-right" : "bi-chevron-down"}`} />
          </button>
          <div><strong>{title}</strong><small>{collapsed ? summary : subtitle}</small></div>
        </div>
        {!collapsed && actions}
      </header>
      {!collapsed && children}
    </section>
  );
}

function ExecutiveSummary({ entries, name, role, autoEntries, autoLabel, dateFrom, dateTo, onDateFromChange, onDateToChange, previewText, onAdd, onRemove, onCopy, onPdf, onPrint, onSlack, collapsed, onToggleCollapse, summary, dragging, onDragStart, onDragOver, onDrop, onDragEnd }) {
  const { t } = useTranslation();
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
    <section className={`mb-home-panel mb-home-section ${dragging ? "dragging" : ""} ${collapsed ? "collapsed" : ""}`} onDragOver={onDragOver} onDrop={onDrop}>
      <header>
        <div className="mb-home-section-heading">
          <span className="mb-home-section-drag" draggable onDragStart={onDragStart} onDragEnd={onDragEnd} title={t("home.dragReorder")} aria-label={t("home.dragReorder")}><i className="bi bi-grip-vertical" /></span>
          <button type="button" className="mb-home-section-toggle" onClick={onToggleCollapse} aria-expanded={!collapsed} title={collapsed ? t("home.expand") : t("home.collapse")}>
            <i className={`bi ${collapsed ? "bi-chevron-right" : "bi-chevron-down"}`} />
          </button>
          <div><strong>{t("home.executiveSummaryTitle")}</strong><small>{collapsed ? summary : t("home.executiveSummarySubtitle")}</small></div>
        </div>
        {!collapsed && (
          <div className="mb-home-summary-actions">
            <Button onClick={onCopy}><FiCopy /> {t("home.copyButton")}</Button>
            <Button onClick={onSlack}><i className="bi bi-slack" /> Slack</Button>
            <Button onClick={onPrint}><FiPrinter /> {t("home.printButton")}</Button>
            <Button onClick={onPdf}><FiDownload /> PDF</Button>
          </div>
        )}
      </header>
      {!collapsed && (
        <>
          <form data-allow-submit="true" className="mb-home-summary-form" onSubmit={submit}>
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t("home.summaryTitlePlaceholder")} />
            <div className="mb-home-summary-type">
              <button type="button" className={type === "temporaria" ? "active" : ""} onClick={() => setType("temporaria")}>{t("home.todayButton")}</button>
              <button type="button" className={type === "recorrente" ? "active" : ""} onClick={() => setType("recorrente")}>{t("home.recurringButton")}</button>
            </div>
            <button type="submit" className="mb-home-summary-submit"><FiPlus /> {t("home.addButton")}</button>
          </form>
          <div className="mb-home-summary-range">
            <span>{t("home.periodLabel", { label: autoLabel })}</span>
            <label>{t("home.fromLabel")}<input type="date" value={dateFrom} max={dateTo} onChange={(event) => onDateFromChange(event.target.value)} /></label>
            <label>{t("home.toLabel")}<input type="date" value={dateTo} min={dateFrom} onChange={(event) => onDateToChange(event.target.value)} /></label>
          </div>
          <div className="mb-home-summary-list">
            {entries.map((entry) => (
              <div key={entry.id} className={`mb-home-summary-item ${entry.type}`}>
                <span className="mb-home-summary-tag">{entry.type === "recorrente" ? t("home.recurringTag") : t("home.todayTag")}</span>
                <span className="mb-home-summary-title">{entry.title}</span>
                <button type="button" onClick={() => onRemove(entry.id)} title={t("home.removeButton")}><i className="bi bi-x" /></button>
              </div>
            ))}
            {autoEntries.map((entry, index) => (
              <div key={`auto-${index}`} className="mb-home-summary-item auto">
                <span className="mb-home-summary-tag">{autoLabel}</span>
                <span className="mb-home-summary-title">{entry.title}</span>
              </div>
            ))}
            {!entries.length && !autoEntries.length && <span className="mb-home-empty">{t("home.emptySummary")}</span>}
          </div>
          <div className="mb-home-summary-preview">
            <button type="button" className="mb-home-summary-preview-toggle" onClick={() => setShowPreview((value) => !value)}>
              <span>{t("home.previewToggle")}</span><i className={`bi ${showPreview ? "bi-chevron-up" : "bi-chevron-down"}`} />
            </button>
            {showPreview && <pre>{previewText}</pre>}
          </div>
        </>
      )}
    </section>
  );
}

export function WorkbenchHome() {
  const { t } = useTranslation();
  const { profile, user, demoMode } = useAuth();
  const { items, loading } = useWorkItems();
  const { evidence } = useTestEvidence();
  const { collaborators } = useCollaborators();
  const { getSetting } = useAppSettings();
  const { pushToast } = useToast();
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
  // Admin ja tem o sandbox global "Ver como" (Layout.jsx) pra simular
  // qualquer nivel de acesso — nao precisa mais de um segundo seletor so
  // pra este widget trocar o tipo de relatorio.
  const reportType = isDev ? "dev" : isQa ? "qa" : isGestao ? "gestao" : "dev";
  const today = now.toISOString().slice(0, 10);

  const [widgets, setWidgets] = useState(() => readLocal(storageKey("HomeWidgets", userKey), []));
  const [summaryEntries, setSummaryEntries] = useState(() => readLocal(storageKey("HomeSummary", userKey), []));
  const [summaryDateFrom, setSummaryDateFrom] = useState(() => readLocal(storageKey("HomeSummaryFrom", userKey), today));
  const [summaryDateTo, setSummaryDateTo] = useState(() => readLocal(storageKey("HomeSummaryTo", userKey), today));
  const [rawSectionOrder, setRawSectionOrder] = useState(() => readLocal(storageKey("HomeSectionOrder", userKey), HOME_SECTION_DEFAULT_ORDER));
  const [collapsedSections, setCollapsedSections] = useState(() => readLocal(storageKey("HomeSectionsCollapsed", userKey), {}));
  const [dragSectionId, setDragSectionId] = useState(null);

  useEffect(() => { writeLocal(storageKey("HomeWidgets", userKey), widgets); }, [widgets, userKey]);
  useEffect(() => { writeLocal(storageKey("HomeSummary", userKey), summaryEntries); }, [summaryEntries, userKey]);
  useEffect(() => { writeLocal(storageKey("HomeSummaryFrom", userKey), summaryDateFrom); }, [summaryDateFrom, userKey]);
  useEffect(() => { writeLocal(storageKey("HomeSummaryTo", userKey), summaryDateTo); }, [summaryDateTo, userKey]);
  useEffect(() => { writeLocal(storageKey("HomeSectionOrder", userKey), rawSectionOrder); }, [rawSectionOrder, userKey]);
  useEffect(() => { writeLocal(storageKey("HomeSectionsCollapsed", userKey), collapsedSections); }, [collapsedSections, userKey]);

  // Ids conhecidos pra alem do que ja estava salvo (ex.: secao nova
  // adicionada depois que a pessoa ja tinha uma ordem salva) entram no
  // final, sem perder a ordem que a pessoa ja tinha customizado.
  const sectionOrder = useMemo(() => {
    const known = new Set(rawSectionOrder);
    return [...rawSectionOrder, ...HOME_SECTION_DEFAULT_ORDER.filter((id) => !known.has(id))];
  }, [rawSectionOrder]);

  function toggleSectionCollapsed(id) {
    setCollapsedSections((current) => ({ ...current, [id]: !current[id] }));
  }

  function reorderSectionTo(draggedId, targetId) {
    if (!draggedId || draggedId === targetId) return;
    setRawSectionOrder((current) => {
      const known = new Set(current);
      const merged = [...current, ...HOME_SECTION_DEFAULT_ORDER.filter((id) => !known.has(id))];
      const fromIndex = merged.indexOf(draggedId);
      const toIndex = merged.indexOf(targetId);
      if (fromIndex === -1 || toIndex === -1) return current;
      const next = merged.slice();
      next.splice(fromIndex, 1);
      next.splice(toIndex, 0, draggedId);
      return next;
    });
  }

  function sectionDragProps(id) {
    return {
      dragging: dragSectionId === id,
      onDragStart: () => setDragSectionId(id),
      onDragOver: (event) => event.preventDefault(),
      onDrop: (event) => { event.preventDefault(); reorderSectionTo(dragSectionId, id); setDragSectionId(null); },
      onDragEnd: () => setDragSectionId(null)
    };
  }

  // Admin ignora accessLevel em toda rota protegida (ProtectedRoute.jsx) —
  // esses atalhos precisam do mesmo bypass, senao um Admin sem nivel formal
  // (ex.: nivel "pending") ficava sem NENHUM atalho na Home mesmo podendo
  // acessar todas as telas pela Sidebar.
  const quickLinks = [
    { to: "/dev", label: t("nav.myItems"), icon: FiUser, show: isAdmin || [accessLevels.dev, accessLevels.qa, accessLevels.gestao, accessLevels.gerente].includes(access) },
    { to: "/qa", label: t("nav.qualityBoard"), icon: FiCheckCircle, show: isAdmin || [accessLevels.qa, accessLevels.gestao, accessLevels.gerente].includes(access) },
    { to: "/management", label: t("nav.teamManagement"), icon: FiShield, show: isGestao },
    { to: "/management/dashboard", label: t("nav.projectManagement"), icon: FiShield, show: isGerente || isAdmin },
    { to: "/settings", label: t("nav.settings"), icon: FiPlus, show: true }
  ].filter((item) => item.show);

  // Indice alias-aware (mesmo padrao usado em Gestao do projeto/Slack) — o
  // assigneeName que vem do Azure pode nao bater 100% com o azureName
  // cadastrado (ordem "Sobrenome, Nome", acentos), o que fazia "meus itens"
  // e a atividade recente ficarem vazios pra boa parte dos usuarios mesmo
  // com itens de verdade atribuidos a eles.
  const collaboratorNameIndex = useMemo(() => buildCollaboratorNameIndex(collaborators), [collaborators]);
  const myCollaborator = collaborators.find((person) => person.id === profile?.id)
    || findCollaboratorByName(collaboratorNameIndex, displayName);

  const myItems = useMemo(
    () => items.filter((item) => (myCollaborator && item.assigneeId === myCollaborator.id)
      || item.assigneeEmail === user?.email
      || (myCollaborator && findCollaboratorByName(collaboratorNameIndex, item.assigneeName)?.id === myCollaborator.id)),
    [items, myCollaborator, user?.email, collaboratorNameIndex]
  );
  const myItemIds = useMemo(() => new Set(myItems.map((item) => Number(item.id))), [myItems]);
  const myRecentEvidence = useMemo(
    () => evidence.filter((entry) => myItemIds.has(Number(entry.workItemId))).slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))),
    [evidence, myItemIds]
  );
  // "Disponivel para teste" = estagios reconhecidos pelo Quality Board (In
  // QA/In BETA/Ready Beta/HMG CNK/Ready Prod), a mesma fonte de verdade que
  // decide quais cards aparecem la — evita a regex solta anterior (so
  // cobria "in qa"/"in beta") ficar fora de sincronia com o board de verdade.
  const availableForTesting = useMemo(
    () => items.filter((item) => Boolean(qaStatusInfo(item.state).key)).slice().sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))),
    [items]
  );
  // Meus itens que um QA ja pegou pra testar (perspectiva do Dev: "seu item
  // esta sendo testado por Fulano").
  const myItemsPickedUpForTesting = useMemo(
    () => myItems.filter((item) => item.qaCollaboratorId && Boolean(qaStatusInfo(item.state).key)),
    [myItems]
  );
  const recentEvidenceTeamWide = useMemo(
    () => evidence.slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))),
    [evidence]
  );

  // Feed relevante por PAPEL, nao um unico feed generico: Dev ve mudancas
  // nos proprios itens + quando um QA pega um deles pra testar; QA ve itens
  // novos disponiveis pra teste (board inteiro) + resultados que ele mesmo
  // registrou; Gestao/Gerente/Admin (sem itens proprios, em geral) veem o
  // pulso do board inteiro + evidencias recentes do time.
  const activityFeed = useMemo(() => {
    const entries = [];
    if (isQa) {
      availableForTesting.slice(0, 6).forEach((item) => entries.push({
        id: `item-${item.id}`,
        icon: "bi-check2-circle",
        text: `#${item.id} ${item.title}`,
        meta: `${qaStatusInfo(item.state).label || item.state || t("home.statusNoStatus")} · ${t("home.availableForTest")}`,
        date: item.updatedAt,
        to: "/qa",
        workItemId: item.id
      }));
      myRecentEvidence.slice(0, 4).forEach((entry) => entries.push({
        id: `evidence-${entry.id}`,
        icon: "bi-clipboard2-check",
        text: t("home.newResultOn", { id: entry.workItemId }),
        meta: `${entry.result || t("home.resultLabel")} · ${t("home.registeredByYou")}`,
        date: entry.createdAt,
        to: "/qa",
        workItemId: entry.workItemId
      }));
    } else if (isDev) {
      myItems.slice().sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))).slice(0, 6).forEach((item) => entries.push({
        id: `item-${item.id}`,
        icon: "bi-kanban",
        text: `#${item.id} ${item.title}`,
        meta: `${item.state || t("home.statusNoStatus")} · ${item.sprint || t("home.noSprint")}`,
        date: item.updatedAt,
        to: "/dev",
        workItemId: item.id
      }));
      myItemsPickedUpForTesting.slice(0, 4).forEach((item) => {
        const qaPerson = collaborators.find((person) => person.id === item.qaCollaboratorId);
        entries.push({
          id: `qa-pickup-${item.id}`,
          icon: "bi-person-check",
          text: `#${item.id} ${item.title}`,
          meta: t("home.pickedUpForTest", { name: qaPerson?.azureName || "QA" }),
          date: item.updatedAt,
          to: "/dev",
          workItemId: item.id
        });
      });
    } else {
      availableForTesting.slice(0, 5).forEach((item) => entries.push({
        id: `item-${item.id}`,
        icon: "bi-check2-circle",
        text: `#${item.id} ${item.title}`,
        meta: `${qaStatusInfo(item.state).label || item.state || t("home.statusNoStatus")} · ${t("home.availableForTest")}`,
        date: item.updatedAt,
        to: "/qa",
        workItemId: item.id
      }));
      recentEvidenceTeamWide.slice(0, 4).forEach((entry) => entries.push({
        id: `evidence-${entry.id}`,
        icon: "bi-clipboard2-check",
        text: t("home.newResultOn", { id: entry.workItemId }),
        meta: `${entry.result || t("home.resultLabel")} · ${entry.authorName || "QA"}`,
        date: entry.createdAt,
        to: "/qa",
        workItemId: entry.workItemId
      }));
    }
    return entries.sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))).slice(0, 8);
  }, [availableForTesting, isDev, isQa, myItems, myItemsPickedUpForTesting, myRecentEvidence, recentEvidenceTeamWide, collaborators, t]);
  const goalHours = Number(myCollaborator?.goalHours || goalDefault);
  const completedHours = myItems.reduce((sum, item) => sum + Number(item.completedHours || 0), 0);
  const hoursPercent = goalHours ? Math.min(100, Math.round((completedHours / goalHours) * 100)) : 0;
  const evidenceToday = evidence.filter((entry) => String(entry.createdAt || "").slice(0, 10) === today).length;
  const sprintOptions = Array.from(new Set(items.map((item) => item.sprint || item.iteration).filter(Boolean)));
  const currentSprintLabel = compactSprintLabel(findCurrentSprint(sprintOptions));

  const developerRows = useMemo(() => {
    if (!isGestao) return [];
    const map = new Map();
    collaborators.filter((person) => person.isDev || person.isQa || person.isManagement).forEach((person) => {
      map.set(person.id, { name: person.azureName, hours: 0, goal: Number(person.goalHours || goalDefault) });
    });
    items.forEach((item) => {
      const person = collaborators.find((entry) => entry.id === item.assigneeId) || findCollaboratorByName(collaboratorNameIndex, item.assigneeName);
      const key = person?.id || item.assigneeName || "unassigned";
      if (!map.has(key)) map.set(key, { name: item.assigneeName || t("home.unassigned"), hours: 0, goal: goalDefault });
      map.get(key).hours += Number(item.completedHours || 0);
    });
    return Array.from(map.values()).map((row) => ({
      ...row,
      label: row.hours < row.goal ? t("home.below") : row.hours > row.goal ? t("home.above") : t("home.met"),
      tone: row.hours < row.goal ? "danger" : row.hours > row.goal ? "warning" : "primary"
    }));
  }, [collaboratorNameIndex, collaborators, goalDefault, isGestao, items, t]);

  const governanceTotals = useMemo(() => ({
    developers: developerRows.length,
    cards: items.length,
    hours: developerRows.reduce((sum, row) => sum + row.hours, 0),
    goal: developerRows.reduce((sum, row) => sum + row.goal, 0),
    missing: developerRows.reduce((sum, row) => sum + Math.max(row.goal - row.hours, 0), 0),
    extra: developerRows.reduce((sum, row) => sum + Math.max(row.hours - row.goal, 0), 0)
  }), [developerRows, items]);

  // "Hoje" era um recorte fixo (so a data de hoje, sem opcao de ver outro
  // dia ou um intervalo) — vira um range inicio/fim que o usuario controla,
  // defaultando pra hoje-hoje pra nao mudar o comportamento de quem nunca
  // mexeu no filtro.
  const summaryRangeFrom = summaryDateFrom || today;
  const summaryRangeTo = summaryDateTo || today;
  const isSingleDayRange = summaryRangeFrom === summaryRangeTo;
  const autoLabel = isSingleDayRange
    ? { dev: summaryRangeFrom === today ? t("home.prsToday") : t("home.prsInPeriod"), qa: summaryRangeFrom === today ? t("home.testsToday") : t("home.testsInPeriod"), gestao: t("home.governanceSnapshot") }[reportType]
    : { dev: t("home.prsInPeriod"), qa: t("home.testsInPeriod"), gestao: t("home.governanceSnapshot") }[reportType];
  const autoEntries = useMemo(() => {
    const inRange = (value) => {
      const day = String(value || "").slice(0, 10);
      return day >= summaryRangeFrom && day <= summaryRangeTo;
    };
    if (reportType === "qa") {
      return evidence
        .filter((entry) => inRange(entry.createdAt))
        .map((entry) => ({ title: `#${entry.workItemId} — ${entry.result || t("home.resultLabel")} (${entry.authorName || "QA"})` }));
    }
    if (reportType === "gestao") {
      if (!governanceTotals.developers) return [];
      return [{ title: `${governanceTotals.developers} colaborador(es), ${governanceTotals.cards} card(s), ${formatHours(governanceTotals.hours)} registradas, ${formatHours(governanceTotals.missing)} pendentes` }];
    }
    return myItems
      .filter((item) => inRange(item.updatedAt))
      .map((item) => ({ title: `#${item.id} ${item.title} — ${item.state || t("home.withoutStatus")}` }));
  }, [evidence, governanceTotals, myItems, reportType, summaryRangeFrom, summaryRangeTo, t]);

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
  function deleteWidgetFromModal(id) {
    removeWidget(id);
    setWidgetModalType(null);
    setEditingWidget(null);
  }
  function reorderWidgets(next) {
    setWidgets(next);
  }
  function handleShortcutImport({ accepted, rejected }) {
    if (accepted.length) setWidgets((current) => [...accepted, ...current]);
    if (accepted.length && !rejected.length) pushToast({ title: t("home.shortcutsImportedTitle"), body: t("home.shortcutsImportedBody", { count: accepted.length }), tone: "success" });
    else if (accepted.length && rejected.length) pushToast({ title: t("home.shortcutsPartialTitle"), body: t("home.shortcutsPartialBody", { accepted: accepted.length, rejected: rejected.length, details: rejected.map((entry) => `${entry.title} (${entry.reason})`).join("; ") }), tone: "warning" });
    else pushToast({ title: t("home.shortcutsNoneTitle"), body: rejected.map((entry) => `${entry.title} (${entry.reason})`).join("; ") || t("home.shortcutsEmptyFile"), tone: "danger" });
  }
  function addSummaryEntry(entry) {
    setSummaryEntries((current) => [entry, ...current]);
  }
  function removeSummaryEntry(id) {
    setSummaryEntries((current) => current.filter((entry) => entry.id !== id));
  }
  // O resumo executivo e sempre PESSOAL (notas manuais "recorrente"/"hoje" +
  // destaques automaticos do proprio dia, ja variando por papel via
  // autoEntries/autoLabel acima) — nao troca pra um relatorio totalmente
  // diferente por papel, senao os itens manuais que a pessoa acabou de
  // adicionar somem da previa/copia/impressao/PDF pra quem e QA ou Gestao
  // (o bug reportado: "adicionei um item e a previa nao atualiza").
  // Relatorios especializados de QA/Gestao continuam disponiveis nas
  // proprias telas de Testes/Governanca.
  function copySummary() {
    return copyPersonalSummaryText({ name: displayName, role: accessLabel, entries: summaryEntries, autoEntries, autoLabel, dateFrom: summaryRangeFrom, dateTo: summaryRangeTo });
  }
  function pdfSummary() {
    return downloadPersonalSummaryPdf({ name: displayName, role: accessLabel, entries: summaryEntries, autoEntries, autoLabel, dateFrom: summaryRangeFrom, dateTo: summaryRangeTo, filename: `stark-hub-resumo-${displayName.split(" ")[0].toLowerCase()}-${new Date().toISOString().slice(0, 10)}.pdf` });
  }
  function printSummary() {
    const text = buildPersonalSummaryText({ name: displayName, role: accessLabel, entries: summaryEntries, autoEntries, autoLabel, dateFrom: summaryRangeFrom, dateTo: summaryRangeTo });
    const printWindow = window.open("", "_blank", "width=640,height=800");
    if (!printWindow) return;
    const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    printWindow.document.write(`<!doctype html><html><head><title>Resumo executivo - ${displayName}</title><style>body{font-family:Arial,Helvetica,sans-serif;padding:28px;white-space:pre-wrap;font-size:13px;line-height:1.7;color:#111;}</style></head><body>${escaped}</body></html>`);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }
  function copyGovernance() {
    copyExecutiveReportText({ title: t("home.reportTitle"), period: t("home.currentPeriod"), totals: governanceTotals, rows: developerRows });
  }
  function pdfGovernance() {
    downloadExecutiveReportPdf({ title: t("home.pdfTitle"), period: t("home.currentPeriod"), totals: governanceTotals, rows: developerRows, filename: `stark-hub-Gestao-resumo-${new Date().toISOString().slice(0, 10)}.pdf` });
  }
  async function sendSlack(text) {
    const webhooks = resolveSlackWebhooks(getSetting);
    if (!webhooks.length) { alert(t("home.slackNotConfigured")); return; }
    const { data, error } = await supabase.functions.invoke("slackNotify", { body: { webhooks, text } });
    if (error || !data?.ok) alert(t("home.slackSendError", { message: error?.message || "verifique o webhook configurado." }));
  }
  function slackSummary() {
    sendSlack(buildPersonalSummarySlackText({ name: displayName, role: accessLabel, entries: summaryEntries, autoEntries, autoLabel, dateFrom: summaryRangeFrom, dateTo: summaryRangeTo }));
  }
  function slackGovernance() {
    sendSlack(buildGovernanceSlackText({ totals: governanceTotals, rows: developerRows }));
  }

  const summaryPreviewText = buildPersonalSummaryText({ name: displayName, role: accessLabel, entries: summaryEntries, autoEntries, autoLabel, dateFrom: summaryRangeFrom, dateTo: summaryRangeTo });

  function exportHomeCsv() {
    downloadCsv(`home-${dateStamp()}.csv`, [t("home.csvSection"), t("home.csvType"), t("home.csvTitle"), t("home.csvDetail")], [
      ...widgets.map((widget) => [t("home.csvPanel"), widget.type, widget.title, widget.url || widget.text || ""]),
      ...activityFeed.map((entry) => [t("home.csvActivitySection"), t("home.csvActivity"), entry.text, entry.meta]),
      ...autoEntries.map((entry) => [t("home.csvExecutiveReport"), autoLabel, entry.title, t("home.csvAutomatic")]),
      ...summaryEntries.map((entry) => [t("home.csvExecutiveReport"), entry.type || t("home.csvManual"), entry.title, entry.text || ""])
    ]);
  }

  const sectionVisibility = { widgets: true, devPanel: isDev, qaPanel: isQa, activity: true, governance: isGestao, summary: true };
  const visibleSectionIds = sectionOrder.filter((id) => sectionVisibility[id]);
  const sectionTitles = {
    widgets: t("home.sectionTitleWidgets"),
    devPanel: t("home.sectionTitleDevPanel"),
    qaPanel: t("home.sectionTitleQaPanel"),
    activity: t("home.sectionTitleActivity"),
    governance: t("home.sectionTitleGovernance")
  };
  const sectionContent = {
    widgets: {
      subtitle: t("home.widgetsSubtitle"),
      summary: t("home.widgetsSummary", { count: widgets.length }),
      actions: <div className="mb-home-panel-actions"><ShortcutTemplateActions widgets={widgets} onImport={handleShortcutImport} /><AddWidgetMenu onPick={setWidgetModalType} /></div>,
      body: <WidgetsGrid widgets={widgets} onRemove={removeWidget} onReorder={reorderWidgets} onEdit={setEditingWidget} />
    },
    devPanel: {
      subtitle: t("home.devPanelSubtitle"),
      summary: t("home.devPanelSummary", { count: myItems.length, completed: formatHours(completedHours), goal: formatHours(goalHours) }),
      body: <DevPanel loading={loading} myItems={myItems} completedHours={completedHours} goalHours={goalHours} hoursPercent={hoursPercent} />
    },
    qaPanel: {
      subtitle: t("home.qaPanelSubtitle", { sprint: currentSprintLabel ? t("home.qaPanelSprintSuffix", { sprint: currentSprintLabel }) : "" }),
      summary: t("home.qaPanelSummary", { count: availableForTesting.length, today: evidenceToday }),
      body: <QaPanel loading={loading} availableForTesting={availableForTesting.length} evidenceToday={evidenceToday} />
    },
    activity: {
      subtitle: isQa ? t("home.activitySubtitleQa") : isDev ? t("home.activitySubtitleDev") : t("home.activitySubtitleOther"),
      summary: t("home.activitySummary", { count: activityFeed.length }),
      body: loading ? <WorkbenchCardSkeleton rows={4} mode="compact" /> : (
        <div className="mb-home-activity">
          {activityFeed.map((entry) => (
            <Link key={entry.id} to={entry.to || "/dev"} onClick={() => entry.workItemId != null && savePendingWorkItemHighlight(entry.workItemId)}>
              <i className={`bi ${entry.icon}`} />
              <span><strong>{entry.text}</strong><small>{entry.meta}</small></span>
            </Link>
          ))}
          {!activityFeed.length && <span className="mb-home-empty">{t("home.emptyActivity")}</span>}
        </div>
      )
    },
    governance: {
      subtitle: t("home.governanceSubtitle"),
      summary: t("home.governanceSummary", { count: governanceTotals.developers, hours: formatHours(governanceTotals.hours) }),
      actions: (
        <div className="mb-home-summary-actions">
          <Button onClick={copyGovernance}><FiCopy /> {t("home.copyButton")}</Button>
          <Button onClick={slackGovernance}><i className="bi bi-slack" /> Slack</Button>
          <Button onClick={pdfGovernance}><FiDownload /> PDF</Button>
          <Link to="/management" className="mbw-btn default"><FiShield /> {t("home.viewMore")}</Link>
        </div>
      ),
      body: (
        <>
          <div className="mb-home-kpis">
            {loading ? <KpiSkeleton count={4} /> : (
              <>
                <Kpi icon="bi-people" label={t("home.kpiCollaborators")} value={governanceTotals.developers} />
                <Kpi icon="bi-kanban" label={t("home.kpiCards")} value={governanceTotals.cards} />
                <Kpi icon="bi-clock" label={t("home.kpiHoursRegistered")} value={formatHours(governanceTotals.hours)} color="#2563eb" />
                <Kpi icon="bi-dash-lg" label={t("home.kpiHoursPending")} value={formatHours(governanceTotals.missing)} color="#dc2626" />
              </>
            )}
          </div>
          {!loading && (
            <div className="mb-home-governance-mini">
              <div>
                <span>{t("home.miniHours")}</span>
                <div className="mb-home-mini-track"><b style={{ width: `${governanceTotals.goal ? Math.min(100, (governanceTotals.hours / governanceTotals.goal) * 100) : 0}%` }} /></div>
                <small>{t("home.miniOfGoal", { hours: formatHours(governanceTotals.hours), goal: formatHours(governanceTotals.goal) })}</small>
              </div>
              <div>
                <span>{t("home.miniGoalHealth")}</span>
                <div className="mb-home-mini-bars">
                  <b className="ok" style={{ width: `${governanceTotals.developers ? (governanceTotals.goalMet / governanceTotals.developers) * 100 : 0}%` }} />
                  <b className="warn" style={{ width: `${governanceTotals.developers ? (governanceTotals.goalAbove / governanceTotals.developers) * 100 : 0}%` }} />
                  <b className="danger" style={{ width: `${governanceTotals.developers ? (governanceTotals.goalBelow / governanceTotals.developers) * 100 : 0}%` }} />
                </div>
                <small>{t("home.miniGoalBreakdown", { below: governanceTotals.goalBelow, met: governanceTotals.goalMet, above: governanceTotals.goalAbove })}</small>
              </div>
            </div>
          )}
        </>
      )
    }
  };

  return (
    <section className="mbw-page mb-home-page">
      <WorkbenchHeader
        kicker="Stark Hub"
        title={t("pages.home.greeting", { name: displayName.split(" ")[0] || "time" })}
        subtitle={`${accessLabel} · ${now.toLocaleDateString("pt-BR")} · ${now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`}
        demoMode={demoMode}
        actions={<Button onClick={exportHomeCsv}><FiDownload /> CSV</Button>}
      />
      <section className="mb-home-quick">
        {quickLinks.map(({ to, label, icon: Icon }) => <Link key={to} to={to}><Icon /> {label}</Link>)}
      </section>
      {visibleSectionIds.map((id) => {
        if (id === "summary") {
          return (
            <ExecutiveSummary
              key={id}
              entries={summaryEntries}
              name={displayName}
              role={accessLabel}
              autoEntries={autoEntries}
              autoLabel={autoLabel}
              dateFrom={summaryRangeFrom}
              dateTo={summaryRangeTo}
              onDateFromChange={setSummaryDateFrom}
              onDateToChange={setSummaryDateTo}
              previewText={summaryPreviewText}
              onAdd={addSummaryEntry}
              onRemove={removeSummaryEntry}
              onCopy={copySummary}
              onPdf={pdfSummary}
              onPrint={printSummary}
              onSlack={slackSummary}
              collapsed={Boolean(collapsedSections[id])}
              onToggleCollapse={() => toggleSectionCollapsed(id)}
              summary={t("home.manualAutomaticSummary", { manual: summaryEntries.length, auto: autoEntries.length })}
              {...sectionDragProps(id)}
            />
          );
        }
        const content = sectionContent[id];
        if (!content) return null;
        return (
          <HomeSection
            key={id}
            title={sectionTitles[id]}
            subtitle={content.subtitle}
            summary={content.summary}
            actions={content.actions}
            collapsed={Boolean(collapsedSections[id])}
            onToggleCollapse={() => toggleSectionCollapsed(id)}
            {...sectionDragProps(id)}
          >
            {content.body}
          </HomeSection>
        );
      })}

      {(widgetModalType || editingWidget) && (
        <WidgetModal
          type={editingWidget?.type || widgetModalType}
          initial={editingWidget}
          onClose={() => { setWidgetModalType(null); setEditingWidget(null); }}
          onSave={saveWidget}
          onDelete={deleteWidgetFromModal}
        />
      )}
    </section>
  );
}


