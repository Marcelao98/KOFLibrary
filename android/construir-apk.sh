#!/usr/bin/env bash
# Monta o KOFlibrary.apk: uma WebView (android/src) com o dist/KOFlibrary.html dentro (assets/index.html).
# Sem Gradle e sem SDK completo (igual ao KOFstation): só as ferramentas do Ubuntu
#   apt install aapt apksigner zipalign libandroid-23-java dalvik-exchange android-sdk-platform-23
# + JDK + python3 com PIL. Antes: web/compilar.sh (gera dist/KOFlibrary.html e dist/versao.txt).
#   android/construir-apk.sh            -> dist/KOFlibrary.apk
# A chave (koflibrary-teste.keystore) é de TESTE: serve pra instalar direto no celular e atualizar por cima.
set -euo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"; RAIZ="$(dirname "$AQUI")"
HTML="$RAIZ/dist/KOFlibrary.html"; [ -f "$HTML" ] || { echo "falta $HTML (rode web/compilar.sh antes)"; exit 1; }
ANDROID_JAR="${ANDROID_JAR:-/usr/lib/android-sdk/platforms/android-23/android.jar}"
W="$RAIZ/dist/apk-work"; rm -rf "$W"; mkdir -p "$W/classes" "$W/assets" "$W/res" "$W/src"
# versão: código cresce a cada build (minutos desde 1/1/2026), nome = data
CODIGO="$(python3 -c 'import time; print((int(time.time()) - 1767225600) // 60)')"; NOME="$(date -u +%Y.%m.%d.%H%M)"
cp -r "$AQUI/res/." "$W/res/"; cp -r "$AQUI/src/." "$W/src/"
sed "s/@VERSAO_CODE@/$CODIGO/; s/@VERSAO_NOME@/$NOME/" "$AQUI/AndroidManifest.xml" > "$W/AndroidManifest.xml"
find "$W/src" -name '*.java' -exec sed -i "s/@VERSAO_NOME@/$NOME/" {} +
cp "$HTML" "$W/assets/index.html"
grep '^versao=' "$RAIZ/dist/versao.txt" > "$W/assets/versao.txt"   # o Atualizador compara com publicado/android/versao.txt
python3 "$AQUI/icone.py" "$W/res"
javac --release 8 -Xlint:-options -cp "$ANDROID_JAR" -d "$W/classes" $(find "$W/src" -name '*.java') 2>&1 | grep -v "^Picked up" || true
[ -f "$W/classes/dev/koflibrary/android/MainActivity.class" ] || { echo "o Java não compilou"; exit 1; }
dalvik-exchange --dex --min-sdk-version=24 --output="$W/classes.dex" "$W/classes" 2>&1 | grep -v "^Picked up" || true
aapt package -f -M "$W/AndroidManifest.xml" -S "$W/res" -A "$W/assets" -I "$ANDROID_JAR" --min-sdk-version 24 --target-sdk-version 34 -F "$W/base.apk"
(cd "$W" && aapt add base.apk classes.dex >/dev/null)
zipalign -f -p 4 "$W/base.apk" "$W/alinhado.apk"
KS="$AQUI/koflibrary-teste.keystore"
[ -f "$KS" ] || keytool -genkeypair -keystore "$KS" -storepass koflibrary-teste -keypass koflibrary-teste -alias koflibrary -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=KOFlibrary teste, O=KOFlibrary, C=BR" 2>&1 | grep -v "^Picked up" || true
OUT="$RAIZ/dist/KOFlibrary.apk"
apksigner sign --ks "$KS" --ks-pass pass:koflibrary-teste --key-pass pass:koflibrary-teste --ks-key-alias koflibrary --out "$OUT" "$W/alinhado.apk" 2>&1 | grep -v "^Picked up" || true
apksigner verify "$OUT" 2>&1 | grep -v "^Picked up" || true
ls -l "$OUT"
