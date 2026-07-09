import React from "react";

// Rodapé discreto de crédito — aparece na tela de login (fundo sempre escuro).
export default function BrandFooter({ collapsed = false }) {
  const logoSrc = `${import.meta.env.BASE_URL}icons/mblabs-branco.png`;
  return (
    <div className="stark-brand-footer">
      {!collapsed && (
        <p className="stark-brand-footer-text">
          Desenvolvido por{" "}
          <a href="https://matheusbonotto.com.br" target="_blank" rel="noreferrer">Matheus Bonotto</a>
          , QA <img className="stark-brand-footer-logo" src={logoSrc} alt="mb.labs" />
        </p>
      )}
    </div>
  );
}
