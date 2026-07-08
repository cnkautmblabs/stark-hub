import { useMemo, useState } from "react";
import { useAuth } from "../../../contexts/AuthContext.jsx";
import { useCollaborators } from "../../../hooks/useCollaborators.js";
import { useProfiles } from "../../../hooks/useProfiles.js";
import { accessLevelLabels, accessLevels, defaultGoalHours, hasManagementAccess } from "../../../utils/constants.js";
import { normalize } from "../../../utils/workbench/formatters.js";
import { AvatarDot, Button, EmptyState, FilterCombobox, RoleBadgeIcon, TextField, WorkbenchCardSkeleton, WorkbenchHeader } from "../ui/WorkbenchPrimitives.jsx";

const roleDefs = [
  { key: "isDev", level: "dev", label: "Dev" },
  { key: "isQa", level: "qa", label: "QA" },
  { key: "isManagement", level: "gestao", label: "Gestao" }
];

const accessLevelOptions = [accessLevels.dev, accessLevels.qa, accessLevels.gestao, accessLevels.gerente];

// Perfil (onboarding) e Colaboradores nunca ficaram 100% sincronizados
// (gravacoes historicas podem ter falhado antes das correcoes de RLS) —
// pra exibicao, cai no valor gravado em `profiles` quando o campo em
// `collaborators` estiver vazio, em vez de mostrar tudo em branco.
function withProfileFallback(person) {
  const linked = person?.linkedProfile;
  const azureName = person?.azureName || linked?.aliasAzure || linked?.displayName || linked?.fullName || "";
  const slackName = person?.slackName || linked?.aliasSlack || "";
  const slackMemberId = person?.slackMemberId || linked?.slackMemberId || "";
  const imageUrl = person?.imageUrl || person?.avatarUrl || linked?.avatarUrl || "";
  const aliases = Array.from(new Set([...(person?.aliases || []), ...(linked?.aliasVariations || [])]));
  return { ...person, azureName, slackName, slackMemberId, imageUrl, aliases };
}

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
  const currentAccessLevel = person.accessLevel || person.linkedProfile?.accessLevel || "";
  const effectivePerson = withProfileFallback(person);
  const { azureName: effectiveAzureName, slackName: effectiveSlackName, slackMemberId: effectiveSlackMemberId, imageUrl: effectiveImageUrl, aliases: effectiveAliases } = effectivePerson;

  return (
    <div className="mb-profile-card">
      <div className="mb-profile-card-head">
        <AvatarDot person={effectivePerson} />
        <div className="mb-profile-card-heading">
          <strong>{effectiveAzureName || "Sem nome"}</strong>
          <div className="mb-profile-role-row">
            {currentAccessLevel && <RolePill level={currentAccessLevel} label={accessLevelLabels[currentAccessLevel] || currentAccessLevel} active disabled />}
            {roleDefs.filter((role) => person[role.key]).map((role) => <RolePill key={role.key} level={role.level} label={role.label} active disabled />)}
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
        <TextField label="Nome Azure" value={effectiveAzureName} onChange={(value) => onUpdate({ azureName: value })} readOnly={!editable} />
        <TextField label="Email" value={person.linkedProfile?.email || person.email || ""} onChange={(value) => onUpdate({ email: value })} readOnly={!editable || Boolean(person.linkedProfile?.email)} />
        <TextField label="Nome no Slack" value={effectiveSlackName} onChange={(value) => onUpdate({ slackName: value })} readOnly={!editable} />
        <TextField label="Slack Member ID" value={effectiveSlackMemberId} onChange={(value) => onUpdate({ slackMemberId: value })} readOnly={!editable} />
        <TextField label="Avatar URL" value={effectiveImageUrl} onChange={(value) => onUpdate({ imageUrl: value })} readOnly={!editable} />
        <label className="mbw-field">
          <span>Cor</span>
          <div className="mb-profile-color-field">
            <input type="color" value={person.color || "#0b74de"} onChange={(event) => onUpdate({ color: event.target.value })} disabled={!editable} />
            <input type="text" value={person.color || ""} onChange={(event) => onUpdate({ color: event.target.value })} readOnly={!editable} placeholder="#0b74de" />
          </div>
        </label>
        <label className="mbw-field mb-span-2">
          <span>Aliases</span>
          <AliasTagInput values={effectiveAliases} onChange={(next) => onUpdate({ aliases: next })} readOnly={!editable} />
        </label>
        {person.profileId && (
          <label className="mbw-field">
            <span>Nivel de acesso</span>
            <select value={currentAccessLevel} disabled={!isGestao || !editable} onChange={(event) => onUpdate({ accessLevel: event.target.value })}>
              {accessLevelOptions.map((level) => <option key={level} value={level}>{accessLevelLabels[level]}</option>)}
            </select>
          </label>
        )}
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

function PendingApprovalRow({ profile, onApprove }) {
  const [level, setLevel] = useState(accessLevels.dev);
  const [approving, setApproving] = useState(false);

  async function handleApprove() {
    setApproving(true);
    await onApprove(profile, level);
    setApproving(false);
  }

  return (
    <div className="mb-profile-pending-row">
      <AvatarDot person={{ azureName: profile.displayName || profile.fullName }} />
      <div className="mb-profile-pending-copy">
        <strong>{profile.displayName || profile.fullName}</strong>
        <small>{profile.email}</small>
      </div>
      <select value={level} onChange={(event) => setLevel(event.target.value)} disabled={approving}>
        {accessLevelOptions.map((value) => <option key={value} value={value}>{accessLevelLabels[value]}</option>)}
      </select>
      <Button tone="primary" onClick={handleApprove} disabled={approving}>
        {approving ? "Aprovando..." : "Aprovar"}
      </Button>
    </div>
  );
}

export function CollaboratorsWorkbench() {
  const { profile, demoMode } = useAuth();
  const { collaborators, loading, updateCollaborator, addCollaborator, deleteCollaborator } = useCollaborators();
  const { profiles, loading: profilesLoading } = useProfiles();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [editingId, setEditingId] = useState(null);
  const isGestao = hasManagementAccess(profile?.accessLevel);
  const ownCollaborator = collaborators.find((person) => person.profileId === profile?.id)
    || collaborators.find((person) => String(person.azureName || "").toLowerCase() === String(profile?.displayName || profile?.fullName || "").toLowerCase());
  const baseCollaborators = isGestao ? collaborators : ownCollaborator ? [ownCollaborator] : [];
  const visibleCollaborators = baseCollaborators.filter((person) => {
    if (roleFilter === "dev" && !person.isDev) return false;
    if (roleFilter === "qa" && !person.isQa) return false;
    if (roleFilter === "gestao" && !person.isManagement) return false;
    if (roleFilter === "gerente" && (person.accessLevel || person.linkedProfile?.accessLevel) !== "gerente") return false;
    if (search && !normalize(`${person.azureName || ""} ${person.email || ""} ${person.slackId || ""} ${person.slackName || ""} ${(person.aliases || []).join(" ")}`).includes(normalize(search))) return false;
    return true;
  });
  // Qualquer conta que ja logou (profiles) mas ainda nao tem um registro em
  // collaborators fica invisivel pra sempre sem isto — inclui tanto quem
  // ainda esta "pending" quanto quem ja foi liberado por fora desta tela
  // (ex.: direto no Supabase) mas nunca ganhou um card de identidade.
  const pendingProfiles = isGestao
    ? profiles.filter((person) => !collaborators.some((collaborator) => collaborator.profileId === person.id))
    : [];
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

  async function approveProfile(pendingProfile, level) {
    await addCollaborator({
      profileId: pendingProfile.id,
      azureName: pendingProfile.displayName || pendingProfile.fullName,
      email: pendingProfile.email,
      isDev: level === accessLevels.dev,
      isQa: level === accessLevels.qa,
      isManagement: level === accessLevels.gestao || level === accessLevels.gerente,
      goalHours: defaultGoalHours,
      accessLevel: level
    });
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
        {isGestao && (profilesLoading ? <WorkbenchCardSkeleton rows={1} mode="list" /> : pendingProfiles.length > 0 && (
          <section className="mb-profile-pending-section">
            <header><strong>Pendentes de aprovacao</strong><small>{pendingProfiles.length} conta(s) logada(s) sem nivel de acesso ou identidade vinculada.</small></header>
            {pendingProfiles.map((pendingProfile) => (
              <PendingApprovalRow key={pendingProfile.id} profile={pendingProfile} onApprove={approveProfile} />
            ))}
          </section>
        ))}
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
              <FilterCombobox label="Papel" options={[{ value: "dev", label: "Dev" }, { value: "qa", label: "QA" }, { value: "gestao", label: "Gestao" }, { value: "gerente", label: "Gerente" }]} values={roleFilter === "all" ? [] : [roleFilter]} multiple={false} onChange={(value) => setRoleFilter(value || "all")} />
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
              <AvatarDot person={withProfileFallback(person)} />
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
        {!visibleCollaborators.length && !pendingProfiles.length && <EmptyState title={isGestao ? "Nenhum colaborador cadastrado" : "Sua conta ainda nao foi vinculada a um colaborador"} />}
      </div>
    </section>
  );
}
