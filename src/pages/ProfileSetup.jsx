import React, { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import ReactorLogo from "../components/layout/ReactorLogo.jsx";
import { useAuth } from "../contexts/AuthContext.jsx";

function AliasTagInput({ values = [], onChange }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");

  function commit() {
    const value = draft.trim();
    if (!value) return;
    if (!values.includes(value)) onChange([...values, value]);
    setDraft("");
  }

  function handleKeyDown(event) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit();
    }
  }

  return (
    <div className="stark-profile-setup-alias">
      {values.map((alias) => (
        <span key={alias} className="stark-profile-setup-alias-pill">
          {alias}
          <button type="button" onClick={() => onChange(values.filter((entry) => entry !== alias))} title={t("profileSetup.removeButton")}>×</button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={commit}
        placeholder={t("profileSetup.addAliasPlaceholder")}
      />
    </div>
  );
}

export default function ProfileSetup() {
  const { t } = useTranslation();
  const { profile, user, updateProfile, demoMode } = useAuth();
  const navigate = useNavigate();
  const [slackMemberId, setSlackMemberId] = useState(profile?.slackMemberId || "");
  const [aliasSlack, setAliasSlack] = useState(profile?.aliasSlack || "");
  const [aliasAzure, setAliasAzure] = useState(profile?.aliasAzure || profile?.displayName || profile?.fullName || "");
  const [aliasVariations, setAliasVariations] = useState(profile?.aliasVariations || []);
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatarUrl || "");
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);

  if (demoMode) return <Navigate to="/" replace />;
  if (!profile?.azureVerifiedAt) return <Navigate to="/azure-setup" replace />;

  const gmailAvatarUrl = user?.user_metadata?.avatar_url || profile?.avatarUrl || "";

  async function handleSubmit(event) {
    event.preventDefault();
    if (!slackMemberId.trim() || !aliasSlack.trim() || !aliasAzure.trim()) {
      setStatus({ type: "error", message: t("profileSetup.requiredFieldsError") });
      return;
    }
    setSaving(true);
    setStatus(null);
    // "profiles" e "collaborators" viraram uma unica linha (collaborators_profile)
    // — um update so ja grava tanto os campos de onboarding (aliasSlack/
    // aliasAzure/aliasVariations/avatarUrl) quanto os campos usados no resto
    // do app pras mencoes do Slack e assignee matching (slackName/azureName/
    // aliases/imageUrl). Nao ha mais uma segunda tabela pra sincronizar.
    const trimmedAvatarUrl = avatarUrl.trim() || null;
    const { error } = await updateProfile({
      slackMemberId: slackMemberId.trim(),
      aliasSlack: aliasSlack.trim(),
      aliasAzure: aliasAzure.trim(),
      aliasVariations,
      avatarUrl: trimmedAvatarUrl,
      slackName: aliasSlack.trim(),
      azureName: aliasAzure.trim(),
      aliases: aliasVariations,
      imageUrl: trimmedAvatarUrl
    });
    setSaving(false);
    if (error) {
      setStatus({ type: "error", message: t("profileSetup.saveErrorPrefix", { message: error.message }) });
      return;
    }
    navigate("/", { replace: true });
  }

  return (
    <div className="d-flex flex-column align-items-center justify-content-center min-vh-100 gap-3 text-center px-3 py-5">
      <ReactorLogo size={64} />
      <h2 className="fw-bold mb-0">{t("profileSetup.almostThere", { name: (profile?.displayName || profile?.fullName || "").split(" ")[0] || t("profileSetup.fallbackName") })}</h2>
      <p className="text-muted mb-2" style={{ maxWidth: 480 }}>
        {t("profileSetup.intro")}
      </p>
      <form data-allow-submit="true" onSubmit={handleSubmit} className="stark-card text-start d-flex flex-column gap-3" style={{ width: "100%", maxWidth: 460 }}>
        <div>
          <label className="form-label small text-muted">{t("profileSetup.slackMemberIdLabel")}</label>
          <input className="form-control" placeholder={t("profileSetup.slackMemberIdPlaceholder")} value={slackMemberId} onChange={(e) => setSlackMemberId(e.target.value)} required />
          <div className="stark-onboarding-hint">
            {t("profileSetup.slackMemberIdHintPrefix")} "{t("profileSetup.slackMemberIdHintQuote1")}" {t("profileSetup.slackMemberIdHintMenu")} "⋯ {t("profileSetup.slackMemberIdHintMore")}" &gt; <strong>{t("profileSetup.slackMemberIdHintCopy")}</strong>.
          </div>
        </div>
        <div>
          <label className="form-label small text-muted">{t("profileSetup.slackNameLabel")}</label>
          <input className="form-control" placeholder={t("profileSetup.slackNamePlaceholder")} value={aliasSlack} onChange={(e) => setAliasSlack(e.target.value)} required />
        </div>
        <div>
          <label className="form-label small text-muted">{t("profileSetup.azureNameLabel")}</label>
          <input className="form-control" placeholder={t("profileSetup.azureNamePlaceholder")} value={aliasAzure} onChange={(e) => setAliasAzure(e.target.value)} required />
        </div>
        <div>
          <label className="form-label small text-muted">{t("profileSetup.aliasLabel")}</label>
          <AliasTagInput values={aliasVariations} onChange={setAliasVariations} />
        </div>
        <div>
          <label className="form-label small text-muted">{t("profileSetup.photoLabel")}</label>
          <div className="stark-onboarding-avatar-row">
            {avatarUrl && <img src={avatarUrl} alt="" />}
            <input className="form-control" placeholder={t("profileSetup.photoPlaceholder")} value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} />
            {gmailAvatarUrl && (
              <button type="button" className="btn btn-outline-secondary btn-sm text-nowrap" onClick={() => setAvatarUrl(gmailAvatarUrl)}>
                {t("profileSetup.useGmailPhoto")}
              </button>
            )}
          </div>
        </div>
        {status && (
          <div className={`alert ${status.type === "error" ? "alert-danger" : "alert-success"} py-2 small mb-0`}>
            {status.message}
          </div>
        )}
        <div className="d-flex gap-2 justify-content-end">
          <button type="button" className="btn btn-link btn-sm text-muted" disabled={saving} onClick={handleSubmit}>
            {t("profileSetup.skipButton")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? t("profileSetup.savingButton") : t("profileSetup.saveButton")}
          </button>
        </div>
      </form>
    </div>
  );
}
