export const evidenceEnvironmentOrder = ["DEV", "QA", "BETA", "PROD"];

// Uma pessoa pode ter mais de uma funcao (ex.: Dev cadastrado + Admin) — os
// selos de papel devem mostrar TODAS as que se aplicam, nao só uma. So os 5
// niveis reais (QA/Dev/Gestao/Gerente/Admin); nunca um rotulo solto tipo
// "Desenvolvimento"/"Trilha de testes" que so duplicava o que o selo de
// papel ja mostra.
export function collaboratorRoleLevels(person) {
  if (!person) return [];
  const levels = [];
  if (person.accessLevel === "gerente") levels.push("gerente");
  else if (person.isManagement || person.accessLevel === "gestao") levels.push("gestao");
  if (person.isDev || person.accessLevel === "dev") levels.push("dev");
  if (person.isQa || person.accessLevel === "qa") levels.push("qa");
  if (person.isAdmin) levels.push("admin");
  if (!levels.length && person.accessLevel === "pending") levels.push("pending");
  return Array.from(new Set(levels));
}

// Remove acentos e normaliza espacos alem de minusculizar — o nome do
// assignee que vem do Azure DevOps e o azureName cadastrado no Stark Hub
// podem ter o MESMO nome com acentuacao unicode composta de formas
// diferentes (NFC x NFD) ou variar em "João" x "Joao", o que fazia o
// indice de colaboradores nao bater e o assignee sumir do FYI mesmo
// existindo um colaborador cadastrado com aquele nome.
export function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

// Nome de uma pessoa pode aparecer em ordens diferentes entre Azure/Slack
// ("Sobrenome, Nome" vs "Nome Sobrenome") — gera as variacoes plausiveis pra
// nao depender de bater a string exata.
export function identityNameVariants(value) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  const variants = [raw];
  const parenthesized = raw.match(/^([^()]+)\s*\(([^()]+)\)/);
  if (parenthesized) {
    variants.push(`${parenthesized[2]} ${parenthesized[1]}`);
    variants.push(`${parenthesized[1]} ${parenthesized[2]}`);
  }
  const parts = raw.replace(/[()]/g, " ").split(/\s+/).filter(Boolean);
  if (parts.length === 2) variants.push(`${parts[1]} ${parts[0]}`);
  if (parts.length > 2) variants.push(`${parts[parts.length - 1]} ${parts.slice(0, -1).join(" ")}`);
  return variants;
}

// Indexa colaboradores por TODO nome/apelido conhecido (azureName, slackName,
// aliases cadastrados e variacoes de ordem "Sobrenome, Nome"), nao apenas o
// azureName exato — evita "assignee nao encontrado" (sem FYI/mencao no
// Slack) so porque o nome do Azure nao bate 100% com o azureName cadastrado.
export function buildCollaboratorNameIndex(collaborators) {
  const map = new Map();
  (collaborators || []).forEach((person) => {
    const names = [
      person.azureName,
      ...identityNameVariants(person.azureName),
      person.slackName,
      ...identityNameVariants(person.slackName),
      ...(person.aliases || [])
    ].filter(Boolean);
    names.forEach((name) => {
      const key = normalize(name);
      if (key && !map.has(key)) map.set(key, person);
    });
  });
  return map;
}

export function findCollaboratorByName(index, rawName) {
  if (!rawName) return null;
  const direct = index.get(normalize(rawName));
  if (direct) return direct;
  return identityNameVariants(rawName).map((variant) => index.get(normalize(variant))).find(Boolean) || null;
}

export function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

// Estagios do fluxo de QA reconhecidos pelo Quality Board — fonte unica de
// verdade tambem usada pela Home (atualizacoes recentes) pra decidir se um
// item "entrou em teste" de verdade, em vez de duplicar a lista de aliases.
export const qaStatusConfig = {
  inQa: { label: "In QA", color: "#2563eb", bg: "#eff6ff", icon: "bi-check2-circle" },
  inBeta: { label: "In BETA", color: "#7c3aed", bg: "#f5f3ff", icon: "bi-flask" },
  readyBeta: { label: "Ready Beta", color: "#d97706", bg: "#fffbeb", icon: "bi-rocket-takeoff" },
  hmgCnk: { label: "HMG CNK", color: "#0891b2", bg: "#ecfeff", icon: "bi-flask" },
  readyProd: { label: "Ready Prod", color: "#16a34a", bg: "#f0fdf4", icon: "bi-shield-check" }
};

export const qaStatusOrder = ["inQa", "inBeta", "readyBeta", "hmgCnk", "readyProd"];

export function qaStatusInfo(state) {
  const key = normalize(state).replace(/[\s_-]+/g, "");
  const aliases = {
    inqa: "inQa",
    qa: "inQa",
    inbeta: "inBeta",
    beta: "inBeta",
    readytobeta: "readyBeta",
    readybeta: "readyBeta",
    readyforbeta: "readyBeta",
    hmgcnk: "hmgCnk",
    readytoprod: "readyProd",
    readyprod: "readyProd",
    readyforprod: "readyProd",
    readytoproduction: "readyProd"
  };
  const statusKeyValue = aliases[key] || "";
  return statusKeyValue ? { key: statusKeyValue, ...qaStatusConfig[statusKeyValue] } : { key: "", label: state || "-", color: "#64748b", bg: "#f8fafc", icon: "bi-list-check" };
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

function stripEvidenceHtml(value) {
  return String(value || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEvidenceSvgText(src) {
  if (!/^data:image\/svg\+xml/i.test(src || "")) return "";
  try {
    const payload = src.split(",", 2)[1] || "";
    const atobFn = globalThis.atob;
    if (!atobFn && /;base64/i.test(src)) return "";
    const decoded = /;base64/i.test(src)
      ? decodeURIComponent(escape(atobFn(payload)))
      : decodeURIComponent(payload);
    return stripEvidenceHtml(decoded);
  } catch {
    return "";
  }
}

function evidenceTextWithImageLabels(value) {
  return String(value || "").replace(/<img\b[^>]*>/gi, (tag) => {
    const alt = tag.match(/\balt=(["'])(.*?)\1/i)?.[2] || "";
    const title = tag.match(/\btitle=(["'])(.*?)\1/i)?.[2] || "";
    const src = tag.match(/\bsrc=(["'])(.*?)\1/i)?.[2] || "";
    return ` ${alt} ${title} ${decodeEvidenceSvgText(src)} `;
  });
}

const evidenceMarkerPattern = /TEST\s+APPROVED\s+IN|TEST\s+FAILED\s+IN|TESTING\s+LIMITATION\s+IN/i;

export function evidenceHeadingText(entryOrText) {
  const raw = typeof entryOrText === "string"
    ? entryOrText
    : entryOrText?.html || entryOrText?.text || entryOrText?.note || "";
  const text = stripEvidenceHtml(evidenceTextWithImageLabels(raw)).replace(/\s+/g, " ");
  const marker = text.match(evidenceMarkerPattern);
  if (!marker) return "";
  return text
    .slice(marker.index || 0, (marker.index || 0) + 180)
    .split(/EVIDENCE|EVIDENCIA|MORE DETAILS|CONTEXT|CONTEXTO|BREAKPOINT|PROXIMO|NEXT STATUS/i)[0]
    .trim();
}

export function isQaEvidenceEntry(entry) {
  if (!entry?.html && !entry?.text && !entry?.note) return true;
  return Boolean(evidenceHeadingText(entry));
}

function normalizedEvidenceSignatureText(entry) {
  const raw = entry?.html || entry?.text || entry?.note || "";
  return stripEvidenceHtml(evidenceTextWithImageLabels(raw))
    .toUpperCase()
    .replace(/\d{1,2}\/\d{1,2}\/\d{4}[,\s]+\d{1,2}:\d{2}(?::\d{2})?/g, "")
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 900);
}

export function evidenceDedupeKey(entry) {
  const result = normalizeResult(entry?.result || entry?.status);
  const envs = evidenceEnvironments(entry).slice().sort().join("/");
  const author = String(entry?.authorEmail || entry?.authorName || entry?.author || "").toLowerCase().trim();
  const images = Array.from(String(entry?.html || "").matchAll(/<img\b[^>]*\bsrc=(["'])(.*?)\1/gi))
    .map((match) => match[2])
    .filter((src) => !/^data:image\/svg\+xml/i.test(src))
    .slice(0, 4)
    .join("|");
  return [entry?.workItemId || "", result, envs, author, normalizedEvidenceSignatureText(entry), images].join("::");
}

export function evidenceEnvironments(entry) {
  const heading = evidenceHeadingText(entry);
  if (heading) {
    const normalizedHeading = heading
      .toUpperCase()
      .replace(/READY\s*TO\s*/g, "")
      .replace(/:(DEV|QA|BETA|PROD)-TAG:/g, " $1 ")
      .replace(/[\-_]/g, " ");
    const found = evidenceEnvironmentOrder.filter((environment) =>
      new RegExp(`(^|[^A-Z])${environment}([^A-Z]|$)`, "i").test(normalizedHeading)
    );
    if (found.length) return found;
  }
  const values = Array.isArray(entry?.environments) && entry.environments.length
    ? entry.environments
    : entry?.environment || entry?.env
      ? [entry.environment || entry.env]
      : [];
  return Array.from(new Set(values.map(normalizeEvidenceEnvironment).filter((value) => evidenceEnvironmentOrder.includes(value))));
}

export function evidenceRecordHasEnvironment(entry, environment) {
  return evidenceEnvironments(entry).includes(normalizeEvidenceEnvironment(environment));
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
