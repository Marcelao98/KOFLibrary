// Teste do KOFlibrary.html no Chromium: adiciona PDFs, abre, troca tema, marca, anota,
// recarrega e confere que lembrou de tudo. Tira prints.
//   node testes/navegador.cjs <KOFlibrary.html> <pasta-dos-pdfs> <pasta-dos-prints>
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const [html, pdfs, prints] = process.argv.slice(2);
const todos = [];
(function achar(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? achar(p) : todos.push(p); } })(pdfs);
const ok = (c, msg) => { if (!c) { console.log('FALHOU:', msg); process.exitCode = 1; } else console.log('ok', msg); };
(async () => {
  fs.mkdirSync(prints, { recursive: true });
  const ctx = await chromium.launchPersistentContext(path.join(prints, '.perfil'), { viewport: { width: 1280, height: 800 } });
  const p = ctx.pages()[0] || await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });
  await p.goto('file://' + path.resolve(html));
  await p.waitForSelector('#vazio:not([hidden])');
  await p.screenshot({ path: path.join(prints, '1-vazio.png') });
  await p.setInputFiles('#arquivoPdf', todos);
  await p.waitForFunction(() => document.querySelectorAll('.livro img').length >= 4, null, { timeout: 30000 });
  const titulos = await p.$$eval('.livro .titulo', (e) => e.map((x) => x.textContent));
  console.log('títulos:', titulos);
  ok(titulos.includes('Dom Casmurro') && titulos.includes('Clean Code'), 'títulos tirados do nome do arquivo (Kof)');
  const autor = await p.$$eval('.livro .autor', (e) => e.map((x) => x.textContent));
  console.log('autores:', autor);
  await p.screenshot({ path: path.join(prints, '2-biblioteca.png') });
  // busca sem acento, fora de ordem
  await p.fill('#busca', 'casmurro dom');
  ok((await p.$$('.livro')).length === 1, 'busca por palavras fora de ordem');
  await p.fill('#busca', 'historia');
  ok((await p.$$('.livro')).length === 1, 'busca sem acento');
  await p.fill('#busca', '');
  // abre o Dom Casmurro
  await p.click('.livro:has-text("Dom Casmurro")');
  await p.waitForSelector('.pagina canvas');
  await p.waitForTimeout(500);
  await p.screenshot({ path: path.join(prints, '3-leitor-sepia.png') });
  // vai pra página 5 pelo teclado
  for (let i = 0; i < 4; i++) { await p.keyboard.press('ArrowRight'); await p.waitForTimeout(80); }
  await p.waitForTimeout(400);
  ok(await p.inputValue('#lPagina') === '5', 'setas mudam de página (' + await p.inputValue('#lPagina') + ')');
  // tema Noite
  await p.keyboard.press('t');
  await p.click('.tema[title="Café à noite"]');
  await p.waitForTimeout(800);
  const cor = await p.evaluate(() => {
    const c = [...document.querySelectorAll('.pagina canvas')][0];
    const d = c.getContext('2d').getImageData(5, 5, 1, 1).data; return [d[0], d[1], d[2]];
  });
  console.log('canto da página no Café à noite:', cor);
  ok(Math.abs(cor[0] - 0x1e) < 6 && Math.abs(cor[1] - 0x16) < 6, 'Pintor (Kof) repinta o papel');
  await p.screenshot({ path: path.join(prints, '4-leitor-cafe-noite.png') });
  await p.keyboard.press('Escape');
  // marcador + nota
  await p.keyboard.press('b');
  await p.keyboard.press('n');
  await p.fill('#txtNota', 'Capitu, olhos de ressaca.');
  await p.click('#btSalvarNota');
  await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(prints, '5-notas.png') });
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#btExportar')]);
  const md = fs.readFileSync(await dl.path(), 'utf8');
  ok(md.includes('Capitu') && md.includes('Página 5'), 'exporta as anotações em .md');
  // zoom
  await p.keyboard.press('Escape');
  await p.keyboard.press('+');
  await p.waitForTimeout(300);
  ok(await p.inputValue('#lPagina') === '5', 'zoom fica na mesma página');
  // tempo de leitura conta
  await p.mouse.move(400, 400); await p.waitForTimeout(2200);
  // recarrega: lembra página, tema, nota, marcador
  await p.reload();
  await p.waitForSelector('#continuar:not([hidden])');
  await p.waitForFunction(() => document.querySelectorAll('#grade .livro img').length >= 4, null, { timeout: 10000 }).catch(() => {});
  ok((await p.$$('#grade .livro img')).length === 4, 'capas voltam depois de recarregar');
  await p.screenshot({ path: path.join(prints, '6-continuar.png') });
  const reg = await p.evaluate(() => { const l = [...KOFlibrary.livros.values()].find((x) => x.titulo === 'Dom Casmurro'); return { pagina: l.pagina, notas: l.notas.length, marcadores: l.marcadores, seg: l.segundos, paginas: l.paginas }; });
  console.log('depois de recarregar:', reg);
  ok(reg.pagina === 5 && reg.notas === 1 && reg.marcadores[0] === 5 && reg.seg >= 1, 'lembrou página, nota, marcador e tempo');
  await p.click('.cont-grande');
  await p.waitForSelector('.pagina canvas');
  await p.waitForTimeout(600);
  ok(await p.inputValue('#lPagina') === '5', 'reabre na página onde parou');
  // desempenho do Pintor numa página grande
  const ms = await p.evaluate(() => { const px = new Uint8ClampedArray(1600 * 2200 * 4).fill(200); const t = performance.now(); new KofNucleo.Pintor().pintar(px, px.length); return performance.now() - t; });
  console.log('Pintor numa página de 1600x2200:', ms.toFixed(1), 'ms');
  // tema do app claro + celular
  await p.keyboard.press('Escape');
  await p.click('#btAjustes'); await p.click('#listaApp button:has-text("Café claro")'); await p.click('#dlgAjustes button:has-text("Fechar")');
  await p.screenshot({ path: path.join(prints, '7-app-claro.png') });
  await p.setViewportSize({ width: 390, height: 800 });
  await p.screenshot({ path: path.join(prints, '8-celular.png') });
  console.log('erros no console:', erros);
  ok(!erros.length, 'sem erros no console');
  await ctx.close();
})();
