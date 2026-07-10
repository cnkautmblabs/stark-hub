import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import ptBR from "./locales/ptBR.js";
import en from "./locales/en.js";
import es from "./locales/es.js";

export const supportedLanguages = [
  { code: "pt-BR", label: "Portugues (BR)" },
  { code: "en", label: "English" },
  { code: "es", label: "Espanol" }
];

const storageKey = "starkHubLanguage";

function detectLanguage() {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved && supportedLanguages.some((lang) => lang.code === saved)) return saved;
  } catch {
    // localStorage indisponivel (modo privado antigo) — cai no fallback pt-BR.
  }
  return "pt-BR";
}

i18n.use(initReactI18next).init({
  resources: {
    "pt-BR": { translation: ptBR },
    en: { translation: en },
    es: { translation: es }
  },
  lng: detectLanguage(),
  fallbackLng: "pt-BR",
  interpolation: { escapeValue: false }
});

i18n.on("languageChanged", (lng) => {
  try {
    localStorage.setItem(storageKey, lng);
  } catch {
    // Idioma so nao persiste entre sessoes; nao impede o troca atual.
  }
});

export default i18n;
