// Edge Function: azureWorkItemAction
// Objetivo: escrever no Azure DevOps (avançar ambiente/horas, edição em
// massa, criar novo item). Roda no servidor pelo mesmo motivo do
// testAzureConnection: a API do Azure DevOps não libera CORS para chamadas
// diretas do navegador.
//
// Body esperado:
//   { action: "update", orgUrl, project, pat, updates: [{ id, completedHours, state }] }
//   { action: "create", orgUrl, project, pat, item: { type, title, sprint, countries } }
//
// "update" aplica cada item sequencialmente (mesmo padrão do userscript
// legado: PATCH por item, não há batch write na API do Azure DevOps para
// workitemsbatch) e devolve sucesso/erro por item em vez de falhar tudo.
//
// Deploy: supabase functions deploy azureWorkItemAction

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
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://dev.azure.com/${trimmed}`;
}

async function updateWorkItem(baseUrl, authHeader, update) {
  const patchOps = [
    { op: "add", path: "/fields/Microsoft.VSTS.Scheduling.CompletedWork", value: update.completedHours }
  ];
  if (update.state) patchOps.push({ op: "add", path: "/fields/System.State", value: update.state });

  const response = await fetch(`${baseUrl}/_apis/wit/workitems/${update.id}?api-version=7.1`, {
    method: "PATCH",
    headers: { Authorization: authHeader, "Content-Type": "application/json-patch+json" },
    body: JSON.stringify(patchOps)
  });

  if (response.ok) return { id: update.id, ok: true };
  const message = response.status === 401 ? "PAT inválido ou sem permissão." : `Azure DevOps retornou status ${response.status}.`;
  return { id: update.id, ok: false, error: message };
}

async function createWorkItem(baseUrl, project, authHeader, item) {
  const patchOps = [
    { op: "add", path: "/fields/System.Title", value: item.title }
  ];
  if (item.sprint) patchOps.push({ op: "add", path: "/fields/System.IterationPath", value: item.sprint });
  if (item.areaPath) patchOps.push({ op: "add", path: "/fields/System.AreaPath", value: item.areaPath });
  if (item.description) patchOps.push({ op: "add", path: "/fields/System.Description", value: item.description });
  if (item.assigneeAlias) patchOps.push({ op: "add", path: "/fields/System.AssignedTo", value: item.assigneeAlias });
  const tags = [...(item.countries || []).map((code) => `0-${code}`), ...(item.tags || [])];
  if (tags.length) patchOps.push({ op: "add", path: "/fields/System.Tags", value: tags.join("; ") });
  // Vincula como filho da User Story/Bug escolhida como Parent — mesmo
  // comportamento do userscript legado (criar Task a partir de uma US/Bug).
  if (item.parentId) {
    patchOps.push({
      op: "add",
      path: "/relations/-",
      value: {
        rel: "System.LinkTypes.Hierarchy-Reverse",
        url: `${baseUrl}/_apis/wit/workItems/${item.parentId}`,
        attributes: { comment: "Criado pelo Stark Hub a partir do Parent" }
      }
    });
  }

  const response = await fetch(`${baseUrl}/${encodeURIComponent(project)}/_apis/wit/workitems/$${encodeURIComponent(item.type)}?api-version=7.1`, {
    method: "POST",
    headers: { Authorization: authHeader, "Content-Type": "application/json-patch+json" },
    body: JSON.stringify(patchOps)
  });

  if (!response.ok) {
    const message = response.status === 401 ? "PAT inválido ou sem permissão." : `Azure DevOps retornou status ${response.status}.`;
    return { ok: false, error: message };
  }
  const data = await response.json();
  return { ok: true, id: data.id };
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

  const { action, orgUrl, project, pat } = payload || {};
  if (!orgUrl || !project || !pat) {
    return json({ ok: false, error: "Conexão com Azure DevOps não configurada." }, 400);
  }

  const baseUrl = normalizeOrgUrl(orgUrl);
  const authHeader = `Basic ${btoa(`:${pat}`)}`;

  if (action === "update") {
    const updates = Array.isArray(payload.updates) ? payload.updates : [];
    if (!updates.length) return json({ ok: false, error: "Nenhuma atualização informada." }, 400);
    const results = [];
    for (const update of updates) {
      results.push(await updateWorkItem(baseUrl, authHeader, update));
    }
    const ok = results.every((r) => r.ok);
    return json({ ok, results });
  }

  if (action === "create") {
    if (!payload.item?.title || !payload.item?.type) {
      return json({ ok: false, error: "Título e tipo são obrigatórios." }, 400);
    }
    const result = await createWorkItem(baseUrl, project, authHeader, payload.item);
    return json(result, result.ok ? 200 : 200);
  }

  return json({ ok: false, error: "Ação não suportada." }, 400);
});
