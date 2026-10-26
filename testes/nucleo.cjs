// Testa o núcleo Kof (o KofNucleo de dentro do html montado) no Node: nomes de capítulo, zip, CRC, bordas.
//   node testes/nucleo.cjs dist/KOFlibrary.html
const fs = require('fs'), zlib = require('zlib');
const html = fs.readFileSync(process.argv[2], 'utf8');
const ini = html.indexOf('const KofNucleo = '), fim = html.indexOf('</script>', ini);
const K = new Function(html.slice(ini, fim) + '\nreturn KofNucleo;')();
let falhas = 0;
const igual = (a, b, msg) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) falhas++; console.log(ok ? 'ok' : 'FALHOU', msg, ok ? '' : JSON.stringify(a) + ' != ' + JSON.stringify(b)); };
const C = K.Capitulo;
for (const [nome, serie, vol, cap] of [
  ['One Piece v03 c025.cbz', 'One Piece', 3000, 25000],
  ['[Grupo] Berserk - Cap. 101.5.cbr', 'Berserk', -1, 101500],
  ['Naruto Vol.12.cbz', 'Naruto', 12000, -1],
  ['Chainsaw Man - Capítulo 7.cbz', 'Chainsaw Man', -1, 7000],
  ['vagabond_ch_150.cbz', 'Vagabond', -1, 150000],
  ['Dragon Ball #34.cbz', 'Dragon Ball', -1, 34000],
  ['Death Note Volume 01.cbz', 'Death Note', 1000, -1],
  ['Akira 05.cbz', 'Akira', -1, 5000],
  ['20th Century Boys v02.cbz', '20th Century Boys', 2000, -1],
  ['Slam Dunk Vol 4 Chapter 30.cbz', 'Slam Dunk', 4000, 30000],
]) {
  igual([C.serie(nome), C.volume(nome), C.capitulo(nome)], [serie, vol, cap], nome);
}
const pags = ['p10.jpg', 'p2.jpg', 'p1.jpg', 'p02b.jpg'].sort((a, b) => (C.chave(a) < C.chave(b) ? -1 : 1));
igual(pags, ['p1.jpg', 'p2.jpg', 'p02b.jpg', 'p10.jpg'], 'ordem natural das páginas');
// CRC-32 igual ao do zlib
const dados = Buffer.from('KOFlibrary lê mangá em Kof '.repeat(50));
igual(K.Zip.crcFim(K.Zip.crcAtualizar(K.Zip.crcInicio(), dados, dados.length)) >>> 0, zlib.crc32 ? zlib.crc32(dados) : 0, 'CRC-32 igual ao do zlib');
// zip feito pelo comando zip: acha o índice e os arquivos
const zip = fs.readFileSync(process.argv[3]);
const cauda = zip.subarray(Math.max(0, zip.length - 65557));
const p = K.Zip.fimCentral(cauda, cauda.length);
const ini2 = K.Zip.inicioCentral(cauda, p), tam = K.Zip.tamanhoCentral(cauda, p);
const idx = new K.Indice(zip.subarray(ini2, ini2 + tam), tam, K.Zip.quantos(cauda, p));
const nomes = [];
for (let i = 0; i < idx.quantos(); i++) nomes.push(zip.subarray(ini2 + idx.nomeIni(i), ini2 + idx.nomeIni(i) + idx.nomeLen(i)).toString());
console.log('  dentro do zip:', nomes.join(', '));
const k = nomes.findIndex((n) => n.endsWith('leia.txt'));
const loc = idx.local(k), d = loc + K.Zip.inicioDados(zip.subarray(loc, loc + 30));
const corpo = zip.subarray(d, d + idx.comprimido(k));
const texto = (idx.metodo(k) === 8 ? zlib.inflateRawSync(corpo) : corpo).toString();
igual(texto.trim(), 'mangá de teste', 'lê um arquivo de dentro do zip (método ' + idx.metodo(k) + ')');
// bordas: um quadrado preto no meio de uma página branca 100x100
const px = new Uint8ClampedArray(100 * 100 * 4).fill(255);
for (let y = 30; y < 70; y++) for (let x = 20; x < 80; x++) { const i = (y * 100 + x) * 4; px[i] = px[i + 1] = px[i + 2] = 0; }
igual(Array.from(K.Bordas.medir(px, 100, 100)), [19, 29, 81, 71], 'bordas brancas cortadas');
process.exitCode = falhas ? 1 : 0;
