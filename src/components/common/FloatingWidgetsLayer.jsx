import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, useDragControls, useMotionValue, animate } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../contexts/AuthContext.jsx";
import { useHomeWidgets } from "../../hooks/useHomeWidgets.js";
import { NoteViewModal, WidgetBody, WidgetImage, WidgetModal, faviconUrl } from "../workbench/home/widgetShared.jsx";

const DEFAULT_SIZE = { w: 260, h: 220 };
const MIN_SIZE = { w: 190, h: 150 };

// Um post-it/atalho "fixado flutuante" (pedido explicito do usuario) vira
// uma janela que aparece por cima de TODA a tela, em qualquer rota — por
// isso mora aqui (montado uma unica vez no Layout, fora da arvore da Home)
// e usa portal direto pro body, com o mesmo z-index mais alto do app.
function FloatingWidgetCard({ widget, index, onUpdate, onUnpin, onPinSidebar, onEdit }) {
  const { t } = useTranslation();
  const cardRef = useRef(null);
  const dragControls = useDragControls();
  // Spawn longe da sidebar (240px) e do topbar — nascer em cima do menu
  // lateral bloqueava clique nos links de navegacao (achado testando a
  // funcionalidade de verdade no navegador). Widgets extras escalonam pra
  // nao nascerem exatamente empilhados um em cima do outro.
  const staggerOffset = (index % 5) * 26;
  const x = useMotionValue(widget.floatPos?.x ?? 320 + staggerOffset);
  const y = useMotionValue(widget.floatPos?.y ?? 110 + staggerOffset);
  const rotate = useMotionValue(0);
  const [size, setSize] = useState(widget.floatSize || DEFAULT_SIZE);
  const [opacity, setOpacity] = useState(widget.floatOpacity ?? 1);

  // Balanco baseado na velocidade horizontal do arrasto — pedido explicito
  // do usuario ("conforme eu mover o mouse ele balançar baseado na
  // velocidade"), como se fosse um post-it de verdade sendo puxado.
  // Clamped pra nao girar de forma exagerada em movimentos bruscos.
  function handleDrag(_event, info) {
    const target = Math.max(-18, Math.min(18, info.velocity.x / 45));
    animate(rotate, target, { duration: 0.12 });
  }

  function handleDragEnd() {
    animate(rotate, 0, { type: "spring", stiffness: 320, damping: 18 });
    const sidebarEl = document.querySelector(".stark-sidebar");
    const sidebarRect = sidebarEl?.getBoundingClientRect();
    const cardRect = cardRef.current?.getBoundingClientRect();
    if (sidebarRect && cardRect) {
      const overlaps = cardRect.left < sidebarRect.right && cardRect.right > sidebarRect.left
        && cardRect.top < sidebarRect.bottom && cardRect.bottom > sidebarRect.top;
      if (overlaps) {
        onPinSidebar();
        return;
      }
    }
    onUpdate({ floatPos: { x: x.get(), y: y.get() } });
  }

  function startResize(event) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const startSize = size;
    function onMove(moveEvent) {
      setSize({
        w: Math.max(MIN_SIZE.w, startSize.w + (moveEvent.clientX - startX)),
        h: Math.max(MIN_SIZE.h, startSize.h + (moveEvent.clientY - startY))
      });
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setSize((current) => {
        onUpdate({ floatSize: current });
        return current;
      });
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function changeOpacity(value) {
    setOpacity(value);
    onUpdate({ floatOpacity: value });
  }

  return (
    <motion.div
      ref={cardRef}
      className="stark-floating-widget"
      style={{ x, y, rotate, width: size.w, height: size.h, opacity }}
      drag
      dragListener={false}
      dragControls={dragControls}
      dragMomentum={false}
      dragElastic={0}
      onDrag={handleDrag}
      onDragEnd={handleDragEnd}
    >
      <header className="stark-floating-widget-header" onPointerDown={(event) => dragControls.start(event)} title={t("home.dragToMove")}>
        <i className="bi bi-grip-vertical" />
        <input
          type="range"
          min="0.25"
          max="1"
          step="0.05"
          value={opacity}
          onChange={(event) => changeOpacity(Number(event.target.value))}
          onPointerDown={(event) => event.stopPropagation()}
          title={t("home.opacityTitle")}
          className="stark-floating-widget-opacity"
          aria-label={t("home.opacityTitle")}
        />
        <button type="button" className="stark-floating-widget-edit" onPointerDown={(event) => event.stopPropagation()} onClick={() => onEdit(widget)} title={t("home.editTitle")}>
          <i className="bi bi-pencil" />
        </button>
        <button type="button" className="stark-floating-widget-close" onPointerDown={(event) => event.stopPropagation()} onClick={onUnpin} title={t("home.unpinTitle")}>
          <i className="bi bi-x-lg" />
        </button>
      </header>
      <div className="stark-floating-widget-body" style={widget.type === "note" ? { background: widget.color || "#fde68a" } : undefined}>
        <WidgetBody widget={widget} onEdit={onEdit} clamp={false} />
      </div>
      {/* z-index proprio: o corpo do atalho/link e um <a> que cobre a area
          inteira, e sem isso o clique no cantinho de redimensionar as vezes
          acabava abrindo o link em vez de comecar o resize (relatado pelo
          usuario testando "atalhos e links"). */}
      <span className="stark-floating-widget-resize" onMouseDown={startResize} title={t("home.resizeTitle")} />
    </motion.div>
  );
}

export function FloatingWidgetsLayer() {
  const { profile, user, demoMode } = useAuth();
  const userKey = profile?.id || user?.email || (demoMode ? "demo" : "anonymous");
  const { widgets, updateWidget } = useHomeWidgets(userKey);
  const [editingWidget, setEditingWidget] = useState(null);
  const floating = widgets.filter((widget) => widget.pinned === "float");

  function saveEdit(patch) {
    updateWidget(patch.id, patch);
    setEditingWidget(null);
  }

  if ((!floating.length && !editingWidget) || typeof document === "undefined") return null;
  return createPortal(
    <div className="stark-floating-widgets-root">
      {floating.map((widget, index) => (
        <FloatingWidgetCard
          key={widget.id}
          widget={widget}
          index={index}
          onUpdate={(patch) => updateWidget(widget.id, patch)}
          onUnpin={() => updateWidget(widget.id, { pinned: null })}
          onPinSidebar={() => updateWidget(widget.id, { pinned: "sidebar" })}
          onEdit={setEditingWidget}
        />
      ))}
      {editingWidget && (
        <WidgetModal type={editingWidget.type} initial={editingWidget} onClose={() => setEditingWidget(null)} onSave={saveEdit} />
      )}
    </div>,
    document.body
  );
}

// Pequeno bloco compacto pro Sidebar (widgets fixados "como se fosse um
// menu") — pedido explicito do usuario: mostrar icone/imagem + nome, e ao
// CLICAR executar a acao (link/atalho abrem de verdade, nota abre pra
// leitura), nao um popover generico com o card inteiro espremido.
export function SidebarPinnedWidgets({ collapsed }) {
  const { t } = useTranslation();
  const { profile, user, demoMode } = useAuth();
  const userKey = profile?.id || user?.email || (demoMode ? "demo" : "anonymous");
  const { widgets, updateWidget } = useHomeWidgets(userKey);
  const [viewingNote, setViewingNote] = useState(null);
  const [editingWidget, setEditingWidget] = useState(null);
  const pinned = widgets.filter((widget) => widget.pinned === "sidebar");

  function activate(widget) {
    if (widget.type === "note") {
      setViewingNote(widget);
      return;
    }
    window.open(widget.url, "_blank", "noopener,noreferrer");
  }

  if (!pinned.length) return null;

  return (
    <div className="stark-sidebar-pinned">
      {!collapsed && <span className="stark-sidebar-pinned-label">{t("home.pinnedInMenu")}</span>}
      {pinned.map((widget) => (
        <div key={widget.id} className="stark-sidebar-pinned-item">
          <button type="button" className="stark-nav-link stark-sidebar-pinned-trigger" onClick={() => activate(widget)} title={widget.title}>
            {widget.type === "note" ? (
              <span className="stark-sidebar-pinned-swatch" style={{ background: widget.color || "#fde68a" }}><i className="bi bi-sticky" /></span>
            ) : (
              <WidgetImage src={widget.imageUrl || faviconUrl(widget.url)} />
            )}
            <span className="stark-nav-label">{widget.title}</span>
          </button>
          {!collapsed && (
            <button type="button" className="stark-sidebar-pinned-close" onClick={() => updateWidget(widget.id, { pinned: null })} title={t("home.unpinTitle")}>
              <i className="bi bi-x" />
            </button>
          )}
        </div>
      ))}
      {viewingNote && (
        <NoteViewModal
          widget={viewingNote}
          onClose={() => setViewingNote(null)}
          onEdit={(widget) => { setViewingNote(null); setEditingWidget(widget); }}
        />
      )}
      {editingWidget && (
        <WidgetModal
          type={editingWidget.type}
          initial={editingWidget}
          onClose={() => setEditingWidget(null)}
          onSave={(patch) => { updateWidget(patch.id, patch); setEditingWidget(null); }}
        />
      )}
    </div>
  );
}
