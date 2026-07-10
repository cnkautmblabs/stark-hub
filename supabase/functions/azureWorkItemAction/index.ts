// Edge Function: azureWorkItemAction
// Objetivo: escrever no Azure DevOps (avançar ambiente/horas, edição em
// massa, criar novo item). Roda no servidor pelo mesmo motivo do
// testAzureConnection: a API do Azure DevOps não libera CORS para chamadas
// diretas do navegador.
//
// Body esperado:
//   { action: "update", orgUrl, project, pat, updates: [{ id, completedHours, state, assigneeAlias, tags }] }
//   { action: "create", orgUrl, project, pat, item: { type, title, sprint, countries } }
//   { action: "attachment", orgUrl, project, pat, fileName, contentType, dataUrl }
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
  const patchOps = [];
  if (typeof update.completedHours !== "undefined") {
    patchOps.push({ op: "add", path: "/fields/Microsoft.VSTS.Scheduling.CompletedWork", value: update.completedHours });
  }
  if (update.state) patchOps.push({ op: "add", path: "/fields/System.State", value: update.state });
  if (update.assigneeAlias || update.assigneeName) {
    patchOps.push({ op: "add", path: "/fields/System.AssignedTo", value: update.assigneeAlias || update.assigneeName });
  }
  if (Array.isArray(update.tags)) {
    patchOps.push({ op: "add", path: "/fields/System.Tags", value: update.tags.join("; ") });
  }
  if (!patchOps.length) return { id: update.id, ok: true };

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
  if (item.priority) {
    const priorityNumber = Number(String(item.priority).match(/\d+/)?.[0] || item.priority);
    if (priorityNumber) patchOps.push({ op: "add", path: "/fields/Microsoft.VSTS.Common.Priority", value: priorityNumber });
  }
  if (item.effort) patchOps.push({ op: "add", path: "/fields/Microsoft.VSTS.Scheduling.Effort", value: Number(item.effort) });
  if (item.originalEstimate) patchOps.push({ op: "add", path: "/fields/Microsoft.VSTS.Scheduling.OriginalEstimate", value: Number(item.originalEstimate) });
  if (item.completedHours) patchOps.push({ op: "add", path: "/fields/Microsoft.VSTS.Scheduling.CompletedWork", value: Number(item.completedHours) });
  if (typeof item.remainingHours !== "undefined" && item.remainingHours !== "") patchOps.push({ op: "add", path: "/fields/Microsoft.VSTS.Scheduling.RemainingWork", value: Number(item.remainingHours) });
  if (item.startDate) patchOps.push({ op: "add", path: "/fields/Microsoft.VSTS.Scheduling.StartDate", value: item.startDate });
  if (item.targetDate) patchOps.push({ op: "add", path: "/fields/Microsoft.VSTS.Scheduling.TargetDate", value: item.targetDate });
  const tags = Array.from(new Set([...(item.countries || []).map((code) => `0-${code}`), ...(item.tags || [])].filter(Boolean)));
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
  const relatedIds = String(item.relatedIds || "").split(/[,\s;]+/).map((id) => id.trim()).filter(Boolean);
  for (const relatedId of relatedIds) {
    patchOps.push({
      op: "add",
      path: "/relations/-",
      value: {
        rel: "System.LinkTypes.Related",
        url: `${baseUrl}/_apis/wit/workItems/${relatedId}`,
        attributes: { comment: "Relacionado pelo Stark Hub" }
      }
    });
  }
  const childIds = String(item.childIds || "").split(/[,\s;]+/).map((id) => id.trim()).filter(Boolean);
  for (const childId of childIds) {
    patchOps.push({
      op: "add",
      path: "/relations/-",
      value: {
        rel: "System.LinkTypes.Hierarchy-Forward",
        url: `${baseUrl}/_apis/wit/workItems/${childId}`,
        attributes: { comment: "Vinculado como filho pelo Stark Hub" }
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

async function addWorkItemComment(baseUrl, authHeader, id, text) {
  const response = await fetch(`${baseUrl}/_apis/wit/workItems/${id}/comments?api-version=7.1-preview.4`, {
    method: "POST",
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  });

  if (response.ok) return { id, ok: true };
  const message = response.status === 401 ? "PAT invalido ou sem permissao." : `Azure DevOps retornou status ${response.status}.`;
  return { id, ok: false, error: message };
}

function bytesFromDataUrl(dataUrl) {
  const raw = String(dataUrl || "");
  const base64 = raw.includes("base64,") ? raw.split("base64,").pop() : raw;
  const binary = atob(base64 || "");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function uploadAttachment(baseUrl, project, authHeader, payload) {
  const fileName = String(payload.fileName || "evidence.png").replace(/[\\/:*?"<>|]+/g, "-");
  const bytes = bytesFromDataUrl(payload.dataUrl || payload.dataBase64);
  if (!bytes.length) return { ok: false, error: "Arquivo de evidencia vazio." };

  const response = await fetch(`${baseUrl}/${encodeURIComponent(project)}/_apis/wit/attachments?fileName=${encodeURIComponent(fileName)}&api-version=7.1`, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": payload.contentType || "application/octet-stream"
    },
    body: bytes
  });

  if (!response.ok) {
    const message = response.status === 401 ? "PAT invalido ou sem permissao." : `Azure DevOps retornou status ${response.status} ao anexar evidencia.`;
    return { ok: false, error: message };
  }
  const data = await response.json();
  return { ok: true, url: data.url, id: data.id };
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

  if (action === "comment") {
    if (!payload.id || !payload.text) return json({ ok: false, error: "ID e texto do comentario sao obrigatorios." }, 400);
    const result = await addWorkItemComment(baseUrl, authHeader, payload.id, payload.text);
    return json(result, result.ok ? 200 : 200);
  }
  if (action === "attachment") {
    if (!payload.dataUrl && !payload.dataBase64) return json({ ok: false, error: "Arquivo da evidencia e obrigatorio." }, 400);
    const result = await uploadAttachment(baseUrl, project, authHeader, payload);
    return json(result, result.ok ? 200 : 200);
  }

  return json({ ok: false, error: "Ação não suportada." }, 400);
});
