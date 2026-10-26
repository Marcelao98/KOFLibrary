# KOFlibrary — contexto pra próxima sessão

Biblioteca/leitor de PDF do Marcelo, irmão do KOFstation (github.com/Marcelao98/KOFStation; leia o CLAUDE.md de lá
pro jeito de trabalhar com ele). Núcleo em **Kof** (nucleo/) → JavaScript; PDF pelo **pdf.js 6.4.299** (web/vendor/pdfjs).
Saída: **um html só** (`dist/KOFlibrary.html`, ~2,4 MB) que abre por file:// no Chrome/Edge.

## Onde parou (26/10)
- **v1 (MVP) publicada na main**: biblioteca (pasta lembrada por FileSystemDirectoryHandle, estantes = 1ª subpasta,
  PDF solto vai pro IndexedDB), capas, busca, filtros, Continuar lendo, leitor com rolagem contínua (páginas
  desenhadas só perto da tela), 22 temas que repintam a página (Pintor.kf), brilho/contraste/luz quente, por livro ou
  global, marcadores, notas por página, exportar .md, tempo lido, temas do app.
- Combinado pra **v2** (ele escolhe a ordem): marca-texto (camada de texto do pdf.js + retângulos normalizados),
  busca no livro, sumário, cortar margens, estatísticas, modo livro/página, ler em voz alta, Android, EPUB.
- Falta o Marcelo testar com os livros dele (pasta grande, PDF escaneado).

## Como falar com o Marcelo
Português do Brasil, informal, direto; ele escreve rápido por voz (muitos erros de digitação). Liga pra economia de
tokens: fazer só o que pediu. Commits em português, sem nome de modelo de IA. Não abrir PR sem ele pedir.

## Montar o ambiente (o container perde tudo fora do repositório)
1. `apt-get update && apt-get install -y openjdk-25-jdk-headless`
2. `git clone --depth 1 https://github.com/KofLang/Kof4j` e, nele,
   `JAVA_HOME=/usr/lib/jvm/java-25-openjdk-amd64 PATH=/usr/lib/jvm/java-25-openjdk-amd64/bin:$PATH mvn -q -pl kof-cli -am package -DskipTests`
   e `cp kof-cli/target/kof-cli-0.6.6.jar lib/kof.jar`. Kof 0.6.6 sem patch funcionou (o patch do KOFstation é do 0.6.3).
3. `export JAVA_HOME=/usr/lib/jvm/java-25-openjdk-amd64 PATH=<Kof4j>/bin:/usr/lib/jvm/java-25-openjdk-amd64/bin:$PATH`
   (as duas coisas no PATH; `$JAVA_HOME` no mesmo export não expande).
4. `web/compilar.sh` → `dist/KOFlibrary.html`; publicar = copiar pra `publicado/` (o README aponta pro raw de lá).
5. Testes: `node testes/gerar-pdfs.cjs <pasta>` e `node testes/navegador.cjs dist/KOFlibrary.html <pasta> <prints>`
   (Playwright já vem no container). Nunca commitar PDF de livro de verdade.

## Armadilhas já resolvidas
- Kof → JS: `export` indentado no runtime (kof_string_index_of2) — o juntar.py tira `^\s*export`.
- Deslocamento por constante vira BigInt no alvo JS: o juntar.py troca `Number(BigInt.asIntN(32, BigInt(N)))` por N.
  kofArrayGet/Set sem conferência de limite (modo rápido, igual KOFstation): Pintor ~75 ms numa página 1600x2200.
- Kof: parâmetro com o mesmo nome de um método estático (ex. `b` e `Cor.b()`) dá SEM015.
- pdf.js num file://: Worker de **módulo** vindo de blob: não abre → o juntar.py transforma o pdf.worker em worker
  comum (tira o `export{...}` do fim, `import.meta.url` → `self.location.href`). O pdf.min.mjs vai por `import(blob:)`.
  Os .wasm (JBIG2, OpenJPEG, QCMS) vão em base64 e o app entrega pelo `BinaryDataFactory` (classe `Embutidos`),
  com `useWorkerFetch: false`. `doc.destroy()` não existe no 6.x: `doc.loadingTask.destroy()` (`fecharPdf`).
- IndexedDB `koflibrary` v1: lojas livros (keyPath id = nome|tamanho), capas (dataURL), arquivos (Blob dos PDFs
  soltos), config (pastas = handles, temaApp, leitura, ordem). Mudou o formato? subir a versão e migrar.
