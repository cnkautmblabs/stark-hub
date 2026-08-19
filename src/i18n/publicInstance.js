import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import ptBR from "./locales/ptBR.js";
import en from "./locales/en.js";
import es from "./locales/es.js";

// Instancia i18n ISOLADA pra status page publica (/cnk-health-check-status)
// — reaproveita os mesmos bundles de traducao do app, mas com um idioma
// padrao e uma chave de persistencia proprios (starkHubPublicStatusLanguage,
// nao starkHubLanguage). Se usasse a instancia global, trocar o idioma
// aqui (visitante anonimo, sem login) mudaria tambem o idioma salvo de
// quem estiver logado no Stark Hub nesse mesmo navegador — efeito colateral
// indesejado numa pagina publica que pediu "iniciar em ingles" por padrao.
export const publicSupportedLanguages = [
  { code: "en", label: "English" },
  { code: "pt-BR", label: "Português (BR)" },
  { code: "es", label: "Español" }
];

const storageKey = "starkHubPublicStatusLanguage";

function detectPublicLanguage() {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved && publicSupportedLanguages.some((lang) => lang.code === saved)) return saved;
  } catch {
    // localStorage indisponivel: cai no fallback en.
  }
  return "en";
}

const publicI18n = i18next.createInstance();
publicI18n.use(initReactI18next).init({
  resources: {
    "pt-BR": { translation: ptBR },
    en: { translation: en },
    es: { translation: es }
  },
  lng: detectPublicLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false }
});

publicI18n.on("languageChanged", (lng) => {
  try {
    localStorage.setItem(storageKey, lng);
  } catch {
    // Idioma so nao persiste entre visitas; nao impede a troca atual.
  }
});

export default publicI18n;
