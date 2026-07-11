# Checklist Cerqueira

## Seguranca e tranquilidade para uso publico

- [x] Fazer analise critica da solicitacao e priorizar correcoes robustas.
- [x] Atualizar a secao de seguranca informando que o bundle usa obfuscator.
- [x] Atualizar FAQ com as novas garantias de seguranca.
- [x] Atualizar About/Sobre com as novas garantias de seguranca.
- [x] Fazer deploy para GitHub Pages apos as correcoes.

## Acesso, cache e privacidade

- [x] Se o usuario logado for Dev ou QA e nao for Admin, nao listar/salvar no localStorage dados de outros membros.
- [x] Planejar migracao de niveis de acesso/funcoes para role unica em vez de varios booleanos.

## Recorrencias

- [x] Adicionar recorrencia por periodo customizado.
- [x] Suportar recorrencia diaria.
- [x] Suportar recorrencia semanal.
- [x] Suportar recorrencia mensal.
- [x] Suportar recorrencia por dia da semana.
- [x] Suportar recorrencia a cada tantos dias.

## API e Supabase

- [ ] Evitar query do Supabase exposta em URL quando possivel.
- [x] Planejar migracao de queries diretas para functions/RPC.
- [x] Planejar camada de API com chamadas get/post em vez de selects diretos espalhados no frontend.

### Plano tecnico registrado

- Canonizar permissoes em uma coluna/claim `role` (`pending`, `dev`, `qa`, `gestao`, `gerente`, `admin`) e manter `isDev/isQa/isManagement/isAdmin` apenas como compatibilidade temporaria ate as telas migrarem.
- Priorizar Edge Functions/RPC para consultas sensiveis (`collaborators_profile`, `app_settings`, evidencias e acoes Azure), com payload via `POST`/headers e contratos pequenos por tela.
- Manter direct select apenas para dados publicos/baixo risco durante a migracao, sempre com RLS no banco como protecao principal.

## Validacao

- [x] Rodar build.
- [x] Rodar auditoria de dependencias.
- [x] Publicar GitHub Pages.
