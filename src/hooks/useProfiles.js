import { useEffect, useState, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabaseClient.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { hasManagementAccess } from "../utils/constants.js";
import { buildApiCacheKey, readApiCache, stableSignature, withInflight, writeApiCache } from "../utils/localApiCache.js";
import { useRevalidateOnFocus } from "./useRevalidateOnFocus.js";

const PROFILES_CACHE_TTL_MS = 2 * 60 * 1000;

// Diretorio bruto de profiles (contas que ja logaram com Google). Existe so
// para a Gestao/Gerente enxergar quem logou mas ainda nao tem colaborador
// vinculado.
export function useProfiles() {
  const { demoMode, profile: myProfile } = useAuth();
  const canManage = hasManagementAccess(myProfile?.accessLevel);
  const cacheKey = buildApiCacheKey("profiles", myProfile?.id || myProfile?.email || "anonymous", myProfile?.accessLevel);
  const initialCache = !demoMode ? readApiCache(cacheKey, PROFILES_CACHE_TTL_MS) : null;
  const [profiles, setProfiles] = useState(initialCache?.data || []);
  const [loading, setLoading] = useState(!demoMode && canManage && !initialCache?.data);

  const reload = useCallback(async ({ force = false } = {}) => {
    if (demoMode || !isSupabaseConfigured || !canManage) {
      setLoading(false);
      return;
    }

    const cached = readApiCache(cacheKey, PROFILES_CACHE_TTL_MS);
    if (cached?.data) {
      setProfiles(cached.data);
      setLoading(false);
      if (!force && cached.fresh) return;
    } else {
      setLoading(true);
    }

    const { data, error } = await withInflight(cacheKey, () => supabase.from("profiles").select('id, email, "fullName", "displayName", "accessLevel"'));
    if (!error && data) {
      const nextSignature = stableSignature(data);
      if (nextSignature !== cached?.signature) setProfiles(data);
      writeApiCache(cacheKey, data, nextSignature);
    }
    setLoading(false);
  }, [demoMode, canManage, cacheKey]);

  useEffect(() => {
    reload();
  }, [reload]);

  useRevalidateOnFocus(() => reload({ force: true }), { enabled: !demoMode && isSupabaseConfigured && canManage, minIntervalMs: 60000 });

  async function setAccessLevel(id, accessLevel) {
    if (!isSupabaseConfigured) return { error: new Error("Supabase nao configurado") };
    const { error } = await supabase.from("profiles").update({ accessLevel }).eq("id", id);
    if (!error) {
      setProfiles((current) => {
        const next = current.map((p) => (p.id === id ? { ...p, accessLevel } : p));
        writeApiCache(cacheKey, next);
        return next;
      });
    }
    return { error };
  }

  return { profiles, loading, setAccessLevel, reload: () => reload({ force: true }) };
}
