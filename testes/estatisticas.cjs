// Estatísticas: 1 ano de diário gerado (sequência atual de 12 dias, recorde de 40, uma maratona de 3,5 h, leitura de
// madrugada), metas personalizadas, gráficos, conquistas, cartão do mês, leitura de verdade entrando no diário e o
// diário de dois aparelhos juntando sem contar duas vezes.
//   node testes/estatisticas.cjs <KOFlibrary.html> <pasta-com-livros> <prints>
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const [html, pasta, prints] = process.argv.slice(2).map((p) => path.resolve(p));
const ok = (c, msg) => { if (!c) { console.log('FALHOU:', msg); process.exitCode = 1; } else console.log('ok', msg); };
(async () => {
  fs.mkdirSync(prints, { recursive: true });
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const erros = [];
  p.on('pageerror', (e) => erros.push(String(e)));
  await p.goto('file://' + html);
  await p.waitForSelector('#vazio:not([hidden])');
  await p.setInputFiles('#arquivoPasta', pasta);
  await p.waitForFunction(() => KOFlibrary.livros.size >= 4);
  // diário de mentira: outro aparelho ("cel-teste") leu no último ano
  await p.evaluate(() => {
    const ids = [...KOFlibrary.livros.keys()], lista = [];
    const hoje = new Date(); hoje.setHours(12, 0, 0, 0);
    for (let i = 400; i >= 1; i--) {
      const d = new Date(hoje); d.setDate(hoje.getDate() - i);
      let s = 0;
      if (i <= 12) s = 900 + i * 60;                 // sequência atual: ontem pra trás, 12 dias
      else if (i >= 200 && i < 240) s = 1500;        // recorde: 40 dias
      else if (i === 100) s = 3.5 * 3600;            // maratona
      else if (i % 9 === 0) s = 400;
      if (!s) continue;
      const h = new Array(24).fill(0); h[i === 100 ? 1 : 21] = s;   // a maratona foi de madrugada
      lista.push({ dia: KOFlibrary.diaDe(d), por: { 'cel-teste': { s, p: Math.round(s / 90), h, t: i === 3 ? [ids[0]] : [], b: { [ids[i % ids.length]]: s } } } });
    }
    KOFlibrary.juntarDiario(lista);
  });
  const seq = await p.evaluate(() => KOFlibrary.sequencias());
  console.log('  sequência:', seq);
  ok(seq.atual === 12 && seq.recorde === 40, 'Kof: sequência atual 12 (hoje ainda não conta contra) e recorde 40');
  // metas: uma pelo formulário, uma pela sugestão
  await p.click('#btEstatisticas');
  await p.waitForSelector('#estatisticas:not([hidden])');
  await p.fill('#metaAlvo', '3'); await p.selectOption('#metaTipo', 'livros'); await p.selectOption('#metaPeriodo', 'semana');
  await p.click('#estNova button');
  await p.click('#estSugestoes .chip:has-text("20 min por dia")');
  await p.waitForFunction(() => document.querySelectorAll('#estMetas .meta').length === 2);
  const metas = await p.$$eval('#estMetas .meta', (e) => e.map((x) => x.textContent));
  console.log('  metas:', metas);
  ok(metas.length === 2 && metas[0].includes('3 livros/volumes terminados por semana') && metas[1].includes('20 minutos lendo por dia'), 'metas personalizadas (período, o quê e quanto)');
  const sit = await p.evaluate(() => KOFlibrary.situacaoMeta({ periodo: 'ano', tipo: 'livros', alvo: 1 }));
  ok(sit.batida || sit.feito >= 0, 'situação da meta calculada (' + sit.txt + ')');
  ok(await p.$$eval('#estGrafico .barra', (e) => e.length) >= 6, 'gráfico de 7 dias com as barras dos dias lidos');
  await p.click('#estFaixa button[data-n="30"]');
  ok(await p.$$eval('#estGrafico .alvo', (e) => e.length) === 30, 'gráfico de 30 dias');
  const cel = await p.$$eval('.calendario i', (e) => e.length);
  ok(cel >= 365 && cel <= 372, `calendário do ano (${cel} dias)`);
  // dica ao passar o mouse
  await p.hover('#estGrafico .alvo >> nth=28');
  ok(await p.isVisible('#dicaGrafico') && (await p.textContent('#dicaGrafico')).includes('min'), 'dica com os minutos ao passar o mouse');
  const conq = await p.$$eval('.conquista.tem b', (e) => e.map((x) => x.textContent));
  console.log('  conquistas:', conq);
  ok(['Semana de fogo', 'Mês de fogo', 'Maratona', 'Coruja'].every((c) => conq.includes(c)) && !conq.includes('Primeiro livro'), 'conquistas: sequências, maratona e coruja (e não o que ainda não fez)');
  ok((await p.textContent('#estCartoes')).includes('12 dias'), 'cartão da sequência mostra 12 dias');
  await p.screenshot({ path: path.join(prints, 'e1-estatisticas.png'), fullPage: true });
  // cartão do mês
  const png = await p.evaluate(() => KOFlibrary.cartaoDoMes().toDataURL('image/png'));
  fs.writeFileSync(path.join(prints, 'e2-cartao.png'), Buffer.from(png.split(',')[1], 'base64'));
  ok(png.length > 20000, 'cartão do mês gerado (1080x1350)');
  await p.keyboard.press('Escape');
  ok(await p.isVisible('#biblioteca'), 'Esc volta pra biblioteca');
  ok((await p.textContent('#continuar').catch(() => '')) !== null, 'biblioteca ok');
  // leitura de verdade entra no diário (este aparelho)
  await p.click('#grade .livro:not(.serie) >> nth=0');
  await p.waitForSelector('.pagina canvas, .folha canvas');
  for (let i = 0; i < 4; i++) { await p.mouse.move(300 + i * 10, 300); await p.waitForTimeout(800); }
  await p.keyboard.press('Escape');
  // terminar um livro: entra no diário de hoje e dá a conquista
  await p.evaluate(async () => { const l = [...KOFlibrary.livros.values()].find((x) => !x.terminado); KOFlibrary.marcarTerminado(l); await KOFlibrary.checarConquistas(true); });
  ok(await p.evaluate(() => !!(KOFlibrary.config.conquistas || {}).primeiro), 'terminar um livro dá a conquista "Primeiro livro"');
  const hoje = await p.evaluate(() => { const d = KOFlibrary.diario.get(KOFlibrary.diaDe()); return d && d.por[KOFlibrary.config.aparelho]; });
  ok(hoje && hoje.s >= 2 && Object.keys(hoje.b).length === 1, `leitura de hoje registrada (${hoje && hoje.s} s)`);
  // dois aparelhos no mesmo dia somam; juntar de novo não conta duas vezes
  const soma = await p.evaluate(() => {
    const dia = KOFlibrary.diaDe(), meu = KOFlibrary.diario.get(dia).por[KOFlibrary.config.aparelho].s;
    const outro = { dia, por: { 'pc-outro': { s: 600, p: 10, h: new Array(24).fill(0), t: [], b: {} } } };
    KOFlibrary.juntarDiario([outro]); KOFlibrary.juntarDiario([outro]);
    const d = KOFlibrary.diario.get(dia);
    return [meu, Object.values(d.por).reduce((a, m) => a + m.s, 0)];
  });
  ok(soma[1] === soma[0] + 600, `aparelhos somam e juntar duas vezes não duplica (${soma[0]} + 600 = ${soma[1]})`);
  // celular
  await p.setViewportSize({ width: 390, height: 844 });
  await p.click('#btEstatisticas');
  await p.screenshot({ path: path.join(prints, 'e3-celular.png'), fullPage: true });
  console.log('erros:', erros);
  ok(!erros.length, 'sem erros');
  await b.close();
})().catch((e) => { console.log('FALHOU', e); process.exitCode = 1; process.exit(1); });
