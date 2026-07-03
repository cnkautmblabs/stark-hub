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
1. Conectar as páginas Dev/QA à API real do Azure DevOps (hoje usam dados mock).
2. Implementar a tela de edição de colaboradores e feature flags (hoje são somente leitura).
3. Portar o histórico de evidências de teste e relatórios executivos completos.
4. Testar as políticas de RLS com usuários reais de cada nível de acesso.
5. Gerar ícones PNG (192/512) reais para o manifest do PWA (o SVG incluso já funciona como fallback).

## Configuração
1. Crie um projeto em https://supabase.com.
2. No SQL Editor, execute todo o conteúdo de `supabase/schema.sql`.
3. Em Authentication → Providers, habilite o Google e configure o OAuth Client (Google Cloud Console).
4. Copie `.env.example` para `.env.local` e preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
5. Em Authentication → URL Configuration, configure:
   - Site URL: `https://cnkautmblabs.github.io/stark-hub/`
   - Redirect URLs: `https://cnkautmblabs.github.io/stark-hub/**`
   - Para desenvolvimento local, adicione também `http://localhost:5173/**`.
6. Rode `run.bat` (Windows) ou `npm install && npm run dev`.

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
