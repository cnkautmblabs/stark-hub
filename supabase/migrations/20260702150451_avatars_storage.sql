-- Bucket público para fotos de perfil dos colaboradores. Caminho dos arquivos:
-- "{ownerId}/{arquivo}" — ownerId é o profileId do dono da conta (quando existe)
-- ou o próprio id do colaborador (para entradas só-Azure, sem conta vinculada).
-- Leitura é pública (bucket public=true); escrita é restrita ao próprio dono
-- da pasta ou a usuários de Gestão (podem atualizar a foto de qualquer um).
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatars_read_public" on storage.objects;
create policy "avatars_read_public"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "avatars_write_own_or_management" on storage.objects;
create policy "avatars_write_own_or_management"
  on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.current_access_level() = 'gestao')
  );

drop policy if exists "avatars_update_own_or_management" on storage.objects;
create policy "avatars_update_own_or_management"
  on storage.objects for update
  using (
    bucket_id = 'avatars'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.current_access_level() = 'gestao')
  );

drop policy if exists "avatars_delete_own_or_management" on storage.objects;
create policy "avatars_delete_own_or_management"
  on storage.objects for delete
  using (
    bucket_id = 'avatars'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.current_access_level() = 'gestao')
  );
