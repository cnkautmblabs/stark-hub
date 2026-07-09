// Armazenamento local (por navegador, por usuário) para qualquer dado que não
// deve morar no banco: credenciais (Azure PAT, webhooks do Slack) e
// preferências pessoais (sons de notificação, pipelines pessoais). Antes
// existiam três cópias quase idênticas deste mesmo padrão (aqui, em
// useAppSettings.js e em WorkbenchModules.jsx) — consolidado numa única
// fonte para não divergirem de novo.
function personalSettingsKey(profile, user) {
  return `starkHubPersonalConnections:${profile?.id || user?.email || "anonymous"}`;
}

export function readPersonalSettings(profile, user) {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(personalSettingsKey(profile, user)) || "{}");
  } catch {
    return {};
  }
}

export function readPersonalSetting(profile, user, key, fallback) {
  const data = readPersonalSettings(profile, user);
  return data[key] ?? fallback;
}

export function writePersonalSettings(profile, user, patch) {
  if (typeof window === "undefined") return;
  const current = readPersonalSettings(profile, user);
  window.localStorage.setItem(personalSettingsKey(profile, user), JSON.stringify({ ...current, ...patch }));
}

export function writePersonalSetting(profile, user, key, value) {
  writePersonalSettings(profile, user, { [key]: value });
}
