import { useEffect, useState, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabaseClient.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { hasManagementAccess } from "../utils/constants.js";

// Diretório bruto de profiles (contas que já logaram com Google). Existe só
// para a Gestão/Gerente enxergar quem logou mas ainda não tem colaborador
// vinculado — sem isso, um usuário novo fica invisível para sempre:
// handle_new_user (schema.sql) só cria o profile com accessLevel "pending",
// nunca cria um collaborator, e a tela de Colaboradores só listava
// collaborators.
export function useProfiles() {
  const { demoMode, profile: myProfile } = useAuth();
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(!demoMode);
  const canManage = hasManagementAccess(myProfile?.accessLevel);

  const reload = useCallback(() => {
    if (demoMode || !isSupabaseConfigured || !canManage) {
      setLoading(false);
      return;
    }
    setLoading(true);
    supabase.from("profiles").select('id, email, "fullName", "displayName", "accessLevel"').then(({ data, error }) => {
      if (!error && data) setProfiles(data);
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoMode, canManage]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function setAccessLevel(id, accessLevel) {
    if (!isSupabaseConfigured) return { error: new Error("Supabase não configurado") };
    const { error } = await supabase.from("profiles").update({ accessLevel }).eq("id", id);
    if (!error) setProfiles((current) => current.map((p) => (p.id === id ? { ...p, accessLevel } : p)));
    return { error };
  }

  return { profiles, loading, setAccessLevel, reload };
}
