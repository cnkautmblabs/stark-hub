import { useCallback, useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabaseClient.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { useAppSettings } from "./useAppSettings.js";
import { useCollaborators } from "./useCollaborators.js";
import { useFeatureFlags } from "../contexts/FeatureFlagsContext.jsx";
import { resolveSlackWebhooks, buildReadyForBetaMessage } from "../utils/slack.js";
import { getDemoWorkItems, updateDemoWorkItem, addDemoWorkItem } from "../utils/demoStore.js";

// Fonte de work items do painel. No modo demo, vem do localStorage (editável
// localmente). Fora do modo demo, vem de verdade do Azure DevOps (WIQL +
// workitemsbatch via Edge Function azureWorkItems), cruzado com o
// responsável de QA (work_item_assignments) e o resultado de teste
// (test_evidence) guardados no Supabase — ver supabase/functions/azureWorkItems.
export function useWorkItems() {
  const { demoMode, profile } = useAuth();
  const { getSetting } = useAppSettings();
  const { collaborators } = useCollaborators();
  const { isEnabled } = useFeatureFlags();
  const [items, setItems] = useState(() => (demoMode ? getDemoWorkItems() : []));
  const [loading, setLoading] = useState(!demoMode);
  const [error, setError] = useState(null);

  const azureReady = Boolean(profile?.azureOrgUrl && profile?.azureProject && profile?.azurePat);
  const iterationPattern = getSetting("azureIterationPattern", "");
  const customQuery = getSetting("azureCustomQuery", "");
  const maxItems = getSetting("azureMaxItems", 200);
  const autoRefreshSeconds = getSetting("azureAutoRefreshSeconds", 60);

  const loadItems = useCallback(async () => {
    if (demoMode) {
      setItems(getDemoWorkItems());
      setLoading(false);
      setError(null);
      return;
    }
    if (!isSupabaseConfigured || !azureReady) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: invokeError } = await supabase.functions.invoke("azureWorkItems", {
      body: {
        orgUrl: profile.azureOrgUrl,
        project: profile.azureProject,
        team: profile.azureTeam,
        iterationPattern,
        customQuery,
        maxItems,
        pat: profile.azurePat
      }
    });
    // Uma falha aqui NUNCA pode virar silenciosamente "lista vazia" — foi
    // exatamente esse silêncio que escondeu o vazamento de dados de outro
    // time (Lenio Labs) sem avisar ninguém.
    if (invokeError || !data?.ok) {
      setItems([]);
      setError(data?.error || invokeError?.message || "Falha ao consultar o Azure DevOps.");
    } else {
      setItems(data.items);
    }
    setLoading(false);
  }, [demoMode, azureReady, profile?.azureOrgUrl, profile?.azureProject, profile?.azureTeam, profile?.azurePat, iterationPattern, customQuery, maxItems]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  // Auto-atualização periódica — mesmo comportamento do "Intervalo de
  // atualização automática" do userscript legado (refreshIntervalSeconds),
  // configurável em Configurações > Consulta Azure DevOps. 0 desativa.
  useEffect(() => {
    if (demoMode || !azureReady || !autoRefreshSeconds) return;
    const id = setInterval(loadItems, autoRefreshSeconds * 1000);
    return () => clearInterval(id);
  }, [demoMode, azureReady, autoRefreshSeconds, loadItems]);

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
      setItems((current) => current.map((i) => (i.id === id ? { ...i, qaCollaboratorId: patch.qaCollaboratorId } : i)));
      return;
    }

    // Resultado de teste: também não é um campo do Azure DevOps, vira uma
    // nova linha de evidência no Stark Hub. O ambiente gravado é o ambiente
    // vigente do item (item.env) no momento do registro, para permitir
    // reconstruir depois em qual ambiente cada resultado foi obtido —
    // mesma distinção que o userscript legado fazia por comentário (QA/BETA).
    if ("lastTestResult" in patch) {
      if (patch.lastTestResult) {
        await supabase.from("test_evidence").insert({
          workItemId: id,
          result: patch.lastTestResult,
          environment: item.env,
          note: patch.note || null,
          authorId: profile.id
        });
      }
      setItems((current) => current.map((i) => (i.id === id ? { ...i, lastTestResult: patch.lastTestResult } : i)));
      return;
    }

    // Horas/avanço de ambiente: grava de verdade no Azure DevOps.
    const { data, error } = await supabase.functions.invoke("azureWorkItemAction", {
      body: {
        action: "update",
        orgUrl: profile.azureOrgUrl,
        project: profile.azureProject,
        pat: profile.azurePat,
        updates: [{ id, completedHours: patch.completedHours ?? item.completedHours, state: patch.state }]
      }
    });
    if (!error && data?.ok) {
      setItems((current) => current.map((i) => (i.id === id ? { ...i, ...patch } : i)));

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

  return { items, loading, error, updateItem, addItem, reload: loadItems, needsAzureIntegration: !demoMode && !azureReady };
}
