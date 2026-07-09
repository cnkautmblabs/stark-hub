// Sons de notificacao configuraveis por usuario. Preferencia individual (cada
// pessoa escolhe o proprio som/mudo), por isso fica no localStorage do
// navegador (mesma chave/formato usado pelas conexoes pessoais em
// Configuracoes), nao em app_settings (que e compartilhado/gerido pela
// Gestao). Os sons sao sintetizados via Web Audio API — sem precisar de
// arquivos de audio.
import { readPersonalSetting, writePersonalSetting } from "./personalSettings.js";

export { readPersonalSetting, writePersonalSetting };

export const notificationTypes = [
  { key: "newItem", label: "Novo item detectado", description: "Quando um work item novo aparece no board." },
  { key: "inQa", label: "Entrou em QA", description: "Quando um item avanca para o estado In QA." },
  { key: "readyBeta", label: "Pronto para Beta", description: "Quando um item avanca para BETA." },
  { key: "testResult", label: "Resultado de teste registrado", description: "Ao registrar Approved, Fail ou Limitation em um work item." }
];

export const soundOptions = [
  { value: "none", label: "Sem som" },
  { value: "ping", label: "Ping" },
  { value: "chime", label: "Sino" },
  { value: "alert", label: "Alerta" }
];

const tonePatterns = {
  ping: [{ freq: 880, duration: 0.12 }],
  chime: [{ freq: 660, duration: 0.1 }, { freq: 990, duration: 0.16 }],
  alert: [{ freq: 440, duration: 0.09 }, { freq: 440, duration: 0.09 }, { freq: 440, duration: 0.14 }]
};

export function playTone(sound) {
  const pattern = tonePatterns[sound];
  if (!pattern || typeof window === "undefined") return;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  const ctx = new AudioCtx();
  let time = ctx.currentTime;
  pattern.forEach(({ freq, duration }) => {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.2, time + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(time);
    oscillator.stop(time + duration + 0.02);
    time += duration + 0.04;
  });
  setTimeout(() => ctx.close(), (time + 0.1) * 1000);
}

// Chamado nos pontos reais de notificacao (useWorkItems.js, AzureWorkItemModal.jsx).
// Silencioso por padrao (respeita preferencia individual salva em Configuracoes).
export function playNotificationSound(type, profile, user) {
  const muted = Boolean(readPersonalSetting(profile, user, "notificationSoundsMuted", false));
  if (muted) return;
  const sound = readPersonalSetting(profile, user, `notificationSound:${type}`, "ping");
  if (!sound || sound === "none") return;
  playTone(sound);
}
