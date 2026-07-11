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

function isWebAppMbLabsIteration(path) {
  const text = String(path || "").toLowerCase();
  return text.includes("webapp") && text.includes("mb labs");
}

function sprintFromIterationPath(path) {
  if (!path) return null;
  const parts = String(path).split("\\");
  const leaf = parts[parts.length - 1] || "";
  const match = leaf.match(/([A-Za-zÀ-ÿ]+)\s*\[?(20\d{2})\]?/i);
  if (!match) return leaf || null;
  const monthMap = {
    janeiro: "Jan", fevereiro: "Feb", marco: "Mar", "março": "Mar", abril: "Apr", maio: "May", junho: "Jun",
    julho: "Jul", agosto: "Aug", setembro: "Sep", outubro: "Oct", novembro: "Nov", dezembro: "Dec",
    january: "Jan", february: "Feb", march: "Mar", april: "Apr", may: "May", june: "Jun", july: "Jul",
    august: "Aug", september: "Sep", october: "Oct", november: "Nov", december: "Dec"
  };
  const month = monthMap[String(match[1]).toLowerCase()] || match[1].slice(0, 3);
  return `${month}${match[2].slice(-2)}`;
}

function stripHtmlText(value) {
  return String(value || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeDataSvgText(src: string) {
  if (!/^data:image\/svg\+xml/i.test(src || "")) return "";
  try {
    const payload = src.split(",", 2)[1] || "";
    const decoded = /;base64/i.test(src)
      ? decodeURIComponent(escape(atob(payload)))
      : decodeURIComponent(payload);
    return stripHtmlText(decoded);
  } catch {
    return "";
  }
}

function textWithImageLabels(htmlOrText) {
  return String(htmlOrText || "").replace(/<img\b[^>]*>/gi, (tag) => {
    const alt = tag.match(/\balt=(["'])(.*?)\1/i)?.[2] || "";
    const title = tag.match(/\btitle=(["'])(.*?)\1/i)?.[2] || "";
    const src = tag.match(/\bsrc=(["'])(.*?)\1/i)?.[2] || "";
    const svgText = decodeDataSvgText(src);
    return ` ${alt} ${title} ${svgText} `;
  });
}

const evidenceMarkerPattern = /TEST\s+APPROVED\s+IN|TEST\s+FAILED\s+IN|TESTING\s+LIMITATION\s+IN/i;

function evidenceHeadingText(htmlOrText) {
  const text = stripHtmlText(textWithImageLabels(htmlOrText)).replace(/\s+/g, " ");
  const marker = text.match(evidenceMarkerPattern);
  if (!marker) return "";
  return text
    .slice(marker.index || 0, (marker.index || 0) + 180)
    .split(/EVIDENCE|EVIDENCIA|MORE DETAILS|CONTEXT|CONTEXTO|BREAKPOINT|PROXIMO|NEXT STATUS/i)[0]
    .trim();
}

function detectEvidenceResult(htmlOrText) {
  const text = evidenceHeadingText(htmlOrText).toUpperCase().replace(/\s+/g, " ");
  if (/TESTING\s+LIMITATION\s+IN/.test(text)) return "limitation";
  if (/TEST\s+FAILED\s+IN/.test(text)) return "fail";
  if (/TEST\s+APPROVED\s+IN/.test(text)) return "pass";
  return "";
}

function detectEvidenceEnvironments(htmlOrText, fallbackEnv) {
  const heading = evidenceHeadingText(htmlOrText);
  if (!heading) return [];
  const normalized = heading
    .toUpperCase()
    .replace(/READY\s*TO\s*/g, "")
    .replace(/:(DEV|QA|BETA|PROD)-TAG:/g, " $1 ")
    .replace(/[\-_]/g, " ");
  const found = ["DEV", "QA", "BETA", "PROD"].filter((environment) =>
    new RegExp("(^|[^A-Z])" + environment + "([^A-Z]|$)", "i").test(normalized)
  );
  if (found.length) return found;
  return [];
}

function normalizeEvidenceComment(comment, item) {
  const rawComment = comment?.renderedText || comment?.text || "";
  const result = detectEvidenceResult(rawComment);
  if (!result) return null;
  const author = comment.createdBy || comment.modifiedBy || {};
  const environments = detectEvidenceEnvironments(rawComment, item.env);
  return {
    id: `discussion-${item.id}-${comment.id || comment.createdDate || ""}`,
    commentId: comment.id || null,
    workItemId: Number(item.id),
    result,
    status: result,
    environments,
    environment: environments[0] || "N/A",
    authorName: author.displayName || author.uniqueName || "QA nao identificado",
    authorEmail: author.uniqueName || "",
    avatarUrl: author.imageUrl || author._links?.avatar?.href || "",
    createdAt: comment.createdDate || comment.modifiedDate || "",
    createdDate: comment.createdDate || comment.modifiedDate || "",
    note: stripHtmlText(rawComment).slice(0, 500),
    html: rawComment,
    source: "azure-discussion"
  };
}

function normalizeDiscussionComment(comment, item) {
  const rawComment = comment?.renderedText || comment?.text || "";
  const author = comment.createdBy || comment.modifiedBy || {};
  const result = detectEvidenceResult(rawComment);
  return {
    id: `comment-${item.id}-${comment.id || comment.createdDate || ""}`,
    commentId: comment.id || null,
    workItemId: Number(item.id),
    html: rawComment,
    text: stripHtmlText(rawComment),
    result: result || null,
    environments: result ? detectEvidenceEnvironments(rawComment, item.env) : [],
    authorName: author.displayName || author.uniqueName || "Autor nao identificado",
    authorEmail: author.uniqueName || "",
    avatarUrl: author.imageUrl || author._links?.avatar?.href || "",
    createdAt: comment.createdDate || comment.modifiedDate || "",
    createdDate: comment.createdDate || comment.modifiedDate || "",
    modifiedAt: comment.modifiedDate || ""
  };
}

function normalizeDiscussionUpdate(update, item) {
  const rawComment = update?.fields?.["System.History"]?.newValue || "";
  if (!rawComment) return null;
  const author = update.revisedBy || {};
  const result = detectEvidenceResult(rawComment);
  return {
    id: `update-${item.id}-${update.id || update.rev || update.revisedDate || ""}`,
    commentId: update.id || update.rev || null,
    workItemId: Number(item.id),
    html: rawComment,
    text: stripHtmlText(rawComment),
    result: result || null,
    environments: result ? detectEvidenceEnvironments(rawComment, item.env) : [],
    authorName: author.displayName || author.uniqueName || "Autor nao identificado",
    authorEmail: author.uniqueName || "",
    avatarUrl: author.imageUrl || author._links?.avatar?.href || "",
    createdAt: update.revisedDate || "",
    createdDate: update.revisedDate || "",
    modifiedAt: update.revisedDate || ""
  };
}

function normalizedEvidenceSignatureText(comment) {
  const text = stripHtmlText(comment?.html || comment?.text || "")
    .toUpperCase()
    .replace(/\d{1,2}\/\d{1,2}\/\d{4}[,\s]+\d{1,2}:\d{2}(?::\d{2})?/g, "")
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, 900);
}

function discussionDedupeKey(comment) {
  const envs = Array.isArray(comment?.environments) ? comment.environments.slice().sort().join("/") : "";
  const result = comment?.result || "";
  const author = String(comment?.authorEmail || comment?.authorName || "").toLowerCase().trim();
  const images = Array.from(String(comment?.html || "").matchAll(/<img\b[^>]*\bsrc=(["'])(.*?)\1/gi))
    .map((match) => match[2])
    .filter((src) => !/^data:image\/svg\+xml/i.test(src))
    .slice(0, 4)
    .join("|");
  return [result, envs, author, normalizedEvidenceSignatureText(comment), images].join("::");
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const output = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, worker));
  return output;
}

async function fetchDiscussionsForItem(item, projectPath, authHeader) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2500);
  try {
    const comments = [];
    let continuationToken = "";
    for (let page = 0; page < 1; page += 1) {
      const suffix = continuationToken ? `&continuationToken=${encodeURIComponent(continuationToken)}` : "";
      const response = await fetch(
        `${projectPath}/_apis/wit/workItems/${encodeURIComponent(item.id)}/comments?$top=200${suffix}&api-version=7.1-preview.4`,
        { headers: { Authorization: authHeader }, signal: controller.signal }
      );
      if (!response.ok) break;
      const data = await response.json();
      comments.push(...(data.comments || data.value || []));
      continuationToken = data.continuationToken || "";
      if (!continuationToken) break;
    }
    const updateResponse = await fetch(
      `${projectPath}/_apis/wit/workItems/${encodeURIComponent(item.id)}/updates?$top=200&api-version=7.1`,
      { headers: { Authorization: authHeader }, signal: controller.signal }
    );
    if (updateResponse.ok) {
      const updateData = await updateResponse.json();
      comments.push(...((updateData.value || []).map((update) => normalizeDiscussionUpdate(update, item)).filter(Boolean)));
    }
    const merged = new Map();
    comments
      .map((comment) => comment?.workItemId && comment?.html ? comment : normalizeDiscussionComment(comment, item))
      .filter(Boolean)
      .forEach((comment) => {
        const key = discussionDedupeKey(comment);
        const current = merged.get(key);
        if (!current || String(comment.createdAt || "").localeCompare(String(current.createdAt || "")) > 0) merged.set(key, comment);
      });
    return Array.from(merged.values()).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  } catch {
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchEvidenceForItem(item, projectPath, authHeader) {
  const discussions = await fetchDiscussionsForItem(item, projectPath, authHeader);
  return discussions
    .filter((comment) => comment.result)
    .map((comment) => normalizeEvidenceComment({
      id: comment.commentId,
      renderedText: comment.html,
      text: comment.text,
      createdBy: { displayName: comment.authorName, uniqueName: comment.authorEmail, imageUrl: comment.avatarUrl },
      createdDate: comment.createdAt,
      modifiedDate: comment.modifiedAt
    }, item));
}

function pullRequestFromRelations(relations, projectPath) {
  for (const relation of relations || []) {
    const candidates = [relation?.url, relation?.attributes?.resource, relation?.attributes?.comment].filter(Boolean).map(String);
    for (const raw of candidates) {
      const variants = [raw];
      try { variants.push(decodeURIComponent(raw)); } catch (_) {}
      for (const candidate of variants) {
        const normalized = candidate.replace(/%2F/ig, "/");
        const match = normalized.match(/PullRequestId\/([^/]+)\/([^/]+)\/(\d+)/i)
          || normalized.match(/Git\/PullRequestId\/([^/]+)\/([^/]+)\/(\d+)/i)
          || normalized.match(/repositories\/([^/]+)\/pullRequests\/(\d+)/i);
        if (match) {
          const repositoryId = match.length === 4 ? match[2] : match[1];
          const pullRequestId = Number(match.length === 4 ? match[3] : match[2]);
          if (repositoryId && pullRequestId) {
            return { prId: pullRequestId, prUrl: `${projectPath}/_git/${encodeURIComponent(repositoryId)}/pullrequest/${encodeURIComponent(pullRequestId)}` };
          }
        }
      }
    }
  }
  return {};
}

// Description/AcceptanceCriteria/ReproSteps (e o fallback de campo de
// conteudo customizado que existia aqui) saíram do fetch em lote — ver
// `fetchItemContent`/`findFallbackDescription` em azureWorkItemDetail, que
// busca isso sob demanda so pro item aberto no modal.

const WORK_ITEM_FIELDS = [
  "System.Id",
  "System.Title",
  "System.State",
  "System.WorkItemType",
  "System.Tags",
  "System.AssignedTo",
  "System.IterationPath",
  "System.AreaPath",
  "System.CreatedDate",
  "System.CreatedBy",
  "System.ChangedDate",
  "System.ChangedBy",
  "System.Reason",
  "System.Parent",
  "Microsoft.VSTS.Common.Priority",
  "Microsoft.VSTS.Common.Severity",
  "Microsoft.VSTS.Common.ValueArea",
  "Microsoft.VSTS.Scheduling.OriginalEstimate",
  "Microsoft.VSTS.Scheduling.CompletedWork",
  "Microsoft.VSTS.Scheduling.RemainingWork"
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Método não suportado." }, 405);

  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > 256_000) return json({ ok: false, error: "Payload muito grande para consulta do Azure." }, 413);

  let payload;
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: "Corpo da requisição inválido." }, 400);
  }

  const { orgUrl, project, pat, team, iterationPattern, customQuery, maxItems, includeClosed } = payload || {};
  if (!orgUrl || !project || !pat) {
    return json({ ok: false, error: "Conexão com Azure DevOps não configurada." }, 400);
  }

  const baseUrl = normalizeOrgUrl(orgUrl);
  if (!baseUrl) return json({ ok: false, error: "URL do Azure DevOps invalida. Use dev.azure.com ou *.visualstudio.com." }, 400);
  const authHeader = `Basic ${btoa(`:${pat}`)}`;
  const projectPath = `${baseUrl}/${encodeURIComponent(project)}`;

  // Mesma estratégia do userscript legado (ensureSprintsLoaded): tenta as
  // iterations do TIME primeiro (mais preciso), mas nunca trava nisso — o
  // nome exato do Time na API do Azure nem sempre bate com o nome visível
  // na UI. Se falhar, cai para a árvore de iterations do projeto inteiro
  // (classificationnodes, que sempre funciona) e filtra pelo padrão de
  // nome configurado (ex.: "MB Labs") — exatamente a convenção que o
  // userscript usava (inferIterationFromPage/isMbLabsIterationPath).
  let allPaths = [];
  let usedTeamScope = false;

  if (team) {
    try {
      const teamResponse = await fetch(
        `${projectPath}/${encodeURIComponent(team)}/_apis/work/teamsettings/iterations?api-version=7.1`,
        { headers: { Authorization: authHeader } }
      );
      if (teamResponse.ok) {
        const teamData = await teamResponse.json();
        const teamPaths = (teamData.value || []).map((it) => it.path).filter(Boolean);
        if (teamPaths.length) {
          allPaths = teamPaths;
          usedTeamScope = true;
        }
      }
    } catch {
      // Time não encontrado/indisponível: segue para o fallback abaixo.
    }
  }

  if (!usedTeamScope) {
    try {
      const nodesResponse = await fetch(
        `${projectPath}/_apis/wit/classificationnodes/iterations?$depth=6&api-version=7.1`,
        { headers: { Authorization: authHeader } }
      );
      if (nodesResponse.status === 401 || nodesResponse.status === 203) {
        return json({ ok: false, error: "PAT inválido ou sem permissão para ler as iterations do projeto." });
      }
      if (!nodesResponse.ok) {
        return json({ ok: false, error: `Não foi possível listar as iterations do projeto (status ${nodesResponse.status}).` });
      }
      const nodesData = await nodesResponse.json();
      const flattened = [];
      (function walk(node, parentPath) {
        if (!node) return;
        const path = parentPath ? `${parentPath}\\${node.name}` : node.name;
        flattened.push(path);
        (node.children || []).forEach((child) => walk(child, path));
      })(nodesData, "");
      allPaths = flattened;
    } catch (err) {
      return json({ ok: false, error: `Falha ao listar iterations do projeto: ${err.message}` }, 502);
    }
  }

  const webAppMbLabsPaths = allPaths.filter(isWebAppMbLabsIteration);
  const baseScopedPaths = webAppMbLabsPaths.length ? webAppMbLabsPaths : [];
  const pattern = String(iterationPattern || "MB Labs").trim().toLowerCase();
  const scopedPaths = pattern ? baseScopedPaths.filter((path) => path.toLowerCase().includes(pattern)) : baseScopedPaths;

  // Um padrão configurado que não bate com NADA é quase sempre erro de
  // digitação — melhor travar aqui com um aviso claro do que devolver o
  // projeto inteiro sem avisar (foi esse silêncio que vazou a Lenio Labs).
  if (pattern && !scopedPaths.length) {
    return json({ ok: false, error: `Nenhuma sprint WebApp MB Labs contém "${iterationPattern || "MB Labs"}". A busca global foi limitada a WebApp + MB Labs.` });
  }
  if (!scopedPaths.length) {
    return json({ ok: false, error: "Não foi possível determinar sprints WebApp MB Labs no projeto." });
  }

  const iterationClause = `AND (${scopedPaths.map((path) => `[System.IterationPath] UNDER '${path.replace(/'/g, "''")}'`).join(" OR ")})`;

  // Filtro de tipo/estado é customizável em Configurações (mesmo espírito do
  // "customQuery" do userscript legado), mas o escopo de projeto/iteration
  // acima é SEMPRE aplicado por cima — nunca fica a critério da query
  // customizada, pelo mesmo motivo do resto do arquivo (vazamento Lenio Labs).
  const defaultFilter = `[System.WorkItemType] IN ('Bug','Task','User Story','Feature') AND [System.State] NOT IN ('Removed','Closed')`;
  const filterBody = String(customQuery || "").trim() || defaultFilter;
  const topN = Math.min(Math.max(parseInt(maxItems, 10) || 200, 1), 2000);

  const wiql = `SELECT [System.Id] FROM WorkItems
    WHERE [System.TeamProject] = '${String(project).replace(/'/g, "''")}'
    AND (${filterBody})
    ${iterationClause}
    ORDER BY [System.ChangedDate] DESC`;

  let wiqlResponse;
  try {
    wiqlResponse = await fetch(`${baseUrl}/${encodeURIComponent(project)}/_apis/wit/wiql?$top=${topN}&api-version=7.1`, {
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
    if (wiqlResponse.status === 400 && String(customQuery || "").trim()) {
      return json({ ok: false, error: "A condição WIQL personalizada em Configurações é inválida. Confira a sintaxe (sem SELECT/WHERE, só a condição) e tente de novo." });
    }
    return json({ ok: false, error: `Azure DevOps retornou status ${wiqlResponse.status} na consulta WIQL.` });
  }

  const wiqlData = await wiqlResponse.json();
  const ids = (wiqlData.workItems || []).map((item) => item.id);
  if (!ids.length) return json({ ok: true, items: [] });

  const rawWorkItems = [];
  for (let offset = 0; offset < ids.length; offset += 200) {
    const chunk = ids.slice(offset, offset + 200);
    // Restringe aos campos realmente usados na lista (fields: WORK_ITEM_FIELDS)
    // em vez de $expand "All" (todos os campos do processo, inclusive os
    // customizados e o texto rico de descricao/criterios/repro) — o board
    // inteiro nunca usou mais que esses campos nomeados, e o fallback de
    // "campo de conteudo renomeado" que justificava buscar tudo foi movido
    // pro fetch sob demanda de 1 item (azureWorkItemDetail), que roda so
    // quando o modal daquele item abre. $expand "Relations" ainda traz o
    // link de Pull Request usado no pill de PR/Pipeline.
    const batchResponse = await fetch(`${baseUrl}/_apis/wit/workitemsbatch?api-version=7.1`, {
      method: "POST",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ ids: chunk, fields: WORK_ITEM_FIELDS, errorPolicy: "Omit", $expand: "Relations" })
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
    callerClient.from("collaborators_profile").select("id, azureName"),
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
    const assigneeImageUrl = fields["System.AssignedTo"]?.imageUrl || fields["System.AssignedTo"]?._links?.avatar?.href || "";
    const assignment = assignmentByItemId.get(id);
    const prInfo = pullRequestFromRelations(wi.relations || [], projectPath);

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
      areaPath: fields["System.AreaPath"] || null,
      createdAt: fields["System.CreatedDate"] || null,
      createdBy: fields["System.CreatedBy"]?.displayName || null,
      changedBy: fields["System.ChangedBy"]?.displayName || null,
      reason: fields["System.Reason"] || null,
      priority: fields["Microsoft.VSTS.Common.Priority"] ?? null,
      severity: fields["Microsoft.VSTS.Common.Severity"] || null,
      valueArea: fields["Microsoft.VSTS.Common.ValueArea"] || null,
      originalEstimate: fields["Microsoft.VSTS.Scheduling.OriginalEstimate"] ?? null,
      completedHours: fields["Microsoft.VSTS.Scheduling.CompletedWork"] ?? null,
      remainingHours: fields["Microsoft.VSTS.Scheduling.RemainingWork"] ?? null,
      // Description/AcceptanceCriteria/ReproSteps saíram daqui (podem ter
      // imagens coladas em base64 no HTML, multiplicado por centenas de
      // itens isso pesava muito no egress) — agora só vêm sob demanda pelo
      // fetch de 1 item (azureWorkItemDetail), quando o modal abre.
      // O nome bruto do Azure SEMPRE vai junto, mesmo sem colaborador
      // cadastrado — o userscript legado nunca escondia o "Assigned To" só
      // porque a pessoa não tinha avatar/cor configurados; ele mostrava o
      // nome puro. Aqui, assigneeId só existe quando bate um colaborador
      // cadastrado (pra avatar/cor); assigneeName é o fallback de exibição.
      assigneeId: collaboratorByAzureName.get(assigneeName.toLowerCase()) || null,
      assigneeName: assigneeName || null,
      assigneeImageUrl,
      qaCollaboratorId,
      lastTestResult: lastResultByItemId.get(id) || null,
      discussionEvidence: [],
      discussions: [],
      parentId: fields["System.Parent"] || null,
      parent: null,
      url: `${projectPath}/_workitems/edit/${id}`,
      prId: prInfo.prId || null,
      prUrl: prInfo.prUrl || "",
      updatedAt: fields["System.ChangedDate"]
    };
  });

  // Parent (ex.: Feature) so aparece na mensagem do Slack como uma linha
  // curta (tag + id, sem titulo) — igual ao userscript legado. System.Parent
  // devolve so o ID; busca em lote so os campos minimos dos pais unicos.
  const parentIds = Array.from(new Set(items.map((item) => item.parentId).filter(Boolean)));
  if (parentIds.length) {
    const parentBatchResponse = await fetch(`${baseUrl}/_apis/wit/workitemsbatch?api-version=7.1`, {
      method: "POST",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ ids: parentIds, fields: ["System.Id", "System.Title", "System.WorkItemType"], errorPolicy: "Omit" })
    });
    if (parentBatchResponse.ok) {
      const parentBatchData = await parentBatchResponse.json();
      const parentById = new Map((parentBatchData.value || []).map((wi) => [wi.id, {
        id: wi.id,
        type: wi.fields?.["System.WorkItemType"],
        title: wi.fields?.["System.Title"],
        url: `${projectPath}/_workitems/edit/${wi.id}`
      }]));
      items.forEach((item) => {
        if (item.parentId) item.parent = parentById.get(item.parentId) || null;
      });
    }
  }

  // Pass rate/result rate dependem de discussionEvidence para enxergar
  // resultados que os QAs postam direto como comentario no Azure (fluxo
  // legado do tampermonkey), nao so os gravados via test_evidence pelo
  // proprio Stark Hub. Antes, `includeClosed` (usado pelo Dash executivo/
  // Governanca) zerava esse fetch por completo (discussionLimit = 0) e o
  // board normal so buscava os 20 primeiros itens da lista bruta — que
  // raramente sao os testaveis (Bug/User Story), entao a metrica caia pra
  // test_evidence vazio e aparecia 0% mesmo com muitos testes registrados
  // em discussion. Agora sempre prioriza Bug/User Story (unicos tipos que
  // entram em pass rate) dentro do teto de itens buscados.
  const testableTypes = new Set(["Bug", "User Story"]);
  const discussionCap = includeClosed ? Math.min(items.length, 80) : Math.min(items.length, 40);
  const prioritizedItems = [
    ...items.filter((item) => testableTypes.has(item.type)),
    ...items.filter((item) => !testableTypes.has(item.type))
  ].slice(0, discussionCap);
  const itemById = new Map(items.map((item) => [item.id, item]));
  const discussionsPromise = mapWithConcurrency(
    prioritizedItems,
    12,
    async (item) => ({ id: item.id, discussions: await fetchDiscussionsForItem(item, projectPath, authHeader) })
  );
  const discussionResults = discussionCap
    ? await Promise.race([
        discussionsPromise,
        new Promise((resolve) => setTimeout(() => resolve([]), 12000))
      ])
    : [];
  for (const result of discussionResults) {
    const item = result && itemById.get(result.id);
    if (!item) continue;
    const discussions = result.discussions || [];
    const records = discussions
      .filter((comment) => comment.result)
      .map((comment) => normalizeEvidenceComment({
        id: comment.commentId,
        renderedText: comment.html,
        text: comment.text,
        createdBy: { displayName: comment.authorName, uniqueName: comment.authorEmail, imageUrl: comment.avatarUrl },
        createdDate: comment.createdAt,
        modifiedDate: comment.modifiedAt
      }, item))
      .filter(Boolean);
    // So `discussionEvidence` (recorte pequeno, so os comentarios que batem
    // com o padrao TEST APPROVED/FAILED/LIMITATION) vai pro board inteiro —
    // precisa dele pra pass rate/result rate. Os comentarios crus completos
    // (`discussions`, todo o historico de conversa do item) NAO sao mais
    // embutidos aqui: pesavam muito multiplicado por ate 80 itens a cada
    // load/auto-refresh, e so eram usados como fallback temporario no modal
    // de 1 item, que ja busca isso sozinho via `azureWorkItemDetail`.
    item.discussionEvidence = records;
    if (records[0]?.result) item.lastTestResult = records[0].result;
  }

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
