import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, WorkbenchHeader } from "../ui/WorkbenchPrimitives.jsx";
import { dateStamp, downloadCsv } from "../../../utils/csvExport.js";

function FaqContent() {
  const { t } = useTranslation();
  const faqItems = t("faqAbout.faqItems", { returnObjects: true });
  const [openIndex, setOpenIndex] = useState(0);
  return (
    <div className="mbw-faq-list">
      {faqItems.map((item, index) => {
        const isOpen = openIndex === index;
        return (
          <div key={item.q} className={`mbw-faq-item ${isOpen ? "open" : ""}`}>
            <button type="button" className="mbw-faq-question" onClick={() => setOpenIndex(isOpen ? -1 : index)} aria-expanded={isOpen}>
              <span>{item.q}</span>
              <i className={`bi ${isOpen ? "bi-dash-lg" : "bi-plus-lg"}`} />
            </button>
            {isOpen && <p className="mbw-faq-answer">{item.a}</p>}
          </div>
        );
      })}
    </div>
  );
}

function AboutContent() {
  const { t } = useTranslation();
  const modules = t("faqAbout.modules", { returnObjects: true });
  const accessLevelRows = t("faqAbout.accessLevelRows", { returnObjects: true });
  const securityPoints = t("faqAbout.aboutSecurityPoints", { returnObjects: true });
  return (
    <>
      <section className="mbw-about-section">
        <h3>{t("faqAbout.aboutWhatTitle")}</h3>
        <p>{t("faqAbout.aboutWhatP1")}</p>
        <p>{t("faqAbout.aboutWhatP2")}</p>
      </section>
      <section className="mbw-about-section">
        <h3>{t("faqAbout.aboutModulesTitle")}</h3>
        <div className="mbw-about-modules">
          {modules.map((item) => (
            <div key={item.title} className="mbw-about-module">
              <i className={`bi ${item.icon}`} />
              <div><strong>{item.title}</strong><p>{item.text}</p></div>
            </div>
          ))}
        </div>
      </section>
      <section className="mbw-about-section">
        <h3>{t("faqAbout.aboutAccessTitle")}</h3>
        <table className="mbw-about-table">
          <tbody>
            {accessLevelRows.map((row) => (
              <tr key={row.level}><td><strong>{row.level}</strong></td><td>{row.scope}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="mbw-about-section">
        <div className="mbw-about-security-card">
          <div className="mbw-about-security-header">
            <i className="bi bi-shield-check" />
            <h3>{t("faqAbout.aboutSecurityTitle")}</h3>
          </div>
          <p>{t("faqAbout.aboutSecurityIntro")}</p>
          <ul>
            {securityPoints.map((point) => <li key={point}>{point}</li>)}
          </ul>
        </div>
      </section>
      <section className="mbw-about-section">
        <h3>{t("faqAbout.aboutCreditsTitle")}</h3>
        <p>{t("faqAbout.aboutCreditsPrefix")} <a href="https://matheusbonotto.com.br" target="_blank" rel="noreferrer">Matheus Bonotto</a>{t("faqAbout.aboutCreditsSuffix")}</p>
      </section>
    </>
  );
}

export function AboutWorkbench({ kind = "about" }) {
  const { t } = useTranslation();
  const isFaq = kind === "faq";
  function exportCsv() {
    if (isFaq) {
      const faqItems = t("faqAbout.faqItems", { returnObjects: true });
      downloadCsv(`faq-${dateStamp()}.csv`, [t("faqAbout.csvQuestion"), t("faqAbout.csvAnswer")], faqItems.map((item) => [item.q, item.a]));
      return;
    }
    const modules = t("faqAbout.modules", { returnObjects: true });
    const accessLevelRows = t("faqAbout.accessLevelRows", { returnObjects: true });
    const securityPoints = t("faqAbout.aboutSecurityPoints", { returnObjects: true });
    downloadCsv(`sobre-${dateStamp()}.csv`, [t("faqAbout.csvSection"), t("faqAbout.csvContent")], [
      [t("faqAbout.csvModules"), modules.map((item) => `${item.title}: ${item.text}`).join("\n")],
      [t("faqAbout.csvAccessLevels"), accessLevelRows.map((row) => `${row.level}: ${row.scope}`).join("\n")],
      [t("faqAbout.csvSecurity"), securityPoints.join("\n")],
      [t("faqAbout.csvCredits"), t("faqAbout.csvCreditsContent")]
    ]);
  }
  return (
    <section className="mbw-page">
      <WorkbenchHeader
        kicker="Stark Hub"
        title={isFaq ? t("pages.faq.title") : t("pages.about.title")}
        subtitle={isFaq ? t("pages.faq.subtitle") : t("pages.about.subtitle")}
        actions={<Button onClick={exportCsv}><i className="bi bi-download" /> {t("faqAbout.csvButton")}</Button>}
      />
      <div className="mb-settings-card-react wide">
        {isFaq ? <FaqContent /> : <AboutContent />}
      </div>
    </section>
  );
}
