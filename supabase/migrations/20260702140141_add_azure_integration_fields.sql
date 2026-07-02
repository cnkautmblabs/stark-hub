-- Campos de integração obrigatória com Azure DevOps: cada usuário real
-- (fora do modo demonstração) precisa configurar e validar essas credenciais
-- antes de usar o app. "azureVerifiedAt" é preenchido somente após um teste
-- de conexão bem-sucedido (ver edge function testAzureConnection).
alter table public.profiles
  add column if not exists "azureOrgUrl" text,
  add column if not exists "azureProject" text,
  add column if not exists "azurePat" text,
  add column if not exists "azureVerifiedAt" timestamptz;
