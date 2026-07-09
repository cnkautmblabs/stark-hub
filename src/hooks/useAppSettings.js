import { useCallback, useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabaseClient.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { getDemoAppSettings, setDemoAppSetting } from "../utils/demoStore.js";
import { buildApiCacheKey, readApiCache, stableSignature, withInflight, writeApiCache } from "../utils/localApiCache.js";
import { readPersonalSettings } from "../utils/personalSettings.js";
import { useRevalidateOnFocus } from "./useRevalidateOnFocus.js";

const APP_SETTINGS_CACHE_TTL_MS = 5 * 60 * 1000;

// Configurações compartilhadas por toda a equipe (tabela `app_settings`,
// key/value jsonb), editáveis só por Gestão (ver policy
// app_settings_write_management no schema.sql). Usado para nomes de
// pipeline, feature flags e qualquer outra config de projeto (Fase 6).
// Credenciais (webhook do Slack, PAT do Azure) NUNCA passam por aqui — a
// policy de leitura permite qualquer usuário autenticado, então nada
// secreto pode viver em `app_settings`; ver `personalSettings.js`.
export function useAppSettings() {
  const { demoMode, profile, user } = useAuth();
  const cacheKey = buildApiCacheKey("appSettings", profile?.id || user?.email || "anonymous", profile?.accessLevel);
  const initialCache = !demoMode ? readApiCache(cacheKey, APP_SETTINGS_CACHE_TTL_MS) : null;
  const [settings, setSettings] = useState(() => (demoMode ? getDemoAppSettings() : initialCache?.data || {}));
  const [loading, setLoading] = useState(!demoMode && !initialCache?.data);

  const load = useCallback(async ({ force = false } = {}) => {
    if (demoMode || !isSupabaseConfigured) {
      if (demoMode) setSettings(getDemoAppSettings());
      setLoading(false);
      return;
    }
    const cached = readApiCache(cacheKey, APP_SETTINGS_CACHE_TTL_MS);
    if (cached?.data) {
      setSettings(cached.data);
      setLoading(false);
      if (!force && cached.fresh) return;
    } else {
      setLoading(true);
    }
    const { data, error } = await withInflight(cacheKey, () => supabase.from("app_settings").select("key, value"));
    if (!error && data) {
      const next = Object.fromEntries(data.map((row) => [row.key, row.value]));
      const nextSignature = stableSignature(next);
      if (nextSignature !== cached?.signature) setSettings(next);
      writeApiCache(cacheKey, next, nextSignature);
    }
    setLoading(false);
  }, [demoMode, cacheKey]);

  useEffect(() => {
    load();
  }, [load]);

  useRevalidateOnFocus(() => load({ force: true }), { enabled: !demoMode && isSupabaseConfigured, minIntervalMs: 60000 });

  async function updateSetting(key, value) {
    if (demoMode) {
      setSettings(setDemoAppSetting(key, value));
      return { error: null };
    }
    if (!isSupabaseConfigured) return { error: new Error("Indisponível no modo demonstração.") };
    const { error } = await supabase.from("app_settings").upsert({ key, value, updatedAt: new Date().toISOString() });
    if (!error) {
      setSettings((current) => {
        const next = { ...current, [key]: value };
        writeApiCache(cacheKey, next);
        return next;
      });
    }
    return { error };
  }

  function getSetting(key, fallback) {
    const personal = readPersonalSettings(profile, user);
    if (key === "azurePipelines" && (personal.pipelineQaName || personal.pipelineBetaName)) {
      return { ...(settings.azurePipelines || {}), qa: personal.pipelineQaName || settings.azurePipelines?.qa || "", beta: personal.pipelineBetaName || settings.azurePipelines?.beta || "" };
    }
    if (key === "slackWebhookUrl" && personal.slackWebhookUrl) return personal.slackWebhookUrl;
    if (key === "slackTestWebhookUrl" && personal.slackTestWebhookUrl) return personal.slackTestWebhookUrl;
    if (key === "slackTestMode" && "slackTestMode" in personal) return personal.slackTestMode;
    if (key === "slackPrimaryWebhookName" && personal.slackPrimaryWebhookName) return personal.slackPrimaryWebhookName;
    return settings[key] ?? fallback;
  }

  return { settings, loading, getSetting, updateSetting, reload: () => load({ force: true }) };
}
