// Edge Function: slackNotify
// Sends messages to Slack webhooks without exposing the browser to Slack CORS.
// Security guardrails: only official Slack webhook URLs are accepted, responses
// never echo full secrets, and payload size is bounded.

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

function isAllowedSlackWebhook(rawUrl) {
  try {
    const url = new URL(String(rawUrl || "").trim());
    return url.protocol === "https:" && url.hostname === "hooks.slack.com" && url.pathname.startsWith("/services/");
  } catch {
    return false;
  }
}

function redactWebhook(rawUrl) {
  try {
    const url = new URL(String(rawUrl || ""));
    const parts = url.pathname.split("/").filter(Boolean);
    return `${url.origin}/${parts.slice(0, 2).join("/")}/***`;
  } catch {
    return "invalid-webhook";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Metodo nao suportado." }, 405);

  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > 128_000) return json({ ok: false, error: "Payload do Slack muito grande." }, 413);

  let payload;
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: "Corpo da requisicao invalido." }, 400);
  }

  const { webhooks, text } = payload || {};
  const targets = Array.isArray(webhooks)
    ? Array.from(new Set(webhooks.filter((url) => typeof url === "string" && url.trim()).map((url) => url.trim())))
    : [];

  if (!targets.length) return json({ ok: false, error: "Nenhum webhook do Slack configurado." }, 400);
  if (targets.length > 5) return json({ ok: false, error: "Limite de 5 webhooks por envio." }, 400);
  if (!text || !String(text).trim()) return json({ ok: false, error: "Mensagem vazia." }, 400);
  if (String(text).length > 40_000) return json({ ok: false, error: "Mensagem do Slack muito grande." }, 400);
  if (targets.some((url) => !isAllowedSlackWebhook(url))) {
    return json({ ok: false, error: "Webhook invalido. Apenas https://hooks.slack.com/services/... e permitido." }, 400);
  }

  const results = await Promise.all(
    targets.map(async (url) => {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text })
        });
        const body = await response.text();
        return { url: redactWebhook(url), ok: response.ok, status: response.status, body: response.ok ? undefined : body.slice(0, 300) };
      } catch (err) {
        return { url: redactWebhook(url), ok: false, error: err.message };
      }
    })
  );

  return json({ ok: results.some((result) => result.ok), results });
});
