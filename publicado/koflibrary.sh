#!/usr/bin/env bash
# KOFlibrary no Linux: abre o KOFlibrary.html numa janela de app do Chrome/Chromium/Edge
# (sem barra de endereço). Sem nenhum deles, abre no navegador padrão.
cd "$(dirname "$0")" || exit 1
PAGINA="file://$(pwd)/KOFlibrary.html"
for n in google-chrome google-chrome-stable chromium chromium-browser microsoft-edge microsoft-edge-stable brave-browser; do
    if command -v "$n" >/dev/null 2>&1; then exec "$n" --app="$PAGINA" --user-data-dir="$HOME/.config/koflibrary-janela"; fi
done
for f in com.google.Chrome org.chromium.Chromium com.microsoft.Edge; do
    if command -v flatpak >/dev/null 2>&1 && flatpak info "$f" >/dev/null 2>&1; then exec flatpak run "$f" --app="$PAGINA"; fi
done
exec xdg-open "$PAGINA"
