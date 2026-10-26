// Gera PDFs de teste (texto de domínio público/inventado + uma figura colorida) pelo Chromium.
//   node testes/gerar-pdfs.cjs <pasta>
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const pasta = process.argv[2];
const livros = [
  ['Machado_de_Assis - Dom Casmurro (1899).pdf', 'Dom Casmurro', 14],
  ['clean.code.2008.pdf', 'Clean Code', 4],
  ['Estudos/Kof - Guia da Linguagem.pdf', 'Guia da Linguagem Kof', 6],
  ['Estudos/HISTORIA DO BRASIL [scan].pdf', 'História do Brasil', 3],
];
const texto = 'Uma noite destas, vindo da cidade para o Engenho Novo, encontrei no trem da Central um rapaz aqui do bairro, que eu conheço de vista e de chapéu. Cumprimentou-me, sentou-se ao pé de mim, falou da lua e dos ministros, e acabou recitando-me versos. ';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  for (const [nome, titulo, n] of livros) {
    let html = '<style>body{font:15pt Georgia,serif;margin:0} .p{page-break-after:always;padding:50px 60px;height:1000px;box-sizing:border-box} h1{font-size:30pt} .fig{width:260px;height:120px;background:linear-gradient(90deg,#e33,#3a3,#33e);border-radius:10px;margin:20px 0}</style>';
    for (let i = 1; i <= n; i++) html += `<div class="p"><h1>${i === 1 ? titulo : 'Capítulo ' + (i - 1)}</h1>${i % 3 === 2 ? '<div class="fig"></div>' : ''}<p>${texto.repeat(5)}</p><p style="text-align:center">— ${i} —</p></div>`;
    await p.setContent(html);
    const f = path.join(pasta, nome);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    await p.pdf({ path: f, format: 'A4' });
  }
  await b.close();
})();
