export const evidenceEnvironmentOrder = ["DEV", "QA", "BETA", "PROD"];

export function normalize(value) {
  return String(value || "").toLowerCase();
}

export function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export function itemAgeDays(item) {
  const raw = item.updatedAt || item.changedDate || item.createdDate;
  const time = Date.parse(raw || "");
  if (!Number.isFinite(time)) return 0;
  return Math.max(0, Math.floor((Date.now() - time) / 86400000));
}

export function evidenceResultInfo(result) {
  if (result === "pass" || result === "approved") return { label: "Approved", icon: "bi-check-lg", className: "approved" };
  if (result === "fail") return { label: "Fail", icon: "bi-x-lg", className: "fail" };
  if (result === "limitation") return { label: "Limitation", icon: "bi-exclamation-triangle-fill", className: "limitation" };
  return { label: "Pending", icon: "bi-dash-lg", className: "pending" };
}

export function evidenceEnv(entry) {
  return String(entry.environment || entry.env || "N/A").toUpperCase();
}

export function normalizeResult(result) {
  const key = normalize(result);
  if (["approved", "approve", "pass", "passed", "ok"].includes(key)) return "pass";
  if (["failed", "failure"].includes(key)) return "fail";
  if (["limitation", "limited", "blocker"].includes(key)) return "limitation";
  return key || "pending";
}

export function normalizeEvidenceEnvironment(value) {
  const key = String(value || "").trim().toUpperCase();
  if (key === "READY BETA") return "BETA";
  if (key === "READY PROD") return "PROD";
  return evidenceEnvironmentOrder.includes(key) ? key : key || "N/A";
}

export function isoDateLocal(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function evidenceDateKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (br) return `${br[3]}-${String(br[2]).padStart(2, "0")}-${String(br[1]).padStart(2, "0")}`;
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return isoDateLocal(parsed);
  return "";
}

export function isEvidenceInsideRange(entry, from, to) {
  const key = evidenceDateKey(entry?.createdAt || entry?.createdDate);
  if (!key) return true;
  if (from && key < from) return false;
  if (to && key > to) return false;
  return true;
}

export function evidenceDateRangeForPreset(preset) {
  const end = new Date();
  const start = new Date(end);
  if (preset === "today") {
    return { from: isoDateLocal(end), to: isoDateLocal(end) };
  }
  if (preset === "week") {
    start.setDate(end.getDate() - 6);
    return { from: isoDateLocal(start), to: isoDateLocal(end) };
  }
  start.setDate(end.getDate() - 29);
  return { from: isoDateLocal(start), to: isoDateLocal(end) };
}

export function resultInfo(result) {
  const key = normalizeResult(result);
  const map = {
    pass: { label: "Approved", iconClass: "bi-check-lg", className: "approved" },
    fail: { label: "Fail", iconClass: "bi-x-lg", className: "fail" },
    limitation: { label: "Limitation", iconClass: "bi-exclamation-triangle-fill", className: "limitation" }
  };
  return map[key] || { label: "Pending", iconClass: "bi-question-lg", className: "pending" };
}

export function normalizeFilterClass(value) {
  return String(value || "all").toLowerCase().replace(/\s+/g, "-");
}

export function formatHours(value) {
  const number = Number(value || 0);
  return `${Number.isInteger(number) ? number : number.toFixed(1).replace(/\.0$/, "")}h`;
}

export function shortName(value) {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] || "N/A";
  return `${parts[0]} ${parts[parts.length - 1]}`;
}
