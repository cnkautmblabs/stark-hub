// Edge Function: slackNotify
// Objetivo: enviar mensagens para webhooks do Slack (notificação de item
// pronto para BETA, equivalente ao "Envio para o Slack" do userscript legado).
// Roda no servidor porque webhooks do Slack não respondem preflight CORS
// para requisições com Content-Type: application/json vindas do navegador.
//
// Deploy: supabase functions deploy slackNotify

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

  let payload;
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: "Corpo da requisição inválido." }, 400);
  }

  const { webhooks, text } = payload || {};
  const targets = Array.isArray(webhooks) ? webhooks.filter((url) => typeof url === "string" && url.trim()) : [];
  if (!targets.length) return json({ ok: false, error: "Nenhum webhook do Slack configurado." }, 400);
  if (!text || !String(text).trim()) return json({ ok: false, error: "Mensagem vazia." }, 400);

  const results = await Promise.all(
    targets.map(async (url) => {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text })
        });
        const body = await response.text();
        return { url, ok: response.ok, status: response.status, body: response.ok ? undefined : body.slice(0, 300) };
      } catch (err) {
        return { url, ok: false, error: err.message };
      }
    })
  );

  const anyOk = results.some((r) => r.ok);
  return json({ ok: anyOk, results });
});
