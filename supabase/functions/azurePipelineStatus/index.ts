// Edge Function: azurePipelineStatus
// Objetivo: reproduzir a detecção de ambiente por Pipeline do userscript
// legado (getLatestCompletedPrStatus / buildPipelineDeploymentIndex): dado
// um conjunto de work item IDs e os nomes das pipelines de QA/BETA, procura
// nas execuções mais recentes de cada pipeline quais work items estão
// vinculados, e devolve o ambiente confirmado (ou em andamento) por item.
//
// Precisa que o PAT tenha o escopo Build: Read além de Work Items.
// Deploy: supabase functions deploy azurePipelineStatus

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

const ACTIVE_STATUSES = ["inprogress", "notstarted", "postponed", "cancelling"];
const SUCCESS_RESULTS = ["succeeded", "partiallysucceeded"];

function classifyBuild(build) {
  const status = String(build.status || "").toLowerCase();
  const result = String(build.result || "").toLowerCase();
  if (ACTIVE_STATUSES.includes(status)) return "active";
  if (status === "completed" && SUCCESS_RESULTS.includes(result)) return "succeeded";
  if (status === "completed") return "failed";
  return null;
}

// Prioridade: BETA concluído > BETA em andamento > QA concluído > QA em
// andamento > erro — mesma regra do userscript (buildPipelineDeploymentResult).
function rank(candidate) {
  const envScore = candidate.kind === "beta" ? 20 : 10;
  const statusScore = candidate.status === "completed" ? 2 : candidate.status === "active" ? 1 : 0;
  return envScore + statusScore;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Método não suportado." }, 405);

  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > 128_000) return json({ ok: false, error: "Payload muito grande para consultar pipelines." }, 413);

  let payload;
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: "Corpo da requisição inválido." }, 400);
  }

  const { orgUrl, project, pat, pipelineQaName, pipelineBetaName, workItemIds } = payload || {};
  if (!orgUrl || !project || !pat) return json({ ok: false, error: "Conexão com Azure DevOps não configurada." }, 400);

  const wantedIds = new Set((Array.isArray(workItemIds) ? workItemIds : []).map(Number).filter(Boolean));
  if (!wantedIds.size) return json({ ok: true, byWorkItemId: {} });

  const baseUrl = normalizeOrgUrl(orgUrl);
  if (!baseUrl) return json({ ok: false, error: "URL do Azure DevOps invalida. Use dev.azure.com ou *.visualstudio.com." }, 400);
  const authHeader = `Basic ${btoa(`:${pat}`)}`;
  const projectPath = `${baseUrl}/${encodeURIComponent(project)}`;

  async function azureGet(url) {
    const response = await fetch(url, { headers: { Authorization: authHeader } });
    if (response.status === 401 || response.status === 203) throw new Error("PAT inválido ou sem permissão Build: Read.");
    if (!response.ok) return null;
    return response.json();
  }

  async function findDefinitionId(name) {
    if (!String(name || "").trim()) return null;
    const data = await azureGet(`${projectPath}/_apis/build/definitions?name=${encodeURIComponent(name)}&$top=50&api-version=7.1`);
    const list = data?.value || [];
    const exact = list.find((d) => String(d.name).toLowerCase() === String(name).toLowerCase());
    return (exact || list[0])?.id || null;
  }

  async function fetchRecentBuilds(definitionId) {
    if (!definitionId) return [];
    const data = await azureGet(
      `${projectPath}/_apis/build/builds?definitions=${definitionId}&$top=40&queryOrder=queueTimeDescending&api-version=7.1`
    );
    return data?.value || [];
  }

  async function fetchBuildWorkItemIds(buildId) {
    const data = await azureGet(`${projectPath}/_apis/build/builds/${buildId}/workitems?$top=1000&api-version=7.1-preview.2`);
    return (data?.value || [])
      .map((ref) => Number(String(ref.id || ref.url || "").match(/(\d+)(?:\D*)$/)?.[1]))
      .filter(Boolean);
  }

  const pipelines = [
    { key: "qa", name: pipelineQaName },
    { key: "beta", name: pipelineBetaName }
  ].filter((entry) => String(entry.name || "").trim());

  if (!pipelines.length) return json({ ok: true, byWorkItemId: {}, warning: "Nenhuma pipeline de QA/BETA configurada." });

  const byWorkItemId = {};
  let authError = null;

  for (const pipeline of pipelines) {
    try {
      const definitionId = await findDefinitionId(pipeline.name);
      if (!definitionId) continue;
      const builds = await fetchRecentBuilds(definitionId);
      const relevantBuilds = builds.map((build) => ({ build, state: classifyBuild(build) })).filter((entry) => entry.state);

      // Limite de builds inspecionadas por pipeline para manter a resposta rápida.
      for (const { build, state } of relevantBuilds.slice(0, 15)) {
        let linkedIds;
        try {
          linkedIds = await fetchBuildWorkItemIds(build.id);
        } catch {
          continue;
        }
        for (const id of linkedIds) {
          if (!wantedIds.has(id)) continue;
          const candidate = {
            kind: pipeline.key,
            status: state === "succeeded" ? "completed" : state === "active" ? "active" : "error",
            buildNumber: build.buildNumber,
            definitionName: pipeline.name,
            url: `${projectPath}/_build/results?buildId=${build.id}&view=results`
          };
          const current = byWorkItemId[id];
          if (!current || rank(candidate) > rank(current)) byWorkItemId[id] = candidate;
        }
      }
    } catch (err) {
      authError = err.message;
    }
  }

  if (authError && !Object.keys(byWorkItemId).length) return json({ ok: false, error: authError });

  return json({ ok: true, byWorkItemId });
});
