# Stark Hub

Painel de governança, QA e produtividade (React + Vite + Supabase), substituindo
o antigo userscript "MB Azure Workbench". Este pacote é a **fundação inicial**
do projeto: arquitetura, autenticação, RBAC, tema claro/escuro, feature flags,
schema SQL completo e páginas de exemplo por perfil (Dev, QA, Gestão).

## O que já está pronto
- Login com Google (Supabase Auth), restrito aos domínios `@mblabs.com.br` e `@bankeiro.com.br`.
- Tela de "aguardando liberação" para usuários sem nível de acesso.
- Sidebar retrátil com ícones (react-icons) + rótulos ocultáveis, modo claro/escuro.
- Contextos de autenticação, tema e feature flags.
- Componentes reutilizáveis: `MultiSelectFilter`, `PeriodFilter` (Hoje/7d/30d/Custom), `Skeleton`, `IframeTaskModal`.
- Páginas por perfil: Meus itens (Dev), QA Board com abertura de tarefa em iframe, Governança e Colaboradores (Gestão), Configurações, FAQ, Sobre.
- **Integração real com Azure DevOps** (Edge Functions `azureWorkItems`/`azureWorkItemAction`): busca de work items via WIQL, ambiente/país derivados de estado e tags (`0-XX`), horas via `Microsoft.VSTS.Scheduling.CompletedWork`, avanço de ambiente e edição em massa gravando de volta no Azure DevOps, criação de novo item. Responsável de QA e histórico de evidências (Pass/Fail/Limitation) vivem no próprio Supabase (`work_item_assignments`, `test_evidence`), já que isso nunca foi nativo do Azure DevOps — a associação de QA é limpa automaticamente sempre que o estado do item muda, replicando o comportamento do userscript legado.
- Modo demonstração com dados mock (funciona sem Supabase configurado).
- `schema.sql` completo: tabelas, enum de nível de acesso, trigger que cria o perfil automaticamente no primeiro login (validando domínio e liberando acesso total ao e-mail administrador), RLS por tabela.
- Edge Function `keepAlive` para manter o projeto Supabase ativo.
- PWA configurada (manifest + vite-plugin-pwa).
- `run.bat` para rodar localmente no Windows.

## O que ainda precisa ser construído (próximos passos)
Este é um esqueleto funcional, não uma migração 100% completa do userscript
original (que tem milhares de linhas: QA Board completo com Pipelines/PR
tracking, histórico de evidências, relatórios em PDF, edição em massa, etc.).
Sugestão de próximos passos, em ordem:
1. Badges de Pull Request e Pipeline nos cards do QA Board (o userscript legado usava `_apis/git/pullrequests` e `_apis/build/builds`; precisa que o PAT tenha os escopos `Code: Read` e `Build: Read` além de `Work Items: Read & write`).
2. Implementar a tela de edição de colaboradores e feature flags (hoje são somente leitura).
3. Relatórios executivos em PDF (o userscript legado montava o PDF na mão, byte a byte — vale usar uma biblioteca de verdade, ex. `jspdf`/`pdf-lib`) e notificação no Slack quando um item chega a "Ready to Beta"/"HMG CNK" (recomendado como Edge Function acionada por trigger no Postgres, não fire-and-forget do navegador como no script antigo).
4. Testar as políticas de RLS com usuários reais de cada nível de acesso.
5. Gerar ícones PNG (192/512) reais para o manifest do PWA (o SVG incluso já funciona como fallback).

## Configuração
1. Crie um projeto em https://supabase.com.
2. No SQL Editor, execute todo o conteúdo de `supabase/schema.sql` e, em seguida, cada arquivo em `supabase/migrations/` na ordem do nome (contém, entre outras coisas, a tabela `test_evidence` e a integração real com Azure DevOps).
3. Em Authentication → Providers, habilite o Google e configure o OAuth Client (Google Cloud Console).
4. Copie `.env.example` para `.env.local` e preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
5. Em Authentication → URL Configuration, configure:
   - Site URL: `https://cnkautmblabs.github.io/stark-hub/`
   - Redirect URLs: `https://cnkautmblabs.github.io/stark-hub/**`
   - Para desenvolvimento local, adicione também `http://localhost:5173/**`.
6. Faça deploy das Edge Functions: `supabase functions deploy testAzureConnection`, `supabase functions deploy azureWorkItems`, `supabase functions deploy azureWorkItemAction` e `supabase functions deploy keepAlive`.
7. Rode `run.bat` (Windows) ou `npm install && npm run dev`.

### Personal Access Token do Azure DevOps
Cada usuário cadastra seu próprio PAT em Configurações (obrigatório antes de usar o app fora do modo demonstração). Ele precisa dos escopos:
- **Work Items**: Read & write
- **Build**: Read (necessário para os badges de Pipeline, ainda não implementados — ver "próximos passos")
- **Code**: Read (necessário para os badges de Pull Request, ainda não implementados)

## Deploy no GitHub Pages
```
npm run build
npm run deploy
```
Ajuste `base` em `vite.config.js` para `/nome-do-repositorio/`.

## Segurança
- Nunca commite `.env` / `.env.local` (já estão no `.gitignore`).
- A restrição de domínio é validada tanto no trigger SQL (`handle_new_user`) quanto no cliente (`AuthContext`), mas a configuração definitiva deve ser feita também no Google Cloud Console (Authorized Domains) e nas policies de RLS.

## Créditos
Stark Hub — desenvolvido por Matheus Bonotto.
