// Domínios de e-mail autorizados a autenticar no Stark Hub.
export const allowedEmailDomains = String(import.meta.env.VITE_ALLOWED_EMAIL_DOMAINS || "").split(",").map((domain) => domain.trim().toLowerCase()).filter(Boolean);

export const accessLevels = {
  pending: "pending",
  dev: "dev",
  qa: "qa",
  gestao: "gestao",
  gerente: "gerente"
};

export const accessLevelLabels = {
  pending: "Aguardando liberação",
  dev: "Dev",
  qa: "QA",
  gestao: "Gestão",
  gerente: "Gerente"
};

// Gerente tem tudo que Gestao tem, mais a tela exclusiva de Gerenciamento.
// Use isto (nao "=== accessLevels.gestao") em qualquer checagem que hoje
// restringe algo à Gestão, para o Gerente herdar o mesmo acesso.
export function hasManagementAccess(accessLevel) {
  return accessLevel === accessLevels.gestao || accessLevel === accessLevels.gerente;
}

export function isDomainAllowed(email) {
  if (!allowedEmailDomains.length) return true;
  const domain = String(email || "").split("@")[1]?.toLowerCase() || "";
  return allowedEmailDomains.includes(domain);
}

// Países atendidos. Emoji de bandeira não é confiável (Windows não renderiza
// a maioria — mostra a sigla em texto), então usamos imagens reais via
// flagcdn.com (mesmo padrão do fluxo original, que usava flagpedia.net).
export const countries = {
  LT: { label: "LATAM", iso2: "" },
  BR: { label: "Brasil", iso2: "br" },
  AR: { label: "Argentina", iso2: "ar" },
  BO: { label: "Bolívia", iso2: "bo" },
  CL: { label: "Chile", iso2: "cl" },
  PE: { label: "Peru", iso2: "pe" },
  PY: { label: "Paraguai", iso2: "py" }
};

export function flagUrl(iso2, height = 20) {
  return `https://flagcdn.com/h${height}/${iso2}.png`;
}

// Ambientes do pipeline de entrega — cores fixas replicando o padrão visual
// já validado no fluxo de QA (pills de ambiente no card/board).
export const environments = {
  dev: { label: "DEV", background: "#d0d0d0", color: "#000000" },
  qa: { label: "QA", background: "#ffe34d", color: "#000000" },
  beta: { label: "BETA", background: "#66cc66", color: "#000000" },
  prod: { label: "PROD", background: "#ff5c5c", color: "#000000" }
};

// Resultado de um ciclo de teste, registrado como evidência no work item.
// Cores herdadas do padrão original (evidenceStatusConfig / testResultTemplates).
export const testResultTypes = {
  pass: { label: "Pass", color: "#166534", background: "#dcfce7", icon: "✓" },
  fail: { label: "Fail", color: "#991b1b", background: "#fee2e2", icon: "✕" },
  limitation: { label: "Limitation", color: "#9a6700", background: "#fff3cd", icon: "⚠" }
};

// Tipo de work item do Azure DevOps — cores herdadas de workTypeInfo(), ícone
// segue a convenção do próprio Azure DevOps (martelo=Task, livro=User Story,
// quebra-cabeça=Feature, raio=Epic).
// Bug/Task/User Story usam var(--stark-type-*) — mesmos tokens exatos do
// sistema de tema definitivo do userscript (reagem a claro/escuro sozinhos).
// Feature/Epic não tinham variante dark documentada no legado, então mantêm
// a cor fixa original (workTypeInfo()).
export const workItemTypes = {
  Bug: { color: "var(--starkTypeBug)", background: "var(--starkTypeBugBg)", icon: "bi-bug-fill", prefix: "BUG" },
  Task: { color: "var(--starkTypeTask)", background: "var(--starkTypeTaskBg)", icon: "bi-hammer", prefix: "TASK" },
  "User Story": { color: "var(--starkTypeStory)", background: "var(--starkTypeStoryBg)", icon: "bi-book-fill", prefix: "US" },
  Feature: { color: "#7c3aed", background: "#f5f3ff", icon: "bi-puzzle-fill", prefix: "FEAT" },
  Epic: { color: "#ea580c", background: "#fff7ed", icon: "bi-lightning-charge-fill", prefix: "EPIC" }
};
export const defaultWorkItemTypeStyle = { color: "#64748b", background: "#f8fafc", icon: "bi-card-checklist", prefix: "WI" };

export function workItemTypePrefix(type) {
  return (workItemTypes[type] || defaultWorkItemTypeStyle).prefix;
}

export function formatWorkItemCode(id, type) {
  const value = String(id ?? "").trim();
  return `${workItemTypePrefix(type)}${value}`;
}

// Pill de estado do work item — cores herdadas de CONFIG.statusConfig.
// Chave normalizada (minúscula, sem espaço) para casar variações de grafia.
export const statusConfig = {
  inqa: { label: "In QA", color: "#2563eb", background: "#eff6ff" },
  inbeta: { label: "In BETA", color: "#7c3aed", background: "#f5f3ff" },
  readybeta: { label: "Ready Beta", color: "#d97706", background: "#fffbeb" },
  readytobeta: { label: "Ready Beta", color: "#d97706", background: "#fffbeb" },
  readytoprod: { label: "Ready Prod", color: "#16a34a", background: "#f0fdf4" },
  hmgcnk: { label: "HMG CNK", color: "#0891b2", background: "#ecfeff" }
};
export const defaultStatusStyle = { color: "#64748b", background: "#f8fafc" };

export function normalizeStatusKey(state) {
  return String(state || "").toLowerCase().replace(/\s+/g, "");
}

// Estados considerados "em QA" — usados para destacar itens que precisam
// de atenção do time de QA em telas de visão geral.
export const qaStates = ["In QA", "In Qa", "Ready to Beta", "In BETA", "HMG CNK"];

// Meta padrão de horas por colaborador quando não há uma customizada.
export const defaultGoalHours = 160;

// Fluxo de avanço de ambiente usado em "Meus itens": ao avançar um item,
// horas trabalhadas são obrigatórias (mesmo padrão do fluxo original).
// prod é terminal — não há próximo passo.
export const nextEnvStep = {
  dev: { env: "qa", state: "In QA" },
  qa: { env: "beta", state: "In BETA" },
  beta: { env: "prod", state: "Ready to Prod" }
};

