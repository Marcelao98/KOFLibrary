#!/usr/bin/env bash
# Publica a versão nova: compila, monta o APK e copia tudo pra publicado/ e android/apk/. Depois é só commitar na main:
# o koflibrary.sh/.bat (PC) e o APK (celular) veem o publicado/versao.txt novo e se atualizam sozinhos.
#   web/publicar.sh
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
"$RAIZ/web/compilar.sh"
"$RAIZ/android/construir-apk.sh"
mkdir -p "$RAIZ/publicado/android" "$RAIZ/android/apk"
cp "$RAIZ/dist/KOFlibrary.html" "$RAIZ/dist/versao.txt" "$RAIZ/dist/KOFlibrary.png" "$RAIZ/koflibrary.sh" "$RAIZ/KOFlibrary.bat" "$RAIZ/publicado/"
cp "$RAIZ/dist/versao.txt" "$RAIZ/publicado/android/versao.txt"
cp "$RAIZ/dist/KOFlibrary.apk" "$RAIZ/android/apk/"
cat "$RAIZ/publicado/versao.txt"
