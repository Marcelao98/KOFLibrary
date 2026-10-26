// Teste do mangá no navegador: .cbz (zip comprimido e sem compressão) e .cbr, séries, capítulos, direita->esquerda,
// página dupla, página larga sozinha, fim do capítulo -> próximo, temas, cortar bordas e webtoon.
//   python3 testes/gerar-mangas.py <pasta> && node testes/manga.cjs <KOFlibrary.html> <pasta> <prints>
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const [html, pasta, prints] = process.argv.slice(2).map((p) => path.resolve(p));
const ok = (c, msg) => { if (!c) { console.log('FALHOU:', msg); process.exitCode = 1; } else console.log('ok', msg); };
(async () => {
  fs.mkdirSync(prints, { recursive: true });
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });
  await p.goto('file://' + html);
  await p.waitForSelector('#vazio:not([hidden])');
  await p.setInputFiles('#arquivoPasta', pasta);
  await p.waitForFunction(() => [...KOFlibrary.livros.values()].every((l) => l.temCapa), null, { timeout: 60000 });
  await p.waitForTimeout(600);
  ok(await p.$('#grade .livro.serie .capa img') !== null, 'a série mostra a capa do 1º capítulo');
  const erroCapa = await p.evaluate(() => [...KOFlibrary.livros.values()].filter((l) => l.erro).map((l) => l.arquivo + ': ' + l.erro));
  ok(!erroCapa.length, 'todas as capas saíram ' + JSON.stringify(erroCapa));
  const cartoes = await p.$$eval('#grade .livro .titulo', (e) => e.map((x) => x.textContent));
  console.log('cartões:', cartoes);
  ok(cartoes.includes('🗾 One Piece') && cartoes.filter((t) => t.includes('One Piece')).length === 1, 'One Piece vira um cartão de série');
  ok(cartoes.some((t) => t.startsWith('Berserk')), 'capítulo sozinho fica como livro');
  await p.screenshot({ path: path.join(prints, 'm1-biblioteca.png') });
  await p.click('#grade .livro.serie');
  const caps = await p.$$eval('#grade .livro .titulo', (e) => e.map((x) => x.textContent));
  console.log('capítulos:', caps);
  ok(JSON.stringify(caps) === JSON.stringify(['Vol. 1 · Cap. 1', 'Vol. 1 · Cap. 2', 'Vol. 1 · Cap. 3']), 'capítulos em ordem');
  await p.screenshot({ path: path.join(prints, 'm2-serie.png') });

  // ---- capítulo 1: direita->esquerda, página dupla
  await p.click('#grade .livro:has-text("Cap. 1")');
  await p.waitForSelector('#paginas.paginado .folha canvas');
  const mostradas = () => p.evaluate(() => KOFlibrary.L.mostradas);
  ok(JSON.stringify(await mostradas()) === '[1]', 'capa sozinha');
  const passos = [];
  for (let i = 0; i < 4; i++) { await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(250); passos.push(JSON.stringify(await mostradas())); }
  console.log('seta pra esquerda:', passos.join(' '));
  ok(passos.join(' ') === '[2,3] [4,5] [6] [7,8]', 'seta pra esquerda avança, duas páginas por vez, a larga (6) sozinha');
  await p.screenshot({ path: path.join(prints, 'm3-dupla.png') });
  const ordemNaTela = await p.evaluate(() => { const cs = [...document.querySelectorAll('.folha canvas')]; return cs.map((c) => Math.round(c.getBoundingClientRect().left)); });
  ok(ordemNaTela[0] > ordemNaTela[1], 'página 7 fica à direita da 8 (leitura japonesa)');
  await p.keyboard.press('ArrowRight'); await p.waitForTimeout(250);
  ok(JSON.stringify(await mostradas()) === '[6]', 'seta pra direita volta');
  // tema Noite: o papel branco do mangá fica escuro
  await p.keyboard.press('t');
  await p.click('.tema[title="Noite"]');
  await p.waitForTimeout(500);
  const canto = await p.evaluate(() => { const c = document.querySelector('.folha canvas'); return [...c.getContext('2d').getImageData(3, 3, 1, 1).data].slice(0, 3); });
  ok(canto[0] < 40, 'tema Noite repinta a página do mangá ' + canto);
  await p.screenshot({ path: path.join(prints, 'm4-noite.png') });
  // cortar bordas
  const prop = () => p.evaluate(() => { const c = document.querySelector('.folha canvas'); return c.width / c.height; });
  const antes = await prop();
  await p.check('#mgCortar');
  await p.waitForSelector('#paginas.paginado .folha canvas');
  await p.waitForTimeout(600);
  const depois = await prop();
  console.log('proporção antes/depois do corte:', antes.toFixed(3), depois.toFixed(3));
  ok(Math.abs(depois - antes) > 0.01, 'cortar bordas muda a página');
  ok(await p.inputValue('#lPagina') === '6', 'continua na mesma página depois de cortar');
  await p.uncheck('#mgCortar');
  await p.waitForTimeout(600);
  await p.keyboard.press('Escape');
  // fim do capítulo -> próximo
  await p.evaluate(() => KOFlibrary.irPara(12, false));
  await p.waitForTimeout(300);
  await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(200);
  ok(await p.isVisible('#fimCap'), 'no fim aparece o aviso de fim do capítulo');
  ok((await p.textContent('#btFimProx')).includes('Cap. 2'), 'oferece o próximo capítulo');
  await p.screenshot({ path: path.join(prints, 'm5-fim.png') });
  await p.click('#btFimProx');
  await p.waitForFunction(() => KOFlibrary.L.livro && KOFlibrary.L.livro.arquivo.includes('c002') && document.querySelector('.folha canvas'));
  ok(true, 'abriu o capítulo 2 (zip sem compressão)');
  // .cbr
  await p.keyboard.press('Escape');
  ok(await p.isVisible('#chips .chip:has-text("One Piece")'), 'voltando do leitor a biblioteca continua dentro da série');
  await p.click('#grade .livro:has-text("Cap. 3")');
  await p.waitForSelector('#paginas.paginado .folha canvas', { timeout: 20000 });
  ok(await p.evaluate(() => KOFlibrary.L.doc.numPages) === 5, 'abriu o .cbr (RAR) com 5 páginas');
  await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(300);
  ok(JSON.stringify(await mostradas()) === '[2,3]', 'o .cbr vira página também');
  // webtoon
  await p.keyboard.press('t');
  await p.click('#direcoes button[data-d="vertical"]');
  await p.waitForSelector('#paginas .pagina canvas');
  ok(await p.evaluate(() => document.querySelectorAll('#paginas .pagina').length) === 5 && await p.inputValue('#lPagina') === '2', 'modo webtoon (rolagem) na mesma página');
  await p.screenshot({ path: path.join(prints, 'm6-webtoon.png') });
  await p.click('#direcoes button[data-d="rtl"]');
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape');
  // celular em pé: uma página por vez, toque na beirada esquerda avança
  await p.setViewportSize({ width: 390, height: 844 });
  await p.click('#chips .chip:has-text("Voltar")').catch(() => {});
  await p.click('#grade .livro:has-text("Berserk")');
  await p.waitForSelector('#paginas.paginado .folha canvas');
  ok(JSON.stringify(await mostradas()) === '[1]', 'celular em pé: uma página');
  await p.screenshot({ path: path.join(prints, 'm7-celular.png') });
  console.log('erros:', erros);
  ok(!erros.length, 'sem erros no console');
  await b.close();
})().catch((e) => { console.log('FALHOU', e); process.exitCode = 1; process.exit(1); });
