// Biblioteca grande: 2.000 arquivos (cópias de PDFs pequenos com nomes diferentes, 20 estantes). Mede quanto demora
// pra aparecer, se a busca responde enquanto as capas são feitas, e recarregar a página com tudo no banco.
//   node testes/grande.cjs <KOFlibrary.html> <pasta-dos-pdfs> <pasta-de-trabalho>
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const [html, pdfs, trab] = process.argv.slice(2).map((p) => path.resolve(p));
const ok = (c, msg) => { if (!c) { console.log('FALHOU:', msg); process.exitCode = 1; } else console.log('ok', msg); };
const N = 2000;
(async () => {
  const pasta = path.join(trab, 'Biblioteca');
  if (!fs.existsSync(pasta)) {
    const base = fs.readFileSync(path.join(pdfs, 'clean.code.2008.pdf'));
    for (let i = 0; i < N; i++) {
      const d = path.join(pasta, 'Estante ' + (i % 20));
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, `Autor ${i % 97} - Livro numero ${i} (${1900 + (i % 120)}).pdf`), base);
    }
  }
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('file://' + html);
  await p.waitForSelector('#vazio:not([hidden])');
  let t = Date.now();
  await p.setInputFiles('#arquivoPasta', pasta);
  await p.waitForFunction((n) => KOFlibrary.livros.size === n && document.querySelectorAll('#grade .livro').length > 0, N, { timeout: 120000 });
  const aparecer = Date.now() - t;
  console.log(`  ${N} arquivos na tela em ${aparecer} ms`);
  ok(aparecer < 15000, 'biblioteca de 2.000 aparece em menos de 15 s');
  // busca enquanto as capas estão sendo feitas
  await p.waitForTimeout(1500);
  t = Date.now();
  await p.fill('#busca', 'livro numero 1234');
  await p.waitForFunction(() => document.querySelectorAll('#grade .livro').length === 1);
  const busca = Date.now() - t;
  console.log(`  busca respondeu em ${busca} ms (com as capas sendo feitas)`);
  ok(busca < 800, 'busca rápida com 2.000 livros');
  await p.fill('#busca', '');
  // rolar até o fim carrega mais cartões
  const antes = await p.$$eval('#grade .livro', (e) => e.length);
  await p.evaluate(() => scrollTo(0, document.body.scrollHeight));
  await p.waitForTimeout(800);
  const depois = await p.$$eval('#grade .livro', (e) => e.length);
  console.log(`  cartões: ${antes} -> ${depois} depois de rolar`);
  ok(depois > antes, 'rolando aparecem mais livros');
  // travadas da tela enquanto as capas são feitas: maior intervalo entre quadros em 3 s
  const pior = await p.evaluate(() => new Promise((ok) => { let ult = performance.now(), max = 0; const fim = ult + 3000; (function q(t) { max = Math.max(max, t - ult); ult = t; if (t < fim) requestAnimationFrame(q); else ok(max); })(ult); }));
  console.log(`  maior travada da tela durante as capas: ${Math.round(pior)} ms`);
  ok(pior < 250, 'a tela não trava enquanto faz as capas');
  const capas = await p.evaluate(() => [...KOFlibrary.livros.values()].filter((l) => l.temCapa).length);
  console.log(`  capas prontas até agora: ${capas}`);
  // abrir um livro com as capas rodando
  t = Date.now();
  await p.evaluate(() => scrollTo(0, 0));
  await p.click('#grade .livro >> nth=3');
  await p.waitForSelector('.pagina canvas');
  console.log(`  abriu um livro em ${Date.now() - t} ms`);
  ok(Date.now() - t < 4000, 'abre livro rápido mesmo com as capas rodando');
  await p.keyboard.press('Escape');
  console.log('erros:', erros.slice(0, 3));
  ok(!erros.length, 'sem erros');
  await b.close();
})().catch((e) => { console.log('FALHOU', e); process.exitCode = 1; process.exit(1); });
