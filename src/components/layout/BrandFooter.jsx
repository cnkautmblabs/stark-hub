import React from "react";

// Rodapé discreto de crédito — aparece no app (sidebar) e na tela de login.
export default function BrandFooter({ collapsed = false }) {
  return (
    <div className="stark-brand-footer">
      <img
        src="https://mblabs.com.br/wp-content/uploads/2026/03/Logo_interno_01.png"
        alt="mblabs"
        className="stark-brand-footer-logo"
      />
      {!collapsed && (
        <p className="stark-brand-footer-text">
          Desenvolvido por{" "}
          <a href="https://matheusbonotto.com.br" target="_blank" rel="noreferrer">Matheus Bonotto</a>
          , QA mblabs + Claude Code
        </p>
      )}
    </div>
  );
}
