// Teste do backup: exportar -> apagar o banco do navegador -> importar (tudo volta); backup automático gravado
// dentro da pasta de livros e juntado sozinho quando a pasta é escolhida de novo; "Relatar problema".
// A "pasta de livros" é uma pasta do OPFS (o navegador dá um FileSystemDirectoryHandle igual ao do seletor).
//   node testes/backup.cjs <KOFlibrary.html> <pasta-dos-pdfs> <pasta-de-trabalho>
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs'), http = require('http');
const [html, pdfs, trab] = process.argv.slice(2).map((p) => path.resolve(p));
const ok = (c, msg) => { if (!c) { console.log('FALHOU:', msg); process.exitCode = 1; } else console.log('ok', msg); };
const dom = path.join(pdfs, 'Machado_de_Assis - Dom Casmurro (1899).pdf');
(async () => {
  fs.rmSync(trab, { recursive: true, force: true }); fs.mkdirSync(trab, { recursive: true });
  const ctx = await chromium.launchPersistentContext(path.join(trab, 'perfil'), { acceptDownloads: true, viewport: { width: 1280, height: 800 } });
  const p = ctx.pages()[0];
  // servida por http local: o OPFS (a "pasta" do teste) não existe numa página file://
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html' }); fs.createReadStream(html).pipe(r); }).listen(18710);
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('http://127.0.0.1:18710/');
  await p.waitForSelector('#vazio:not([hidden])');
  // lê o Dom Casmurro até a página 6 com uma nota
  await p.setInputFiles('#arquivoPdf', [dom]);
  await p.waitForSelector('#grade .livro img');
  await p.click('#grade .livro');
  await p.waitForSelector('.pagina canvas');
  await p.evaluate(() => KOFlibrary.irPara(6, false));
  await p.waitForTimeout(300);
  await p.keyboard.press('n'); await p.fill('#txtNota', 'nota que tem que sobreviver'); await p.click('#btSalvarNota');
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape');
  // exportar
  await p.click('#btAjustes');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#btExportarBackup')]);
  const arq = path.join(trab, dl.suggestedFilename()); await dl.saveAs(arq);
  const b = JSON.parse(fs.readFileSync(arq, 'utf8'));
  ok(b.formato === 'koflibrary-backup' && b.livros[0].pagina === 6 && b.livros[0].notas[0].texto.includes('sobreviver'), 'backup exportado com página e nota (' + path.basename(arq) + ')');
  await p.click('#dlgAjustes button:has-text("Fechar")');
  // apaga o banco do navegador (como "limpar dados")
  await p.evaluate(() => new Promise((ok) => { KOFlibrary.__fechar = 1; indexedDB.deleteDatabase('koflibrary').onsuccess = ok; setTimeout(ok, 1500); }));
  await p.reload();
  await p.waitForSelector('#vazio:not([hidden])');
  ok(await p.evaluate(() => KOFlibrary.livros.size) === 0, 'banco apagado: biblioteca vazia');
  await p.setInputFiles('#arquivoBackup', arq);
  await p.waitForFunction(() => KOFlibrary.livros.size === 1);
  let r = await p.evaluate(() => { const l = [...KOFlibrary.livros.values()][0]; return { pagina: l.pagina, notas: l.notas.length, fonte: KOFlibrary.fontes.has(l.id) }; });
  ok(r.pagina === 6 && r.notas === 1 && !r.fonte, 'importar devolve página e nota (o PDF ainda não está, fica "fora")');
  await p.setInputFiles('#arquivoPdf', [dom]);
  await p.waitForFunction(() => KOFlibrary.fontes.size === 1);
  r = await p.evaluate(() => { const l = [...KOFlibrary.livros.values()][0]; return { pagina: l.pagina, notas: l.notas.length }; });
  ok(r.pagina === 6 && r.notas === 1, 'adicionando o PDF de novo ele volta a abrir, com o progresso');
  await p.click('#btAjustes');
  await p.screenshot({ path: path.join(trab, 'ajustes.png') });
  await p.click('#dlgAjustes button:has-text("Fechar")');

  // ---- backup automático na pasta (OPFS no lugar da pasta escolhida)
  await p.evaluate(async (b64) => {
    const raiz = await navigator.storage.getDirectory();
    const dir = await raiz.getDirectoryHandle('Livros', { create: true });
    const w = await (await dir.getFileHandle('Machado_de_Assis - Dom Casmurro (1899).pdf', { create: true })).createWritable();
    await w.write(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))); await w.close();
    await KOFlibrary.adicionarPasta(dir);
    await KOFlibrary.ligarBackupAuto();
  }, fs.readFileSync(dom).toString('base64'));
  const noArquivo = await p.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Livros');
    return JSON.parse(await (await (await dir.getFileHandle('KOFlibrary-backup.koflib')).getFile()).text());
  });
  ok(noArquivo.livros.length === 1 && noArquivo.livros[0].pagina === 6, 'backup automático gravado dentro da pasta');
  // apaga o banco de novo; escolher a pasta de novo traz tudo sozinho
  await p.evaluate(() => new Promise((ok) => { indexedDB.deleteDatabase('koflibrary').onsuccess = ok; setTimeout(ok, 1500); }));
  await p.reload();
  await p.waitForSelector('#vazio:not([hidden])');
  await p.evaluate(async () => KOFlibrary.adicionarPasta(await (await navigator.storage.getDirectory()).getDirectoryHandle('Livros')));
  r = await p.evaluate(() => { const l = [...KOFlibrary.livros.values()][0]; return l && { pagina: l.pagina, notas: l.notas.length, fonte: KOFlibrary.fontes.has(l.id) }; });
  ok(r && r.pagina === 6 && r.notas === 1 && r.fonte, 'escolhendo a pasta de novo o progresso volta sozinho (backup da pasta)');
  // relatar problema
  await p.evaluate(() => console.error('erro de teste 123'));
  await p.click('#btAjustes'); await p.click('#btRelatar');
  const rel = await p.inputValue('#txtRelatorio');
  ok(rel.includes('KOFlibrary') && rel.includes('erro de teste 123') && rel.includes('Biblioteca: 1'), 'relatório com versão, biblioteca e erros');
  await p.screenshot({ path: path.join(trab, 'relatorio.png') });
  console.log('erros:', erros);
  ok(!erros.length, 'sem erros na página');
  await ctx.close(); srv.close();
})().catch((e) => { console.log('FALHOU', e); process.exitCode = 1; process.exit(1); });
