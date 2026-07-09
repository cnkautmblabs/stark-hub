import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabaseClient.js";
import { isDomainAllowed, accessLevels } from "../utils/constants.js";
import { mockProfiles } from "../utils/mockData.js";
import { readPersonalSettings, writePersonalSettings } from "../utils/personalSettings.js";

// Campos da conexão Azure DevOps (PAT, org, projeto, time). Isso é uma
// credencial pessoal — nunca deve ir para o banco (RLS ou não, um PAT em
// texto puro em Postgres é um risco real caso o banco vaze). Fica só no
// localStorage deste navegador, por perfil, e é mesclado aqui em cima do
// `profile` vindo do Supabase para que todo o resto do app continue lendo
// `profile.azurePat`/`azureOrgUrl`/etc sem precisar saber de onde vem.
const AZURE_CONNECTION_KEYS = ["azureOrgUrl", "azureProject", "azureTeam", "azurePat", "azureVerifiedAt"];

function mergeLocalAzureConnection(profile, user) {
  if (!profile) return profile;
  const local = readPersonalSettings(profile, user);
  const azure = {};
  AZURE_CONNECTION_KEYS.forEach((key) => {
    if (local[key] !== undefined) azure[key] = local[key];
  });
  return { ...profile, ...azure };
}

const AuthContext = createContext(null);

// Sentinela para "ainda não sabemos se há sessão" — distinto de `null`
// ("sabemos que não há sessão"). Enquanto for `undefined`, nenhuma decisão de
// navegação pode ser tomada: se tratássemos como deslogado, o ProtectedRoute
// redirecionaria para /login *antes* do Supabase processar o token OAuth que
// acabou de chegar na URL após o redirect do Google, perdendo a sessão.
const SESSION_PENDING = undefined;

const OAUTH_PENDING_KEY = "stark-hub-oauth-pending";

function getAuthRedirectUrl() {
  const configuredUrl = import.meta.env.VITE_AUTH_REDIRECT_URL;
  if (configuredUrl) return configuredUrl;

  return new URL(import.meta.env.BASE_URL, window.location.origin).toString();
}

// O Google/Supabase redireciona de volta para a raiz do app ("/"), que é uma
// rota protegida — não para /login. Se a sessão não se estabelecer, o
// ProtectedRoute navega para /login via history.replaceState, o que reescreve
// a URL inteira e apaga qualquer hash/query (#error=..., #access_token=...)
// antes que a página de login chegue a existir para ler isso. Por isso essa
// leitura precisa acontecer aqui, no primeiro render do provider (que roda
// antes de qualquer decisão de rota), e não no Login.jsx.
function readOAuthDiagnostics() {
  if (typeof window === "undefined") return null;

  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search);
  const description = hash.get("error_description") || query.get("error_description");
  const error = hash.get("error") || query.get("error");
  if (description || error) {
    sessionStorage.removeItem(OAUTH_PENDING_KEY);
    return decodeURIComponent((description || error).replace(/\+/g, " "));
  }

  const hasOAuthPayload =
    hash.get("access_token") || hash.get("code") || query.get("code") || hash.get("provider_token");
  if (hasOAuthPayload) {
    // Retorno com token/code presente: deixa o supabase-js processar normalmente.
    sessionStorage.removeItem(OAUTH_PENDING_KEY);
    return null;
  }

  // Voltamos de um clique em "Entrar com Google" mas a URL não tem nem token
  // nem erro — o Google/Supabase descartou o redirect antes de chegar aqui.
  // Isso é sintoma clássico de a URL de redirect não estar cadastrada em
  // Authentication > URL Configuration (Redirect URLs) no Supabase, ou de o
  // "Authorized redirect URI" do Google Cloud não apontar para o callback do
  // Supabase (<projeto>.supabase.co/auth/v1/callback).
  if (sessionStorage.getItem(OAUTH_PENDING_KEY) === "1") {
    sessionStorage.removeItem(OAUTH_PENDING_KEY);
    return "O Google/Supabase retornou sem nenhum token de acesso. Verifique, no painel do Supabase, em Authentication > URL Configuration, se a Redirect URL do app está cadastrada, e no Google Cloud Console se o Authorized redirect URI aponta para o callback do Supabase.";
  }

  return null;
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(SESSION_PENDING);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [demoMode, setDemoMode] = useState(false);
  const [demoRole, setDemoRole] = useState(accessLevels.gestao);
  const [oauthError] = useState(readOAuthDiagnostics);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    // getSession() aguarda a inicialização completa do client (incluindo o
    // processamento do token OAuth que acabou de chegar na URL após o
    // redirect do Google). onAuthStateChange, por sua vez, pode disparar um
    // evento inicial com sessão `null` *antes* desse processamento terminar
    // — se deixássemos isso setar a sessão, derrubaríamos a proteção do
    // SESSION_PENDING e o ProtectedRoute mandaria o usuário de volta para
    // /login logo depois de um login bem-sucedido. Por isso ignoramos
    // qualquer evento de onAuthStateChange até getSession() resolver.
    let initialized = false;

    supabase.auth.getSession().then(({ data }) => {
      initialized = true;
      setSession(data.session || null);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!initialized) return;
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

  // Contador incrementado a cada gravação local da conexão Azure — o único
  // motivo de existir é forçar o `useMemo` do value a recalcular
  // `effectiveProfile` (que lê do localStorage) mesmo sem o `profile` do
  // Supabase ter mudado.
  const [azureConnectionVersion, setAzureConnectionVersion] = useState(0);

  // PAT/org/projeto/time do Azure DevOps: nunca vão para o Supabase (ver
  // AzureConnectionForm.jsx) — gravados só no localStorage deste navegador.
  function updateLocalAzureConnection(patch) {
    writePersonalSettings(profile, session?.user, patch);
    setAzureConnectionVersion((v) => v + 1);
    return { data: mergeLocalAzureConnection(profile, session?.user), error: null };
  }

  async function signInWithGoogle() {
    if (!isSupabaseConfigured) return;
    sessionStorage.setItem(OAUTH_PENDING_KEY, "1");
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

  const effectiveProfile = demoMode ? mockProfiles[demoRole] : mergeLocalAzureConnection(profile, session?.user);

  const value = useMemo(
    () => ({
      session,
      user: demoMode ? null : session?.user || null,
      profile: effectiveProfile,
      loading: demoMode ? false : loading,
      demoMode,
      demoRole,
      enterDemoMode,
      isApproved: demoMode || (profile != null && profile.accessLevel !== accessLevels.pending),
      signInWithGoogle,
      signOut,
      updateProfile,
      updateLocalAzureConnection,
      reloadProfile: () => session?.user && loadProfile(session.user.id),
      oauthError
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, profile, loading, demoMode, demoRole, effectiveProfile, oauthError, azureConnectionVersion]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
