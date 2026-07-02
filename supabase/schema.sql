-- ============================================================
-- STARK HUB — SCHEMA SQL COMPLETO
-- Execute este arquivo inteiro no SQL editor do seu projeto Supabase.
-- Convenções: camelCase para colunas, nomes claros, comentários
-- explicando o propósito de cada objeto (regras de desenvolvimento
-- solicitadas pelo usuário).
-- ============================================================

-- Extensões necessárias
create extension if not exists "uuid-ossp";

-- ------------------------------------------------------------
-- ENUM: nível de acesso do usuário
-- ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'access_level') then
    create type access_level as enum ('pending', 'dev', 'qa', 'gestao');
  end if;
end $$;

-- ------------------------------------------------------------
-- TABELA: profiles
-- Estende auth.users com dados exibidos na interface e nível de acesso.
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  "fullName" text not null,
  "aliasAzure" text,
  "aliasSlack" text,
  "aliasVariations" text[] default '{}',
  "displayName" text,
  "avatarUrl" text,
  "accessLevel" access_level not null default 'pending',
  "isAdmin" boolean not null default false,
  "azureOrgUrl" text,
  "azureProject" text,
  "azurePat" text,
  "azureVerifiedAt" timestamptz,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

comment on table public.profiles is 'Perfil de cada usuário autenticado via Google OAuth, com nível de acesso do Stark Hub.';
comment on column public.profiles."azurePat" is 'Personal Access Token do Azure DevOps do próprio usuário. Obrigatório e validado antes do uso do app (fora do modo demonstração). Nunca exposto fora do dono do perfil (RLS) nem logado.';

-- ------------------------------------------------------------
-- TABELA: feature_flags
-- Permite habilitar/desabilitar funcionalidades sem novo deploy.
-- ------------------------------------------------------------
create table if not exists public.feature_flags (
  key text primary key,
  enabled boolean not null default true,
  description text,
  "updatedAt" timestamptz not null default now()
);

insert into public.feature_flags (key, enabled, description) values
  ('showQaBoard', true, 'Exibe o módulo QA Board no menu.'),
  ('showMyItems', true, 'Exibe o módulo Meus itens (Dev) no menu.'),
  ('showGovernance', true, 'Exibe o módulo de Governança (Gestão) no menu.'),
  ('enableBulkEdit', true, 'Permite edição em massa de work items.')
on conflict (key) do nothing;

-- ------------------------------------------------------------
-- TABELA: collaborators
-- Diretório único de colaboradores (nome no Azure, Slack, cor, avatar).
-- ------------------------------------------------------------
create table if not exists public.collaborators (
  id uuid primary key default uuid_generate_v4(),
  "profileId" uuid references public.profiles(id) on delete set null,
  "azureName" text,
  "slackName" text,
  "slackMemberId" text,
  color text default '#0ea5e9',
  "imageUrl" text,
  "isQa" boolean default false,
  "isDev" boolean default true,
  "isManagement" boolean default false,
  "createdAt" timestamptz not null default now()
);

-- ------------------------------------------------------------
-- TABELA: work_item_assignments
-- Vincula um work item do Azure DevOps (armazenado só pelo ID) a um
-- responsável de QA e metadados usados pelo painel (país, ambiente).
-- ------------------------------------------------------------
create table if not exists public.work_item_assignments (
  "workItemId" bigint primary key,
  "qaCollaboratorId" uuid references public.collaborators(id) on delete set null,
  countries text[] default '{}',
  "updatedAt" timestamptz not null default now()
);

-- ------------------------------------------------------------
-- TABELA: audit_log
-- Registro de alterações sensíveis (mudança de nível de acesso, etc.)
-- ------------------------------------------------------------
create table if not exists public.audit_log (
  id uuid primary key default uuid_generate_v4(),
  "actorId" uuid references public.profiles(id) on delete set null,
  action text not null,
  details jsonb,
  "createdAt" timestamptz not null default now()
);

-- ------------------------------------------------------------
-- TABELA: app_settings
-- Configurações customizáveis por Gestão/Admin (ex.: quais campos são
-- multiselect/obrigatórios em determinados formulários).
-- ------------------------------------------------------------
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  "updatedAt" timestamptz not null default now()
);

-- ============================================================
-- FUNÇÃO E TRIGGER: criação automática de perfil no primeiro login
-- Valida domínio de e-mail e concede acesso administrativo total
-- ao e-mail definido como administrador do projeto.
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  email_domain text;
  allowed_domains text[] := array['mblabs.com.br', 'bankeiro.com.br'];
  admin_email text := 'matheus.bonotto@mblabs.com.br';
begin
  email_domain := split_part(new.email, '@', 2);

  if not (email_domain = any(allowed_domains)) then
    raise exception 'Domínio de e-mail não autorizado: %', new.email;
  end if;

  insert into public.profiles (id, email, "fullName", "displayName", "avatarUrl", "accessLevel", "isAdmin")
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.raw_user_meta_data->>'avatar_url',
    case when lower(new.email) = lower(admin_email) then 'gestao'::access_level else 'pending'::access_level end,
    lower(new.email) = lower(admin_email)
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.profiles enable row level security;
alter table public.feature_flags enable row level security;
alter table public.collaborators enable row level security;
alter table public.work_item_assignments enable row level security;
alter table public.audit_log enable row level security;
alter table public.app_settings enable row level security;

-- Checagem de nível de acesso usada pelas policies abaixo. Precisa ser
-- SECURITY DEFINER (roda com o dono da tabela, que por padrão não sofre RLS)
-- para não recursar: um `exists (select ... from profiles ...)` direto dentro
-- da própria policy de `profiles` reaplicaria essa mesma policy indefinidamente
-- ("infinite recursion detected in policy for relation profiles").
create or replace function public.current_access_level()
returns access_level
language sql
security definer
stable
set search_path = public
as $$
  select "accessLevel" from public.profiles where id = auth.uid();
$$;

-- profiles: usuário vê e edita campos cosméticos do próprio perfil.
create policy "profiles_select_own_or_management"
  on public.profiles for select
  using (auth.uid() = id or public.current_access_level() = 'gestao');

create policy "profiles_update_own_cosmetic_fields"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "profiles_management_full_update"
  on public.profiles for update
  using (public.current_access_level() = 'gestao');

-- feature_flags: leitura para todos autenticados; escrita só Gestão.
create policy "feature_flags_read_all_authenticated"
  on public.feature_flags for select
  using (auth.role() = 'authenticated');

create policy "feature_flags_write_management"
  on public.feature_flags for all
  using (public.current_access_level() = 'gestao');

-- collaborators / work_item_assignments / app_settings: leitura para
-- autenticados com acesso liberado; escrita restrita à Gestão.
create policy "collaborators_read_authenticated"
  on public.collaborators for select using (auth.role() = 'authenticated');
create policy "collaborators_write_management"
  on public.collaborators for all
  using (public.current_access_level() = 'gestao');

create policy "work_items_read_authenticated"
  on public.work_item_assignments for select using (auth.role() = 'authenticated');
create policy "work_items_write_qa_or_management"
  on public.work_item_assignments for all
  using (public.current_access_level() in ('qa', 'gestao'));

create policy "app_settings_read_authenticated"
  on public.app_settings for select using (auth.role() = 'authenticated');
create policy "app_settings_write_management"
  on public.app_settings for all
  using (public.current_access_level() = 'gestao');

-- audit_log: somente Gestão lê; inserções feitas via service role/functions.
create policy "audit_log_read_management"
  on public.audit_log for select
  using (public.current_access_level() = 'gestao');

-- ============================================================
-- Fim do schema. Após executar, configure o provedor Google em
-- Authentication > Providers e restrinja o Authorized Domain conforme
-- necessário no console do Google Cloud.
-- ============================================================
