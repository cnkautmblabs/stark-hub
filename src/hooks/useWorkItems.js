import { useCallback, useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabaseClient.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { getDemoWorkItems, updateDemoWorkItem, addDemoWorkItem } from "../utils/demoStore.js";

// Fonte de work items do painel. No modo demo, vem do localStorage (editável
// localmente). Fora do modo demo, vem de verdade do Azure DevOps (WIQL +
// workitemsbatch via Edge Function azureWorkItems), cruzado com o
// responsável de QA (work_item_assignments) e o resultado de teste
// (test_evidence) guardados no Supabase — ver supabase/functions/azureWorkItems.
export function useWorkItems() {
  const { demoMode, profile } = useAuth();
  const [items, setItems] = useState(() => (demoMode ? getDemoWorkItems() : []));
  const [loading, setLoading] = useState(!demoMode);

  const azureReady = Boolean(profile?.azureOrgUrl && profile?.azureProject && profile?.azurePat);

  const loadItems = useCallback(async () => {
    if (demoMode) {
      setItems(getDemoWorkItems());
      setLoading(false);
      return;
    }
    if (!isSupabaseConfigured || !azureReady) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("azureWorkItems", {
      body: { orgUrl: profile.azureOrgUrl, project: profile.azureProject, pat: profile.azurePat }
    });
    setItems(!error && data?.ok ? data.items : []);
    setLoading(false);
  }, [demoMode, azureReady, profile?.azureOrgUrl, profile?.azureProject, profile?.azurePat]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

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
    // nova linha de evidência no Stark Hub.
    if ("lastTestResult" in patch) {
      if (patch.lastTestResult) {
        await supabase.from("test_evidence").insert({ workItemId: id, result: patch.lastTestResult, authorId: profile.id });
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

  return { items, loading, updateItem, addItem, reload: loadItems, needsAzureIntegration: !demoMode && !azureReady };
}
