import { useState } from "react";
import { Button, WorkbenchHeader } from "../ui/WorkbenchPrimitives.jsx";
import { dateStamp, downloadCsv } from "../../../utils/csvExport.js";

const faqItems = [
  {
    q: "De onde vêm os dados do Stark Hub?",
    a: "Work items (bugs, tasks, user stories) vêm do Azure DevOps através de Edge Functions do Supabase — o frontend nunca fala direto com a API do Azure, nem guarda PAT no navegador. Evidências de teste, colaboradores, configurações e conexões pessoais ficam no Supabase (ou em localStorage, no modo demonstração)."
  },
  {
    q: "O que é o modo demonstração?",
    a: "É um ambiente 100% fictício — três perfis (Dev, QA, Gestão) com dados de exemplo gerados localmente, sem qualquer conexão real com Azure DevOps ou Supabase. Nada que você editar em modo demo é salvo em servidor; tudo fica em localStorage e pode ser descartado a qualquer momento. Use para explorar o app sem precisar de conta."
  },
  {
    q: "Qual a diferença entre Quality Board, Meus itens e Testes?",
    a: "Quality Board é a visão geral de todos os work items em fluxo de QA (In QA, In BETA, Ready to Beta, Ready to Prod), com filtros e gráficos por país/ambiente/QA responsável. Meus itens é a visão pessoal — para Dev, os cards atribuídos a você; para QA, além dos atribuídos, os cards em que você é QA responsável ou já registrou resultado. Testes foi fundido dentro de Meus itens: os resultados de evidência (Approved/Fail/Limitation) aparecem direto nos cards, sem uma tela separada."
  },
  {
    q: "Como funciona o registro de resultado de teste?",
    a: "Ao abrir um Work Item, o modal permite registrar o resultado (Approved, Fail ou Limitation), uma nota e o próximo status do card. O registro fica salvo como evidência (Supabase ou discussion do Azure DevOps, dependendo da configuração) e pode disparar notificação no Slack, se configurado."
  },
  {
    q: "Por que às vezes preciso abrir o Work Item em nova aba?",
    a: "O Azure DevOps bloqueia a exibição da tela de edição dentro de iframe por política de segurança do próprio Azure. Por isso o acesso direto em nova aba (usando sua sessão já logada no navegador) é o caminho principal; o registro de resultado continua disponível aqui no Stark Hub, independente da aba do Azure."
  },
  {
    q: "Quem pode ver o quê? (níveis de acesso)",
    a: "Dev vê Meus itens, Horas e Configurações pessoais. QA vê tudo que Dev vê, mais Quality Board e o modo QA de Meus itens (cards atribuídos + QA responsável + testados por você). Gestão vê tudo, mais Governança do time, Colaboradores, Import Work Items e as configurações globais (Produto, Funcionalidades, Conexões e Governança)."
  },
  {
    q: "Onde ficam minhas conexões pessoais (Azure, pipelines, Slack)?",
    a: "Dev e QA configuram seu Azure DevOps pessoal pelo perfil (Colaboradores/Minha conta) e pipelines/Slack pessoais ficam salvos no localStorage do navegador, por usuário — não em um servidor compartilhado. Gestão configura as conexões globais, que valem para todo o time, e ficam salvas no Supabase (tabela app_settings)."
  },
  {
    q: "Meus dados de conexão pessoal aparecem para outras pessoas?",
    a: "Não. Conexões pessoais (PAT, pipelines, webhook Slack pessoal) ficam isoladas por navegador/usuário em localStorage e nunca são enviadas para o Supabase nem aparecem em exports feitos por outro nível de acesso."
  },
  {
    q: "Como funciona Governança do time?",
    a: "Cruza work items com colaboradores para mostrar horas registradas x meta, cards com e sem apontamento, distribuição por país e a matriz Colaborador x País. Tem relatório executivo com botão de copiar (texto, para colar no Slack) e exportar PDF, além de filtros por colaborador, tipo, sprint e status da meta."
  },
  {
    q: "O que é o Sprint atual / 'Board' nos filtros?",
    a: "O Stark Hub calcula automaticamente a sprint vigente com base na data de hoje e a marca como padrão nos filtros de Quality Board, Meus itens e Governança. Você pode trocar para outra sprint (ou um intervalo De/Até) a qualquer momento — o filtro fica destacado quando difere da sprint atual."
  },
  {
    q: "Posso exportar ou importar minhas configurações?",
    a: "Sim. Dev e QA exportam/importam apenas suas conexões pessoais. Gestão exporta/importa por escopo (Produto, Funcionalidades, Conexões, Governança) separadamente. Um arquivo de um nível de acesso é rejeitado se um usuário de outro nível tentar importá-lo, e exports de Gestão nunca incluem PAT nem webhook secreto compartilhado."
  },
  {
    q: "Encontrei um bug ou tenho uma sugestão. O que faço?",
    a: "Fale com Matheus Bonotto (QA, mblabs) — rodapé do app ou aba Perfil. Se preferir, registre como um Bug no próprio Azure DevOps do time; o Stark Hub vai puxar automaticamente para o Quality Board assim que sincronizar."
  }
];

function FaqContent() {
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

const modules = [
  { icon: "bi-check-square", title: "Quality Board", text: "Visão geral dos work items em fluxo de QA, com filtros, gráficos de status por ambiente/país e métricas por QA responsável." },
  { icon: "bi-person-workspace", title: "Meus itens", text: "Cards pessoais (Dev) ou cards atribuídos + QA responsável + testados por você (QA), com resultados de teste integrados." },
  { icon: "bi-shield-check", title: "Governança do time", text: "Horas x meta, cards sem apontamento, distribuição por país e relatório executivo para Gestão." },
  { icon: "bi-people", title: "Colaboradores", text: "Identidade, avatar, papéis (Dev/QA/Gestão) e aliases usados para cruzar dados do Azure com evidências de teste." },
  { icon: "bi-cloud-arrow-down", title: "Import Work Items", text: "Importação de hierarquia de work items do Azure DevOps com pré-visualização antes de confirmar." },
  { icon: "bi-gear", title: "Configurações", text: "Conexões pessoais (Dev/QA) ou globais (Gestão): Azure DevOps, pipelines, Slack e metas de governança." }
];

const accessLevelRows = [
  { level: "Dev", scope: "Meus itens, Horas e Configurações pessoais." },
  { level: "QA", scope: "Tudo do Dev, mais Quality Board e o modo QA de Meus itens." },
  { level: "Gestão", scope: "Acesso completo: Produto, Governança, Colaboradores, Import e Conexões globais." }
];

function AboutContent() {
  return (
    <>
      <section className="mbw-about-section">
        <h3>O que é o Stark Hub</h3>
        <p>Stark Hub é a plataforma interna de governança, QA e produtividade da equipe, construída a partir do fluxo de trabalho real com Azure DevOps. Ela reúne em um só lugar o que antes vivia espalhado entre o board do Azure, planilhas de horas e conversas no Slack: acompanhamento de QA, meus itens do dia a dia, horas de trabalho e governança do time.</p>
        <p>O frontend React é uma reconstrução componentizada do protótipo <code>stark-hub-script</code>, preservando login, autenticação e a navegação lateral, com cada módulo pós-login isolado em componentes próprios.</p>
      </section>
      <section className="mbw-about-section">
        <h3>Módulos</h3>
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
        <h3>Níveis de acesso</h3>
        <table className="mbw-about-table">
          <tbody>
            {accessLevelRows.map((row) => (
              <tr key={row.level}><td><strong>{row.level}</strong></td><td>{row.scope}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="mbw-about-section">
        <h3>Segurança e privacidade</h3>
        <p>Azure DevOps é sempre acessado via backend (Edge Functions); nenhum PAT fica hardcoded ou exposto no bundle do frontend. Conexões pessoais (Dev/QA) ficam em localStorage, isoladas por usuário e navegador. Configurações globais (Gestão) ficam no Supabase, protegidas por policy. Detalhes completos em <code>docs/security-hardening.md</code>.</p>
      </section>
      <section className="mbw-about-section">
        <h3>Créditos</h3>
        <p>Desenvolvido por <a href="https://matheusbonotto.com.br" target="_blank" rel="noreferrer">Matheus Bonotto</a>, QA na mblabs.</p>
      </section>
    </>
  );
}

export function AboutWorkbench({ kind = "about" }) {
  const isFaq = kind === "faq";
  function exportCsv() {
    if (isFaq) {
      downloadCsv(`faq-${dateStamp()}.csv`, ["Pergunta", "Resposta"], faqItems.map((item) => [item.q, item.a]));
      return;
    }
    downloadCsv(`sobre-${dateStamp()}.csv`, ["Secao", "Conteudo"], [
      ["Modulos", modules.map((item) => `${item.title}: ${item.text}`).join("\n")],
      ["Niveis de acesso", accessLevelRows.map((row) => `${row.level}: ${row.scope}`).join("\n")],
      ["Seguranca", "Azure via backend, conexoes pessoais locais e configuracoes globais protegidas por policy."],
      ["Creditos", "Desenvolvido por Matheus Bonotto, QA na mblabs."]
    ]);
  }
  return (
    <section className="mbw-page">
      <WorkbenchHeader
        kicker="Stark Hub"
        title={isFaq ? "FAQ" : "Sobre"}
        subtitle={isFaq ? "Perguntas frequentes sobre módulos, dados e acesso." : "O que é o Stark Hub, como é organizado e quem pode ver o quê."}
        actions={<Button onClick={exportCsv}><i className="bi bi-download" /> CSV</Button>}
      />
      <div className="mb-settings-card-react wide">
        {isFaq ? <FaqContent /> : <AboutContent />}
      </div>
    </section>
  );
}
