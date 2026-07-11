import { useCallback, useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabaseClient.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { getDemoCollaborators, updateDemoCollaborator, addDemoCollaborator, deleteDemoCollaborator } from "../utils/demoStore.js";
import { buildApiCacheKey, readApiCache, stableSignature, withInflight, writeApiCache } from "../utils/localApiCache.js";
import { useRevalidateOnFocus } from "./useRevalidateOnFocus.js";
import { hasManagementAccess } from "../utils/constants.js";

const COLLABORATORS_CACHE_TTL_MS = 2 * 60 * 1000;
const API_CACHE_STORAGE_PREFIX = "starkHubApiCache:v1:";

// Diretorio completo em memoria PURA (nunca localStorage) so pra Dev/QA nao
// refazer a busca de rede a cada componente montado (Sidebar, Layout, board
// atual etc. chamam useCollaborators() ao mesmo tempo). Some ao recarregar a
// pagina — exatamente o que a regra de privacidade pede ("nao salvar no
// localStorage dados de outros membros"), so evitando egress redundante do
// Supabase dentro da mesma sessao.
let sessionDirectoryCache = null;

function dedupeRows(rows) {
  return Array.from(new Map((rows || []).filter(Boolean).map((row) => [row.id, row])).values());
}

function isSelfCollaborator(row, profile, user) {
  const userEmail = String(user?.email || profile?.email || "").toLowerCase();
  return Boolean(
    row?.id && profile?.id && row.id === profile.id
    || row?.authUserId && user?.id && row.authUserId === user.id
    || row?.authUserId && profile?.authUserId && row.authUserId === profile.authUserId
    || userEmail && String(row?.email || "").toLowerCase() === userEmail
  );
}

// Restringe o que e GRAVADO no localStorage (cache persistente entre
// sessoes/abas) — nunca o que e exibido na tela nesta sessao. Quality
// Board/Meus itens precisam do nome+foto de QUALQUER colaborador (quem
// esta atribuido, quem e QA responsavel), nao so do proprio usuario; a RLS
// de `collaborators_profile` ja permite select para qualquer autenticado
// (ver migration 20260709100000), entao restringir a query em si so
// quebrava os avatares dessas telas sem ganho real de privacidade. A regra
// "Dev/QA nao-Admin nao guarda dados de outros no localStorage" fica só
// no cache: cada sessao busca o diretorio completo pra renderizar, mas so
// a propria linha sobrevive entre reloads/abas.
function sanitizeRowsForCache(rows, profile, user, canReadTeamDirectory) {
  const deduped = dedupeRows(rows);
  if (canReadTeamDirectory) return deduped;
  const selfRows = deduped.filter((row) => isSelfCollaborator(row, profile, user));
  if (selfRows.length) return selfRows;
  return profile?.id ? [profile] : [];
}

// Fonte do diretório de colaboradores (tabela `collaborators_profile` —
// identidade + login numa linha só, ver schema.sql). No modo demo, vem do
// localStorage e as edições ficam salvas localmente. Fora do modo demo, vem
// do Supabase e as edições são persistidas via RLS (Gestão escreve qualquer
// linha; cada pessoa escreve a própria via "authUserId" = auth.uid()).
export function useCollaborators() {
  const { demoMode, profile, user, isRealAdmin } = useAuth();
  const canReadTeamDirectory = hasManagementAccess(profile?.accessLevel, isRealAdmin);
  const cacheScope = canReadTeamDirectory ? "team" : "self";
  const cacheKey = buildApiCacheKey("collaborators", cacheScope, profile?.id || profile?.email || "anonymous", profile?.accessLevel);
  const initialCache = !demoMode ? readApiCache(cacheKey, COLLABORATORS_CACHE_TTL_MS) : null;
  const [collaborators, setCollaborators] = useState(() => (
    demoMode
      ? dedupeRows(getDemoCollaborators())
      : dedupeRows(initialCache?.data || [])
  ));
  const [loading, setLoading] = useState(!demoMode && !initialCache?.data);

  const persistCollaborators = useCallback((rows) => {
    writeApiCache(cacheKey, sanitizeRowsForCache(rows, profile, user, canReadTeamDirectory));
  }, [cacheKey, canReadTeamDirectory, profile, user]);

  const load = useCallback(async ({ force = false } = {}) => {
    if (demoMode) {
      setCollaborators(dedupeRows(getDemoCollaborators()));
      setLoading(false);
      return;
    }
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    const cached = readApiCache(cacheKey, COLLABORATORS_CACHE_TTL_MS);
    if (cached?.data) {
      setCollaborators(dedupeRows(cached.data));
      setLoading(false);
      if (!force && cached.fresh && canReadTeamDirectory) return;
    } else {
      setLoading(true);
    }
    // Pra quem nao pode ler o diretorio inteiro, o cache persistido acima e
    // so a propria linha (privacidade) — nunca representa o diretorio
    // completo que Quality Board/Meus itens/Governanca precisam pra
    // avatar/nome de outras pessoas. Em vez de bater rede de novo a cada
    // componente montado (Sidebar + Layout + tela atual, todos usam este
    // hook ao mesmo tempo), usa um cache SO em memoria (nunca localStorage,
    // some ao recarregar a pagina) com o mesmo TTL.
    if (!canReadTeamDirectory && !force && sessionDirectoryCache?.key === cacheKey
      && Date.now() - sessionDirectoryCache.timestamp < COLLABORATORS_CACHE_TTL_MS) {
      setCollaborators(dedupeRows(sessionDirectoryCache.data));
      setLoading(false);
      return;
    }
    const { data, error } = await withInflight(cacheKey, () => supabase.from("collaborators_profile").select("*"));
    if (!error && data) {
      const rows = dedupeRows(data);
      const nextSignature = stableSignature(rows);
      if (!canReadTeamDirectory) sessionDirectoryCache = { key: cacheKey, data: rows, timestamp: Date.now() };
      // Grava no cache/localStorage so o recorte sanitizado (privacidade),
      // mas o estado em memoria desta sessao fica com o diretorio completo
      // — precisa dele pra renderizar avatar/nome de qualquer colaborador
      // atribuido a um item, nao so o do usuario logado.
      writeApiCache(cacheKey, sanitizeRowsForCache(rows, profile, user, canReadTeamDirectory), nextSignature);
      if (nextSignature !== cached?.signature || !canReadTeamDirectory) setCollaborators(rows);
    }
    setLoading(false);
  }, [demoMode, cacheKey, canReadTeamDirectory, profile, user]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (demoMode || canReadTeamDirectory || typeof window === "undefined") return;
    const currentStorageKey = `${API_CACHE_STORAGE_PREFIX}${cacheKey}`;
    Object.keys(window.localStorage || {}).forEach((key) => {
      if (key.startsWith(`${API_CACHE_STORAGE_PREFIX}collaborators:`) && key !== currentStorageKey) {
        window.localStorage.removeItem(key);
      }
    });
  }, [cacheKey, canReadTeamDirectory, demoMode]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    function handleCacheWrite(event) {
      if (event.detail?.key !== cacheKey) return;
      // O payload deste evento e sempre o recorte sanitizado (gravado no
      // cache/localStorage) — outras abas/instancias do hook usam isso so
      // como sincronizacao rapida; a propria instancia que buscou os dados
      // ja se atualiza com o diretorio completo ao fim do seu `load()`.
      if (event.detail?.entry?.data) setCollaborators((current) => (canReadTeamDirectory ? dedupeRows(event.detail.entry.data) : current));
    }
    window.addEventListener("starkHubApiCacheWrite", handleCacheWrite);
    return () => window.removeEventListener("starkHubApiCacheWrite", handleCacheWrite);
  }, [cacheKey, canReadTeamDirectory]);

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
