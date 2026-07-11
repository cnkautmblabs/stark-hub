import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

// Pecas de renderizacao dos widgets do Painel (nota/link/atalho)
// compartilhadas entre a grade normal (WorkbenchHome) e a camada flutuante
// global (FloatingWidgetsLayer) — extraidas pra nao duplicar a logica de
// preview de nota/favicon em dois arquivos.

export const notePresetColors = ["#fde68a", "#fdba74", "#fbcfe8", "#bbf7d0", "#bfdbfe", "#ddd6fe", "#e5e7eb"];

export function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

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
export function renderNoteHtml(text) {
  return looksLikeHtml(text) ? text : renderMiniMarkdown(text);
}

// Favicon publico do Google — nao precisa de backend nem CORS pra um <img>,
// e cobre "link"/"atalho" sem exigir que o usuario cole uma URL de imagem.
export function faviconUrl(url) {
  try {
    const host = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(host)}`;
  } catch {
    return "";
  }
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

export function WidgetImage({ src, alt = "" }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return <div className="mb-home-widget-placeholder"><ImagePlaceholder /></div>;
  }
  return <img src={src} alt={alt} onError={() => setFailed(true)} />;
}

// Titulo sempre no topo, descricao logo abaixo. Na grade normal o texto e
// clampado (5 linhas) via CSS com um "Ver mais" que abre o editor pra ler
// o resto; no card flutuante (`clamp=false`) isso nao faz sentido — o card
// e redimensionavel e o corpo ja rola sozinho, entao o texto sempre
// aparece por inteiro (pedido explicito do usuario: "as notas nao mostra
// todo o texto... nem redimencionando").
export function NoteCardBody({ widget, onEdit, clamp = true }) {
  const { t } = useTranslation();
  const textRef = useRef(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    if (!clamp) { setOverflowing(false); return; }
    const el = textRef.current;
    if (!el) { setOverflowing(false); return; }
    setOverflowing(el.scrollHeight > el.clientHeight + 1);
  }, [widget.text, clamp]);

  return (
    <button type="button" className="mb-home-widget-note-body" onClick={() => onEdit(widget)} title={t("home.clickToEditNote")}>
      <strong>{widget.title}</strong>
      {widget.text && (
        <div className={`mb-home-widget-note-text-wrap ${clamp ? "" : "no-clamp"}`}>
          <p ref={textRef} dangerouslySetInnerHTML={{ __html: renderNoteHtml(widget.text) }} />
          {overflowing && <span className="mb-home-widget-note-more">{t("home.seeMore")}</span>}
        </div>
      )}
    </button>
  );
}

// Conteudo de UM widget (nota ou link/atalho), sem a moldura <article> nem
// a toolbar — reaproveitado tanto no card normal da grade quanto no card
// flutuante/pinado no menu, que tem molduras diferentes.
export function WidgetBody({ widget, onEdit, clamp = true }) {
  if (widget.type === "note") return <NoteCardBody widget={widget} onEdit={onEdit} clamp={clamp} />;
  if (widget.type === "shortcut" || widget.type === "link") {
    const hostname = (() => { try { return new URL(widget.url).hostname; } catch { return widget.url; } })();
    return (
      <a href={widget.url} target="_blank" rel="noreferrer" className="mb-home-widget-shortcut-body">
        <WidgetImage src={widget.imageUrl || faviconUrl(widget.url)} />
        <span className="mb-home-widget-shortcut-caption"><strong>{widget.title}</strong>{widget.type === "link" && <small>{hostname}</small>}</span>
      </a>
    );
  }
  return null;
}

// Mostra a nota inteira em modo leitura (titulo + HTML formatado, sem
// campos de edicao) — usado pelo item fixado no menu lateral, onde clicar
// deve "executar a acao" (link abre, nota abre pra ler), nao um popover
// minusculo com o card inteiro espremido.
export function NoteViewModal({ widget, onClose, onEdit }) {
  const { t } = useTranslation();
  return (
    <div className="mb-home-modal-overlay" onClick={onClose}>
      <div className="mb-home-modal note" style={{ background: widget.color || notePresetColors[0] }} onClick={(event) => event.stopPropagation()}>
        <span className="mb-home-modal-note-fold" aria-hidden="true" />
        <header>
          <strong>{widget.title}</strong>
          <button type="button" onClick={onClose}><i className="bi bi-x-lg" /></button>
        </header>
        <div className="mb-home-modal-body">
          {widget.text ? <div className="mb-home-note-view-text" dangerouslySetInnerHTML={{ __html: renderNoteHtml(widget.text) }} /> : <p className="mb-home-modal-muted">{t("home.noContent")}</p>}
        </div>
        {onEdit && (
          <footer>
            <button type="button" className="primary" onClick={() => onEdit(widget)}><i className="bi bi-pencil" /> {t("home.editTitle")}</button>
          </footer>
        )}
      </div>
    </div>
  );
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

// Botao de Pin com menu de contexto (Fixar flutuante / Fixar no menu
// lateral) — pedido explicito do usuario: "pin(menu de contexto, pin menu,
// pin float)". So aparece quando o widget ainda esta no painel (onPin
// existe); widgets ja pinados mostram um botao "Voltar ao painel" no lugar
// (ver WidgetToolbar).
function PinMenu({ onPin }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useOutsideClick(open, () => setOpen(false));
  return (
    <div ref={rootRef} className="mb-home-widget-pin-menu">
      <button type="button" className="mb-home-widget-pin" onClick={() => setOpen((value) => !value)} title={t("home.pinTitle")}>
        <i className="bi bi-pin-angle" />
      </button>
      {open && (
        <div className="mb-home-widget-pin-options">
          <button type="button" onClick={() => { onPin("float"); setOpen(false); }}><i className="bi bi-window-stack" /> {t("home.pinFloat")}</button>
          <button type="button" onClick={() => { onPin("sidebar"); setOpen(false); }}><i className="bi bi-layout-sidebar-inset" /> {t("home.pinSidebar")}</button>
        </div>
      )}
    </div>
  );
}

// Ordem pedida explicitamente: icone de drag, lapis (editar), pin
// (com o menu de contexto acima) e fechar/voltar.
export function WidgetToolbar({ onEdit, onRemove, onPin, widget, dragHandleProps }) {
  const { t } = useTranslation();
  return (
    <div className="mb-home-widget-toolbar">
      <span className="mb-home-widget-drag" title={t("home.dragReorder")} {...dragHandleProps}><i className="bi bi-grip-vertical" /></span>
      {onEdit && <button type="button" className="mb-home-widget-edit" onClick={() => onEdit(widget)} title={t("home.editTitle")}><i className="bi bi-pencil" /></button>}
      {onPin && <PinMenu onPin={onPin} />}
      <button type="button" className="mb-home-widget-remove" onClick={() => onRemove(widget.id)} title={widget.pinned ? t("home.unpinTitle") : t("home.removeTitle")}>
        <i className={`bi ${widget.pinned ? "bi-x-circle" : "bi-x"}`} />
      </button>
    </div>
  );
}

export const SHORTCUT_TITLE_MAX = 10;

// Editor WYSIWYG minimo pro post-it: sem preview separada, sem markdown
// visivel — o que o usuario ve digitando e exatamente o HTML salvo. Usa
// document.execCommand (suportado em todos os navegadores evergreen pra
// esse tipo de edicao simples) em vez de trazer uma lib de editor inteira.
export function RichNoteEditor({ initialValue, onChange, highlightColor = "#fff59d" }) {
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

// Modal de criar/editar widget — compartilhado entre a grade normal e a
// camada flutuante (pedido explicito do usuario: o modo pin flutuante
// tambem precisa de botao de editar, nao so a grade normal).
export function WidgetModal({ type, initial, onClose, onSave, onDelete }) {
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
      ...initial,
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
          {isNote ? (
            <input
              className="mb-home-note-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t("home.genericTitlePlaceholder")}
              autoFocus
            />
          ) : (
            <label>
              <span>{t("home.titleLabel")} {titleMax && <em className="mb-home-modal-counter">{title.length}/{titleMax}</em>}</span>
              <input value={title} maxLength={titleMax} onChange={(event) => setTitle(event.target.value)} placeholder={isShortcut ? t("home.shortcutTitlePlaceholder") : t("home.genericTitlePlaceholder")} autoFocus />
            </label>
          )}
          {!isNote && <label><span>{t("home.urlLabel")}</span><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://..." /></label>}
          {isNote && <RichNoteEditor initialValue={text} onChange={setText} />}
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
            <div className="mb-home-modal-note-colors">
              {notePresetColors.map((preset) => (
                <button key={preset} type="button" className={`mb-home-modal-note-swatch ${color === preset ? "active" : ""}`} style={{ background: preset }} onClick={() => setColor(preset)} title={preset} />
              ))}
            </div>
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
          {isEdit && onDelete && <button type="button" className="danger" onMouseDown={(event) => event.preventDefault()} onClick={() => onDelete(initial.id)}><i className="bi bi-trash" /> {t("home.deleteButton")}</button>}
          <button type="button" className="secondary" onMouseDown={(event) => event.preventDefault()} onClick={onClose}>{t("home.cancelButton")}</button>
          <button type="submit" className="primary" onMouseDown={(event) => event.preventDefault()}>{t("home.saveButton")}</button>
        </footer>
      </form>
    </div>
  );
}
