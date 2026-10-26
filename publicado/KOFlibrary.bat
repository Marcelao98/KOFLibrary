@echo off
rem KOFlibrary no Windows: abre o KOFlibrary.html numa janela de app do Edge (sem barra de endereco)
cd /d "%~dp0"
start "" msedge --app="file:///%cd:\=/%/KOFlibrary.html"
if errorlevel 1 start "" "KOFlibrary.html"
