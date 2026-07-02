import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabaseClient.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { getDemoCollaborators, updateDemoCollaborator } from "../utils/demoStore.js";

// Fonte do diretório de colaboradores (tabela `collaborators`). No modo
// demo, vem do localStorage e as edições ficam salvas localmente. Fora do
// modo demo, vem do Supabase e as edições são persistidas via RLS
// (somente Gestão pode escrever — ver policy collaborators_write_management).
export function useCollaborators() {
  const { demoMode } = useAuth();
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
    supabase.from("collaborators").select("*").then(({ data, error }) => {
      if (!error && data) setCollaborators(data);
      setLoading(false);
    });
  }, [demoMode]);

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
        setCollaborators((current) => current.map((person) => (person.id === id ? { ...person, accessLevel } : person)));
      }
    }

    if (!Object.keys(collaboratorPatch).length) return { error: null };
    const { data, error } = await supabase.from("collaborators").update(collaboratorPatch).eq("id", id).select().maybeSingle();
    if (!error && data) setCollaborators((current) => current.map((person) => (person.id === id ? { ...person, ...data } : person)));
    return { error };
  }

  return { collaborators, loading, updateCollaborator };
}
