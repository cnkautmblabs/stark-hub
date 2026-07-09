import { useCallback, useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabaseClient.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { mockTestEvidence } from "../utils/mockData.js";
import { buildApiCacheKey, readApiCache, stableSignature, withInflight, writeApiCache } from "../utils/localApiCache.js";
import { useRevalidateOnFocus } from "./useRevalidateOnFocus.js";

const TEST_EVIDENCE_CACHE_TTL_MS = 90 * 1000;

// Histórico de evidências de teste. No modo demo, dados de exemplo fixos.
// Fora do modo demo, vem da tabela test_evidence (ver migration
// 20260703104836_azure_work_items_integration.sql) — substitui o
// comportamento do userscript legado, que escrevia isso como comentário
// nativo no work item (só possível porque ele rodava injetado na própria
// página do Azure DevOps).
export function useTestEvidence() {
  const { demoMode, profile, user } = useAuth();
  const cacheKey = buildApiCacheKey("testEvidence", profile?.id || user?.email || "anonymous", profile?.accessLevel);
  const initialCache = !demoMode ? readApiCache(cacheKey, TEST_EVIDENCE_CACHE_TTL_MS) : null;
  const [evidence, setEvidence] = useState(demoMode ? mockTestEvidence : initialCache?.data || []);

  const load = useCallback(async ({ force = false } = {}) => {
    if (demoMode) {
      setEvidence(mockTestEvidence);
      return;
    }
    if (!isSupabaseConfigured) {
      setEvidence([]);
      return;
    }
    const cached = readApiCache(cacheKey, TEST_EVIDENCE_CACHE_TTL_MS);
    if (cached?.data) {
      setEvidence(cached.data);
      if (!force && cached.fresh) return;
    }
    const { data, error } = await withInflight(cacheKey, () => supabase
      .from("test_evidence")
      .select("id, workItemId, result, note, environment, authorId, createdAt, author:authorId(fullName, displayName)")
      .order("createdAt", { ascending: false }));
    if (!error && data) {
      const next = data.map((row) => ({ ...row, authorName: row.author?.displayName || row.author?.fullName || null }));
      const nextSignature = stableSignature(next);
      if (nextSignature !== cached?.signature) setEvidence(next);
      writeApiCache(cacheKey, next, nextSignature);
    }
  }, [demoMode, cacheKey]);

  useEffect(() => {
    load();
  }, [load]);

  useRevalidateOnFocus(() => load({ force: true }), { enabled: !demoMode && isSupabaseConfigured, minIntervalMs: 45000 });

  return { evidence, reload: () => load({ force: true }) };
}
