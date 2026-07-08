// Dados de exemplo usados no modo demonstração (quando o Supabase não está
// configurado ou quando o usuário escolhe um perfil demo na tela de login).
// Propositalmente incluem lacunas (horas não estimadas, sem responsável de
// QA, sem último resultado de teste) para simular uma conta real em uso,
// não um cenário perfeito.

// "profileId" liga um colaborador a uma conta registrada no Stark Hub (tabela
// profiles — accessLevel controla o que ela pode acessar no app). Colaboradores
// sem profileId existem só no diretório Azure/Slack (ainda não têm conta).
const fallbackCollaborators = [
  {
    id: "c1", profileId: "demo-gestao", accessLevel: "gestao", azureName: "Marina Costa", slackName: "marina.costa.demo",
    slackMemberId: "UDEMO001", aliases: ["Marina C."], color: "#38bdf8", imageUrl: "",
    isDev: true, isQa: false, isManagement: true, goalHours: 160
  },
  {
    id: "c2", profileId: "demo-qa", accessLevel: "qa", azureName: "Lia Martins", slackName: "lia.martins.demo",
    slackMemberId: "UDEMO002", aliases: ["Lia M.", "lmartins"], color: "#f472b6", imageUrl: "",
    isDev: false, isQa: true, isManagement: false, goalHours: 160
  },
  {
    id: "c3", profileId: "demo-dev", accessLevel: "dev", azureName: "Rafael Demo", slackName: "rafael.demo",
    slackMemberId: "UDEMO003", aliases: [], color: "#22c55e", imageUrl: "",
    isDev: true, isQa: false, isManagement: false, goalHours: 160
  },
  {
    id: "c4", profileId: null, accessLevel: null, azureName: "Clara Souza", slackName: "clara.souza.demo",
    slackMemberId: "UDEMO004", aliases: ["Clara"], color: "#f59e0b", imageUrl: "",
    isDev: true, isQa: true, isManagement: false, goalHours: 140
  },
  {
    id: "c5", profileId: null, accessLevel: null, azureName: "Diego Demo", slackName: "",
    slackMemberId: "", aliases: [], color: "#a78bfa", imageUrl: "",
    isDev: true, isQa: false, isManagement: false, goalHours: 160
  },
  {
    id: "c6", profileId: "demo-pending", accessLevel: "pending", azureName: "Nina Demo", slackName: "nina.demo",
    slackMemberId: "UDEMO006", aliases: [], color: "#94a3b8", imageUrl: "",
    isDev: false, isQa: false, isManagement: false, goalHours: 160
  }
];

export const mockCollaborators = fallbackCollaborators;

export const mockWorkItems = [
  {
    id: 4821, type: "Task", title: "Ajustar validação de CPF no cadastro",
    state: "In QA", env: "qa", countries: ["BR"], sprint: "Sprint 24", tags: [],
    completedHours: 4, assigneeId: "c3", qaCollaboratorId: "c2", lastTestResult: null,
    updatedAt: "2026-06-28T14:10:00Z"
  },
  {
    id: 4809, type: "Bug", title: "Botão de exportar CSV não responde no Safari",
    state: "Ready to Beta", env: "beta", countries: ["AR", "CL"], sprint: "Sprint 24", tags: ["hotfix"],
    completedHours: 2.5, assigneeId: "c4", qaCollaboratorId: "c2", lastTestResult: "pass",
    updatedAt: "2026-06-29T09:40:00Z"
  },
  {
    id: 4795, type: "Task", title: "Criar endpoint de reconciliação diária",
    state: "In BETA", env: "beta", countries: ["BR"], sprint: "Sprint 23", tags: [],
    completedHours: 6, assigneeId: "c3", qaCollaboratorId: null, lastTestResult: null,
    updatedAt: "2026-06-25T11:00:00Z"
  },
  {
    id: 4780, type: "Bug", title: "Layout quebrado no menu lateral em mobile",
    state: "HMG CNK", env: "qa", countries: ["CL"], sprint: "Sprint 23", tags: ["critical"],
    completedHours: 1, assigneeId: "c4", qaCollaboratorId: "c2", lastTestResult: "fail",
    updatedAt: "2026-06-24T16:20:00Z"
  },
  {
    id: 4770, type: "Feature", title: "Onboarding guiado para novos usuários PY",
    state: "In Dev", env: "dev", countries: ["PY"], sprint: "Sprint 24", tags: [],
    completedHours: null, assigneeId: "c3", qaCollaboratorId: null, lastTestResult: null,
    updatedAt: "2026-06-30T08:05:00Z"
  },
  {
    id: 4761, type: "Bug", title: "Timeout intermitente ao consultar extrato",
    state: "In Prod", env: "prod", countries: ["BR", "AR", "CL", "PE", "PY", "BO"], sprint: "Sprint 22", tags: ["blocking"],
    completedHours: 3, assigneeId: null, qaCollaboratorId: "c2", lastTestResult: "limitation",
    updatedAt: "2026-06-18T13:00:00Z"
  },
  {
    id: 4755, type: "Task", title: "Traduzir telas de configuração para espanhol (BO/PE)",
    state: "In QA", env: "qa", countries: ["BO", "PE"], sprint: "Sprint 24", tags: [],
    completedHours: 1.5, assigneeId: "c4", qaCollaboratorId: "c2", lastTestResult: "pass",
    updatedAt: "2026-06-27T10:30:00Z"
  },
  {
    id: 4742, type: "Bug", title: "Ícone de notificação sobrepõe texto no header",
    state: "Ready to Beta", env: "beta", countries: ["BR"], sprint: "Sprint 23", tags: [],
    completedHours: 0.5, assigneeId: "c3", qaCollaboratorId: null, lastTestResult: null,
    updatedAt: "2026-06-26T15:45:00Z"
  },
  {
    id: 4730, type: "Task", title: "Migrar job de fechamento mensal para fila assíncrona",
    state: "In Dev", env: "dev", countries: ["BR"], sprint: "Sprint 24", tags: ["devbox"],
    completedHours: null, assigneeId: null, qaCollaboratorId: null, lastTestResult: null,
    updatedAt: "2026-06-30T17:15:00Z"
  },
  {
    id: 4718, type: "Feature", title: "Novo painel de limites de crédito por país",
    state: "In Prod", env: "prod", countries: ["AR", "CL"], sprint: "Sprint 21", tags: [],
    completedHours: 12, assigneeId: "c3", qaCollaboratorId: "c2", lastTestResult: "pass",
    updatedAt: "2026-06-10T09:00:00Z"
  }
];

export const mockTestEvidence = [
  { id: "e1", workItemId: 4809, result: "pass", environment: "beta", author: "Lia Martins", note: "Breakpoint 1280px, 360px. Sem regressões.", createdAt: "2026-06-29T09:38:00Z" },
  { id: "e2", workItemId: 4780, result: "fail", environment: "qa", author: "Lia Martins", note: "Menu não recolhe em telas < 400px.", createdAt: "2026-06-24T16:18:00Z" },
  { id: "e3", workItemId: 4761, result: "limitation", environment: "prod", author: "Lia Martins", note: "Ambiente de homologação não replica latência real do provedor de pagamento.", createdAt: "2026-06-18T12:55:00Z" },
  { id: "e4", workItemId: 4755, result: "pass", environment: "qa", author: "Lia Martins", note: "Textos revisados com time de i18n.", createdAt: "2026-06-27T10:28:00Z" },
  { id: "e5", workItemId: 4718, result: "pass", environment: "prod", author: "Lia Martins", note: "Validado com QA local em AR e CL.", createdAt: "2026-06-09T18:40:00Z" }
];

// Perfis usados quando o usuário escolhe um papel específico no modo demonstração.
const fallbackProfiles = {
  dev: { id: "demo-dev", fullName: "Rafael Demo", email: "dev.demo@example.test", accessLevel: "dev" },
  qa: { id: "demo-qa", fullName: "Lia Martins", email: "qa.demo@example.test", accessLevel: "qa" },
  gestao: { id: "demo-gestao", fullName: "Marina Costa", email: "gestao.demo@example.test", accessLevel: "gestao" },
  gerente: { id: "demo-gerente", fullName: "Eduardo Gerente", email: "gerente.demo@example.test", accessLevel: "gerente" }
};

export const mockProfiles = fallbackProfiles;

const fallbackFeatureFlags = {
  showQaBoard: true,
  showMyItems: true,
  showGovernance: true,
  showTestResults: true,
  showEvidenceHistory: true,
  showThemeToggle: true,
  enableBulkEdit: true,
  enableNewTask: true,
  enableReadyBetaNotifications: false
};

export const mockFeatureFlags = fallbackFeatureFlags;

export const featureFlagLabels = {
  showQaBoard: "Exibir Quality Board no menu",
  showMyItems: "Exibir Meus itens (Dev) no menu",
  showGovernance: "Exibir Governança no menu",
  showTestResults: "Habilitar menu de Resultado (Pass/Fail/Limitation)",
  showImportWorkItems: "Exibir Import Work Items no menu",
  showEvidenceHistory: "Exibir histórico de evidências de teste",
  showThemeToggle: "Permitir alternar tema claro/escuro",
  enableBulkEdit: "Permitir edição em massa de work items",
  enableNewTask: "Permitir criação de nova task pelo painel",
  enableReadyBetaNotifications: "Notificar Slack quando item ficar Ready to Beta"
};

