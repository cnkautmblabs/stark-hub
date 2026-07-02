import React from "react";

const faqItems = [
  { q: "Como meu acesso é liberado?", a: "Após o primeiro login com Google, sua conta fica com status 'Aguardando liberação'. Um usuário de Gestão precisa definir seu nível de acesso (Dev, QA ou Gestão) na tela de Colaboradores." },
  { q: "Posso usar qualquer conta Google?", a: "Não. Somente e-mails dos domínios @mblabs.com.br e @bankeiro.com.br são aceitos." },
  { q: "O que é o Modo demonstração?", a: "Um modo com dados fictícios para explorar as telas sem precisar de um projeto Supabase configurado." },
  { q: "Como o QA testa uma tarefa?", a: "Ao abrir um card, um painel em iframe é exibido para realizar o teste sem sair da página." }
];

export default function Faq() {
  return (
    <div className="stark-card" style={{ maxWidth: 640 }}>
      <h3>Perguntas frequentes</h3>
      <div className="accordion mt-3">
        {faqItems.map((item, index) => (
          <details key={index} className="mb-2">
            <summary className="fw-semibold" style={{ cursor: "pointer" }}>{item.q}</summary>
            <p className="text-muted mt-2">{item.a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
