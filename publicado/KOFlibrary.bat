@echo off
rem KOFlibrary no Windows: atualiza pelo GitHub (igual ao KOFstation) e abre o KOFlibrary.html
rem numa janela de app do Edge (sem barra de endereco). Um arquivo "nao-atualizar" do lado desliga a atualizacao.
setlocal EnableDelayedExpansion
cd /d "%~dp0"
set "BASE=https://raw.githubusercontent.com/Marcelao98/KOFLibrary/main/publicado"
if exist "nao-atualizar" goto abrir
where curl >nul 2>&1 || goto abrir
curl -fsSL --connect-timeout 8 --max-time 15 -o ".versao.novo" "%BASE%/versao.txt" 2>nul || goto abrir
set "NOVA=0" & set "ATUAL=0" & set "TAM="
for /f "tokens=2 delims==" %%v in ('findstr /b "versao=" ".versao.novo"') do set "NOVA=%%v"
if exist "versao.txt" for /f "tokens=2 delims==" %%v in ('findstr /b "versao=" "versao.txt"') do set "ATUAL=%%v"
for /f "tokens=2 delims=:" %%v in ('findstr /b "html=" ".versao.novo"') do set "TAM=%%v"
rem os numeros (AAAAMMDDHHMM) tem o mesmo tamanho: comparar como texto da certo
if "!NOVA!" GTR "!ATUAL!" (
    echo Baixando o KOFlibrary novo ^(!NOVA!^)...
    curl -fsSL --connect-timeout 8 --max-time 120 -o ".KOFlibrary.html.novo" "%BASE%/KOFlibrary.html" 2>nul
    for %%f in (".KOFlibrary.html.novo") do if "%%~zf"=="!TAM!" (
        move /y ".KOFlibrary.html.novo" "KOFlibrary.html" >nul
        copy /y ".versao.novo" "versao.txt" >nul
        echo %date% %time% atualizado: !ATUAL! -^> !NOVA!>>atualizacao.log
    )
)
del ".versao.novo" ".KOFlibrary.html.novo" 2>nul
:abrir
set "PAGINA=%cd:\=/%/KOFlibrary.html"
rem espaco no caminho vira %%20 (com espaço cru o Edge abre aba vazia)
set "PAGINA=!PAGINA: =%%20!"
start "" msedge --app="file:///%PAGINA%"
if errorlevel 1 start "" "KOFlibrary.html"
