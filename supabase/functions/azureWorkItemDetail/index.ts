// Edge Function: azureWorkItemDetail
// Objetivo: buscar as discussions (comentários) de UM work item especifico,
// sob demanda, quando o usuário abre o modal no Stark Hub.
//
// Por que isso existe separado de azureWorkItems: a busca de discussions em
// lote (uma chamada por item, dentro do fetch de toda a lista do board) nao
// escala — um board com 100+ itens dispara centenas de requisicoes ao Azure
// DevOps na MESMA chamada da Edge Function, o que estoura o tempo de
// execucao e devolve "discussions: []" silenciosamente para boa parte dos
// itens (nunca houve erro visivel, so um timeout por item cortando a busca
// antes de terminar). Buscar sob demanda, um item por vez, e rapido e
// confiavel — e o preco de "olhar" cada item vira so 1 chamada extra.
//
// Body esperado: { orgUrl, project, pat, id }
// Deploy: supabase functions deploy azureWorkItemDetail

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
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://dev.azure.com/${trimmed}`;
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

function detectEvidenceResult(htmlOrText) {
  const text = stripHtmlText(htmlOrText).toUpperCase().replace(/\s+/g, " ");
  if (/TEST(?:ING)?\s+LIMITATION\s+IN|\bLIMITATION\s+IN\b|\bLIMITATION\b/.test(text)) return "limitation";
  if (/TEST\s+FAILED\s+IN|\bFAIL(?:ED)?\s+IN\b|\bFAILED\b|\bFAIL\b/.test(text)) return "fail";
  if (/TEST\s+APPROVED\s+IN|\bAPPROVED\s+IN\b|\bAPPROVED\b|\bAPROVAD[OA]\b|\bPASS(?:ED)?\b/.test(text)) return "pass";
  return "";
}

function detectEvidenceEnvironments(htmlOrText, fallbackEnv) {
  const normalized = stripHtmlText(htmlOrText)
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

function normalizeDiscussionComment(comment, itemId, fallbackEnv) {
  const rawComment = comment?.renderedText || comment?.text || "";
  const author = comment.createdBy || comment.modifiedBy || {};
  const result = detectEvidenceResult(rawComment);
  return {
    id: `comment-${itemId}-${comment.id || comment.createdDate || ""}`,
    commentId: comment.id || null,
    workItemId: Number(itemId),
    html: rawComment,
    text: stripHtmlText(rawComment),
    result: result || null,
    environments: result ? detectEvidenceEnvironments(rawComment, fallbackEnv) : [],
    authorName: author.displayName || author.uniqueName || "Autor nao identificado",
    authorEmail: author.uniqueName || "",
    avatarUrl: author.imageUrl || author._links?.avatar?.href || "",
    createdAt: comment.createdDate || comment.modifiedDate || "",
    createdDate: comment.createdDate || comment.modifiedDate || "",
    modifiedAt: comment.modifiedDate || ""
  };
}

function normalizeDiscussionUpdate(update, itemId, fallbackEnv) {
  const rawComment = update?.fields?.["System.History"]?.newValue || "";
  if (!rawComment) return null;
  const author = update.revisedBy || {};
  const result = detectEvidenceResult(rawComment);
  return {
    id: `update-${itemId}-${update.id || update.rev || update.revisedDate || ""}`,
    commentId: update.id || update.rev || null,
    workItemId: Number(itemId),
    html: rawComment,
    text: stripHtmlText(rawComment),
    result: result || null,
    environments: result ? detectEvidenceEnvironments(rawComment, fallbackEnv) : [],
    authorName: author.displayName || author.uniqueName || "Autor nao identificado",
    authorEmail: author.uniqueName || "",
    avatarUrl: author.imageUrl || author._links?.avatar?.href || "",
    createdAt: update.revisedDate || "",
    createdDate: update.revisedDate || "",
    modifiedAt: update.revisedDate || ""
  };
}

function normalizeEvidenceComment(comment, itemId, fallbackEnv) {
  const environments = comment.environments?.length ? comment.environments : comment.environment ? [comment.environment] : [];
  return {
    id: `discussion-${itemId}-${comment.commentId || comment.id}`,
    commentId: comment.commentId,
    workItemId: Number(itemId),
    result: comment.result,
    status: comment.result,
    environments,
    environment: environments[0] || "N/A",
    authorName: comment.authorName,
    authorEmail: comment.authorEmail,
    avatarUrl: comment.avatarUrl,
    createdAt: comment.createdAt,
    createdDate: comment.createdAt,
    note: comment.text?.slice(0, 500) || "",
    html: comment.html,
    source: "azure-discussion"
  };
}

// Pagina ate acabar (sem limite artificial de paginas) — a lista de
// comentarios de UM item nunca chega perto de ser grande o bastante para
// isso virar um problema de performance, diferente de buscar isso para
// centenas de itens na mesma chamada.
async function fetchAllDiscussions(itemId, projectPath, authHeader, fallbackEnv) {
  const comments = [];
  let continuationToken = "";
  let page = 0;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);
  try {
    do {
      const suffix = continuationToken ? `&continuationToken=${encodeURIComponent(continuationToken)}` : "";
      const response = await fetch(
        `${projectPath}/_apis/wit/workItems/${encodeURIComponent(itemId)}/comments?$top=200${suffix}&api-version=7.1-preview.4`,
        { headers: { Authorization: authHeader }, signal: controller.signal }
      );
      if (!response.ok) break;
      const data = await response.json();
      comments.push(...(data.comments || data.value || []));
      continuationToken = data.continuationToken || "";
      page += 1;
    } while (continuationToken && page < 40);

    const updateResponse = await fetch(
      `${projectPath}/_apis/wit/workItems/${encodeURIComponent(itemId)}/updates?$top=200&api-version=7.1`,
      { headers: { Authorization: authHeader }, signal: controller.signal }
    );
    const fromUpdates = [];
    if (updateResponse.ok) {
      const updateData = await updateResponse.json();
      fromUpdates.push(...(updateData.value || [])
        .map((update) => normalizeDiscussionUpdate(update, itemId, fallbackEnv))
        .filter(Boolean));
    }

    const fromComments = comments
      .map((comment) => normalizeDiscussionComment(comment, itemId, fallbackEnv));
    const merged = new Map();
    [...fromComments, ...fromUpdates].forEach((comment) => {
      const key = `${comment.authorName || ""}-${comment.createdAt || ""}-${comment.text || stripHtmlText(comment.html).slice(0, 120)}`;
      if (!merged.has(key)) merged.set(key, comment);
    });
    return Array.from(merged.values())
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  } catch {
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
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

  const { orgUrl, project, pat, id, env } = payload || {};
  if (!orgUrl || !project || !pat || !id) {
    return json({ ok: false, error: "Parâmetros insuficientes para buscar discussions." }, 400);
  }

  const baseUrl = normalizeOrgUrl(orgUrl);
  const authHeader = `Basic ${btoa(`:${pat}`)}`;
  const projectPath = `${baseUrl}/${encodeURIComponent(project)}`;

  const discussions = await fetchAllDiscussions(id, projectPath, authHeader, env);
  const discussionEvidence = discussions
    .filter((comment) => comment.result)
    .map((comment) => normalizeEvidenceComment(comment, id, env));

  return json({ ok: true, discussions, discussionEvidence });
});
