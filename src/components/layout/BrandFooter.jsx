import React from "react";

// Rodapé discreto de crédito — aparece na tela de login (fundo sempre escuro).
export default function BrandFooter({ collapsed = false }) {
  const base = import.meta.env.BASE_URL;
  const logoSrc = `${base}icons/mblabs-branco.png`;
  const bonottoLogoSrc = `${base}icons/Bonotto-logo-branco.png`;
  return (
    <div className="stark-brand-footer">
      {!collapsed && (
        <p className="stark-brand-footer-text">
          Desenvolvido por{" "}
          <img className="stark-brand-footer-logo" src={bonottoLogoSrc} alt="" />{" "}
          <a href="https://matheusbonotto.com.br" target="_blank" rel="noreferrer">Matheus Bonotto</a>
          , QA <img className="stark-brand-footer-logo" src={logoSrc} alt="mb.labs" />
        </p>
      )}
    </div>
  );
}
