@echo off
rem KOFlibrary no Windows: atualiza pelo GitHub (igual ao KOFstation) e abre o KOFlibrary.html
rem numa janela de app do Edge (sem barra de endereco). Um arquivo "nao-atualizar" do lado desliga a atualizacao.
setlocal EnableDelayedExpansion
cd /d "%~dp0"
set "BASE=https://raw.githubusercontent.com/Marcelao98/KOFLibrary/main/publicado"
if exist "nao-atualizar" goto abrir
rem sem curl (Windows antigo) a chamada falha e ele so abre
del ".versao.novo" 2>nul
call curl -fsSL --connect-timeout 8 --max-time 15 -o ".versao.novo" "%BASE%/versao.txt" 2>nul
rem confere o arquivo (e nao o codigo de saida): sem curl ou sem internet, ele nao existe
if not exist ".versao.novo" goto abrir
set "NOVA=0" & set "ATUAL=0" & set "TAM="
for /f "tokens=2 delims==" %%v in ('findstr /b "versao=" ".versao.novo"') do set "NOVA=%%v"
if exist "versao.txt" for /f "tokens=2 delims==" %%v in ('findstr /b "versao=" "versao.txt"') do set "ATUAL=%%v"
for /f "tokens=2 delims=:" %%v in ('findstr /b "html=" ".versao.novo"') do set "TAM=%%v"
rem os numeros (AAAAMMDDHHMM) tem o mesmo tamanho: comparar como texto da certo
if "!NOVA!" GTR "!ATUAL!" (
    echo Baixando o KOFlibrary novo ^(!NOVA!^)...
    call curl -fsSL --connect-timeout 8 --max-time 120 -o ".KOFlibrary.html.novo" "%BASE%/KOFlibrary.html" 2>nul
    for %%f in (".KOFlibrary.html.novo") do if "%%~zf"=="!TAM!" (
        move /y ".KOFlibrary.html.novo" "KOFlibrary.html" >nul
        copy /y ".versao.novo" "versao.txt" >nul
        echo %date% %time% atualizado: !ATUAL! -^> !NOVA!>>atualizacao.log
    )
)
del ".versao.novo" ".KOFlibrary.html.novo" 2>nul
:abrir
rem o endereco vai codificado (espaco vira %%20, acento tambem): o PowerShell do Windows monta;
rem sem ele, vai o caminho direto
set "PAGINA="
for /f "usebackq delims=" %%u in (`powershell -NoProfile -Command "([uri]'%cd%\KOFlibrary.html').AbsoluteUri" 2^>nul`) do set "PAGINA=%%u"
if not defined PAGINA set "PAGINA=file:///%cd:\=/%/KOFlibrary.html"
start "" msedge --app="%PAGINA%"
if errorlevel 1 start "" "KOFlibrary.html"
