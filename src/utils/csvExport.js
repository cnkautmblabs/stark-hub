import { compactSprintLabel } from "./sprints.js";
import { csvCell, evidenceEnvironments, normalizeResult } from "./workbench/formatters.js";

export function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

export function downloadCsv(filename, headers, rows) {
  const csvRows = [headers, ...(rows || [])];
  const content = "\uFEFF" + csvRows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function exportWorkItemsCsv(filenamePrefix, items = []) {
  downloadCsv(`${filenamePrefix}-${dateStamp()}.csv`, [
    "ID",
    "Tipo",
    "Titulo",
    "Status",
    "Ambiente",
    "Paises",
    "Sprint",
    "Assigned",
    "Tested by",
    "Horas concluidas",
    "Horas restantes",
    "Tags",
    "Ultimo resultado"
  ], items.map((item) => [
    item.id,
    item.type,
    item.title,
    item.state,
    item.env,
    (item.countries || []).join("|"),
    compactSprintLabel(item.sprint || item.iteration),
    item.assigneeName || item.assignedTo || "",
    item.qaName || item.qaResponsible || item.qaCollaboratorId || "",
    item.completedHours ?? "",
    item.remainingHours ?? "",
    (item.tags || []).join("|"),
    item.lastTestResult || ""
  ]));
}

export function exportEvidenceCsv(filenamePrefix, records = []) {
  downloadCsv(`${filenamePrefix}-${dateStamp()}.csv`, [
    "Data",
    "Work Item",
    "Tipo",
    "Titulo",
    "QA",
    "Resultado",
    "Ambientes",
    "Nota",
    "Origem"
  ], records.map((entry) => [
    entry.createdAt || "",
    entry.workItemId || entry.item?.id || "",
    entry.item?.type || "",
    entry.item?.title || "",
    entry.authorName || entry.qaName || "",
    normalizeResult(entry.result || entry.status),
    evidenceEnvironments(entry).join("|"),
    entry.note || entry.context || "",
    entry.source || ""
  ]));
}
