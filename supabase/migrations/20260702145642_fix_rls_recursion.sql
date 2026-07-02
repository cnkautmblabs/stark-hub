-- Corrige "infinite recursion detected in policy for relation profiles".
-- Causa: várias policies faziam `exists (select 1 from public.profiles ...)`
-- para checar se o usuário é gestão/qa. Como esse subselect também está
-- sujeito às policies de `profiles` (que por sua vez fazem o mesmo subselect
-- na própria tabela), o Postgres entra em loop ao avaliar a policy.
-- Solução padrão: mover a checagem para uma função SECURITY DEFINER, que
-- roda com o dono da tabela (bypassa RLS internamente) e quebra o ciclo.
create or replace function public.current_access_level()
returns access_level
language sql
security definer
stable
set search_path = public
as $$
  select "accessLevel" from public.profiles where id = auth.uid();
$$;

drop policy if exists "profiles_select_own_or_management" on public.profiles;
create policy "profiles_select_own_or_management"
  on public.profiles for select
  using (auth.uid() = id or public.current_access_level() = 'gestao');

drop policy if exists "profiles_management_full_update" on public.profiles;
create policy "profiles_management_full_update"
  on public.profiles for update
  using (public.current_access_level() = 'gestao');

drop policy if exists "feature_flags_write_management" on public.feature_flags;
create policy "feature_flags_write_management"
  on public.feature_flags for all
  using (public.current_access_level() = 'gestao');

drop policy if exists "collaborators_write_management" on public.collaborators;
create policy "collaborators_write_management"
  on public.collaborators for all
  using (public.current_access_level() = 'gestao');

drop policy if exists "work_items_write_qa_or_management" on public.work_item_assignments;
create policy "work_items_write_qa_or_management"
  on public.work_item_assignments for all
  using (public.current_access_level() in ('qa', 'gestao'));

drop policy if exists "app_settings_write_management" on public.app_settings;
create policy "app_settings_write_management"
  on public.app_settings for all
  using (public.current_access_level() = 'gestao');

drop policy if exists "audit_log_read_management" on public.audit_log;
create policy "audit_log_read_management"
  on public.audit_log for select
  using (public.current_access_level() = 'gestao');
