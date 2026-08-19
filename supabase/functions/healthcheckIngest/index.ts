// Edge Function: healthcheckIngest
// Objetivo: receber o healthcheck-result.json publicado pela pipeline real
// "PROD BFF Synthetic Healthchecks" (Azure DevOps, repo qa-playwright-mblabs,
// azure-pipelines-healthchecks.yml, roda a cada 5 minutos) e gravar como uma
// linha em public.healthcheck_results. É a UNICA escritora dessa tabela —
// usa a service role key (ignora RLS), autenticada por um segredo
// compartilhado (HEALTHCHECK_INGEST_SECRET), não pelo PAT do Azure: a
// pipeline roda fora do Stark Hub e não tem sessão de usuário.
//
// Deploy: supabase functions deploy healthcheckIngest --no-verify-jwt
// Segredo: supabase secrets set HEALTHCHECK_INGEST_SECRET=...

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-healthcheck-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Método não suportado." }, 405);

  const expectedSecret = Deno.env.get("HEALTHCHECK_INGEST_SECRET");
  const providedSecret = req.headers.get("x-healthcheck-secret") || "";
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return json({ ok: false, error: "Segredo inválido ou ausente." }, 401);
  }

  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > 512_000) return json({ ok: false, error: "Payload muito grande." }, 413);

  let payload;
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: "Corpo da requisição inválido." }, 400);
  }

  const { status, environment, startedAt, finishedAt, durationMs, countries } = payload || {};
  if (!["passed", "failed"].includes(status)) return json({ ok: false, error: "status deve ser 'passed' ou 'failed'." }, 400);
  if (!startedAt) return json({ ok: false, error: "startedAt é obrigatório." }, 400);
  if (!Array.isArray(countries)) return json({ ok: false, error: "countries deve ser uma lista." }, 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ ok: false, error: "Variáveis de ambiente do Supabase ausentes." }, 500);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { error } = await supabase.from("healthcheck_results").insert({
    environment: environment || "PROD",
    status,
    startedAt,
    finishedAt: finishedAt || null,
    durationMs: durationMs ?? null,
    countries
  });

  if (error) return json({ ok: false, error: error.message }, 500);
  return json({ ok: true });
});
