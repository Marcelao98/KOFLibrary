// Mede o detector de quadros (Kof: Quadros) nas páginas do gerar-paginas-quadros.py: cada quadro do gabarito tem que
// ter um quadro achado com IoU >= 0,7, na ordem japonesa. Página com "aceita_junto" pode vir com os quadros juntos.
// Também desenha os retângulos achados por cima de cada página (<pasta>/achado-NN.png) pra olhar.
//   node testes/quadros.cjs <KOFlibrary.html> <pasta-das-paginas>
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const [html, pasta] = process.argv.slice(2);
const src = fs.readFileSync(html, 'utf8'), i0 = src.indexOf('const KofNucleo = ');
const K = new Function(src.slice(i0, src.indexOf('</script>', i0)) + '\nreturn KofNucleo;')();
const gab = JSON.parse(fs.readFileSync(path.join(pasta, 'gabarito.json')));
const L = 300;   // a página pequena que o app usa
let falhas = 0, achadosTotal = 0, certosTotal = 0;
const iou = (a, b) => { const x = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])), y = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1])), i = x * y; return i / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i); };
for (const [nome, g] of Object.entries(gab)) {
  // a página em tons de cinza, com 300 de largura (o PIL faz o papel do canvas do app)
  const raw = execFileSync('python3', ['-c', `import sys\nfrom PIL import Image\nim=Image.open(sys.argv[1]).convert('L')\nh=round(im.height*${L}/im.width)\nim=im.resize((${L},h),Image.BILINEAR)\nsys.stdout.buffer.write(h.to_bytes(4,'little')+im.tobytes())`, path.join(pasta, nome)]);
  const h = raw.readUInt32LE(0), lum = new Int32Array(raw.subarray(4));
  const r = K.Quadros ? new K.Quadros(lum, L, h, true).achar() : [0];
  const f = 900 / L, achados = [];
  for (let k = 0; k < r[0]; k++) achados.push([r[1 + 4 * k] * f, r[2 + 4 * k] * f, r[3 + 4 * k] * f, r[4 + 4 * k] * f]);
  // cada quadro do gabarito casa com o achado na mesma posição da ordem
  let certos = 0;
  g.quadros.forEach((q, k) => { if (achados[k] && iou(q, achados[k]) >= 0.7) certos++; });
  const ok = certos === g.quadros.length && achados.length === g.quadros.length;
  const junto = g.aceita_junto && achados.length >= 1;
  achadosTotal += g.quadros.length; certosTotal += ok ? g.quadros.length : certos;
  if (!ok && !junto) falhas++;
  console.log(`${ok ? 'ok' : junto ? 'ok (juntou, aceito)' : 'FALHOU'} ${nome}: gabarito ${g.quadros.length}, achou ${achados.length}, ${certos} certos na ordem`);
  execFileSync('python3', ['-c', `import sys,json\nfrom PIL import Image,ImageDraw\nim=Image.open(sys.argv[1]).convert('RGB')\nd=ImageDraw.Draw(im)\nfor k,q in enumerate(json.loads(sys.argv[3])):\n  d.rectangle(q,outline=(220,40,40),width=6)\n  d.text((q[0]+12,q[1]+8),str(k+1),fill=(220,40,40))\nim.save(sys.argv[2])`, path.join(pasta, nome), path.join(pasta, 'achado-' + nome), JSON.stringify(achados)]);
}
console.log(`acerto: ${certosTotal}/${achadosTotal} quadros`);
process.exitCode = falhas ? 1 : 0;
