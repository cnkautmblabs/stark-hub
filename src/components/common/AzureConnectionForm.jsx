import React, { useRef, useState } from "react";
import { supabase } from "../../lib/supabaseClient.js";
import { useAuth } from "../../contexts/AuthContext.jsx";
import { normalizeAzureOrgUrl } from "../../utils/azure.js";
import { writePersonalSettings } from "../../utils/personalSettings.js";

const DEFAULT_ORG_URL = "https://dev.azure.com/cinemarkintl";

export default function AzureConnectionForm({ onSuccess, submitLabel = "Testar e salvar" }) {
  const { profile, user, updateLocalAzureConnection } = useAuth();
  const [orgUrl, setOrgUrl] = useState(profile?.azureOrgUrl || DEFAULT_ORG_URL);
  const [project, setProject] = useState(profile?.azureProject || "");
  const [team, setTeam] = useState(profile?.azureTeam || "");
  const [pat, setPat] = useState("");
  const [status, setStatus] = useState(null);
  const [testing, setTesting] = useState(false);
  const importRef = useRef(null);

  const alreadyConnected = Boolean(profile?.azureVerifiedAt);

  // Arquivo gerado em Configuracoes ("Config. p/ equipe") — preenche org/
  // projeto/time (o PAT continua pessoal, cada um cola o proprio) e ja deixa
  // pipelines/webhook do Slack salvos localmente pra quando a pessoa chegar
  // em Configuracoes depois.
  function handleImportConfig(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(String(reader.result || "{}"));
        if (payload.schema !== "stark-hub-config" || payload.type !== "team-onboarding") {
          setStatus({ type: "error", message: "Arquivo de configuracao invalido." });
          return;
        }
        const azure = payload.azure || {};
        const slack = payload.slack || {};
        if (azure.orgUrl) setOrgUrl(azure.orgUrl);
        if (azure.project) setProject(azure.project);
        if (azure.team) setTeam(azure.team);
        writePersonalSettings(profile, user, {
          pipelineQaName: azure.pipelineQaName || "",
          pipelineBetaName: azure.pipelineBetaName || "",
          slackWebhookUrl: slack.webhookUrl || "",
          slackTestWebhookUrl: slack.testWebhookUrl || "",
          slackTestMode: Boolean(slack.testMode),
          slackPrimaryWebhookName: slack.primaryWebhookName || "Canal principal"
        });
        setStatus({ type: "success", message: "Configuracao importada. Falta so colar seu PAT pessoal e testar a conexao." });
      } catch {
        setStatus({ type: "error", message: "Nao foi possivel ler o arquivo de configuracao." });
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const effectivePat = pat || profile?.azurePat;
    if (!effectivePat) {
      setStatus({ type: "error", message: "Informe o Personal Access Token." });
      return;
    }

    setTesting(true);
    setStatus(null);
    try {
      const { data, error } = await supabase.functions.invoke("testAzureConnection", {
        body: { orgUrl, project, pat: effectivePat }
      });
      if (error) throw error;
      if (!data.ok) {
        setStatus({ type: "error", message: data.error });
        return;
      }

      // PAT/org/projeto/time ficam só no localStorage deste navegador — nunca
      // no Supabase (ver AuthContext.jsx updateLocalAzureConnection). Cada
      // colaborador reconecta com o próprio PAT em qualquer navegador novo.
      updateLocalAzureConnection({
        azureOrgUrl: orgUrl,
        azureProject: project,
        azureTeam: team,
        azurePat: effectivePat,
        azureVerifiedAt: new Date().toISOString()
      });

      setStatus({ type: "success", message: `Conectado ao projeto "${data.projectName}" com sucesso.` });
      onSuccess?.();
    } catch (err) {
      setStatus({ type: "error", message: err.message || "Falha ao testar conexão." });
    } finally {
      setTesting(false);
    }
  }

  return (
    <form data-allow-submit="true" onSubmit={handleSubmit} className="d-flex flex-column gap-3">
      <div className="d-flex justify-content-end">
        <input ref={importRef} type="file" accept="application/json" hidden onChange={handleImportConfig} />
        <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => importRef.current?.click()}>
          <i className="bi bi-upload" /> Importar configuração
        </button>
      </div>
      <div>
        <label className="form-label small text-muted">URL da organização Azure DevOps</label>
        <input
          className="form-control"
          placeholder="https://dev.azure.com/sua-organizacao"
          value={orgUrl}
          onChange={(e) => setOrgUrl(e.target.value)}
          required
        />
      </div>
      <div>
        <label className="form-label small text-muted">Projeto</label>
        <input
          className="form-control"
          placeholder="Nome do projeto"
          value={project}
          onChange={(e) => setProject(e.target.value)}
          required
        />
      </div>
      <div>
        <label className="form-label small text-muted">Time (Team) do Azure DevOps</label>
        <input
          className="form-control"
          placeholder="ex: MB Labs"
          value={team}
          onChange={(e) => setTeam(e.target.value)}
          required
        />
        <div className="form-text">
          Essencial: as sprints e work items são buscados só dentro deste time. Sem isso, itens de outros times do mesmo projeto (ex.: outro cliente) apareceriam misturados.
        </div>
      </div>
      <div>
        <label className="form-label small text-muted">Personal Access Token (PAT)</label>
        <input
          type="password"
          className="form-control"
          placeholder={alreadyConnected ? "•••••••• (deixe em branco para manter o atual)" : "Cole seu PAT aqui"}
          value={pat}
          onChange={(e) => setPat(e.target.value)}
        />
        <div className="stark-onboarding-hint">
          <p className="mb-1">
            Ainda não tem um token? <a href={`${normalizeAzureOrgUrl(orgUrl) || DEFAULT_ORG_URL}/_usersSettings/tokens`} target="_blank" rel="noreferrer">Clique aqui para gerar no Azure DevOps</a>.
          </p>
          <ol className="mb-0 ps-3">
            <li>Clique em "+ New Token" e dê um nome (ex.: "Stark Hub").</li>
            <li>Em Scopes, marque <strong>Full access</strong> — ou, no modo custom, habilite ao menos: Work Items (Read &amp; Write), Code (Read), Project and Team (Read) e Identity (Read).</li>
            <li>Copie o token gerado (ele só aparece uma vez) e cole no campo acima.</li>
          </ol>
        </div>
      </div>
      {status && (
        <div className={`alert ${status.type === "error" ? "alert-danger" : "alert-success"} py-2 small mb-0`}>
          {status.message}
        </div>
      )}
      <button type="submit" className="btn btn-primary" disabled={testing}>
        {testing ? "Testando conexão..." : submitLabel}
      </button>
    </form>
  );
}
