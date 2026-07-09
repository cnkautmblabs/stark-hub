import { useCallback, useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabaseClient.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { getDemoCollaborators, updateDemoCollaborator, addDemoCollaborator, deleteDemoCollaborator } from "../utils/demoStore.js";
import { buildApiCacheKey, readApiCache, stableSignature, withInflight, writeApiCache } from "../utils/localApiCache.js";
import { useRevalidateOnFocus } from "./useRevalidateOnFocus.js";

const COLLABORATORS_CACHE_TTL_MS = 2 * 60 * 1000;

// Fonte do diretório de colaboradores (tabela `collaborators_profile` —
// identidade + login numa linha só, ver schema.sql). No modo demo, vem do
// localStorage e as edições ficam salvas localmente. Fora do modo demo, vem
// do Supabase e as edições são persistidas via RLS (Gestão escreve qualquer
// linha; cada pessoa escreve a própria via "authUserId" = auth.uid()).
export function useCollaborators() {
  const { demoMode, profile } = useAuth();
  const cacheKey = buildApiCacheKey("collaborators", profile?.id || profile?.email || "anonymous", profile?.accessLevel);
  const initialCache = !demoMode ? readApiCache(cacheKey, COLLABORATORS_CACHE_TTL_MS) : null;
  const [collaborators, setCollaborators] = useState(() => (demoMode ? getDemoCollaborators() : initialCache?.data || []));
  const [loading, setLoading] = useState(!demoMode && !initialCache?.data);

  const persistCollaborators = useCallback((rows) => {
    writeApiCache(cacheKey, rows);
  }, [cacheKey]);

  const load = useCallback(async ({ force = false } = {}) => {
    if (demoMode) {
      const demo = getDemoCollaborators();
      const deduped = Array.from(new Map((demo || []).map((r) => [r.id, r])).values());
      setCollaborators(deduped);
      setLoading(false);
      return;
    }
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    const cached = readApiCache(cacheKey, COLLABORATORS_CACHE_TTL_MS);
    if (cached?.data) {
      setCollaborators(cached.data);
      setLoading(false);
      if (!force && cached.fresh) return;
    } else {
      setLoading(true);
    }
    const { data, error } = await withInflight(cacheKey, () => supabase.from("collaborators_profile").select("*"));
    if (!error && data) {
      // Remover duplicidades (caso o banco retorne linhas repetidas)
      const rows = Array.from(new Map((data || []).map((r) => [r.id, r])).values());
      const nextSignature = stableSignature(rows);
      if (nextSignature !== cached?.signature) setCollaborators(rows);
      writeApiCache(cacheKey, rows, nextSignature);
    }
    setLoading(false);
  }, [demoMode, cacheKey]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    function handleCacheWrite(event) {
      if (event.detail?.key !== cacheKey) return;
      if (event.detail?.entry?.data) setCollaborators(event.detail.entry.data);
    }
    window.addEventListener("starkHubApiCacheWrite", handleCacheWrite);
    return () => window.removeEventListener("starkHubApiCacheWrite", handleCacheWrite);
  }, [cacheKey]);

  useRevalidateOnFocus(() => load({ force: true }), { enabled: !demoMode && isSupabaseConfigured, minIntervalMs: 60000 });

  async function updateCollaborator(id, patch) {
    if (demoMode) {
      setCollaborators(updateDemoCollaborator(id, patch));
      return { error: null };
    }
    if (!isSupabaseConfigured) return { error: new Error("Supabase não configurado") };
    const { data, error } = await supabase.from("collaborators_profile").update(patch).eq("id", id).select().maybeSingle();
    if (!error && data) {
      setCollaborators((current) => {
        const next = current.map((person) => (person.id === id ? { ...person, ...data } : person));
        persistCollaborators(next);
        return next;
      });
    }
    return { error };
  }

  // Cadastro de uma nova pessoa no diretório — pode ou não já ter logado
  // (authUserId fica nulo até o primeiro login, que se vincula por e-mail).
  async function addCollaborator(patch) {
    if (demoMode) {
      const { collaborators: next, created } = addDemoCollaborator(patch);
      setCollaborators(next);
      return { error: null, data: created };
    }
    if (!isSupabaseConfigured) return { error: new Error("Supabase não configurado") };
    const { data, error } = await supabase.from("collaborators_profile").insert(patch).select().maybeSingle();
    if (!error && data) {
      setCollaborators((current) => {
        const next = [...current, data];
        persistCollaborators(next);
        return next;
      });
    }
    return { error, data };
  }

  async function deleteCollaborator(id) {
    if (demoMode) {
      setCollaborators(deleteDemoCollaborator(id));
      return { error: null };
    }
    if (!isSupabaseConfigured) return { error: new Error("Supabase não configurado") };
    const { error } = await supabase.from("collaborators_profile").delete().eq("id", id);
    if (!error) {
      setCollaborators((current) => {
        const next = current.filter((person) => person.id !== id);
        persistCollaborators(next);
        return next;
      });
    }
    return { error };
  }

  return { collaborators, loading, updateCollaborator, addCollaborator, deleteCollaborator, reload: () => load({ force: true }) };
}
