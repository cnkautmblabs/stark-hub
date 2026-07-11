// Edge Function: azureHierarchyImport
// Objetivo: criar em lote uma árvore Epic > Feature > User Story > Task >
// Test Case no Azure DevOps a partir da árvore já parseada no cliente
// (ver src/utils/hierarchyImport.js), vinculando cada nível como filho do
// anterior. Diferente do importador nativo do Azure Boards, funciona para
// QUALQUER Work Item Type — inclusive "Test Case" (que o importador nativo
// bloqueia com "Forbidden work item type").
//
// Body: { orgUrl, project, pat, tree, defaults: { areaPath, iterationPath, countryField } }
// Deploy: supabase functions deploy azureHierarchyImport

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
  if (contentLength > 1_000_000) return json({ ok: false, error: "Payload de importacao muito grande." }, 413);

  let payload;
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: "Corpo da requisição inválido." }, 400);
  }

  const { orgUrl, project, pat, tree, defaults } = payload || {};
  if (!orgUrl || !project || !pat) return json({ ok: false, error: "Conexão com Azure DevOps não configurada." }, 400);
  if (!tree?.children?.length) return json({ ok: false, error: "Nenhum item reconhecido para importar." }, 400);

  const baseUrl = normalizeOrgUrl(orgUrl);
  if (!baseUrl) return json({ ok: false, error: "URL do Azure DevOps invalida. Use dev.azure.com ou *.visualstudio.com." }, 400);
  const authHeader = `Basic ${btoa(`:${pat}`)}`;
  const projectPath = `${baseUrl}/${encodeURIComponent(project)}`;
  const log = [];
  const counts = {};

  async function createNode(node, parentId, depth) {
    const opts = node.opts || {};
    const patchOps = [
      { op: "add", path: "/fields/System.Title", value: node.title },
      { op: "add", path: "/fields/System.AreaPath", value: opts.areaPath || defaults?.areaPath || "" },
      { op: "add", path: "/fields/System.IterationPath", value: opts.iterationPath || defaults?.iterationPath || "" }
    ].filter((p) => p.value);

    if (opts.tags) patchOps.push({ op: "add", path: "/fields/System.Tags", value: opts.tags });
    if (opts.description) patchOps.push({ op: "add", path: "/fields/System.Description", value: opts.description });
    if (opts.stepsXml) patchOps.push({ op: "add", path: "/fields/Microsoft.VSTS.TCM.Steps", value: opts.stepsXml });
    if (defaults?.countryField && opts.countryValue) patchOps.push({ op: "add", path: `/fields/${defaults.countryField}`, value: opts.countryValue });
    if (parentId) {
      patchOps.push({
        op: "add",
        path: "/relations/-",
        value: {
          rel: "System.LinkTypes.Hierarchy-Reverse",
          url: `${baseUrl}/_apis/wit/workItems/${parentId}`,
          attributes: { comment: "Criado pela Importação Hierárquica do Stark Hub" }
        }
      });
    }

    const indent = "  ".repeat(depth);
    try {
      const response = await fetch(`${projectPath}/_apis/wit/workitems/$${encodeURIComponent(node.type)}?api-version=7.1`, {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/json-patch+json" },
        body: JSON.stringify(patchOps)
      });
      if (!response.ok) {
        const message = response.status === 401 ? "PAT inválido ou sem permissão." : `Azure DevOps retornou status ${response.status}.`;
        log.push(`${indent}✗ Falha ao criar ${node.type} "${node.title}": ${message}`);
        counts.errors = (counts.errors || 0) + 1;
        return;
      }
      const data = await response.json();
      counts[node.type] = (counts[node.type] || 0) + 1;
      log.push(`${indent}✓ ${node.type} #${data.id} — ${node.title}`);
      for (const child of node.children || []) {
        await createNode(child, data.id, depth + 1);
      }
    } catch (err) {
      log.push(`${indent}✗ Erro inesperado ao criar "${node.title}": ${err.message}`);
      counts.errors = (counts.errors || 0) + 1;
    }
  }

  for (const child of tree.children) {
    await createNode(child, null, 0);
  }

  return json({ ok: true, counts, log });
});
