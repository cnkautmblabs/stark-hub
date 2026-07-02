@echo off
echo ============================================
echo   Stark Hub - inicializando ambiente local
echo ============================================
where node >nul 2>nul
if %errorlevel% neq 0 (
  echo Node.js nao encontrado. Instale em https://nodejs.org antes de continuar.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Instalando dependencias...
  call npm install
)
if not exist .env.local (
  echo Criando .env.local a partir de .env.example...
  copy .env.example .env.local
  echo IMPORTANTE: edite .env.local com as chaves do seu projeto Supabase.
)
echo Iniciando servidor de desenvolvimento...
call npm run dev
pause
