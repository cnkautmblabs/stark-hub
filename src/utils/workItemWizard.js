// Assistente de criacao de Work Item — hierarquia Feature/Page, regras de
// tag e montagem da descricao, no mesmo formato usado pelo fluxo legado de
// abertura de bug (cabecalhos em negrito unicode, ja que o campo
// System.Description do Azure DevOps nao aceita markdown ** ** de verdade
// quando lido fora do editor rico).

// Hierarquia Feature > Pagina fornecida pelo usuario — usada nos campos
// "Select Feature/Page" e "Related Features/Pages" do formulario.
export const featurePageGroups = [
  { feature: "PAGES, CONTENT & FEATURES", pages: ["Homepage", "Candy/Snackbar LP", "Which Movie", "Movie Page", "Nearby cinemas", "Movies By Theater", "Theaters", "Prices", "Formats LP (General)", "Formats Dedicated Page", "CineFan LP", "Cinemark Club LP", "MerchStore LP", "MerchStore Product Detail", "Work With Us", "Promotions LP", "Cyber Sales LP", "Electronic Invoice", "Regala Cine LP", "Visits (Loyalty) LP", "Group Purchase", "Corporate Purchase", "Other Purchase (Schools)"] },
  { feature: "NAVIGATION", pages: ["Header", "Points and benefits header", "Footer", "Error Page", "Location (Cinemas)"] },
  { feature: "PURCHASE JOURNEY", pages: ["Ticket Upgrade", "Ticket Selection", "Ticket Voucher", "Seat Map", "Candy Voucher", "Candy", "Candy UpSell", "Candy Flavors", "Candy Receipt", "MerchStore", "Summary", "Checkout", "Last Minute", "Order Detail", "MerchStore (By LP)", "Fee", "Quick Purchase", "By as Guest", "Revocation", "Regala Cine"] },
  { feature: "ONBOARDING / PROFILE (Drawer)", pages: ["Login", "Password recovery", "Create Account", "Profile", "Avatar", "Recent orders", "User Data", "Order History", "Order Detail (Drawer)", "Order Detail", "Change email", "Change password", "Cinemark Club Manager", "Cinemark Club Downgrade", "Cinemark Club Upgrade", "Cinemark Club Cancelation"] },
  { feature: "LOYALTY MEMBERSHIP", pages: ["Cinemark Club  Signature (Journey)", "Cinemark Club Plus Signature", "Cinemark Club Black Signature"] },
  { feature: "INSTITUTIONAL / GENERAL", pages: ["Int-File (Translations)", "Terms and Conditions", "Disclaimers", "In App Notifications", "Flix", "Tagging", "Setup", "Infra", "Pentest", "Security", "General Application"] }
];

export const featurePageOptions = featurePageGroups.flatMap(({ feature, pages }) => pages.map((page) => ({ value: `${feature} :: ${page}`, label: page, group: feature })));

export const countryList = ["LT", "AR", "BO", "CL", "PE", "PY", "BR"];

export const serviceLayerOptions = [
  { value: "NextSolutions (Legacy Service Layer - AR Only)", label: "NextSolutions (Legacy Service Layer - AR Only)" },
  { value: "SunDevs (Legacy Service Layer - Other countries)", label: "SunDevs (Legacy Service Layer - Other countries)" },
  { value: "LenioLabs (New service layer)", label: "LenioLabs (New service layer)" },
  { value: "BackOffice (Lenio Labs)", label: "BackOffice (Lenio Labs)" },
  { value: "Front+BFF (MbLabs)", label: "Front+BFF (MbLabs)" }
];

export const userTypeOptions = ["Comum", "Cine Fan/Club", "Cine Fan/Club Plus", "Cine Fan/Club Black", "Employee", "YPF"];

export const breakpointOptions = [
  { value: "1280px", label: "1280px" },
  { value: "360px", label: "360px" }
];

export const environmentOptions = ["QA", "BETA", "PROD"];

export const demandTypeOptions = ["New Feature", "Improvement", "Adjustment", "Refactoring"];

// Tipos de work item que o menu de contexto oferece, cada um com o
// formulario correspondente (ver CreateWorkItemWizard.jsx).
export const workItemWizardTypes = [
  { key: "epic", label: "Epic", azureType: "Epic", icon: "bi-flag" },
  { key: "feature", label: "Feature", azureType: "Feature", icon: "bi-star" },
  { key: "userStory", label: "User Story", azureType: "User Story", icon: "bi-bookmark" },
  { key: "bug", label: "Bug", azureType: "Bug", icon: "bi-bug" },
  { key: "task", label: "Task", azureType: "Task", icon: "bi-list-check" },
  { key: "testCase", label: "Test Case", azureType: "Test Case", icon: "bi-clipboard2-check" }
];

// Mapa de letras normais pra "negrito" matematico unicode (𝗔𝗕𝗖 etc.) — o
// campo Description do Azure exibe HTML, mas o formato de referencia do
// usuario usa esses glifos pra cabecalhos "em negrito" mesmo em contextos
// de texto puro (ex.: notificacao/preview fora do editor rico).
const boldMap = {};
"ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").forEach((ch, i) => { boldMap[ch] = String.fromCodePoint(0x1d5d4 + i); });
"abcdefghijklmnopqrstuvwxyz".split("").forEach((ch, i) => { boldMap[ch] = String.fromCodePoint(0x1d5ee + i); });
"0123456789".split("").forEach((ch, i) => { boldMap[ch] = String.fromCodePoint(0x1d7ec + i); });

export function toBoldUnicode(text) {
  return String(text || "").split("").map((ch) => boldMap[ch] || ch).join("");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Uma linha "𝗥𝗢𝗧𝗨𝗟𝗢: valor" — omite a linha inteira se o valor estiver vazio,
// pra nao poluir a descricao com campos opcionais nao preenchidos.
function field(label, value) {
  if (value === undefined || value === null || String(value).trim() === "") return "";
  return `${toBoldUnicode(label)}: ${escapeHtml(value)}`;
}

function block(label, value) {
  if (!value || !String(value).trim()) return "";
  return `${toBoldUnicode(label)}:<br>${escapeHtml(value).replace(/\n/g, "<br>")}`;
}

// Descricao do Bug, no formato exato de referencia (fluxo legado de
// abertura de bug) — HTML com <br> pra preservar as quebras de linha no
// campo rico do Azure (texto puro colapsa espacos/linhas na renderizacao).
export function buildBugDescriptionHtml(form) {
  const lines = [
    field("Country", form.country),
    field("Work Item", `BUG${form.scope ? ` (${form.scope})` : ""}`),
    field("Environment", form.environment),
    "",
    field("Service Layer", form.serviceLayer),
    field("Backend Documentation", form.backendDocumentation || "Not available"),
    "",
    form.relatedFeatures?.length ? `${toBoldUnicode("Related Features/Pages")}:<br>${form.relatedFeatures.map(escapeHtml).join("<br>")}` : "",
    "",
    field("Is possible reproduce in PROD environment", form.reproducibleInProd ? "Yes" : "No"),
    "",
    block("Context", form.context),
    "",
    block("Repro Steps to Reproduction", form.reproSteps),
    "",
    field("Breakpoint", form.breakpoint),
    field("Location", form.location),
    field("User", form.user),
    field("Password", form.password),
    field("User Type", form.userType),
    "",
    block("Business Rule and Expected Solution", form.businessRule),
    form.figmaLink ? field("Link Figma (opcional)", form.figmaLink) : ""
  ];
  return lines.filter((line) => line !== "").join("<br>");
}

// Descricao de Feature/User Story — formato "As a.../I want.../So that..."
// (segunda tela de referencia), tambem em HTML com <br>.
export function buildFeatureDescriptionHtml(form) {
  const lines = [
    field("Country", form.country),
    field("Type of Demand", form.demandType),
    field("Validated by President/Marketing", form.validated ? "Yes" : "No"),
    "",
    form.relatedFeatures?.length ? `${toBoldUnicode("Related Features/Pages")}:<br>${form.relatedFeatures.map(escapeHtml).join("<br>")}` : "",
    "",
    block("As a", form.asA),
    block("I want", form.iWant),
    block("So that", form.soThat),
    "",
    block("Context", form.context),
    "",
    block("Business Rule and Expected Solution", form.businessRule),
    "",
    block("Acceptance Criteria", form.acceptanceCriteria),
    form.figmaLink ? field("Link Figma (opcional)", form.figmaLink) : ""
  ];
  return lines.filter((line) => line !== "").join("<br>");
}

// Epic/Task/Test Case nao tiveram um formulario de referencia dado pelo
// usuario — descricao simples e generica, ainda no mesmo estilo visual.
export function buildGenericDescriptionHtml(form) {
  const lines = [
    field("Country", form.country),
    block("Context", form.context),
    block("Business Rule and Expected Solution", form.businessRule),
    form.acceptanceCriteria ? block("Acceptance Criteria", form.acceptanceCriteria) : "",
    form.figmaLink ? field("Link Figma (opcional)", form.figmaLink) : ""
  ];
  return lines.filter((line) => line !== "").join("<br>");
}

export function appendAttachmentsHtml(html, attachmentUrls = []) {
  if (!attachmentUrls.length) return html;
  const imgs = attachmentUrls.map((url) => `<img src="${escapeHtml(url)}" alt="evidence" style="max-width:420px;border-radius:6px;margin:6px 6px 0 0;" />`).join("");
  return `${html}<br><br>${toBoldUnicode("Attachments")}:<br>${imgs}`;
}

// Tags automaticas: "0-${PAIS}" por pais selecionado + tag propria do tipo,
// quando conhecida. So "2-BUGINT" foi confirmado pelo usuario como exemplo
// — os demais tipos ainda nao tem uma tag de escopo definida, entao ficam
// sem tag extra ate isso ser confirmado.
const typeScopeTags = {
  bug: "2-BUGINT"
};

export function buildWorkItemTags(typeKey, countries = []) {
  const tags = countries.map((code) => `0-${code}`);
  if (typeScopeTags[typeKey]) tags.push(typeScopeTags[typeKey]);
  return tags;
}
