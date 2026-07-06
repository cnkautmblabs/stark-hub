import { useCallback, useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabaseClient.js";
import { useAuth } from "../contexts/AuthContext.jsx";

// Configurações compartilhadas por toda a equipe (tabela `app_settings`,
// key/value jsonb), editáveis só por Gestão (ver policy
// app_settings_write_management no schema.sql). Usado para nomes de
// pipeline, feature flags e qualquer outra config de projeto (Fase 6).
export function useAppSettings() {
  const { demoMode } = useAuth();
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(!demoMode);

  const load = useCallback(async () => {
    if (demoMode || !isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.from("app_settings").select("key, value");
    if (!error && data) setSettings(Object.fromEntries(data.map((row) => [row.key, row.value])));
    setLoading(false);
  }, [demoMode]);

  useEffect(() => {
    load();
  }, [load]);

  async function updateSetting(key, value) {
    if (demoMode || !isSupabaseConfigured) return { error: new Error("Indisponível no modo demonstração.") };
    const { error } = await supabase.from("app_settings").upsert({ key, value, updatedAt: new Date().toISOString() });
    if (!error) setSettings((current) => ({ ...current, [key]: value }));
    return { error };
  }

  function getSetting(key, fallback) {
    return settings[key] ?? fallback;
  }

  return { settings, loading, getSetting, updateSetting, reload: load };
}
