import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { highlightWorkItem, savePendingWorkItemHighlight } from "../utils/workbench/highlight.js";
import { playSoundFile } from "../utils/notificationSounds.js";
import { useAuth } from "./AuthContext.jsx";
import { useTranslation } from "react-i18next";
import { SUPABASE_QUOTA_EVENT } from "../lib/supabaseClient.js";

// Notificacoes visuais leves (toast), pedidas pelo usuario pra completar os
// sons de notificacao que ja existiam (Configuracoes > Notificacoes sonoras):
// novo item detectado, item que entrou em QA/BETA. Fica num context global
// (montado uma vez em App.jsx) pra qualquer tela poder empilhar um toast,
// nao so a tela que disparou o evento.
const ToastContext = createContext(null);

let toastSeq = 0;
const HISTORY_MAX = 50;

function historyKey(userKey) {
  return `starkHubToastHistory:${userKey || "anonymous"}`;
}

function readHistory(userKey) {
  if (typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(window.localStorage.getItem(historyKey(userKey)) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writeHistory(userKey, entries) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(historyKey(userKey), JSON.stringify(entries.slice(0, HISTORY_MAX)));
  } catch {
    // Ignora falha de localStorage (quota, modo privado etc.).
  }
}

// Historico de toasts e por pessoa (cada uma ve so o proprio), guardado no
// localStorage do navegador — mesmo mecanismo de `personalSettings.js`.
export function ToastProvider({ children }) {
  const { t, i18n } = useTranslation();
  const { profile, user } = useAuth();
  const userKey = profile?.id || user?.email || "anonymous";
  const [toasts, setToasts] = useState([]);
  const [history, setHistory] = useState(() => readHistory(userKey));
  const timersRef = useRef(new Map());

  useEffect(() => {
    setHistory(readHistory(userKey));
  }, [userKey]);

  const dismissToast = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const pushToast = useCallback(({ title, body, tone = "info", durationMs = 6000, href, workItemId, route } = {}) => {
    const id = ++toastSeq;
    setToasts((current) => [...current, { id, title, body, tone, href, workItemId, route }]);
    const timer = setTimeout(() => dismissToast(id), durationMs);
    timersRef.current.set(id, timer);
    // Erro sempre soa, sem depender da preferencia por evento — nao tem um
    // tipo configuravel proprio em Configuracoes (e generico o suficiente
    // pra nao precisar de um toggle dedicado).
    if (tone === "danger") playSoundFile("error");
    setHistory((current) => {
      const next = [{ id, title, body, tone, href, workItemId, route, createdAt: new Date().toISOString(), read: false }, ...current].slice(0, HISTORY_MAX);
      writeHistory(userKey, next);
      return next;
    });
    return id;
  }, [dismissToast, userKey]);

  useEffect(() => {
    let lastShownAt = 0;
    const handleQuotaExceeded = (event) => {
      if (Date.now() - lastShownAt < 15000) return;
      lastShownAt = Date.now();
      const resetAt = event.detail?.resetAt;
      const resetDate = resetAt
        ? new Intl.DateTimeFormat(i18n.language, { dateStyle: "long" }).format(new Date(resetAt))
        : t("common.supabaseQuotaResetUnknown");
      pushToast({
        title: t("common.supabaseQuotaTitle"),
        body: t("common.supabaseQuotaBody", { date: resetDate }),
        tone: "danger",
        durationMs: 15000
      });
    };
    window.addEventListener(SUPABASE_QUOTA_EVENT, handleQuotaExceeded);
    return () => window.removeEventListener(SUPABASE_QUOTA_EVENT, handleQuotaExceeded);
  }, [i18n.language, pushToast, t]);

  const markAllRead = useCallback(() => {
    setHistory((current) => {
      if (!current.some((entry) => !entry.read)) return current;
      const next = current.map((entry) => ({ ...entry, read: true }));
      writeHistory(userKey, next);
      return next;
    });
  }, [userKey]);

  const clearHistory = useCallback(() => {
    setHistory([]);
    writeHistory(userKey, []);
  }, [userKey]);

  const unreadCount = history.filter((entry) => !entry.read).length;

  const openToast = useCallback((toast) => {
    if (toast.route && window.location.pathname !== toast.route) {
      if (toast.workItemId) savePendingWorkItemHighlight(toast.workItemId);
      window.location.href = toast.route;
      return;
    }
    if (toast.workItemId && highlightWorkItem(toast.workItemId)) {
      dismissToast(toast.id);
      return;
    }
    if (toast.href) window.open(toast.href, "_blank", "noopener,noreferrer");
    dismissToast(toast.id);
  }, [dismissToast]);

  return (
    <ToastContext.Provider value={{ pushToast, dismissToast, history, unreadCount, markAllRead, clearHistory, openToast }}>
      {children}
      <div className="mb-toast-host" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`mb-toast ${toast.tone}`}>
            <div className="mb-toast-copy">
              {toast.title && <strong>{toast.title}</strong>}
              {toast.body && <span>{toast.body}</span>}
            </div>
            <div className="mb-toast-actions">
              {(toast.href || toast.workItemId) && <button type="button" onClick={() => openToast(toast)}>Ver</button>}
              <button type="button" onClick={() => dismissToast(toast.id)} aria-label="Fechar"><i className="bi bi-x" /></button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  // Fora do provider (ex.: testes isolados) vira no-op em vez de quebrar a tela.
  if (!context) {
    return {
      pushToast: () => null,
      dismissToast: () => {},
      history: [],
      unreadCount: 0,
      markAllRead: () => {},
      clearHistory: () => {},
      openToast: () => {}
    };
  }
  return context;
}
