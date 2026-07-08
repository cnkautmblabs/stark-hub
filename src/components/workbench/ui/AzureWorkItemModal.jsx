import { useEffect, useRef, useState } from "react";
import { supabase, isSupabaseConfigured } from "../../../lib/supabaseClient.js";
import { azureWorkItemUrl } from "../../../utils/azure.js";
import { countries, formatWorkItemCode } from "../../../utils/constants.js";
import { compactSprintLabel } from "../../../utils/sprints.js";
import { buildLegacyQaResultSlackText, buildQaResultDiscussionHtml, legacyMention } from "../../../utils/slackReport.js";
import { evidenceEnv, evidenceEnvironmentOrder, evidenceResultInfo } from "../../../utils/workbench/formatters.js";
import { useCollaborators } from "../../../hooks/useCollaborators.js";
import { CountryVisual, EnvBadge, IdentityAvatar, QaPicker, ResultBadge, TypeBadge, envIconSrc, typeIconSrc } from "./WorkbenchPrimitives.jsx";

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

export function AzureWorkItemModal({ profile, item, onClose, onTestResult, onUpdateItem, evidence = [] }) {
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
  const azureReady = Boolean(profile?.azureOrgUrl && profile?.azureProject && profile?.azurePat);

  // As discussions que vem junto do fetch em lote do board (item.discussions)
  // sao best-effort e frequentemente vazias em boards grandes (ver
  // supabase/functions/azureWorkItemDetail). Ao abrir o modal, busca de novo
  // so para este item — rapido e confiavel, sem depender do que sobrou do
  // fetch coletivo.
  useEffect(() => {
    if (!azureReady || !item?.id || !isSupabaseConfigured) return;
    let cancelled = false;
    setDiscussionsLoading(true);
    supabase.functions.invoke("azureWorkItemDetail", {
      body: { orgUrl: profile.azureOrgUrl, project: profile.azureProject, pat: profile.azurePat, id: item.id, env: item.env }
    }).then(({ data }) => {
      if (cancelled) return;
      if (data?.ok) {
        setLiveDiscussions(data.discussions || []);
        setLiveDiscussionEvidence(data.discussionEvidence || []);
      }
    }).finally(() => {
      if (!cancelled) setDiscussionsLoading(false);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, azureReady]);

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
  const qaResponsible = collaborators.find((person) => person.id === item.qaCollaboratorId);
  const assigneePerson = collaborators.find((person) => person.id === item.assigneeId || person.azureName === item.assigneeName) || { azureName: item.assigneeName || item.assignedTo };
  const devPeople = collaborators.filter((person) => person.isDev || person.dev);
  const qaPeople = collaborators.filter((person) => person.isQa || person.qa);
  const fixedFyi = collaborators.filter((person) => person.fixedMention || person.isFyiFixed || person.fyiFixed || person.fixedFyi);
  const tagList = item.tags?.length ? item.tags : (item.countries || []).map((country) => `0-${country}`);
  const evidenceHistory = [
    ...evidence.filter((entry) => String(entry.workItemId) === String(item.id)),
    ...discussionEvidence
  ].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const evidenceByEnv = evidenceEnvironmentOrder
    .map((env) => ({ env, records: evidenceHistory.filter((entry) => evidenceEnv(entry) === env) }))
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
  const reporter = collaborators.find((person) => person.id === profile?.id || person.email === profile?.email || person.azureEmail === profile?.email);
  const slackPreviewText = result ? buildLegacyQaResultSlackText({
    item,
    resultKey: result,
    resultLabel,
    environments: selectedEnvironments,
    countries: selectedCountries,
    authorName: legacyMention(reporter),
    assignee: assigneePerson,
    fyi: fixedFyi
  }) : "";
  const workFields = [
    ["Criado em", item.createdAt ? new Date(item.createdAt).toLocaleString("pt-BR") : "Sem data"],
    ["Alterado por", item.changedBy || "Nao informado"],
    ["Horas concluidas", typeof item.completedHours === "number" ? `${item.completedHours}h` : "Sem horas"],
    ["Horas restantes", typeof item.remainingHours === "number" ? `${item.remainingHours}h` : "Nao informado"],
    ["Estimativa", typeof item.originalEstimate === "number" ? `${item.originalEstimate}h` : "Nao informado"],
    ["Prioridade", item.priority || "Nao informado"],
    ["Severidade", item.severity || "Nao informado"],
    ["Value Area", item.valueArea || "Nao informado"],
    ["Alterado em", item.updatedAt ? new Date(item.updatedAt).toLocaleString("pt-BR") : "Sem data"],
    ["PR/Pipeline", item.prUrl || item.pullRequestUrl || item.pipelineUrl || "Nao localizado"]
  ];

  function toggleValue(value, setter) {
    setter((current) => current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value]);
  }

  function setResultAndState(nextResult) {
    setResult(nextResult);
    setState(nextResult === "pass" ? "Ready to Beta" : "In QA");
  }

  function attachmentKey(attachment) {
    return typeof attachment === "string" ? attachment : attachment.id || attachment.dataUrl || attachment.name;
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
      setAttachments(Array.isArray(draft?.attachments) ? draft.attachments : []);
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
    localStorage.setItem(key, JSON.stringify({
      result,
      state,
      context,
      countries: selectedCountries,
      environments: selectedEnvironments,
      breakpoints: selectedBreakpoints,
      attachments
    }));
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
    <div className="mbaz-new-modal-overlay" onClick={onClose}>
      <section className="mbaz-new-modal" onClick={(event) => event.stopPropagation()}>
        <header className="mbaz-new-modal-header">
          <div className="mbaz-new-modal-title"><TypeBadge type={item.type} /> <span>{itemCode}</span></div>
          <div className="mbaz-new-modal-actions">
            {url && <a className="mbaz-new-modal-open" href={url} target="_blank" rel="noopener noreferrer"><i className="bi bi-box-arrow-up-right" /> Abrir no Azure</a>}
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
              <h2>{item.title || "Work Item sem titulo"}</h2>
              <div className="mbaz-new-modal-meta-strip">
                <div><span>Motivo</span><strong>{item.reason || "Sem motivo"}</strong></div>
                <div><span>Area Path</span><strong>{item.areaPath || "Sem area"}</strong></div>
                <div><span>Sprint</span><strong>{compactSprintLabel(item.sprint || item.iteration) || "Sem sprint"}</strong></div>
                <div><span>Criado por</span><strong>{item.createdBy || "Nao informado"}</strong></div>
              </div>
              <div className="mbaz-new-modal-essential">
                <div>
                  <span>Status</span>
                  {onUpdateItem ? (
                    <select value={item.state || ""} onChange={(event) => onUpdateItem({ state: event.target.value })}>
                      {["New", "Active", "In QA", "HMG CNK", "Ready to Beta", "In BETA", "Ready to Prod", "Closed"].map((value) => <option key={value} value={value}>{value}</option>)}
                    </select>
                  ) : <strong>{item.state || "Sem status"}</strong>}
                </div>
                <div>
                  <span>Assigned To</span>
                  {onUpdateItem ? (
                    <QaPicker
                      value={item.assigneeId || ""}
                      emptyLabel={item.assigneeName || item.assignedTo || "Nao atribuido"}
                      showEmptyAvatar={Boolean(item.assigneeName || item.assignedTo)}
                      emptyImageUrl={item.assigneeImageUrl}
                      people={devPeople}
                      onChange={(assigneeId) => {
                        const person = devPeople.find((entry) => String(entry.id) === String(assigneeId));
                        onUpdateItem({ assigneeId, assigneeName: person?.azureName || "", assigneeAlias: person?.azureName || "" });
                      }}
                    />
                  ) : <p><IdentityAvatar name={item.assigneeName || item.assignedTo} imageUrl={item.assigneeImageUrl} size={28} /> <strong>{item.assigneeName || item.assignedTo || "Nao atribuido"}</strong></p>}
                </div>
                <div>
                  <span>QA responsavel</span>
                  {onUpdateItem ? <QaPicker value={item.qaCollaboratorId || ""} onChange={(qaCollaboratorId) => onUpdateItem({ qaCollaboratorId: qaCollaboratorId || null })} people={qaPeople} /> : <p><IdentityAvatar name={qaResponsible?.azureName || qaResponsible?.name || item.qaName || "Sem QA"} imageUrl={qaResponsible?.imageUrl || qaResponsible?.avatarUrl} color={qaResponsible?.color} size={28} /> <strong>{qaResponsible?.azureName || qaResponsible?.name || item.qaName || "Sem QA"}</strong></p>}
                </div>
                <div>
                  <span>Tags</span>
                  <p className="mbaz-new-modal-inline-tags">{tagList.length ? tagList.map(renderTag) : <em>Sem tags</em>}</p>
                </div>
              </div>
            </div>
          </section>
          <details className="mbaz-new-modal-collapse" open>
            <summary><span>Descricao</span><small>Descricao e criterios em HTML do Azure</small></summary>
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
              {!item.description && !item.acceptanceCriteria && !item.reproSteps ? <p className="mbaz-new-modal-muted">Sem conteudo preenchido neste Work Item.</p> : null}
            </div>
          </details>
          <details className="mbaz-new-modal-result-history" open>
            <summary>
              <div className="mbaz-new-modal-section-title">
                <strong>Resultado dos testes</strong>
                <span>Historico de evidencias ja registradas para este work item.</span>
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
                ) : <span className="mbaz-new-modal-muted">Sem resultados</span>}
              </div>
            </summary>
            {evidenceHistory.length ? (
              <ul className="mbaz-new-modal-result-list">
                {evidenceHistory.map((entry) => (
                  <li key={entry.id || `${entry.workItemId}-${entry.createdAt}`}>
                    <ResultBadge result={entry.result || entry.status} />
                    {(entry.environments?.length ? entry.environments : entry.environment ? [entry.environment] : []).map((env) => <EnvBadge key={env} env={String(env).toLowerCase()} />)}
                    <IdentityAvatar name={entry.authorName || "QA"} imageUrl={entry.avatarUrl} size={22} />
                    <span className="mbaz-new-modal-result-author">{entry.authorName || "QA nao identificado"}</span>
                    <span className="mbaz-new-modal-result-date">{entry.createdAt ? new Date(entry.createdAt).toLocaleString("pt-BR") : ""}</span>
                    {(entry.html || entry.note || entry.text) && <RichAzureHtml html={legacyEvidenceToHtml(entry.html || entry.note || entry.text)} />}
                  </li>
                ))}
              </ul>
            ) : item.lastTestResult ? (
              <div className="mbaz-new-modal-result-list single"><ResultBadge result={item.lastTestResult} /><span>Ultimo resultado conhecido, sem detalhes adicionais.</span></div>
            ) : (
              <p className="mbaz-new-modal-muted">Nenhum resultado de teste registrado ainda para este work item.</p>
            )}
          </details>
          <details className="mbaz-new-modal-collapse">
            <summary><span>Campos do Azure</span><small>Area, sprint, datas, horas, prioridade e links</small></summary>
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
            <summary><span>Discussions</span><small>{discussionsLoading ? "Carregando..." : `${discussions.length} comentario(s), incluindo evidencias`}</small></summary>
            <div className="mbaz-new-modal-discussions">
              {discussionsLoading ? <p className="mbaz-new-modal-muted">Carregando discussions do Azure...</p> : discussions.length ? discussions.map((comment) => (
                <article key={comment.id}>
                  <header>
                    <IdentityAvatar name={comment.authorName} imageUrl={comment.avatarUrl} size={28} />
                    <strong>{comment.authorName}</strong>
                    <span>{comment.createdAt ? new Date(comment.createdAt).toLocaleString("pt-BR") : "Sem data"}</span>
                  </header>
                  <RichAzureHtml html={comment.html || comment.text} />
                </article>
              )) : <p className="mbaz-new-modal-muted">Nenhuma discussion carregada para este Work Item.</p>}
            </div>
          </details>
        {onTestResult && (
          <div className="mbaz-new-modal-testbar mbaz-new-modal-testbar-rich">
            <div className="mbaz-new-modal-section-title">
              <strong>Registrar novo resultado de teste</strong>
              <span>Escolha um resultado para exibir os detalhes que serao gravados no Azure e enviados ao Slack.</span>
            </div>
            <div className="mbaz-new-modal-test-options">
              <button type="button" className={result === "pass" ? "active approved" : "approved"} onClick={() => setResultAndState("pass")}><i className="bi bi-check-lg" /> Approved</button>
              <button type="button" className={result === "fail" ? "active fail" : "fail"} onClick={() => setResultAndState("fail")}><i className="bi bi-x-lg" /> Fail</button>
              <button type="button" className={result === "limitation" ? "active limitation" : "limitation"} onClick={() => setResultAndState("limitation")}><i className="bi bi-exclamation-triangle-fill" /> Limitation</button>
            </div>
            {result ? (
            <div className="mbaz-new-modal-form-grid">
              <label><span>Proximo status</span><select value={state} onChange={(event) => setState(event.target.value)} title="Status alvo">
                <option value="">Nao alterar status</option>
                <option value="In QA">In QA</option>
                <option value="Ready to Beta">Ready to Beta</option>
                <option value="In BETA">In BETA</option>
                <option value="Ready to Prod">Ready to Prod</option>
              </select></label>
              <fieldset><legend>Ambiente testado</legend><div className="mbaz-new-modal-checks">{environmentOptions.map((env) => <button key={env} type="button" className={`mbaz-new-modal-toggle-pill ${selectedEnvironments.includes(env) ? "active" : ""}`} onClick={() => toggleValue(env, setSelectedEnvironments)}><img src={envIconSrc(env)} alt="" />{env}</button>)}</div></fieldset>
              <fieldset><legend>Pais testado</legend><div className="mbaz-new-modal-checks countries">{countryOptions.map((country) => <button key={country} type="button" className={`mbaz-new-modal-toggle-pill country ${selectedCountries.includes(country) ? "active" : ""}`} onClick={() => toggleValue(country, setSelectedCountries)}><CountryVisual code={country} compact /></button>)}</div></fieldset>
              <fieldset><legend>Breakpoint</legend><div className="mbaz-new-modal-checks">{breakpointOptions.map((bp) => <button key={bp.value} type="button" className={`mbaz-new-modal-toggle-pill ${selectedBreakpoints.includes(bp.value) ? "active" : ""}`} onClick={() => toggleValue(bp.value, setSelectedBreakpoints)}><i className={`bi ${bp.icon}`} />{bp.label}<small>{bp.detail}</small></button>)}</div></fieldset>
              <label className="wide"><span>Contexto opcional</span><textarea value={context} onChange={(event) => setContext(event.target.value)} placeholder="Ex.: Validado checkout em 1280px, evidencias abaixo." /></label>
              <div className="wide mbaz-new-modal-attachments">
                <span>Evidencias</span>
                <div
                  className={`mbaz-new-modal-dropzone ${dragActive ? "active" : ""}`}
                  onDragOver={(event) => { event.preventDefault(); setDragActive(true); }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={onDrop}
                >
                  <i className="bi bi-images" />
                  <strong>Arraste imagens ou GIFs aqui</strong>
                  <span>ou importe arquivos do computador</span>
                  <button type="button" onClick={() => fileInputRef.current?.click()}>Importar evidencias</button>
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
                  <strong>Previa da discussion no Azure</strong>
                  <RichAzureHtml html={discussionPreviewHtml} />
                </div>
                <div className="mbaz-new-modal-preview-column">
                  <strong>Previa Slack</strong>
                  <SlackPreview text={slackPreviewText} />
                </div>
              </div>
            </div>
            ) : <div className="mbaz-new-modal-result-empty"><i className="bi bi-arrow-up" /> Selecione Approved, Fail ou Limitation para registrar evidencias.</div>}
            <div className="mbaz-new-modal-testbar-footer">
              {result && <button type="button" className="mbaz-new-modal-cancel-result" onClick={cancelResult} disabled={saving}>Cancelar</button>}
              <button type="button" className="mbaz-new-modal-save-result" onClick={saveResult} disabled={saving || !result || !selectedEnvironments.length}>{saving ? "Salvando..." : "Registrar resultado"}</button>
            </div>
          </div>
        )}
        </div>
      </section>
    </div>
  );
}
