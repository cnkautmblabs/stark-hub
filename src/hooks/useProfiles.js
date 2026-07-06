import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabaseClient.js";
import { useAuth } from "../contexts/AuthContext.jsx";

// Diretório bruto de profiles (contas que já logaram com Google). Existe só
// para a Gestão enxergar quem logou mas ainda não tem colaborador vinculado
// — sem isso, um usuário novo fica invisível para sempre: handle_new_user
// (schema.sql) só cria o profile com accessLevel "pending", nunca cria um
// collaborator, e a tela de Colaboradores só listava collaborators.
export function useProfiles() {
  const { demoMode, profile: myProfile } = useAuth();
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(!demoMode);
  const isGestao = myProfile?.accessLevel === "gestao";

  useEffect(() => {
    if (demoMode || !isSupabaseConfigured || !isGestao) {
      setLoading(false);
      return;
    }
    setLoading(true);
    supabase.from("profiles").select('id, email, "fullName", "displayName", "accessLevel"').then(({ data, error }) => {
      if (!error && data) setProfiles(data);
      setLoading(false);
    });
  }, [demoMode, isGestao]);

  async function setAccessLevel(id, accessLevel) {
    if (!isSupabaseConfigured) return { error: new Error("Supabase não configurado") };
    const { error } = await supabase.from("profiles").update({ accessLevel }).eq("id", id);
    if (!error) setProfiles((current) => current.map((p) => (p.id === id ? { ...p, accessLevel } : p)));
    return { error };
  }

  return { profiles, loading, setAccessLevel };
}
