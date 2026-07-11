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

const KNOWN_CONTENT_FIELDS = new Set([
  "system.description",
  "microsoft.vsts.tcm.reprosteps",
  "microsoft.vsts.common.acceptancecriteria"
]);

// Processos customizados as vezes renomeiam/substituem os campos padrao de
// conteudo (ex.: Bug sem System.Description usando um campo proprio tipo
// "Custom.Descricao"). Mesma heuristica usada no fetch em lote de
// azureWorkItems — mantida aqui pra nao perder esse fallback ao mover a
// busca de conteudo pra sob demanda (ver comentario mais abaixo).
function findFallbackDescription(fields: Record<string, unknown>) {
  for (const [key, value] of Object.entries(fields || {})) {
    const lowerKey = key.toLowerCase();
    if (KNOWN_CONTENT_FIELDS.has(lowerKey)) continue;
    if (!/description|reprosteps|repro_steps|symptom|findingandrootcause|root.?cause/i.test(key)) continue;
    if (typeof value !== "string") continue;
    const text = value.trim();
    if (text.length > 10) return text;
  }
  return "";
}

// Conteudo (Description/Acceptance Criteria/Repro Steps) buscado sob
// demanda, junto com as discussions — antes ia embutido pra CADA item no
// fetch em lote de azureWorkItems, mas so e exibido quando o modal de UM
// item especifico abre. Campos ricos do Azure podem ter imagens coladas
// direto no HTML (base64), entao multiplicar isso por centenas de itens a
// cada load/auto-refresh do board pesava muito no egress do Supabase —
// mesmo motivo de discussions ja ser sob demanda aqui.
async function fetchItemContent(itemId: string | number, projectPath: string, authHeader: string) {
  try {
    const response = await fetch(
      `${projectPath}/_apis/wit/workitems/${encodeURIComponent(String(itemId))}?api-version=7.1`,
      { headers: { Authorization: authHeader } }
    );
    if (!response.ok) return { description: "", acceptanceCriteria: "", reproSteps: "" };
    const data = await response.json();
    const fields = data?.fields || {};
    const acceptanceCriteria = fields["Microsoft.VSTS.Common.AcceptanceCriteria"] || "";
    const reproSteps = fields["Microsoft.VSTS.TCM.ReproSteps"] || "";
    const description = fields["System.Description"]
      || (!reproSteps && !acceptanceCriteria ? findFallbackDescription(fields) : "")
      || "";
    return { description, acceptanceCriteria, reproSteps };
  } catch {
    return { description: "", acceptanceCriteria: "", reproSteps: "" };
  }
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
      const key = discussionDedupeKey(comment);
      const current = merged.get(key);
      if (!current || String(comment.createdAt || "").localeCompare(String(current.createdAt || "")) > 0) merged.set(key, comment);
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

  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > 128_000) return json({ ok: false, error: "Payload muito grande para buscar discussions." }, 413);

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
  if (!baseUrl) return json({ ok: false, error: "URL do Azure DevOps invalida. Use dev.azure.com ou *.visualstudio.com." }, 400);
  const authHeader = `Basic ${btoa(`:${pat}`)}`;
  const projectPath = `${baseUrl}/${encodeURIComponent(project)}`;

  const [discussions, content] = await Promise.all([
    fetchAllDiscussions(id, projectPath, authHeader, env),
    fetchItemContent(id, projectPath, authHeader)
  ]);
  const discussionEvidence = discussions
    .filter((comment) => comment.result)
    .map((comment) => normalizeEvidenceComment(comment, id, env));

  return json({ ok: true, discussions, discussionEvidence, content });
});
