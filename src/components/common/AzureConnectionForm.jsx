import React, { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../../lib/supabaseClient.js";
import { useAuth } from "../../contexts/AuthContext.jsx";
import { normalizeAzureOrgUrl } from "../../utils/azure.js";
import { writePersonalSettings } from "../../utils/personalSettings.js";

const DEFAULT_ORG_URL = "https://dev.azure.com/cinemarkintl";

export default function AzureConnectionForm({ onSuccess, submitLabel }) {
  const { t } = useTranslation();
  const resolvedSubmitLabel = submitLabel ?? t("settings.testAndUpdate");
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
          setStatus({ type: "error", message: t("azureForm.invalidConfigFile") });
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
        setStatus({ type: "success", message: t("azureForm.configImported") });
      } catch {
        setStatus({ type: "error", message: t("azureForm.unreadableConfigFile") });
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const effectivePat = pat || profile?.azurePat;
    if (!effectivePat) {
      setStatus({ type: "error", message: t("azureForm.missingPat") });
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

      setStatus({ type: "success", message: t("azureForm.connectedSuccess", { project: data.projectName }) });
      onSuccess?.();
    } catch (err) {
      setStatus({ type: "error", message: err.message || t("azureForm.connectionFailed") });
    } finally {
      setTesting(false);
    }
  }

  return (
    <form data-allow-submit="true" onSubmit={handleSubmit} className="d-flex flex-column gap-3">
      <div className="d-flex justify-content-end">
        <input ref={importRef} type="file" accept="application/json" hidden onChange={handleImportConfig} />
        <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => importRef.current?.click()}>
          <i className="bi bi-upload" /> {t("azureForm.importConfig")}
        </button>
      </div>
      <div>
        <label className="form-label small text-muted">{t("azureForm.orgUrlLabel")}</label>
        <input
          className="form-control"
          placeholder={t("azureForm.orgUrlPlaceholder")}
          value={orgUrl}
          onChange={(e) => setOrgUrl(e.target.value)}
          required
        />
      </div>
      <div>
        <label className="form-label small text-muted">{t("azureForm.projectLabel")}</label>
        <input
          className="form-control"
          placeholder={t("azureForm.projectPlaceholder")}
          value={project}
          onChange={(e) => setProject(e.target.value)}
          required
        />
      </div>
      <div>
        <label className="form-label small text-muted">{t("azureForm.teamLabel")}</label>
        <input
          className="form-control"
          placeholder={t("azureForm.teamPlaceholder")}
          value={team}
          onChange={(e) => setTeam(e.target.value)}
          required
        />
        <div className="form-text">
          {t("azureForm.teamNote")}
        </div>
      </div>
      <div>
        <label className="form-label small text-muted">{t("azureForm.patLabel")}</label>
        <input
          type="password"
          className="form-control"
          placeholder={alreadyConnected ? t("azureForm.patPlaceholderKeep") : t("azureForm.patPlaceholder")}
          value={pat}
          onChange={(e) => setPat(e.target.value)}
        />
        <div className="stark-onboarding-hint">
          <p className="mb-1">
            {t("azureForm.patHintPrefix")} <a href={`${normalizeAzureOrgUrl(orgUrl) || DEFAULT_ORG_URL}/_usersSettings/tokens`} target="_blank" rel="noreferrer">{t("azureForm.patHintLink")}</a>.
          </p>
          <ol className="mb-0 ps-3">
            <li>{t("azureForm.patStep1")}</li>
            <li>{t("azureForm.patStep2Prefix")} <strong>{t("azureForm.patStep2Bold")}</strong> {t("azureForm.patStep2Suffix")}</li>
            <li>{t("azureForm.patStep3")}</li>
          </ol>
        </div>
      </div>
      {status && (
        <div className={`alert ${status.type === "error" ? "alert-danger" : "alert-success"} py-2 small mb-0`}>
          {status.message}
        </div>
      )}
      <button type="submit" className="btn btn-primary" disabled={testing}>
        {testing ? t("azureForm.testing") : resolvedSubmitLabel}
      </button>
    </form>
  );
}
