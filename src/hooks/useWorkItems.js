import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabaseClient.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { useAppSettings } from "./useAppSettings.js";
import { useCollaborators } from "./useCollaborators.js";
import { useFeatureFlags } from "../contexts/FeatureFlagsContext.jsx";
import { useToast } from "../contexts/ToastContext.jsx";
import { resolveSlackWebhooks, buildReadyForBetaMessage } from "../utils/slack.js";
import { buildLegacyQaResultSlackText, buildQaResultDiscussionHtml } from "../utils/slackReport.js";
import { getDemoWorkItems, updateDemoWorkItem, addDemoWorkItem } from "../utils/demoStore.js";
import { playNotificationSound } from "../utils/notificationSounds.js";
import { azureWorkItemUrl } from "../utils/azure.js";
import { buildApiCacheKey, readApiCache, stableSignature, withInflight, writeApiCache } from "../utils/localApiCache.js";
import { buildCollaboratorNameIndex, findCollaboratorByName } from "../utils/workbench/formatters.js";

const MAX_TOASTS_PER_GROUP = 4;
const WORK_ITEMS_CACHE_TTL_MS = 60 * 1000;

// Compara o estado anterior (por id) com a lista fresca e dispara toast +
// som pros 3 eventos que o usuario pediu: item novo no board, item que
// entrou em QA, item que entrou em BETA. So roda a partir da SEGUNDA carga
// bem-sucedida (previousStateById != null) — na primeira carga tudo "e
// novo", o que so criaria uma enxurrada de toasts sem sentido.
function notifyTransitions({ previousStateById, previousUpdatedById, freshItems, pushToast, profile, user }) {
  if (!previousStateById) return;
  const newItems = [];
  const enteredQa = [];
  const enteredBeta = [];
  const updatedItems = [];
  freshItems.forEach((item) => {
    const state = String(item.state || "").toLowerCase();
    const prevState = previousStateById.get(item.id);
    if (prevState === undefined) {
      newItems.push(item);
      return;
    }
    const updatedAt = String(item.updatedAt || item.changedDate || item.changedAt || "");
    const prevUpdatedAt = previousUpdatedById?.get(item.id);
    if (updatedAt && prevUpdatedAt && updatedAt !== prevUpdatedAt) updatedItems.push(item);
    if (prevState === state) return;
    if (state.includes("qa") && !prevState.includes("qa")) enteredQa.push(item);
    if (state.includes("beta") && !prevState.includes("beta")) enteredBeta.push(item);
  });

  function notifyGroup(list, { type, title, tone }) {
    if (!list.length) return;
    const shown = list.slice(0, MAX_TOASTS_PER_GROUP);
    shown.forEach((item) => {
      pushToast({
        title,
        body: `${item.id} - ${item.title || "Sem titulo"}`,
        tone,
        href: item.url || azureWorkItemUrl(profile?.azureOrgUrl, profile?.azureProject, item.id),
        workItemId: item.id,
        route: `${import.meta.env.BASE_URL}qa`
      });
    });
    if (list.length > shown.length) pushToast({ title, body: `+${list.length - shown.length} outro(s) item(ns)`, tone });
    playNotificationSound(type, profile, user);
  }

  notifyGroup(newItems, { type: "newItem", title: "Novo item no board", tone: "info" });
  notifyGroup(updatedItems.filter((item) => !newItems.includes(item)).slice(0, 3), { type: "updatedItem", title: "Work item atualizado", tone: "info" });
  notifyGroup(enteredQa, { type: "itemEnteredQaBeta", title: "Item entrou em QA", tone: "warning" });
  notifyGroup(enteredBeta, { type: "itemEnteredQaBeta", title: "Item entrou em BETA", tone: "success" });
}

// Fiel ao userscript legado: sem member ID real do Slack nao existe fallback
// por nome (a mencao simplesmente nao aparece na mensagem).
function mentionNameForSlack(person) {
  if (!person) return "";
  const memberId = person.slackMemberId || person.slackId;
  return memberId ? `<@${String(memberId).replace(/[<@>]/g, "")}>` : "";
}

// Fonte de work items do painel. No modo demo, vem do localStorage (editável
// localmente). Fora do modo demo, vem de verdade do Azure DevOps (WIQL +
// workitemsbatch via Edge Function azureWorkItems), cruzado com o
// responsável de QA (work_item_assignments) e o resultado de teste
// (test_evidence) guardados no Supabase — ver supabase/functions/azureWorkItems.
// `includeClosed`: usado pelo Dashboard de Gerenciamento, que precisa de
// entregas historicas (Feature/Bug/US ja Closed) para calcular taxa de
// entrega e series por sprint — o filtro padrao do resto do app exclui
// Closed/Removed de proposito (foco no trabalho ativo), entao aqui a
// consulta ignora o customQuery global e busca todos os estados.
export function useWorkItems({ includeClosed = false } = {}) {
  const { demoMode, profile, user } = useAuth();
  const { getSetting } = useAppSettings();
  const { collaborators } = useCollaborators();
  const { isEnabled } = useFeatureFlags();
  const { pushToast } = useToast();
  const azureReady = Boolean(profile?.azureOrgUrl && profile?.azureProject && profile?.azurePat);
  const iterationPattern = getSetting("azureIterationPattern", "");
  const customQuery = includeClosed
    ? "[System.WorkItemType] IN ('Bug','Task','User Story','Feature')"
    : getSetting("azureCustomQuery", "");
  const maxItems = includeClosed ? Math.max(getSetting("azureMaxItems", 200), 800) : getSetting("azureMaxItems", 200);
  const autoRefreshSeconds = getSetting("azureAutoRefreshSeconds", 60);
  const cacheKey = buildApiCacheKey(
    "workItems",
    profile?.id || user?.email || "anonymous",
    profile?.azureOrgUrl,
    profile?.azureProject,
    profile?.azureTeam,
    includeClosed ? "closed" : "active",
    iterationPattern,
    customQuery,
    maxItems
  );
  const initialCache = !demoMode ? readApiCache(cacheKey, WORK_ITEMS_CACHE_TTL_MS) : null;
  const [items, setItems] = useState(() => (demoMode ? getDemoWorkItems() : initialCache?.data || []));
  const [loading, setLoading] = useState(!demoMode && !initialCache?.data);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  // So a PRIMEIRA carga mostra skeleton de tela cheia. Atualizacoes depois
  // disso (manual ou automatica a cada `azureAutoRefreshSeconds`) mantem a
  // ultima lista boa visivel e so acendem `refreshing` — sem isso, cada
  // auto-refresh trocava o board inteiro por skeleton por alguns segundos,
  // mesmo quando quase nada mudou.
  const hasLoadedRef = useRef(Boolean(initialCache?.data));
  // Estado (por id) da carga anterior, pra detectar item novo/entrou em QA
  // ou BETA entre uma atualizacao e outra. So o feed padrao notifica — a
  // busca ampla do Dash executivo (includeClosed) e historica/multi-sprint,
  // notificar a cada refresh dela seria ruido, nao sinal.
  const previousStateByIdRef = useRef(null);
  const previousUpdatedByIdRef = useRef(null);

  const persistItems = useCallback((nextItems) => {
    writeApiCache(cacheKey, nextItems);
  }, [cacheKey]);

  const loadItems = useCallback(async ({ force = false } = {}) => {
    if (demoMode) {
      setItems(getDemoWorkItems());
      setLoading(false);
      setError(null);
      hasLoadedRef.current = true;
      return;
    }
    if (!isSupabaseConfigured || !azureReady) {
      setItems([]);
      setLoading(false);
      hasLoadedRef.current = true;
      return;
    }
    const cached = readApiCache(cacheKey, WORK_ITEMS_CACHE_TTL_MS);
    if (cached?.data?.length || cached?.data) {
      if (!hasLoadedRef.current) setItems(cached.data);
      if (!includeClosed && Array.isArray(cached.data) && !previousStateByIdRef.current) {
        previousStateByIdRef.current = new Map(cached.data.map((item) => [item.id, String(item.state || "").toLowerCase()]));
        previousUpdatedByIdRef.current = new Map(cached.data.map((item) => [item.id, String(item.updatedAt || item.changedDate || item.changedAt || "")]));
      }
      hasLoadedRef.current = true;
      setLoading(false);
      if (!force && cached.fresh) return;
    }
    if (hasLoadedRef.current) setRefreshing(true);
    else setLoading(true);
    setError(null);
    let data = null;
    let invokeError = null;
    try {
      const timeoutPromise = new Promise((_, reject) => {
        window.setTimeout(() => reject(new Error("Tempo limite ao consultar o Azure DevOps. Tente atualizar novamente.")), 45000);
      });
      ({ data, error: invokeError } = await withInflight(cacheKey, () => Promise.race([
        supabase.functions.invoke("azureWorkItems", {
          body: {
            orgUrl: profile.azureOrgUrl,
            project: profile.azureProject,
            team: profile.azureTeam,
            iterationPattern,
            customQuery,
            maxItems,
            includeClosed,
            pat: profile.azurePat
          }
        }),
        timeoutPromise
      ])));
    } catch (err) {
      invokeError = err;
    }
    // Uma falha aqui NUNCA pode virar silenciosamente "lista vazia" — foi
    // exatamente esse silêncio que escondeu o vazamento de dados de outro
    // time (Lenio Labs) sem avisar ninguém. Isso vale pra PRIMEIRA carga
    // (nao ha nada bom pra preservar); numa atualizacao que ja tinha uma
    // lista boa, uma falha pontual (rede instavel) mantem a ultima lista
    // boa visivel — apagar tudo so pioraria, parecendo "sem itens".
    if (invokeError || !data?.ok) {
      if (!hasLoadedRef.current) setItems([]);
      setError(data?.error || invokeError?.message || "Falha ao consultar o Azure DevOps.");
    } else {
      if (!includeClosed) {
        notifyTransitions({ previousStateById: previousStateByIdRef.current, previousUpdatedById: previousUpdatedByIdRef.current, freshItems: data.items, pushToast, profile, user });
        previousStateByIdRef.current = new Map(data.items.map((item) => [item.id, String(item.state || "").toLowerCase()]));
        previousUpdatedByIdRef.current = new Map(data.items.map((item) => [item.id, String(item.updatedAt || item.changedDate || item.changedAt || "")]));
      }
      const nextItems = data.items || [];
      const nextSignature = stableSignature(nextItems);
      if (nextSignature !== cached?.signature) {
        setItems(nextItems);
        writeApiCache(cacheKey, nextItems, nextSignature);
      } else {
        writeApiCache(cacheKey, cached.data, cached.signature);
      }
    }
    hasLoadedRef.current = true;
    setLoading(false);
    setRefreshing(false);
  }, [demoMode, azureReady, profile?.azureOrgUrl, profile?.azureProject, profile?.azureTeam, profile?.azurePat, iterationPattern, customQuery, maxItems, includeClosed, pushToast, cacheKey, user]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  // Auto-atualização periódica — mesmo comportamento do "Intervalo de
  // atualização automática" do userscript legado (refreshIntervalSeconds),
  // configurável em Configurações > Consulta Azure DevOps. 0 desativa.
  useEffect(() => {
    if (demoMode || !azureReady || !autoRefreshSeconds) return;
    const id = setInterval(() => loadItems({ force: true }), autoRefreshSeconds * 1000);
    return () => clearInterval(id);
  }, [demoMode, azureReady, autoRefreshSeconds, loadItems]);

  useEffect(() => {
    if (demoMode || !azureReady) return undefined;
    let lastRefresh = 0;
    function refreshIfVisible() {
      if (document.visibilityState === "hidden") return;
      const current = Date.now();
      if (current - lastRefresh < 30000) return;
      lastRefresh = current;
      loadItems({ force: true });
    }
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [demoMode, azureReady, loadItems]);

  async function updateItem(id, patch) {
    if (demoMode) {
      setItems(updateDemoWorkItem(id, patch));
      return;
    }
    if (!azureReady) return;
    const item = items.find((i) => i.id === id);
    if (!item) return;

    // Responsável de QA: associação vive só no Stark Hub (work_item_assignments),
    // guarda o estado atual do item para permitir o auto-reset ao mudar de estado.
    if ("qaCollaboratorId" in patch) {
      await supabase.from("work_item_assignments").upsert({
        workItemId: id,
        qaCollaboratorId: patch.qaCollaboratorId,
        lastKnownState: item.state,
        updatedAt: new Date().toISOString()
      });
      setItems((current) => {
        const next = current.map((i) => (i.id === id ? { ...i, qaCollaboratorId: patch.qaCollaboratorId } : i));
        persistItems(next);
        return next;
      });
      return;
    }

    // Resultado de teste: também não é um campo do Azure DevOps, vira uma
    // nova linha de evidência no Stark Hub. O ambiente gravado é o ambiente
    // vigente do item (item.env) no momento do registro, para permitir
    // reconstruir depois em qual ambiente cada resultado foi obtido —
    // mesma distinção que o userscript legado fazia por comentário (QA/BETA).
    if ("lastTestResult" in patch) {
      const resultLabel = patch.lastTestResult === "pass" ? "Approved" : patch.lastTestResult === "fail" ? "Fail" : patch.lastTestResult === "limitation" ? "Limitation" : patch.lastTestResult;
      const environments = Array.isArray(patch.environments) && patch.environments.length ? patch.environments : [String(item.env || "QA").toUpperCase()];
      const testedCountries = Array.isArray(patch.countries) ? patch.countries : [];
      const rawAttachments = Array.isArray(patch.attachments) ? patch.attachments.filter(Boolean) : [];
      const breakpoints = Array.isArray(patch.breakpoints) ? patch.breakpoints : [];
      const attachmentUrls = [];
      for (const attachment of rawAttachments) {
        if (typeof attachment === "string") {
          attachmentUrls.push(attachment);
          continue;
        }
        if (!attachment?.dataUrl) continue;
        const { data } = await supabase.functions.invoke("azureWorkItemAction", {
          body: {
            action: "attachment",
            orgUrl: profile.azureOrgUrl,
            project: profile.azureProject,
            pat: profile.azurePat,
            fileName: attachment.name || `evidence-${id}.png`,
            contentType: attachment.type || "image/png",
            dataUrl: attachment.dataUrl
          }
        });
        if (data?.ok && data.url) attachmentUrls.push(data.url);
      }
      // Dois tipos de FYI fixo: sempre (fixedMention) e so quando o
      // resultado e Fail/Limitation (fixedMentionOnFailure) — pedido
      // explicito do usuario pra avisar certas pessoas so quando algo da
      // errado, sem poluir o FYI de resultados Approved.
      const isFailureResult = patch.lastTestResult === "fail" || patch.lastTestResult === "limitation";
      const fyiPeople = collaborators.filter((person) => {
        if (person.fixedMention || person.isFyiFixed || person.fyiFixed || person.fixedFyi) return true;
        if (isFailureResult && person.fixedMentionOnFailure) return true;
        return false;
      });
      // Nome exato so bate quando o Azure exibe o assignee EXATAMENTE igual
      // ao azureName cadastrado — indice por nome cobre aliases/slackName/
      // variacoes de ordem, pra nao perder o assignee (e a mencao dele no
      // FYI) so por uma diferenca de formatacao do nome.
      const collaboratorNameIndex = buildCollaboratorNameIndex(collaborators);
      const assignee = collaborators.find((c) => c.id === item.assigneeId)
        || findCollaboratorByName(collaboratorNameIndex, item.assigneeName)
        || { azureName: item.assigneeName || item.assignedTo };
      const qaResponsible = collaborators.find((c) => c.id === item.qaCollaboratorId);
      const context = patch.context || patch.note || "";
      const commentText = patch.discussionText || buildQaResultDiscussionHtml({
        resultKey: patch.lastTestResult,
        environments,
        countries: testedCountries,
        breakpoints,
        context,
        attachments: attachmentUrls
      });
      if (patch.lastTestResult) {
        await supabase.from("test_evidence").insert(environments.map((environment) => ({
          workItemId: id,
          result: patch.lastTestResult,
          environment,
          note: context || null,
          authorId: profile.id
        })));
      }
      if (!demoMode && azureReady && commentText) {
        await supabase.functions.invoke("azureWorkItemAction", {
          body: {
            action: "comment",
            orgUrl: profile.azureOrgUrl,
            project: profile.azureProject,
            pat: profile.azurePat,
            id,
            text: commentText
          }
        });
      }
      if (!demoMode && azureReady && patch.state) {
        await supabase.functions.invoke("azureWorkItemAction", {
          body: {
            action: "update",
            orgUrl: profile.azureOrgUrl,
            project: profile.azureProject,
            pat: profile.azurePat,
            updates: [{ id, state: patch.state }]
          }
        });
      }
      if (!demoMode && patch.notifySlack !== false) {
        const webhooks = resolveSlackWebhooks(getSetting);
        // "Tested by" mostra o QA Responsavel cadastrado no Work Item (Stark
        // Hub), nao quem esta logado registrando o resultado — pedido
        // explicito do usuario, ja que quem clica em "Registrar resultado"
        // pode nao ser o QA oficialmente responsavel pelo item.
        const text = buildLegacyQaResultSlackText({
          item,
          resultKey: patch.lastTestResult,
          resultLabel,
          environments,
          countries: testedCountries,
          authorName: mentionNameForSlack(qaResponsible),
          assignee,
          fyi: fyiPeople
        });
        webhooks.forEach((webhookUrl) => {
          supabase.functions.invoke("slackNotify", { body: { webhooks: [webhookUrl], text } }).catch(() => {});
        });
      }
      const nextPatch = { lastTestResult: patch.lastTestResult, ...(patch.state ? { state: patch.state } : {}) };
      setItems((current) => {
        const next = current.map((i) => (i.id === id ? { ...i, ...nextPatch } : i));
        persistItems(next);
        return next;
      });
      if (patch.lastTestResult === "pass" && patch.state && /beta/i.test(patch.state) && isEnabled("enableReadyBetaNotifications")) {
        const webhooks = resolveSlackWebhooks(getSetting);
        if (webhooks.length) {
          const assignee = collaborators.find((c) => c.id === item.assigneeId);
          const text = buildReadyForBetaMessage({ ...item, ...nextPatch }, assignee);
          supabase.functions.invoke("slackNotify", { body: { webhooks, text } }).catch(() => {});
        }
        playNotificationSound("itemEnteredQaBeta", profile, user);
      }
      if (patch.lastTestResult) playNotificationSound(patch.lastTestResult === "pass" ? "testApproved" : "testFailed", profile, user);
      return;
    }

    // Horas/avanço de ambiente: grava de verdade no Azure DevOps.
    const azureUpdate = { id };
    if ("completedHours" in patch) azureUpdate.completedHours = patch.completedHours;
    if (patch.state) azureUpdate.state = patch.state;
    if (patch.assigneeAlias) azureUpdate.assigneeAlias = patch.assigneeAlias;
    if (patch.assigneeName) azureUpdate.assigneeName = patch.assigneeName;
    const { data, error } = await supabase.functions.invoke("azureWorkItemAction", {
      body: {
        action: "update",
        orgUrl: profile.azureOrgUrl,
        project: profile.azureProject,
        pat: profile.azurePat,
        updates: [azureUpdate]
      }
    });
    if (!error && data?.ok) {
      setItems((current) => {
        const next = current.map((i) => (i.id === id ? { ...i, ...patch } : i));
        persistItems(next);
        return next;
      });

      // Notificação no Slack quando o item entra em BETA — equivalente ao
      // "Envio para o Slack" do userscript legado. Só dispara se a
      // funcionalidade estiver ligada (Configurações > Funcionalidades) e
      // houver ao menos um webhook configurado (Configurações > Slack).
      if (patch.env === "beta" && isEnabled("enableReadyBetaNotifications")) {
        const webhooks = resolveSlackWebhooks(getSetting);
        if (webhooks.length) {
          const assignee = collaborators.find((c) => c.id === item.assigneeId);
          const text = buildReadyForBetaMessage({ ...item, ...patch }, assignee);
          supabase.functions.invoke("slackNotify", { body: { webhooks, text } }).catch(() => {});
        }
        playNotificationSound("itemEnteredQaBeta", profile, user);
      }
    }
  }

  async function addItem(newItem) {
    if (demoMode) {
      setItems(addDemoWorkItem(newItem));
      return;
    }
    if (!azureReady) return;
    const { data, error } = await supabase.functions.invoke("azureWorkItemAction", {
      body: {
        action: "create",
        orgUrl: profile.azureOrgUrl,
        project: profile.azureProject,
        pat: profile.azurePat,
        item: newItem
      }
    });
    if (!error && data?.ok) await loadItems();
  }

  return { items, loading, refreshing, error, updateItem, addItem, reload: () => loadItems({ force: true }), needsAzureIntegration: !demoMode && !azureReady };
}
