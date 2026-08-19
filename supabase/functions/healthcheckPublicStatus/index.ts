// Edge Function: healthcheckPublicStatus
// Objetivo: expor os resultados da pipeline "PROD BFF Synthetic
// Healthchecks" pra QUALQUER visitante, sem exigir login no Stark Hub —
// alimenta a status page pública (/cnk-health-check-status), no espírito do
// githubstatus.com. Só leitura, sempre os MESMOS dados que já aparecem
// dentro do Stark Hub (mesma tabela public.healthcheck_results), nunca dado
// demo/mock — se não houver linha ainda, devolve rows vazio e o front
// mostra "sem dados" em vez de inventar algo.
//
// Respeita o toggle de Gestão/Gerente/Admin em Configurações
// (app_settings.healthcheckPublicEnabled) — lido aqui com a service role
// key (ignora RLS), então funciona mesmo sem sessão de usuário.
//
// Deploy: supabase functions deploy healthcheckPublicStatus --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS"
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "GET") return json({ error: "Método não suportado." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Variáveis de ambiente ausentes." }, 500);

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: settingRow } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "healthcheckPublicEnabled")
    .maybeSingle();
  // Ausente = habilitado por padrão (mesma convenção do isEnabled() de
  // feature flags no front: só desliga se alguém explicitamente marcou false).
  const enabled = settingRow?.value !== false;
  if (!enabled) return json({ enabled: false, rows: [] });

  const url = new URL(req.url);
  const environment = url.searchParams.get("environment") || "PROD";
  const limit = Math.min(Number(url.searchParams.get("limit")) || 3000, 5000);

  const { data, error } = await supabase
    .from("healthcheck_results")
    .select("environment, status, startedAt, finishedAt, durationMs, countries, createdAt")
    .eq("environment", environment)
    .order("createdAt", { ascending: false })
    .limit(limit);

  if (error) return json({ error: error.message }, 500);
  return json({ enabled: true, rows: data || [] });
});
