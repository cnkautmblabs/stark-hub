import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../../contexts/AuthContext.jsx";
import { useWorkItems } from "../../../hooks/useWorkItems.js";
import { useToast } from "../../../contexts/ToastContext.jsx";
import { useAppSettings } from "../../../hooks/useAppSettings.js";
import { supabase } from "../../../lib/supabaseClient.js";
import { Button, CountryVisual, FilterCombobox, InfoTooltip, envIconSrc, typeIconSrc } from "../ui/WorkbenchPrimitives.jsx";
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
  featurePageOptions,
  planningPriorityOptions,
  reasonOptions,
  serviceLayerOptions,
  userTypeIconSrc,
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
    return { ...base, title: "", serviceLayers: [], backendDocumentation: "", environments: [], reproducibleInProd: false, reproSteps: "", breakpoints: [], location: "", user: "", password: "", userTypes: [] };
  }
  if (typeKey === "feature" || typeKey === "userStory") {
    return { ...base, title: "", validated: false, demandType: "", asA: "", iWant: "", soThat: "", acceptanceCriteria: "" };
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

// Cor por tipo de work item nos resultados de busca — mesmo mapa usado no
// acento do proprio wizard (typeColor), generalizado pra qualquer item
// encontrado na busca (nao so o tipo que esta sendo criado agora).
function azureTypeColorVar(type) {
  const key = String(type || "").toLowerCase();
  if (key === "bug") return "var(--starkTypeBug)";
  if (key === "task") return "var(--starkTypeTask)";
  if (key === "user story") return "var(--starkTypeStory)";
  if (key === "feature") return "#7c3aed";
  if (key === "epic") return "#ea580c";
  if (key === "test case") return "#0ea5e9";
  return "var(--starkAccent)";
}

// Um unico buscador de work items pra linkar Parent/Related/Child — antes
// eram 3 campos de busca identicos e separados; agora e uma busca so, e
// cada resultado pode ser marcado com o papel certo direto na lista.
function WorkItemLinkPicker({ form, setField, items = [] }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const results = useMemo(() => {
    const tokens = query.trim().toLowerCase().split(/[,\s;]+/).filter(Boolean);
    if (!tokens.length) return [];
    return items.filter((item) => tokens.some((token) => String(item.id).includes(token) || String(item.title || "").toLowerCase().includes(token))).slice(0, 8);
  }, [query, items]);

  function idsFor(key) {
    return String(form[key] || "").split(/[,\s;]+/).filter(Boolean);
  }

  function addToRole(item, role) {
    if (role === "parent") { setField("parentId", String(item.id)); return; }
    const key = role === "related" ? "relatedIds" : "childIds";
    const ids = new Set(idsFor(key));
    ids.add(String(item.id));
    setField(key, Array.from(ids).join(", "));
  }

  function removeFromRole(id, role) {
    if (role === "parent") { setField("parentId", ""); return; }
    const key = role === "related" ? "relatedIds" : "childIds";
    setField(key, idsFor(key).filter((value) => value !== String(id)).join(", "));
  }

  const roleRows = [
    { key: "parent", label: "Parent", ids: form.parentId ? [String(form.parentId)] : [] },
    { key: "related", label: "Related", ids: idsFor("relatedIds") },
    { key: "child", label: "Child", ids: idsFor("childIds") }
  ];

  return (
    <div className="mbwiz-link-picker">
      <label className="mbwiz-field">
        <span>{t("wizard.linkPickerLabel")}</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("wizard.linkPickerPlaceholder")} />
      </label>
      {results.length > 0 && (
        <div className="mbwiz-id-results">
          {results.map((item) => (
            <div key={item.id} className="mbwiz-id-result">
              <img className="mbwiz-id-result-icon" src={typeIconSrc(item.type)} alt="" />
              <b className="mbwiz-id-result-id" style={{ color: azureTypeColorVar(item.type) }}>{item.id}</b>
              <span className="mbwiz-id-result-title">{item.title}</span>
              <div className="mbwiz-id-result-actions">
                <button type="button" onClick={() => addToRole(item, "parent")}>{t("wizard.parentButton")}</button>
                <button type="button" onClick={() => addToRole(item, "related")}>{t("wizard.relatedButton")}</button>
                <button type="button" onClick={() => addToRole(item, "child")}>{t("wizard.childButton")}</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="mbwiz-link-roles">
        {roleRows.map((row) => (
          <div key={row.key} className="mbwiz-link-role">
            <strong>{row.label}</strong>
            <div className="mbwiz-chip-row">
              {row.ids.length ? row.ids.map((id) => (
                <span key={id} className="mbwiz-chip active">{id}<button type="button" onClick={() => removeFromRole(id, row.key)}><i className="bi bi-x" /></button></span>
              )) : <em className="mbwiz-link-role-empty">{t("wizard.noneLabel")}</em>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CreateWorkItemWizard({ onClose, embedded = false, initialType = null }) {
  const { t } = useTranslation();
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
      setError(t("wizard.invalidTemplateFile"));
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
      setError(t("wizard.fillRequiredFields", { fields: missing.join(", ") }));
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
      if (result?.ok === false) throw new Error(result.error || t("wizard.azureCreationNotConfirmed"));
      const createdItem = { ...payload.item, id: result?.id || payload.item.id };
      const webhooks = resolveSlackWebhooks(getSetting, "workItemCreation");
      if (webhooks.length) {
        const text = buildWorkItemCreationSlackText({ item: createdItem, form, authorName: profile?.azureName || user?.user_metadata?.full_name || user?.email });
        supabase.functions.invoke("slackNotify", { body: { webhooks, text } }).catch(() => {});
      }
      pushToast({ title: t("wizard.itemCreatedTitle"), body: `${typeDef.label} ${createdItem.id || ""} - ${form.title}`, tone: "success" });
      onClose();
    } catch (err) {
      setError(err?.message || t("wizard.createFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  async function copyImportPrompt() {
    const text = buildWorkItemImportPrompt({ typeKey, form });
    await navigator.clipboard?.writeText(text);
    pushToast({ title: t("wizard.promptCopiedTitle"), body: t("wizard.promptCopiedBody"), tone: "success" });
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
          <div className="mbaz-new-modal-title"><i className="bi bi-magic" /> <span>{typeDef ? t("wizard.newItemTitle", { type: typeDef.label }) : t("wizard.createTitle")}</span></div>
          <div className="mbaz-new-modal-actions">
            {typeKey && <button type="button" className="mbaz-new-modal-close" title={t("wizard.changeTypeTitle")} onClick={() => selectType(null)}><i className="bi bi-arrow-left" /></button>}
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
                <Button type="button" onClick={() => templateInputRef.current?.click()}><i className="bi bi-upload" /> {t("wizard.importTemplate")}</Button>
                <Button type="button" onClick={exportTemplate}><i className="bi bi-download" /> {t("wizard.saveAsTemplate")}</Button>
                <Button type="button" onClick={copyImportPrompt}><i className="bi bi-stars" /> {t("wizard.copyAiPrompt")}</Button>
              </div>

              <div className={`mbwiz-field${fieldClass("countries")}`}><span>{t("wizard.countryLabel")} <InfoTooltip text={t("wizard.countryTooltip")} /></span><CountryToggle values={selectedCountries} onChange={(value) => setField("countries", value)} /></div>

              <label className={`mbwiz-field${fieldClass("title")}`}><span>{t("wizard.titleLabel")}</span><input value={form.title || ""} onChange={(event) => setField("title", event.target.value)} placeholder={t("wizard.titlePlaceholder")} /></label>

              <label className={`mbwiz-field mbwiz-field-full${fieldClass("relatedFeatures")}`}>
                <span>{t("wizard.relatedFeaturesLabel")}</span>
                <FilterCombobox label={t("wizard.relatedFeaturesComboLabel")} options={featurePageOptions} values={form.relatedFeatures || []} onChange={(values) => setField("relatedFeatures", values)} placeholder={t("wizard.relatedFeaturesPlaceholder")} renderOption={(option) => <span title={option.group}>{option.label}</span>} />
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
                  <label className={`mbwiz-field mbwiz-field-full${fieldClass("serviceLayers")}`}><span>{t("wizard.serviceLayerLabel")}</span><MultiChip options={[{ value: "Nao sei / nao aplica", label: t("wizard.serviceLayerNotApplicable") }, ...serviceLayerOptions]} values={form.serviceLayers || []} onChange={(values) => setField("serviceLayers", values)} /></label>
                  <label className="mbwiz-field"><span>{t("wizard.backendDocLabel")}</span><input value={form.backendDocumentation || ""} onChange={(event) => setField("backendDocumentation", event.target.value)} placeholder={t("wizard.backendDocPlaceholder")} /></label>
                  <label className={`mbwiz-field${fieldClass("environments")}`}><span>{t("wizard.environmentLabel")}</span><MultiChip options={environmentOptions} values={selectedEnvironments} onChange={(values) => setField("environments", values)} renderLabel={(option) => <><img className="mbwiz-chip-icon" src={envIconSrc(option)} alt="" /> {option}</>} /></label>
                  <label className="mbwiz-switch-row"><span>{t("wizard.reproInProdLabel")}</span><span className="mb-switch"><input type="checkbox" checked={Boolean(form.reproducibleInProd)} onChange={(event) => setField("reproducibleInProd", event.target.checked)} /><span className="mb-switch-slider" /></span></label>
                  <label className="mbwiz-field"><span>{t("wizard.reproStepsLabel")}</span><textarea className="mbwiz-textarea" rows={4} value={form.reproSteps || ""} onChange={(event) => setField("reproSteps", event.target.value)} placeholder={"1. ...\n2. ...\n3. ..."} /></label>
                  <label className="mbwiz-field"><span>{t("wizard.breakpointLabel")}</span><MultiChip options={breakpointOptions} values={form.breakpoints || []} onChange={(values) => setField("breakpoints", values)} renderLabel={(option) => <><i className={`bi ${option.value === "360px" ? "bi-phone" : "bi-display"}`} /> {option.label}</>} /></label>
                  <div className="mbwiz-field-grid">
                    <label className="mbwiz-field"><span>{t("wizard.locationLabel")}</span><input value={form.location || ""} onChange={(event) => setField("location", event.target.value)} placeholder={t("wizard.locationPlaceholder")} /></label>
                    <label className="mbwiz-field"><span>{t("wizard.userLabel")}</span><input value={form.user || ""} onChange={(event) => setField("user", event.target.value)} placeholder="email@email.com" /></label>
                    <label className="mbwiz-field"><span>{t("wizard.passwordLabel")}</span><input type="text" value={form.password || ""} onChange={(event) => setField("password", event.target.value)} /></label>
                  </div>
                  <label className="mbwiz-field mbwiz-field-full"><span>{t("wizard.userTypeLabel")}</span><MultiChip options={userTypeOptions} values={form.userTypes || []} onChange={(values) => setField("userTypes", values)} renderLabel={(option) => { const icon = userTypeIconSrc(option); return <>{icon ? <img className="mbwiz-chip-icon" src={icon} alt="" /> : <i className="bi bi-person-badge" />} {option}</>; }} /></label>
                </>
              )}

              {(typeKey === "feature" || typeKey === "userStory") && (
                <>
                  <label className="mbwiz-switch-row"><span>{t("wizard.validatedLabel")}</span><span className="mb-switch"><input type="checkbox" checked={Boolean(form.validated)} onChange={(event) => setField("validated", event.target.checked)} /><span className="mb-switch-slider" /></span></label>
                  <label className="mbwiz-field"><span>{t("wizard.demandTypeLabel")}</span><MultiChip options={demandTypeOptions} values={form.demandType ? [form.demandType] : []} onChange={(values) => setField("demandType", values[values.length - 1] || "")} /></label>
                  <label className="mbwiz-field"><span>{t("wizard.asALabel")}</span><textarea className="mbwiz-textarea" rows={2} value={form.asA || ""} onChange={(event) => setField("asA", event.target.value)} placeholder={t("wizard.asAPlaceholder")} /></label>
                  <label className="mbwiz-field"><span>{t("wizard.iWantLabel")}</span><textarea className="mbwiz-textarea" rows={2} value={form.iWant || ""} onChange={(event) => setField("iWant", event.target.value)} placeholder={t("wizard.iWantPlaceholder")} /></label>
                  <label className="mbwiz-field"><span>{t("wizard.soThatLabel")}</span><textarea className="mbwiz-textarea" rows={2} value={form.soThat || ""} onChange={(event) => setField("soThat", event.target.value)} placeholder={t("wizard.soThatPlaceholder")} /></label>
                  <label className="mbwiz-field"><span>{t("wizard.acceptanceCriteriaLabel")}</span><textarea className="mbwiz-textarea" rows={4} value={form.acceptanceCriteria || ""} onChange={(event) => setField("acceptanceCriteria", event.target.value)} placeholder={"Given...\nWhen...\nThen..."} /></label>
                </>
              )}

              {typeKey === "testCase" && (
                <label className="mbwiz-field"><span>{t("wizard.testCaseCriteriaLabel")}</span><textarea className="mbwiz-textarea" rows={4} value={form.acceptanceCriteria || ""} onChange={(event) => setField("acceptanceCriteria", event.target.value)} placeholder={"1. ...\n2. ..."} /></label>
              )}

              <label className="mbwiz-field"><span>{t("wizard.contextLabel")}</span><textarea className="mbwiz-textarea" rows={3} value={form.context || ""} onChange={(event) => setField("context", event.target.value)} placeholder={t("wizard.contextPlaceholder")} /></label>
              <label className="mbwiz-field"><span>{t("wizard.businessRuleLabel")}</span><textarea className="mbwiz-textarea" rows={3} value={form.businessRule || ""} onChange={(event) => setField("businessRule", event.target.value)} /></label>
              <label className="mbwiz-field"><span>{t("wizard.figmaLabel")}</span><input value={form.figmaLink || ""} onChange={(event) => setField("figmaLink", event.target.value)} placeholder="https://figma.com/..." /></label>
              <details className="mbwiz-section" open>
                <summary>{t("wizard.azureFieldsSection")}</summary>
                <div className="mbwiz-field-grid">
                  <label className="mbwiz-field"><span>Reason</span><select value={form.reason || "New"} onChange={(event) => setField("reason", event.target.value)}>{reasonOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
                  <label className="mbwiz-field"><span>Country</span><select value={form.generalCountry || ""} onChange={(event) => setField("generalCountry", event.target.value)}><option value="">{t("wizard.selectPlaceholder")}</option>{azureCountryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
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
              <WorkItemLinkPicker form={form} setField={setField} items={items} />

              <label className="mbwiz-field mbwiz-field-full">
                <span>{t("wizard.attachmentsLabel")} <InfoTooltip text={t("wizard.attachmentsTooltip")} /></span>
                <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={handleAttachmentPick} />
                <div className="mbwiz-dropzone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addFiles(event.dataTransfer.files); }}>
                  <i className="bi bi-image" />
                  <strong>{t("wizard.dropzoneTitle")}</strong>
                  <span>{t("wizard.dropzoneSubtitle")}</span>
                  <Button type="button" onClick={() => fileInputRef.current?.click()}><i className="bi bi-upload" /> {t("wizard.importEvidenceButton")}</Button>
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
                    <strong>{t("wizard.confirmTitle")}</strong>
                    <span>{t("wizard.confirmSubtitle")}</span>
                  </div>
                  <div className="mbwiz-preview-grid">
                    <section>
                      <h4>{t("wizard.azureDescriptionHeading")}</h4>
                      <div className="mbwiz-html-preview" dangerouslySetInnerHTML={{ __html: confirmPayload.descriptionHtml }} />
                    </section>
                    <section>
                      <h4>{t("wizard.slackMessageHeading")}</h4>
                      <pre>{confirmPayload.slackText}</pre>
                    </section>
                  </div>
                  <div className="mbwiz-submit-row compact">
                    <Button type="button" onClick={() => setConfirmPayload(null)}>{t("wizard.editButton")}</Button>
                    <Button type="button" tone="primary" disabled={submitting} onClick={confirmCreate}>{submitting ? t("wizard.creatingButton") : t("wizard.confirmCreateButton")}</Button>
                  </div>
                </div>
              )}

              <div className="mbwiz-submit-row">
                <Button type="button" onClick={onClose}>{t("wizard.cancelButton")}</Button>
                <Button type="submit" tone="primary" disabled={submitting}>{confirmPayload ? t("wizard.updatePreviewButton") : t("wizard.generatePreviewButton")}</Button>
              </div>
            </form>
          )}
        </div>
      </section>
  );
  if (embedded) return content;
  return <div className="mbaz-new-modal-overlay" onClick={onClose}>{content}</div>;
}
