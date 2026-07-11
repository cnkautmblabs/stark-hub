import { useCallback, useEffect, useState } from "react";

const STORAGE_PREFIX = "starkHubHomeWidgets:";
const CHANGE_EVENT = "starkHubWidgetsChange";

function storageKey(userKey) {
  return `${STORAGE_PREFIX}${userKey || "anonymous"}`;
}

function readWidgets(userKey) {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey(userKey)) || "null");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeWidgets(userKey, widgets) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(userKey), JSON.stringify(widgets));
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { userKey } }));
}

// Fonte unica dos widgets do Painel da Home (notas/links/atalhos),
// compartilhada entre a grade normal (WorkbenchHome) e a camada flutuante
// global (FloatingWidgetsLayer, montada no Layout — precisa ler os MESMOS
// widgets fora da rota /). Mesma chave de localStorage que o codigo antigo
// usava direto (starkHubHomeWidgets:<id>), so extraida pra hook pra nao
// duplicar leitura/escrita em dois lugares e ficar fora de sincronia.
export function useHomeWidgets(userKey) {
  const [widgets, setWidgetsState] = useState(() => readWidgets(userKey));

  useEffect(() => {
    setWidgetsState(readWidgets(userKey));
  }, [userKey]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    function handleChange(event) {
      if (event.detail?.userKey !== userKey) return;
      setWidgetsState(readWidgets(userKey));
    }
    window.addEventListener(CHANGE_EVENT, handleChange);
    return () => window.removeEventListener(CHANGE_EVENT, handleChange);
  }, [userKey]);

  const setWidgets = useCallback((updater) => {
    setWidgetsState((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      // NUNCA chamar writeWidgets (dispatchEvent sincrono) daqui de dentro:
      // esta funcao roda durante a fase de render/reconciliacao do React, e
      // o listener de OUTRAS instancias do hook (Home + FloatingWidgetsLayer
      // + Sidebar, todas montadas ao mesmo tempo) chama setState de volta
      // sincronamente — vira "Cannot update a component while rendering a
      // different component" (confirmado testando a feature de verdade no
      // navegador). queueMicrotask joga a notificacao pra fora do ciclo de
      // render atual, mantendo a propagacao quase instantanea mesmo assim.
      queueMicrotask(() => writeWidgets(userKey, next));
      return next;
    });
  }, [userKey]);

  const updateWidget = useCallback((id, patch) => {
    setWidgets((current) => current.map((widget) => (widget.id === id ? { ...widget, ...(typeof patch === "function" ? patch(widget) : patch) } : widget)));
  }, [setWidgets]);

  return { widgets, setWidgets, updateWidget };
}
