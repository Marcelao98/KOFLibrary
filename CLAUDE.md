# KOFlibrary — contexto pra próxima sessão

Biblioteca/leitor de PDF do Marcelo, irmão do KOFstation (github.com/Marcelao98/KOFStation; leia o CLAUDE.md de lá
pro jeito de trabalhar com ele). Núcleo em **Kof** (nucleo/) → JavaScript; PDF pelo **pdf.js 6.4.299** (web/vendor/pdfjs).
Saída: **um html só** (`dist/KOFlibrary.html`, ~2,4 MB) que abre por file:// no Chrome/Edge.

## Onde parou (26/10)
- **v1 (MVP) publicada na main**: biblioteca (pasta lembrada por FileSystemDirectoryHandle, estantes = 1ª subpasta,
  PDF solto vai pro IndexedDB), capas, busca, filtros, Continuar lendo, leitor com rolagem contínua (páginas
  desenhadas só perto da tela), 22 temas que repintam a página (Pintor.kf), brilho/contraste/luz quente, por livro ou
  global, marcadores, notas por página, exportar .md, tempo lido, temas do app.
- Corrigido 26/10: fechar um PDF e abrir outro logo em seguida quebrava o worker do pdf.js (`fechando` no abrirPdf).
- Combinado pra **v2** (ele escolhe a ordem): marca-texto (camada de texto do pdf.js + retângulos normalizados),
  busca no livro, sumário, cortar margens, estatísticas, modo livro/página, ler em voz alta, Android, EPUB.
- Falta o Marcelo testar com os livros dele (pasta grande, PDF escaneado).

## APK + sincronia (branch `apk`, 26/10)
- `android/`: casca Java (WebView) com o MESMO html do PC em assets/index.html, servido em https://appassets.androidplatform.net
  (copiado do KOFstation, pacote dev.koflibrary.android). `MainActivity` (ponte `KOFlibraryApk`: listar, pastaEscolher,
  adicionarPdf, salvar, sincronia, responder, leitor, pronta), `Biblioteca` (pasta SAF + recebidos/ = getExternalFilesDir;
  serve /pasta?u= com Range: o pdf.js abre por url aos pedaços), `Sincronia` (HTTP na 8643, senha de 4 números fixa
  por celular), `Atualizador` (lê publicado/android/versao.txt na main: versao, casca, html=KOFlibrary.html:tamanho).
  `CASCA` no MainActivity: sobe a cada mudança no Java. Montar: `web/compilar.sh && android/construir-apk.sh`
  (apt: aapt apksigner zipalign libandroid-23-java dalvik-exchange android-sdk-platform-23); chave de TESTE no repo.
- Sincronia: o PC (página file://) chama o celular: POST /sincronizar (registros sem blobs, `paraEnviar`) -> a página do
  celular junta (`juntarLivro`: progresso pelo `lido` mais novo, título/autor/favorito/tema por `editadoEm`, marcadores por
  `marcadoresEm`, notas = união menos `notasApagadas`, tempo/páginas por aparelho em `segundosPor`/`paginasPor`, total =
  soma) e devolve os dela + `temArquivo`; o PC junta e manda PUT /livro dos que faltam (opção lendo/todos/nenhum).
  Automático a cada 2 min e ao fechar livro no PC. `config.aparelho` = pc-xxxx / cel-xxxx.
- Celular na página: `html.celular`, toque (meio = barras, beiradas/arrastar = página, pinça = zoom), volume
  (`__volume`), voltar (`__voltar`), painéis viram gaveta de baixo.
- Testes: `testes/sincronia.cjs` (Java Sincronia de verdade + página do "celular" com ponte de mentira + PC file://).
- Chrome pode bloquear file:// -> IP da rede local (Local Network Access): a página explica (permitir no cadeado).
  Desligar isso por flag no lançador foi barrado pela checagem de segurança: NÃO fazer.
- Falta testar no aparelho dele: pasta SAF, Abrir com, volume, sincronia na Wi-Fi de verdade.

## Mangá (branch `manga`, a partir do `apk`, 26/10)
- Formatos: PDF + .cbz (zip) + .cbr (RAR). `EXT_LIVRO` no app.js, `Sincronia.ehLivro` no Java. Próximas fases combinadas:
  2 = EPUB/MOBI/AZW3/FB2 com foliate-js (MIT), 3 = TXT/MD/HTML (+ talvez DjVu). Ele lê mais mangá JAPONÊS: padrão rtl.
- Kof: `Zip.kf` (fimCentral/inicioCentral/Indice/inicioDados + CRC-32), `Capitulo.kf` (serie/volume/capitulo x1000, chave
  de ordem natural), `Bordas.kf`. Kof NÃO tem lista literal: `"a|b".split("|")`; campo e método com o mesmo nome quebram
  no JS (renomear o campo).
- O documento de imagens (`abrirQuadrinho`) imita o do pdf.js (numPages, getPage -> getViewport/render, loadingTask),
  então webtoon = o leitor de rolagem do PDF. Paginado (`mostrar`, `passo`, `L.mostradas`): dupla em tela larga, capa e
  página larga sozinhas, `sentido()` inverte setas/toques no rtl. Fim -> `#fimCap` com `proximoCapitulo`.
  `config.manga` = {direcao rtl|ltr|vertical, dupla, cortar} (global). .cbz lido por pedaços (`pedaco`: Range no celular,
  File.slice no PC); .cbr inteiro na memória, um por vez (`naFilaRar`).
- Biblioteca: `l.serie/cap/vol` (`marcarQuadrinho`; sincronizam), séries com 2+ capítulos viram cartão (`agruparSeries`,
  `serieAberta`), chip 🗾 Mangás. CASCA do APK = 2.
- Testes: `python3 testes/gerar-mangas.py <pasta>` (precisa do `rar` pro .cbr: apt install rar) + `testes/manga.cjs`;
  `testes/nucleo.cjs` (Kof no Node). Playwright não lê arquivo com acento no caminho pelo setInputFiles: pasta "Mangas".

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
