import React, { useEffect, useMemo, useRef, useState } from "react";
import { FiAlertCircle, FiSearch } from "react-icons/fi";
import { countries, environments, flagUrl, formatWorkItemCode, testResultTypes, workItemTypes } from "../../../utils/constants.js";
import { compactSprintLabel } from "../../../utils/sprints.js";

function initials(name) {
  return String(name || "?").trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function avatarSvgDataUri(text, color = "#0b74de") {
  const label = initials(text).slice(0, 2) || "?";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="${color}"/><text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif" font-size="24" font-weight="700" fill="#fff">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function WorkbenchHeader({ kicker, title, subtitle, actions, demoMode }) {
  return (
    <header className="mbw-header">
      <div>
        <p className="mbw-kicker">{kicker}</p>
        <h2>{title} {demoMode && <span className="stark-badge-demo">demo</span>}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="mbw-actions">{actions}</div>}
    </header>
  );
}

export function Button({ children, tone = "default", ...props }) {
  return <button type="button" className={`mbw-btn ${tone}`} {...props}>{children}</button>;
}

export function IconButton({ children, title, ...props }) {
  return <button type="button" className="mbw-icon-btn" title={title} {...props}>{children}</button>;
}

export function SearchBox({ value, onChange, placeholder = "Buscar" }) {
  return (
    <label className="mbw-search">
      <FiSearch />
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  );
}

export function SelectField({ label, value, onChange, children }) {
  return (
    <label className="mbw-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>{children}</select>
    </label>
  );
}

export function FilterCombobox({
  label,
  options = [],
  values = [],
  onChange,
  multiple = true,
  placeholder = "Buscar",
  allLabel = "Todos",
  className = "",
  renderOption,
  getOptionLabel = (option) => option?.label ?? String(option?.value ?? option),
  getOptionValue = (option) => option?.value ?? option
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef(null);
  const selectedValues = Array.isArray(values) ? values : values ? [values] : [];
  const selectedSet = new Set(selectedValues.map(String));

  useEffect(() => {
    if (!open) return undefined;
    function handleOutsideClick(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [open]);
  const filteredOptions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) => getOptionLabel(option).toLowerCase().includes(needle));
  }, [getOptionLabel, options, query]);

  function toggle(option) {
    const value = getOptionValue(option);
    if (multiple) {
      const exists = selectedSet.has(String(value));
      onChange(exists ? selectedValues.filter((item) => String(item) !== String(value)) : [...selectedValues, value]);
      return;
    }
    onChange(value);
    setOpen(false);
  }

  function clear() {
    onChange(multiple ? [] : "");
    setQuery("");
  }

  const summary = selectedValues.length ? `${selectedValues.length} selecionado(s)` : allLabel;

  return (
    <div ref={rootRef} className={`mbw-combobox ${className}`}>
      <button type="button" className="mbw-combobox-trigger" onClick={() => setOpen((value) => !value)}>
        <span>{label}</span>
        <b>{summary}</b>
        <i className={`bi ${open ? "bi-chevron-up" : "bi-chevron-down"}`} />
      </button>
      {open && (
        <div className="mbw-combobox-menu">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} autoFocus />
          <div className="mbw-combobox-options">
            {filteredOptions.map((option) => {
              const value = getOptionValue(option);
              const checked = selectedSet.has(String(value));
              return (
                <button key={String(value)} type="button" className={`mbw-combobox-option ${checked ? "active" : ""}`} onClick={() => toggle(option)}>
                  <span className="mbw-combobox-check">{checked && <i className="bi bi-check-lg" />}</span>
                  <span className="mbw-combobox-label">{renderOption ? renderOption(option) : getOptionLabel(option)}</span>
                </button>
              );
            })}
            {!filteredOptions.length && <span className="mbw-combobox-empty">Nenhuma opcao</span>}
          </div>
          <div className="mbw-combobox-actions">
            {multiple && <button type="button" onClick={() => onChange(options.map(getOptionValue))}>Selecionar todos</button>}
            <button type="button" onClick={clear}>Limpar filtros</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ProfileCombobox({ label, people = [], values = [], onChange, multiple = true }) {
  return (
    <FilterCombobox
      label={label}
      options={people.map((person) => ({ value: person.id || person.key, label: person.azureName || person.displayName || person.name, person }))}
      values={values}
      onChange={onChange}
      multiple={multiple}
      placeholder="Buscar pessoa"
      renderOption={(option) => <AvatarDot person={option.person} name={option.label} />}
    />
  );
}

export function TextField({ label, value, onChange, type = "text", readOnly = false, placeholder = "" }) {
  return (
    <label className="mbw-field">
      <span>{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} readOnly={readOnly} placeholder={placeholder} />
    </label>
  );
}

export function Kpi({ label, value, tone = "", icon, color, percent, active = false, onClick }) {
  const style = color ? { "--kpi-accent": color } : undefined;
  const content = (
    <>
      {icon && <span className="mbw-kpi-icon"><i className={`bi ${icon}`} /></span>}
      <span className="mbw-kpi-body">
        <span className="mbw-kpi-label">{label}</span>
        <strong className="mbw-kpi-value">{value}</strong>
      </span>
      {percent !== undefined && <em className="mbw-kpi-percent">{percent}%</em>}
    </>
  );
  if (onClick) {
    return (
      <button type="button" className={`mbw-kpi clickable ${tone} ${active ? "active" : ""}`} style={style} onClick={onClick} aria-pressed={active}>
        {content}
      </button>
    );
  }
  return <div className={`mbw-kpi ${tone}`} style={style}>{content}</div>;
}

export function KpiSkeleton({ count = 4 }) {
  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="mbw-kpi skeleton">
          <span className="mbw-kpi-icon mbw-skeleton-block" />
          <span className="mbw-kpi-body">
            <span className="mbw-kpi-label mbw-skeleton-block" style={{ width: "60%", height: 10 }} />
            <span className="mbw-kpi-value mbw-skeleton-block" style={{ width: "45%", height: 18, marginTop: 5 }} />
          </span>
        </div>
      ))}
    </>
  );
}

export function AvatarDot({ person, name, compact = false }) {
  const displayName = person?.azureName || person?.full_name || person?.name || name || "Sem responsavel";
  const imageUrl = person?.imageUrl || person?.avatarUrl || person?.avatar_url || person?.photoUrl || person?.photo_url || "";
  const color = person?.color || "#0b74de";
  const [failed, setFailed] = useState(false);
  const src = !failed && imageUrl ? imageUrl : avatarSvgDataUri(displayName, color);
  return (
    <span className={`mbw-avatar-row ${compact ? "compact" : ""}`} title={compact ? displayName : undefined}>
      <img className="mbw-avatar image" src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      {!compact && <span>{displayName}</span>}
    </span>
  );
}

function firstDisplayName(person, fallback = "") {
  const value = person?.azureName || person?.full_name || person?.name || fallback || "";
  return String(value).trim().split(/\s+/)[0] || "QA";
}

export function QaPicker({ value, onChange, people = [], emptyLabel = "Sem QA" }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const current = people.find((person) => person.id === value);

  useEffect(() => {
    if (!open) return undefined;
    function handleOutsideClick(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [open]);

  function select(id) {
    onChange(id || "");
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="mbw-qa-picker">
      <button type="button" className="mbw-qa-picker-trigger" onClick={() => setOpen((value) => !value)} title={current?.azureName || emptyLabel}>
        {current ? (
          <>
            <AvatarDot person={current} compact />
            <span className="mbw-qa-picker-name">{firstDisplayName(current)}</span>
          </>
        ) : <span className="mbw-qa-picker-empty">{emptyLabel}</span>}
        <i className={`bi ${open ? "bi-chevron-up" : "bi-chevron-down"}`} />
      </button>
      {open && (
        <div className="mbw-combobox-menu">
          <div className="mbw-combobox-options">
            <button type="button" className={`mbw-combobox-option ${!value ? "active" : ""}`} onClick={() => select("")}>
              <span className="mbw-combobox-check">{!value && <i className="bi bi-check-lg" />}</span>
              <span className="mbw-combobox-label">{emptyLabel}</span>
            </button>
            {people.map((person) => (
              <button key={person.id} type="button" className={`mbw-combobox-option ${value === person.id ? "active" : ""}`} onClick={() => select(person.id)}>
                <span className="mbw-combobox-check">{value === person.id && <i className="bi bi-check-lg" />}</span>
                <span className="mbw-combobox-label"><AvatarDot person={person} /></span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export const accessLevelBadgeConfig = {
  dev: { label: "Dev", color: "#2563eb", tooltip: "Dev — acesso a Meus itens, Horas e Configurações pessoais." },
  qa: { label: "QA", color: "#7c3aed", tooltip: "QA — acesso a Quality Board, Testes e Configurações pessoais." },
  gestao: { label: "Gestão", color: "#16a34a", tooltip: "Gestão — acesso completo: Produto, Governança, Configurações e Colaboradores." },
  admin: { label: "Admin", color: "#ea580c", tooltip: "Administrador(a) — acesso total ao sistema." },
  pending: { label: "Pendente", color: "#64748b", tooltip: "Aguardando liberação de acesso." }
};

export function RoleBadgeIcon({ level }) {
  if (level === "dev") return <i className="bi bi-code-slash" />;
  if (level === "admin") return <i className="bi bi-gear-fill" />;
  if (level === "gestao") {
    return (
      <svg viewBox="0 0 20 20" width="10" height="10" fill="currentColor">
        <circle cx="10" cy="6.2" r="3.4" />
        <path d="M3.6 18c0-4.8 2.9-7.4 6.4-7.4s6.4 2.6 6.4 7.4Z" />
        <path d="M8.7 10.8h2.6l-.5 2.6-.8 2.4-.8-2.4Z" fill="rgba(0,0,0,.32)" />
      </svg>
    );
  }
  if (level === "qa") {
    return (
      <svg viewBox="0 0 20 20" width="11" height="11" fill="none">
        <circle cx="8" cy="8" r="5.4" stroke="currentColor" strokeWidth="1.6" />
        <line x1="12" y1="12" x2="17.4" y2="17.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <ellipse cx="8" cy="8.6" rx="2.3" ry="2.9" fill="currentColor" />
        <line x1="5.7" y1="6.6" x2="4.3" y2="5.3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
        <line x1="10.3" y1="6.6" x2="11.7" y2="5.3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
        <line x1="5.3" y1="8.6" x2="3.7" y2="8.6" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
        <line x1="10.7" y1="8.6" x2="12.3" y2="8.6" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      </svg>
    );
  }
  return <i className="bi bi-hourglass-split" />;
}

export function RoleBadge({ level, size = "md" }) {
  const config = accessLevelBadgeConfig[level] || accessLevelBadgeConfig.pending;
  return (
    <span className={`mbw-role-badge ${size}`} style={{ background: config.color }} title={config.tooltip}>
      <RoleBadgeIcon level={level} />
    </span>
  );
}

export function IdentityAvatar({ name, imageUrl, color = "#0b74de", accessLevel, size = 40 }) {
  const [failed, setFailed] = useState(false);
  const showImage = !failed && imageUrl;
  return (
    <span className="mbw-identity-avatar" style={{ width: size, height: size }}>
      {showImage ? (
        <img src={imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : (
        <span className="mbw-identity-fallback" style={{ background: color }}>{initials(name)}</span>
      )}
      {accessLevel && <RoleBadge level={accessLevel} />}
    </span>
  );
}

const typeIconFiles = { Bug: "bug.png", Task: "task.png", Feature: "feature.png", Epic: "epic.png" };
export function typeIconSrc(type) {
  return `${import.meta.env.BASE_URL}icons/${typeIconFiles[type] || "us.png"}`;
}
const envIconFiles = { dev: "dev.png", qa: "qa.png", beta: "beta.png", prod: "prod.png" };
export function envIconSrc(env) {
  return `${import.meta.env.BASE_URL}icons/${envIconFiles[String(env || "").toLowerCase()] || "dev.png"}`;
}

export function TypeBadge({ type }) {
  const info = workItemTypes[type] || {};
  return <span className="mbw-type" style={{ "--type-color": info.color || "#64748b", "--type-bg": info.background || "#f8fafc" }}><img className="mbw-type-icon" src={typeIconSrc(type)} alt="" />{type || "Work Item"}</span>;
}

export function EnvBadge({ env }) {
  const info = environments[env] || { label: env || "N/A", background: "#e2e8f0", color: "#0f172a" };
  return <span className="mbw-env" style={{ background: info.background, color: info.color }}><img className="mbw-env-icon" src={envIconSrc(env)} alt="" />{info.label}</span>;
}

export function ResultBadge({ result }) {
  if (!result) return <span className="mbw-result pending">Pendente</span>;
  const info = testResultTypes[result] || {};
  return <span className="mbw-result" style={{ background: info.background, color: info.color }}>{info.icon} {info.label || result}</span>;
}

export function CountryVisual({ code, compact = false }) {
  const country = countries[code];
  const title = country ? `${code} - ${country.label}` : code;
  if (country?.iso2) {
    return (
      <span className={`mbw-country-visual ${compact ? "compact" : ""}`} title={title}>
        <img src={flagUrl(country.iso2, 20)} alt="" loading="lazy" />
        <b>{code}</b>
      </span>
    );
  }
  return (
    <span className={`mbw-country-visual fallback ${compact ? "compact" : ""}`} title={title}>
      <span>{code}</span>
    </span>
  );
}

export function CountryPills({ codes = [] }) {
  if (!codes.length) return <span className="mbw-muted">Sem pais</span>;
  return (
    <span className="mbw-country-row">
      {codes.map((code) => <span key={code} className="mbw-country"><CountryVisual code={code} /></span>)}
    </span>
  );
}

export function EmptyState({ title = "Nenhum item encontrado", children }) {
  return (
    <div className="mbw-empty">
      <FiAlertCircle />
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}

export function WorkbenchCardSkeleton({ rows = 4, mode = "list", className = "" }) {
  return (
    <div className={`mbw-card-skeleton-list mode-${mode} ${className}`}>
      {Array.from({ length: rows }).map((_, index) => (
        <article key={index} className="mbw-card-skeleton-card">
          <div className="mbw-card-skeleton-top">
            <span className="mbw-card-skeleton-pill" />
            <span className="mbw-card-skeleton-pill short" />
          </div>
          <span className="mbw-card-skeleton-title" />
          <div className="mbw-card-skeleton-meta"><span /><span /><span /></div>
          <div className="mbw-card-skeleton-person">
            <i />
            <span />
            <b />
          </div>
        </article>
      ))}
    </div>
  );
}

export function WorkItemCard({ item, assignee, qa, compact = false, children }) {
  const typeStyle = workItemTypes[item.type] || {};
  return (
    <article className={`mbaz-card ${compact ? "compact" : ""}`} style={{ "--type-color": typeStyle.color || "#64748b", "--wi-type-color": typeStyle.color || "#64748b", "--wi-type-bg": typeStyle.background || "#f8fafc" }}>
      <div className="mbaz-card-top">
        <div className="mbaz-card-title">
          <TypeBadge type={item.type} />
          <strong>{formatWorkItemCode(item.id, item.type)}</strong>
          <span>{item.title}</span>
        </div>
        <div className="mbaz-card-badges">
          <EnvBadge env={item.env} />
          <ResultBadge result={item.lastTestResult} />
        </div>
      </div>
      <div className="mbaz-card-meta">
        <span>{item.state || "Sem status"}</span>
        <CountryPills codes={item.countries || []} />
        {item.sprint && <span>{compactSprintLabel(item.sprint)}</span>}
      </div>
      {!compact && (
        <div className="mbaz-card-people">
          <AvatarDot person={assignee} name={item.assigneeName} />
          <AvatarDot person={qa} name="QA nao definido" />
        </div>
      )}
      {children}
    </article>
  );
}

export function ConnectionGate({ needsAzureIntegration, error, children }) {
  if (needsAzureIntegration) {
    return <EmptyState title="Azure DevOps ainda nao conectado">Configure sua integracao em Configuracoes para carregar os work items reais.</EmptyState>;
  }
  if (error) {
    return <EmptyState title="Falha ao carregar dados">{error}</EmptyState>;
  }
  return children;
}
