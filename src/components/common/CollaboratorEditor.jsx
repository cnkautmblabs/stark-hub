import React, { useState } from "react";
import { FiEdit2, FiSave, FiTrash2 } from "react-icons/fi";
import Avatar from "./Avatar.jsx";
import { accessLevelLabels } from "../../utils/constants.js";

// Porta fiel do card de colaborador do userscript legado (.mb-collaborator-card):
// resumo (avatar, cor, nome, papéis) + corpo expansível só editável depois de
// clicar no lápis (que vira "salvar" enquanto edita) — mesmo fluxo do script,
// inclusive o campo "Menção fixa" (pessoa sempre citada nas notificações do Slack).
export default function CollaboratorEditor({ person, canEdit, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(person);
  const [aliasInput, setAliasInput] = useState("");

  function startEdit() {
    setDraft(person);
    setEditing(true);
  }

  function saveEdit() {
    const color = /^#[0-9A-Fa-f]{6}$/.test(draft.color || "") ? draft.color : person.color;
    onUpdate({
      azureName: draft.azureName.trim(),
      slackName: draft.slackName.trim(),
      slackMemberId: (draft.slackMemberId || "").replace(/[<@>]/g, "").trim(),
      color,
      imageUrl: (draft.imageUrl || "").trim(),
      aliases: draft.aliases || [],
      fixedMention: Boolean(draft.fixedMention),
      isQa: Boolean(draft.isQa),
      isDev: Boolean(draft.isDev),
      isManagement: Boolean(draft.isManagement),
      ...(person.profileId ? { accessLevel: draft.accessLevel } : {})
    });
    setEditing(false);
  }

  function addAlias() {
    const value = aliasInput.trim();
    if (!value) return;
    const aliases = draft.aliases || [];
    if (aliases.some((a) => a.toLowerCase() === value.toLowerCase())) return;
    setDraft({ ...draft, aliases: [...aliases, value] });
    setAliasInput("");
  }

  function removeAlias(value) {
    setDraft({ ...draft, aliases: (draft.aliases || []).filter((a) => a !== value) });
  }

  const roles = [
    draft.isQa && "QA",
    draft.isDev && "DEV",
    draft.isManagement && "Gestão"
  ].filter(Boolean).join(" | ") || "Sem função";

  return (
    <details className="stark-card mb-2">
      <summary className="d-flex align-items-center gap-2" style={{ cursor: "pointer", listStyle: "none" }}>
        <Avatar name={person.azureName} imageUrl={person.imageUrl} color={person.color} size={34} />
        <span className="flex-grow-1" style={{ minWidth: 0 }}>
          <strong className="d-block text-truncate">{person.azureName || "Novo colaborador"}</strong>
          <small className="text-muted">{roles}</small>
        </span>
        {canEdit && (
          <span className="d-flex gap-1" onClick={(e) => e.preventDefault()}>
            <button
              type="button" className="btn btn-sm btn-outline-secondary"
              onClick={() => (editing ? saveEdit() : startEdit())}
              title={editing ? "Salvar colaborador" : "Editar"}
            >
              {editing ? <FiSave /> : <FiEdit2 />}
            </button>
            <button
              type="button" className="btn btn-sm btn-outline-danger"
              onClick={() => { if (window.confirm(`Excluir ${person.azureName || "este colaborador"}?`)) onDelete(); }}
              title="Excluir"
            >
              <FiTrash2 />
            </button>
          </span>
        )}
      </summary>

      <div className="pt-3 border-top mt-3 d-flex flex-column gap-3">
        <div className="row g-2">
          <div className="col-md-4">
            <label className="form-label small text-muted">Nome no Azure</label>
            <input className="form-control form-control-sm" disabled={!editing} value={draft.azureName}
              onChange={(e) => setDraft({ ...draft, azureName: e.target.value })} />
          </div>
          <div className="col-md-4">
            <label className="form-label small text-muted">Nome no Slack</label>
            <input className="form-control form-control-sm" disabled={!editing} value={draft.slackName}
              onChange={(e) => setDraft({ ...draft, slackName: e.target.value })} />
          </div>
          <div className="col-md-4">
            <label className="form-label small text-muted">Member ID do Slack</label>
            <input className="form-control form-control-sm" disabled={!editing} value={draft.slackMemberId}
              placeholder="U012ABCDEF" onChange={(e) => setDraft({ ...draft, slackMemberId: e.target.value })} />
          </div>
        </div>

        <div className="row g-2 align-items-end">
          <div className="col-md-3">
            <label className="form-label small text-muted d-block">Cor</label>
            <div className="d-flex align-items-center gap-2">
              <input type="color" disabled={!editing} value={draft.color || "#0b74de"} style={{ width: 34, height: 34, padding: 2 }}
                onChange={(e) => setDraft({ ...draft, color: e.target.value })} />
              <input className="form-control form-control-sm" style={{ width: 100 }} disabled={!editing}
                value={(draft.color || "").toUpperCase()} onChange={(e) => setDraft({ ...draft, color: e.target.value })} />
            </div>
          </div>
          <div className="col-md-9">
            <label className="form-label small text-muted">URL da imagem</label>
            <input className="form-control form-control-sm" disabled={!editing} value={draft.imageUrl || ""}
              placeholder="https://..." onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })} />
          </div>
        </div>

        <div>
          <label className="form-label small text-muted d-block">Aliases</label>
          <div className="d-flex flex-wrap gap-2 mb-2">
            {(draft.aliases || []).map((alias) => (
              <span key={alias} className="stark-alias-pill">
                {alias}
                {editing && <button type="button" onClick={() => removeAlias(alias)}>&times;</button>}
              </span>
            ))}
            {!(draft.aliases || []).length && <span className="text-muted small">Nenhum alias.</span>}
          </div>
          {editing && (
            <div className="d-flex gap-2" style={{ maxWidth: 320 }}>
              <input
                className="form-control form-control-sm" placeholder="Digite um alias"
                value={aliasInput} onChange={(e) => setAliasInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addAlias(); } }}
              />
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={addAlias}>+</button>
            </div>
          )}
        </div>

        <div className="d-flex flex-wrap gap-3">
          {[["fixedMention", "Menção fixa"], ["isQa", "QA"], ["isDev", "DEV"], ["isManagement", "Gestão"]].map(([key, label]) => (
            <label key={key} className="stark-switch">
              <input type="checkbox" disabled={!editing} checked={Boolean(draft[key])}
                onChange={(e) => setDraft({ ...draft, [key]: e.target.checked })} />
              <span className="stark-switch-track" />
              <span className="small">{label}</span>
            </label>
          ))}
        </div>

        {person.profileId && (
          <div>
            <label className="form-label small text-muted d-block">Nível de acesso ao Stark Hub</label>
            <select
              className="form-select form-select-sm" style={{ maxWidth: 220 }} disabled={!editing}
              value={draft.accessLevel || "pending"} onChange={(e) => setDraft({ ...draft, accessLevel: e.target.value })}
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
