import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabaseClient.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { getDemoCollaborators, updateDemoCollaborator, addDemoCollaborator, deleteDemoCollaborator } from "../utils/demoStore.js";

// Fonte do diretório de colaboradores (tabela `collaborators`). No modo
// demo, vem do localStorage e as edições ficam salvas localmente. Fora do
// modo demo, vem do Supabase e as edições são persistidas via RLS
// (somente Gestão pode escrever — ver policy collaborators_write_management).
export function useCollaborators() {
  const { demoMode, profile } = useAuth();
  const [collaborators, setCollaborators] = useState(() => (demoMode ? getDemoCollaborators() : []));
  const [loading, setLoading] = useState(!demoMode);

  useEffect(() => {
    if (demoMode) {
      setCollaborators(getDemoCollaborators());
      setLoading(false);
      return;
    }
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    setLoading(true);
    supabase.from("collaborators").select("*").then(async ({ data, error }) => {
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
            .select('id, email, "fullName", "displayName", "accessLevel", "aliasAzure", "aliasSlack", "aliasVariations", "slackMemberId", "avatarUrl"')
            .in("id", profileIds);
          const byId = new Map((profiles || []).map((row) => [row.id, row]));
          rows = data.map((person) => ({ ...person, linkedProfile: byId.get(person.profileId) || null, accessLevel: byId.get(person.profileId)?.accessLevel || person.accessLevel }));
        }
        setCollaborators(rows);
      }
      setLoading(false);
    });
  }, [demoMode, profile?.accessLevel]);

  async function updateCollaborator(id, patch) {
    if (demoMode) {
      setCollaborators(updateDemoCollaborator(id, patch));
      return { error: null };
    }
    if (!isSupabaseConfigured) return { error: new Error("Supabase não configurado") };

    // accessLevel mora em `profiles`, não em `collaborators` (schema.sql) —
    // precisa de uma escrita separada quando o colaborador tem conta vinculada.
    const { accessLevel, ...collaboratorPatch } = patch;
    if (accessLevel !== undefined) {
      const collaborator = collaborators.find((person) => person.id === id);
      if (collaborator?.profileId) {
        const { error } = await supabase.from("profiles").update({ accessLevel }).eq("id", collaborator.profileId);
        if (error) return { error };
        setCollaborators((current) => current.map((person) => (person.id === id ? { ...person, accessLevel, linkedProfile: { ...(person.linkedProfile || {}), accessLevel } } : person)));
      }
    }

    if (!Object.keys(collaboratorPatch).length) return { error: null };
    const { data, error } = await supabase.from("collaborators").update(collaboratorPatch).eq("id", id).select().maybeSingle();
    if (!error && data) {
      setCollaborators((current) => current.map((person) => (person.id === id ? { ...person, ...data } : person)));
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
          setCollaborators((current) => current.map((person) => (person.id === id ? { ...person, linkedProfile: { ...(person.linkedProfile || {}), ...profilePatch } } : person)));
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
    if (!error && data) setCollaborators((current) => [...current, { ...data, accessLevel }]);
    return { error, data };
  }

  async function deleteCollaborator(id) {
    if (demoMode) {
      setCollaborators(deleteDemoCollaborator(id));
      return { error: null };
    }
    if (!isSupabaseConfigured) return { error: new Error("Supabase não configurado") };
    const { error } = await supabase.from("collaborators").delete().eq("id", id);
    if (!error) setCollaborators((current) => current.filter((person) => person.id !== id));
    return { error };
  }

  return { collaborators, loading, updateCollaborator, addCollaborator, deleteCollaborator };
}
