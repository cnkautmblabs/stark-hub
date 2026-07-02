// Edge Function: keepAlive
// Objetivo: realizar uma consulta leve periodicamente (via agendador
// externo, ex. cron-job.org ou GitHub Actions schedule) para manter o
// projeto Supabase gratuito ativo, evitando pausas por inatividade.
//
// Deploy: supabase functions deploy keepAlive
// Agendamento externo sugerido: GET https://SEU-PROJETO.functions.supabase.co/keepAlive a cada 4 dias.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

Deno.serve(async (_req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ ok: false, error: "Variáveis de ambiente ausentes." }), { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { error } = await supabase.from("feature_flags").select("key").limit(1);

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true, pingedAt: new Date().toISOString() }), {
    headers: { "Content-Type": "application/json" }
  });
});
