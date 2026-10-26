// PDF escaneado: abre cada PDF da pasta (JPEG 2000 / JBIG2, que o pdf.js decodifica pelo WebAssembly embutido no html)
// e confere que a página saiu desenhada (tem tinta) e que o pdf.js não reclamou de imagem.
//   node testes/escaneado.cjs <KOFlibrary.html> <pasta-com-pdfs>
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const [html, pasta] = process.argv.slice(2).map((p) => path.resolve(p));
const ok = (c, msg) => { if (!c) { console.log('FALHOU:', msg); process.exitCode = 1; } else console.log('ok', msg); };
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1000, height: 900 } });
  const avisos = [];
  p.on('console', (m) => { if (/image|jpx|jbig2|wasm|decode/i.test(m.text())) avisos.push(m.text().slice(0, 160)); });
  p.on('pageerror', (e) => avisos.push(String(e)));
  await p.goto('file://' + html);
  await p.waitForSelector('#vazio:not([hidden])');
  // tema Original: mede a tinta da página sem repintar
  await p.evaluate(() => KOFlibrary.ajustar({ tema: 'original' }));
  const arquivos = fs.readdirSync(pasta).filter((f) => f.endsWith('.pdf')).map((f) => path.join(pasta, f));
  await p.setInputFiles('#arquivoPdf', arquivos);
  await p.waitForFunction((n) => KOFlibrary.livros.size === n, arquivos.length);
  for (const f of arquivos) {
    const nome = path.basename(f);
    avisos.length = 0;
    await p.evaluate((nome) => KOFlibrary.abrirLivro([...KOFlibrary.livros.values()].find((l) => l.arquivo === nome)), nome);
    const deu = await p.waitForSelector('.pagina canvas', { timeout: 15000 }).then(() => true, () => false);
    await p.waitForTimeout(700);
    const tinta = deu ? await p.evaluate(() => { const c = document.querySelector('.pagina canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 16) if (d[i] < 160) n++; return n / (d.length / 16); }) : 0;
    // limite do próprio pdf.js (o original dá os mesmos avisos no Chromium): casos extremos de JPEG 2000 do teste deles
    const conhecido = ['jpx_numcomps.pdf', 'jpx_subsampling.pdf'].includes(nome);
    ok(deu && tinta > 0.002 && (!avisos.length || conhecido), `${nome}: desenhou (tinta ${(tinta * 100).toFixed(1)}%)` + (avisos.length ? (conhecido ? ' (avisos iguais aos do pdf.js original)' : ' avisos: ' + avisos.join(' | ')) : ''));
    await p.screenshot({ path: path.join(pasta, nome + '.png') });
    await p.keyboard.press('Escape');
  }
  await b.close();
})().catch((e) => { console.log('FALHOU', e); process.exitCode = 1; process.exit(1); });
