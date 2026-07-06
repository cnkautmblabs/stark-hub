import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FiPlus, FiTrash2, FiDownload, FiUpload, FiSend } from "react-icons/fi";
import { supabase } from "../lib/supabaseClient.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { useTheme } from "../contexts/ThemeContext.jsx";
import { useCollaborators } from "../hooks/useCollaborators.js";
import { useAppSettings } from "../hooks/useAppSettings.js";
import { useFeatureFlags } from "../contexts/FeatureFlagsContext.jsx";
import { accessLevelLabels, accessLevels, defaultGoalHours } from "../utils/constants.js";
import { featureFlagLabels } from "../utils/mockData.js";
import { resolveSlackWebhooks } from "../utils/slack.js";
import AzureConnectionForm from "../components/common/AzureConnectionForm.jsx";
import AvatarUploader from "../components/common/AvatarUploader.jsx";

const defaultProductName = "Stark Hub";

// Porta fiel da tela "Configurações" do userscript legado (MB Azure Workbench
// v5.8.1, createSettingsDialogIfNeeded/openSettingsDialog): mesmas 4 seções —
// Produto e funcionalidades, Conexões (Azure + Slack), Governança e
// Colaboradores — mesmos campos, mesma ordem. Duas adaptações deliberadas
// para um app multi-tenant (o script rodava local, por navegador, sem login):
// 1) PAT/organização Azure são por perfil (cada usuário traz o próprio token),
//    não uma config global única; 2) edição de campos fica restrita à Gestão.
export default function Settings() {
  const { user, profile, demoMode } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { collaborators, updateCollaborator, addCollaborator } = useCollaborators();
  const { getSetting, updateSetting } = useAppSettings();
  const { flags, isEnabled, setFlag } = useFeatureFlags();
  const isGestao = profile?.accessLevel === accessLevels.gestao;

  const savedProductName = getSetting("productName", defaultProductName);
  const savedPipelines = getSetting("azurePipelines", {});
  const savedGoalHours = getSetting("defaultGoalHours", defaultGoalHours);
  const savedIterationPattern = getSetting("azureIterationPattern", "");
  const savedCustomQuery = getSetting("azureCustomQuery", "");
  const savedMaxItems = getSetting("azureMaxItems", 200);
  const savedAutoRefreshSeconds = getSetting("azureAutoRefreshSeconds", 60);
  const savedSlackWebhookUrl = getSetting("slackWebhookUrl", "");
  const savedSlackAdditionalWebhooks = getSetting("slackAdditionalWebhooks", []);
  const savedSlackTestMode = getSetting("slackTestMode", false);
  const savedSlackTestWebhookUrl = getSetting("slackTestWebhookUrl", "");

  const [productName, setProductName] = useState(defaultProductName);
  const [pipelineQaName, setPipelineQaName] = useState("");
  const [pipelineBetaName, setPipelineBetaName] = useState("");
  const [goalHours, setGoalHours] = useState(defaultGoalHours);
  const [iterationPattern, setIterationPattern] = useState("");
  const [customQuery, setCustomQuery] = useState("");
  const [maxItems, setMaxItems] = useState(200);
  const [autoRefreshSeconds, setAutoRefreshSeconds] = useState(60);
  const [slackWebhookUrl, setSlackWebhookUrl] = useState("");
  const [slackAdditionalWebhooks, setSlackAdditionalWebhooks] = useState([]);
  const [slackTestMode, setSlackTestMode] = useState(false);
  const [slackTestWebhookUrl, setSlackTestWebhookUrl] = useState("");
  const [slackStatus, setSlackStatus] = useState(null);
  const [slackSending, setSlackSending] = useState(false);
  const [savedFlash, setSavedFlash] = useState(null);
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [profileCreateError, setProfileCreateError] = useState(null);
  const [importError, setImportError] = useState(null);

  const myCollaborator = collaborators.find((c) => c.profileId === profile?.id);

  useEffect(() => { setProductName(savedProductName); }, [savedProductName]);

  useEffect(() => {
    setPipelineQaName(savedPipelines.qa || "");
    setPipelineBetaName(savedPipelines.beta || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedPipelines.qa, savedPipelines.beta]);

  useEffect(() => { setGoalHours(savedGoalHours); }, [savedGoalHours]);
  useEffect(() => { setIterationPattern(savedIterationPattern); }, [savedIterationPattern]);
  useEffect(() => { setCustomQuery(savedCustomQuery); }, [savedCustomQuery]);
  useEffect(() => { setMaxItems(savedMaxItems); }, [savedMaxItems]);
  useEffect(() => { setAutoRefreshSeconds(savedAutoRefreshSeconds); }, [savedAutoRefreshSeconds]);
  useEffect(() => { setSlackWebhookUrl(savedSlackWebhookUrl); }, [savedSlackWebhookUrl]);

  useEffect(() => {
    setSlackAdditionalWebhooks(savedSlackAdditionalWebhooks);
    // getSetting(..., []) devolve um array literal novo a cada render enquanto
    // a chave não existir salva — depender do array em si entra em loop
    // infinito (setState -> novo array -> effect de novo).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(savedSlackAdditionalWebhooks)]);

  useEffect(() => { setSlackTestMode(savedSlackTestMode); }, [savedSlackTestMode]);
  useEffect(() => { setSlackTestWebhookUrl(savedSlackTestWebhookUrl); }, [savedSlackTestWebhookUrl]);

  function flashSaved(key) {
    setSavedFlash(key);
    setTimeout(() => setSavedFlash((current) => (current === key ? null : current)), 2000);
  }

  async function saveProductName() {
    const { error } = await updateSetting("productName", productName.trim() || defaultProductName);
    if (!error) flashSaved("product");
  }

  async function savePipelines() {
    const { error } = await updateSetting("azurePipelines", { qa: pipelineQaName.trim(), beta: pipelineBetaName.trim() });
    if (!error) flashSaved("pipelines");
  }

  async function saveGoalHours() {
    const { error } = await updateSetting("defaultGoalHours", Number(goalHours) || defaultGoalHours);
    if (!error) flashSaved("goal");
  }

  async function saveIterationPattern() {
    const { error } = await updateSetting("azureIterationPattern", iterationPattern.trim());
    if (!error) flashSaved("iteration");
  }

  async function saveQuerySettings() {
    const clampedMax = Math.min(Math.max(Number(maxItems) || 200, 1), 2000);
    const [{ error: e1 }, { error: e2 }, { error: e3 }] = await Promise.all([
      updateSetting("azureCustomQuery", customQuery.trim()),
      updateSetting("azureMaxItems", clampedMax),
      updateSetting("azureAutoRefreshSeconds", Math.max(Number(autoRefreshSeconds) || 0, 0))
    ]);
    setMaxItems(clampedMax);
    if (!e1 && !e2 && !e3) flashSaved("query");
  }

  function resetCustomQuery() {
    setCustomQuery("");
  }

  function addSlackWebhookRow() {
    setSlackAdditionalWebhooks((current) => [...current, { id: `wh${Date.now()}`, name: "", url: "", enabled: true }]);
  }

  function updateSlackWebhookRow(id, patch) {
    setSlackAdditionalWebhooks((current) => current.map((webhook) => (webhook.id === id ? { ...webhook, ...patch } : webhook)));
  }

  function removeSlackWebhookRow(id) {
    setSlackAdditionalWebhooks((current) => current.filter((webhook) => webhook.id !== id));
  }

  async function saveSlackSettings() {
    const cleanedWebhooks = slackAdditionalWebhooks.filter((webhook) => webhook.url.trim());
    const [{ error: e1 }, { error: e2 }, { error: e3 }, { error: e4 }] = await Promise.all([
      updateSetting("slackWebhookUrl", slackWebhookUrl.trim()),
      updateSetting("slackAdditionalWebhooks", cleanedWebhooks),
      updateSetting("slackTestMode", Boolean(slackTestMode)),
      updateSetting("slackTestWebhookUrl", slackTestWebhookUrl.trim())
    ]);
    setSlackAdditionalWebhooks(cleanedWebhooks);
    if (!e1 && !e2 && !e3 && !e4) flashSaved("slack");
  }

  async function sendSlackTest() {
    setSlackSending(true);
    setSlackStatus(null);
    const draftSettings = { slackTestMode, slackTestWebhookUrl, slackWebhookUrl, slackAdditionalWebhooks };
    const webhooks = resolveSlackWebhooks((key, fallback) => draftSettings[key] ?? fallback);
    if (!webhooks.length) {
      setSlackStatus({ type: "error", message: "Informe (e salve) ao menos um webhook antes de testar." });
      setSlackSending(false);
      return;
    }
    const { data, error } = await supabase.functions.invoke("slackNotify", {
      body: { webhooks, text: ":test_tube: Mensagem de teste do Stark Hub." }
    });
    if (error || !data?.ok) {
      const failure = data?.results?.find((r) => !r.ok);
      setSlackStatus({ type: "error", message: failure?.error || failure?.body || error?.message || "Falha ao enviar." });
    } else {
      setSlackStatus({ type: "success", message: "Mensagem de teste enviada com sucesso." });
    }
    setSlackSending(false);
  }

  async function createMyCollaboratorProfile() {
    setCreatingProfile(true);
    setProfileCreateError(null);
    const { error } = await addCollaborator({ profileId: profile.id, azureName: profile?.fullName || profile?.email || "", isDev: true });
    if (error) setProfileCreateError(error.message || "Peça para a Gestão te cadastrar em Colaboradores.");
    setCreatingProfile(false);
  }

  // Exportação/importação sanitizada — mesmo espírito de exportWorkbenchConfig
  // do userscript legado: nunca inclui PAT nem URLs de webhook do Slack.
  function exportConfig() {
    const payload = {
      version: "stark-hub-1",
      exportedAt: new Date().toISOString(),
      securityNotice: "Exportação sanitizada: PAT e webhooks do Slack foram removidos automaticamente.",
      productName,
      featureFlags: flags,
      pipelines: { qa: pipelineQaName, beta: pipelineBetaName },
      defaultGoalHours: goalHours,
      azureIterationPattern: iterationPattern,
      azureCustomQuery: customQuery,
      azureMaxItems: maxItems,
      azureAutoRefreshSeconds: autoRefreshSeconds,
      slackAdditionalWebhookNames: slackAdditionalWebhooks.map((w) => ({ name: w.name, enabled: w.enabled }))
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "stark-hub-config-sanitized.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importConfig(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImportError(null);
    try {
      const payload = JSON.parse(await file.text());
      if (payload.productName) { setProductName(payload.productName); await updateSetting("productName", payload.productName); }
      if (payload.pipelines) {
        setPipelineQaName(payload.pipelines.qa || "");
        setPipelineBetaName(payload.pipelines.beta || "");
        await updateSetting("azurePipelines", payload.pipelines);
      }
      if (payload.defaultGoalHours != null) { setGoalHours(payload.defaultGoalHours); await updateSetting("defaultGoalHours", Number(payload.defaultGoalHours)); }
      if (payload.azureIterationPattern != null) { setIterationPattern(payload.azureIterationPattern); await updateSetting("azureIterationPattern", payload.azureIterationPattern); }
      if (payload.azureCustomQuery != null) { setCustomQuery(payload.azureCustomQuery); await updateSetting("azureCustomQuery", payload.azureCustomQuery); }
      if (payload.azureMaxItems != null) { setMaxItems(payload.azureMaxItems); await updateSetting("azureMaxItems", Number(payload.azureMaxItems)); }
      if (payload.azureAutoRefreshSeconds != null) { setAutoRefreshSeconds(payload.azureAutoRefreshSeconds); await updateSetting("azureAutoRefreshSeconds", Number(payload.azureAutoRefreshSeconds)); }
      if (payload.featureFlags) {
        await Promise.all(Object.entries(payload.featureFlags).map(([key, value]) => setFlag(key, Boolean(value))));
      }
      flashSaved("import");
    } catch (error) {
      setImportError(error.message || "Arquivo de configuração inválido.");
    }
  }

  const displayName = profile?.fullName || user?.email || "—";
  const email = profile?.email || user?.email || "—";
  const accessLevel = profile?.accessLevel;

  return (
    <div className="d-flex flex-column gap-3" style={{ maxWidth: 760 }}>
      <div className="stark-card">
        <h3>Configurações</h3>
        {demoMode && (
          <p className="text-muted small mb-0">
            Você está no modo demonstração. Conecte um projeto Supabase para editar dados reais.
          </p>
        )}
      </div>

      <div className="stark-card">
        <h6 className="text-muted text-uppercase small mb-2">Perfil</h6>
        <div className="d-flex align-items-center gap-3 mb-3">
          {myCollaborator ? (
            <AvatarUploader
              ownerId={myCollaborator.profileId || myCollaborator.id}
              name={myCollaborator.azureName || displayName}
              imageUrl={myCollaborator.imageUrl}
              color={myCollaborator.color}
              size={56}
              onUploaded={(url) => updateCollaborator(myCollaborator.id, { imageUrl: url })}
            />
          ) : demoMode ? (
            <span className="text-muted small">Foto disponível assim que seu colaborador for cadastrado.</span>
          ) : (
            <div className="d-flex flex-column gap-2 align-items-start">
              <span className="text-muted small">
                Você ainda não tem um cadastro de colaborador (nome no Azure/Slack, foto, aliases) — edite em
                "Colaboradores" abaixo assim que existir.
              </span>
              {isGestao ? (
                <button type="button" className="btn btn-sm btn-primary" onClick={createMyCollaboratorProfile} disabled={creatingProfile}>
                  {creatingProfile ? "Criando..." : "Criar meu cadastro de colaborador"}
                </button>
              ) : (
                <span className="text-muted small">Peça para a Gestão te cadastrar em Colaboradores.</span>
              )}
              {profileCreateError && <div className="alert alert-danger py-1 small mb-0">{profileCreateError}</div>}
            </div>
          )}
        </div>
        <p className="mb-1"><strong>Nome (conta Google):</strong> {displayName}</p>
        <p className="mb-1"><strong>E-mail:</strong> {email}</p>
        <p className="mb-0"><strong>Nível de acesso:</strong> {accessLevelLabels[accessLevel] || "—"}</p>
      </div>

      <div className="stark-card">
        <h6 className="text-muted text-uppercase small mb-2">Aparência</h6>
        <button type="button" className="btn btn-outline-secondary btn-sm" onClick={toggleTheme}>
          Alternar para modo {theme === "dark" ? "claro" : "escuro"}
        </button>
      </div>

      {!demoMode && (
        <div className="stark-card">
          <h6 className="text-muted text-uppercase small mb-2">Integração Azure DevOps (minha conta)</h6>
          <AzureConnectionForm submitLabel="Testar e atualizar" />
        </div>
      )}

      {/* ---- Produto e funcionalidades (1:1 com o userscript) ---- */}
      <div className="stark-card">
        <h6 className="text-muted text-uppercase small mb-2">Produto e funcionalidades</h6>
        {isGestao && !demoMode && (
          <div className="mb-3">
            <label className="form-label small mb-1">Nome do produto</label>
            <div className="d-flex align-items-center gap-2" style={{ maxWidth: 360 }}>
              <input className="form-control form-control-sm" value={productName} onChange={(e) => setProductName(e.target.value)} />
              <button type="button" className="btn btn-sm btn-primary" onClick={saveProductName}>Salvar</button>
              {savedFlash === "product" && <span className="text-success small">Salvo!</span>}
            </div>
          </div>
        )}
        <p className="text-muted small mb-1">
          {isGestao ? "Ativam/desativam módulos sem precisar de novo deploy." : "Somente Gestão pode editar."}
        </p>
        <div className="d-flex flex-column gap-2">
          {Object.entries(flags).map(([key]) => (
            <label key={key} className="stark-switch justify-content-between border-bottom pb-2">
              <span className="small">{featureFlagLabels[key] || key}</span>
              <span className="d-flex align-items-center gap-2">
                <input type="checkbox" checked={isEnabled(key)} disabled={!isGestao} onChange={(e) => setFlag(key, e.target.checked)} />
                <span className="stark-switch-track" />
              </span>
            </label>
          ))}
        </div>
      </div>

      {!demoMode && isGestao && (
        <div className="stark-card">
          {/* ---- Conexões (Azure + Slack aninhados, igual ao script) ---- */}
          <details className="stark-accordion" open>
            <summary>Conexões</summary>
            <div className="stark-accordion-body">
              <p className="text-muted small">
                Configuração compartilhada por toda a equipe: QA Board, Meus itens, Testes, Resultado e Governança.
              </p>

              <details className="stark-accordion" open>
                <summary>Azure DevOps e Pipelines</summary>
                <div className="stark-accordion-body">
                  <div className="mb-3">
                    <label className="form-label small mb-1">Padrão do nome da sprint/iteration (escopo por time)</label>
                    <p className="text-muted small">
                      A busca tenta primeiro as sprints do "Time" configurado na sua conexão pessoal acima. Se o nome
                      do Time não bater exatamente com a API do Azure DevOps, ela cai para a árvore de sprints do
                      projeto inteiro e filtra só as que contêm este padrão no nome (ex.: "MB Labs").
                    </p>
                    <div className="d-flex align-items-center gap-2">
                      <input className="form-control form-control-sm" style={{ maxWidth: 260 }} placeholder="ex: MB Labs" value={iterationPattern} onChange={(e) => setIterationPattern(e.target.value)} />
                      <button type="button" className="btn btn-sm btn-primary" onClick={saveIterationPattern}>Salvar</button>
                      {savedFlash === "iteration" && <span className="text-success small">Salvo!</span>}
                    </div>
                  </div>

                  <div className="mb-3">
                    <label className="form-label small mb-1 d-block">Pipelines (badge de ambiente no QA Board)</label>
                    <p className="text-muted small">Nome exato das pipelines de build. Requer PAT com escopo <strong>Build: Read</strong>.</p>
                    <div className="row g-2" style={{ maxWidth: 520 }}>
                      <div className="col-6">
                        <label className="form-label small mb-1">Pipeline QA</label>
                        <input className="form-control form-control-sm" value={pipelineQaName} onChange={(e) => setPipelineQaName(e.target.value)} placeholder="ex: build-qa" />
                      </div>
                      <div className="col-6">
                        <label className="form-label small mb-1">Pipeline BETA</label>
                        <input className="form-control form-control-sm" value={pipelineBetaName} onChange={(e) => setPipelineBetaName(e.target.value)} placeholder="ex: build-beta" />
                      </div>
                    </div>
                    <div className="d-flex align-items-center gap-2 mt-2">
                      <button type="button" className="btn btn-sm btn-primary" onClick={savePipelines}>Salvar pipelines</button>
                      {savedFlash === "pipelines" && <span className="text-success small">Salvo!</span>}
                    </div>
                  </div>

                  <div>
                    <label className="form-label small mb-1 d-block">Fonte de dados (Query WIQL)</label>
                    <p className="text-muted small">
                      Por padrão a busca traz Bug/Task/User Story/Feature que não estejam Removed/Closed. Escreva
                      aqui só a condição extra (sem <code>SELECT</code>/<code>WHERE</code>) — o escopo de time e
                      sprint acima continua sendo aplicado sempre, por segurança.
                    </p>
                    <textarea
                      className="form-control form-control-sm mb-2" rows={3} spellCheck={false}
                      placeholder="[System.WorkItemType] IN ('Bug','Task','User Story','Feature') AND [System.State] NOT IN ('Removed','Closed')"
                      value={customQuery} onChange={(e) => setCustomQuery(e.target.value)}
                    />
                    <div className="row g-2 align-items-end" style={{ maxWidth: 520 }}>
                      <div className="col-6">
                        <label className="form-label small mb-1">Limite de itens por atualização</label>
                        <input type="number" min="1" max="2000" step="1" className="form-control form-control-sm" value={maxItems} onChange={(e) => setMaxItems(e.target.value)} />
                      </div>
                      <div className="col-6">
                        <label className="form-label small mb-1">Auto-atualizar a cada (segundos, 0 = desativado)</label>
                        <input type="number" min="0" step="10" className="form-control form-control-sm" value={autoRefreshSeconds} onChange={(e) => setAutoRefreshSeconds(e.target.value)} />
                      </div>
                    </div>
                    <div className="d-flex align-items-center gap-2 mt-2">
                      <button type="button" className="btn btn-sm btn-primary" onClick={saveQuerySettings}>Salvar</button>
                      <button type="button" className="btn btn-sm btn-outline-secondary" onClick={resetCustomQuery}>Restaurar query padrão</button>
                      {savedFlash === "query" && <span className="text-success small">Salvo!</span>}
                    </div>
                  </div>
                </div>
              </details>

              <details className="stark-accordion">
                <summary>Slack</summary>
                <div className="stark-accordion-body">
                  <p className="text-muted small">
                    Quando um item avança para BETA, envia uma mensagem mencionando o responsável (Member ID
                    cadastrado em Colaboradores). Controlado pela funcionalidade "Notificar Slack quando item ficar
                    Ready to Beta" acima.
                  </p>
                  <label className="form-label small mb-1">Webhook principal</label>
                  <input
                    type="password" className="form-control form-control-sm mb-2"
                    placeholder="https://hooks.slack.com/services/..."
                    value={slackWebhookUrl} onChange={(e) => setSlackWebhookUrl(e.target.value)}
                  />
                  <div className="d-flex align-items-center justify-content-between mb-1">
                    <label className="form-label small mb-0">Canais adicionais</label>
                    <button type="button" className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1" onClick={addSlackWebhookRow}>
                      <FiPlus /> Adicionar
                    </button>
                  </div>
                  <div className="d-flex flex-column gap-2 mb-2">
                    {slackAdditionalWebhooks.map((webhook) => (
                      <div key={webhook.id} className="d-flex align-items-center gap-2">
                        <input type="checkbox" checked={webhook.enabled !== false} onChange={(e) => updateSlackWebhookRow(webhook.id, { enabled: e.target.checked })} title="Receber mensagens" />
                        <input className="form-control form-control-sm" style={{ maxWidth: 160 }} placeholder="Nome do canal" value={webhook.name} onChange={(e) => updateSlackWebhookRow(webhook.id, { name: e.target.value })} />
                        <input type="password" className="form-control form-control-sm" placeholder="https://hooks.slack.com/services/..." value={webhook.url} onChange={(e) => updateSlackWebhookRow(webhook.id, { url: e.target.value })} />
                        <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => removeSlackWebhookRow(webhook.id)} title="Remover"><FiTrash2 /></button>
                      </div>
                    ))}
                    {!slackAdditionalWebhooks.length && <span className="text-muted small">Nenhum webhook adicional.</span>}
                  </div>
                  <label className="stark-switch justify-content-between border-top pt-2">
                    <span><strong className="small">Modo teste</strong><small className="d-block text-muted">Substitui todos os webhooks acima pelo webhook de teste</small></span>
                    <span className="d-flex align-items-center gap-2">
                      <input type="checkbox" checked={slackTestMode} onChange={(e) => setSlackTestMode(e.target.checked)} />
                      <span className="stark-switch-track" />
                    </span>
                  </label>
                  {slackTestMode && (
                    <input type="password" className="form-control form-control-sm mt-2" placeholder="Webhook de teste" value={slackTestWebhookUrl} onChange={(e) => setSlackTestWebhookUrl(e.target.value)} />
                  )}
                  <div className="d-flex align-items-center gap-2 mt-3">
                    <button type="button" className="btn btn-sm btn-primary" onClick={saveSlackSettings}>Salvar</button>
                    {savedFlash === "slack" && <span className="text-success small">Salvo!</span>}
                  </div>
                </div>
              </details>
            </div>
          </details>

          {/* ---- Governança ---- */}
          <details className="stark-accordion">
            <summary>Governança</summary>
            <div className="stark-accordion-body">
              <label className="form-label small mb-1">Meta padrão de horas (por colaborador)</label>
              <div className="d-flex align-items-center gap-2">
                <input type="number" min="0" step="1" className="form-control form-control-sm" style={{ width: 120 }} value={goalHours} onChange={(e) => setGoalHours(e.target.value)} />
                <button type="button" className="btn btn-sm btn-primary" onClick={saveGoalHours}>Salvar</button>
                {savedFlash === "goal" && <span className="text-success small">Salvo!</span>}
              </div>
            </div>
          </details>

          <p className="text-muted small mt-3 mb-0">
            Cadastro único de identidade, aliases, permissões, Slack e aparência: gerencie em{" "}
            <Link to="/management/collaborators">Colaboradores</Link>.
          </p>

          <div className="d-flex align-items-center flex-wrap gap-2 mt-3 pt-3 border-top">
            <button type="button" className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1" onClick={exportConfig}>
              <FiDownload /> Exportar
            </button>
            <label className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1 mb-0">
              <FiUpload /> Importar
              <input type="file" accept="application/json" hidden onChange={importConfig} />
            </label>
            <button type="button" className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1" onClick={sendSlackTest} disabled={slackSending}>
              <FiSend /> {slackSending ? "Enviando..." : "Testar Slack"}
            </button>
            {savedFlash === "import" && <span className="text-success small">Importado!</span>}
          </div>
          {importError && <div className="alert alert-danger py-2 small mb-0 mt-2">{importError}</div>}
          {slackStatus && (
            <div className={`alert ${slackStatus.type === "error" ? "alert-danger" : "alert-success"} py-2 small mb-0 mt-2`}>
              {slackStatus.message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
