#!/usr/bin/env bash
# KOFlibrary no Linux: atualiza (igual ao kofnes.sh do KOFstation) e abre o KOFlibrary.html numa janela de app
# do Chrome/Chromium/Edge/Brave (sem barra de endereço). Sem nenhum deles, abre no navegador padrão.
#   ./koflibrary.sh               abre (atualizando antes, se tiver versão nova)
#   ./koflibrary.sh --instalar    põe o KOFlibrary no menu de aplicativos
#   ./koflibrary.sh --desinstalar
# Atualizar: se a pasta é um clone do git, faz "git pull"; senão baixa o KOFlibrary.html novo do GitHub
# (publicado/versao.txt diz a versão). Um arquivo "nao-atualizar" do lado do script desliga isso.
# Tudo anotado em atualizacao.log, do lado do script.
LANCADOR=2
BASE="${KOFLIBRARY_URL:-https://raw.githubusercontent.com/Marcelao98/KOFLibrary/main/publicado}"

eu="$(readlink -f "$0" 2>/dev/null || printf '%s' "$0")"
dir="$(cd "$(dirname "$eu")" && pwd)"
cd "$dir" || exit 1
log="$dir/atualizacao.log"
dados="${XDG_DATA_HOME:-$HOME/.local/share}"
anotar() { printf '%s  %s\n' "$(date '+%d/%m %H:%M:%S')" "$*" >>"$log" 2>/dev/null; }

case "$1" in
--instalar)
    mkdir -p "$dados/applications" || exit 1
    cat >"$dados/applications/koflibrary.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=KOFlibrary
Comment=Sua biblioteca de livros, PDFs e mangás
Exec="$dir/koflibrary.sh"
Icon=$dir/KOFlibrary.png
Terminal=false
Categories=Office;Viewer;
EOF
    command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$dados/applications" 2>/dev/null
    echo "KOFlibrary instalado no menu de aplicativos."
    exit 0 ;;
--desinstalar)
    rm -f "$dados/applications/koflibrary.desktop"
    echo "KOFlibrary tirado do menu de aplicativos."
    exit 0 ;;
esac

# ---------------- atualizador ----------------
campo() { n="$(sed -n "s/^$2=\([0-9][0-9]*\).*/\1/p" "$1" 2>/dev/null | head -n 1)"; printf '%s' "${n:-0}"; }
baixar() {   # baixar <nome em BASE> <destino> <segundos>
    url="$BASE/$1?t=$(date +%s)"
    if command -v curl >/dev/null 2>&1; then curl -fsSL --connect-timeout 8 --max-time "$3" -o "$2" "$url" 2>/dev/null
    elif command -v wget >/dev/null 2>&1; then wget -q -T 15 -O "$2" "$url" 2>/dev/null
    else anotar "não tem curl nem wget: instale um dos dois pra atualizar"; return 127; fi
}
atualizar() {
    [ -f "$dir/nao-atualizar" ] && return
    raiz="$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null)"
    if [ -n "$raiz" ] && git -C "$raiz" remote get-url origin 2>/dev/null | grep -qi 'koflibrary'; then
        # clone do git: o git pull traz tudo (html, este script, o APK)
        antes="$(git -C "$raiz" rev-parse HEAD 2>/dev/null)"
        if timeout 25 git -C "$raiz" pull --ff-only -q >>"$log" 2>&1; then
            depois="$(git -C "$raiz" rev-parse HEAD 2>/dev/null)"
            [ "$antes" != "$depois" ] && anotar "atualizado pelo git: $antes -> $depois"
        else
            anotar "git pull não deu (sem internet, ou arquivo mexido na pasta: rode 'git status' pra ver)"
        fi
        return
    fi
    # pasta solta (baixada do GitHub): baixa o versao.txt e, se for mais novo, o html (e este script)
    t="$dir/.versao.novo"
    baixar versao.txt "$t" 15 || { anotar "sem internet ou GitHub fora: abre a versão que tem"; rm -f "$t"; return; }
    nova="$(campo "$t" versao)"; atual="$(campo "$dir/versao.txt" versao)"
    if [ "$nova" -gt "$atual" ] 2>/dev/null; then
        tam="$(sed -n 's/^html=KOFlibrary.html:\([0-9]*\).*/\1/p' "$t")"
        echo "Baixando o KOFlibrary novo ($nova)..."
        if baixar KOFlibrary.html "$dir/.KOFlibrary.html.novo" 120 && [ "$(wc -c <"$dir/.KOFlibrary.html.novo" | tr -d ' ')" = "$tam" ]; then
            mv -f "$dir/.KOFlibrary.html.novo" "$dir/KOFlibrary.html" && cp -f "$t" "$dir/versao.txt"
            anotar "atualizado: $atual -> $nova"
        else
            rm -f "$dir/.KOFlibrary.html.novo"; anotar "falhou baixar o KOFlibrary.html $nova (tamanho errado ou rede)"
        fi
    fi
    if [ "$(campo "$t" lancador_linux)" -gt "$LANCADOR" ] 2>/dev/null; then
        if baixar koflibrary.sh "$dir/.koflibrary.sh.novo" 30 && head -n 1 "$dir/.koflibrary.sh.novo" | grep -q '^#!'; then
            chmod +x "$dir/.koflibrary.sh.novo" && mv -f "$dir/.koflibrary.sh.novo" "$eu" && anotar "lançador novo: $(campo "$t" lancador_linux)"
        else
            rm -f "$dir/.koflibrary.sh.novo"
        fi
    fi
    rm -f "$t"
}
atualizar

# ---------------- abrir ----------------
# o caminho vai codificado (espaço vira %20, "Área de Trabalho" vira %C3%81rea...): com espaço cru o Chrome
# não entende o --app e abre só uma aba vazia
if command -v python3 >/dev/null 2>&1; then
    PAGINA="$(python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).resolve().as_uri())' KOFlibrary.html)"
else
    PAGINA="file://$(pwd | sed 's/ /%20/g')/KOFlibrary.html"
fi
for n in google-chrome google-chrome-stable chromium chromium-browser microsoft-edge microsoft-edge-stable brave-browser; do
    if command -v "$n" >/dev/null 2>&1; then exec "$n" --app="$PAGINA" --user-data-dir="$HOME/.config/koflibrary-janela"; fi
done
for f in com.google.Chrome org.chromium.Chromium com.microsoft.Edge; do
    if command -v flatpak >/dev/null 2>&1 && flatpak info "$f" >/dev/null 2>&1; then exec flatpak run "$f" --app="$PAGINA"; fi
done
exec xdg-open "$PAGINA"
