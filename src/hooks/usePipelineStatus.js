import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabaseClient.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { buildApiCacheKey, readApiCache, stableSignature, withInflight, writeApiCache } from "../utils/localApiCache.js";

const PIPELINE_STATUS_CACHE_TTL_MS = 2 * 60 * 1000;

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
  const cacheKey = buildApiCacheKey("pipelineStatus", profile?.id || profile?.email || "anonymous", profile?.azureOrgUrl, profile?.azureProject, pipelineNames?.qa, pipelineNames?.beta, idsKey);

  useEffect(() => {
    if (demoMode || !isSupabaseConfigured || !azureReady || !hasPipelines || !workItemIds.length) {
      setByWorkItemId({});
      return;
    }
    let cancelled = false;
    const cached = readApiCache(cacheKey, PIPELINE_STATUS_CACHE_TTL_MS);
    if (cached?.data) {
      setByWorkItemId(cached.data);
      setLoading(false);
      if (cached.fresh) return;
    } else {
      setLoading(true);
    }
    withInflight(cacheKey, () => supabase.functions.invoke("azurePipelineStatus", {
        body: {
          orgUrl: profile.azureOrgUrl,
          project: profile.azureProject,
          pat: profile.azurePat,
          pipelineQaName: pipelineNames.qa,
          pipelineBetaName: pipelineNames.beta,
          workItemIds
        }
      }))
      .then(({ data, error }) => {
        if (cancelled) return;
        if (!error && data?.ok) {
          const next = data.byWorkItemId || {};
          const nextSignature = stableSignature(next);
          if (nextSignature !== cached?.signature) setByWorkItemId(next);
          writeApiCache(cacheKey, next, nextSignature);
        }
        setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoMode, azureReady, hasPipelines, idsKey, pipelineNames?.qa, pipelineNames?.beta, cacheKey]);

  return { byWorkItemId, loading };
}
