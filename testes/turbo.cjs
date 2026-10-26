// Mangá turbo: quadro a quadro (ordem japonesa, página sem quadros inteira, voltar), duplo toque (página inteira /
// zoom no ponto), HD na placa de vídeo (scan pequeno em tela grande fica mais nítido) e o tempo de cada quadro.
//   python3 testes/gerar-paginas-quadros.py <pasta> && node testes/turbo.cjs <KOFlibrary.html> <pasta> <prints>
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs'), { execFileSync } = require('child_process');
const [html, pasta, prints] = process.argv.slice(2).map((p) => path.resolve(p));
const ok = (c, msg) => { if (!c) { console.log('FALHOU:', msg); process.exitCode = 1; } else console.log('ok', msg); };
(async () => {
  fs.mkdirSync(prints, { recursive: true });
  // dois .cbz: as páginas como estão e uma versão pequena (scan de 300 px de largura) pro HD
  const mangas = path.join(prints, 'Mangas'); fs.rmSync(mangas, { recursive: true, force: true }); fs.mkdirSync(mangas);
  execFileSync('python3', ['-c', `import sys,zipfile,glob,io,os\nfrom PIL import Image\nps=sorted(glob.glob(sys.argv[1]+'/pagina*.png'))\nfor nome,larg in (('Quadros de Teste c001.cbz',None),('Scan Pequeno c001.cbz',300)):\n  with zipfile.ZipFile(os.path.join(sys.argv[2],nome),'w') as z:\n    for p in ps:\n      im=Image.open(p)\n      if larg: im=im.resize((larg,round(im.height*larg/im.width)),Image.LANCZOS)\n      b=io.BytesIO(); im.save(b,'PNG'); z.writestr(os.path.basename(p),b.getvalue())`, pasta, mangas]);
  const b = await chromium.launch();
  const erros = [];
  // ---- celular em pé: quadro a quadro vem ligado
  const cel = await b.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  cel.on('pageerror', (e) => erros.push(String(e)));
  await cel.goto('file://' + html);
  await cel.waitForSelector('#vazio:not([hidden])');
  await cel.setInputFiles('#arquivoPasta', mangas);
  await cel.waitForFunction(() => KOFlibrary.livros.size === 2);
  await cel.click('#grade .livro:has-text("Quadros de Teste")');
  await cel.waitForSelector('.folha canvas.quadro');
  const estado = () => cel.evaluate(() => [KOFlibrary.L.atual, KOFlibrary.L.quadro, KOFlibrary.L.nQuadros]);
  ok(JSON.stringify(await estado()) === '[1,0,6]', 'abre no quadro 1 de 6 da página 1 ' + JSON.stringify(await estado()));
  ok((await cel.textContent('#lInfo')).startsWith('quadro 1 de 6'), 'mostra "quadro 1 de 6"');
  await cel.screenshot({ path: path.join(prints, 't1-quadro1.png') });
  const seq = [];
  for (let i = 0; i < 7; i++) { await cel.touchscreen.tap(30, 450); await cel.waitForTimeout(260); seq.push((await estado()).slice(0, 2).join('.')); }
  console.log('  toques na beirada esquerda:', seq.join(' '));
  ok(seq.join(' ') === '1.1 1.2 1.3 1.4 1.5 2.0 2.1', 'avança quadro por quadro e passa pra página seguinte');
  await cel.screenshot({ path: path.join(prints, 't2-quadro.png') });
  await cel.touchscreen.tap(360, 450); await cel.waitForTimeout(260);
  await cel.touchscreen.tap(360, 450); await cel.waitForTimeout(260);
  ok(JSON.stringify((await estado()).slice(0, 2)) === '[1,5]', 'voltar da página 2 vai pro último quadro da página 1');
  // splash (página 6): sem quadros, inteira
  await cel.evaluate(() => KOFlibrary.irPara(6, false)); await cel.waitForTimeout(400);
  ok((await estado())[1] === null, 'página sem quadros aparece inteira');
  await cel.evaluate(() => KOFlibrary.irPara(1, false)); await cel.waitForTimeout(400);
  // duplo toque no meio: página inteira e de volta
  await cel.touchscreen.tap(195, 450); await cel.waitForTimeout(80); await cel.touchscreen.tap(195, 450); await cel.waitForTimeout(500);
  ok(await cel.evaluate(() => KOFlibrary.L.verPagina) === true && !(await cel.$('.folha canvas.quadro')), 'duplo toque mostra a página inteira');
  await cel.screenshot({ path: path.join(prints, 't3-pagina-inteira.png') });
  await cel.touchscreen.tap(195, 450); await cel.waitForTimeout(80); await cel.touchscreen.tap(195, 450); await cel.waitForTimeout(500);
  ok(await cel.evaluate(() => KOFlibrary.L.verPagina) === false && !!(await cel.$('.folha canvas.quadro')), 'outro duplo toque volta pro quadro');
  // um toque só no meio ainda mostra/esconde as barras
  await cel.touchscreen.tap(195, 450); await cel.waitForTimeout(450);
  ok(await cel.evaluate(() => document.querySelector('#leitor').classList.contains('limpo')), 'um toque no meio ainda esconde as barras');
  // tempo de cada quadro com o processador 4x mais lento (celular médio)
  const cdp = await cel.context().newCDPSession(cel); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const t0 = Date.now(); for (let i = 0; i < 5; i++) { await cel.evaluate(() => KOFlibrary.passo(1)); await cel.waitForTimeout(50); }
  await cel.waitForTimeout(300);
  console.log(`  5 quadros com o processador 4x mais lento: ${Date.now() - t0} ms`);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  // ---- PC: quadro a quadro desligado (duas páginas); duplo clique = zoom; HD no scan pequeno
  const pc = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  pc.on('pageerror', (e) => erros.push(String(e)));
  await pc.goto('file://' + html);
  await pc.waitForSelector('#vazio:not([hidden])');
  await pc.setInputFiles('#arquivoPasta', mangas);
  await pc.waitForFunction(() => KOFlibrary.livros.size === 2);
  await pc.click('#grade .livro:has-text("Scan Pequeno")');
  await pc.waitForSelector('.folha canvas');
  ok(await pc.evaluate(() => !KOFlibrary.L.modo.quadros && KOFlibrary.L.quadro === null), 'no PC o quadro a quadro começa desligado');
  ok(await pc.evaluate(() => KOFlibrary.L.usouHD === true), 'HD ligou sozinho no scan pequeno');
  // nitidez: média da diferença entre vizinhos (borda mais definida = maior), HD x sem HD
  const nitidez = () => pc.evaluate(() => { const c = document.querySelector('.folha canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0, n = 0; for (let y = 1; y < c.height - 1; y += 2) for (let x = 1; x < c.width - 1; x += 2) { const i = (y * c.width + x) * 4; s += Math.abs(d[i] - d[i + 4]) + Math.abs(d[i] - d[i + 4 * c.width]); n++; } return s / n; });
  await pc.evaluate(() => KOFlibrary.ajustar({ tema: 'original' })); await pc.waitForTimeout(600);
  const comHD = await nitidez();
  await pc.screenshot({ path: path.join(prints, 't4-hd.png') });
  await pc.evaluate(() => KOFlibrary.mudarManga({ hd: false })); await pc.waitForTimeout(800);
  const semHD = await nitidez();
  await pc.screenshot({ path: path.join(prints, 't5-sem-hd.png') });
  console.log(`  nitidez das bordas: com HD ${comHD.toFixed(2)} · sem HD ${semHD.toFixed(2)}`);
  ok(comHD > semHD * 1.05, 'HD deixa as bordas mais nítidas');
  await pc.evaluate(() => KOFlibrary.mudarManga({ hd: true }));
  // duplo clique: zoom no ponto
  await pc.waitForTimeout(500);
  const r = await pc.evaluate(() => { const c = document.querySelector('.folha canvas').getBoundingClientRect(); return [c.left + c.width * 0.8, c.top + c.height * 0.2]; });
  await pc.mouse.dblclick(r[0], r[1]); await pc.waitForTimeout(700);
  const z = await pc.evaluate(() => { const b = document.querySelector('#paginas'); return [KOFlibrary.L.zoomPag, b.scrollWidth > b.clientWidth, b.scrollLeft > 0]; });
  ok(z[0] === 2.5 && z[1] && z[2], 'duplo clique dá zoom de 2,5x no ponto clicado ' + JSON.stringify(z));
  await pc.mouse.dblclick(700, 500); await pc.waitForTimeout(600);
  ok(await pc.evaluate(() => KOFlibrary.L.zoomPag) === 1, 'outro duplo clique volta');
  // liga o quadro a quadro no PC pelo painel
  await pc.keyboard.press('t'); await pc.check('#mgQuadros'); await pc.waitForTimeout(600);
  ok(await pc.evaluate(() => KOFlibrary.L.quadro === 0), 'ligando no painel o PC passa pro quadro a quadro');
  console.log('erros:', erros);
  ok(!erros.length, 'sem erros');
  await b.close();
})().catch((e) => { console.log('FALHOU', e); process.exitCode = 1; process.exit(1); });
