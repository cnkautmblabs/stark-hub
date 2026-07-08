import React, { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import ReactorLogo from "../components/layout/ReactorLogo.jsx";
import { useAuth } from "../contexts/AuthContext.jsx";
import { useCollaborators } from "../hooks/useCollaborators.js";

function AliasTagInput({ values = [], onChange }) {
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
          <button type="button" onClick={() => onChange(values.filter((entry) => entry !== alias))} title="Remover">×</button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={commit}
        placeholder="Adicionar alias e Enter"
      />
    </div>
  );
}

export default function ProfileSetup() {
  const { profile, user, updateProfile, demoMode } = useAuth();
  const { collaborators, addCollaborator, updateCollaborator } = useCollaborators();
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
      setStatus({ type: "error", message: "Member ID do Slack, nome no Slack e nome no Azure são obrigatórios." });
      return;
    }
    setSaving(true);
    setStatus(null);
    const { error } = await updateProfile({
      slackMemberId: slackMemberId.trim(),
      aliasSlack: aliasSlack.trim(),
      aliasAzure: aliasAzure.trim(),
      aliasVariations,
      avatarUrl: avatarUrl.trim() || null
    });
    if (error) {
      setSaving(false);
      setStatus({ type: "error", message: `Erro ao salvar: ${error.message}` });
      return;
    }
    // O diretorio de identidade usado em todo o app (menções no Slack, QA
    // responsavel, Assigned To) e a tabela collaborators, nao profiles — sem
    // sincronizar aqui, o slackMemberId preenchido acima nunca chegava onde
    // as mensagens de Slack realmente sao montadas.
    const own = collaborators.find((person) => person.profileId === profile?.id);
    const collaboratorPatch = {
      slackMemberId: slackMemberId.trim(),
      slackName: aliasSlack.trim(),
      azureName: aliasAzure.trim(),
      aliases: aliasVariations,
      imageUrl: avatarUrl.trim() || undefined
    };
    if (own) {
      await updateCollaborator(own.id, collaboratorPatch);
    } else {
      await addCollaborator({ profileId: profile.id, email: profile.email, ...collaboratorPatch });
    }
    setSaving(false);
    navigate("/", { replace: true });
  }

  return (
    <div className="d-flex flex-column align-items-center justify-content-center min-vh-100 gap-3 text-center px-3 py-5">
      <ReactorLogo size={64} />
      <h2 className="fw-bold mb-0">Quase lá, {(profile?.displayName || profile?.fullName || "").split(" ")[0] || "colaborador(a)"}!</h2>
      <p className="text-muted mb-2" style={{ maxWidth: 480 }}>
        Complete seu perfil para aparecer corretamente nos relatórios, menções do Slack e no diretório de colaboradores.
      </p>
      <form onSubmit={handleSubmit} className="stark-card text-start d-flex flex-column gap-3" style={{ width: "100%", maxWidth: 460 }}>
        <div>
          <label className="form-label small text-muted">Member ID do Slack *</label>
          <input className="form-control" placeholder="Ex.: U012ABC3DE" value={slackMemberId} onChange={(e) => setSlackMemberId(e.target.value)} required />
          <div className="stark-onboarding-hint">
            No Slack, clique na sua foto de perfil no canto superior &gt; "Ver perfil" &gt; menu "⋯ Mais" &gt; <strong>Copiar member ID</strong>.
          </div>
        </div>
        <div>
          <label className="form-label small text-muted">Nome no Slack *</label>
          <input className="form-control" placeholder="Como seu nome aparece no Slack" value={aliasSlack} onChange={(e) => setAliasSlack(e.target.value)} required />
        </div>
        <div>
          <label className="form-label small text-muted">Nome no Azure DevOps *</label>
          <input className="form-control" placeholder="Como seu nome aparece no Azure DevOps" value={aliasAzure} onChange={(e) => setAliasAzure(e.target.value)} required />
        </div>
        <div>
          <label className="form-label small text-muted">Alias (opcional)</label>
          <AliasTagInput values={aliasVariations} onChange={setAliasVariations} />
        </div>
        <div>
          <label className="form-label small text-muted">Foto de perfil (opcional)</label>
          <div className="stark-onboarding-avatar-row">
            {avatarUrl && <img src={avatarUrl} alt="" />}
            <input className="form-control" placeholder="URL da imagem" value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} />
            {gmailAvatarUrl && (
              <button type="button" className="btn btn-outline-secondary btn-sm text-nowrap" onClick={() => setAvatarUrl(gmailAvatarUrl)}>
                Usar do Gmail
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
            Pular por agora
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Salvando..." : "Salvar e continuar"}
          </button>
        </div>
      </form>
    </div>
  );
}
