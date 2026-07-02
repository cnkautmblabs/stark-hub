import React from "react";

export default function About() {
  return (
    <div className="stark-card" style={{ maxWidth: 640 }}>
      <h3>Sobre o Stark Hub</h3>
      <p className="text-muted">
        Stark Hub centraliza o trabalho de Desenvolvimento, QA e Gestão em um único
        painel: acompanhamento de itens, testes, resultados, métricas de governança
        e relatórios executivos — substituindo o antigo userscript de navegador por
        uma aplicação web própria (React + Supabase), com autenticação Google restrita
        à organização.
      </p>
      <footer className="text-muted small mt-4 pt-3 border-top">
        Stark Hub — desenvolvido por Matheus Bonotto.
      </footer>
    </div>
  );
}
