// Sons de notificacao — arquivos de audio reais (public/songs/), um por
// evento, fornecidos pelo usuario (substituem os tons sintetizados via Web
// Audio API usados antes). Preferencia de ativar/desativar por evento e o
// mudo geral continuam individuais por pessoa, salvos no localStorage do
// navegador (mesmo mecanismo das conexoes pessoais em Configuracoes).
import { readPersonalSetting, writePersonalSetting } from "./personalSettings.js";

export { readPersonalSetting, writePersonalSetting };

export const notificationTypes = [
  { key: "newItem", label: "Novo item detectado", description: "Quando um work item novo aparece no board." },
  { key: "itemEnteredQaBeta", label: "Entrou em QA/BETA", description: "Quando um item avanca para In QA ou In BETA." },
  { key: "updatedItem", label: "Item movido/atualizado", description: "Outras mudancas de estado do item (Ready Beta, HMG CNK, Ready Prod etc.)." },
  { key: "testApproved", label: "Teste aprovado", description: "Ao registrar Approved em um work item." },
  { key: "testFailed", label: "Teste reprovado ou com limitacao", description: "Ao registrar Fail ou Limitation em um work item." },
  { key: "devApproved", label: "Seu item foi aprovado (Dev)", description: "Quando o teste do seu proprio item e aprovado por um QA." },
  { key: "devReproved", label: "Seu item foi reprovado (Dev)", description: "Quando o teste do seu proprio item falha." }
];

const soundFiles = {
  newItem: "new-notification.mp3",
  itemEnteredQaBeta: "new-work-item-moved-for-qa(only in Qa and in Beta).mp3",
  updatedItem: "work-item-moved-for-qa(Except in Qa and in Beta).mp3",
  testApproved: "test-approved.mp3",
  testFailed: "Test-failed-and-limitation.mp3",
  devApproved: "work-item-approved-for-dev.mp3",
  devReproved: "work-item-reproved-for-dev.mp3",
  error: "tosty-error.mp3"
};

// Toca o arquivo direto, ignorando mudo/preferencia — usado pelo botao
// "Testar" em Configuracoes e por qualquer chamada que sempre deva soar
// (ex.: erro de toast, que nao tem um tipo configuravel por enquanto).
export function playSoundFile(type) {
  const file = soundFiles[type];
  if (!file || typeof Audio === "undefined") return;
  try {
    const audio = new Audio(`${import.meta.env.BASE_URL}songs/${encodeURIComponent(file)}`);
    audio.volume = 0.55;
    audio.play().catch(() => {});
  } catch {
    // Reproducao de audio pode falhar (autoplay bloqueado, sem interacao do
    // usuario ainda) — nao deve quebrar o fluxo que disparou a notificacao.
  }
}

// Chamado nos pontos reais de notificacao (useWorkItems.js) — respeita o
// mudo geral e a preferencia individual de cada evento (liga/desliga,
// Configuracoes > Notificacoes sonoras).
export function playNotificationSound(type, profile, user) {
  const muted = Boolean(readPersonalSetting(profile, user, "notificationSoundsMuted", false));
  if (muted) return;
  const enabled = readPersonalSetting(profile, user, `notificationSoundEnabled:${type}`, true);
  if (!enabled) return;
  playSoundFile(type);
}
