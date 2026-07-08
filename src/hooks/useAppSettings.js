import { useCallback, useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabaseClient.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { getDemoAppSettings, setDemoAppSetting } from "../utils/demoStore.js";

// Configurações compartilhadas por toda a equipe (tabela `app_settings`,
// key/value jsonb), editáveis só por Gestão (ver policy
// app_settings_write_management no schema.sql). Usado para nomes de
// pipeline, feature flags e qualquer outra config de projeto (Fase 6).
export function useAppSettings() {
  const { demoMode, profile, user } = useAuth();
  const [settings, setSettings] = useState(() => (demoMode ? getDemoAppSettings() : {}));
  const [loading, setLoading] = useState(!demoMode);
  const personalSettingsKey = `starkHubPersonalConnections:${profile?.id || user?.email || "anonymous"}`;

  function readPersonalSettings() {
    if (typeof window === "undefined") return {};
    try {
      return JSON.parse(window.localStorage.getItem(personalSettingsKey) || "{}");
    } catch {
      return {};
    }
  }

  const load = useCallback(async () => {
    if (demoMode || !isSupabaseConfigured) {
      if (demoMode) setSettings(getDemoAppSettings());
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
    if (demoMode) {
      setSettings(setDemoAppSetting(key, value));
      return { error: null };
    }
    if (!isSupabaseConfigured) return { error: new Error("Indisponível no modo demonstração.") };
    const { error } = await supabase.from("app_settings").upsert({ key, value, updatedAt: new Date().toISOString() });
    if (!error) setSettings((current) => ({ ...current, [key]: value }));
    return { error };
  }

  function getSetting(key, fallback) {
    const personal = readPersonalSettings();
    if (key === "azurePipelines" && (personal.pipelineQaName || personal.pipelineBetaName)) {
      return { ...(settings.azurePipelines || {}), qa: personal.pipelineQaName || settings.azurePipelines?.qa || "", beta: personal.pipelineBetaName || settings.azurePipelines?.beta || "" };
    }
    if (key === "slackWebhookUrl" && personal.slackWebhookUrl) return personal.slackWebhookUrl;
    if (key === "slackTestWebhookUrl" && personal.slackTestWebhookUrl) return personal.slackTestWebhookUrl;
    if (key === "slackTestMode" && "slackTestMode" in personal) return personal.slackTestMode;
    if (key === "slackPrimaryWebhookName" && personal.slackPrimaryWebhookName) return personal.slackPrimaryWebhookName;
    return settings[key] ?? fallback;
  }

  return { settings, loading, getSetting, updateSetting, reload: load };
}
