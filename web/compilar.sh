#!/usr/bin/env bash
# Compila o núcleo Kof (nucleo/) pra JavaScript e monta UM arquivo só,
# dist/KOFlibrary.html, que abre com dois cliques no Chrome/Edge.
#   web/compilar.sh
# Precisa: kof (https://github.com/KofLang/Kof4j, 0.6.6) no PATH e python3.
set -euo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(dirname "$AQUI")"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/src"
cp "$RAIZ/KOFlibrary.kf" "$T/src/"
cp -r "$RAIZ/nucleo" "$T/src/nucleo"
kof build "$T/src/KOFlibrary.kf" --target js --output "$T/out"
python3 "$AQUI/juntar.py" "$T/out" "$AQUI" "$RAIZ/dist/KOFlibrary.html"
cp "$RAIZ/koflibrary.sh" "$RAIZ/KOFlibrary.bat" "$RAIZ/dist/"
