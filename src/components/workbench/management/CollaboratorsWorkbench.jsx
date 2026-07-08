import { useMemo, useState } from "react";
import { useAuth } from "../../../contexts/AuthContext.jsx";
import { useCollaborators } from "../../../hooks/useCollaborators.js";
import { accessLevels, defaultGoalHours } from "../../../utils/constants.js";
import { normalize } from "../../../utils/workbench/formatters.js";
import { AvatarDot, Button, EmptyState, FilterCombobox, RoleBadgeIcon, TextField, WorkbenchCardSkeleton, WorkbenchHeader } from "../ui/WorkbenchPrimitives.jsx";

const roleDefs = [
  { key: "isDev", level: "dev", label: "Dev" },
  { key: "isQa", level: "qa", label: "QA" },
  { key: "isManagement", level: "gestao", label: "Gestao" }
];

function RolePill({ level, label, active, onToggle, disabled }) {
  return (
    <button type="button" className={`mb-profile-role-pill ${level} ${active ? "active" : ""}`} disabled={disabled} onClick={onToggle}>
      <RoleBadgeIcon level={level} /> <span>{label}</span>
    </button>
  );
}

function AliasTagInput({ values = [], onChange, readOnly }) {
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

  function removeAlias(alias) {
    onChange(values.filter((entry) => entry !== alias));
  }

  return (
    <div className="mb-profile-alias-field">
      {values.map((alias) => (
        <span key={alias} className="mb-profile-alias-pill">
          {alias}
          {!readOnly && <button type="button" onClick={() => removeAlias(alias)} title="Remover"><i className="bi bi-x" /></button>}
        </span>
      ))}
      {!readOnly && (
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={commit}
          placeholder="Adicionar alias e Enter"
        />
      )}
      {readOnly && !values.length && <span className="mb-profile-alias-empty">Nenhum alias</span>}
    </div>
  );
}

function ProfileCard({ person, isGestao, isOwn, isEditing, onEdit, onDone, onUpdate, onDelete }) {
  const canEdit = isGestao || isOwn;
  const editable = isEditing && canEdit;

  return (
    <div className="mb-profile-card">
      <div className="mb-profile-card-head">
        <AvatarDot person={person} />
        <div className="mb-profile-card-heading">
          <strong>{person.azureName || "Sem nome"}</strong>
          <div className="mb-profile-role-row">
            {roleDefs.map((role) => <RolePill key={role.key} level={role.level} label={role.label} active={Boolean(person[role.key])} disabled />)}
          </div>
        </div>
        {canEdit && (
          <div className="mb-profile-card-actions">
            {editable
              ? <Button tone="primary" onClick={onDone}><i className="bi bi-check-lg" /> Concluir</Button>
              : <Button onClick={onEdit}><i className="bi bi-pencil" /> Editar</Button>}
            {isGestao && <Button tone="danger" onClick={() => onDelete(person.id)}><i className="bi bi-trash" /> Excluir</Button>}
          </div>
        )}
      </div>
      <div className="mbw-form-grid">
        <TextField label="Nome Azure" value={person.azureName || ""} onChange={(value) => onUpdate({ azureName: value })} readOnly={!editable} />
        <TextField label="Email" value={person.linkedProfile?.email || person.email || ""} onChange={(value) => onUpdate({ email: value })} readOnly={!editable || Boolean(person.linkedProfile?.email)} />
        <TextField label="Nome no Slack" value={person.slackName || ""} onChange={(value) => onUpdate({ slackName: value })} readOnly={!editable} />
        <TextField label="Slack Member ID" value={person.slackMemberId || ""} onChange={(value) => onUpdate({ slackMemberId: value })} readOnly={!editable} />
        <TextField label="Avatar URL" value={person.imageUrl || person.avatarUrl || ""} onChange={(value) => onUpdate({ imageUrl: value })} readOnly={!editable} />
        <label className="mbw-field">
          <span>Cor</span>
          <div className="mb-profile-color-field">
            <input type="color" value={person.color || "#0b74de"} onChange={(event) => onUpdate({ color: event.target.value })} disabled={!editable} />
            <input type="text" value={person.color || ""} onChange={(event) => onUpdate({ color: event.target.value })} readOnly={!editable} placeholder="#0b74de" />
          </div>
        </label>
        <label className="mbw-field mb-span-2">
          <span>Aliases</span>
          <AliasTagInput values={person.aliases || []} onChange={(next) => onUpdate({ aliases: next })} readOnly={!editable} />
        </label>
        <TextField label="Profile ID" value={person.profileId || ""} onChange={(value) => onUpdate({ profileId: value })} readOnly={!isGestao || !editable} />
        <label className="mbw-field mb-span-2">
          <span>Papeis</span>
          <div className="mb-profile-role-row">
            {roleDefs.map((role) => (
              <RolePill
                key={role.key}
                level={role.level}
                label={role.label}
                active={Boolean(person[role.key])}
                disabled={!isGestao || !editable}
                onToggle={() => onUpdate({ [role.key]: !person[role.key] })}
              />
            ))}
          </div>
        </label>
        <label className="mb-profile-check">
          <input type="checkbox" checked={Boolean(person.fixedMention)} disabled={!isGestao || !editable} onChange={(event) => onUpdate({ fixedMention: event.target.checked })} />
          <span>FYI fixo no Slack</span>
        </label>
      </div>
    </div>
  );
}

export function CollaboratorsWorkbench() {
  const { profile, demoMode } = useAuth();
  const { collaborators, loading, updateCollaborator, addCollaborator, deleteCollaborator } = useCollaborators();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [editingId, setEditingId] = useState(null);
  const isGestao = profile?.accessLevel === accessLevels.gestao;
  const ownCollaborator = collaborators.find((person) => person.profileId === profile?.id)
    || collaborators.find((person) => String(person.azureName || "").toLowerCase() === String(profile?.displayName || profile?.fullName || "").toLowerCase());
  const baseCollaborators = isGestao ? collaborators : ownCollaborator ? [ownCollaborator] : [];
  const visibleCollaborators = baseCollaborators.filter((person) => {
    if (roleFilter === "dev" && !person.isDev) return false;
    if (roleFilter === "qa" && !person.isQa) return false;
    if (roleFilter === "gestao" && !person.isManagement) return false;
    if (search && !normalize(`${person.azureName || ""} ${person.email || ""} ${person.slackId || ""} ${person.slackName || ""} ${(person.aliases || []).join(" ")}`).includes(normalize(search))) return false;
    return true;
  });
  const metrics = useMemo(() => ({
    total: baseCollaborators.length,
    dev: baseCollaborators.filter((person) => person.isDev).length,
    qa: baseCollaborators.filter((person) => person.isQa).length,
    gestao: baseCollaborators.filter((person) => person.isManagement).length,
    linked: baseCollaborators.filter((person) => person.profileId).length
  }), [baseCollaborators]);

  async function addPerson() {
    const { data } = await addCollaborator({ azureName: "Novo colaborador", isDev: true, goalHours: defaultGoalHours });
    if (data?.id) setEditingId(data.id);
  }

  async function removePerson(id) {
    if (editingId === id) setEditingId(null);
    await deleteCollaborator(id);
  }

  return (
    <section className="mbw-page mb-settings-page">
      <WorkbenchHeader
        kicker="Perfil"
        title="Perfil"
        subtitle={isGestao ? "Cadastro unico de identidade, aliases, permissoes, Slack, avatar e cor de todo o time." : "Suas informacoes de identidade, Slack, avatar e cor."}
        demoMode={demoMode}
        actions={isGestao && <Button onClick={addPerson}>+ Adicionar</Button>}
      />
      <div className="mb-collaborators-list-react">
        {isGestao && (
          <section className="mb-collaborators-toolbar">
            <div className="mb-collaborators-metrics">
              <span><small>Total</small><b>{metrics.total}</b></span>
              <span><small>Dev</small><b>{metrics.dev}</b></span>
              <span><small>QA</small><b>{metrics.qa}</b></span>
              <span><small>Gestao</small><b>{metrics.gestao}</b></span>
              <span><small>Vinculados</small><b>{metrics.linked}</b></span>
            </div>
            <div className="mb-collaborators-filters">
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome, email, Slack ou alias" />
              <FilterCombobox label="Papel" options={[{ value: "dev", label: "Dev" }, { value: "qa", label: "QA" }, { value: "gestao", label: "Gestao" }]} values={roleFilter === "all" ? [] : [roleFilter]} multiple={false} onChange={(value) => setRoleFilter(value || "all")} />
            </div>
          </section>
        )}
        {loading && <WorkbenchCardSkeleton rows={3} mode="list" />}
        {!isGestao && visibleCollaborators.map((person) => (
          <ProfileCard
            key={person.id}
            person={person}
            isGestao={isGestao}
            isOwn
            isEditing={editingId === person.id}
            onEdit={() => setEditingId(person.id)}
            onDone={() => setEditingId(null)}
            onUpdate={(patch) => updateCollaborator(person.id, patch)}
            onDelete={removePerson}
          />
        ))}
        {isGestao && visibleCollaborators.map((person) => (
          <details key={person.id} className="mb-collaborator-card-react" open={editingId === person.id}>
            <summary>
              <AvatarDot person={person} />
              <div className="mb-profile-role-row">
                {roleDefs.filter((role) => person[role.key]).map((role) => <RolePill key={role.key} level={role.level} label={role.label} active disabled />)}
              </div>
            </summary>
            <ProfileCard
              person={person}
              isGestao={isGestao}
              isOwn={person.id === ownCollaborator?.id}
              isEditing={editingId === person.id}
              onEdit={() => setEditingId(person.id)}
              onDone={() => setEditingId(null)}
              onUpdate={(patch) => updateCollaborator(person.id, patch)}
              onDelete={removePerson}
            />
          </details>
        ))}
        {!visibleCollaborators.length && <EmptyState title={isGestao ? "Nenhum colaborador cadastrado" : "Sua conta ainda nao foi vinculada a um colaborador"} />}
      </div>
    </section>
  );
}
