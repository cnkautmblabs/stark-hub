import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../contexts/AuthContext.jsx";
import { useWorkItems } from "../../hooks/useWorkItems.js";
import { useCollaborators } from "../../hooks/useCollaborators.js";
import { useTestEvidence } from "../../hooks/useTestEvidence.js";
import { accessLevels } from "../../utils/constants.js";
import { buildCollaboratorNameIndex, findCollaboratorByName, normalizeResult, qaStatusInfo } from "../../utils/workbench/formatters.js";
import { readPersonalSetting } from "../../utils/personalSettings.js";
import { playNotificationSound } from "../../utils/notificationSounds.js";
import { savePendingWorkItemHighlight } from "../../utils/workbench/highlight.js";

const SEEN_KEY_PREFIX = "starkHubNotifiedWorkItems:";
const SEEN_RESULT_KEY_PREFIX = "starkHubNotifiedTestResults:";

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
  const { t } = useTranslation();
  const { profile, user, demoMode } = useAuth();
  const { items } = useWorkItems();
  const { collaborators } = useCollaborators();
  const { evidence } = useTestEvidence();
  const initializedRef = useRef(false);
  const seenKeyRef = useRef("");
  const resultInitializedRef = useRef(false);
  const resultSeenKeyRef = useRef("");

  const access = profile?.accessLevel;
  const isDev = access === accessLevels.dev;
  const isQa = access === accessLevels.qa;
  const userKey = profile?.id || user?.email || "anonymous";

  const nameIndex = buildCollaboratorNameIndex(collaborators);
  const myCollaborator = collaborators.find((person) => person.id === profile?.id)
    || findCollaboratorByName(nameIndex, profile?.displayName || profile?.fullName || user?.email);

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
      playNotificationSound("itemEnteredQaBeta", profile, user);
      fresh.slice(0, 4).forEach((item) => {
        const qaPerson = collaborators.find((person) => person.id === item.qaCollaboratorId);
        const title = isQa ? t("browserNotifications.newItemForTest") : t("browserNotifications.itemPickedUpForTest");
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
  }, [items, collaborators, isDev, isQa, demoMode, profile, user, userKey, myCollaborator, nameIndex, t]);

  // Som (e notificacao, se a permissao ja foi concedida) pro Dev quando o
  // PROPRIO item e aprovado/reprovado num teste — diferente do bloco acima
  // (que so cobre "QA pegou pra testar"), aqui o evento e o RESULTADO do
  // teste em si. Roda independente da permissao de notificacao (o som ja
  // tem o proprio controle de mudo em Configuracoes), so a notificacao
  // desktop opcional depende de permissao concedida.
  useEffect(() => {
    if (demoMode || !isDev || !myCollaborator || typeof window === "undefined") return;
    if (!evidence.length) return;

    const resultSeenKey = `${SEEN_RESULT_KEY_PREFIX}${userKey}`;
    if (resultSeenKeyRef.current !== resultSeenKey) {
      resultSeenKeyRef.current = resultSeenKey;
      resultInitializedRef.current = false;
    }

    const myItemIds = new Set(
      items
        .filter((item) => item.assigneeId === myCollaborator.id || findCollaboratorByName(nameIndex, item.assigneeName)?.id === myCollaborator.id)
        .map((item) => Number(item.id))
    );
    const myEvidence = evidence
      .filter((entry) => myItemIds.has(Number(entry.workItemId)))
      .slice()
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

    const seen = readSeenIds(resultSeenKey);
    if (!resultInitializedRef.current) {
      resultInitializedRef.current = true;
      writeSeenIds(resultSeenKey, new Set(myEvidence.map((entry) => entry.id)));
      return;
    }

    const fresh = myEvidence.filter((entry) => !seen.has(entry.id)).slice(0, 4);
    fresh.forEach((entry) => {
      const result = normalizeResult(entry.result);
      const approved = result === "pass";
      playNotificationSound(approved ? "devApproved" : "devReproved", profile, user);
      if (typeof Notification !== "undefined" && Notification.permission === "granted" && readPersonalSetting(profile, user, "browserNotificationsEnabled", false)) {
        const item = items.find((entry2) => Number(entry2.id) === Number(entry.workItemId));
        try {
          const notification = new Notification(approved ? t("browserNotifications.itemApproved") : t("browserNotifications.itemRejected"), {
            body: `#${entry.workItemId} ${item?.title || ""}`,
            tag: `stark-hub-result-${entry.id}`
          });
          notification.onclick = () => {
            window.focus();
            savePendingWorkItemHighlight(entry.workItemId);
            window.location.href = `${import.meta.env.BASE_URL}dev`;
          };
        } catch {
          // idem — falha silenciosa em navegadores sem suporte.
        }
      }
    });
    writeSeenIds(resultSeenKey, new Set(myEvidence.map((entry) => entry.id)));
  }, [evidence, items, isDev, myCollaborator, nameIndex, demoMode, profile, user, userKey, t]);

  return null;
}
