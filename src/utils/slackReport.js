import { countries as countryCatalog, environments as environmentCatalog } from "./constants.js";

// Mensagens no formato usado pelo stark-hub-script (referencia visual/textual
// enviada pelo usuario): tags de emoji por tipo de work item (:bug-tag:,
// :task-tag:, etc.) e aviso de horas por colaborador pronto para copiar ou
// enviar via Slack incoming webhook.
export function workItemSlackTag(type) {
  const normalized = String(type || "").trim().toLowerCase();
  if (normalized === "bug") return ":bug-tag:";
  if (normalized === "task") return ":task-tag:";
  if (normalized === "user story" || normalized === "userstory") return ":us-tag:";
  if (normalized === "feature") return ":feat-tag:";
  if (normalized === "epic") return ":epic-tag:";
  if (normalized === "test case" || normalized === "testcase") return ":test-tag:";
  return `:${normalized.replace(/\s+/g, "-") || "workitem"}-tag:`;
}

function mention(person) {
  return person?.slackMemberId ? `<@${person.slackMemberId}>` : person?.slackId ? `<@${person.slackId}>` : person?.slackName || person?.azureName || "";
}

// Fiel ao formatSlackMentionToken do userscript legado: sem member ID real
// nao existe fallback por nome — sem isso a mencao nao "clica" no Slack.
export function legacyMention(person) {
  const memberId = person?.slackMemberId || person?.slackId;
  return memberId ? `<@${memberId}>` : "";
}

export function buildQaResultSlackText({ item, resultLabel, environments = [], countries = [], breakpoints = [], context = "", nextState = "", authorName = "", assignee, qaResponsible, fyi = [], attachments = [] }) {
  const assigneeMention = mention(assignee);
  const qaMention = mention(qaResponsible);
  const fixedMentions = fyi.map(mention).filter(Boolean);
  return [
    `*Resultado de teste — Stark Hub*`,
    `${workItemSlackTag(item.type)} *${String(item.type || "Work Item").toUpperCase()}${item.id}* — ${item.title}`,
    `Resultado: *${resultLabel}*`,
    environments.length ? `Ambiente(s): ${environments.join(", ")}` : null,
    countries.length ? `Pais(es): ${countries.join(", ")}` : null,
    breakpoints.length ? `Breakpoint(s): ${breakpoints.join(", ")}` : null,
    nextState ? `Proximo status: ${nextState}` : null,
    assigneeMention ? `Responsavel Azure: ${assigneeMention}` : null,
    qaMention ? `QA responsavel: ${qaMention}` : null,
    authorName ? `Registrado por: ${authorName}` : null,
    context ? `Contexto: ${context}` : null,
    fixedMentions.length ? `FYI: ${fixedMentions.join(" ")}` : null,
    attachments.length ? ["", "*Anexos:*", ...attachments.map((url) => `• ${url}`)].join("\n") : null
  ].filter(Boolean).join("\n");
}

const qaResultTemplates = {
  pass: { label: "Pass", title: "TEST APPROVED IN", slackTitle: "TEST APPROVED IN", color: "rgb(15, 92, 26)", slackIcon: "✓", defaultBody: "<p><strong>EVIDENCE(S)</strong></p>" },
  fail: { label: "Fail", title: "TEST FAILED IN", slackTitle: "TEST FAILED IN", color: "rgb(163, 21, 21)", slackIcon: ":x:", defaultBody: "<p><strong>More details on task:</strong></p>" },
  limitation: { label: "Limitation", title: "TESTING LIMITATION IN", slackTitle: "TESTING LIMITATION IN", color: "rgb(0, 90, 158)", slackIcon: ":warning:", defaultBody: "<p><strong>Context:</strong></p><p>Client test and approval is required due to testing limitations in the Beta/PRD environment, which relies on payment in the local currency.</p>" }
};

const slackEnvLabels = { DEV: ":dev-tag:", QA: ":qa-tag:", BETA: ":beta-tag:", PROD: ":prod-tag:" };
const slackCountryFlags = { LT: ":earth_americas:", BR: ":flag-br:", AR: ":flag-ar:", BO: ":flag-bo:", CL: ":flag-cl:", PE: ":flag-pe:", PY: ":flag-py:" };

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function escapeSlackLinkText(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\|/g, "¦");
}

function normalizeEnv(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeCountry(value) {
  return String(value || "").trim().toUpperCase();
}

function envPillHtml(env) {
  const key = normalizeEnv(env);
  const info = environmentCatalog[key.toLowerCase()] || { label: key, background: "#e2e8f0", color: "#0f172a" };
  return `<span style="display:inline-block;vertical-align:middle;margin-left:5px;padding:2px 9px;border-radius:999px;background:${info.background};color:${info.color};font-weight:700;font-size:11px;line-height:16px;">${escapeHtml(info.label || key)}</span>`;
}

function countryPillHtml(country) {
  const key = normalizeCountry(country);
  const info = countryCatalog[key];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="58" height="22" viewBox="0 0 58 22"><rect width="58" height="22" rx="11" fill="#f8fafc"/><rect x=".5" y=".5" width="57" height="21" rx="10.5" fill="none" stroke="#d7dde8"/><rect x="7" y="6" width="18" height="10" rx="2" fill="${info?.iso2 ? "#dbeafe" : "#e0f2fe"}"/><text x="16" y="14" text-anchor="middle" font-family="Segoe UI,Arial" font-size="7" font-weight="800" fill="#005a9e">${escapeHtml(key)}</text><text x="39" y="14" text-anchor="middle" font-family="Segoe UI,Arial" font-size="11" font-weight="800" fill="#111827">${escapeHtml(key)}</text></svg>`;
  return `<img src="data:image/svg+xml;utf8,${encodeURIComponent(svg)}" width="58" height="22" style="display:inline-block;vertical-align:middle;margin-left:5px;border:0;" alt="${escapeHtml(key)}" />`;
/*
  if (info?.iso2) {
    return `<span style="display:inline-flex;vertical-align:middle;align-items:center;gap:4px;margin-left:5px;padding:2px 7px;border:1px solid #d7dde8;border-radius:999px;background:#f8fafc;color:#111827;font-weight:700;font-size:11px;line-height:16px;"><img src="https://flagcdn.com/h14/${info.iso2}.png" width="20" height="14" style="border:0;border-radius:2px;vertical-align:middle;" />${escapeHtml(key)}</span>`;
  }
  return `<span style="display:inline-block;vertical-align:middle;margin-left:5px;padding:2px 7px;border:1px solid #d7dde8;border-radius:999px;background:#eef6ff;color:#005a9e;font-weight:800;font-size:11px;line-height:16px;">${escapeHtml(key)}</span>`;
*/
}

function breakpointText(breakpoints = []) {
  const selected = breakpoints.map((item) => String(item).toLowerCase());
  const labels = [];
  if (selected.includes("desktop")) labels.push("1280px");
  if (selected.includes("mobile")) labels.push("360px");
  return labels.length ? `Breakpoint ${labels.join(", ")}` : "";
}

function attachmentHtml(urls = []) {
  if (!urls.length) return "";
  return `<p><strong>EVIDENCE(S)</strong></p><p>${urls.map((url) => `<img src="${escapeHtml(url)}" alt="Evidence" width="64" height="64" style="width:64px;height:64px;object-fit:cover;border:1px solid #dbe4ef;border-radius:6px;margin:6px 8px 6px 0;" />`).join("")}</p>`;
}

export function buildQaResultDiscussionHtml({ resultKey, environments = [], countries = [], breakpoints = [], context = "", attachments = [] }) {
  const template = qaResultTemplates[resultKey] || qaResultTemplates.pass;
  const envHtml = environments.map(envPillHtml).join("");
  const countryHtml = countries.map(countryPillHtml).join("");
  const bpText = breakpointText(breakpoints);
  const bpHtml = bpText ? `<p><span style="display:inline-block;width:16px;height:16px;margin-right:6px;border:1px solid #64748b;border-radius:3px;vertical-align:middle;"></span>${escapeHtml(bpText)}</p>` : "";
  const contextHtml = context ? `<p>${escapeHtml(context).replace(/\n/g, "<br>")}</p>` : "";
  return [
    `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:13px;line-height:1.4;color:#201f1e;">`,
    `<p style="margin:0 0 8px 0;color:${template.color};font-weight:700;white-space:normal;">`,
    `<span style="display:inline-grid;place-items:center;width:16px;height:16px;margin-right:6px;border-radius:50%;background:${template.color};color:#fff;font-size:11px;vertical-align:middle;">${resultKey === "pass" ? "✓" : resultKey === "fail" ? "×" : "!"}</span>`,
    `<span style="vertical-align:middle;">${template.title}</span>${envHtml}${countryHtml}`,
    `</p>`,
    template.defaultBody,
    bpHtml,
    contextHtml,
    attachmentHtml(attachments),
    `</div><p><br></p>`
  ].join("");
}

function slackEnvironmentLabels(environments = []) {
  return environments.map((env) => slackEnvLabels[normalizeEnv(env)] || normalizeEnv(env)).filter(Boolean).join(" ");
}

function slackCountryLabels(countries = []) {
  return countries.map((country) => slackCountryFlags[normalizeCountry(country)] || normalizeCountry(country)).filter(Boolean).join(" ");
}

function slackWorkItemLine(item, includeTitle = true) {
  if (!item?.id) return "";
  const link = item.url || "";
  const text = `${item.id}${includeTitle && item.title ? ` - ${item.title}` : ""}`;
  return `${workItemSlackTag(item.type)} ${link ? `<${link}|${escapeSlackLinkText(text)}>` : escapeSlackLinkText(text)}`;
}

// Formato fiel ao userscript legado (buildSlackReportText): exatamente 5
// linhas — titulo, pai (se houver), item (com "└" se houver pai), FYI
// (fixos + assignee, sem QA responsavel) e Reported by (quem registrou o
// teste). Nada de status/contexto/anexos aqui — esses detalhes ficam na
// discussion do Azure (buildQaResultDiscussionHtml), nao no Slack.
export function buildLegacyQaResultSlackText({ item, resultKey, resultLabel, environments = [], countries = [], authorName = "", assignee, fyi = [] }) {
  const template = qaResultTemplates[resultKey] || Object.values(qaResultTemplates).find((entry) => entry.label === resultLabel) || qaResultTemplates.pass;
  const assigneeMention = legacyMention(assignee);
  const fixedMentions = fyi.map(legacyMention).filter(Boolean);
  const fyiMentions = Array.from(new Set([...fixedMentions, assigneeMention].filter(Boolean))).join(", ");
  const parentLine = item?.parent ? slackWorkItemLine(item.parent, false) : "";
  const itemLine = `${parentLine ? "└" : ""}${slackWorkItemLine(item, true)}`;
  return [
    `${template.slackIcon} ${template.slackTitle} ${slackEnvironmentLabels(environments)} ${slackCountryLabels(countries)}.`,
    parentLine,
    itemLine,
    fyiMentions ? `FYI ${fyiMentions}` : null,
    authorName ? `Reported by: ${authorName}` : null
  ].filter(Boolean).join("\n");
}

function formatBalance(dev) {
  if (dev.goalStatus === "above") return `+${dev.extraHours}h`;
  if (dev.goalStatus === "below") return `-${dev.missingHours}h`;
  return "0h";
}

// Texto simples (clipboard) — mesma estrutura do buildClipboardNotice do
// userscript/stark-hub-script, adaptada aos nomes de campo do Stark Hub.
export function buildHoursNoticeText({ dev, periodStart, periodEnd, formatHours }) {
  const fmt = formatHours || ((value) => `${value}h`);
  const withoutHours = dev.items.filter((item) => Number(item.completedHours || 0) <= 0);
  const withHours = dev.items.filter((item) => Number(item.completedHours || 0) > 0).sort((a, b) => Number(b.completedHours || 0) - Number(a.completedHours || 0));
  const group = (items, withValue) => {
    if (!items.length) return `Nao ha cards ${withValue ? "com" : "sem"} horas atribuidas.`;
    return items.map((item) => withValue
      ? `${workItemSlackTag(item.type)} ${String(item.type || "Item").toUpperCase()}${item.id} | ${fmt(item.completedHours)} | ${item.url || ""}`
      : `${workItemSlackTag(item.type)} ${String(item.type || "Item").toUpperCase()}${item.id} | ${item.url || ""}`
    ).join("\n");
  };
  return [
    `Ola, @${dev.displayName}.`,
    "Pode conferir suas horas no projeto?",
    "",
    periodStart || periodEnd ? `Periodo: ${periodStart || "?"} -> ${periodEnd || "?"}` : null,
    `Total: ${fmt(dev.completed)} | Esperado: ${fmt(dev.goalHours)} | Saldo: ${formatBalance(dev)}`,
    "",
    "Sem horas atribuidas",
    group(withoutHours, false),
    "",
    "Com horas atribuidas",
    group(withHours, true)
  ].filter((line) => line !== null).join("\n");
}

// Relatorio de equipe para Slack (mrkdwn), com tags de emoji por status.
export function buildGovernanceSlackText({ totals, rows }) {
  const below = rows.filter((row) => row.tone === "danger");
  const above = rows.filter((row) => row.tone === "warning");
  return [
    "*Governanca da equipe — Stark Hub*",
    `Gerado em ${new Date().toLocaleString("pt-BR")}`,
    "",
    `Colaboradores: ${totals.developers} | Cards: ${totals.cards}`,
    `Horas: ${totals.hours}h / meta ${totals.goal}h | Faltando: ${totals.missing}h | Excedente: ${totals.extra}h`,
    "",
    ":warning: *Abaixo da meta:*",
    ...(below.length ? below.map((row) => `• ${row.name}: ${row.hours}h / ${row.goal}h (faltam ${Math.max(row.goal - row.hours, 0)}h)`) : ["• Nenhum"]),
    "",
    ":large_green_circle: *Acima da meta:*",
    ...(above.length ? above.map((row) => `• ${row.name}: ${row.hours}h / ${row.goal}h (excedente ${Math.max(row.hours - row.goal, 0)}h)`) : ["• Nenhum"])
  ].join("\n");
}

// Resumo executivo pessoal (Home) formatado para Slack mrkdwn.
export function buildPersonalSummarySlackText({ name, role, entries = [], autoEntries = [], autoLabel = "Hoje (automatico)" }) {
  const recurring = entries.filter((entry) => entry.type === "recorrente");
  const temporary = entries.filter((entry) => entry.type !== "recorrente");
  return [
    `*Resumo executivo — ${name}*${role ? ` (${role})` : ""}`,
    `Gerado em ${new Date().toLocaleString("pt-BR")}`,
    "",
    "*Recorrentes:*",
    ...(recurring.length ? recurring.map((entry) => `• ${entry.title}`) : ["• Nenhum"]),
    "",
    "*Hoje:*",
    ...(temporary.length ? temporary.map((entry) => `• ${entry.title}`) : ["• Nenhum"]),
    ...(autoEntries.length ? ["", `*${autoLabel}:*`, ...autoEntries.map((entry) => `• ${entry.title}`)] : [])
  ].join("\n");
}

// Incoming Webhook do Slack aceita POST simples (sem headers de auth), entao
// da para enviar direto do navegador sem passar por backend.
export async function sendSlackWebhook(webhookUrl, text) {
  if (!webhookUrl) return { error: new Error("Webhook do Slack nao configurado.") };
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });
    if (!response.ok) return { error: new Error(`Slack respondeu ${response.status}`) };
    return { error: null };
  } catch (error) {
    return { error };
  }
}
