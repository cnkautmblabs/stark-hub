import { useCallback, useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabaseClient.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { getDemoCollaborators, updateDemoCollaborator, addDemoCollaborator, deleteDemoCollaborator } from "../utils/demoStore.js";
import { buildApiCacheKey, readApiCache, stableSignature, withInflight, writeApiCache } from "../utils/localApiCache.js";
import { useRevalidateOnFocus } from "./useRevalidateOnFocus.js";

const COLLABORATORS_CACHE_TTL_MS = 2 * 60 * 1000;

// Fonte do diretório de colaboradores (tabela `collaborators`). No modo
// demo, vem do localStorage e as edições ficam salvas localmente. Fora do
// modo demo, vem do Supabase e as edições são persistidas via RLS
// (somente Gestão pode escrever — ver policy collaborators_write_management).
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
    const { data, error } = await withInflight(cacheKey, () => supabase.from("collaborators").select("*"));
      if (!error && data) {
        let rows = data;
        // A policy "profiles_select_own_or_management" so deixa ler o proprio
        // perfil OU tudo (se Gestao/Gerente) — entao buscar sempre (sem
        // gatear por hasManagementAccess) e seguro: Dev/QA recebem so a
        // propria linha de volta, mas passam a enxergar os campos gravados
        // no onboarding (slackMemberId, aliases etc.) no proprio card, que
        // antes ficavam sempre vazios por essa busca nunca rodar pra eles.
        const profileIds = data.map((person) => person.profileId).filter(Boolean);
        if (profileIds.length) {
          const { data: profiles } = await supabase
            .from("profiles")
            .select('id, email, "fullName", "displayName", "accessLevel", "isAdmin", "aliasAzure", "aliasSlack", "aliasVariations", "slackMemberId", "avatarUrl"')
            .in("id", profileIds);
          const byId = new Map((profiles || []).map((row) => [row.id, row]));
          // As duas tabelas guardam os mesmos campos de identidade com nomes
          // diferentes, e a escrita nem sempre sincroniza os dois lados (ver
          // updateCollaborator). Sem espelhar aqui — nao so na exibicao do
          // Perfil — qualquer lugar que le `person.slackMemberId` direto
          // (ex.: legacyMention pras mencoes do Slack) recebia o campo vazio
          // de `collaborators` mesmo com o dado certo disponivel em
          // `profiles`, e a mencao simplesmente nao aparecia.
          rows = data.map((person) => {
            const linked = byId.get(person.profileId) || null;
            return {
              ...person,
              linkedProfile: linked,
              accessLevel: linked?.accessLevel || person.accessLevel,
              slackMemberId: person.slackMemberId || linked?.slackMemberId || "",
              slackName: person.slackName || linked?.aliasSlack || "",
              azureName: person.azureName || linked?.aliasAzure || linked?.displayName || linked?.fullName || "",
              imageUrl: person.imageUrl || person.avatarUrl || linked?.avatarUrl || "",
              aliases: Array.from(new Set([...(person.aliases || []), ...(linked?.aliasVariations || [])]))
            };
          });
        }
        // Remover duplicidades (caso o banco retorne linhas repetidas)
        rows = Array.from(new Map((rows || []).map((r) => [r.id, r])).values());
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

    // accessLevel e isAdmin moram em `profiles`, não em `collaborators` (schema.sql).
    const { accessLevel, isAdmin, ...collaboratorPatch } = patch;
    const collaborator = collaborators.find((person) => person.id === id);
    if (collaborator?.profileId) {
      if (accessLevel !== undefined) {
        const { error } = await supabase.from("profiles").update({ accessLevel }).eq("id", collaborator.profileId);
        if (error) return { error };
        setCollaborators((current) => {
          const next = current.map((person) => (person.id === id ? { ...person, accessLevel, linkedProfile: { ...(person.linkedProfile || {}), accessLevel } } : person));
          persistCollaborators(next);
          return next;
        });
      }
      if (isAdmin !== undefined) {
        const { error } = await supabase.from("profiles").update({ isAdmin }).eq("id", collaborator.profileId);
        if (error) return { error };
        setCollaborators((current) => {
          const next = current.map((person) => (person.id === id ? { ...person, isAdmin, linkedProfile: { ...(person.linkedProfile || {}), isAdmin } } : person));
          persistCollaborators(next);
          return next;
        });
      }
    }

    if (!Object.keys(collaboratorPatch).length) return { error: null };
    const { data, error } = await supabase.from("collaborators").update(collaboratorPatch).eq("id", id).select().maybeSingle();
    if (!error && data) {
      setCollaborators((current) => {
        const next = current.map((person) => (person.id === id ? { ...person, ...data } : person));
        persistCollaborators(next);
        return next;
      });
      // `profiles` e `collaborators` guardam os mesmos campos de identidade
      // (nome/Slack/avatar) com nomes diferentes — sem espelhar aqui, editar
      // pelo Perfil so atualiza collaborators e profiles fica com o valor
      // antigo do onboarding pra sempre, reabrindo a divergencia entre as
      // duas tabelas que causa a maior parte da confusao de dados.
      const collaborator = collaborators.find((person) => person.id === id);
      if (collaborator?.profileId) {
        const profilePatch = {};
        if ("slackMemberId" in collaboratorPatch) profilePatch.slackMemberId = collaboratorPatch.slackMemberId;
        if ("slackName" in collaboratorPatch) profilePatch.aliasSlack = collaboratorPatch.slackName;
        if ("azureName" in collaboratorPatch) profilePatch.aliasAzure = collaboratorPatch.azureName;
        if ("aliases" in collaboratorPatch) profilePatch.aliasVariations = collaboratorPatch.aliases;
        if ("imageUrl" in collaboratorPatch) profilePatch.avatarUrl = collaboratorPatch.imageUrl;
        if (Object.keys(profilePatch).length) {
          await supabase.from("profiles").update(profilePatch).eq("id", collaborator.profileId);
          setCollaborators((current) => {
            const next = current.map((person) => (person.id === id ? { ...person, linkedProfile: { ...(person.linkedProfile || {}), ...profilePatch } } : person));
            persistCollaborators(next);
            return next;
          });
        }
      }
    }
    return { error };
  }

  // Cadastro de um novo colaborador — sem isso não existia NENHUMA forma de
  // colocar alguém no diretório pela UI (nem a própria Gestão conseguia se
  // cadastrar: handle_new_user só cria `profiles`, nunca `collaborators`).
  async function addCollaborator(patch) {
    if (demoMode) {
      const { collaborators: next, created } = addDemoCollaborator(patch);
      setCollaborators(next);
      return { error: null, data: created };
    }
    if (!isSupabaseConfigured) return { error: new Error("Supabase não configurado") };
    const { accessLevel, ...collaboratorPatch } = patch;
    const { data, error } = await supabase.from("collaborators").insert(collaboratorPatch).select().maybeSingle();
    if (!error && data && accessLevel !== undefined && data.profileId) {
      const { error: profileError } = await supabase.from("profiles").update({ accessLevel }).eq("id", data.profileId);
      if (profileError) return { error: profileError, data };
    }
    if (!error && data) {
      setCollaborators((current) => {
        const next = [...current, { ...data, accessLevel }];
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
    const { error } = await supabase.from("collaborators").delete().eq("id", id);
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
