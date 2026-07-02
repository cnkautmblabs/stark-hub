import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabaseClient.js";
import { getDemoFeatureFlags, setDemoFeatureFlag } from "../utils/demoStore.js";
import { useAuth } from "./AuthContext.jsx";

const FeatureFlagsContext = createContext(null);

export function FeatureFlagsProvider({ children }) {
  const { demoMode } = useAuth();
  const [flags, setFlags] = useState(() => getDemoFeatureFlags());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (demoMode) {
      setFlags(getDemoFeatureFlags());
      setLoaded(true);
      return;
    }
    if (!isSupabaseConfigured) {
      setLoaded(true);
      return;
    }
    supabase
      .from("feature_flags")
      .select("*")
      .then(({ data, error }) => {
        if (!error && data) {
          const next = {};
          data.forEach((row) => { next[row.key] = row.enabled; });
          setFlags((current) => ({ ...current, ...next }));
        }
        setLoaded(true);
      });
  }, [demoMode]);

  function isEnabled(key) {
    return flags[key] !== false; // padrão: habilitado, a menos que explicitamente desativado
  }

  async function setFlag(key, value) {
    if (demoMode) {
      setFlags(setDemoFeatureFlag(key, value));
      return { error: null };
    }
    if (!isSupabaseConfigured) return { error: new Error("Supabase não configurado") };
    const { error } = await supabase.from("feature_flags").upsert({ key, enabled: value });
    if (!error) setFlags((current) => ({ ...current, [key]: value }));
    return { error };
  }

  return (
    <FeatureFlagsContext.Provider value={{ flags, isEnabled, setFlag, loaded }}>
      {children}
    </FeatureFlagsContext.Provider>
  );
}

export function useFeatureFlags() {
  return useContext(FeatureFlagsContext);
}
