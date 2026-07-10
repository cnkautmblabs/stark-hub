import { useMemo } from "react";
import { Bar, BarChart, Cell, LabelList, Tooltip, XAxis, YAxis, ResponsiveContainer } from "recharts";
import { useAuth } from "../../../contexts/AuthContext.jsx";
import { useWorkItems } from "../../../hooks/useWorkItems.js";
import { useCollaborators } from "../../../hooks/useCollaborators.js";
import { useTestEvidence } from "../../../hooks/useTestEvidence.js";
import { usePersistentState } from "../../../hooks/usePersistentState.js";
import { compactSprintLabel } from "../../../utils/sprints.js";
import { dateStamp, downloadCsv } from "../../../utils/csvExport.js";
import { buildCollaboratorNameIndex, evidenceDedupeKey, evidenceEnvironments, findCollaboratorByName, isQaEvidenceEntry, normalizeResult } from "../../../utils/workbench/formatters.js";
import { AvatarDot, ChartSkeleton, FilterCombobox, Kpi, KpiSkeleton, RechartsTooltip, WorkbenchCardSkeleton, WorkbenchHeader } from "../ui/WorkbenchPrimitives.jsx";

const monthOrder = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// Sprints do Stark Hub sao rotuladas "Mon26" (mes + 2 digitos do ano) — nao
// da pra ordenar como string (Jan26 < Dec26 alfabeticamente, mas Dec vem
// depois). Decompoe em ano*12+mes para ordenar/cortar o range corretamente.
function sprintSortValue(label) {
  const match = String(label || "").match(/^([A-Za-z]{3})(\d{2})$/);
  if (!match) return 0;
  const monthIndex = monthOrder.indexOf(match[1].toLowerCase());
  const year = 2000 + Number(match[2]);
  return year * 12 + (monthIndex === -1 ? 0 : monthIndex);
}

const deliveredTypes = ["Feature", "User Story", "Task", "Bug"];

export function ManagementDashboardWorkbench() {
  const { profile, demoMode } = useAuth();
  const { items, loading: itemsLoading } = useWorkItems({ includeClosed: true });
  const { collaborators } = useCollaborators();
  const { evidence, reload: reloadEvidence } = useTestEvidence();
  const [sprintFrom, setSprintFrom] = usePersistentState("starkHubFilters:management:sprintFrom", "");
  const [sprintTo, setSprintTo] = usePersistentState("starkHubFilters:management:sprintTo", "");

  const sprintOptions = useMemo(() => {
    const unique = Array.from(new Set(items.map((item) => compactSprintLabel(item.sprint || item.iteration)).filter(Boolean)));
    return unique.sort((a, b) => sprintSortValue(a) - sprintSortValue(b));
  }, [items]);

  const defaultRange = useMemo(() => sprintOptions.slice(-6), [sprintOptions]);
  const fromValue = sprintFrom || defaultRange[0] || "";
  const toValue = sprintTo || defaultRange[defaultRange.length - 1] || "";
  const selectedSprints = useMemo(() => {
    const fromIndex = sprintOptions.indexOf(fromValue);
    const toIndex = sprintOptions.indexOf(toValue);
    if (fromIndex === -1 || toIndex === -1) return sprintOptions;
    return sprintOptions.slice(Math.min(fromIndex, toIndex), Math.max(fromIndex, toIndex) + 1);
  }, [sprintOptions, fromValue, toValue]);

  const filteredItems = useMemo(
    () => items.filter((item) => selectedSprints.includes(compactSprintLabel(item.sprint || item.iteration))),
    [items, selectedSprints]
  );

  const byId = useMemo(() => new Map(collaborators.map((person) => [person.id, person])), [collaborators]);

  const deliveryStats = useMemo(() => {
    const relevant = filteredItems.filter((item) => deliveredTypes.includes(item.type));
    const delivered = relevant.filter((item) => item.env === "prod");
    return {
      total: relevant.length,
      delivered: delivered.length,
      rate: relevant.length ? Math.round((delivered.length / relevant.length) * 100) : 0
    };
  }, [filteredItems]);

  const featuresPerSprint = useMemo(() => {
    return selectedSprints.map((sprint) => {
      const sprintItems = filteredItems.filter((item) => item.type === "Feature" && compactSprintLabel(item.sprint || item.iteration) === sprint);
      return { sprint, total: sprintItems.length, delivered: sprintItems.filter((item) => item.env === "prod").length };
    });
  }, [filteredItems, selectedSprints]);

  const bugsPerSprint = useMemo(() => {
    return selectedSprints.map((sprint) => ({
      sprint,
      total: filteredItems.filter((item) => item.type === "Bug" && compactSprintLabel(item.sprint || item.iteration) === sprint).length
    }));
  }, [filteredItems, selectedSprints]);

  // Indice por nome (azureName/slackName/aliases/variacoes de ordem) — sem
  // isso, qualquer diferenca de formatacao entre o assignee exibido pelo
  // Azure e o azureName cadastrado (acento, ordem "Sobrenome, Nome") fazia o
  // item nao bater com NENHUM Dev, e a soma de Tasks/Bugs por pessoa dava
  // zero mesmo com itens de verdade atribuidos a ela.
  const devNameIndex = useMemo(() => buildCollaboratorNameIndex(collaborators), [collaborators]);

  const workItemTypeCounters = [
    { key: "epics", label: "Epic", match: "epic" },
    { key: "features", label: "Feature", match: "feature" },
    { key: "userStories", label: "US", match: "user story" },
    { key: "tasks", label: "Task", match: "task" },
    { key: "bugs", label: "Bug", match: "bug" },
    { key: "testCases", label: "Test Case", match: "test case" }
  ];

  const devDeliveries = useMemo(() => {
    const devs = collaborators.filter((person) => person.isDev);
    return devs.map((dev) => {
      const own = filteredItems.filter((item) => item.assigneeId === dev.id || findCollaboratorByName(devNameIndex, item.assigneeName)?.id === dev.id);
      const counts = Object.fromEntries(workItemTypeCounters.map(({ key, match }) => [key, own.filter((item) => String(item.type || "").toLowerCase() === match).length]));
      return { id: dev.id, name: dev.azureName || "Sem nome", color: dev.color, imageUrl: dev.imageUrl || dev.avatarUrl || "", ...counts, total: own.length };
    }).filter((row) => row.total > 0).sort((a, b) => b.total - a.total);
  }, [filteredItems, collaborators, devNameIndex]);

  const testMetrics = useMemo(() => {
    const localByItem = new Map();
    evidence.forEach((entry) => {
      const id = Number(entry.workItemId);
      if (!localByItem.has(id)) localByItem.set(id, []);
      localByItem.get(id).push(entry);
    });
    const relevant = filteredItems.flatMap((item) => {
      const discussion = (item.discussionEvidence || []).filter(isQaEvidenceEntry).map((entry) => ({ ...entry, workItemId: item.id }));
      return discussion.length ? discussion : localByItem.get(Number(item.id)) || [];
    }).filter((entry) => evidenceEnvironments(entry).length);
    const uniqueRelevant = Array.from(relevant.reduce((map, entry) => {
      const key = evidenceDedupeKey(entry);
      const current = map.get(key);
      if (!current || String(entry.createdAt || "").localeCompare(String(current.createdAt || "")) > 0) map.set(key, entry);
      return map;
    }, new Map()).values());
    const pass = uniqueRelevant.filter((entry) => normalizeResult(entry.result || entry.status) === "pass").length;
    const fail = uniqueRelevant.filter((entry) => normalizeResult(entry.result || entry.status) === "fail").length;
    const limitation = uniqueRelevant.filter((entry) => normalizeResult(entry.result || entry.status) === "limitation").length;
    const total = pass + fail + limitation;
    return { pass, fail, limitation, total, passRate: total ? Math.round((pass / total) * 100) : 0 };
  }, [filteredItems, evidence]);

  const qaWorkload = useMemo(() => {
    const qaPeople = collaborators.filter((person) => person.isQa);
    return qaPeople.map((qa) => ({
      id: qa.id,
      name: qa.azureName || "Sem nome",
      color: qa.color,
      imageUrl: qa.imageUrl || qa.avatarUrl || "",
      count: filteredItems.filter((item) => item.qaCollaboratorId === qa.id && ["Bug", "User Story"].includes(item.type)).length
    })).filter((row) => row.count > 0).sort((a, b) => b.count - a.count);
  }, [filteredItems, collaborators]);

  const maxFeatureValue = Math.max(1, ...featuresPerSprint.map((row) => row.total));
  const maxBugValue = Math.max(1, ...bugsPerSprint.map((row) => row.total));
  const loading = itemsLoading;

  function exportManagementCsv() {
    const rows = [
      ["KPI", "Delivery rate", `${deliveryStats.rate}%`],
      ["KPI", "Features entregues", featuresPerSprint.reduce((sum, row) => sum + row.delivered, 0)],
      ["KPI", "Bugs no periodo", bugsPerSprint.reduce((sum, row) => sum + row.total, 0)],
      ["KPI", "Pass rate testes", `${testMetrics.passRate}%`],
      ["KPI", "Itens no periodo", deliveryStats.total],
      ...featuresPerSprint.map((row) => ["Feature por sprint", row.sprint, `${row.delivered}/${row.total}`]),
      ...bugsPerSprint.map((row) => ["Bugs por sprint", row.sprint, row.total]),
      ...devDeliveries.map((row) => ["Entrega por Dev", row.name, `Epic ${row.epics}; Feature ${row.features}; US ${row.userStories}; Task ${row.tasks}; Bug ${row.bugs}; Test Case ${row.testCases}; Total ${row.total}`]),
      ...qaWorkload.map((row) => ["Carga por QA", row.name, row.count]),
      ["Testes", "Approved", testMetrics.pass],
      ["Testes", "Fail", testMetrics.fail],
      ["Testes", "Limitation", testMetrics.limitation]
    ];
    downloadCsv(`gestao-projeto-${dateStamp()}.csv`, ["Secao", "Item", "Valor"], rows);
  }

  return (
    <section className="mbw-page mb-mgmt-dashboard">
      <WorkbenchHeader
        kicker="Gerenciamento"
        title="Dash executiva"
        subtitle="Metricas agrupadas do projeto: entregas, QA, dev e governanca — multiplas sprints."
        demoMode={demoMode}
        actions={<><button type="button" className="mb-mgmt-refresh" onClick={exportManagementCsv}><i className="bi bi-download" /> CSV</button><button type="button" className="mb-mgmt-refresh" onClick={reloadEvidence}><i className="bi bi-arrow-clockwise" /> Atualizar</button></>}
      />

      <div className="mb-mgmt-filters">
        <FilterCombobox label="Sprint inicial" options={sprintOptions.map((value) => ({ value, label: value }))} values={fromValue ? [fromValue] : []} multiple={false} onChange={(value) => setSprintFrom(value || "")} />
        <FilterCombobox label="Sprint final" options={sprintOptions.map((value) => ({ value, label: value }))} values={toValue ? [toValue] : []} multiple={false} onChange={(value) => setSprintTo(value || "")} />
        <span className="mb-mgmt-range-hint">{selectedSprints.length} sprint(s) no periodo: {selectedSprints.join(", ") || "-"}</span>
      </div>

      <div className="mb-mgmt-kpis">
        {loading ? <KpiSkeleton count={5} /> : (
          <>
            <Kpi icon="bi-rocket-takeoff" label="Delivery rate" value={`${deliveryStats.rate}%`} color="#16a34a" />
            <Kpi icon="bi-flag-fill" label="Features entregues" value={featuresPerSprint.reduce((sum, row) => sum + row.delivered, 0)} color="#2563eb" />
            <Kpi icon="bi-bug-fill" label="Bugs no periodo" value={bugsPerSprint.reduce((sum, row) => sum + row.total, 0)} color="#dc2626" />
            <Kpi icon="bi-check2-circle" label="Pass rate (testes)" value={`${testMetrics.passRate}%`} color="#7c3aed" />
            <Kpi icon="bi-clipboard2-data" label="Itens no periodo" value={deliveryStats.total} color="#0ea5e9" />
          </>
        )}
      </div>

      <div className="mb-mgmt-grid">
        <section className="mb-mgmt-card">
          <header><strong>Entregas de Feature por sprint</strong><small>Total x entregue (env prod)</small></header>
          {loading ? <ChartSkeleton rows={6} /> : featuresPerSprint.length ? (
            <ResponsiveContainer width="100%" height={Math.max(160, featuresPerSprint.length * 34)}>
              <BarChart data={featuresPerSprint} layout="vertical" margin={{ top: 4, right: 30, bottom: 4, left: 4 }}>
                <XAxis type="number" hide domain={[0, maxFeatureValue]} />
                <YAxis type="category" dataKey="sprint" width={56} tick={{ fontSize: 11, fill: "var(--starkMuted)" }} axisLine={false} tickLine={false} />
                <Tooltip content={<RechartsTooltip />} cursor={{ fill: "var(--starkSurfaceAlt)" }} />
                <Bar dataKey="total" name="Total" fill="#cbd5e1" radius={[0, 6, 6, 0]} barSize={10} />
                <Bar dataKey="delivered" name="Entregue" fill="#16a34a" radius={[0, 6, 6, 0]} barSize={10}>
                  <LabelList dataKey="delivered" position="right" style={{ fill: "var(--starkMuted)", fontSize: 11 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <span className="mb-mgmt-empty">Sem dados no periodo.</span>}
        </section>

        <section className="mb-mgmt-card">
          <header><strong>Bugs por sprint</strong><small>Volume total de Bug work items</small></header>
          {loading ? <ChartSkeleton rows={6} /> : bugsPerSprint.length ? (
            <ResponsiveContainer width="100%" height={Math.max(160, bugsPerSprint.length * 34)}>
              <BarChart data={bugsPerSprint} layout="vertical" margin={{ top: 4, right: 30, bottom: 4, left: 4 }}>
                <XAxis type="number" hide domain={[0, maxBugValue]} />
                <YAxis type="category" dataKey="sprint" width={56} tick={{ fontSize: 11, fill: "var(--starkMuted)" }} axisLine={false} tickLine={false} />
                <Tooltip content={<RechartsTooltip />} cursor={{ fill: "var(--starkSurfaceAlt)" }} />
                <Bar dataKey="total" name="Bugs" fill="#dc2626" radius={[0, 6, 6, 0]}>
                  <LabelList dataKey="total" position="right" style={{ fill: "var(--starkMuted)", fontSize: 11 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <span className="mb-mgmt-empty">Sem dados no periodo.</span>}
        </section>

        <section className="mb-mgmt-card">
          <header><strong>Entregas por Dev</strong><small>Epic, Feature, US, Task, Bug e Test Case no periodo</small></header>
          {loading ? <WorkbenchCardSkeleton rows={4} /> : (
            <div className="mb-mgmt-dev-table cols-wide">
              <div className="mb-mgmt-dev-head cols-wide"><span>Dev</span>{workItemTypeCounters.map(({ key, label }) => <span key={key}>{label}</span>)}<span>Total</span></div>
              {devDeliveries.map((row) => (
                <div key={row.id} className="mb-mgmt-dev-row cols-wide">
                  <span><AvatarDot person={row} compact /> {row.name}</span>
                  {workItemTypeCounters.map(({ key }) => <span key={key}>{row[key]}</span>)}
                  <strong>{row.total}</strong>
                </div>
              ))}
              {!devDeliveries.length && <span className="mb-mgmt-empty">Sem dados no periodo.</span>}
            </div>
          )}
        </section>

        <section className="mb-mgmt-card">
          <header><strong>Metricas de testes</strong><small>Resultados registrados no periodo</small></header>
          {loading ? <ChartSkeleton rows={3} /> : testMetrics.total ? (
            <>
              <div className="mb-mgmt-test-summary">
                <span className="approved">{testMetrics.pass} Approved</span>
                <span className="fail">{testMetrics.fail} Fail</span>
                <span className="limitation">{testMetrics.limitation} Limitation</span>
              </div>
              <ResponsiveContainer width="100%" height={150}>
                <BarChart data={[{ key: "pass", name: "Approved", value: testMetrics.pass }, { key: "fail", name: "Fail", value: testMetrics.fail }, { key: "limitation", name: "Limitation", value: testMetrics.limitation }]} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--starkMuted)" }} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip content={<RechartsTooltip />} cursor={{ fill: "var(--starkSurfaceAlt)" }} />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                    <Cell fill="#16a34a" />
                    <Cell fill="#dc2626" />
                    <Cell fill="#d97706" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </>
          ) : <span className="mb-mgmt-empty">Sem evidencias no periodo.</span>}
        </section>

        <section className="mb-mgmt-card">
          <header><strong>Carga por QA</strong><small>Cards com QA responsavel no periodo</small></header>
          {loading ? <WorkbenchCardSkeleton rows={3} /> : (
            <div className="mb-mgmt-dev-table">
              <div className="mb-mgmt-dev-head"><span>QA</span><span /><span /><span>Cards</span></div>
              {qaWorkload.map((row) => (
                <div key={row.id} className="mb-mgmt-dev-row">
                  <span><AvatarDot person={row} compact /> {row.name}</span>
                  <span /><span />
                  <strong>{row.count}</strong>
                </div>
              ))}
              {!qaWorkload.length && <span className="mb-mgmt-empty">Sem dados no periodo.</span>}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
