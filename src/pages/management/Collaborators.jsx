import React, { useState } from "react";
import Avatar from "../../components/common/Avatar.jsx";
import AvatarUploader from "../../components/common/AvatarUploader.jsx";
import { useAuth } from "../../contexts/AuthContext.jsx";
import { useCollaborators } from "../../hooks/useCollaborators.js";
import { accessLevelLabels, accessLevels } from "../../utils/constants.js";

function CollaboratorCard({ person, canEdit, canEditPhoto, onUpdate }) {
  const [aliasInput, setAliasInput] = useState("");
  const aliases = person.aliases || [];

  function addAlias() {
    const value = aliasInput.trim();
    if (!value || aliases.some((a) => a.toLowerCase() === value.toLowerCase())) return;
    onUpdate({ aliases: [...aliases, value] });
    setAliasInput("");
  }

  function removeAlias(value) {
    onUpdate({ aliases: aliases.filter((a) => a !== value) });
  }

  const roleSummary = [person.isQa && "QA", person.isDev && "DEV", person.isManagement && "Gestão"].filter(Boolean).join(" · ") || "Sem função";

  return (
    <details className="stark-card" data-collaborator-id={person.id}>
      <summary className="d-flex align-items-center gap-3" style={{ cursor: "pointer", listStyle: "none" }}>
        {canEditPhoto ? (
          <span onClick={(e) => e.preventDefault()}>
            <AvatarUploader
              ownerId={person.profileId || person.id}
              name={person.azureName}
              imageUrl={person.imageUrl}
              color={person.color}
              size={44}
              onUploaded={(url) => onUpdate({ imageUrl: url })}
            />
          </span>
        ) : (
          <Avatar name={person.azureName} imageUrl={person.imageUrl} color={person.color} />
        )}
        <div className="flex-grow-1">
          <strong>{person.azureName}</strong>
          <div className="text-muted small">{roleSummary}</div>
        </div>
        {person.accessLevel && (
          <span className={`badge text-bg-${person.accessLevel === "pending" ? "warning" : "info"}`}>
            {accessLevelLabels[person.accessLevel]}
          </span>
        )}
      </summary>

      <div className="pt-3 border-top mt-3 d-flex flex-column gap-3">
        <div className="row g-2">
          <div className="col-md-4">
            <label className="form-label small text-muted">Nome no Azure</label>
            <input className="form-control form-control-sm" value={person.azureName} disabled={!canEdit}
              onChange={(e) => onUpdate({ azureName: e.target.value })} />
          </div>
          <div className="col-md-4">
            <label className="form-label small text-muted">Nome no Slack</label>
            <input className="form-control form-control-sm" value={person.slackName} disabled={!canEdit}
              onChange={(e) => onUpdate({ slackName: e.target.value })} />
          </div>
          <div className="col-md-4">
            <label className="form-label small text-muted">Member ID do Slack</label>
            <input className="form-control form-control-sm" value={person.slackMemberId} disabled={!canEdit}
              onChange={(e) => onUpdate({ slackMemberId: e.target.value })} />
          </div>
        </div>

        <div className="d-flex align-items-center gap-2">
          <label className="form-label small text-muted mb-0">Cor</label>
          <input type="color" value={person.color} disabled={!canEdit} style={{ width: 34, height: 34, padding: 2 }}
            onChange={(e) => onUpdate({ color: e.target.value })} />
          <input className="form-control form-control-sm" style={{ width: 100 }} value={person.color.toUpperCase()} disabled={!canEdit}
            onChange={(e) => onUpdate({ color: e.target.value })} />
        </div>

        <div>
          <label className="form-label small text-muted d-block">Aliases</label>
          <div className="d-flex flex-wrap gap-2 mb-2">
            {aliases.map((alias) => (
              <span key={alias} className="stark-alias-pill">
                {alias}
                {canEdit && <button type="button" onClick={() => removeAlias(alias)}>&times;</button>}
              </span>
            ))}
            {!aliases.length && <span className="text-muted small">Nenhum alias.</span>}
          </div>
          {canEdit && (
            <div className="d-flex gap-2" style={{ maxWidth: 320 }}>
              <input
                className="form-control form-control-sm" placeholder="Adicionar alias"
                value={aliasInput} onChange={(e) => setAliasInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addAlias(); } }}
              />
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={addAlias}>+</button>
            </div>
          )}
        </div>

        <div>
          <label className="form-label small text-muted d-block">Papéis</label>
          <div className="d-flex flex-wrap gap-3">
            {[["isDev", "Dev"], ["isQa", "QA"], ["isManagement", "Gestão"]].map(([key, label]) => (
              <label key={key} className="stark-switch">
                <input type="checkbox" checked={person[key]} disabled={!canEdit} onChange={(e) => onUpdate({ [key]: e.target.checked })} />
                <span className="stark-switch-track" />
                <span className="small">{label}</span>
              </label>
            ))}
          </div>
        </div>

        {person.profileId && (
          <div>
            <label className="form-label small text-muted d-block">Nível de acesso ao Stark Hub</label>
            <select
              className="form-select form-select-sm" style={{ maxWidth: 220 }}
              value={person.accessLevel || accessLevels.pending} disabled={!canEdit}
              onChange={(e) => onUpdate({ accessLevel: e.target.value })}
            >
              {Object.entries(accessLevelLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        )}
      </div>
    </details>
  );
}

export default function Collaborators() {
  const { profile, demoMode } = useAuth();
  const { collaborators, updateCollaborator, addCollaborator } = useCollaborators();
  const canEdit = profile?.accessLevel === "gestao";

  async function handleAdd() {
    const { data } = await addCollaborator({ azureName: "Novo colaborador", isDev: true });
    // Abre o card recém-criado direto na edição — mesmo espírito do "Adicionar
    // QA"/"Adicionar dev" do userscript legado (que já criava a linha em modo edição).
    requestAnimationFrame(() => {
      document.querySelector(`[data-collaborator-id="${data?.id}"]`)?.setAttribute("open", "true");
    });
  }

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h3 className="mb-0">Colaboradores {demoMode && <span className="stark-badge-demo ms-2">demo</span>}</h3>
        {canEdit && (
          <button type="button" className="btn btn-sm btn-primary" onClick={handleAdd}>+ Adicionar colaborador</button>
        )}
      </div>
      {!canEdit && (
        <p className="text-muted small">
          Somente Gestão pode editar dados de colaboradores. Você pode atualizar sua própria foto de perfil clicando nela.
        </p>
      )}

      <div className="d-flex flex-column gap-2">
        {collaborators.map((person) => (
          <CollaboratorCard
            key={person.id}
            person={person}
            canEdit={canEdit}
            canEditPhoto={canEdit || person.profileId === profile?.id}
            onUpdate={(patch) => updateCollaborator(person.id, patch)}
          />
        ))}
        {!collaborators.length && <div className="text-muted">Nenhum colaborador cadastrado.</div>}
      </div>
    </div>
  );
}
