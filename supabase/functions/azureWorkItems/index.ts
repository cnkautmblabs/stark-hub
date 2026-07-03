// Edge Function: azureWorkItems
// Objetivo: buscar work items reais do Azure DevOps (WIQL + workitemsbatch),
// juntar com o responsável de QA (work_item_assignments) e o último
// resultado de teste (test_evidence) guardados no Supabase, e devolver a
// lista já normalizada no formato consumido por useWorkItems.js.
//
// Roda no servidor pelo mesmo motivo do testAzureConnection: a API do
// Azure DevOps não libera CORS para chamadas diretas do navegador.
//
// Deploy: supabase functions deploy azureWorkItems

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

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

// Estado do work item (System.State) -> ambiente exibido no board. Segue o
// modelo simplificado do Stark Hub (dev -> qa -> beta -> prod, ver
// utils/constants.js), não o modelo de 5 estágios do userscript legado
// (que só cobria a partir de "In QA").
const STATE_ENV_MAP = {
  "new": "dev",
  "active": "dev",
  "in dev": "dev",
  "in qa": "qa",
  "hmg cnk": "qa",
  "in beta": "beta",
  "ready to beta": "beta",
  "ready to prod": "prod",
  "in prod": "prod",
  "resolved": "prod",
  "closed": "prod"
};

function envForState(state) {
  const key = String(state || "").trim().toLowerCase();
  return STATE_ENV_MAP[key] || "dev";
}

// Convenção confirmada do userscript legado: país = tag no formato "0-XX"
// (ex.: "0-BR"). Qualquer outra tag é ignorada para fins de país.
function countriesFromTags(tagsField) {
  return String(tagsField || "")
    .split(";")
    .map((tag) => tag.trim())
    .map((tag) => tag.match(/^0-([A-Za-z]{2})$/))
    .filter(Boolean)
    .map((match) => match[1].toUpperCase());
}

function tagsList(tagsField) {
  return String(tagsField || "")
    .split(";")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function sprintFromIterationPath(path) {
  if (!path) return null;
  const parts = String(path).split("\\");
  return parts[parts.length - 1] || null;
}

const WORK_ITEM_FIELDS = [
  "System.Id",
  "System.Title",
  "System.State",
  "System.WorkItemType",
  "System.Tags",
  "System.AssignedTo",
  "System.IterationPath",
  "System.ChangedDate",
  "Microsoft.VSTS.Scheduling.CompletedWork"
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Método não suportado." }, 405);

  let payload;
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: "Corpo da requisição inválido." }, 400);
  }

  const { orgUrl, project, pat } = payload || {};
  if (!orgUrl || !project || !pat) {
    return json({ ok: false, error: "Conexão com Azure DevOps não configurada." }, 400);
  }

  const baseUrl = normalizeOrgUrl(orgUrl);
  const authHeader = `Basic ${btoa(`:${pat}`)}`;

  const wiql = `SELECT [System.Id] FROM WorkItems
    WHERE [System.TeamProject] = '${String(project).replace(/'/g, "''")}'
    AND [System.WorkItemType] IN ('Bug','Task','User Story','Feature')
    AND [System.State] NOT IN ('Removed','Closed')
    ORDER BY [System.ChangedDate] DESC`;

  let wiqlResponse;
  try {
    wiqlResponse = await fetch(`${baseUrl}/${encodeURIComponent(project)}/_apis/wit/wiql?$top=200&api-version=7.1`, {
      method: "POST",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ query: wiql })
    });
  } catch (err) {
    return json({ ok: false, error: `Falha ao conectar ao Azure DevOps: ${err.message}` }, 502);
  }

  if (wiqlResponse.status === 401 || wiqlResponse.status === 203) {
    return json({ ok: false, error: "Personal Access Token inválido ou sem permissão." });
  }
  if (!wiqlResponse.ok) {
    return json({ ok: false, error: `Azure DevOps retornou status ${wiqlResponse.status} na consulta WIQL.` });
  }

  const wiqlData = await wiqlResponse.json();
  const ids = (wiqlData.workItems || []).map((item) => item.id);
  if (!ids.length) return json({ ok: true, items: [] });

  const rawWorkItems = [];
  for (let offset = 0; offset < ids.length; offset += 200) {
    const chunk = ids.slice(offset, offset + 200);
    const batchResponse = await fetch(`${baseUrl}/_apis/wit/workitemsbatch?api-version=7.1`, {
      method: "POST",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ ids: chunk, fields: WORK_ITEM_FIELDS, errorPolicy: "Omit" })
    });
    if (!batchResponse.ok) continue;
    const batchData = await batchResponse.json();
    rawWorkItems.push(...(batchData.value || []));
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const incomingAuth = req.headers.get("Authorization") || "";

  // Client "do usuário": respeita RLS normalmente (leitura de collaborators/
  // work_item_assignments/test_evidence é liberada para qualquer autenticado).
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: incomingAuth } }
  });

  const workItemIds = rawWorkItems.map((wi) => wi.id);
  const [collaboratorsResult, assignmentsResult, evidenceResult] = await Promise.all([
    callerClient.from("collaborators").select("id, azureName"),
    callerClient.from("work_item_assignments").select("workItemId, qaCollaboratorId, lastKnownState"),
    workItemIds.length
      ? callerClient.from("test_evidence").select("workItemId, result, createdAt").in("workItemId", workItemIds).order("createdAt", { ascending: false })
      : Promise.resolve({ data: [] })
  ]);

  const collaboratorByAzureName = new Map(
    (collaboratorsResult.data || []).map((c) => [String(c.azureName || "").trim().toLowerCase(), c.id])
  );
  const assignmentByItemId = new Map((assignmentsResult.data || []).map((a) => [a.workItemId, a]));
  const lastResultByItemId = new Map();
  for (const row of evidenceResult.data || []) {
    if (!lastResultByItemId.has(row.workItemId)) lastResultByItemId.set(row.workItemId, row.result);
  }

  const staleAssignmentIds = [];
  const items = rawWorkItems.map((wi) => {
    const fields = wi.fields || {};
    const id = wi.id;
    const state = fields["System.State"];
    const assigneeName = fields["System.AssignedTo"]?.displayName || "";
    const assignment = assignmentByItemId.get(id);

    let qaCollaboratorId = assignment?.qaCollaboratorId || null;
    if (qaCollaboratorId && assignment?.lastKnownState && assignment.lastKnownState !== state) {
      qaCollaboratorId = null;
      staleAssignmentIds.push(id);
    }

    return {
      id,
      type: fields["System.WorkItemType"],
      title: fields["System.Title"],
      state,
      env: envForState(state),
      countries: countriesFromTags(fields["System.Tags"]),
      tags: tagsList(fields["System.Tags"]),
      sprint: sprintFromIterationPath(fields["System.IterationPath"]),
      completedHours: fields["Microsoft.VSTS.Scheduling.CompletedWork"] ?? null,
      assigneeId: collaboratorByAzureName.get(assigneeName.toLowerCase()) || null,
      qaCollaboratorId,
      lastTestResult: lastResultByItemId.get(id) || null,
      updatedAt: fields["System.ChangedDate"]
    };
  });

  if (staleAssignmentIds.length && serviceRoleKey) {
    const serviceClient = createClient(supabaseUrl, serviceRoleKey);
    await Promise.all(
      staleAssignmentIds.map((id) =>
        serviceClient.from("work_item_assignments").update({ qaCollaboratorId: null, lastKnownState: null }).eq("workItemId", id)
      )
    );
  }

  return json({ ok: true, items });
});
