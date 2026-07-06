import React, { useMemo, useState } from "react";
import { FiCopy, FiChevronDown, FiChevronUp, FiFileText } from "react-icons/fi";
import { copyExecutiveReportText, downloadExecutiveReportPdf } from "../../utils/executiveReport.js";
import { useAuth } from "../../contexts/AuthContext.jsx";
import { useWorkItems } from "../../hooks/useWorkItems.js";
import { useCollaborators } from "../../hooks/useCollaborators.js";
import { useAppSettings } from "../../hooks/useAppSettings.js";
import Avatar from "../../components/common/Avatar.jsx";
import PeriodFilter from "../../components/common/PeriodFilter.jsx";
import MultiSelectFilter from "../../components/common/MultiSelectFilter.jsx";
import WorkItemTypeIcon from "../../components/common/WorkItemTypeIcon.jsx";
import { countries, flagUrl, defaultGoalHours } from "../../utils/constants.js";

// Status de meta — mesma regra do userscript legado: abaixo de 100% é
// vermelho, exatamente 100% é azul, qualquer valor acima é dourado.
function goalStatus(hours, goal) {
  if (hours < goal) return { key: "below", label: "Abaixo da meta", tone: "danger" };
  if (hours > goal) return { key: "above", label: "Acima da meta", tone: "warning" };
  return { key: "met", label: "Meta cumprida", tone: "primary" };
}

function withinPeriod(item, period) {
  if (!period?.from && !period?.to) return true;
  const changed = item.updatedAt ? new Date(item.updatedAt) : null;
  if (!changed) return true;
  if (period.from) {
    const from = new Date(period.from);
    from.setHours(0, 0, 0, 0);
    if (changed < from) return false;
  }
  if (period.to) {
    const to = new Date(period.to);
    to.setHours(23, 59, 59, 999);
    if (changed > to) return false;
  }
  return true;
}

export default function Governance() {
  const { demoMode } = useAuth();
  const { items, error: itemsError } = useWorkItems();
  const { collaborators } = useCollaborators();
  const { getSetting } = useAppSettings();
  const goalHours = getSetting("defaultGoalHours", defaultGoalHours);

  const [period, setPeriod] = useState({ preset: "30d" });
  const [countryFilter, setCountryFilter] = useState([]);
  const [collaboratorFilter, setCollaboratorFilter] = useState([]);
  const [typeFilter, setTypeFilter] = useState([]);
  const [hourStatus, setHourStatus] = useState("all");
  const [goalFilter, setGoalFilter] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  const devCollaborators = useMemo(() => collaborators.filter((c) => c.isDev), [collaborators]);

  const globallyFilteredItems = useMemo(
    () =>
      items.filter((item) => {
        if (!withinPeriod(item, period)) return false;
        if (countryFilter.length && !item.countries.some((c) => countryFilter.includes(c))) return false;
        if (typeFilter.length && !typeFilter.includes(item.type)) return false;
        if (hourStatus === "with" && item.completedHours == null) return false;
        if (hourStatus === "without" && item.completedHours != null) return false;
        return true;
      }),
    [items, period, countryFilter, typeFilter, hourStatus]
  );

  const hoursByCollaborator = useMemo(() => {
    return devCollaborators
      .map((collaborator) => {
        const myItems = globallyFilteredItems.filter((item) => item.assigneeId === collaborator.id);
        const hours = myItems.reduce((sum, item) => sum + (item.completedHours || 0), 0);
        const goal = collaborator.goalHours || goalHours;
        const countryCounts = {};
        myItems.forEach((item) => item.countries.forEach((code) => { countryCounts[code] = (countryCounts[code] || 0) + 1; }));
        return {
          collaborator,
          items: myItems,
          hours,
          goal,
          tasks: myItems.filter((i) => i.type === "Task").length,
          bugs: myItems.filter((i) => i.type === "Bug").length,
          withHours: myItems.filter((i) => i.completedHours != null).length,
          withoutHours: myItems.filter((i) => i.completedHours == null).length,
          countryCounts,
          ...goalStatus(hours, goal)
        };
      })
      .filter((row) => !collaboratorFilter.length || collaboratorFilter.includes(row.collaborator.id))
      .filter((row) => !goalFilter.length || goalFilter.includes(row.key))
      .sort((a, b) => a.collaborator.azureName.localeCompare(b.collaborator.azureName, "pt-BR"));
  }, [devCollaborators, globallyFilteredItems, collaboratorFilter, goalFilter, goalHours]);

  const totals = useMemo(
    () => ({
      developers: hoursByCollaborator.length,
      cards: hoursByCollaborator.reduce((sum, row) => sum + row.items.length, 0),
      hours: hoursByCollaborator.reduce((sum, row) => sum + row.hours, 0),
      goal: hoursByCollaborator.reduce((sum, row) => sum + row.goal, 0),
      missing: hoursByCollaborator.reduce((sum, row) => sum + Math.max(row.goal - row.hours, 0), 0),
      extra: hoursByCollaborator.reduce((sum, row) => sum + Math.max(row.hours - row.goal, 0), 0)
    }),
    [hoursByCollaborator]
  );

  const countryCounts = useMemo(() => {
    const counts = {};
    globallyFilteredItems.forEach((item) => item.countries.forEach((code) => { counts[code] = (counts[code] || 0) + 1; }));
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [globallyFilteredItems]);

  const pendingQaCount = globallyFilteredItems.filter((item) => !item.qaCollaboratorId).length;
  const maxCountryCount = Math.max(1, ...countryCounts.map(([, count]) => count));

  const reportPeriod = period?.from && period?.to
    ? `${new Date(period.from).toLocaleDateString("pt-BR")} a ${new Date(period.to).toLocaleDateString("pt-BR")}`
    : period?.preset || "";
  const reportRows = hoursByCollaborator.map((row) => ({
    name: row.collaborator.azureName, hours: row.hours, goal: row.goal, label: row.label, tone: row.tone
  }));

  function copyExecutiveReport() {
    copyExecutiveReportText({ title: "Relatório executivo — Governança", period: reportPeriod, totals, rows: reportRows });
  }

  function downloadExecutivePdf() {
    downloadExecutiveReportPdf({
      title: "Stark Hub — Relatório Executivo de Governança",
      period: reportPeriod,
      totals,
      rows: reportRows,
      filename: `stark-hub-governanca-${new Date().toISOString().slice(0, 10)}.pdf`
    });
  }

  function copyPersonalNotice(row) {
    const withoutHours = row.items.filter((i) => i.completedHours == null);
    const withHours = row.items.filter((i) => i.completedHours != null);
    const balance = row.hours - row.goal;
    const lines = [
      `Olá, ${row.collaborator.azureName}.`,
      "Pode conferir suas horas no projeto?",
      "",
      `Total: ${row.hours}h | Esperado: ${row.goal}h | Saldo: ${balance >= 0 ? "+" : ""}${balance}h`,
      "",
      "Sem horas atribuídas:",
      ...(withoutHours.length ? withoutHours.map((i) => `${i.type.toUpperCase()} #${i.id} — ${i.title}`) : ["Nenhum."]),
      "",
      "Com horas atribuídas:",
      ...(withHours.length ? withHours.map((i) => `${i.type.toUpperCase()} #${i.id} — ${i.completedHours}h`) : ["Nenhum."])
    ];
    navigator.clipboard?.writeText(lines.join("\n"));
    setCopiedId(row.collaborator.id);
    setTimeout(() => setCopiedId((current) => (current === row.collaborator.id ? null : current)), 2000);
  }

  return (
    <div className="d-flex flex-column gap-3">
      <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
        <h3 className="mb-0">Governança {demoMode && <span className="stark-badge-demo ms-2">demo</span>}</h3>
        <div className="d-flex gap-2">
          <button className="btn btn-sm btn-outline-primary d-flex align-items-center gap-1" onClick={copyExecutiveReport}>
            <FiCopy /> Copiar relatório executivo
          </button>
          <button className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1" onClick={downloadExecutivePdf}>
            <FiFileText /> Baixar PDF
          </button>
        </div>
      </div>

      {itemsError && <div className="alert alert-danger mb-0">{itemsError}</div>}

      <div className="stark-card d-flex flex-wrap gap-2 align-items-center">
        <PeriodFilter value={period} onChange={setPeriod} />
        <MultiSelectFilter
          label="Colaborador"
          selected={collaboratorFilter}
          onChange={setCollaboratorFilter}
          options={devCollaborators.map((c) => ({ value: c.id, label: c.azureName }))}
        />
        <MultiSelectFilter
          label="País"
          selected={countryFilter}
          onChange={setCountryFilter}
          options={Object.entries(countries).map(([value, c]) => ({ value, label: `${value} - ${c.label}` }))}
        />
        <MultiSelectFilter label="Tipo" selected={typeFilter} onChange={setTypeFilter} options={[{ value: "Task", label: "Task" }, { value: "Bug", label: "Bug" }]} />
        <MultiSelectFilter
          label="Meta"
          selected={goalFilter}
          onChange={setGoalFilter}
          options={[{ value: "below", label: "Abaixo" }, { value: "met", label: "Cumprida" }, { value: "above", label: "Acima" }]}
        />
        <div className="btn-group btn-group-sm">
          {[{ v: "all", l: "Todos" }, { v: "with", l: "Com horas" }, { v: "without", l: "Sem horas" }].map((opt) => (
            <button key={opt.v} type="button" className={`btn ${hourStatus === opt.v ? "btn-secondary" : "btn-outline-secondary"}`} onClick={() => setHourStatus(opt.v)}>
              {opt.l}
            </button>
          ))}
        </div>
      </div>

      <div className="row g-3">
        {[
          ["Colaboradores filtrados", totals.developers],
          ["Cards no filtro", totals.cards],
          ["Horas registradas", `${totals.hours}h`],
          ["Meta total", `${totals.goal}h`],
          ["Horas pendentes", `${totals.missing}h`],
          ["Excedente", `+${totals.extra}h`]
        ].map(([label, value]) => (
          <div className="col-6 col-md-2" key={label}>
            <div className="stark-card">
              <span className="text-muted small">{label}</span>
              <h4 className="mb-0">{value}</h4>
            </div>
          </div>
        ))}
      </div>

      <div className="stark-card">
        <h5 className="mb-3">Horas por colaborador</h5>
        <div className="d-flex flex-column gap-3">
          {hoursByCollaborator.map((row) => {
            const expanded = expandedId === row.collaborator.id;
            const progressPercent = row.goal > 0 ? Math.min(140, (row.hours / row.goal) * 100) : 0;
            return (
              <div key={row.collaborator.id} className="border rounded p-2">
                <div className="d-flex align-items-center gap-3 flex-wrap">
                  <Avatar name={row.collaborator.azureName} color={row.collaborator.color} size={32} />
                  <div className="flex-grow-1 min-w-0">
                    <div className="d-flex justify-content-between small mb-1 flex-wrap gap-1">
                      <strong>{row.collaborator.azureName}</strong>
                      <span className="text-muted">{row.hours}h / {row.goal}h</span>
                    </div>
                    <div className="progress" style={{ height: 6 }}>
                      <div className={`progress-bar bg-${row.tone}`} style={{ width: `${progressPercent}%` }} />
                    </div>
                  </div>
                  <span className={`badge text-bg-${row.tone}`}>{row.label}</span>
                  <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => copyPersonalNotice(row)}>
                    {copiedId === row.collaborator.id ? "Copiado!" : "Copiar aviso"}
                  </button>
                  <button type="button" className="btn btn-sm btn-link" onClick={() => setExpandedId(expanded ? null : row.collaborator.id)}>
                    {expanded ? <FiChevronUp /> : <FiChevronDown />}
                  </button>
                </div>

                <div className="d-flex flex-wrap gap-3 small text-muted mt-2">
                  <span>Cards: <strong className="text-body">{row.items.length}</strong></span>
                  <span>Tasks: <strong className="text-body">{row.tasks}</strong></span>
                  <span>Bugs: <strong className="text-body">{row.bugs}</strong></span>
                  <span>Com horas: <strong className="text-body">{row.withHours}</strong></span>
                  <span>Sem horas: <strong className="text-body">{row.withoutHours}</strong></span>
                </div>

                {expanded && (
                  <div className="d-flex flex-column gap-1 mt-2 pt-2 border-top">
                    {row.items.map((item) => (
                      <div key={item.id} className="d-flex align-items-center justify-content-between small">
                        <span className="d-flex align-items-center gap-2 min-w-0">
                          <WorkItemTypeIcon type={item.type} />
                          <span className="text-truncate">#{item.id} — {item.title}</span>
                        </span>
                        <span className="text-muted">{item.completedHours != null ? `${item.completedHours}h` : "sem horas"}</span>
                      </div>
                    ))}
                    {!row.items.length && <span className="text-muted small">Nenhum card no filtro atual.</span>}
                  </div>
                )}
              </div>
            );
          })}
          {!hoursByCollaborator.length && <span className="text-muted small">Nenhum colaborador para os filtros atuais.</span>}
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

      <p className="text-muted small mb-0">
        Feature flags e meta padrão de horas agora ficam em Configurações. Itens sem QA responsável no filtro atual: <strong>{pendingQaCount}</strong>
      </p>
    </div>
  );
}
