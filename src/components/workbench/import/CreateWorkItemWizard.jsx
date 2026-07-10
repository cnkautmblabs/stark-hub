import { useRef, useState } from "react";
import { useAuth } from "../../../contexts/AuthContext.jsx";
import { useWorkItems } from "../../../hooks/useWorkItems.js";
import { useToast } from "../../../contexts/ToastContext.jsx";
import { supabase } from "../../../lib/supabaseClient.js";
import { Button, InfoTooltip } from "../ui/WorkbenchPrimitives.jsx";
import {
  breakpointOptions,
  buildBugDescriptionHtml,
  buildFeatureDescriptionHtml,
  buildGenericDescriptionHtml,
  buildWorkItemTags,
  appendAttachmentsHtml,
  countryList,
  demandTypeOptions,
  environmentOptions,
  featurePageGroups,
  featurePageOptions,
  serviceLayerOptions,
  userTypeOptions,
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
  const base = { country: "", relatedFeatures: [], context: "", businessRule: "", figmaLink: "" };
  if (typeKey === "bug") {
    return { ...base, title: "", authorName: "", serviceLayer: "", backendDocumentation: "", environment: "", reproducibleInProd: false, reproSteps: "", breakpoint: "", location: "", user: "", password: "", userType: "" };
  }
  if (typeKey === "feature" || typeKey === "userStory") {
    return { ...base, title: "", authorName: "", validated: false, demandType: "", asA: "", iWant: "", soThat: "", acceptanceCriteria: "" };
  }
  return { ...base, title: "", acceptanceCriteria: "" };
}

function CountryToggle({ value, onChange }) {
  return (
    <div className="mbwiz-chip-row">
      {countryList.map((code) => (
        <button key={code} type="button" className={`mbwiz-chip ${value === code ? "active" : ""}`} onClick={() => onChange(code)}>{code}</button>
      ))}
    </div>
  );
}

function MultiChip({ options, values, onChange }) {
  function toggle(value) {
    onChange(values.includes(value) ? values.filter((v) => v !== value) : [...values, value]);
  }
  return (
    <div className="mbwiz-chip-row">
      {options.map((option) => (
        <button key={option.value || option} type="button" className={`mbwiz-chip ${values.includes(option.value || option) ? "active" : ""}`} onClick={() => toggle(option.value || option)}>{option.label || option}</button>
      ))}
    </div>
  );
}

export function CreateWorkItemWizard({ onClose }) {
  const { profile, user } = useAuth();
  const { addItem } = useWorkItems();
  const { pushToast } = useToast();
  const [typeKey, setTypeKey] = useState(null);
  const [form, setForm] = useState({});
  const [attachments, setAttachments] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);
  const templateInputRef = useRef(null);

  const typeDef = workItemWizardTypes.find((entry) => entry.key === typeKey);

  function selectType(key) {
    setTypeKey(key);
    setForm(emptyFormFor(key));
    setAttachments([]);
    setError("");
  }

  function setField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleAttachmentPick(event) {
    const files = Array.from(event.target.files || []);
    const withData = await Promise.all(files.map(async (file) => ({ file, name: file.name, type: file.type, dataUrl: await readFileAsDataUrl(file) })));
    setAttachments((current) => [...current, ...withData]);
    event.target.value = "";
  }

  function removeAttachment(index) {
    setAttachments((current) => current.filter((_, i) => i !== index));
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
    } catch {
      setError("Nao foi possivel ler o template (JSON invalido).");
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!form.title?.trim() && typeKey !== "bug") { setError("Titulo e obrigatorio."); return; }
    if (typeKey === "bug" && !form.title?.trim()) { setError("Titulo e obrigatorio."); return; }
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

      let descriptionHtml = "";
      if (typeKey === "bug") descriptionHtml = buildBugDescriptionHtml(form);
      else if (typeKey === "feature" || typeKey === "userStory") descriptionHtml = buildFeatureDescriptionHtml(form);
      else descriptionHtml = buildGenericDescriptionHtml(form);
      descriptionHtml = appendAttachmentsHtml(descriptionHtml, attachmentUrls);

      const countries = form.country ? [form.country] : [];
      const tags = buildWorkItemTags(typeKey, countries);

      await addItem({
        id: Date.now(),
        type: typeDef.azureType,
        title: form.title.trim(),
        description: descriptionHtml,
        countries,
        tags,
        countryValue: form.country,
        createdAt: new Date().toISOString()
      });

      pushToast({ title: "Work item criado", body: form.title, tone: "success" });
      onClose();
    } catch (err) {
      setError(err?.message || "Falha ao criar o work item.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mbaz-new-modal-overlay" onClick={onClose}>
      <section className="mbaz-new-modal mbwiz-modal" onClick={(event) => event.stopPropagation()}>
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
              </div>

              <label className="mbwiz-field"><span>Pais <InfoTooltip text="Pais afetado pela demanda — vira a tag 0-PAIS automaticamente." /></span><CountryToggle value={form.country} onChange={(value) => setField("country", value)} /></label>

              <label className="mbwiz-field"><span>Titulo *</span><input value={form.title || ""} onChange={(event) => setField("title", event.target.value)} placeholder="Titulo do work item" /></label>

              {(typeKey === "bug" || typeKey === "feature" || typeKey === "userStory") && (
                <label className="mbwiz-field"><span>Seu nome (referencia)</span><input value={form.authorName || ""} onChange={(event) => setField("authorName", event.target.value)} placeholder="Pra ajudar a entender de quem e o pedido" /></label>
              )}

              <label className="mbwiz-field">
                <span>Feature/Pagina relacionada</span>
                <select className="mbwiz-select" value="" onChange={(event) => { const value = event.target.value; if (value) setField("relatedFeatures", [...(form.relatedFeatures || []), value]); }}>
                  <option value="">Selecione para adicionar...</option>
                  {featurePageGroups.map((group) => (
                    <optgroup key={group.feature} label={group.feature}>
                      {group.pages.map((page) => <option key={page} value={`${group.feature} :: ${page}`}>{page}</option>)}
                    </optgroup>
                  ))}
                </select>
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
                  <label className="mbwiz-field"><span>Service Layer / Parceiro</span>
                    <select className="mbwiz-select" value={form.serviceLayer || ""} onChange={(event) => setField("serviceLayer", event.target.value)}>
                      <option value="">Nao sei / nao aplica</option>
                      {serviceLayerOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                  <label className="mbwiz-field"><span>Documentacao de backend</span><input value={form.backendDocumentation || ""} onChange={(event) => setField("backendDocumentation", event.target.value)} placeholder="Link ou 'Not available'" /></label>
                  <label className="mbwiz-field"><span>Ambiente</span><MultiChip options={environmentOptions} values={form.environment ? [form.environment] : []} onChange={(values) => setField("environment", values[values.length - 1] || "")} /></label>
                  <label className="mbwiz-switch-row"><span>Possivel reproduzir em PROD?</span><span className="mb-switch"><input type="checkbox" checked={Boolean(form.reproducibleInProd)} onChange={(event) => setField("reproducibleInProd", event.target.checked)} /><span className="mb-switch-slider" /></span></label>
                  <label className="mbwiz-field"><span>Passos para reproducao</span><textarea className="mbwiz-textarea" rows={4} value={form.reproSteps || ""} onChange={(event) => setField("reproSteps", event.target.value)} placeholder={"1. ...\n2. ...\n3. ..."} /></label>
                  <label className="mbwiz-field"><span>Breakpoint</span><MultiChip options={breakpointOptions} values={form.breakpoint ? [form.breakpoint] : []} onChange={(values) => setField("breakpoint", values[values.length - 1] || "")} /></label>
                  <div className="mbwiz-field-grid">
                    <label className="mbwiz-field"><span>Cinema/Localizacao</span><input value={form.location || ""} onChange={(event) => setField("location", event.target.value)} placeholder="Hoyts Unicenter, etc." /></label>
                    <label className="mbwiz-field"><span>Usuario</span><input value={form.user || ""} onChange={(event) => setField("user", event.target.value)} placeholder="email@email.com" /></label>
                    <label className="mbwiz-field"><span>Senha</span><input type="password" value={form.password || ""} onChange={(event) => setField("password", event.target.value)} /></label>
                  </div>
                  <label className="mbwiz-field"><span>Tipo de usuario</span><MultiChip options={userTypeOptions} values={form.userType ? [form.userType] : []} onChange={(values) => setField("userType", values[values.length - 1] || "")} /></label>
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

              <label className="mbwiz-field">
                <span>Imagens/gifs (evidencia) <InfoTooltip text="Anexado direto no Azure DevOps e embutido na descricao do item." /></span>
                <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={handleAttachmentPick} />
                <Button type="button" onClick={() => fileInputRef.current?.click()}><i className="bi bi-image" /> Adicionar imagem/gif</Button>
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

              <div className="mbwiz-submit-row">
                <Button type="button" onClick={onClose}>Cancelar</Button>
                <Button type="submit" tone="primary" disabled={submitting}>{submitting ? "Criando..." : "Criar Work Item"}</Button>
              </div>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
