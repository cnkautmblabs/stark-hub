// Helpers puros para montar URLs do Azure DevOps a partir do que o usuário
// cadastrou em Configurações (orgUrl pode ser só o nome da organização ou
// já a URL completa — mesma tolerância aplicada nas Edge Functions).
export function normalizeAzureOrgUrl(rawUrl) {
  const trimmed = String(rawUrl || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://dev.azure.com/${trimmed}`;
}

export function azureWorkItemUrl(orgUrl, project, id) {
  const base = normalizeAzureOrgUrl(orgUrl);
  if (!base || !project) return "";
  return `${base}/${encodeURIComponent(project)}/_workitems/edit/${id}`;
}
