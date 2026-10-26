#!/usr/bin/env bash
# Compila o núcleo Kof (nucleo/) pra JavaScript e monta UM arquivo só,
# dist/KOFlibrary.html, que abre com dois cliques no Chrome/Edge.
#   web/compilar.sh
# Precisa: kof (https://github.com/KofLang/Kof4j, 0.6.6) no PATH e python3.
set -euo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(dirname "$AQUI")"
T="$(mktemp -d)"
# número da versão (cresce sempre): o APK compara com o publicado/android/versao.txt pra se atualizar
export KOFLIBRARY_BUILD="${KOFLIBRARY_BUILD:-$(date -u +%Y%m%d%H%M)}"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/src"
cp "$RAIZ/KOFlibrary.kf" "$T/src/"
cp -r "$RAIZ/nucleo" "$T/src/nucleo"
kof build "$T/src/KOFlibrary.kf" --target js --output "$T/out"
python3 "$AQUI/juntar.py" "$T/out" "$AQUI" "$RAIZ/dist/KOFlibrary.html"
cp "$RAIZ/koflibrary.sh" "$RAIZ/KOFlibrary.bat" "$RAIZ/dist/"
# versao.txt do APK: o html é o mesmo do PC; casca = a do MainActivity.java (página nova que precisa de Java novo pede APK novo)
CASCA="$(sed -n 's/.*static final int CASCA = \([0-9]*\);.*/\1/p' "$RAIZ/android/src/dev/koflibrary/android/MainActivity.java")"
# o mesmo versao.txt serve o APK (versao, casca, html) e o koflibrary.sh/.bat do PC (versao, html, lancador_linux)
LANCADOR="$(sed -n 's/^LANCADOR=\([0-9]*\).*/\1/p' "$RAIZ/koflibrary.sh")"
printf 'versao=%s\ncasca=%s\nhtml=KOFlibrary.html:%s\nlancador_linux=%s\n' "$KOFLIBRARY_BUILD" "$CASCA" "$(stat -c %s "$RAIZ/dist/KOFlibrary.html")" "$LANCADOR" > "$RAIZ/dist/versao.txt"
python3 "$RAIZ/android/icone.py" "$T/icone" && cp "$T/icone/mipmap-xxxhdpi/ic_launcher.png" "$RAIZ/dist/KOFlibrary.png"
