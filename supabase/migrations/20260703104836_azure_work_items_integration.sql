-- Integração real com Azure DevOps (substitui os dados mock de "Meus itens"
-- e "QA Board"). Duas peças de estado que o Azure DevOps não tem nativamente
-- e que o app precisa manter por conta própria:

-- 1) "lastKnownState": snapshot do System.State do work item no momento em
-- que um responsável de QA foi atribuído. A Edge Function azureWorkItems
-- compara esse valor ao estado atual a cada sincronização e limpa
-- "qaCollaboratorId" automaticamente se o item mudou de estado desde a
-- atribuição — reproduz o comportamento do userscript legado (que fazia o
-- mesmo reset ao detectar qualquer mudança de System.State), que usava um
-- serviço externo (DatoCMS) para guardar essa associação.
alter table public.work_item_assignments
  add column if not exists "lastKnownState" text;

-- 2) Histórico de evidências de teste (Pass/Fail/Limitation). O userscript
-- legado escrevia isso como comentário nativo no work item (só funciona
-- porque ele rodava injetado na própria página do Azure DevOps); como o
-- Stark Hub é uma SPA à parte, guardamos o resultado direto no Supabase.
create table if not exists public.test_evidence (
  id uuid primary key default uuid_generate_v4(),
  "workItemId" bigint not null,
  result text not null check (result in ('pass', 'fail', 'limitation')),
  note text,
  "authorId" uuid references public.profiles(id) on delete set null,
  "createdAt" timestamptz not null default now()
);

comment on table public.test_evidence is 'Histórico de resultados de teste (Pass/Fail/Limitation) por work item, registrado pelo QA no Stark Hub.';

alter table public.test_evidence enable row level security;

drop policy if exists "test_evidence_read_authenticated" on public.test_evidence;
create policy "test_evidence_read_authenticated"
  on public.test_evidence for select using (auth.role() = 'authenticated');

drop policy if exists "test_evidence_write_qa_or_management" on public.test_evidence;
create policy "test_evidence_write_qa_or_management"
  on public.test_evidence for all
  using (public.current_access_level() in ('qa', 'gestao'));
