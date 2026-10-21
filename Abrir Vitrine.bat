@echo off
chcp 65001 >nul
title Vitrine
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  O Vitrine precisa do Node.js para funcionar.
  echo  Vou abrir a pagina de download. Instale a versao LTS e depois abra este arquivo de novo.
  echo.
  start "" "https://nodejs.org/pt-br/download"
  pause
  exit /b
)
node server.js
pause
