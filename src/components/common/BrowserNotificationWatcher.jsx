import { useEffect, useRef } from "react";
import { useAuth } from "../../contexts/AuthContext.jsx";
import { useWorkItems } from "../../hooks/useWorkItems.js";
import { useCollaborators } from "../../hooks/useCollaborators.js";
import { accessLevels } from "../../utils/constants.js";
import { buildCollaboratorNameIndex, findCollaboratorByName, qaStatusInfo } from "../../utils/workbench/formatters.js";
import { readPersonalSetting } from "../../utils/personalSettings.js";
import { savePendingWorkItemHighlight } from "../../utils/workbench/highlight.js";

const SEEN_KEY_PREFIX = "starkHubNotifiedWorkItems:";

function readSeenIds(key) {
  try {
    return new Set(JSON.parse(window.sessionStorage.getItem(key) || "[]"));
  } catch {
    return new Set();
  }
}

function writeSeenIds(key, ids) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(Array.from(ids)));
  } catch {
    // Ignora falha de sessionStorage (modo privado, quota etc.).
  }
}

// Notificacao do sistema operacional (Notification API) montada uma unica
// vez em Layout.jsx, entao continua observando work items relevantes
// independente da tela em que a pessoa esteja. Mesma regra de relevancia por
// papel ja usada no feed "Atualizacoes recentes" da Home: Dev ve quando um
// QA pega um item seu para teste; QA ve itens (de qualquer dev) que entram
// em In QA/In BETA/Ready Beta/HMG CNK/Ready Prod.
export function BrowserNotificationWatcher() {
  const { profile, user, demoMode } = useAuth();
  const { items } = useWorkItems();
  const { collaborators } = useCollaborators();
  const initializedRef = useRef(false);
  const seenKeyRef = useRef("");

  const access = profile?.accessLevel;
  const isDev = access === accessLevels.dev;
  const isQa = access === accessLevels.qa;
  const userKey = profile?.id || user?.email || "anonymous";

  useEffect(() => {
    if (demoMode || typeof window === "undefined" || typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;
    if (!readPersonalSetting(profile, user, "browserNotificationsEnabled", false)) return;
    if (!isDev && !isQa) return;
    if (!items.length) return;

    const seenKey = `${SEEN_KEY_PREFIX}${userKey}`;
    // Trocou de usuario/conta desde a ultima checagem — reseta o "ja visto"
    // pra nao herdar o estado de outra pessoa nem pular a inicializacao.
    if (seenKeyRef.current !== seenKey) {
      seenKeyRef.current = seenKey;
      initializedRef.current = false;
    }

    const nameIndex = buildCollaboratorNameIndex(collaborators);
    const myCollaborator = collaborators.find((person) => person.id === profile?.id)
      || findCollaboratorByName(nameIndex, profile?.displayName || profile?.fullName || user?.email);

    let relevant = [];
    if (isQa) {
      relevant = items.filter((item) => Boolean(qaStatusInfo(item.state).key));
    } else if (isDev && myCollaborator) {
      relevant = items.filter((item) => {
        const isMine = item.assigneeId === myCollaborator.id || findCollaboratorByName(nameIndex, item.assigneeName)?.id === myCollaborator.id;
        return isMine && item.qaCollaboratorId && Boolean(qaStatusInfo(item.state).key);
      });
    }

    const seen = readSeenIds(seenKey);
    // Primeira checagem da sessao: so registra o que ja existe, sem
    // notificar — senao todo item relevante ja existente vira uma
    // notificacao de uma vez so, so por causa do carregamento inicial.
    if (!initializedRef.current) {
      initializedRef.current = true;
      writeSeenIds(seenKey, new Set(relevant.map((item) => item.id)));
      return;
    }

    const fresh = relevant.filter((item) => !seen.has(item.id));
    if (fresh.length) {
      fresh.slice(0, 4).forEach((item) => {
        const qaPerson = collaborators.find((person) => person.id === item.qaCollaboratorId);
        const title = isQa ? "Novo item disponivel para teste" : "Seu item foi pego para teste";
        const body = isQa
          ? `#${item.id} ${item.title || ""} · ${qaStatusInfo(item.state).label || item.state}`
          : `#${item.id} ${item.title || ""} · ${qaPerson?.azureName || "QA"}`;
        try {
          const notification = new Notification(title, { body, tag: `stark-hub-item-${item.id}` });
          notification.onclick = () => {
            window.focus();
            savePendingWorkItemHighlight(item.id);
            window.location.href = `${import.meta.env.BASE_URL}${isQa ? "qa" : "dev"}`;
          };
        } catch {
          // Alguns navegadores mobile nao suportam `new Notification()` fora
          // de um Service Worker — falha silenciosa, sem quebrar o app.
        }
      });
    }
    writeSeenIds(seenKey, new Set(relevant.map((item) => item.id)));
  }, [items, collaborators, isDev, isQa, demoMode, profile, user, userKey]);

  return null;
}
