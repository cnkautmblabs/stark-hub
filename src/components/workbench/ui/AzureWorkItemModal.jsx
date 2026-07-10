import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase, isSupabaseConfigured } from "../../../lib/supabaseClient.js";
import { azureWorkItemUrl } from "../../../utils/azure.js";
import { countries, formatWorkItemCode } from "../../../utils/constants.js";
import { compactSprintLabel } from "../../../utils/sprints.js";
import { buildLegacyQaResultSlackText, buildQaResultDiscussionHtml, legacyMention, limitationContextTemplate } from "../../../utils/slackReport.js";
import { buildCollaboratorNameIndex, evidenceDedupeKey, evidenceEnvironmentOrder, evidenceEnvironments, evidenceResultInfo, findCollaboratorByName, isQaEvidenceEntry } from "../../../utils/workbench/formatters.js";
import { useCollaborators } from "../../../hooks/useCollaborators.js";
import { useAuth } from "../../../contexts/AuthContext.jsx";
import { useToast } from "../../../contexts/ToastContext.jsx";
import { CountryVisual, EnvBadge, IdentityAvatar, QaPicker, ResultBadge, TypeBadge, envIconSrc, typeIconSrc } from "./WorkbenchPrimitives.jsx";
import { buildApiCacheKey, readApiCache, stableSignature, withInflight, writeApiCache } from "../../../utils/localApiCache.js";

const TASK_BEARING_TYPES = ["Bug", "User Story"];

function isCountryTag(tag) {
  return /^0-([A-Z]{2})$/i.test(String(tag || "").trim());
}

const WORK_ITEM_DETAIL_CACHE_TTL_MS = 2 * 60 * 1000;

export function workItemUrl(profile, item) {
  return item.url || azureWorkItemUrl(profile?.azureOrgUrl, profile?.azureProject, item.id);
}

function azureEditableUrl(profile, item) {
  const url = workItemUrl(profile, item);
  if (!url) return "";
  return url.includes("?") ? `${url}&_a=edit` : `${url}?_a=edit`;
}

// Imagens anexadas ao Work Item (_apis/wit/attachments/...) exigem o mesmo
// Basic auth (PAT) de qualquer outra chamada do Azure DevOps — mas um <img
// src> do navegador nunca manda esse header, entao a imagem sempre quebra
// (icone de imagem quebrada). Sem um proxy autenticado no backend nao da
// pra exibir a imagem inline; o proximo melhor passo e deixar clicavel para
// abrir direto no Azure, onde a sessao do navegador ja autentica.
function wrapAzureAttachmentImages(html) {
  return html.replace(/<img\b([^>]*?)\bsrc=(["'])([^"']*_apis[^"']*)\2([^>]*)>/gi, (match, before, quote, src, after) => {
    if (/<a\s/i.test(before)) return match;
    return `<a href="${src}" target="_blank" rel="noopener noreferrer" title="Abrir anexo no Azure (imagens do Azure nao carregam aqui por exigirem autenticacao)"><img${before}src=${quote}${src}${quote}${after} onerror="this.closest('a').classList.add('mbaz-broken-attachment')"></a>`;
  });
}

function sanitizeAzureHtml(value) {
  return wrapAzureAttachmentImages(
    String(value || "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/\son\w+="[^"]*"/gi, "")
      .replace(/\son\w+='[^']*'/gi, "")
      .replace(/\s(href|src)=["']javascript:[^"']*["']/gi, "")
      .replace(/<a\s/gi, '<a target="_blank" rel="noopener noreferrer" ')
      .trim()
  );
}

function RichAzureHtml({ html }) {
  if (!html) return null;
  return <div className="mbaz-new-modal-rich-html" dangerouslySetInnerHTML={{ __html: sanitizeAzureHtml(html) }} />;
}

// Evidencias escritas pelo userscript legado nao sao HTML real: sao texto
// puro com uma convencao propria de markdown (**negrito** e ![alt](url) para
// imagem). Escapa primeiro (nunca confiar em texto vindo do Azure) e so
// depois converte essa convencao em tags reais, para exibir formatado em vez
// da sintaxe crua.
function legacyEvidenceToHtml(raw) {
  if (!raw) return "";
  return String(raw)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '<img src="$2" alt="$1" />')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br/>");
}

// Discussions do Azure podem ser HTML de verdade (comentario digitado no
// editor rico do Azure) OU texto puro na convencao do userscript legado
// (**negrito**, ![alt](url)) — sao indistinguiveis pelo campo de origem,
// entao decide pelo CONTEUDO: se ja tem uma tag HTML de verdade, deixa
// passar como HTML (so sanitiza); senao, assume a convencao legada e
// converte antes de exibir.
function renderAzureCommentHtml(raw) {
  const text = String(raw || "");
  if (/<[a-z][\s\S]*>/i.test(text)) return text;
  return legacyEvidenceToHtml(text);
}

function SlackPreview({ text }) {
  const tokenMap = {
    ":us-tag:": <img src={typeIconSrc("User Story")} alt="US" />,
    ":bug-tag:": <img src={typeIconSrc("Bug")} alt="Bug" />,
    ":task-tag:": <img src={typeIconSrc("Task")} alt="Task" />,
    ":feature-tag:": <img src={typeIconSrc("Feature")} alt="Feature" />,
    ":epic-tag:": <img src={typeIconSrc("Epic")} alt="Epic" />,
    ":test-tag:": <img src={typeIconSrc("Test Case")} alt="Test" />,
    ":qa-tag:": <img src={envIconSrc("QA")} alt="QA" />,
    ":dev-tag:": <img src={envIconSrc("DEV")} alt="DEV" />,
    ":beta-tag:": <img src={envIconSrc("BETA")} alt="BETA" />,
    ":prod-tag:": <img src={envIconSrc("PROD")} alt="PROD" />
  };
  const flagMatch = /^:flag-([a-z]{2}):$/i;
  // Split pelo proprio delimitador ":token:" (nao por espaco) — assim um
  // ":flag-br:." (flag colada num ponto final, sem espaco, como a propria
  // mensagem gera) ainda separa o token da pontuacao em vez de falhar o
  // match exato e mostrar o alias cru na previa.
  return (
    <div className="mbaz-slack-preview">
      {String(text || "").split("\n").map((line, index) => (
        <p key={`${line}-${index}`}>
          {line.split(/(:[a-z0-9-]+:)/gi).map((part, partIndex) => {
            if (tokenMap[part]) return <span key={partIndex} className="mbaz-slack-token">{tokenMap[part]}</span>;
            const match = part.match(flagMatch);
            if (match) return <span key={partIndex} className="mbaz-slack-token"><CountryVisual code={match[1].toUpperCase()} compact /></span>;
            return <span key={partIndex}>{part}</span>;
          })}
        </p>
      ))}
    </div>
  );
}

// Enhanced Slack preview that supports clickable Slack links, attachments and
// a raw-toggle to show the underlying Slack text (tokens like :us-tag:).
function EnhancedSlackPreview({ text, item, attachments = [], collaborators = [] }) {
  const { t } = useTranslation();
  const tokenMap = {
    ":us-tag:": <img src={typeIconSrc("User Story")} alt="US" />,
    ":bug-tag:": <img src={typeIconSrc("Bug")} alt="Bug" />,
    ":task-tag:": <img src={typeIconSrc("Task")} alt="Task" />,
    ":feature-tag:": <img src={typeIconSrc("Feature")} alt="Feature" />,
    ":epic-tag:": <img src={typeIconSrc("Epic")} alt="Epic" />,
    ":test-tag:": <img src={typeIconSrc("Test Case")} alt="Test" />,
    ":qa-tag:": <img src={envIconSrc("QA")} alt="QA" />,
    ":dev-tag:": <img src={envIconSrc("DEV")} alt="DEV" />,
    ":beta-tag:": <img src={envIconSrc("BETA")} alt="BETA" />,
    ":prod-tag:": <img src={envIconSrc("PROD")} alt="PROD" />
  };

  const flagMatch = /^:flag-([a-z]{2}):$/i;

  function resolveMemberName(memberId) {
    if (!memberId) return memberId;
    const found = (collaborators || []).find((p) => String(p.slackMemberId) === String(memberId) || String(p.slackId) === String(memberId));
    // A previa e um "melhor palpite" de como a mencao vai aparecer no Slack
    // de verdade — o nome que o Slack realmente mostra e o nome cadastrado
    // la, entao a previa deve priorizar slackName, nao azureName.
    return found ? (found.slackName || found.azureName || found.email || memberId) : memberId;
  }

  // Troca o numero cru pelo codigo com prefixo de tipo (ex.: "38309" ->
  // "BUG38309") so pra ficar mais legivel na previa — o texto de verdade
  // enviado ao Slack usa so o numero (fiel ao legado), isso nao altera isso.
  function typedLabel(label, refItem) {
    if (!refItem?.id || !label.startsWith(String(refItem.id))) return null;
    return formatWorkItemCode(refItem.id, refItem.type) + label.slice(String(refItem.id).length);
  }

  function renderPart(part, i) {
    // Slack link syntax: <url|label>
    const linkMatch = part.match(/^<([^|>]+)\|([^>]+)>$/);
    if (linkMatch) {
      const href = linkMatch[1];
      const rawLabel = linkMatch[2];
      const label = typedLabel(rawLabel, item) || typedLabel(rawLabel, item?.parent) || rawLabel;
      return <a key={i} className="mbaz-slack-link" href={href} target="_blank" rel="noopener noreferrer">{label}</a>;
    }
    if (tokenMap[part]) return <span key={i} className="mbaz-slack-token">{tokenMap[part]}</span>;
    const fm = part.match(flagMatch);
    if (fm) return <span key={i} className="mbaz-slack-token"><CountryVisual code={fm[1].toUpperCase()} compact /></span>;
    // mentions like <@U12345>
    const mentionMatch = part.match(/^<@([^>]+)>$/);
    if (mentionMatch) {
      const memberId = mentionMatch[1];
      const name = resolveMemberName(memberId);
      const href = `https://slack.com/team/${memberId}`;
      return (
        <a key={i} className="mbaz-slack-mention" href={href} target="_blank" rel="noopener noreferrer">@{name}</a>
      );
    }
    // Item/pai sem URL (ex.: work item local/demo) vira texto puro no lugar
    // de link — mesma troca do numero pelo codigo tipado, so que sem o <a>.
    const trimmed = part.trimStart();
    const leading = part.match(/^\s*/)[0];
    const plainTyped = typedLabel(trimmed, item) || typedLabel(trimmed, item?.parent);
    if (plainTyped) return <span key={i}>{leading}{plainTyped}</span>;
    return <span key={i}>{part}</span>;
  }

  return (
    <div className="mbaz-slack-preview-split">
      <div className="mbaz-slack-preview-block">
        <small>{t("workItemModal.codePreview")}</small>
        <pre className="mbaz-slack-raw">{String(text || "")}</pre>
      </div>
      <div className="mbaz-slack-preview-block">
        <small>{t("workItemModal.livePreview")}</small>
        <div className="mbaz-slack-preview enhanced">
          {String(text || "").split("\n").map((line, idx) => (
            <p key={idx}>
              {line.split(/(:[a-z0-9-]+:|<[^>]+>)/gi).filter(Boolean).map((part, i) => renderPart(part, i))}
            </p>
          ))}
          {attachments && attachments.length > 0 && (
            <div className="mbaz-slack-attachments">
              {attachments.map((url) => (
                <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="mbaz-slack-attachment">
                  <img src={url} alt="evidence" />
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function AzureWorkItemModal({ profile, item, onClose, onTestResult, onUpdateItem, onRequestHours, evidence = [] }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { pushToast } = useToast();
  const { collaborators = [] } = useCollaborators();
  const fileInputRef = useRef(null);
  const [result, setResult] = useState("");
  const [state, setState] = useState("Ready to Beta");
  const [context, setContext] = useState("");
  const [selectedCountries, setSelectedCountries] = useState([]);
  const [selectedEnvironments, setSelectedEnvironments] = useState(["QA"]);
  const [selectedBreakpoints, setSelectedBreakpoints] = useState(["desktop"]);
  const [attachments, setAttachments] = useState([]);
  const [dragActive, setDragActive] = useState(false);
  const [saving, setSaving] = useState(false);
  const [liveDiscussions, setLiveDiscussions] = useState(null);
  const [liveDiscussionEvidence, setLiveDiscussionEvidence] = useState(null);
  const [discussionsLoading, setDiscussionsLoading] = useState(false);
  const [newTagDraft, setNewTagDraft] = useState("");
  const [assumingTask, setAssumingTask] = useState(false);
  const azureReady = Boolean(profile?.azureOrgUrl && profile?.azureProject && profile?.azurePat);
  const detailCacheKey = buildApiCacheKey("workItemDetail", profile?.id || profile?.email || "anonymous", profile?.azureOrgUrl, profile?.azureProject, item?.id);

  // As discussions que vem junto do fetch em lote do board (item.discussions)
  // sao best-effort e frequentemente vazias em boards grandes (ver
  // supabase/functions/azureWorkItemDetail). Ao abrir o modal, busca de novo
  // so para este item — rapido e confiavel, sem depender do que sobrou do
  // fetch coletivo.
  useEffect(() => {
    if (!azureReady || !item?.id || !isSupabaseConfigured) return;
    let cancelled = false;
    const cached = readApiCache(detailCacheKey, WORK_ITEM_DETAIL_CACHE_TTL_MS);
    if (cached?.data) {
      setLiveDiscussions(cached.data.discussions || []);
      setLiveDiscussionEvidence(cached.data.discussionEvidence || []);
      if (cached.fresh) return () => { cancelled = true; };
    } else {
      setDiscussionsLoading(true);
    }
    withInflight(detailCacheKey, () => supabase.functions.invoke("azureWorkItemDetail", {
      body: { orgUrl: profile.azureOrgUrl, project: profile.azureProject, pat: profile.azurePat, id: item.id, env: item.env }
    })).then(({ data }) => {
      if (cancelled) return;
      if (data?.ok) {
        const next = { discussions: data.discussions || [], discussionEvidence: data.discussionEvidence || [] };
        const nextSignature = stableSignature(next);
        if (nextSignature !== cached?.signature) {
          setLiveDiscussions(next.discussions);
          setLiveDiscussionEvidence(next.discussionEvidence);
        }
        writeApiCache(detailCacheKey, next, nextSignature);
      }
    }).finally(() => {
      if (!cancelled) setDiscussionsLoading(false);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, azureReady, detailCacheKey]);

  const discussions = liveDiscussions ?? item.discussions ?? [];
  const discussionEvidence = liveDiscussionEvidence ?? item.discussionEvidence ?? [];
  const url = azureEditableUrl(profile, item);
  const itemCode = formatWorkItemCode(item.id, item.type);
  const countryOptions = Object.keys(countries);
  const environmentOptions = ["DEV", "QA", "BETA", "PROD"];
  const breakpointOptions = [
    { value: "desktop", label: "Desktop", icon: "bi-display", detail: "1280px" },
    { value: "mobile", label: "Mobile", icon: "bi-phone", detail: "360px" }
  ];
  const resultLabel = result === "pass" ? "Approved" : result === "fail" ? "Fail" : result === "limitation" ? "Limitation" : "";
  const collaboratorNameIndex = buildCollaboratorNameIndex(collaborators);
  const qaResponsible = collaborators.find((person) => String(person.id) === String(item.qaCollaboratorId));
  const assigneePerson = collaborators.find((person) => String(person.id) === String(item.assigneeId))
    || findCollaboratorByName(collaboratorNameIndex, item.assigneeName)
    || findCollaboratorByName(collaboratorNameIndex, item.assignedTo)
    || { azureName: item.assigneeName || item.assignedTo };
  const creatorPerson = findCollaboratorByName(collaboratorNameIndex, item.createdBy) || { azureName: item.createdBy };
  const assigneeDisplayName = assigneePerson?.azureName || assigneePerson?.name || item.assigneeName || item.assignedTo || t("workItemModal.notAssigned");
  const qaDisplayName = qaResponsible?.azureName || qaResponsible?.name || item.qaName || item.qaResponsible || t("common.noQa");
  const creatorDisplayName = creatorPerson?.azureName || creatorPerson?.name || item.createdBy || t("workItemModal.notInformed");
  const creatorAvatarUrl = item.createdByImageUrl || item.createdByAvatarUrl || creatorPerson?.imageUrl || creatorPerson?.avatarUrl || "";
  const devPeople = collaborators.filter((person) => person.isDev || person.dev);
  const qaPeople = collaborators.filter((person) => person.isQa || person.qa);
  const myCollaborator = collaborators.find((person) => String(person.id) === String(profile?.id))
    || findCollaboratorByName(collaboratorNameIndex, profile?.displayName || profile?.fullName || user?.email);
  const isTaskBearingType = TASK_BEARING_TYPES.includes(item.type);
  const isAlreadyAssignedToMe = Boolean(myCollaborator?.id) && String(item.assigneeId || "") === String(myCollaborator.id);
  // Dois tipos de FYI fixo: sempre (fixedMention) e so quando o resultado e
  // Fail/Limitation (fixedMentionOnFailure) — mesma regra usada no envio
  // real (useWorkItems.js), pra previa e envio nunca divergirem.
  const isFailureResult = result === "fail" || result === "limitation";
  const fixedFyi = collaborators.filter((person) => {
    if (person.fixedMention || person.isFyiFixed || person.fyiFixed || person.fixedFyi) return true;
    if (isFailureResult && person.fixedMentionOnFailure) return true;
    return false;
  });
  const tagList = item.tags?.length ? item.tags : (item.countries || []).map((country) => `0-${country}`);
  const evidenceHistory = [
    ...evidence.filter((entry) => String(entry.workItemId) === String(item.id)),
    ...discussionEvidence.filter(isQaEvidenceEntry)
  ];
  const dedupedEvidenceHistory = Array.from(evidenceHistory.reduce((map, entry) => {
    const key = evidenceDedupeKey({ ...entry, workItemId: entry.workItemId || item.id });
    const current = map.get(key);
    if (!current || String(entry.createdAt || "").localeCompare(String(current.createdAt || "")) > 0) map.set(key, entry);
    return map;
  }, new Map()).values()).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const evidenceByEnv = evidenceEnvironmentOrder
    .map((env) => ({ env, records: dedupedEvidenceHistory.filter((entry) => evidenceEnvironments(entry).includes(env)) }))
    .filter((group) => group.records.length);
  const attachmentPreviewUrls = attachments.map((attachment) => typeof attachment === "string" ? attachment : attachment.dataUrl).filter(Boolean);
  const discussionPreviewHtml = result ? buildQaResultDiscussionHtml({
    resultKey: result,
    environments: selectedEnvironments,
    countries: selectedCountries,
    breakpoints: selectedBreakpoints,
    context,
    attachments: attachmentPreviewUrls
  }) : "";
  // "Tested by" mostra o QA Responsavel cadastrado no Work Item (Stark Hub),
  // nao quem esta logado registrando o resultado — pedido explicito do
  // usuario, ja que a pessoa que clica em "Registrar resultado" pode nao
  // ser o QA oficialmente responsavel pelo item (cobertura, revisao etc.).
  const slackPreviewText = result ? buildLegacyQaResultSlackText({
    item,
    resultKey: result,
    resultLabel,
    environments: selectedEnvironments,
    countries: selectedCountries,
    authorName: legacyMention(qaResponsible),
    assignee: assigneePerson,
    fyi: fixedFyi
  }) : "";
  const workFields = [
    [t("workItemModal.fieldCreatedAt"), item.createdAt ? new Date(item.createdAt).toLocaleString("pt-BR") : t("workItemModal.noDate")],
    [t("workItemModal.fieldChangedBy"), item.changedBy || t("workItemModal.notInformed")],
    [t("workItemModal.fieldCompletedHours"), typeof item.completedHours === "number" ? `${item.completedHours}h` : t("workItemModal.noHours")],
    [t("workItemModal.fieldRemainingHours"), typeof item.remainingHours === "number" ? `${item.remainingHours}h` : t("workItemModal.notInformed")],
    [t("workItemModal.fieldEstimate"), typeof item.originalEstimate === "number" ? `${item.originalEstimate}h` : t("workItemModal.notInformed")],
    [t("workItemModal.fieldPriority"), item.priority || t("workItemModal.notInformed")],
    [t("workItemModal.fieldSeverity"), item.severity || t("workItemModal.notInformed")],
    [t("workItemModal.fieldValueArea"), item.valueArea || t("workItemModal.notInformed")],
    [t("workItemModal.fieldChangedAt"), item.updatedAt ? new Date(item.updatedAt).toLocaleString("pt-BR") : t("workItemModal.noDate")],
    [t("workItemModal.fieldPrPipeline"), item.prUrl || item.pullRequestUrl || item.pipelineUrl || t("workItemModal.notFound")]
  ];

  function toggleValue(value, setter) {
    setter((current) => current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value]);
  }

  // Bug/US atribuido a um Dev (seja por auto-atribuicao via "Assumir tarefa"
  // ou pela Gestao escolhendo o assignee) ganha uma Task copia, vinculada
  // como filha, ja atribuida a mesma pessoa — a Task e a unidade que carrega
  // horas neste app, o Bug/US em si nunca registra Completed Work. Mesmo
  // padrao do fluxo "Nova tarefa" do stark-hub-script legado.
  async function createLinkedTask(assigneeAlias) {
    if (!profile?.azureOrgUrl || !profile?.azureProject || !profile?.azurePat) return;
    const tags = (item.tags || []).filter((tag) => !isCountryTag(tag));
    const { data, error } = await supabase.functions.invoke("azureWorkItemAction", {
      body: {
        action: "create",
        orgUrl: profile.azureOrgUrl,
        project: profile.azureProject,
        pat: profile.azurePat,
        item: {
          type: "Task",
          title: item.title,
          description: item.description || "",
          areaPath: item.areaPath || profile?.azureProject,
          sprint: item.sprint || item.iteration,
          tags,
          priority: item.priority,
          assigneeAlias,
          parentId: item.id
        }
      }
    });
    if (!error && data?.ok) {
      pushToast({ title: t("workItemModal.taskCreatedTitle"), body: t("workItemModal.taskCreatedBody", { id: data.id, type: item.type }), tone: "success" });
    } else {
      pushToast({ title: t("workItemModal.taskCreateFailedTitle"), body: data?.error || error?.message || "", tone: "danger" });
    }
  }

  async function assumeTask() {
    if (!myCollaborator?.azureName && !profile?.azureName) {
      pushToast({ title: t("workItemModal.taskCreateFailedTitle"), body: t("workItemModal.cannotIdentifyUser"), tone: "danger" });
      return;
    }
    const assigneeAlias = myCollaborator?.azureName || profile?.azureName;
    setAssumingTask(true);
    try {
      await onUpdateItem({ assigneeId: myCollaborator?.id, assigneeName: assigneeAlias, assigneeAlias });
      await createLinkedTask(assigneeAlias);
    } finally {
      setAssumingTask(false);
    }
  }

  function addTag(event) {
    event.preventDefault();
    const value = newTagDraft.trim();
    if (!value || !onUpdateItem) return;
    const current = item.tags || [];
    if (current.some((tag) => normalizeTagValue(tag) === normalizeTagValue(value))) { setNewTagDraft(""); return; }
    onUpdateItem({ tags: [...current, value] });
    setNewTagDraft("");
  }

  function removeTag(tag) {
    if (!onUpdateItem) return;
    onUpdateItem({ tags: (item.tags || []).filter((entry) => entry !== tag) });
  }

  function normalizeTagValue(value) {
    return String(value || "").trim().toLowerCase();
  }

  function setResultAndState(nextResult) {
    setResult(nextResult);
    setState(nextResult === "pass" ? "Ready to Beta" : "In QA");
    // Limitation sempre tem o mesmo motivo padrao (limitacao de ambiente
    // Beta/PRD) — pre-preenche o contexto com esse texto, editavel. Pass e
    // Fail nao tem texto padrao, entao o campo comeca vazio.
    setContext(nextResult === "limitation" ? limitationContextTemplate : "");
  }

  function attachmentKey(attachment) {
    return typeof attachment === "string" ? attachment : attachment.id || attachment.dataUrl || attachment.name;
  }

  function serializeDraftAttachments(list = []) {
    return list.map((attachment) => {
      if (typeof attachment === "string") return attachment;
      return {
        id: attachment.id,
        name: attachment.name,
        type: attachment.type,
        size: attachment.size,
        persisted: Boolean(attachment.persisted)
      };
    });
  }

  function restoreDraftAttachments(list = []) {
    return list.filter((attachment) => typeof attachment === "string" || attachment?.persisted);
  }

  function removeAttachment(target) {
    const key = attachmentKey(target);
    setAttachments((current) => current.filter((entry) => attachmentKey(entry) !== key));
  }

  useEffect(() => {
    if (!item?.id) return;
    try {
      const draft = JSON.parse(localStorage.getItem(`starkHubTestDraft:${item.id}`) || "null");
      setResult(draft?.result || "");
      setState(draft?.state || "Ready to Beta");
      setContext(draft?.context || "");
      setSelectedCountries(Array.isArray(draft?.countries) ? draft.countries : []);
      setSelectedEnvironments(Array.isArray(draft?.environments) && draft.environments.length ? draft.environments : ["QA"]);
      setSelectedBreakpoints(Array.isArray(draft?.breakpoints) && draft.breakpoints.length ? draft.breakpoints : ["desktop"]);
      setAttachments(Array.isArray(draft?.attachments) ? restoreDraftAttachments(draft.attachments) : []);
    } catch {
      setResult("");
      setState("Ready to Beta");
      setContext("");
      setSelectedCountries([]);
      setSelectedEnvironments(["QA"]);
      setSelectedBreakpoints(["desktop"]);
      setAttachments([]);
    }
  }, [item?.id]);

  useEffect(() => {
    if (!item?.id) return;
    const hasDraft = result || context || selectedCountries.length || selectedEnvironments.join(",") !== "QA" || selectedBreakpoints.join(",") !== "desktop" || attachments.length;
    const key = `starkHubTestDraft:${item.id}`;
    if (!hasDraft) {
      localStorage.removeItem(key);
      return;
    }
    try {
      localStorage.setItem(key, JSON.stringify({
        result,
        state,
        context,
        countries: selectedCountries,
        environments: selectedEnvironments,
        breakpoints: selectedBreakpoints,
        attachments: serializeDraftAttachments(attachments)
      }));
    } catch (err) {
      if (err?.name === "QuotaExceededError") {
        localStorage.setItem(key, JSON.stringify({
          result,
          state,
          context,
          countries: selectedCountries,
          environments: selectedEnvironments,
          breakpoints: selectedBreakpoints,
          attachments: []
        }));
      } else {
        throw err;
      }
    }
  }, [item?.id, result, state, context, selectedCountries, selectedEnvironments, selectedBreakpoints, attachments]);

  function readEvidenceFiles(fileList) {
    const files = Array.from(fileList || []).filter((file) => file.type.startsWith("image/") || /\.gif$/i.test(file.name));
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        setAttachments((current) => [
          ...current,
          {
            id: `${file.name}-${file.lastModified}-${file.size}`,
            name: file.name,
            type: file.type || "application/octet-stream",
            size: file.size,
            dataUrl: reader.result
          }
        ]);
      };
      reader.readAsDataURL(file);
    });
  }

  function onDrop(event) {
    event.preventDefault();
    setDragActive(false);
    readEvidenceFiles(event.dataTransfer.files);
  }

  function renderTag(tag) {
    const countryMatch = String(tag).trim().match(/^0-([A-Z]{2})$/i);
    if (countryMatch) return <span key={tag} className="country-tag"><CountryVisual code={countryMatch[1].toUpperCase()} compact /></span>;
    return <span key={tag}>{tag}</span>;
  }

  async function saveResult() {
    if (!onTestResult || !result) return;
    setSaving(true);
    await onTestResult(item, {
      lastTestResult: result,
      context,
      note: context,
      state,
      countries: selectedCountries,
      environments: selectedEnvironments,
      breakpoints: selectedBreakpoints,
      attachments
    });
    localStorage.removeItem(`starkHubTestDraft:${item.id}`);
    setSaving(false);
    resetResultForm();
  }

  function resetResultForm() {
    setResult("");
    setState("Ready to Beta");
    setContext("");
    setSelectedCountries([]);
    setSelectedEnvironments(["QA"]);
    setSelectedBreakpoints(["desktop"]);
    setAttachments([]);
  }

  function cancelResult() {
    localStorage.removeItem(`starkHubTestDraft:${item.id}`);
    resetResultForm();
  }

  return (
    <div className="mbaz-new-modal-overlay">
      <section className="mbaz-new-modal" onClick={(event) => event.stopPropagation()}>
        <header className="mbaz-new-modal-header">
          <div className="mbaz-new-modal-title"><TypeBadge type={item.type} /> <span>{itemCode}</span></div>
          <div className="mbaz-new-modal-actions">
            {url && <a className="mbaz-new-modal-open" href={url} target="_blank" rel="noopener noreferrer"><i className="bi bi-box-arrow-up-right" /> {t("workItemModal.openInAzure")}</a>}
            <button type="button" className="mbaz-new-modal-close" onClick={onClose}><i className="bi bi-x-lg" /></button>
          </div>
        </header>
        <div className="mbaz-new-modal-body">
          <section className="mbaz-new-modal-workitem mbaz-new-modal-overview">
            <div className="mbaz-new-modal-workitem-main">
              <div className="mbaz-new-modal-workitem-kicker">
                <TypeBadge type={item.type} />
                {item.state && <EnvBadge env={item.env || "qa"} />}
                {item.prUrl || item.pullRequestUrl || item.pipelineUrl ? <a href={item.prUrl || item.pullRequestUrl || item.pipelineUrl} target="_blank" rel="noreferrer">PR/Pipeline</a> : null}
              </div>
              <h2>{item.title || t("workItemModal.noTitle")}</h2>
              <div className="mbaz-new-modal-meta-strip">
                <div><span>{t("workItemModal.reasonLabel")}</span><strong>{item.reason || t("workItemModal.noReason")}</strong></div>
                <div><span>{t("workItemModal.areaPathLabel")}</span><strong>{item.areaPath || t("workItemModal.noArea")}</strong></div>
                <div><span>{t("workItemModal.sprintLabel")}</span><strong>{compactSprintLabel(item.sprint || item.iteration) || t("workItemModal.noSprint")}</strong></div>
                <div className="mbaz-meta-created-by">
                  <span>{t("workItemModal.createdByLabel")}</span>
                  <div className="mbaz-meta-created-author">
                    <IdentityAvatar name={creatorDisplayName} imageUrl={creatorAvatarUrl} size={22} />
                    <strong>{creatorDisplayName}</strong>
                  </div>
                </div>
              </div>
              <div className="mbaz-new-modal-essential">
                <div>
                  <span>{t("workItemModal.statusLabel")}</span>
                  {onUpdateItem && (!isTaskBearingType || !onRequestHours) ? (
                    <select value={item.state || ""} onChange={(event) => onUpdateItem({ state: event.target.value })}>
                      {["New", "Active", "In QA", "HMG CNK", "Ready to Beta", "In BETA", "Ready to Prod", "Closed"].map((value) => <option key={value} value={value}>{value}</option>)}
                    </select>
                  ) : onUpdateItem ? (
                    <div className="mbaz-new-modal-status-gated">
                      <strong>{item.state || t("workItemModal.noStatus")}</strong>
                      <button type="button" className="mbaz-new-modal-status-hours-btn" onClick={() => onRequestHours(item)}>{t("workItemModal.changeStatusHoursButton")}</button>
                    </div>
                  ) : <strong>{item.state || t("workItemModal.noStatus")}</strong>}
                </div>
                <div>
                  <span>{t("workItemModal.assignedToLabel")}</span>
                  {onUpdateItem ? (
                    <>
                      <QaPicker
                        value={item.assigneeId || ""}
                        emptyLabel={item.assigneeName || item.assignedTo || t("workItemModal.notAssigned")}
                        showEmptyAvatar={Boolean(item.assigneeName || item.assignedTo)}
                        emptyImageUrl={item.assigneeImageUrl}
                        people={devPeople}
                        onChange={(assigneeId) => {
                          const person = devPeople.find((entry) => String(entry.id) === String(assigneeId));
                          onUpdateItem({ assigneeId, assigneeName: person?.azureName || "", assigneeAlias: person?.azureName || "" });
                          if (isTaskBearingType && person?.azureName) createLinkedTask(person.azureName);
                        }}
                      />
                      {isTaskBearingType && !isAlreadyAssignedToMe && (
                        <button type="button" className="mbaz-new-modal-assume-task-btn" onClick={assumeTask} disabled={assumingTask}>
                          <i className="bi bi-person-check" /> {assumingTask ? t("workItemModal.assumingTaskButton") : t("workItemModal.assumeTaskButton")}
                        </button>
                      )}
                    </>
                  ) : <p><IdentityAvatar name={assigneeDisplayName} imageUrl={item.assigneeImageUrl} size={28} /> <strong>{assigneeDisplayName}</strong></p>}
                </div>
                <div>
                  <span>{t("workItemModal.testedByLabel")}</span>
                  {onUpdateItem ? <QaPicker value={item.qaCollaboratorId || ""} onChange={(qaCollaboratorId) => onUpdateItem({ qaCollaboratorId: qaCollaboratorId || null })} people={qaPeople} /> : <p><IdentityAvatar name={qaDisplayName} imageUrl={qaResponsible?.imageUrl || qaResponsible?.avatarUrl} color={qaResponsible?.color} size={28} /> <strong>{qaDisplayName}</strong></p>}
                </div>
                <div>
                  <span>{t("workItemModal.tagsLabel")}</span>
                  <p className="mbaz-new-modal-inline-tags">
                    {tagList.length ? tagList.map((tag) => (
                      onUpdateItem && !isCountryTag(tag) ? (
                        <span key={tag} className="mbaz-new-modal-tag-editable">
                          {renderTag(tag)}
                          <button type="button" title={t("workItemModal.removeTagTitle")} onClick={() => removeTag(tag)}><i className="bi bi-x" /></button>
                        </span>
                      ) : renderTag(tag)
                    )) : <em>{t("workItemModal.noTags")}</em>}
                  </p>
                  {onUpdateItem && (
                    <form className="mbaz-new-modal-tag-add" onSubmit={addTag}>
                      <input value={newTagDraft} onChange={(event) => setNewTagDraft(event.target.value)} placeholder={t("workItemModal.addTagPlaceholder")} />
                      <button type="submit">{t("workItemModal.addTagButton")}</button>
                    </form>
                  )}
                </div>
              </div>
            </div>
          </section>
          <details className="mbaz-new-modal-collapse" open>
            <summary><span>{t("workItemModal.descriptionTitle")}</span><small>{t("workItemModal.descriptionSubtitle")}</small></summary>
            <div className="mbaz-new-modal-description-body">
              {item.description ? <RichAzureHtml html={item.description} /> : null}
              {item.acceptanceCriteria ? (
                <div className="mbaz-new-modal-description-block">
                  <strong>Acceptance Criteria</strong>
                  <RichAzureHtml html={item.acceptanceCriteria} />
                </div>
              ) : null}
              {item.reproSteps ? (
                <div className="mbaz-new-modal-description-block">
                  <strong>Repro Steps</strong>
                  <RichAzureHtml html={item.reproSteps} />
                </div>
              ) : null}
              {!item.description && !item.acceptanceCriteria && !item.reproSteps ? <p className="mbaz-new-modal-muted">{t("workItemModal.noContent")}</p> : null}
            </div>
          </details>
          <details className="mbaz-new-modal-result-history" open>
            <summary>
              <div className="mbaz-new-modal-section-title">
                <strong>{t("workItemModal.testResultsTitle")}</strong>
                <span>{t("workItemModal.testResultsSubtitle")}</span>
              </div>
              <div className="mbaz-new-modal-result-summary">
                {evidenceByEnv.length ? evidenceByEnv.map(({ env, records }) => {
                  const info = evidenceResultInfo(records[0]?.result || records[0]?.status);
                  return (
                    <span key={env} className={`mbaz-new-modal-result-chip ${info.className}`}>
                      <EnvBadge env={env.toLowerCase()} /><i className={`bi ${info.icon}`} /><b>{records.length}</b>
                    </span>
                  );
                }) : item.lastTestResult ? (
                  <span className={`mbaz-new-modal-result-chip ${evidenceResultInfo(item.lastTestResult).className}`}><i className={`bi ${evidenceResultInfo(item.lastTestResult).icon}`} /> {evidenceResultInfo(item.lastTestResult).label}</span>
                ) : <span className="mbaz-new-modal-muted">{t("workItemModal.noResults")}</span>}
              </div>
            </summary>
            {dedupedEvidenceHistory.length ? (
              <ul className="mbaz-new-modal-result-list">
                {dedupedEvidenceHistory.map((entry) => (
                  <li key={entry.id || `${entry.workItemId}-${entry.createdAt}`}>
                    <ResultBadge result={entry.result || entry.status} />
                    {evidenceEnvironments(entry).map((env) => <EnvBadge key={env} env={String(env).toLowerCase()} />)}
                    <IdentityAvatar name={entry.authorName || "QA"} imageUrl={entry.avatarUrl} size={22} />
                    <span className="mbaz-new-modal-result-author">{entry.authorName || t("workItemModal.qaUnidentified")}</span>
                    <span className="mbaz-new-modal-result-date">{entry.createdAt ? new Date(entry.createdAt).toLocaleString("pt-BR") : ""}</span>
                    {(entry.html || entry.note || entry.text) && <RichAzureHtml html={renderAzureCommentHtml(entry.html || entry.note || entry.text)} />}
                  </li>
                ))}
              </ul>
            ) : item.lastTestResult ? (
              <div className="mbaz-new-modal-result-list single"><ResultBadge result={item.lastTestResult} /><span>{t("workItemModal.lastKnownResult")}</span></div>
            ) : (
              <p className="mbaz-new-modal-muted">{t("workItemModal.noTestResultsYet")}</p>
            )}
          </details>
          <details className="mbaz-new-modal-collapse">
            <summary><span>{t("workItemModal.azureFieldsTitle")}</span><small>{t("workItemModal.azureFieldsSubtitle")}</small></summary>
            <div className="mbaz-new-modal-workitem-grid">
              {workFields.map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  {String(value).startsWith("http") ? <a href={value} target="_blank" rel="noreferrer">{value}</a> : <strong>{value}</strong>}
                </div>
              ))}
            </div>
          </details>
          <details className="mbaz-new-modal-collapse" open>
            <summary><span>{t("workItemModal.discussionsTitle")}</span><small>{discussionsLoading ? t("workItemModal.loading") : t("workItemModal.commentsCount", { count: discussions.length })}</small></summary>
            <div className="mbaz-new-modal-discussions">
              {discussionsLoading ? <p className="mbaz-new-modal-muted">{t("workItemModal.loadingDiscussions")}</p> : discussions.length ? discussions.map((comment) => (
                <article key={comment.id}>
                  <header>
                    <IdentityAvatar name={comment.authorName} imageUrl={comment.avatarUrl} size={28} />
                    <strong>{comment.authorName}</strong>
                    <span className="mbaz-new-modal-disc-date">{comment.createdAt ? new Date(comment.createdAt).toLocaleString("pt-BR") : t("workItemModal.noDate")}</span>
                  </header>
                  <RichAzureHtml html={renderAzureCommentHtml(comment.html || comment.text)} />
                </article>
              )) : <p className="mbaz-new-modal-muted">{t("workItemModal.noDiscussions")}</p>}
            </div>
          </details>
        {onTestResult && (
          <div className="mbaz-new-modal-testbar mbaz-new-modal-testbar-rich">
            <div className="mbaz-new-modal-section-title">
              <strong>{t("workItemModal.registerResultTitle")}</strong>
              <span>{t("workItemModal.registerResultSubtitle")}</span>
            </div>
            <div className="mbaz-new-modal-test-options">
              <button type="button" className={result === "pass" ? "active approved" : "approved"} onClick={() => setResultAndState("pass")}><i className="bi bi-check-lg" /> Approved</button>
              <button type="button" className={result === "fail" ? "active fail" : "fail"} onClick={() => setResultAndState("fail")}><i className="bi bi-x-lg" /> Fail</button>
              <button type="button" className={result === "limitation" ? "active limitation" : "limitation"} onClick={() => setResultAndState("limitation")}><i className="bi bi-exclamation-triangle-fill" /> Limitation</button>
            </div>
            {result ? (
            <div className="mbaz-new-modal-form-grid">
              <label><span>{t("workItemModal.nextStatusLabel")}</span><select value={state} onChange={(event) => setState(event.target.value)} title={t("workItemModal.nextStatusLabel")}>
                <option value="">{t("workItemModal.doNotChangeStatus")}</option>
                <option value="In QA">In QA</option>
                <option value="Ready to Beta">Ready to Beta</option>
                <option value="In BETA">In BETA</option>
                <option value="Ready to Prod">Ready to Prod</option>
              </select></label>
              <fieldset><legend>{t("workItemModal.environmentTestedLegend")}</legend><div className="mbaz-new-modal-checks">{environmentOptions.map((env) => <button key={env} type="button" className={`mbaz-new-modal-toggle-pill ${selectedEnvironments.includes(env) ? "active" : ""}`} onClick={() => toggleValue(env, setSelectedEnvironments)}><img src={envIconSrc(env)} alt="" />{env}</button>)}</div></fieldset>
              <fieldset><legend>{t("workItemModal.countryTestedLegend")}</legend><div className="mbaz-new-modal-checks countries">{countryOptions.filter((country) => country !== "BR").map((country) => <button key={country} type="button" className={`mbaz-new-modal-toggle-pill country ${selectedCountries.includes(country) ? "active" : ""}`} onClick={() => toggleValue(country, setSelectedCountries)}><CountryVisual code={country} compact /></button>)}</div></fieldset>
              <fieldset><legend>{t("workItemModal.breakpointLegend")}</legend><div className="mbaz-new-modal-checks">{breakpointOptions.map((bp) => <button key={bp.value} type="button" className={`mbaz-new-modal-toggle-pill ${selectedBreakpoints.includes(bp.value) ? "active" : ""}`} onClick={() => toggleValue(bp.value, setSelectedBreakpoints)}><i className={`bi ${bp.icon}`} />{bp.label}<small>{bp.detail}</small></button>)}</div></fieldset>
              <label className="wide"><span>{t("workItemModal.optionalContextLabel")}</span><textarea value={context} onChange={(event) => setContext(event.target.value)} placeholder={t("workItemModal.optionalContextPlaceholder")} /></label>
              <div className="wide mbaz-new-modal-attachments">
                <span>{t("workItemModal.evidenceLabel")}</span>
                <div
                  className={`mbaz-new-modal-dropzone ${dragActive ? "active" : ""}`}
                  onDragOver={(event) => { event.preventDefault(); setDragActive(true); }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={onDrop}
                >
                  <i className="bi bi-images" />
                  <strong>{t("workItemModal.dropzoneTitle")}</strong>
                  <span>{t("workItemModal.dropzoneSubtitle")}</span>
                  <button type="button" onClick={() => fileInputRef.current?.click()}>{t("workItemModal.importEvidenceButton")}</button>
                  <input ref={fileInputRef} type="file" accept="image/*,.gif" multiple hidden onChange={(event) => readEvidenceFiles(event.target.files)} />
                </div>
                {attachments.length > 0 && <div className="mbaz-new-modal-evidence-grid">{attachments.map((attachment) => {
                  const src = typeof attachment === "string" ? attachment : attachment.dataUrl;
                  const label = typeof attachment === "string" ? attachment : attachment.name;
                  return <span key={attachmentKey(attachment)} title={label}><img src={src} alt="" /><button type="button" onClick={() => removeAttachment(attachment)}><i className="bi bi-x" /></button></span>;
                })}</div>}
              </div>
              <div className="wide mbaz-new-modal-preview">
                <div className="mbaz-new-modal-preview-column">
                  <strong>{t("workItemModal.azurePreviewTitle")}</strong>
                  <RichAzureHtml html={discussionPreviewHtml} />
                </div>
                <div className="mbaz-new-modal-preview-column">
                  <strong>{t("workItemModal.slackPreviewTitle")}</strong>
                  <EnhancedSlackPreview
                    text={slackPreviewText}
                    item={item}
                    attachments={attachmentPreviewUrls}
                    collaborators={collaborators}
                  />
                </div>
              </div>
            </div>
            ) : <div className="mbaz-new-modal-result-empty"><i className="bi bi-arrow-up" /> {t("workItemModal.selectResultPrompt")}</div>}
            <div className="mbaz-new-modal-testbar-footer">
              {result && <button type="button" className="mbaz-new-modal-cancel-result" onClick={cancelResult} disabled={saving}>{t("workItemModal.cancelButton")}</button>}
              <button type="button" className="mbaz-new-modal-save-result" onClick={saveResult} disabled={saving || !result || !selectedEnvironments.length}>{saving ? t("workItemModal.savingButton") : t("workItemModal.registerResultButton")}</button>
            </div>
          </div>
        )}
        </div>
      </section>
    </div>
  );
}
