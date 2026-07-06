import React, { useState } from "react";
import { useAuth } from "../../contexts/AuthContext.jsx";
import { useCollaborators } from "../../hooks/useCollaborators.js";
import { useProfiles } from "../../hooks/useProfiles.js";
import { accessLevelLabels, accessLevels } from "../../utils/constants.js";
import CollaboratorEditor from "../../components/common/CollaboratorEditor.jsx";

function PendingProfileRow({ profile, onLink }) {
  const [level, setLevel] = useState(accessLevels.dev);
  const [linking, setLinking] = useState(false);

  async function handleLink() {
    setLinking(true);
    await onLink(profile, level);
    setLinking(false);
  }

  return (
    <div className="stark-card d-flex flex-wrap align-items-center gap-2 justify-content-between">
      <div>
        <strong>{profile.fullName || profile.displayName || profile.email}</strong>
        <div className="text-muted small">{profile.email}</div>
      </div>
      <div className="d-flex align-items-center gap-2">
        <select className="form-select form-select-sm" style={{ width: 160 }} value={level} onChange={(e) => setLevel(e.target.value)}>
          {Object.entries(accessLevelLabels).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <button type="button" className="btn btn-sm btn-primary" onClick={handleLink} disabled={linking}>
          {linking ? "Liberando..." : "Cadastrar e liberar"}
        </button>
      </div>
    </div>
  );
}

export default function Collaborators() {
  const { profile, demoMode } = useAuth();
  const { collaborators, updateCollaborator, addCollaborator, deleteCollaborator } = useCollaborators();
  const { profiles, setAccessLevel } = useProfiles();
  const canEdit = profile?.accessLevel === "gestao";

  // Todo mundo que já logou (profiles), mas ainda não tem um colaborador
  // vinculado, fica invisível pra sempre sem esta lista — handle_new_user só
  // cria o profile com accessLevel "pending"; nunca cria um collaborator.
  const linkedProfileIds = new Set(collaborators.map((c) => c.profileId).filter(Boolean));
  const pendingProfiles = profiles.filter((p) => !linkedProfileIds.has(p.id));

  async function handleAdd() {
    await addCollaborator({ azureName: "Novo colaborador", isDev: true });
  }

  async function handleLinkPending(pendingProfile, level) {
    const { error } = await addCollaborator({
      profileId: pendingProfile.id,
      azureName: pendingProfile.fullName || pendingProfile.displayName || pendingProfile.email || "",
      isDev: level === accessLevels.dev,
      isQa: level === accessLevels.qa,
      isManagement: level === accessLevels.gestao
    });
    if (!error) await setAccessLevel(pendingProfile.id, level);
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
        <p className="text-muted small">Somente Gestão pode editar dados de colaboradores.</p>
      )}

      {canEdit && !demoMode && pendingProfiles.length > 0 && (
        <div className="mb-4">
          <h6 className="text-muted text-uppercase small mb-2">Pendentes de liberação</h6>
          <p className="text-muted small">
            Já logaram com Google mas ainda não têm cadastro de colaborador nem nível de acesso liberado.
          </p>
          <div className="d-flex flex-column gap-2">
            {pendingProfiles.map((pendingProfile) => (
              <PendingProfileRow key={pendingProfile.id} profile={pendingProfile} onLink={handleLinkPending} />
            ))}
          </div>
        </div>
      )}

      <div className="d-flex flex-column gap-2">
        {collaborators.map((person) => (
          <CollaboratorEditor
            key={person.id}
            person={person}
            canEdit={canEdit}
            onUpdate={(patch) => updateCollaborator(person.id, patch)}
            onDelete={() => deleteCollaborator(person.id)}
          />
        ))}
        {!collaborators.length && <div className="text-muted">Nenhum colaborador cadastrado.</div>}
      </div>
    </div>
  );
}
