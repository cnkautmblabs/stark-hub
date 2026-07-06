import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabaseClient.js";
import { useAuth } from "../contexts/AuthContext.jsx";

// Ambiente confirmado por Pipeline (QA/BETA) para cada work item —
// equivalente ao badge "mbaz-pr-env-pill" do userscript legado, mas via
// Edge Function azurePipelineStatus (precisa do PAT com escopo Build: Read
// e das pipelines configuradas em Configurações > Pipelines).
export function usePipelineStatus(workItemIds, pipelineNames) {
  const { demoMode, profile } = useAuth();
  const [byWorkItemId, setByWorkItemId] = useState({});
  const [loading, setLoading] = useState(false);

  const azureReady = Boolean(profile?.azureOrgUrl && profile?.azureProject && profile?.azurePat);
  const hasPipelines = Boolean(pipelineNames?.qa || pipelineNames?.beta);
  const idsKey = [...workItemIds].sort((a, b) => a - b).join(",");

  useEffect(() => {
    if (demoMode || !isSupabaseConfigured || !azureReady || !hasPipelines || !workItemIds.length) {
      setByWorkItemId({});
      return;
    }
    let cancelled = false;
    setLoading(true);
    supabase.functions
      .invoke("azurePipelineStatus", {
        body: {
          orgUrl: profile.azureOrgUrl,
          project: profile.azureProject,
          pat: profile.azurePat,
          pipelineQaName: pipelineNames.qa,
          pipelineBetaName: pipelineNames.beta,
          workItemIds
        }
      })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (!error && data?.ok) setByWorkItemId(data.byWorkItemId || {});
        setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoMode, azureReady, hasPipelines, idsKey, pipelineNames?.qa, pipelineNames?.beta]);

  return { byWorkItemId, loading };
}
