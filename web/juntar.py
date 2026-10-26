"""Junta a saída do `kof build --target js` com a interface num HTML só.

Uso: juntar.py <saida-do-kof> <pasta-web> <KOFlibrary.html>

Navegador não carrega módulos ES de um arquivo local (file://), então:
- o runtime do Kof e o núcleo (nucleo/ compilado) viram um script comum dentro
  de uma função, que devolve as classes em KofNucleo;
- o pdf.js (web/vendor/pdfjs) vai como texto e o app.js importa por um blob:;
- os .wasm do pdf.js (imagens JBIG2/JPEG 2000 de livro escaneado, cores ICC)
  vão em base64 e o app entrega pro pdf.js pelo BinaryDataFactory.
"""
import base64
import datetime
import json
import os
import pathlib
import re
import subprocess
import sys

saida_kof, web, destino = (pathlib.Path(a) for a in sys.argv[1:4])

runtime = (saida_kof / "kof-runtime.mjs").read_text()
runtime = re.sub(r"^(\s*)export (function|const|let|class) ", r"\1\2 ", runtime, flags=re.M)
# modo rápido (igual ao KOFstation): o kofArrayGet/kofArraySet conferem o limite a cada acesso; o núcleo só usa
# índice válido (o Pintor anda de 4 em 4 dentro do tamanho que a página passa), e no canvas o Uint8ClampedArray já
# segura o valor em 0..255. Sem a conferência, repintar a página fica umas 2x mais rápido.
for nome, rapido in [
    ("kofArrayGet(array, index) {", "    return array[index];\n"),
    ("kofArraySet(array, index, value, kind) {", "    if (kind === 0) { array[index] = value; return; }\n"),
]:
    i = runtime.index(nome) + len(nome) + 1
    runtime = runtime[:i] + rapido + runtime[i:]

nucleo = (saida_kof / "Default.mjs").read_text()
nucleo = re.sub(r"^import .*$", "", nucleo, flags=re.M)
nucleo = re.sub(r"^//# sourceMappingURL=.*$", "", nucleo, flags=re.M)
nucleo = re.sub(r"^main\(\);\s*$", "", nucleo, flags=re.M)
# deslocamento por constante: o alvo JS passa por BigInt (lento); com número literal é o mesmo valor
nucleo = re.sub(r"Number\(BigInt\.asIntN\(32, BigInt\((\d+)\)\)\)", r"\1", nucleo)
classes = ["Temas", "Pintor", "Cor", "Nome", "Busca", "Leitura"]
for c in classes:
    if f"class nucleo_{c}" not in nucleo:
        sys.exit(f"juntar.py: nucleo_{c} não apareceu na saída do Kof")

kof = (
    "const KofNucleo = (() => {\n'use strict';\n" + runtime + "\n" + nucleo
    + "\nreturn { " + ", ".join(f"{c}: nucleo_{c}" for c in classes) + " };\n})();\n"
)

pdfjs = web / "vendor" / "pdfjs"
wasm = {f.name: base64.b64encode(f.read_bytes()).decode() for f in sorted((pdfjs / "wasm").glob("*.wasm"))}


def trabalhador_classico():
    """O Chrome não abre Worker de módulo vindo de blob: numa página file://; o worker do pdf.js só usa o
    módulo pra exportar (export{...} no fim) e pro import.meta.url: vira um worker comum."""
    w = (pdfjs / "pdf.worker.min.mjs").read_text()
    fim = "export{WorkerMessageHandler};"
    if not w.rstrip().endswith(fim):
        sys.exit("juntar.py: o fim do pdf.worker.min.mjs mudou")
    return w.rstrip()[: -len(fim)].replace("import.meta.url", "self.location.href")


motor = (
    "const PDFJS_FONTE = " + json.dumps((pdfjs / "pdf.min.mjs").read_text()) + ";\n"
    + "const PDFJS_TRABALHADOR = " + json.dumps(trabalhador_classico()) + ";\n"
    + "const PDFJS_WASM = " + json.dumps(wasm) + ";\n"
)


def versao():
    try:
        c = subprocess.run(["git", "-C", str(web), "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip()
    except OSError:
        c = ""
    num = os.environ.get("KOFLIBRARY_BUILD") or datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d%H%M")
    return num + (" " + c if c else "")


pagina = (web / "pagina.html").read_text()
partes = {
    "/*{{ESTILO}}*/": (web / "estilo.css").read_text(),
    "/*{{KOF}}*/": kof,
    "/*{{PDFJS}}*/": motor,
    "/*{{APP}}*/": (web / "app.js").read_text().replace("{{VERSAO}}", versao()),
}
for k, v in partes.items():
    if k not in pagina:
        sys.exit(f"juntar.py: {k} não está na pagina.html")
    pagina = pagina.replace(k, v.replace("</script", "<\\/script"))
destino.parent.mkdir(parents=True, exist_ok=True)
destino.write_text(pagina)
print(f"{destino}: {destino.stat().st_size // 1024} KB")
