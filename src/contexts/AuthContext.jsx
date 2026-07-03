import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabaseClient.js";
import { isDomainAllowed, accessLevels } from "../utils/constants.js";
import { mockProfiles } from "../utils/mockData.js";

const AuthContext = createContext(null);

// Sentinela para "ainda não sabemos se há sessão" — distinto de `null`
// ("sabemos que não há sessão"). Enquanto for `undefined`, nenhuma decisão de
// navegação pode ser tomada: se tratássemos como deslogado, o ProtectedRoute
// redirecionaria para /login *antes* do Supabase processar o token OAuth que
// acabou de chegar na URL após o redirect do Google, perdendo a sessão.
const SESSION_PENDING = undefined;

function getAuthRedirectUrl() {
  const configuredUrl = import.meta.env.VITE_AUTH_REDIRECT_URL;
  if (configuredUrl) return configuredUrl;

  return new URL(import.meta.env.BASE_URL, window.location.origin).toString();
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(SESSION_PENDING);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [demoMode, setDemoMode] = useState(false);
  const [demoRole, setDemoRole] = useState(accessLevels.gestao);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session || null);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession || null);
    });

    return () => subscription?.subscription?.unsubscribe();
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    if (session === SESSION_PENDING) return; // aguardando getSession()/onAuthStateChange resolver
    if (!session?.user) {
      setProfile(null);
      setLoading(false);
      return;
    }

    // Segurança: mesmo com Google OAuth restrito no console do Supabase,
    // validamos o domínio novamente no cliente e encerramos a sessão se
    // o e-mail não pertencer aos domínios permitidos.
    if (!isDomainAllowed(session.user.email)) {
      supabase.auth.signOut();
      setProfile(null);
      setLoading(false);
      return;
    }

    loadProfile(session.user.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  async function loadProfile(userId) {
    setLoading(true);
    const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
    if (!error) setProfile(data);
    setLoading(false);
  }

  async function signInWithGoogle() {
    if (!isSupabaseConfigured) return;
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: getAuthRedirectUrl() }
    });
  }

  async function signOut() {
    if (demoMode) {
      setDemoMode(false);
      return;
    }
    if (!isSupabaseConfigured) return;
    await supabase.auth.signOut();
  }

  function enterDemoMode(role) {
    setDemoRole(role);
    setDemoMode(true);
  }

  async function updateProfile(patch) {
    if (!isSupabaseConfigured || !session?.user) return;
    const { data, error } = await supabase
      .from("profiles")
      .update(patch)
      .eq("id", session.user.id)
      .select()
      .maybeSingle();
    if (!error) setProfile(data);
    return { data, error };
  }

  const effectiveProfile = demoMode ? mockProfiles[demoRole] : profile;

  const value = useMemo(
    () => ({
      session,
      user: demoMode ? null : session?.user || null,
      profile: effectiveProfile,
      loading: demoMode ? false : loading,
      demoMode,
      demoRole,
      enterDemoMode,
      isApproved: demoMode || profile?.accessLevel !== accessLevels.pending,
      signInWithGoogle,
      signOut,
      updateProfile,
      reloadProfile: () => session?.user && loadProfile(session.user.id)
    }),
    [session, profile, loading, demoMode, demoRole, effectiveProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
