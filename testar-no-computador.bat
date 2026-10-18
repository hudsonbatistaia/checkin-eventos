@echo off
chcp 65001 >nul
title Check-in de Eventos - teste no computador
rem Liga o sistema de teste (dados ficticios, banco que comeca vazio) e abre o navegador.
rem Os arquivos de teste rodam numa pasta fora do OneDrive (mais rapido).

set "PROJETO=%~dp0"
set "TESTE=%LOCALAPPDATA%\checkin-eventos-teste"

netstat -ano | findstr /R /C:":3999 .*LISTENING" >nul
if not errorlevel 1 (
  echo.
  echo A porta 3999 ja esta em uso por outro programa.
  echo Feche a outra janela "Check-in de Eventos - servidor" e tente de novo.
  echo.
  pause
  exit /b 1
)

if not exist "%TESTE%" mkdir "%TESTE%"
copy /Y "%PROJETO%testes\*.mjs" "%TESTE%\" >nul
copy /Y "%PROJETO%testes\package.json" "%TESTE%\" >nul

if not exist "%TESTE%\node_modules\@electric-sql" (
  echo Preparando pela primeira vez, aguarde um pouco...
  pushd "%TESTE%"
  call npm install --silent
  popd
)

echo Ligando o sistema de teste...
start "Check-in de Eventos - servidor" /D "%TESTE%" cmd /k node servidor-teste.mjs
timeout /t 5 /nobreak >nul
start "" "http://localhost:3999"

echo.
echo Pronto! O sistema abriu no navegador: http://localhost:3999
echo   Usuario: hudson
echo   Senha:   Senha-Hudson-123
echo.
echo Para desligar, feche a janela "Check-in de Eventos - servidor".
echo Ao desligar, os dados de teste sao apagados (o banco comeca vazio de novo).
echo.
pause
