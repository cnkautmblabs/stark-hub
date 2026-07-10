import { useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useToast } from "../../contexts/ToastContext.jsx";

// Sino de notificacoes no topbar: abre um historico dos toasts ja exibidos
// (o toast em si some sozinho depois de alguns segundos, sem deixar rastro).
// Pedido do usuario: ver notificacoes passadas e poder limpar o historico.
export function NotificationBell() {
  const { t } = useTranslation();
  const { history, unreadCount, markAllRead, clearHistory, openToast } = useToast();
  const [open, setOpen] = useState(false);

  function togglePanel() {
    setOpen((current) => {
      const next = !current;
      if (next) markAllRead();
      return next;
    });
  }

  return (
    <div className="stark-bell-wrap">
      <button type="button" className="stark-bell-trigger" onClick={togglePanel} aria-label={t("notificationHistory.title")} aria-expanded={open}>
        <i className="bi bi-bell" />
        {unreadCount > 0 && <span className="stark-bell-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
      </button>
      {open && createPortal(
        <>
          <div className="stark-bell-backdrop" onClick={() => setOpen(false)} />
          <aside className="stark-bell-panel">
            <header className="stark-bell-panel-header">
              <strong>{t("notificationHistory.title")}</strong>
              <button type="button" onClick={() => setOpen(false)} aria-label={t("common.close")}><i className="bi bi-x" /></button>
            </header>
            <div className="stark-bell-panel-actions">
              <button type="button" onClick={clearHistory} disabled={!history.length}>
                <i className="bi bi-trash3" /> {t("notificationHistory.clear")}
              </button>
            </div>
            <div className="stark-bell-panel-list">
              {history.length ? history.map((entry) => (
                <button
                  type="button"
                  key={entry.id}
                  className={`stark-bell-entry ${entry.tone || "info"}`}
                  onClick={() => { openToast(entry); setOpen(false); }}
                >
                  {entry.title && <strong>{entry.title}</strong>}
                  {entry.body && <span>{entry.body}</span>}
                  <small>{new Date(entry.createdAt).toLocaleString()}</small>
                </button>
              )) : <p className="stark-bell-empty">{t("notificationHistory.empty")}</p>}
            </div>
          </aside>
        </>,
        document.body
      )}
    </div>
  );
}
