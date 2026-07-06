import { useCallback, useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabaseClient.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { mockTestEvidence } from "../utils/mockData.js";

// Histórico de evidências de teste. No modo demo, dados de exemplo fixos.
// Fora do modo demo, vem da tabela test_evidence (ver migration
// 20260703104836_azure_work_items_integration.sql) — substitui o
// comportamento do userscript legado, que escrevia isso como comentário
// nativo no work item (só possível porque ele rodava injetado na própria
// página do Azure DevOps).
export function useTestEvidence() {
  const { demoMode } = useAuth();
  const [evidence, setEvidence] = useState(demoMode ? mockTestEvidence : []);

  const load = useCallback(async () => {
    if (demoMode) {
      setEvidence(mockTestEvidence);
      return;
    }
    if (!isSupabaseConfigured) {
      setEvidence([]);
      return;
    }
    const { data, error } = await supabase
      .from("test_evidence")
      .select("id, workItemId, result, note, environment, authorId, createdAt, author:authorId(fullName, displayName)")
      .order("createdAt", { ascending: false });
    if (!error && data) setEvidence(data.map((row) => ({ ...row, authorName: row.author?.displayName || row.author?.fullName || null })));
  }, [demoMode]);

  useEffect(() => {
    load();
  }, [load]);

  return { evidence, reload: load };
}
