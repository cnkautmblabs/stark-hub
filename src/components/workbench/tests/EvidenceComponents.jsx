import React from "react";
import { workItemTypes } from "../../../utils/constants.js";
import {
  evidenceEnvironmentOrder,
  evidenceEnvironments,
  normalizeEvidenceEnvironment,
  normalizeFilterClass,
  resultInfo
} from "../../../utils/workbench/formatters.js";

export function ResultIcon({ result }) {
  const info = resultInfo(result);
  return <i className={`bi ${info.iconClass}`} aria-hidden="true" />;
}

export function EvidenceFilterBox({ label, value, onChange, options }) {
  return (
    <div className="mbaz-evidence-filter-box">
      <div className="mbaz-evidence-filter-label">{label}</div>
      <div className="mbaz-evidence-filter-options">
        {options.map(([key, text]) => <button key={key} type="button" className={`mbaz-evidence-filter filter-${normalizeFilterClass(key)} ${value === key ? "active" : ""}`} onClick={() => onChange(key)}>{text}</button>)}
      </div>
    </div>
  );
}

export function EvidenceMultiFilterBox({ label, values, onToggle, onAll, options }) {
  return (
    <div className="mbaz-evidence-filter-box">
      <div className="mbaz-evidence-filter-label">{label}</div>
      <div className="mbaz-evidence-filter-options">
        <button type="button" className={`mbaz-evidence-filter filter-all ${values.length === options.length ? "active" : ""}`} onClick={onAll}>Todos</button>
        {options.map(([key, text]) => <button key={key} type="button" className={`mbaz-evidence-filter filter-${normalizeFilterClass(key)} ${values.includes(key) ? "active" : ""}`} onClick={() => onToggle(key)}>{text}</button>)}
      </div>
    </div>
  );
}

export function EvidenceCard({ group, profile, visibleEnvironments, resolveWorkItemUrl, onOpen }) {
  const item = group.item || {};
  const latest = group.latest;
  const info = resultInfo(latest?.result);
  const envs = evidenceEnvironmentOrder.filter((env) => (visibleEnvironments || []).includes(env));
  const authors = Array.from(new Set(group.records.map((entry) => entry.authorName).filter(Boolean)));
  return (
    <article className={`mbaz-evidence-card has-${info.className}`} data-work-item-type={String(item.type || "work item").toLowerCase()}>
      <div className="mbaz-evidence-card-identity">
        <div className="mbaz-evidence-card-top">
          <div className="mbaz-evidence-card-id">
            <span className="mbaz-type-icon"><i className={`bi ${(workItemTypes[item.type] || workItemTypes.Task).icon}`} /></span>
            <button type="button" onClick={() => onOpen(item.id ? item : { id: group.workItemId, type: item.type || "Work Item", url: resolveWorkItemUrl(profile, { id: group.workItemId }) })}>{item.type || "Work Item"} {group.workItemId}</button>
          </div>
        </div>
        <div className="mbaz-evidence-card-title" title={item.title || "Sem titulo"}>{item.title || "Sem titulo"}</div>
        <div className="mbaz-evidence-card-context"><span>{authors.length <= 1 ? (authors[0] || "QA nao informado") : `${authors[0]} +${authors.length - 1}`}</span><span>-</span><time>{latest?.createdAt ? new Date(latest.createdAt).toLocaleString("pt-BR") : "-"}</time></div>
      </div>
      <div className="mbaz-evidence-environments">
        {envs.map((env) => <EvidenceJourney key={env} env={env} records={group.records.filter((entry) => evidenceEnvironments(entry).includes(normalizeEvidenceEnvironment(env)))} />)}
      </div>
      <span className={`mbaz-evidence-last-status ${info.className}`}><ResultIcon result={latest?.result} /> {info.label}</span>
      {latest?.note && <p className="mbaz-evidence-note">{latest.note}</p>}
    </article>
  );
}

export function EvidenceJourney({ env, records }) {
  if (!records.length) {
    return (
      <div className={`mbaz-evidence-env-block env-${String(env).toLowerCase()}`}>
        <div className="mbaz-evidence-env-label"><span className="mbaz-evidence-env-count">0</span><span>{env}</span><span title="Sem tentativas registradas">?</span></div>
        <div className="mbaz-evidence-journey empty"><span className="mbaz-evidence-pending"><span className="mbaz-evidence-pending-icon"><i className="bi bi-dash-lg" /></span> Pending</span></div>
      </div>
    );
  }
  return (
    <div className={`mbaz-evidence-env-block env-${String(env).toLowerCase()}`}>
      <div className="mbaz-evidence-env-label"><span className="mbaz-evidence-env-count">{records.length}</span><span>{env}</span><span title="Passe o mouse para ver as tentativas">?</span></div>
      <div className="mbaz-evidence-journey" title={records.map((entry) => `${resultInfo(entry.result).label} - ${entry.authorName || "QA"} - ${entry.createdAt ? new Date(entry.createdAt).toLocaleString("pt-BR") : ""}`).join("\n")}>
        <span className="mbaz-evidence-run-flow">{records.slice().reverse().map((entry, index) => <React.Fragment key={entry.id || `${env}-${index}`}>{index > 0 && <span className="mbaz-evidence-run-arrow">-&gt;</span>}<span className={`mbaz-evidence-run-group ${resultInfo(entry.result).className}`}><ResultIcon result={entry.result} /></span></React.Fragment>)}</span>
      </div>
    </div>
  );
}
