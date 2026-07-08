import React, { createContext, useCallback, useContext, useRef, useState } from "react";

// Notificacoes visuais leves (toast), pedidas pelo usuario pra completar os
// sons de notificacao que ja existiam (Configuracoes > Notificacoes sonoras):
// novo item detectado, item que entrou em QA/BETA. Fica num context global
// (montado uma vez em App.jsx) pra qualquer tela poder empilhar um toast,
// nao so a tela que disparou o evento.
const ToastContext = createContext(null);

let toastSeq = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef(new Map());

  const dismissToast = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const pushToast = useCallback(({ title, body, tone = "info", durationMs = 6000, href } = {}) => {
    const id = ++toastSeq;
    setToasts((current) => [...current, { id, title, body, tone, href }]);
    const timer = setTimeout(() => dismissToast(id), durationMs);
    timersRef.current.set(id, timer);
    return id;
  }, [dismissToast]);

  return (
    <ToastContext.Provider value={{ pushToast, dismissToast }}>
      {children}
      <div className="mb-toast-host" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`mb-toast ${toast.tone}`}>
            <div className="mb-toast-copy">
              {toast.title && <strong>{toast.title}</strong>}
              {toast.body && <span>{toast.body}</span>}
            </div>
            <div className="mb-toast-actions">
              {toast.href && <a href={toast.href} target="_blank" rel="noopener noreferrer">Abrir</a>}
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
  if (!context) return { pushToast: () => null, dismissToast: () => {} };
  return context;
}
