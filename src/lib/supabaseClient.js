import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
export const SUPABASE_QUOTA_EVENT = "starkhub:supabase-quota-exceeded";

function parseResetDate(response, payload) {
  const configured = import.meta.env.VITE_SUPABASE_QUOTA_RESET_AT;
  const candidate = configured
    || response.headers.get("x-ratelimit-reset")
    || response.headers.get("ratelimit-reset")
    || response.headers.get("retry-after")
    || payload?.reset_at
    || payload?.resetAt
    || payload?.billing_cycle_end;
  if (!candidate) return null;
  const numeric = Number(candidate);
  const value = Number.isFinite(numeric)
    ? new Date(numeric > 1e12 ? numeric : (numeric > 1e9 ? numeric * 1000 : Date.now() + numeric * 1000))
    : new Date(candidate);
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
}

async function supabaseFetch(input, init) {
  const response = await fetch(input, init);
  if (response.status === 402) {
    let payload = null;
    try { payload = await response.clone().json(); } catch { /* resposta pode ser texto */ }
    const detail = JSON.stringify(payload || {}).toLowerCase();
    const quotaRelated = !detail || /exceed|quota|usage|limit|resource/.test(detail);
    if (quotaRelated && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(SUPABASE_QUOTA_EVENT, { detail: { resetAt: parseResetDate(response, payload) } }));
    }
  }
  return response;
}

// Modo demonstração: ativa automaticamente se as credenciais do Supabase
// não estiverem configuradas em .env.local, para permitir explorar o app
// com dados de exemplo antes de conectar o backend real.
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
      global: { fetch: supabaseFetch }
    })
  : null;
