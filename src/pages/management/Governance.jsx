import React, { useMemo } from "react";
import { FiCopy } from "react-icons/fi";
import { useFeatureFlags } from "../../contexts/FeatureFlagsContext.jsx";
import { useAuth } from "../../contexts/AuthContext.jsx";
import { useWorkItems } from "../../hooks/useWorkItems.js";
import { useCollaborators } from "../../hooks/useCollaborators.js";
import Avatar from "../../components/common/Avatar.jsx";
import { featureFlagLabels } from "../../utils/mockData.js";
import { countries, flagUrl, defaultGoalHours } from "../../utils/constants.js";

function goalStatus(hours, goal) {
  if (hours >= goal) return { label: "Meta atingida", tone: "success" };
  if (hours >= goal * 0.7) return { label: "Perto da meta", tone: "warning" };
  return { label: "Abaixo da meta", tone: "danger" };
}

export default function Governance() {
  const { flags, isEnabled, setFlag } = useFeatureFlags();
  const { profile, demoMode } = useAuth();
  const { items } = useWorkItems();
  const { collaborators } = useCollaborators();

  const canEdit = profile?.accessLevel === "gestao";

  const hoursByCollaborator = useMemo(() => {
    return collaborators.filter((c) => c.isDev).map((collaborator) => {
      const hours = items
        .filter((item) => item.assigneeId === collaborator.id)
        .reduce((sum, item) => sum + (item.completedHours || 0), 0);
      const goal = collaborator.goalHours || defaultGoalHours;
      return { collaborator, hours, goal, ...goalStatus(hours, goal) };
    });
  }, [collaborators, items]);

  const countryCounts = useMemo(() => {
    const counts = {};
    items.forEach((item) => item.countries.forEach((code) => { counts[code] = (counts[code] || 0) + 1; }));
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [items]);

  const pendingQaCount = items.filter((item) => !item.qaCollaboratorId).length;
  const maxCountryCount = Math.max(1, ...countryCounts.map(([, count]) => count));

  function copyExecutiveReport() {
    const lines = [
      "Relatório executivo — Governança",
      `Gerado em ${new Date().toLocaleString("pt-BR")}`,
      "",
      ...hoursByCollaborator.map((row) => `${row.collaborator.azureName} — ${row.hours}h / meta ${row.goal}h (${row.label})`)
    ];
    navigator.clipboard?.writeText(lines.join("\n"));
  }

  return (
    <div className="d-flex flex-column gap-3">
      <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
        <h3 className="mb-0">Governança {demoMode && <span className="stark-badge-demo ms-2">demo</span>}</h3>
        <button className="btn btn-sm btn-outline-primary d-flex align-items-center gap-1" onClick={copyExecutiveReport}>
          <FiCopy /> Copiar relatório executivo
        </button>
      </div>

      <div className="row g-3">
        <div className="col-md-3">
          <div className="stark-card">
            <span className="text-muted small">Colaboradores ativos</span>
            <h2 className="mb-0">{collaborators.length}</h2>
          </div>
        </div>
        <div className="col-md-3">
          <div className="stark-card">
            <span className="text-muted small">Feature flags ativas</span>
            <h2 className="mb-0">{Object.values(flags).filter(Boolean).length}/{Object.keys(flags).length}</h2>
          </div>
        </div>
        <div className="col-md-3">
          <div className="stark-card">
            <span className="text-muted small">Itens sem QA responsável</span>
            <h2 className="mb-0">{pendingQaCount}</h2>
          </div>
        </div>
        <div className="col-md-3">
          <div className="stark-card">
            <span className="text-muted small">Total de horas registradas</span>
            <h2 className="mb-0">{hoursByCollaborator.reduce((sum, row) => sum + row.hours, 0)}h</h2>
          </div>
        </div>
      </div>

      <div className="stark-card">
        <h5 className="mb-3">Horas por colaborador</h5>
        <div className="d-flex flex-column gap-2">
          {hoursByCollaborator.map((row) => (
            <div key={row.collaborator.id} className="d-flex align-items-center gap-3">
              <Avatar name={row.collaborator.azureName} color={row.collaborator.color} size={30} />
              <div className="flex-grow-1">
                <div className="d-flex justify-content-between small mb-1">
                  <strong>{row.collaborator.azureName}</strong>
                  <span className="text-muted">{row.hours}h / {row.goal}h</span>
                </div>
                <div className="progress" style={{ height: 6 }}>
                  <div
                    className={`progress-bar bg-${row.tone}`}
                    style={{ width: `${Math.min(100, (row.hours / row.goal) * 100)}%` }}
                  />
                </div>
              </div>
              <span className={`badge text-bg-${row.tone}`}>{row.label}</span>
            </div>
          ))}
          {!hoursByCollaborator.length && <span className="text-muted small">Sem dados de horas no período.</span>}
        </div>
      </div>

      <div className="stark-card">
        <h5 className="mb-3">Itens por país</h5>
        <div className="d-flex flex-column gap-2">
          {countryCounts.map(([code, count]) => (
            <div key={code} className="d-flex align-items-center gap-2">
              <span className="d-flex align-items-center gap-1" style={{ width: 70 }}>
                {countries[code] && <img src={flagUrl(countries[code].iso2)} alt="" width={22} height={16} className="stark-flag-img" />}
                {code}
              </span>
              <div className="flex-grow-1 progress" style={{ height: 8 }}>
                <div className="progress-bar" style={{ width: `${(count / maxCountryCount) * 100}%` }} />
              </div>
              <span className="text-muted small" style={{ width: 24, textAlign: "right" }}>{count}</span>
            </div>
          ))}
          {!countryCounts.length && <span className="text-muted small">Sem itens no período.</span>}
        </div>
      </div>

      <div className="stark-card">
        <h5 className="mb-1">Feature flags</h5>
        <p className="text-muted small">
          {canEdit
            ? "Ativam/desativam funcionalidades sem precisar de novo deploy."
            : "Somente Gestão pode editar. Contate um administrador para alterar."}
        </p>
        <div className="d-flex flex-column gap-2">
          {Object.entries(flags).map(([key, value]) => (
            <label key={key} className="stark-switch justify-content-between border-bottom pb-2">
              <span className="small">{featureFlagLabels[key] || key}</span>
              <span className="d-flex align-items-center gap-2">
                <input
                  type="checkbox"
                  checked={isEnabled(key)}
                  disabled={!canEdit}
                  onChange={(e) => setFlag(key, e.target.checked)}
                />
                <span className="stark-switch-track" />
              </span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
