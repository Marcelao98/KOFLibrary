// Teste da sincronia PC <-> celular de ponta a ponta, sem celular:
// - o "celular" é o KOFlibrary.html servido por http com uma KOFlibraryApk de mentira (igual à do app Android), e o
//   servidor de sincronia é o Java de verdade (android/.../Sincronia.java) rodando no Linux;
// - o "PC" é o KOFlibrary.html normal (file://).
//   node testes/sincronia.cjs <KOFlibrary.html> <pasta-dos-pdfs> <pasta-de-trabalho>
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const http = require('http'), path = require('path'), fs = require('fs'), readline = require('readline');
const [html, pdfs, trab] = process.argv.slice(2).map((p) => path.resolve(p));
const RAIZ = path.resolve(__dirname, '..');
const ok = (c, msg) => { if (!c) { console.log('FALHOU:', msg); process.exitCode = 1; } else console.log('ok', msg); };
const todos = [];
(function achar(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? achar(p) : todos.push(p); } })(pdfs);

(async () => {
  fs.rmSync(trab, { recursive: true, force: true });
  const recebidos = path.join(trab, 'recebidos'), cls = path.join(trab, 'cls');
  fs.mkdirSync(recebidos, { recursive: true });
  execFileSync('javac', ['-d', cls, path.join(RAIZ, 'android/src/dev/koflibrary/android/Sincronia.java')], { stdio: 'ignore' });
  const java = spawn('java', ['-cp', cls, 'dev.koflibrary.android.Sincronia', '1234', '18643', recebidos]);
  const linhas = readline.createInterface({ input: java.stdout });

  // o "app Android": serve a página e os PDFs recebidos (/pasta?u=, com Range, como o Biblioteca.java)
  let pedacos = 0;
  const srv = http.createServer((req, res) => {
    if (req.headers.range && /\.cb[zr]/.test(req.url)) pedacos++;
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/pasta') {
      const f = u.searchParams.get('u');
      if (!f.startsWith(recebidos)) { res.writeHead(404); return res.end(); }
      const tam = fs.statSync(f).size, rg = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
      if (rg) {
        const ini = +rg[1] || 0, fim = rg[2] ? Math.min(+rg[2], tam - 1) : tam - 1;
        res.writeHead(206, { 'Content-Range': `bytes ${ini}-${fim}/${tam}`, 'Content-Length': fim - ini + 1, 'Accept-Ranges': 'bytes' });
        return fs.createReadStream(f, { start: ini, end: fim }).pipe(res);
      }
      res.writeHead(200, { 'Content-Length': tam, 'Accept-Ranges': 'bytes' });
      return fs.createReadStream(f).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    fs.createReadStream(html).pipe(res);
  }).listen(18700);

  const b = await chromium.launch();
  const erros = [];
  // ---- celular
  const cel = await b.newPage({ viewport: { width: 400, height: 820 }, hasTouch: true, isMobile: true });
  cel.on('pageerror', (e) => erros.push('cel: ' + e));
  cel.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('  [celular]', m.text().slice(0, 200)); });
  await cel.exposeFunction('__testeListar', () => {
    const l = [];
    (function achar(d, c) {
      for (const f of fs.readdirSync(d)) {
        const p = path.join(d, f);
        if (fs.statSync(p).isDirectory()) achar(p, c + f + '/');
        else if (/\.(pdf|cbz|cbr)$/i.test(f)) l.push({ n: f, u: p, t: fs.statSync(p).size, c: c + f, r: true });
      }
    })(recebidos, '');
    return l;
  });
  await cel.exposeFunction('__testeResposta', (id, r) => java.stdin.write(r.replace(/\n/g, ' ') + '\n'));
  await cel.addInitScript(() => {
    window.KOFlibraryApk = {
      pronta: () => '', versao: () => 'teste', casca: () => 1, pastaNome: () => '', pastaEscolher() {}, adicionarPdf() {},
      listar: () => window.__testeListar().then((l) => window.__pastaLida(l)),
      responder: (id, r) => window.__testeResposta(id, r),
      sincronia: () => JSON.stringify({ ip: '127.0.0.1', casa: true, porta: 18643, senha: '1234', pc: '', ultima: 0 }),
      leitor(a) { window.__leitorAberto = a; }, salvar() {}, sair() {},
    };
  });
  await cel.goto('http://127.0.0.1:18700/index.html');
  await cel.waitForSelector('#vazio:not([hidden])');
  // o Java repassa os pedidos de sincronizar pra página do celular, e livros que chegaram
  linhas.on('line', (l) => {
    if (l.startsWith('SINCRONIZAR ')) cel.evaluate((j) => window.__sincronia(1, j), l.slice(12));
    else if (l.startsWith('CHEGOU ')) cel.evaluate((n) => window.__livroChegou(n), l.slice(7));
  });

  // ---- PC: adiciona os livros, lê o Dom Casmurro até a página 5, nota e marcador
  const pc = await b.newPage({ viewport: { width: 1280, height: 800 } });
  pc.on('pageerror', (e) => erros.push('pc: ' + e));
  await pc.goto('file://' + html);
  await pc.waitForSelector('#vazio:not([hidden])');
  await pc.setInputFiles('#arquivoPasta', pdfs);   // a pasta inteira (Estudos/ vira estante)
  await pc.waitForFunction(() => document.querySelectorAll('.livro img').length >= 4, null, { timeout: 30000 });
  await pc.click('.livro:has-text("Dom Casmurro")');
  await pc.waitForSelector('.pagina canvas');
  await pc.evaluate(() => KOFlibrary.irPara(5, false));
  await pc.waitForTimeout(300);
  await pc.keyboard.press('b');
  await pc.keyboard.press('n');
  await pc.fill('#txtNota', 'nota do PC');
  await pc.click('#btSalvarNota');
  await pc.keyboard.press('Escape'); await pc.keyboard.press('Escape');
  await pc.waitForSelector('#biblioteca:not([hidden])');

  // ---- 1ª sincronia pelo diálogo, mandando todos os livros
  await pc.click('#btCelular');
  await pc.fill('#sincEndereco', '127.0.0.1:18643');
  await pc.fill('#sincSenha', '1234');
  await pc.selectOption('#sincEnviar', 'todos');
  await pc.click('#btSincronizar');
  await pc.waitForFunction(() => /Sincronizado|Não achei|Senha/.test(document.querySelector('#sincStatus').textContent), null, { timeout: 30000 });
  const st = await pc.textContent('#sincStatus');
  console.log('status no PC:', st);
  ok(st.includes(`${todos.length} livros enviados`), `PC mandou os ${todos.length} arquivos (PDF e mangá)`);
  await pc.screenshot({ path: path.join(trab, 'pc-sincronia.png') });
  await pc.click('#dlgCelular .botoes button');
  const chegaram = execFileSync('find', [recebidos, '-type', 'f']).toString().trim().split('\n');
  console.log('no celular:', chegaram.map((f) => path.relative(recebidos, f)));
  ok(chegaram.length === todos.length && chegaram.some((f) => f.includes('/Estudos/')), 'livros gravados no celular, com a estante');

  // ---- celular: tem os livros, o Dom Casmurro na página 5 com a nota
  await cel.waitForFunction((n) => KOFlibrary.livros.size === n && [...KOFlibrary.livros.values()].every((l) => l.temCapa && KOFlibrary.fontes.has(l.id)), todos.length, { timeout: 60000 })
    .catch(async (e) => { console.log(await cel.evaluate(() => JSON.stringify([...KOFlibrary.livros.values()].map((l) => [l.titulo, l.temCapa, l.erro, KOFlibrary.fontes.has(l.id)])))); throw e; });
  const r1 = await cel.evaluate(() => { const l = [...KOFlibrary.livros.values()].find((x) => x.titulo === 'Dom Casmurro'); return { pagina: l.pagina, notas: l.notas.map((n) => n.texto), marcadores: l.marcadores, temArquivo: KOFlibrary.fontes.has(l.id) }; });
  console.log('Dom Casmurro no celular:', r1);
  ok(r1.pagina === 5 && r1.notas[0] === 'nota do PC' && r1.marcadores[0] === 5 && r1.temArquivo, 'progresso, nota e marcador chegaram no celular');
  await cel.screenshot({ path: path.join(trab, 'cel-biblioteca.png') });

  // ---- celular: abre, continua na 5, vai pra 8 (volume), nota nova, tira o marcador
  await cel.click('.cont-grande');
  await cel.waitForSelector('.pagina canvas');
  await cel.waitForTimeout(500);
  ok(await cel.inputValue('#lPagina') === '5', 'celular abre o livro na página onde parou no PC');
  ok(await cel.evaluate(() => window.__leitorAberto === true), 'avisou o app que o leitor abriu (volume vira página)');
  for (let i = 0; i < 3; i++) { await cel.evaluate(() => window.__volume(1)); await cel.waitForTimeout(150); }
  ok(await cel.inputValue('#lPagina') === '8', 'tecla de volume vira a página (' + await cel.inputValue('#lPagina') + ')');
  // toque no meio esconde as barras; arrastar pro lado volta uma página
  await cel.touchscreen.tap(200, 450);
  await cel.waitForTimeout(450);   // espera pra ver se vem o segundo toque (duplo toque = zoom)
  ok(await cel.evaluate(() => document.querySelector('#leitor').classList.contains('limpo')), 'toque no meio esconde as barras');
  await cel.screenshot({ path: path.join(trab, 'cel-leitor.png') });
  await cel.touchscreen.tap(200, 450);
  await cel.waitForTimeout(450);
  await cel.evaluate(() => KOFlibrary.irPara(5, false));
  await cel.waitForTimeout(200);
  await cel.click('#btMarcador');   // tira o marcador da 5
  await cel.evaluate(() => KOFlibrary.irPara(8, false));
  await cel.waitForTimeout(200);
  await cel.click('#btNotas');
  await cel.fill('#txtNota', 'nota do celular');
  await cel.click('#btSalvarNota');
  await cel.screenshot({ path: path.join(trab, 'cel-notas.png') });
  ok(await cel.evaluate(() => window.__voltar()) === true, 'voltar do Android fecha o painel');
  ok(await cel.evaluate(() => window.__voltar()) === true && await cel.isVisible('#biblioteca'), 'voltar do Android fecha o livro');
  ok(await cel.evaluate(() => window.__voltar()) === false, 'voltar na biblioteca sai do app');

  // ---- PC: sincroniza de novo (sozinho, como faz a cada 2 min) e recebe o que mudou no celular
  await pc.evaluate(() => KOFlibrary.sincronizarCelular(true));
  const r2 = await pc.evaluate(() => { const l = [...KOFlibrary.livros.values()].find((x) => x.titulo === 'Dom Casmurro'); return { pagina: l.pagina, notas: l.notas.map((n) => n.texto), marcadores: l.marcadores }; });
  console.log('Dom Casmurro no PC depois:', r2);
  ok(r2.pagina === 8 && r2.notas.length === 2 && r2.notas.includes('nota do celular') && r2.marcadores.length === 0, 'PC recebeu página, nota nova e o marcador tirado');
  // apagar nota no PC some no celular
  await pc.evaluate(() => { const l = [...KOFlibrary.livros.values()].find((x) => x.titulo === 'Dom Casmurro'); const n = l.notas.find((x) => x.texto === 'nota do PC'); l.notas = l.notas.filter((x) => x !== n); l.notasApagadas = [n.id]; });
  await pc.evaluate(() => KOFlibrary.sincronizarCelular(true));
  const r3 = await cel.evaluate(() => [...KOFlibrary.livros.values()].find((x) => x.titulo === 'Dom Casmurro').notas.map((n) => n.texto));
  ok(r3.length === 1 && r3[0] === 'nota do celular', 'nota apagada no PC some do celular');
  // mangá no celular: abre lendo só os pedaços do .cbz (Range), direita->esquerda com o toque na beirada esquerda
  ok(!(await cel.evaluate(() => [...KOFlibrary.livros.values()].filter((l) => l.erro).map((l) => l.erro))).length, 'capas dos mangás no celular');
  console.log('  grade do celular:', await cel.$$eval('#grade .livro .titulo', (e) => e.map((x) => x.textContent)), await cel.isVisible('#biblioteca'));
  await cel.click('#grade .livro:has-text("Berserk")', { timeout: 5000 });
  await cel.waitForSelector('#paginas.paginado .folha canvas');
  await cel.touchscreen.tap(40, 450);
  await cel.waitForTimeout(400);
  ok(await cel.inputValue('#lPagina') === '2', 'toque na beirada esquerda avança o mangá');
  ok(pedacos > 0, `o .cbz foi lido aos pedaços (${pedacos} pedidos com Range)`);
  await cel.screenshot({ path: path.join(trab, 'cel-manga.png') });
  await cel.evaluate(() => window.__voltar());
  // tela do celular com o código
  await cel.click('#btCelular');
  await cel.screenshot({ path: path.join(trab, 'cel-codigo.png') });
  console.log('erros:', erros);
  ok(!erros.length, 'sem erros nas páginas');
  await b.close(); srv.close(); java.kill();
})().catch((e) => { console.log('FALHOU', e); process.exitCode = 1; process.exit(1); });
