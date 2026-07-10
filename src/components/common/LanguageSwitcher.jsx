import { useTranslation } from "react-i18next";
import { FiGlobe } from "react-icons/fi";
import { supportedLanguages } from "../../i18n/index.js";

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  return (
    <label className="stark-user-menu-language">
      <FiGlobe />
      <span>{t("topbar.language")}</span>
      <select value={i18n.resolvedLanguage || i18n.language} onChange={(event) => i18n.changeLanguage(event.target.value)}>
        {supportedLanguages.map((lang) => <option key={lang.code} value={lang.code}>{lang.label}</option>)}
      </select>
    </label>
  );
}
