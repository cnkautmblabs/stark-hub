import { useMemo, useRef, useState } from "react";
import { useAuth } from "../../../contexts/AuthContext.jsx";
import { useWorkItems } from "../../../hooks/useWorkItems.js";
import { useToast } from "../../../contexts/ToastContext.jsx";
import { useAppSettings } from "../../../hooks/useAppSettings.js";
import { supabase } from "../../../lib/supabaseClient.js";
import { Button, CountryVisual, InfoTooltip } from "../ui/WorkbenchPrimitives.jsx";
import { resolveSlackWebhooks } from "../../../utils/slack.js";
import {
  breakpointOptions,
  buildWorkItemCreationSlackText,
  buildWorkItemDescriptionHtml,
  buildWorkItemImportPrompt,
  buildWorkItemTags,
  azureCountryOptions,
  countryList,
  demandTypeOptions,
  environmentOptions,
  featurePageGroups,
  featurePageOptions,
  planningPriorityOptions,
  reasonOptions,
  serviceLayerOptions,
  userTypeOptions,
  validateWorkItemWizardForm,
  workItemWizardTypes
} from "../../../utils/workItemWizard.js";

// Assistente de criacao de Work Item — menu de contexto (Epic/Feature/US/
// Bug/Task/Test Case), um formulario proprio por tipo, importacao de
// template (JSON salvo previamente) e upload de imagem/gif como evidencia
// embutida na descricao. Cria de verdade no Azure DevOps via o mesmo
// addItem() ja usado pelo formulario simples do Quality Board.
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function emptyFormFor(typeKey) {
  const base = {
    countries: [],
    relatedFeatures: [],
    context: "",
    businessRule: "",
    figmaLink: "",
    reason: "New",
    generalCountry: "",
    pmRider: "",
    platform: "WebApp",
    priority: "3 - Low",
    effort: "",
    startDate: "",
    targetDate: "",
    areaPath: "WebApp",
    iterationPath: ""
  };
  if (typeKey === "bug") {
    return { ...base, title: "", authorName: "", serviceLayers: [], backendDocumentation: "", environments: [], reproducibleInProd: false, reproSteps: "", breakpoints: [], location: "", user: "", password: "", userTypes: [] };
  }
  if (typeKey === "feature" || typeKey === "userStory") {
    return { ...base, title: "", authorName: "", validated: false, demandType: "", asA: "", iWant: "", soThat: "", acceptanceCriteria: "" };
  }
  if (typeKey === "task") {
    return { ...base, title: "", acceptanceCriteria: "", originalEstimate: "", completedHours: "", remainingHours: "0" };
  }
  return { ...base, title: "", acceptanceCriteria: "" };
}

function CountryToggle({ values, onChange }) {
  const selected = new Set(values || []);
  function toggle(code) {
    onChange(selected.has(code) ? values.filter((value) => value !== code) : [...values, code]);
  }
  return (
    <div className="mbwiz-chip-row">
      {countryList.map((code) => (
        <button key={code} type="button" className={`mbwiz-chip ${selected.has(code) ? "active" : ""}`} onClick={() => toggle(code)}>
          <CountryVisual code={code} compact /> {code}
        </button>
      ))}
    </div>
  );
}

function MultiChip({ options, values, onChange, renderLabel }) {
  function toggle(value) {
    onChange(values.includes(value) ? values.filter((v) => v !== value) : [...values, value]);
  }
  return (
    <div className="mbwiz-chip-row">
      {options.map((option) => (
        <button key={option.value || option} type="button" className={`mbwiz-chip ${values.includes(option.value || option) ? "active" : ""}`} onClick={() => toggle(option.value || option)}>
          {renderLabel ? renderLabel(option) : (option.label || option)}
        </button>
      ))}
    </div>
  );
}

function FeaturePageMultiSelect({ values = [], onChange }) {
  const [query, setQuery] = useState("");
  const selected = new Set(values);
  const filteredGroups = featurePageGroups.map((group) => ({
    ...group,
    pages: group.pages.filter((page) => `${group.feature} ${page}`.toLowerCase().includes(query.toLowerCase()))
  })).filter((group) => group.pages.length);
  function toggle(value) {
    onChange(selected.has(value) ? values.filter((item) => item !== value) : [...values, value]);
  }
  return (
    <div className="mbwiz-multiselect">
      <div className="mbwiz-multiselect-head">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar feature ou pagina..." />
        <button type="button" onClick={() => onChange([])}>Limpar selecao</button>
      </div>
      <div className="mbwiz-multiselect-list">
        {filteredGroups.map((group) => (
          <div key={group.feature} className="mbwiz-multiselect-group">
            <strong>{group.feature}</strong>
            {group.pages.map((page) => {
              const value = `${group.feature} :: ${page}`;
              return (
                <label key={value}>
                  <input type="checkbox" checked={selected.has(value)} onChange={() => toggle(value)} />
                  <span>{page}</span>
                </label>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function WorkItemSearchField({ label, value = "", onChange, items = [], placeholder }) {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState([]);
  function search() {
    const tokens = query.toLowerCase().split(/[,\s;]+/).filter(Boolean);
    const found = items.filter((item) => tokens.some((token) => String(item.id).includes(token) || String(item.title || "").toLowerCase().includes(token))).slice(0, 8);
    setResults(found);
  }
  function addId(id) {
    const ids = new Set(String(value || "").split(/[,\s;]+/).filter(Boolean));
    ids.add(String(id));
    onChange(Array.from(ids).join(", "));
  }
  return (
    <label className="mbwiz-field">
      <span>{label}</span>
      <div className="mbwiz-search-id">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder || "Digite ID ou titulo"} />
        <button type="button" onClick={search}>Buscar</button>
      </div>
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder="IDs selecionados" />
      {results.length > 0 && (
        <div className="mbwiz-id-results">
          {results.map((item) => (
            <button key={item.id} type="button" onClick={() => addId(item.id)}>
              <b>{item.type || "WI"} {item.id}</b>
              <span>{item.title}</span>
            </button>
          ))}
        </div>
      )}
    </label>
  );
}

export function CreateWorkItemWizard({ onClose, embedded = false, initialType = null }) {
  const { profile, user } = useAuth();
  const { addItem, items = [] } = useWorkItems();
  const { getSetting } = useAppSettings();
  const { pushToast } = useToast();
  const [typeKey, setTypeKey] = useState(initialType);
  const [form, setForm] = useState(() => initialType ? emptyFormFor(initialType) : {});
  const [attachments, setAttachments] = useState([]);
  const [confirmPayload, setConfirmPayload] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [missingFields, setMissingFields] = useState([]);
  const fileInputRef = useRef(null);
  const templateInputRef = useRef(null);

  const typeDef = workItemWizardTypes.find((entry) => entry.key === typeKey);
  const typeColor = typeDef?.key === "bug" ? "var(--starkTypeBug)" : typeDef?.key === "task" ? "var(--starkTypeTask)" : typeDef?.key === "userStory" ? "var(--starkTypeStory)" : typeDef?.key === "feature" ? "#7c3aed" : typeDef?.key === "epic" ? "#ea580c" : "var(--starkAccent)";
  const selectedCountries = form.countries || (form.country ? [form.country] : []);
  const selectedEnvironments = form.environments || (form.environment ? [form.environment] : []);
  const invalidSet = useMemo(() => new Set(missingFields), [missingFields]);

  function selectType(key) {
    setTypeKey(key);
    setForm(emptyFormFor(key));
    setAttachments([]);
    setConfirmPayload(null);
    setError("");
    setMissingFields([]);
  }

  function setField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
    setConfirmPayload(null);
    setMissingFields((current) => current.filter((field) => field !== key));
  }

  async function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const withData = await Promise.all(files.map(async (file) => ({ file, name: file.name, type: file.type, dataUrl: await readFileAsDataUrl(file) })));
    setAttachments((current) => [...current, ...withData]);
    setConfirmPayload(null);
  }

  async function handleAttachmentPick(event) {
    await addFiles(event.target.files || []);
    event.target.value = "";
  }

  function removeAttachment(index) {
    setAttachments((current) => current.filter((_, i) => i !== index));
    setConfirmPayload(null);
  }

  function exportTemplate() {
    const blob = new Blob([JSON.stringify({ typeKey, form }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stark-hub-template-${typeKey || "item"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleTemplateImport(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (parsed.typeKey) setTypeKey(parsed.typeKey);
      setForm((current) => ({ ...emptyFormFor(parsed.typeKey || typeKey), ...current, ...(parsed.form || {}) }));
      setConfirmPayload(null);
    } catch {
      setError("Nao foi possivel ler o template (JSON invalido).");
    }
  }

  function buildPayload(attachmentUrls = []) {
    const descriptionHtml = buildWorkItemDescriptionHtml(typeKey, form, attachmentUrls);
    const countries = selectedCountries;
    const tags = buildWorkItemTags(typeKey, countries);
    const item = {
      id: Date.now(),
      type: typeDef.azureType,
      title: form.title.trim(),
      description: descriptionHtml,
      countries,
      tags,
      countryValue: countries.join(", "),
      areaPath: form.areaPath || profile?.azureProject || "WebApp",
      sprint: form.iterationPath || undefined,
      priority: form.priority,
      effort: form.effort,
      startDate: form.startDate,
      targetDate: form.targetDate,
      originalEstimate: form.originalEstimate,
      completedHours: form.completedHours,
      remainingHours: form.remainingHours,
      parentId: form.parentId || undefined,
      relatedIds: form.relatedIds || "",
      childIds: form.childIds || "",
      createdAt: new Date().toISOString()
    };
    const slackText = buildWorkItemCreationSlackText({ item, form, authorName: profile?.azureName || user?.user_metadata?.full_name || user?.email });
    return { item, descriptionHtml, slackText };
  }

  function handleSubmit(event) {
    event.preventDefault();
    const missing = validateWorkItemWizardForm(typeKey, form);
    if (missing.length) {
      setMissingFields(missing);
      setError(`Preencha os campos obrigatorios: ${missing.join(", ")}.`);
      return;
    }
    setMissingFields([]);
    setError("");
    const previewUrls = attachments.map((attachment) => attachment.dataUrl).filter(Boolean);
    setConfirmPayload(buildPayload(previewUrls));
  }

  async function confirmCreate() {
    setSubmitting(true);
    setError("");
    try {
      let attachmentUrls = [];
      if (attachments.length && profile?.azureOrgUrl && profile?.azureProject && profile?.azurePat) {
        const uploads = await Promise.all(attachments.map((attachment) => supabase.functions.invoke("azureWorkItemAction", {
          body: {
            action: "attachment",
            orgUrl: profile.azureOrgUrl,
            project: profile.azureProject,
            pat: profile.azurePat,
            fileName: attachment.name,
            contentType: attachment.type,
            dataUrl: attachment.dataUrl
          }
        })));
        attachmentUrls = uploads.map((result) => result.data?.url).filter(Boolean);
      }

      const payload = buildPayload(attachmentUrls);
      const result = await addItem(payload.item);
      if (result?.ok === false) throw new Error(result.error || "Azure DevOps nao confirmou a criacao.");
      const createdItem = { ...payload.item, id: result?.id || payload.item.id };
      const webhooks = resolveSlackWebhooks(getSetting, "workItemCreation");
      if (webhooks.length) {
        const text = buildWorkItemCreationSlackText({ item: createdItem, form, authorName: profile?.azureName || user?.user_metadata?.full_name || user?.email });
        supabase.functions.invoke("slackNotify", { body: { webhooks, text } }).catch(() => {});
      }
      pushToast({ title: "Work item criado", body: `${typeDef.label} ${createdItem.id || ""} - ${form.title}`, tone: "success" });
      onClose();
    } catch (err) {
      setError(err?.message || "Falha ao criar o work item.");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyImportPrompt() {
    const text = buildWorkItemImportPrompt({ typeKey, form });
    await navigator.clipboard?.writeText(text);
    pushToast({ title: "Prompt copiado", body: "Use com a IA para gerar o JSON de importacao.", tone: "success" });
  }

  function fieldClass(key) {
    const labels = {
      countries: "Pais",
      title: "Titulo",
      environments: "Ambiente",
      serviceLayers: "Service Layer / Parceiro",
      relatedFeatures: "Feature/Pagina relacionada",
      context: "Contexto",
      reproSteps: "Passos para reproducao",
      businessRule: "Regra de negocio / solucao esperada",
      demandType: "Tipo de demanda",
      asA: "Como um...",
      iWant: "Eu quero...",
      soThat: "Para que...",
      acceptanceCriteria: "Criterios de aceite",
      originalEstimate: "Original estimate",
      completedHours: "Completed"
    };
    return invalidSet.has(labels[key] || key) ? " is-invalid" : "";
  }

  function updateTaskHours(key, value) {
    const next = { ...form, [key]: value };
    const original = Number(key === "originalEstimate" ? value : next.originalEstimate) || 0;
    const completed = Number(key === "completedHours" ? value : next.completedHours) || 0;
    next.remainingHours = Math.max(0, original - completed).toString();
    setForm(next);
    setConfirmPayload(null);
  }

  const content = (
      <section className={`mbaz-new-modal mbwiz-modal ${embedded ? "embedded" : ""}`} style={{ "--mbwiz-accent": typeColor }} onClick={(event) => event.stopPropagation()}>
        <header className="mbaz-new-modal-header">
          <div className="mbaz-new-modal-title"><i className="bi bi-magic" /> <span>{typeDef ? `Novo ${typeDef.label}` : "Criar Work Item"}</span></div>
          <div className="mbaz-new-modal-actions">
            {typeKey && <button type="button" className="mbaz-new-modal-close" title="Trocar tipo" onClick={() => selectType(null)}><i className="bi bi-arrow-left" /></button>}
            <button type="button" className="mbaz-new-modal-close" onClick={onClose}><i className="bi bi-x-lg" /></button>
          </div>
        </header>
        <div className="mbaz-new-modal-body mbwiz-body">
          {!typeKey ? (
            <div className="mbwiz-type-grid">
              {workItemWizardTypes.map((entry) => (
                <button key={entry.key} type="button" className="mbwiz-type-card" onClick={() => selectType(entry.key)}>
                  <i className={`bi ${entry.icon}`} />
                  <span>{entry.label}</span>
                </button>
              ))}
            </div>
          ) : (
            <form data-allow-submit="true" className="mbwiz-form" onSubmit={handleSubmit}>
              <div className="mbwiz-form-toolbar">
                <input ref={templateInputRef} type="file" accept=".json" hidden onChange={handleTemplateImport} />
                <Button type="button" onClick={() => templateInputRef.current?.click()}><i className="bi bi-upload" /> Importar template</Button>
                <Button type="button" onClick={exportTemplate}><i className="bi bi-download" /> Salvar como template</Button>
                <Button type="button" onClick={copyImportPrompt}><i className="bi bi-stars" /> Copiar prompt IA</Button>
              </div>

              <div className={`mbwiz-field${fieldClass("countries")}`}><span>Pais * <InfoTooltip text="Paises afetados pela demanda - viram tags 0-PAIS automaticamente." /></span><CountryToggle values={selectedCountries} onChange={(value) => setField("countries", value)} /></div>

              <label className={`mbwiz-field${fieldClass("title")}`}><span>Titulo *</span><input value={form.title || ""} onChange={(event) => setField("title", event.target.value)} placeholder="Titulo do work item" /></label>

              {(typeKey === "bug" || typeKey === "feature" || typeKey === "userStory") && (
                <label className="mbwiz-field"><span>Seu nome (referencia)</span><input value={form.authorName || ""} onChange={(event) => setField("authorName", event.target.value)} placeholder="Pra ajudar a entender de quem e o pedido" /></label>
              )}

              <label className={`mbwiz-field${fieldClass("relatedFeatures")}`}>
                <span>Feature/Pagina relacionada</span>
                <FeaturePageMultiSelect values={form.relatedFeatures || []} onChange={(values) => setField("relatedFeatures", values)} />
                {(form.relatedFeatures || []).length > 0 && (
                  <div className="mbwiz-chip-row">
                    {form.relatedFeatures.map((value) => {
                      const found = featurePageOptions.find((option) => option.value === value);
                      return <span key={value} className="mbwiz-chip active">{found?.label || value}<button type="button" onClick={() => setField("relatedFeatures", form.relatedFeatures.filter((v) => v !== value))}><i className="bi bi-x" /></button></span>;
                    })}
                  </div>
                )}
              </label>

              {typeKey === "bug" && (
                <>
                  <label className={`mbwiz-field${fieldClass("serviceLayers")}`}><span>Service Layer / Parceiro</span><MultiChip options={[{ value: "Nao sei / nao aplica", label: "Nao sei / nao aplica" }, ...serviceLayerOptions]} values={form.serviceLayers || []} onChange={(values) => setField("serviceLayers", values)} /></label>
                  <label className="mbwiz-field"><span>Documentacao de backend</span><input value={form.backendDocumentation || ""} onChange={(event) => setField("backendDocumentation", event.target.value)} placeholder="Link ou 'Not available'" /></label>
                  <label className={`mbwiz-field${fieldClass("environments")}`}><span>Ambiente</span><MultiChip options={environmentOptions} values={selectedEnvironments} onChange={(values) => setField("environments", values)} renderLabel={(option) => <><i className={`bi ${option === "QA" ? "bi-patch-check-fill" : option === "BETA" ? "bi-flask" : "bi-shield-check"}`} /> {option}</>} /></label>
                  <label className="mbwiz-switch-row"><span>Possivel reproduzir em PROD?</span><span className="mb-switch"><input type="checkbox" checked={Boolean(form.reproducibleInProd)} onChange={(event) => setField("reproducibleInProd", event.target.checked)} /><span className="mb-switch-slider" /></span></label>
                  <label className="mbwiz-field"><span>Passos para reproducao</span><textarea className="mbwiz-textarea" rows={4} value={form.reproSteps || ""} onChange={(event) => setField("reproSteps", event.target.value)} placeholder={"1. ...\n2. ...\n3. ..."} /></label>
                  <label className="mbwiz-field"><span>Breakpoint</span><MultiChip options={breakpointOptions} values={form.breakpoints || []} onChange={(values) => setField("breakpoints", values)} renderLabel={(option) => <><i className={`bi ${option.value === "360px" ? "bi-phone" : "bi-display"}`} /> {option.label}</>} /></label>
                  <div className="mbwiz-field-grid">
                    <label className="mbwiz-field"><span>Cinema/Localizacao</span><input value={form.location || ""} onChange={(event) => setField("location", event.target.value)} placeholder="Hoyts Unicenter, etc." /></label>
                    <label className="mbwiz-field"><span>Usuario</span><input value={form.user || ""} onChange={(event) => setField("user", event.target.value)} placeholder="email@email.com" /></label>
                    <label className="mbwiz-field"><span>Senha</span><input type="text" value={form.password || ""} onChange={(event) => setField("password", event.target.value)} /></label>
                  </div>
                  <label className="mbwiz-field"><span>Tipo de usuario</span><MultiChip options={userTypeOptions} values={form.userTypes || []} onChange={(values) => setField("userTypes", values)} renderLabel={(option) => <><i className="bi bi-person-badge" /> {option}</>} /></label>
                </>
              )}

              {(typeKey === "feature" || typeKey === "userStory") && (
                <>
                  <label className="mbwiz-switch-row"><span>Ja validado pela presidencia/Marketing?</span><span className="mb-switch"><input type="checkbox" checked={Boolean(form.validated)} onChange={(event) => setField("validated", event.target.checked)} /><span className="mb-switch-slider" /></span></label>
                  <label className="mbwiz-field"><span>Tipo de demanda</span><MultiChip options={demandTypeOptions} values={form.demandType ? [form.demandType] : []} onChange={(values) => setField("demandType", values[values.length - 1] || "")} /></label>
                  <label className="mbwiz-field"><span>Como um...</span><textarea className="mbwiz-textarea" rows={2} value={form.asA || ""} onChange={(event) => setField("asA", event.target.value)} placeholder="Que tipo de usuario esse item resolve o problema" /></label>
                  <label className="mbwiz-field"><span>Eu quero...</span><textarea className="mbwiz-textarea" rows={2} value={form.iWant || ""} onChange={(event) => setField("iWant", event.target.value)} placeholder="Eu quero poder..." /></label>
                  <label className="mbwiz-field"><span>Para que...</span><textarea className="mbwiz-textarea" rows={2} value={form.soThat || ""} onChange={(event) => setField("soThat", event.target.value)} placeholder="Qual o objetivo/comportamento esperado" /></label>
                  <label className="mbwiz-field"><span>Criterios de aceite</span><textarea className="mbwiz-textarea" rows={4} value={form.acceptanceCriteria || ""} onChange={(event) => setField("acceptanceCriteria", event.target.value)} placeholder={"Given...\nWhen...\nThen..."} /></label>
                </>
              )}

              {typeKey === "testCase" && (
                <label className="mbwiz-field"><span>Criterios de aceite / passos esperados</span><textarea className="mbwiz-textarea" rows={4} value={form.acceptanceCriteria || ""} onChange={(event) => setField("acceptanceCriteria", event.target.value)} placeholder={"1. ...\n2. ..."} /></label>
              )}

              <label className="mbwiz-field"><span>Contexto</span><textarea className="mbwiz-textarea" rows={3} value={form.context || ""} onChange={(event) => setField("context", event.target.value)} placeholder="Explique o contexto/cenario desta demanda" /></label>
              <label className="mbwiz-field"><span>Regra de negocio / solucao esperada</span><textarea className="mbwiz-textarea" rows={3} value={form.businessRule || ""} onChange={(event) => setField("businessRule", event.target.value)} /></label>
              <label className="mbwiz-field"><span>Link Figma (opcional)</span><input value={form.figmaLink || ""} onChange={(event) => setField("figmaLink", event.target.value)} placeholder="https://figma.com/..." /></label>
              <details className="mbwiz-section" open>
                <summary>Campos do Azure</summary>
                <div className="mbwiz-field-grid">
                  <label className="mbwiz-field"><span>Reason</span><select value={form.reason || "New"} onChange={(event) => setField("reason", event.target.value)}>{reasonOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
                  <label className="mbwiz-field"><span>Country</span><select value={form.generalCountry || ""} onChange={(event) => setField("generalCountry", event.target.value)}><option value="">Selecionar...</option>{azureCountryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                  <label className="mbwiz-field"><span>PmRider</span><input value={form.pmRider || ""} onChange={(event) => setField("pmRider", event.target.value)} /></label>
                  <label className="mbwiz-field"><span>Platform</span><input value={form.platform || ""} onChange={(event) => setField("platform", event.target.value)} placeholder="WebApp" /></label>
                  <label className="mbwiz-field"><span>Area</span><input value={form.areaPath || ""} onChange={(event) => setField("areaPath", event.target.value)} placeholder="WebApp" /></label>
                  <label className="mbwiz-field"><span>Iteration</span><input value={form.iterationPath || ""} onChange={(event) => setField("iterationPath", event.target.value)} placeholder="WebApp\\Jun26" /></label>
                  <label className="mbwiz-field"><span>Priority</span><select value={form.priority || "3 - Low"} onChange={(event) => setField("priority", event.target.value)}>{planningPriorityOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
                  <label className="mbwiz-field"><span>Effort</span><input type="number" value={form.effort || ""} onChange={(event) => setField("effort", event.target.value)} /></label>
                  <label className="mbwiz-field"><span>Start Date</span><input type="date" value={form.startDate || ""} onChange={(event) => setField("startDate", event.target.value)} /></label>
                  <label className="mbwiz-field"><span>Target Date</span><input type="date" value={form.targetDate || ""} onChange={(event) => setField("targetDate", event.target.value)} /></label>
                </div>
              </details>
              {typeKey === "task" && (
                <div className="mbwiz-field-grid">
                  <label className={`mbwiz-field${fieldClass("originalEstimate")}`}><span>Original estimate *</span><input type="number" min="0" value={form.originalEstimate || ""} onChange={(event) => updateTaskHours("originalEstimate", event.target.value)} /></label>
                  <label className={`mbwiz-field${fieldClass("completedHours")}`}><span>Completed *</span><input type="number" min="0" value={form.completedHours || ""} onChange={(event) => updateTaskHours("completedHours", event.target.value)} /></label>
                  <label className="mbwiz-field"><span>Remaining</span><input type="number" min="0" value={form.remainingHours || "0"} readOnly /></label>
                </div>
              )}
              <div className="mbwiz-field-grid">
                <WorkItemSearchField label="Parent ID" value={form.parentId || ""} onChange={(value) => setField("parentId", value.replace(/[^\d,;\s]+/g, ""))} items={items} placeholder="Buscar pai por ID ou titulo" />
                <WorkItemSearchField label="Related IDs" value={form.relatedIds || ""} onChange={(value) => setField("relatedIds", value)} items={items} placeholder="Buscar relacionados por ID ou titulo" />
                <WorkItemSearchField label="Child IDs" value={form.childIds || ""} onChange={(value) => setField("childIds", value)} items={items} placeholder="Buscar filhos por ID ou titulo" />
              </div>

              <label className="mbwiz-field">
                <span>Imagens/gifs (evidencia) <InfoTooltip text="Anexado direto no Azure DevOps e embutido na descricao do item." /></span>
                <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={handleAttachmentPick} />
                <div className="mbwiz-dropzone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addFiles(event.dataTransfer.files); }}>
                  <i className="bi bi-image" />
                  <strong>Arraste imagens ou GIFs aqui</strong>
                  <span>ou importe arquivos do computador</span>
                  <Button type="button" onClick={() => fileInputRef.current?.click()}><i className="bi bi-upload" /> Importar evidencias</Button>
                </div>
                {attachments.length > 0 && (
                  <div className="mbwiz-attachments">
                    {attachments.map((attachment, index) => (
                      <div key={index} className="mbwiz-attachment-thumb">
                        <img src={attachment.dataUrl} alt={attachment.name} />
                        <button type="button" onClick={() => removeAttachment(index)}><i className="bi bi-x" /></button>
                      </div>
                    ))}
                  </div>
                )}
              </label>

              {error && <div className="mbw-alert error">{error}</div>}

              {confirmPayload && (
                <div className="mbwiz-confirm-panel">
                  <div className="mbwiz-confirm-head">
                    <strong>Tem certeza que deseja criar este work item?</strong>
                    <span>Revise a descricao do Azure e a mensagem do Slack antes de confirmar.</span>
                  </div>
                  <div className="mbwiz-preview-grid">
                    <section>
                      <h4>Descricao no Azure</h4>
                      <div className="mbwiz-html-preview" dangerouslySetInnerHTML={{ __html: confirmPayload.descriptionHtml }} />
                    </section>
                    <section>
                      <h4>Mensagem Slack</h4>
                      <pre>{confirmPayload.slackText}</pre>
                    </section>
                  </div>
                  <div className="mbwiz-submit-row compact">
                    <Button type="button" onClick={() => setConfirmPayload(null)}>Editar</Button>
                    <Button type="button" tone="primary" disabled={submitting} onClick={confirmCreate}>{submitting ? "Criando..." : "Confirmar e criar"}</Button>
                  </div>
                </div>
              )}

              <div className="mbwiz-submit-row">
                <Button type="button" onClick={onClose}>Cancelar</Button>
                <Button type="submit" tone="primary" disabled={submitting}>{confirmPayload ? "Atualizar previa" : "Gerar previa"}</Button>
              </div>
            </form>
          )}
        </div>
      </section>
  );
  if (embedded) return content;
  return <div className="mbaz-new-modal-overlay" onClick={onClose}>{content}</div>;
}
