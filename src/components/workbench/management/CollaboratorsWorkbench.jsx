import { useMemo, useState } from "react";
import { useAuth } from "../../../contexts/AuthContext.jsx";
import { useCollaborators } from "../../../hooks/useCollaborators.js";
import { usePersistentState } from "../../../hooks/usePersistentState.js";
import { accessLevelLabels, accessLevels, defaultGoalHours, hasManagementAccess } from "../../../utils/constants.js";
import { normalize } from "../../../utils/workbench/formatters.js";
import { dateStamp, downloadCsv } from "../../../utils/csvExport.js";
import { AvatarDot, Button, EmptyState, FilterCombobox, IdentityAvatar, RoleBadgeIcon, TextField, WorkbenchCardSkeleton, WorkbenchHeader } from "../ui/WorkbenchPrimitives.jsx";

const roleDefs = [
  { key: "isDev", level: "dev", label: "Dev" },
  { key: "isQa", level: "qa", label: "QA" },
  { key: "isManagement", level: "gestao", label: "Gestao" }
];

const accessLevelOptions = [accessLevels.dev, accessLevels.qa, accessLevels.gestao, accessLevels.gerente, accessLevels.admin];

function getEffectiveAccessLevel(person) {
  return person.accessLevel || "";
}

// isAdmin e um flag independente do nivel de acesso (alguem pode ser
// "gestao" no accessLevel e ainda ser Admin).
function isAdminPerson(person) {
  return Boolean(person.isAdmin || getEffectiveAccessLevel(person) === accessLevels.admin);
}

// Selos de funcao (Dev/QA/Gestao/Gerente/Admin) usados tanto no resumo
// recolhido da lista quanto dentro do card — uma unica fonte evita as duas
// copias divergirem de novo.
function computeRolePills(person) {
  const currentAccessLevel = getEffectiveAccessLevel(person);
  const pills = roleDefs.filter((role) => hasRoleFlag(person, role));
  if (currentAccessLevel === accessLevels.gerente && !pills.some((role) => role.level === "gerente")) {
    pills.push({ key: "isGerente", level: "gerente", label: "Gerente" });
  }
  if (isAdminPerson(person) && !pills.some((role) => role.level === "admin")) {
    pills.push({ key: "isAdmin", level: "admin", label: "Admin" });
  }
  return pills;
}

function hasRoleFlag(person, role) {
  if (person[role.key]) return true;
  const accessLevel = getEffectiveAccessLevel(person);
  if (!accessLevel) return false;
  if (role.level === accessLevels.dev) return accessLevel === accessLevels.dev;
  if (role.level === accessLevels.qa) return accessLevel === accessLevels.qa;
  if (role.level === accessLevels.gestao) return accessLevel === accessLevels.gestao || accessLevel === accessLevels.gerente;
  return false;
}

function isRoleDerivedFromAccessLevel(person, role) {
  const accessLevel = getEffectiveAccessLevel(person);
  if (!accessLevel) return false;
  if (role.level === accessLevels.dev) return accessLevel === accessLevels.dev;
  if (role.level === accessLevels.qa) return accessLevel === accessLevels.qa;
  if (role.level === accessLevels.gestao) return accessLevel === accessLevels.gestao || accessLevel === accessLevels.gerente;
  return false;
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

// Antes so dava pra colar uma URL de imagem — sem opcao de subir uma foto do
// computador. Sem storage de arquivos no backend, o upload vira uma data URI
// (mesma tecnica ja usada pelas evidencias de teste) gravada direto no campo
// imageUrl, que ja aceita qualquer string de URL de imagem.
function AvatarSourceField({ value, onChange, disabled }) {
  const isDataUri = /^data:image\//i.test(value || "");
  const [mode, setMode] = useState(isDataUri ? "file" : "url");

  function handleFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onChange(String(reader.result || ""));
    reader.readAsDataURL(file);
  }

  return (
    <label className="mbw-field mb-span-2">
      <span>Avatar</span>
      <div className="mb-profile-avatar-field">
        <div className="mb-profile-source-toggle">
          <button type="button" className={mode === "url" ? "active" : ""} disabled={disabled} onClick={() => setMode("url")}><i className="bi bi-link-45deg" /> URL</button>
          <button type="button" className={mode === "file" ? "active" : ""} disabled={disabled} onClick={() => setMode("file")}><i className="bi bi-upload" /> Arquivo</button>
        </div>
        {mode === "url" ? (
          <input type="text" value={isDataUri ? "" : value} onChange={(event) => onChange(event.target.value)} readOnly={disabled} placeholder="https://..." />
        ) : (
          <div className="mb-profile-avatar-file">
            <label className="mb-profile-avatar-file-btn">
              <input type="file" accept="image/*" disabled={disabled} onChange={handleFile} />
              <i className="bi bi-image" /> {isDataUri ? "Trocar imagem" : "Escolher imagem"}
            </label>
            {isDataUri && !disabled && <button type="button" className="mb-profile-avatar-clear" onClick={() => onChange("")}><i className="bi bi-x-lg" /></button>}
          </div>
        )}
      </div>
    </label>
  );
}

function ProfileCard({ person, isGestao, isOwn, isEditing, onEdit, onDone, onUpdate, onDelete, canEditRoles = false, canChangeAdmin = false }) {
  const canEdit = isGestao || isOwn;
  const editable = isEditing && canEdit;
  const currentAccessLevel = getEffectiveAccessLevel(person);

  return (
    <div className="mb-profile-card">
      <div className="mb-profile-card-head">
        <IdentityAvatar name={person.azureName} imageUrl={person.imageUrl} color={person.color} accessLevel={currentAccessLevel} size={56} />
        <div className="mb-profile-card-heading">
          <strong>{person.azureName || "Sem nome"}</strong>
        </div>
        {/* actions intentionally rendered outside for consistent placement */}
      </div>
      <div className="mbw-form-grid">
        <TextField label="Nome Azure" value={person.azureName || ""} onChange={(value) => onUpdate({ azureName: value })} readOnly={!editable} />
        <TextField label="Email" value={person.email || ""} onChange={(value) => onUpdate({ email: value })} readOnly={!editable || Boolean(person.authUserId)} />
        <TextField label="Nome no Slack" value={person.slackName || ""} onChange={(value) => onUpdate({ slackName: value })} readOnly={!editable} />
        <TextField label="Slack Member ID" value={person.slackMemberId || ""} onChange={(value) => onUpdate({ slackMemberId: value })} readOnly={!editable} />
        <AvatarSourceField value={person.imageUrl || ""} onChange={(value) => onUpdate({ imageUrl: value })} disabled={!editable} />
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
        <label className="mbw-field mb-span-2">
          <span>Funções</span>
          <div className="mb-profile-role-row">
            {/* Quem nao e Gestao/Gerente/Admin so pode OLHAR a propria
                funcao — mostrar as demais opcoes (que nunca vai poder
                escolher) so polui a tela. Gestao/Gerente/Admin continuam
                vendo o menu completo pra atribuir qualquer funcao. */}
            {roleDefs.filter((role) => canEditRoles || hasRoleFlag(person, role)).map((role) => (
              <RolePill
                key={role.key}
                level={role.level}
                label={role.label}
                active={hasRoleFlag(person, role)}
                disabled={!editable || !canEditRoles || isRoleDerivedFromAccessLevel(person, role)}
                onToggle={() => {
                  // Dev/QA/Gestao usam o mesmo nome do nivel de acesso — em
                  // vez de manter um select de "Nivel de acesso" separado
                  // (que so duplicava a mesma escolha), selecionar a funcao
                  // ja atribui o nivel de acesso equivalente direto.
                  onUpdate({
                    accessLevel: role.level,
                    isDev: role.level === accessLevels.dev,
                    isQa: role.level === accessLevels.qa,
                    isManagement: role.level === accessLevels.gestao
                  });
                }}
              />
            ))}
            {(canEditRoles || currentAccessLevel === accessLevels.gerente) && (
              <RolePill
                key="role-gerente"
                level="gerente"
                label="Gerente"
                active={currentAccessLevel === accessLevels.gerente}
                disabled={!editable || !canEditRoles}
                onToggle={() => onUpdate({ accessLevel: currentAccessLevel === accessLevels.gerente ? accessLevels.gestao : accessLevels.gerente, isManagement: true })}
              />
            )}
            {(canChangeAdmin || isAdminPerson(person)) && (
              <RolePill
                key="role-admin"
                level="admin"
                label="Admin"
                active={isAdminPerson(person)}
                disabled={!editable || !canChangeAdmin}
                onToggle={() => {
                  if (currentAccessLevel === accessLevels.admin) {
                    onUpdate({ accessLevel: accessLevels.gestao });
                  } else {
                    onUpdate({ isAdmin: !Boolean(person.isAdmin) });
                  }
                }}
              />
            )}
          </div>
        </label>
        <label className="mbw-field mb-span-2">
          <span>FYI no Slack</span>
          <div className="mb-profile-role-row">
            <button
              type="button"
              className={`mb-profile-fyi-pill all ${person.fixedMention ? "active" : ""}`}
              disabled={!isGestao || !editable}
              onClick={() => onUpdate({ fixedMention: !Boolean(person.fixedMention) })}
            >
              <i className="bi bi-megaphone-fill" /> Todos os resultados
            </button>
            <button
              type="button"
              className={`mb-profile-fyi-pill failure ${person.fixedMentionOnFailure ? "active" : ""}`}
              disabled={!isGestao || !editable}
              onClick={() => onUpdate({ fixedMentionOnFailure: !Boolean(person.fixedMentionOnFailure) })}
            >
              <i className="bi bi-exclamation-triangle-fill" /> Fail / Limitation
            </button>
          </div>
        </label>
      </div>
    </div>
  );
}

function PendingApprovalRow({ person, onApprove }) {
  const [level, setLevel] = useState(accessLevels.dev);
  const [approving, setApproving] = useState(false);

  async function handleApprove() {
    setApproving(true);
    await onApprove(person, level);
    setApproving(false);
  }

  return (
    <div className="mb-profile-pending-row">
      <AvatarDot person={person} />
      <div className="mb-profile-pending-copy">
        <strong>{person.displayName || person.fullName}</strong>
        <small>{person.email}</small>
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
  const currentUserAccess = profile?.accessLevel;
  // isAdmin e um flag independente do accessLevel (nao existe 'admin' no
  // enum do banco) — Admin sempre pode editar funcoes e o flag Admin de
  // qualquer pessoa, mesmo com nivel de acesso formal Dev/QA/pending.
  const isAdminUser = Boolean(profile?.isAdmin);
  const canEditRolesGlobal = isAdminUser || hasManagementAccess(currentUserAccess, isAdminUser);
  const canChangeAdminGlobal = isAdminUser;
  const { collaborators, loading, updateCollaborator, addCollaborator, deleteCollaborator } = useCollaborators();
  const [search, setSearch] = usePersistentState("starkHubFilters:collaborators:search", "");
  const [roleFilter, setRoleFilter] = usePersistentState("starkHubFilters:collaborators:role", "all");
  const [editingId, setEditingId] = useState(null);
  const isGestao = hasManagementAccess(profile?.accessLevel, isAdminUser);
  const ownCollaborator = collaborators.find((person) => person.id === profile?.id)
    || collaborators.find((person) => String(person.azureName || "").toLowerCase() === String(profile?.displayName || profile?.fullName || "").toLowerCase());
  // Contas que ja logaram (authUserId preenchido pelo trigger no primeiro
  // login) mas a Gestao ainda nao atribuiu nenhuma funcao — accessLevel fica
  // "pending" ate a aprovacao. Diretorio cadastrado manualmente sem login
  // (authUserId nulo) NAO entra aqui, mesmo com accessLevel "pending" por
  // nunca ter sido definido.
  const pendingAccounts = isGestao
    ? collaborators.filter((person) => person.authUserId && person.accessLevel === accessLevels.pending)
    : [];
  const baseCollaborators = isGestao ? collaborators : ownCollaborator ? [ownCollaborator] : [];
  const visibleCollaborators = baseCollaborators.filter((person) => {
    if (pendingAccounts.some((pending) => pending.id === person.id)) return false;
    if (roleFilter === "dev" && !hasRoleFlag(person, roleDefs[0])) return false;
    if (roleFilter === "qa" && !hasRoleFlag(person, roleDefs[1])) return false;
    if (roleFilter === "gestao" && !hasRoleFlag(person, roleDefs[2])) return false;
    if (roleFilter === "gerente" && getEffectiveAccessLevel(person) !== "gerente") return false;
    if (search && !normalize(`${person.azureName || ""} ${person.email || ""} ${person.slackId || ""} ${person.slackName || ""} ${(person.aliases || []).join(" ")}`).includes(normalize(search))) return false;
    return true;
  });
  const metrics = useMemo(() => ({
    total: baseCollaborators.length,
    dev: baseCollaborators.filter((person) => hasRoleFlag(person, roleDefs[0])).length,
    qa: baseCollaborators.filter((person) => hasRoleFlag(person, roleDefs[1])).length,
    gestao: baseCollaborators.filter((person) => hasRoleFlag(person, roleDefs[2])).length,
    linked: baseCollaborators.filter((person) => person.authUserId).length
  }), [baseCollaborators]);

  async function addPerson() {
    const { data } = await addCollaborator({ azureName: "Novo colaborador", isDev: true, goalHours: defaultGoalHours });
    if (data?.id) setEditingId(data.id);
  }

  async function removePerson(id) {
    if (editingId === id) setEditingId(null);
    await deleteCollaborator(id);
  }

  // A linha pendente ja existe (criada pelo trigger no primeiro login) —
  // aprovar so atualiza o nivel de acesso e os papeis dela, sem criar nada.
  async function approveAccount(pendingAccount, level) {
    await updateCollaborator(pendingAccount.id, {
      accessLevel: level,
      isDev: level === accessLevels.dev,
      isQa: level === accessLevels.qa,
      isManagement: level === accessLevels.gestao || level === accessLevels.gerente,
      goalHours: pendingAccount.goalHours || defaultGoalHours
    });
  }

  function exportCollaboratorsCsv() {
    downloadCsv(`colaboradores-${dateStamp()}.csv`, [
      "Nome Azure",
      "Email",
      "Nome Slack",
      "Slack Member ID",
      "Nivel",
      "Dev",
      "QA",
      "Gestao",
      "Meta horas",
      "FYI todos",
      "FYI Fail/Limitation",
      "Aliases"
    ], visibleCollaborators.map((person) => [
      person.azureName || "",
      person.email || "",
      person.slackName || "",
      person.slackMemberId || "",
      accessLevelLabels[getEffectiveAccessLevel(person)] || getEffectiveAccessLevel(person) || "",
      hasRoleFlag(person, roleDefs[0]) ? "sim" : "nao",
      hasRoleFlag(person, roleDefs[1]) ? "sim" : "nao",
      hasRoleFlag(person, roleDefs[2]) ? "sim" : "nao",
      person.goalHours || "",
      person.fixedMention ? "sim" : "nao",
      person.fixedMentionOnFailure ? "sim" : "nao",
      (person.aliases || []).join("|")
    ]));
  }

  return (
    <section className="mbw-page mb-settings-page">
      <WorkbenchHeader
        kicker="Perfil"
        title="Perfil"
        subtitle={isGestao ? "Cadastro unico de identidade, aliases, permissoes, Slack, avatar e cor de todo o time." : "Suas informacoes de identidade, Slack, avatar e cor."}
        demoMode={demoMode}
        actions={<>
          {isGestao && <Button onClick={addPerson}>+ Adicionar</Button>}
          {!isGestao && ownCollaborator && (editingId === ownCollaborator.id
            ? <Button tone="primary" onClick={() => setEditingId(null)}><i className="bi bi-check-lg" /> Concluir</Button>
            : <Button onClick={() => setEditingId(ownCollaborator.id)}><i className="bi bi-pencil" /> Editar</Button>)}
          <Button onClick={exportCollaboratorsCsv}><i className="bi bi-download" /> CSV</Button>
        </>}
      />
      <div className="mb-collaborators-list-react">
        {isGestao && (loading ? <WorkbenchCardSkeleton rows={1} mode="list" /> : pendingAccounts.length > 0 && (
          <section className="mb-profile-pending-section">
            <header><strong>Pendentes de aprovacao</strong><small>{pendingAccounts.length} conta(s) logada(s) sem nivel de acesso ou identidade vinculada.</small></header>
            {pendingAccounts.map((pendingAccount) => (
              <PendingApprovalRow key={pendingAccount.id} person={pendingAccount} onApprove={approveAccount} />
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
        {!isGestao && visibleCollaborators.map((person) => {
          const editing = editingId === person.id;
          return (
            <div key={person.id} className="mb-collaborator-single">
              <ProfileCard
                person={person}
                isGestao={isGestao}
                isOwn
                isEditing={editing}
                canEditRoles={canEditRolesGlobal}
                canChangeAdmin={canChangeAdminGlobal}
                onEdit={() => setEditingId(person.id)}
                onDone={() => setEditingId(null)}
                onUpdate={(patch) => updateCollaborator(person.id, patch)}
                onDelete={removePerson}
              />
            </div>
          );
        })}
        {isGestao && visibleCollaborators.map((person) => {
          const currentAccessLevel = getEffectiveAccessLevel(person);
          const rolePills = computeRolePills(person);
          const showAccessLevelPill = !(rolePills && rolePills.length > 0) && Boolean(currentAccessLevel);
          const editing = editingId === person.id;
          return (
            <details key={person.id} className="mb-collaborator-card-react" open={editing}>
              <summary>
                <AvatarDot person={person} />
                <div className="mb-profile-role-row">
                  {showAccessLevelPill && <RolePill level={currentAccessLevel} label={accessLevelLabels[currentAccessLevel] || currentAccessLevel} active disabled />}
                  {rolePills.map((role) => <RolePill key={role.key} level={role.level} label={role.label} active disabled />)}
                </div>
                <div className="mb-profile-card-actions">
                  {editing
                    ? <Button tone="primary" onClick={() => setEditingId(null)}><i className="bi bi-check-lg" /> Concluir</Button>
                    : <Button onClick={() => setEditingId(person.id)}><i className="bi bi-pencil" /> Editar</Button>}
                  <Button tone="danger" onClick={() => removePerson(person.id)}><i className="bi bi-trash" /> Excluir</Button>
                </div>
              </summary>
              <ProfileCard
                person={person}
                isGestao={isGestao}
                isOwn={person.id === ownCollaborator?.id}
                isEditing={editing}
                canEditRoles={canEditRolesGlobal}
                canChangeAdmin={canChangeAdminGlobal}
                onEdit={() => setEditingId(person.id)}
                onDone={() => setEditingId(null)}
                onUpdate={(patch) => updateCollaborator(person.id, patch)}
                onDelete={removePerson}
              />
            </details>
          );
        })}
        {!visibleCollaborators.length && !pendingAccounts.length && <EmptyState title={isGestao ? "Nenhum colaborador cadastrado" : "Sua conta ainda nao foi vinculada a um colaborador"} />}
      </div>
    </section>
  );
}
