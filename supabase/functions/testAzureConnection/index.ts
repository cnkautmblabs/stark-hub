// Edge Function: testAzureConnection
// Objetivo: validar organização/projeto/PAT do Azure DevOps informados pelo
// usuário. Roda no servidor porque a API do Azure DevOps não permite chamadas
// diretas do navegador (sem CORS liberado para origens arbitrárias).
//
// Deploy: supabase functions deploy testAzureConnection

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

function normalizeOrgUrl(rawUrl) {
  const trimmed = String(rawUrl || "").trim().replace(/\/+$/, "");
  const url = /^https?:\/\//i.test(trimmed) ? trimmed : `https://dev.azure.com/${trimmed}`;
  return isAllowedAzureUrl(url) ? url : "";
}

function isAllowedAzureUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:" && (url.hostname === "dev.azure.com" || url.hostname.endsWith(".visualstudio.com"));
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Método não suportado." }, 405);

  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > 64_000) return json({ ok: false, error: "Payload muito grande." }, 413);

  let payload;
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: "Corpo da requisição inválido." }, 400);
  }

  const { orgUrl, project, pat } = payload || {};
  if (!orgUrl || !project || !pat) {
    return json({ ok: false, error: "Preencha organização, projeto e Personal Access Token." }, 400);
  }

  const baseUrl = normalizeOrgUrl(orgUrl);
  if (!baseUrl) return json({ ok: false, error: "URL do Azure DevOps invalida. Use dev.azure.com ou *.visualstudio.com." }, 400);
  const apiUrl = `${baseUrl}/_apis/projects/${encodeURIComponent(project)}?api-version=7.1-preview.4`;
  const authHeader = `Basic ${btoa(`:${pat}`)}`;

  let azureResponse;
  try {
    azureResponse = await fetch(apiUrl, {
      headers: { Authorization: authHeader, Accept: "application/json" }
    });
  } catch (err) {
    return json({ ok: false, error: `Falha ao conectar ao Azure DevOps: ${err.message}` }, 502);
  }

  if (azureResponse.status === 401 || azureResponse.status === 203) {
    return json({ ok: false, error: "Personal Access Token inválido ou sem permissão." }, 200);
  }
  if (azureResponse.status === 404) {
    return json({ ok: false, error: "Organização ou projeto não encontrado." }, 200);
  }
  if (!azureResponse.ok) {
    return json({ ok: false, error: `Azure DevOps retornou status ${azureResponse.status}.` }, 200);
  }

  const data = await azureResponse.json();
  return json({ ok: true, projectName: data.name, projectId: data.id });
});
