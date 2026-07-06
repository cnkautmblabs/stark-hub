// Notificação no Slack quando um item avança para BETA — equivalente ao
// "Envio para o Slack" do userscript legado (webhooks + menções fixas por
// pessoa). Aqui os webhooks vivem em app_settings (Configurações) e a
// menção por pessoa vem direto de collaborators.slackMemberId.

export function resolveSlackWebhooks(getSetting) {
  if (getSetting("slackTestMode", false)) {
    const testUrl = getSetting("slackTestWebhookUrl", "");
    return testUrl ? [testUrl] : [];
  }
  const urls = [];
  const primary = getSetting("slackWebhookUrl", "");
  if (primary) urls.push(primary);
  (getSetting("slackAdditionalWebhooks", []) || []).forEach((webhook) => {
    if (webhook?.enabled !== false && webhook?.url) urls.push(webhook.url);
  });
  return urls;
}

export function buildReadyForBetaMessage(item, assignee) {
  const who = assignee?.slackMemberId ? `<@${assignee.slackMemberId}>` : assignee?.azureName || item.assigneeName || "responsável não identificado";
  return `:rocket: *#${item.id}* _${item.title}_ está pronto para *BETA*. Responsável: ${who}`;
}
