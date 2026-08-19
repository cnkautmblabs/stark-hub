import i18next from "i18next";
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

// NAO usar .use(initReactI18next) aqui — isso registraria esta instancia
// como o fallback GLOBAL do react-i18next pra qualquer useTranslation() sem
// Provider explicito (efeito colateral real detectado: o restante do app,
// incluindo a pagina /healthcheck autenticada, passou a abrir em ingles
// depois de visitar a status page publica, mesmo sem nenhuma relacao entre
// as duas). O <I18nextProvider i18n={publicI18n}> em PublicHealthStatus.jsx
// ja e suficiente pra ligar esta instancia ao React só na sua propria
// subarvore, sem essa inicializacao.
const publicI18n = i18next.createInstance();
publicI18n.init({
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
