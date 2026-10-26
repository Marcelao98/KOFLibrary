// KOFlibrary: a interface. O que é conta (temas que repintam a página, nome do
// livro tirado do arquivo, busca, tempo de leitura) está no núcleo em Kof
// (nucleo/, compilado pra JavaScript: KofNucleo). O PDF é desenhado pelo pdf.js.
'use strict';
const K = KofNucleo;
const VERSAO = '{{VERSAO}}';
// no celular a página roda dentro do app Android (android/), que dá a ponte KOFlibraryApk
const APK = window.KOFlibraryApk || null;
if (APK) {
  document.documentElement.classList.add('celular');
  document.querySelector('meta[name=viewport]').content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
}
const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, ...filhos) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos) if (f != null) e.append(f);
  return e;
};

// ---------------------------------------------------------------- pdf.js
let pdfjs = null;
async function motor() {
  if (pdfjs) return pdfjs;
  const url = URL.createObjectURL(new Blob([PDFJS_FONTE], { type: 'text/javascript' }));
  pdfjs = await import(url);
  const trab = URL.createObjectURL(new Blob([PDFJS_TRABALHADOR], { type: 'text/javascript' }));
  pdfjs.GlobalWorkerOptions.workerPort = new Worker(trab);
  return pdfjs;
}
// os .wasm do pdf.js vêm dentro do html (base64): o navegador não deixa buscar arquivo do lado num file://
class Embutidos {
  constructor() {}
  async fetch({ kind, filename }) {
    if (kind === 'wasmUrl' && PDFJS_WASM[filename]) return Uint8Array.from(atob(PDFJS_WASM[filename]), (c) => c.charCodeAt(0));
    throw new Error('não embutido: ' + filename);
  }
}
async function abrirPdf(fonte) {
  const lib = await motor();
  await fechando;
  // fonte com url (o arquivo servido pelo app Android): o pdf.js busca só os pedaços que vai desenhar
  const de = fonte.url ? { url: fonte.url, disableAutoFetch: true, disableStream: true, rangeChunkSize: 262144 }
    : { data: new Uint8Array(await (await fonte()).arrayBuffer()) };
  return lib.getDocument({
    ...de, wasmUrl: 'embutido/', useWorkerFetch: false, BinaryDataFactory: Embutidos,
    isEvalSupported: false, enableScripting: false,
  }).promise;
}
// o pdf.js 6 fecha o documento pela tarefa que abriu ele. Fechar é assíncrono e o trabalhador (worker) é um só:
// abrir outro antes de terminar de fechar falha ("the worker is being destroyed"), então o abrirPdf espera
let fechando = Promise.resolve();
function fecharPdf(doc) { const f = doc.loadingTask.destroy().catch(() => {}); fechando = Promise.all([fechando, f]); return f; }

// ---------------------------------------------------------------- banco (IndexedDB)
const Banco = {
  db: null,
  abrir() {
    return new Promise((ok, erro) => {
      const r = indexedDB.open('koflibrary', 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore('livros', { keyPath: 'id' });
        db.createObjectStore('capas');
        db.createObjectStore('arquivos');
        db.createObjectStore('config');
      };
      r.onsuccess = () => { this.db = r.result; ok(); };
      r.onerror = () => erro(r.error);
    });
  },
  op(loja, modo, f) {
    return new Promise((ok, erro) => {
      const t = this.db.transaction(loja, modo);
      const req = f(t.objectStore(loja));
      t.oncomplete = () => ok(req && req.result);
      t.onerror = () => erro(t.error);
    });
  },
  get(loja, k) { return this.op(loja, 'readonly', (s) => s.get(k)); },
  put(loja, v, k) { return this.op(loja, 'readwrite', (s) => (k === undefined ? s.put(v) : s.put(v, k))); },
  del(loja, k) { return this.op(loja, 'readwrite', (s) => s.delete(k)); },
  todos(loja) { return this.op(loja, 'readonly', (s) => s.getAll()); },
};
const config = {};   // cópia em memória da loja config
async function guardarConfig(k, v) { config[k] = v; await Banco.put('config', v, k); }

// ---------------------------------------------------------------- estado
const livros = new Map();    // id -> registro (o que vai pro banco)
const fontes = new Map();    // id -> () => Promise<File>  (de onde ler o PDF nesta sessão; com .url no celular)
const normal = new Map();    // id -> texto normalizado pra busca (Kof: Busca.normaliza)
const temas = new K.Temas();
const pintor = new K.Pintor();
let filtro = 'todos', estante = '', limiteGrade = 240;

function toast(msg, ms = 2800) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms);
}
const idDe = (f) => f.name + '|' + f.size;
const EXT_LIVRO = /\.(pdf|cbz|cbr)$/i;   // PDF, mangá/HQ em zip (.cbz) e em RAR (.cbr)
function salvarLivro(l) { return Banco.put('livros', l); }
const salvarDepois = (() => { const fila = new Set(); let t = 0; return (l) => { fila.add(l); clearTimeout(t); t = setTimeout(() => { for (const x of fila) salvarLivro(x); fila.clear(); }, 600); }; })();

function registrar(file, caminho, estanteNome) {
  const id = idDe(file);
  let l = livros.get(id);
  if (!l) {
    l = {
      id, arquivo: file.name, tamanho: file.size, caminho: caminho || file.name, estante: estanteNome || '',
      titulo: K.Nome.titulo(file.name), autor: K.Nome.autor(file.name), ano: K.Nome.ano(file.name),
      paginas: 0, pagina: 1, adicionado: Date.now(), lido: 0, segundos: 0, paginasLidas: 0,
      favorito: false, terminado: false, notas: [], marcadores: [], noBanco: false,
    };
    marcarQuadrinho(l, caminho);
    livros.set(id, l);
    salvarLivro(l);
  } else if (ehQuadrinho(l) && l.serie === undefined) {
    marcarQuadrinho(l, caminho); salvarLivro(l);
  }
  if (estanteNome !== undefined && l.estante !== estanteNome && !l.noBanco) {
    l.estante = estanteNome; l.caminho = caminho; salvarLivro(l);
  }
  normal.delete(id);
  return l;
}

// ---------------------------------------------------------------- pastas
// A pasta escolhida/arrastada fica guardada (o "handle" do navegador) e é lida de novo
// a cada vez que abre. Navegador sem esse recurso (Firefox): lê a pasta só nesta sessão.
async function lerPasta(dir, prefixo = '', estanteNome = '', achados = []) {
  for await (const [nome, h] of dir.entries()) {
    if (h.kind === 'directory') {
      if (nome.startsWith('.')) continue;
      await lerPasta(h, prefixo + nome + '/', estanteNome || nome, achados);
    } else if (EXT_LIVRO.test(nome)) {
      try {
        const f = await h.getFile();
        const l = registrar(f, prefixo + nome, estanteNome);
        fontes.set(l.id, () => h.getFile());
        achados.push(l.id);
      } catch (e) { /* arquivo sumiu no meio */ }
    }
  }
  return achados;
}
async function adicionarPasta(dir) {
  const pastas = config.pastas || [];
  let ja = false;
  for (const p of pastas) if (await p.isSameEntry(dir)) ja = true;
  if (!ja) await guardarConfig('pastas', [...pastas, dir]);
  toast('📁 Lendo a pasta "' + dir.name + '"...');
  const n = (await lerPasta(dir)).length;
  toast(`📚 ${n} arquivo${n === 1 ? '' : 's'} em "${dir.name}"`);
  desenharBiblioteca();
  fazerCapas();
}
async function reabrirPastas(pedir) {
  const pastas = config.pastas || [];
  let falta = false;
  for (const p of pastas) {
    let ok = (await p.queryPermission({ mode: 'read' })) === 'granted';
    if (!ok && pedir) ok = (await p.requestPermission({ mode: 'read' })) === 'granted';
    if (ok) await lerPasta(p); else falta = true;
  }
  $('#avisoPasta').hidden = !falta;
  desenharBiblioteca();
  fazerCapas();
}
async function escolherPasta() {
  if (window.showDirectoryPicker) {
    try { await adicionarPasta(await showDirectoryPicker({ id: 'koflibrary', mode: 'read' })); }
    catch (e) { if (e.name !== 'AbortError') toast('Não deu pra abrir a pasta: ' + e.message); }
  } else {
    $('#arquivoPasta').click();
  }
}
// PDF solto (botão ➕ ou arrastado): vai inteiro pro banco do navegador, pra estar lá na próxima vez
async function adicionarArquivos(files) {
  let n = 0;
  for (const f of files) {
    if (!EXT_LIVRO.test(f.name) && f.type !== 'application/pdf') continue;
    const l = registrar(f, f.name, livros.get(idDe(f))?.estante);
    if (!fontes.has(l.id)) {
      try { await Banco.put('arquivos', f, l.id); l.noBanco = true; salvarLivro(l); } catch (e) { /* sem espaço: fica só na sessão */ }
      fontes.set(l.id, async () => (await Banco.get('arquivos', l.id)) || f);
    }
    n++;
  }
  if (n) toast(`📚 ${n} arquivo${n === 1 ? '' : 's'} adicionado${n === 1 ? '' : 's'}`);
  else toast('Nenhum PDF ou mangá ali.');
  desenharBiblioteca();
  fazerCapas();
  return n;
}
// pasta sem o handle guardável (Firefox, ou o <input webkitdirectory>): só nesta sessão
function adicionarSoNaSessao(lista) {
  let n = 0;
  for (const { file, caminho } of lista) {
    if (!EXT_LIVRO.test(file.name)) continue;
    // caminho = "<pasta escolhida>/<subpasta>/.../livro.pdf": a 1ª subpasta é a estante
    const partes = caminho.split('/');
    const l = registrar(file, caminho, partes.length > 2 ? partes[1] : '');
    fontes.set(l.id, async () => file);
    n++;
  }
  toast(`📚 ${n} arquivos nesta sessão (este navegador não guarda a pasta; no Chrome/Edge ele lembra)`, 5000);
  desenharBiblioteca();
  fazerCapas();
}
async function lerEntrada(entrada, caminho, lista) {
  if (entrada.isFile) {
    const file = await new Promise((ok, erro) => entrada.file(ok, erro));
    lista.push({ file, caminho: caminho + file.name });
  } else if (entrada.isDirectory) {
    const leitor = entrada.createReader();
    for (;;) {
      const lote = await new Promise((ok, erro) => leitor.readEntries(ok, erro));
      if (!lote.length) break;
      for (const e of lote) await lerEntrada(e, caminho + entrada.name + '/', lista);
    }
  }
}
async function soltou(dt) {
  const itens = [...dt.items].filter((i) => i.kind === 'file');
  // pega tudo ANTES do primeiro await: depois o navegador esvazia o dataTransfer
  const handles = itens.map((i) => (i.getAsFileSystemHandle ? i.getAsFileSystemHandle() : null));
  const entradas = itens.map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null));
  const soltos = [...dt.files];
  const arquivos = [], semHandle = [];
  for (let k = 0; k < itens.length; k++) {
    const h = handles[k] ? await handles[k].catch(() => null) : null;
    if (h && h.kind === 'directory') await adicionarPasta(h);
    else if (h && h.kind === 'file') arquivos.push(await h.getFile());
    else if (entradas[k] && entradas[k].isDirectory) await lerEntrada(entradas[k], '', semHandle);
    else if (soltos[k]) arquivos.push(soltos[k]);
  }
  if (semHandle.length) adicionarSoNaSessao(semHandle);
  if (arquivos.length) await adicionarArquivos(arquivos);
}

// ---------------------------------------------------------------- capas
const capas = new Map();   // id -> dataURL (o que já veio do banco)
let fazendoCapas = false;
async function fazerCapas() {
  if (fazendoCapas) return;
  fazendoCapas = true;
  try {
    const faltam = [...livros.values()].filter((l) => fontes.has(l.id) && (!l.temCapa || !l.paginas));
    for (const l of faltam) {
      try {
        const doc = await abrirDocumento(l);
        l.paginas = doc.numPages;
        try {
          const info = (await doc.getMetadata()).info || {};
          if (!l.autor && info.Author && info.Author.length < 80 && !/^(user|admin|microsoft|unknown)/i.test(info.Author)) l.autor = info.Author.trim();
        } catch (e) { /* sem metadados */ }
        const pag = await doc.getPage(1);
        const v1 = pag.getViewport({ scale: 1 });
        const v = pag.getViewport({ scale: 300 / v1.width });
        const c = document.createElement('canvas');
        c.width = Math.round(v.width); c.height = Math.round(v.height);
        await pag.render({ canvas: c, canvasContext: c.getContext('2d'), viewport: v }).promise;
        const url = c.toDataURL('image/jpeg', 0.82);
        await Banco.put('capas', url, l.id);
        capas.set(l.id, url);
        l.temCapa = true;
        await fecharPdf(doc);
      } catch (e) {
        l.temCapa = true; l.erro = String(e.message || e);
      }
      salvarLivro(l);
      atualizarCartao(l);
      if (ehQuadrinho(l) && !serieAberta && $('#leitor').hidden) { clearTimeout(fazerCapas.t); fazerCapas.t = setTimeout(desenharBiblioteca, 150); }
    }
  } finally { fazendoCapas = false; }
}
function corDoTitulo(t) {
  let h = 0; for (const ch of t) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(h) % 360} 38% 34%)`;
}
function capaEl(l) {
  const box = el('div', { class: 'capa' });
  const url = capas.get(l.id);
  if (url) box.append(el('img', { src: url, alt: '', loading: 'lazy' }));
  else {
    box.style.background = corDoTitulo(l.titulo);
    box.append(el('div', { class: 'sem' }, el('span', {}, l.titulo), el('small', {}, l.autor || '')));
    if (l.temCapa && !l.erro) Banco.get('capas', l.id).then((u) => { if (u) { capas.set(l.id, u); box.replaceChildren(el('img', { src: u, alt: '' })); } });
  }
  return box;
}

// ---------------------------------------------------------------- biblioteca (tela)
function pct(l) { return l.terminado ? 100 : K.Leitura.porcento(l.pagina, l.paginas); }
function situacao(l) {
  if (l.terminado || (l.paginas && l.pagina >= l.paginas)) return 'terminados';
  if (l.lido) return 'lendo';
  return 'naolidos';
}
function visiveis() {
  const q = K.Busca.normaliza($('#busca').value).trim();
  let lista = [...livros.values()];
  if (estante) lista = lista.filter((l) => l.estante === estante);
  if (filtro === 'favoritos') lista = lista.filter((l) => l.favorito);
  else if (filtro === 'quadrinhos') lista = lista.filter(ehQuadrinho);
  else if (filtro !== 'todos') lista = lista.filter((l) => situacao(l) === filtro);
  if (serieAberta) return lista.filter((l) => ehQuadrinho(l) && l.serie === serieAberta).sort(ordemCapitulos);
  if (q) {
    lista = lista.filter((l) => {
      let n = normal.get(l.id);
      if (n === undefined) { n = K.Busca.normaliza(l.titulo + ' ' + l.autor + ' ' + l.estante + ' ' + l.arquivo + ' ' + l.ano + ' ' + (l.serie || '')); normal.set(l.id, n); }
      return K.Busca.combina(n, q);
    });
  }
  const ordem = $('#ordem').value;
  const porTexto = (a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base', numeric: true });
  const f = {
    recentes: (a, b) => (b.lido - a.lido) || (b.adicionado - a.adicionado),
    titulo: (a, b) => porTexto(a.titulo, b.titulo),
    autor: (a, b) => porTexto(a.autor || '~', b.autor || '~') || porTexto(a.titulo, b.titulo),
    adicionados: (a, b) => b.adicionado - a.adicionado,
    progresso: (a, b) => pct(b) - pct(a),
  }[ordem];
  return agruparSeries(lista, !!q).sort(f);
}
function cartao(l) {
  if (l.grupo) return cartaoSerie(l);
  const p = pct(l);
  const fav = el('button', { class: 'fav' + (l.favorito ? ' sim' : ''), title: 'Favorito', onclick: (e) => { e.stopPropagation(); l.favorito = !l.favorito; l.editadoEm = Date.now(); salvarLivro(l); atualizarCartao(l); } }, l.favorito ? '⭐' : '☆');
  const ed = el('button', { title: 'Editar', onclick: (e) => { e.stopPropagation(); editar(l); } }, '✏️');
  const c = el('div', { class: 'livro' + (fontes.has(l.id) ? '' : ' fora'), 'data-id': l.id, title: l.caminho, onclick: () => abrirLivro(l) },
    capaEl(l),
    el('div', { class: 'acoes' }, ed, fav),
    l.terminado ? el('span', { class: 'selo' }, '✓ lido') : null,
    ehQuadrinho(l) ? el('span', { class: 'formato' }, tipoDe(l.arquivo).toUpperCase()) : null,
    el('div', { class: 'titulo' }, serieAberta ? rotuloCap(l) : nomeExibido(l)),
    el('div', { class: 'autor' }, [l.autor, l.ano].filter(Boolean).join(' · ') || ' '),
    el('div', { class: 'progresso' }, el('i', { style: `width:${p}%` })),
    el('div', { class: 'pct' }, el('span', {}, l.paginas ? (l.lido ? `pág. ${l.pagina} de ${l.paginas}` : `${l.paginas} páginas`) : ''), el('span', {}, l.lido ? p + '%' : '')));
  return c;
}
function atualizarCartao(l) {
  const velho = document.querySelector(`.livro[data-id="${CSS.escape(l.id)}"]`);
  if (velho) velho.replaceWith(cartao(l));
}
function desenharChips() {
  const todos = [...livros.values()];
  const conta = (f) => todos.filter(f).length;
  const chips = [
    ['todos', 'Todos', todos.length],
    ['lendo', '📖 Lendo', conta((l) => situacao(l) === 'lendo')],
    ['naolidos', 'Não lidos', conta((l) => situacao(l) === 'naolidos')],
    ['terminados', '✓ Terminados', conta((l) => situacao(l) === 'terminados')],
    ['favoritos', '⭐ Favoritos', conta((l) => l.favorito)],
    ['quadrinhos', '🗾 Mangás', conta(ehQuadrinho)],
  ];
  const box = $('#chips'); box.replaceChildren();
  if (serieAberta) {
    box.append(el('button', { class: 'chip', onclick: () => { serieAberta = ''; desenharBiblioteca(); } }, '← Voltar'),
      el('button', { class: 'chip ativo', onclick: () => { serieAberta = ''; desenharBiblioteca(); } }, '🗾 ' + serieAberta + ' ✕'));
    return;
  }
  for (const [k, nome, n] of chips) {
    if (k !== 'todos' && !n) continue;
    box.append(el('button', { class: 'chip' + (filtro === k && !(k === 'todos' && estante) ? ' ativo' : ''), onclick: () => { filtro = k; serieAberta = ''; if (k === 'todos') estante = ''; desenharBiblioteca(); } }, nome, el('span', { class: 'n' }, String(n))));
  }
  const estantes = [...new Set(todos.map((l) => l.estante).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  for (const e of estantes) {
    box.append(el('button', { class: 'chip' + (estante === e ? ' ativo' : ''), title: 'Estante (subpasta)', onclick: () => { estante = estante === e ? '' : e; desenharBiblioteca(); } }, '🗂️ ' + e));
  }
}
function desenharContinuar() {
  const lendo = [...livros.values()].filter((l) => l.lido && situacao(l) !== 'terminados').sort((a, b) => b.lido - a.lido);
  const box = $('#continuar');
  box.hidden = !lendo.length || !!$('#busca').value;
  if (box.hidden) return;
  const l = lendo[0];
  const resto = el('div', { class: 'cont-mini' });
  for (const o of lendo.slice(1, 7)) { const c = capaEl(o); c.title = o.titulo; c.onclick = () => abrirLivro(o); resto.append(c); }
  box.replaceChildren(
    el('div', { class: 'cont-grande', onclick: () => abrirLivro(l) },
      capaEl(l),
      el('div', {},
        el('div', { class: 'rotulo' }, 'Continuar lendo'),
        el('h2', {}, nomeExibido(l)),
        el('div', { class: 'autor' }, l.autor || ''),
        el('div', { class: 'pct' }, `página ${l.pagina} de ${l.paginas || '?'} · ${pct(l)}% · ${K.Leitura.tempo(l.segundos)} lidos`),
        el('div', { class: 'progresso' }, el('i', { style: `width:${pct(l)}%` })),
        el('div', { class: 'pct' }, l.paginas ? K.Leitura.faltam(l.pagina, l.paginas, l.segundos, l.paginasLidas) : ''),
        el('button', { class: 'principal ler' }, '📖 Continuar'))),
    resto);
}
let observaMais = null;
function desenharBiblioteca() {
  desenharChips();
  desenharContinuar();
  const lista = visiveis();
  $('#vazio').hidden = livros.size > 0;
  const g = $('#grade'); g.replaceChildren();
  for (const l of lista.slice(0, limiteGrade)) g.append(cartao(l));
  if (livros.size && !lista.length) g.append(el('p', { class: 'nada' }, 'Nenhum livro com essa busca.'));
  if (!observaMais) {
    observaMais = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting) && visiveis().length > limiteGrade) { limiteGrade += 240; desenharBiblioteca(); }
    }, { rootMargin: '600px' });
    observaMais.observe($('#maisGrade'));
  }
}
function editar(l) {
  const d = $('#dlgEditar');
  $('#edTitulo').value = l.titulo; $('#edAutor').value = l.autor; $('#edTerminado').checked = !!l.terminado;
  d.onclose = async () => {
    if (d.returnValue === 'ok') {
      l.titulo = $('#edTitulo').value.trim() || l.titulo; l.autor = $('#edAutor').value.trim(); l.terminado = $('#edTerminado').checked; l.editadoEm = Date.now();
      normal.delete(l.id); await salvarLivro(l);
    } else if (d.returnValue === 'remover') {
      if (!confirm(`Tirar "${l.titulo}" da biblioteca? O arquivo no seu computador não é apagado.` + (l.notas.length ? ' As anotações deste livro vão junto.' : ''))) return;
      livros.delete(l.id); fontes.delete(l.id);
      await Banco.del('livros', l.id); await Banco.del('capas', l.id); await Banco.del('arquivos', l.id);
    }
    desenharBiblioteca();
  };
  d.returnValue = ''; d.showModal();
}

// ---------------------------------------------------------------- temas do app
const TEMAS_APP = {
  cafe: { nome: '☕ Café', v: {} },
  claro: { nome: '🥛 Café claro', v: { fundo: '#f4ece2', painel: '#e8dccd', cartao: '#fbf6ef', borda: '#d3c0aa', texto: '#2b1d14', suave: '#7a604a', destaque: '#a0612f', destaque2: '#7a4a24', 'leitura-fundo': '#d9cbb9', sombra: 'rgba(60,35,15,.25)' }, claro: true },
  noite: { nome: '🌙 Noite', v: { fundo: '#101114', painel: '#1b1d22', cartao: '#23262c', borda: '#34373f', texto: '#e6e6e6', suave: '#9a9ea8', destaque: '#7aa2f7', destaque2: '#a9c1ff', 'leitura-fundo': '#16181c' } },
  floresta: { nome: '🌿 Floresta', v: { fundo: '#0f1a14', painel: '#16261d', cartao: '#1d3126', borda: '#2b4536', texto: '#e3efe6', suave: '#9bb5a3', destaque: '#6fbf73', destaque2: '#a8dfab', 'leitura-fundo': '#13211a' } },
  papel: { nome: '📜 Papel', v: { fundo: '#fbfaf7', painel: '#f0eee8', cartao: '#ffffff', borda: '#dedbd2', texto: '#222222', suave: '#6b6b6b', destaque: '#3a6ea5', destaque2: '#2b5585', 'leitura-fundo': '#e7e5df', sombra: 'rgba(0,0,0,.18)' }, claro: true },
  vinho: { nome: '🍷 Vinho', v: { fundo: '#1a0d10', painel: '#2a141a', cartao: '#351a21', borda: '#4d2630', texto: '#f3e4e7', suave: '#c09aa3', destaque: '#d0697f', destaque2: '#efa5b5', 'leitura-fundo': '#200f14' } },
};
function aplicarTemaApp(id) {
  const t = TEMAS_APP[id] || TEMAS_APP.cafe;
  const r = document.documentElement.style;
  for (const k of ['fundo', 'painel', 'cartao', 'borda', 'texto', 'suave', 'destaque', 'destaque2', 'leitura-fundo', 'sombra']) r.removeProperty('--' + k);
  for (const [k, v] of Object.entries(t.v)) r.setProperty('--' + k, v);
  r.colorScheme = t.claro ? 'light' : 'dark';
}
function desenharAjustes() {
  const box = $('#listaApp'); box.replaceChildren();
  for (const [id, t] of Object.entries(TEMAS_APP)) {
    box.append(el('button', { class: (config.temaApp || 'cafe') === id ? 'ativo' : '', onclick: async () => { await guardarConfig('temaApp', id); aplicarTemaApp(id); desenharAjustes(); } }, t.nome));
  }
}

// ---------------------------------------------------------------- leitor
const L = {
  livro: null, doc: null, paginas: [], tamanhos: [], zoom: 'largura', escala: 1, atual: 1,
  desenhadas: new Map(), fila: new Set(), ativo: 0, observa: null, ultimaAcao: 0, maxVista: 0,
};
function ajustesDoLivro() {
  const g = config.leitura || {};
  const p = L.livro && L.livro.leitura;
  return Object.assign({ tema: 'sepia', brilho: 0, contraste: 100, quente: 0, cores: true }, g, p || {});
}
function prepararPintor() {
  const a = ajustesDoLivro();
  const i = temas.indice(a.tema);
  L.tema = a.tema === 'original' && !a.brilho && a.contraste === 100 && !a.quente ? null : i;
  pintor.preparar(temas.papel(i), temas.tinta(i), a.brilho, a.contraste, a.quente, a.cores);
  // o fundo em volta das páginas acompanha o papel, um tom mais escuro (ou mais claro, no escuro)
  const papel = temas.papel(i);
  const fundo = temas.escuro(i) ? K.Cor.mistura(papel, 0x000000, 90) : K.Cor.mistura(papel, 0x000000, 60);
  $('#leitor').style.setProperty('--leitura-fundo', a.tema === 'original' ? '' : K.Cor.hex(fundo));
  $('#paginas').style.setProperty('--papel', K.Cor.hex(papel));
}
async function abrirLivro(l) {
  if (!fontes.has(l.id)) {
    toast(l.noBanco ? 'Esse PDF não está mais no navegador.' : `"${l.arquivo}" não está na pasta agora. Escolha a pasta de novo (📁) pra ler.`, 4500);
    return;
  }
  fecharLivro(false);
  L.livro = l;
  $('#biblioteca').hidden = true; $('#leitor').hidden = false;
  if (APK) APK.leitor(true);
  $('#lTitulo').textContent = nomeExibido(l) + (l.autor ? ' — ' + l.autor : '');
  $('#fimCap').hidden = true;
  $('#secManga').hidden = !ehQuadrinho(l);
  document.title = l.titulo + ' · KOFlibrary';
  const box = $('#paginas'); box.replaceChildren(el('p', { class: 'nada', style: 'text-align:center' }, 'Abrindo...'));
  prepararPintor();
  const ativo = ++L.ativo;
  let doc;
  try {
    doc = await abrirDocumento(l);
  } catch (e) {
    box.replaceChildren(el('p', { class: 'nada', style: 'text-align:center' }, 'Não deu pra abrir esse arquivo: ' + (e.message || e)));
    return;
  }
  if (ativo !== L.ativo) { fecharPdf(doc); return; }
  L.doc = doc;
  l.paginas = doc.numPages;
  const p1 = (await doc.getPage(1)).getViewport({ scale: 1 });
  L.tamanhos = Array.from({ length: doc.numPages }, () => [p1.width, p1.height]);
  L.zoom = l.zoom || 'largura';
  L.maxVista = l.pagina;
  L.modo = doc.quadrinho ? modoManga() : null;
  if (paginado()) montarPaginado(); else montarPaginas();
  irPara(Math.min(Math.max(1, l.pagina || 1), doc.numPages), false);
  l.lido = Date.now(); salvarLivro(l);
  marcarBotoes();
  $('#paginas').focus();
}
const CELULAR = () => !!APK || innerWidth < 700;
function escalaDe(w) {
  const box = $('#paginas');
  if (L.zoom === 'largura') return (CELULAR() ? box.clientWidth - 8 : Math.min(box.clientWidth - 110, 960)) / w;
  return L.zoom;
}
function montarPaginas() {
  const box = $('#paginas');
  for (const c of L.desenhadas.values()) c.width = 0;
  L.desenhadas.clear(); L.fila.clear();
  if (L.observa) L.observa.disconnect();
  box.replaceChildren();
  box.classList.remove('paginado');
  box.classList.toggle('webtoon', !!(L.doc && L.doc.quadrinho));
  L.paginas = [];
  L.escala = escalaDe(L.tamanhos[0][0]);
  $('#btZoom').textContent = L.zoom === 'largura' ? '↔ ' + Math.round(L.escala * 100) + '%' : Math.round(L.escala * 100) + '%';
  L.observa = new IntersectionObserver((es) => {
    for (const e of es) {
      const n = +e.target.dataset.n;
      if (e.isIntersecting) desenhar(n); else apagar(n);
    }
  }, { root: box, rootMargin: CELULAR() ? '60% 0px' : '120% 0px' });
  for (let n = 1; n <= L.doc.numPages; n++) {
    const [w, h] = L.tamanhos[n - 1];
    const d = el('div', { class: 'pagina', 'data-n': n, style: `width:${Math.round(w * L.escala)}px;height:${Math.round(h * L.escala)}px;background:var(--papel,#fff)` }, el('span', { class: 'num' }, String(n)));
    box.append(d); L.paginas.push(d); L.observa.observe(d);
  }
  marcarPaginas();
}
async function desenhar(n) {
  if (L.desenhadas.has(n) || L.fila.has(n) || !L.doc) return;
  L.fila.add(n);
  const doc = L.doc, escala = L.escala;
  try {
    const pag = await doc.getPage(n);
    if (doc !== L.doc) return;
    const v1 = pag.getViewport({ scale: 1 });
    const d = L.paginas[n - 1];
    if (Math.abs(v1.width - L.tamanhos[n - 1][0]) > 1 || Math.abs(v1.height - L.tamanhos[n - 1][1]) > 1) {
      L.tamanhos[n - 1] = [v1.width, v1.height];
      d.style.width = Math.round(v1.width * escala) + 'px'; d.style.height = Math.round(v1.height * escala) + 'px';
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const v = pag.getViewport({ scale: escala * dpr });
    const c = document.createElement('canvas');
    c.width = Math.floor(v.width); c.height = Math.floor(v.height);
    const ctx = c.getContext('2d', { willReadFrequently: L.tema !== null });
    await pag.render({ canvas: c, canvasContext: ctx, viewport: v }).promise;
    if (doc !== L.doc || escala !== L.escala || !L.fila.has(n)) { c.width = 0; return; }
    pintar(c, ctx);
    const velho = d.querySelector('canvas');
    if (velho) { velho.width = 0; velho.remove(); }
    d.prepend(c);
    L.desenhadas.set(n, c);
  } catch (e) {
    if (!/destroyed|cancel/i.test(String(e))) console.warn('página', n, e);
  } finally { L.fila.delete(n); }
}
// o tema de leitura: o Pintor (Kof) repinta os pontos do canvas
function pintar(c, ctx) {
  if (L.tema === null) return;
  const img = ctx.getImageData(0, 0, c.width, c.height);
  pintor.pintar(img.data, img.data.length);
  ctx.putImageData(img, 0, 0);
}
function apagar(n) {
  L.fila.delete(n);
  const c = L.desenhadas.get(n);
  if (c) { c.width = 0; c.remove(); L.desenhadas.delete(n); }
}
function redesenhar() {
  if (paginado()) { mostrar(L.mostradas ? L.mostradas[0] : L.atual); return; }
  for (const n of [...L.desenhadas.keys()]) { apagar(n); }
  const box = $('#paginas');
  for (const d of L.paginas) {
    const r = d.offsetTop - box.scrollTop;
    if (r < box.clientHeight * 2.2 && r + d.offsetHeight > -box.clientHeight * 1.2) desenhar(+d.dataset.n);
  }
}
function paginaNaTela() {
  const box = $('#paginas');
  const meio = box.scrollTop + box.clientHeight * 0.35;
  let a = 0, b = L.paginas.length - 1;
  while (a < b) { const m = (a + b + 1) >> 1; if (L.paginas[m].offsetTop <= meio) a = m; else b = m - 1; }
  return a + 1;
}
function irPara(n, suave = true) {
  if (!L.doc) return;
  if (paginado()) { mostrar(n); return; }
  n = Math.max(1, Math.min(L.doc.numPages, n));
  const d = L.paginas[n - 1];
  $('#paginas').scrollTo({ top: d.offsetTop - 12, behavior: suave ? 'smooth' : 'instant' });
  mudouPagina(n);
}
function mudouPagina(n) {
  const l = L.livro;
  if (!l) return;
  if (n !== L.atual) {
    L.atual = n;
    if (n > L.maxVista) { contar(l, 'paginasPor', 'paginasLidas', n - L.maxVista); L.maxVista = n; }
  }
  $('#lPagina').value = n; $('#lTotal').textContent = '/ ' + L.doc.numPages;
  if (l.pagina !== n) { l.pagina = n; l.lido = Date.now(); if (n >= L.doc.numPages) l.terminado = true; salvarDepois(l); }
  $('#lInfo').textContent = `${K.Leitura.porcento(n, L.doc.numPages)}% · ${K.Leitura.faltam(n, L.doc.numPages, l.segundos, l.paginasLidas)}`;
  $('#notaPag').textContent = n;
  marcarBotoes();
}
function zoom(z) {
  if (!L.doc) return;
  if (paginado()) { L.zoomPag = z === 'largura' ? 1 : Math.max(1, Math.min(4, z / (L.escalaBase || 1))); mostrar(L.atual); return; }
  const n = L.atual, box = $('#paginas');
  const dentro = (box.scrollTop - L.paginas[n - 1].offsetTop) / L.paginas[n - 1].offsetHeight;
  L.zoom = z === 'largura' ? 'largura' : Math.max(0.3, Math.min(5, z));
  L.livro.zoom = L.zoom; salvarDepois(L.livro);
  montarPaginas();
  box.scrollTop = L.paginas[n - 1].offsetTop + dentro * L.paginas[n - 1].offsetHeight;
  mudouPagina(n);
}
function fecharLivro(voltar = true) {
  L.ativo++;
  if (L.livro) salvarLivro(L.livro);
  if (L.observa) L.observa.disconnect();
  for (const c of L.desenhadas.values()) c.width = 0;
  L.desenhadas.clear(); L.fila.clear();
  if (L.doc) fecharPdf(L.doc);
  $('#paginas').classList.remove('paginado', 'webtoon');
  L.modo = null; L.mostradas = null;
  L.doc = null; L.livro = null; L.paginas = [];
  $('#painelTemas').hidden = true; $('#painelNotas').hidden = true;
  if (voltar) {
    $('#leitor').hidden = true; $('#biblioteca').hidden = false;
    if (APK) APK.leitor(false);
    $('#leitor').classList.remove('limpo');
    document.title = 'KOFlibrary';
    if (document.fullscreenElement) document.exitFullscreen();
    desenharBiblioteca();
    if (!APK && enderecoCelular()) setTimeout(() => sincronizarCelular(true), 500);
  }
}

// ---------------------------------------------------------------- painel de temas
function ajustar(mudanca) {
  const soEste = $('#ajSoEste').checked;
  const a = Object.assign(ajustesDoLivro(), mudanca);
  if (soEste) { L.livro.leitura = a; L.livro.editadoEm = Date.now(); salvarLivro(L.livro); }
  else { if (L.livro && L.livro.leitura) { delete L.livro.leitura; L.livro.editadoEm = Date.now(); salvarLivro(L.livro); } guardarConfig('leitura', a); }
  prepararPintor();
  desenharPainelTemas();
  clearTimeout(ajustar.t); ajustar.t = setTimeout(redesenhar, 90);
}
function desenharPainelTemas() {
  const a = ajustesDoLivro();
  const box = $('#listaTemas'); box.replaceChildren();
  let grupo = null, grade = null;
  for (let i = 0; i < temas.quantos(); i++) {
    if (temas.grupo(i) !== grupo) {
      grupo = temas.grupo(i);
      box.append(el('div', { class: 'grupo-temas' }, grupo));
      grade = el('div', { class: 'temas' }); box.append(grade);
    }
    const id = temas.id(i);
    grade.append(el('button', {
      class: 'tema' + (a.tema === id ? ' ativo' : ''), title: temas.nome(i),
      style: `background:${K.Cor.hex(temas.papel(i))};color:${K.Cor.hex(temas.tinta(i))}`,
      onclick: () => ajustar({ tema: id }),
    }, el('b', {}, 'Aa'), temas.nome(i)));
  }
  $('#ajBrilho').value = a.brilho; $('#ajContraste').value = a.contraste; $('#ajQuente').value = a.quente; $('#ajCores').checked = a.cores;
  $('#ajSoEste').checked = !!(L.livro && L.livro.leitura);
  const m = modoManga();
  for (const b of document.querySelectorAll('#direcoes button')) b.classList.toggle('ativo', b.dataset.d === m.direcao);
  $('#mgDupla').checked = m.dupla; $('#mgCortar').checked = m.cortar;
}
function alternarPainel(qual) {
  const t = $('#painelTemas'), n = $('#painelNotas');
  if (qual === 'temas') { t.hidden = !t.hidden; n.hidden = true; if (!t.hidden) desenharPainelTemas(); }
  else { n.hidden = !n.hidden; t.hidden = true; if (!n.hidden) desenharNotas(); }
  $('#btTemas').classList.toggle('ligado', !t.hidden);
  $('#btNotas').classList.toggle('ligado', !n.hidden);
}

// ---------------------------------------------------------------- marcadores e notas
function quando(ts) { return new Date(ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); }
function alternarMarcador() {
  const l = L.livro; if (!l) return;
  const n = L.atual;
  const i = l.marcadores.indexOf(n);
  if (i >= 0) { l.marcadores.splice(i, 1); toast('🔖 Marcador tirado da página ' + n); }
  else { l.marcadores.push(n); l.marcadores.sort((a, b) => a - b); toast('🔖 Página ' + n + ' marcada'); }
  l.marcadoresEm = Date.now();
  salvarLivro(l); marcarPaginas(); marcarBotoes();
  if (!$('#painelNotas').hidden) desenharNotas();
}
function marcarBotoes() {
  const l = L.livro; if (!l) return;
  $('#btMarcador').classList.toggle('ligado', l.marcadores.includes(L.atual));
}
function marcarPaginas() {
  const l = L.livro; if (!l) return;
  for (const d of L.paginas) d.querySelectorAll('.fita,.temnota').forEach((x) => x.remove());
  for (const m of l.marcadores) L.paginas[m - 1]?.append(el('span', { class: 'fita', title: 'Marcador' }, '🔖'));
  for (const p of new Set(l.notas.map((x) => x.pagina))) {
    L.paginas[p - 1]?.append(el('span', { class: 'temnota', title: 'Tem nota nesta página', onclick: () => { if ($('#painelNotas').hidden) alternarPainel('notas'); } }, '📝'));
  }
}
function salvarNota() {
  const l = L.livro, txt = $('#txtNota').value.trim();
  if (!l || !txt) return;
  l.notas.push({ id: Date.now().toString(36), pagina: L.atual, texto: txt, data: Date.now() });
  l.notas.sort((a, b) => a.pagina - b.pagina || a.data - b.data);
  $('#txtNota').value = '';
  salvarLivro(l); desenharNotas(); marcarPaginas();
  toast('📝 Nota salva na página ' + L.atual);
}
function desenharNotas() {
  const l = L.livro; if (!l) return;
  $('#notaPag').textContent = L.atual;
  const lm = $('#listaMarcadores'); lm.replaceChildren();
  if (!l.marcadores.length) lm.append(el('div', { class: 'nada' }, 'Nenhum. Aperte 🔖 (ou B) pra marcar a página.'));
  for (const m of l.marcadores) {
    lm.append(el('div', { class: 'item', onclick: () => irPara(m) }, el('span', { class: 'pg' }, 'pág. ' + m),
      el('button', { class: 'x', title: 'Tirar', onclick: (e) => { e.stopPropagation(); l.marcadores = l.marcadores.filter((x) => x !== m); l.marcadoresEm = Date.now(); salvarLivro(l); desenharNotas(); marcarPaginas(); marcarBotoes(); } }, '✕')));
  }
  const ln = $('#listaNotas'); ln.replaceChildren();
  if (!l.notas.length) ln.append(el('div', { class: 'nada' }, 'Nenhuma nota ainda.'));
  for (const nt of l.notas) {
    ln.append(el('div', { class: 'item', onclick: () => irPara(nt.pagina) }, el('span', { class: 'pg' }, 'pág. ' + nt.pagina), nt.texto,
      el('span', { class: 'data' }, quando(nt.data)),
      el('button', { class: 'x', title: 'Apagar nota', onclick: (e) => { e.stopPropagation(); if (!confirm('Apagar esta nota?')) return; l.notas = l.notas.filter((x) => x !== nt); (l.notasApagadas = l.notasApagadas || []).push(nt.id); salvarLivro(l); desenharNotas(); marcarPaginas(); } }, '✕')));
  }
}
function exportarNotas() {
  const l = L.livro; if (!l) return;
  let md = `# ${l.titulo}\n\n`;
  if (l.autor) md += `*${l.autor}*\n\n`;
  md += `Anotações do KOFlibrary, ${quando(Date.now())}.\n\n`;
  if (l.marcadores.length) md += `## 🔖 Marcadores\n\n` + l.marcadores.map((m) => `- Página ${m}`).join('\n') + '\n\n';
  if (l.notas.length) md += `## 📝 Notas\n\n` + l.notas.map((n) => `### Página ${n.pagina}\n\n${n.texto}\n`).join('\n');
  if (APK) { APK.salvar(`${l.titulo} - anotações.md`, 'text/markdown', md); return; }
  const a = el('a', { href: URL.createObjectURL(new Blob([md], { type: 'text/markdown' })), download: `${l.titulo} - anotações.md` });
  document.body.append(a); a.click(); a.remove();
}

// ---------------------------------------------------------------- tempo de leitura
// cada aparelho conta a sua parte (l.segundosPor[aparelho]); o total é a soma, então a sincronia não perde nada
function contar(l, porAparelho, total, n) {
  const m = l[porAparelho] || (l[porAparelho] = {});
  m[config.aparelho] = (m[config.aparelho] || 0) + n;
  l[total] = Object.values(m).reduce((a, b) => a + b, 0);
}
// conta 1 s quando o leitor está aberto, a janela visível e você mexeu nos últimos 2 min
setInterval(() => {
  const l = L.livro;
  if (!l || document.hidden || Date.now() - L.ultimaAcao > 120000) return;
  contar(l, 'segundosPor', 'segundos', 1);
  if (l.segundos % 15 === 0) salvarDepois(l);
}, 1000);
for (const ev of ['keydown', 'wheel', 'pointerdown', 'pointermove', 'touchstart']) addEventListener(ev, () => (L.ultimaAcao = Date.now()), { passive: true });

// ---------------------------------------------------------------- eventos
function ligarEventos() {
  $('#btPasta').onclick = APK ? () => APK.pastaEscolher() : escolherPasta;
  $('#btPasta2').onclick = $('#btPasta').onclick;
  $('#btPdf').onclick = APK ? () => APK.adicionarPdf() : () => $('#arquivoPdf').click();
  $('#btCelular').onclick = abrirSincronia;
  $('#btSincronizar').onclick = async () => { await guardarCelular(); sincronizarCelular(false); };
  ligarToque();
  $('#arquivoPdf').onchange = (e) => { adicionarArquivos([...e.target.files]); e.target.value = ''; };
  $('#arquivoPasta').onchange = (e) => { adicionarSoNaSessao([...e.target.files].map((f) => ({ file: f, caminho: f.webkitRelativePath }))); e.target.value = ''; };
  $('#btReabrir').onclick = () => reabrirPastas(true);
  $('#btAjustes').onclick = () => { desenharAjustes(); $('#dlgAjustes').showModal(); };
  $('#busca').oninput = () => { limiteGrade = 240; desenharBiblioteca(); };
  $('#ordem').onchange = async () => { await guardarConfig('ordem', $('#ordem').value); desenharBiblioteca(); };

  let fundo = 0;
  addEventListener('dragenter', (e) => { if (e.dataTransfer.types.includes('Files')) { fundo++; $('#soltarAqui').hidden = false; } });
  addEventListener('dragleave', () => { if (--fundo <= 0) { fundo = 0; $('#soltarAqui').hidden = true; } });
  addEventListener('dragover', (e) => e.preventDefault());
  addEventListener('drop', (e) => {
    e.preventDefault(); fundo = 0; $('#soltarAqui').hidden = true;
    if (!$('#leitor').hidden) fecharLivro();
    soltou(e.dataTransfer);
  });

  $('#btVoltar').onclick = () => fecharLivro();
  $('#btAnt').onclick = () => passo(-1);
  $('#btProx').onclick = () => passo(1);
  $('#btFimProx').onclick = () => { const p = proximoCapitulo(L.livro); if (p) abrirLivro(p); };
  $('#btFimVoltar').onclick = () => fecharLivro();
  for (const b of document.querySelectorAll('#direcoes button')) b.onclick = () => mudarManga({ direcao: b.dataset.d });
  $('#mgDupla').onchange = (e) => mudarManga({ dupla: e.target.checked });
  $('#mgCortar').onchange = (e) => mudarManga({ cortar: e.target.checked });
  $('#lPagina').onchange = () => { const n = parseInt($('#lPagina').value, 10); if (n) irPara(n); $('#paginas').focus(); };
  $('#btMenos').onclick = () => zoom(L.escala / 1.15);
  $('#btMais').onclick = () => zoom(L.escala * 1.15);
  $('#btZoom').onclick = () => zoom('largura');
  $('#btTemas').onclick = () => alternarPainel('temas');
  $('#btNotas').onclick = () => alternarPainel('notas');
  $('#btMarcador').onclick = alternarMarcador;
  $('#btCheia').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : $('#leitor').requestFullscreen());
  $('#btSalvarNota').onclick = salvarNota;
  $('#btExportar').onclick = exportarNotas;
  $('#txtNota').onkeydown = (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) salvarNota(); };
  $('#ajBrilho').oninput = (e) => ajustar({ brilho: +e.target.value });
  $('#ajContraste').oninput = (e) => ajustar({ contraste: +e.target.value });
  $('#ajQuente').oninput = (e) => ajustar({ quente: +e.target.value });
  $('#ajCores').onchange = (e) => ajustar({ cores: e.target.checked });
  $('#ajSoEste').onchange = () => ajustar({});
  $('#ajZerar').onclick = () => ajustar({ brilho: 0, contraste: 100, quente: 0, cores: true });

  $('#paginas').addEventListener('scroll', () => {
    if (!L.doc || paginado()) return;
    const n = paginaNaTela();
    if (n !== L.atual || +$('#lPagina').value !== n) mudouPagina(n);
  }, { passive: true });
  $('#paginas').addEventListener('wheel', (e) => {
    if (!e.ctrlKey || !L.doc) return;
    e.preventDefault();
    zoom(L.escala * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
  }, { passive: false });
  let largura = innerWidth;
  addEventListener('resize', () => {
    if (paginado()) { clearTimeout(zoom.t); zoom.t = setTimeout(() => mostrar(L.atual), 150); return; }
    if (L.doc && L.zoom === 'largura' && Math.abs(innerWidth - largura) > 30) { largura = innerWidth; clearTimeout(zoom.t); zoom.t = setTimeout(() => zoom('largura'), 150); }
  });

  addEventListener('keydown', (e) => {
    // caixinha e régua do painel não seguram as teclas (só campo de texto e lista)
    if (e.target.matches('input:not([type=checkbox]):not([type=range]), textarea, select') || document.querySelector('dialog[open]')) return;
    if ($('#leitor').hidden) {
      if (e.key === '/' || (e.ctrlKey && e.key === 'f')) { e.preventDefault(); $('#busca').focus(); }
      return;
    }
    const k = e.key;
    const avancar = { ArrowRight: 1, PageDown: 1, ' ': 1, ArrowLeft: -1, PageUp: -1 }[k];
    if (avancar && !(k === ' ' && e.shiftKey)) {
      e.preventDefault();
      // seta pros lados = página inteira; PageDown/espaço também
      // mangá direita->esquerda: a seta pra esquerda avança (como virar a página do livro japonês)
      passo(k.startsWith('Arrow') ? avancar * sentido() : avancar);
    } else if (k === ' ' && e.shiftKey) { e.preventDefault(); passo(-1); }
    else if (k === 'Home') { e.preventDefault(); irPara(1, false); }
    else if (k === 'End') { e.preventDefault(); irPara(L.doc.numPages, false); }
    else if (k === '+' || k === '=') zoom(L.escala * 1.15);
    else if (k === '-') zoom(L.escala / 1.15);
    else if (k === '0') zoom('largura');
    else if (k === 't' || k === 'T') alternarPainel('temas');
    else if (k === 'n' || k === 'N') { alternarPainel('notas'); if (!$('#painelNotas').hidden) setTimeout(() => $('#txtNota').focus(), 0); e.preventDefault(); }
    else if (k === 'b' || k === 'B') alternarMarcador();
    else if (k === 'f' || k === 'F') $('#btCheia').click();
    else if (k === 'Escape') {
      if (!$('#fimCap').hidden) $('#fimCap').hidden = true;
      else if (!$('#painelTemas').hidden || !$('#painelNotas').hidden) { fecharPaineis(); $('#paginas').focus(); }
      else if (!document.fullscreenElement) fecharLivro();
    }
  });
  addEventListener('beforeunload', () => { if (L.livro) salvarLivro(L.livro); });
}

// ---------------------------------------------------------------- mangá e HQ (.cbz, .cbr)
// .cbz é um zip de imagens: o índice e o lugar de cada página vêm do núcleo em Kof (Zip/Indice), e a página lê só os
// bytes da imagem que vai mostrar (no celular por Range). .cbr é RAR: o unrar em WebAssembly (web/vendor/unrar) abre.
// O "documento" de imagens tem a mesma cara do documento do pdf.js (numPages, getPage, render), então o leitor de
// rolagem (webtoon) é o mesmo do PDF; o paginado (mangá, uma ou duas páginas por vez) está aqui embaixo.
const IMAGEM = /\.(jpe?g|png|webp|gif|avif|bmp)$/i;
const tipoDe = (nome) => (/\.cbz$/i.test(nome) ? 'cbz' : /\.cbr$/i.test(nome) ? 'cbr' : 'pdf');
const ehQuadrinho = (l) => !l.grupo && tipoDe(l.arquivo) !== 'pdf';
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp' };
const mimeDe = (n) => MIME[n.split('.').pop().toLowerCase()] || 'application/octet-stream';
const ordemNatural = (a, b) => { const x = K.Capitulo.chave(a), y = K.Capitulo.chave(b); return x < y ? -1 : x > y ? 1 : 0; };

// série, volume e capítulo (Kof: Capitulo). Arquivo sem nome de série ("Cap 25.cbz") fica com a da pasta.
function marcarQuadrinho(l, caminho) {
  if (!ehQuadrinho(l)) return l;
  let serie = K.Capitulo.serie(l.arquivo);
  const pastas = (caminho || '').split('/').slice(0, -1);
  if ((!serie || /^(cap|capitulo|chapter|ch|vol|volume|v|c|\d+)$/i.test(K.Busca.normaliza(serie).trim())) && pastas.length) serie = pastas[pastas.length - 1];
  l.serie = serie; l.cap = K.Capitulo.capitulo(l.arquivo); l.vol = K.Capitulo.volume(l.arquivo);
  if (l.autor && K.Busca.normaliza(l.autor).trim() === K.Busca.normaliza(serie).trim()) l.autor = '';
  return l;
}
const numCap = (v) => String(v / 1000).replace('.', ',');
function rotuloCap(l) {
  const r = [];
  if (l.vol >= 0) r.push('Vol. ' + numCap(l.vol));
  if (l.cap >= 0) r.push('Cap. ' + numCap(l.cap));
  return r.length ? r.join(' · ') : l.titulo;
}
const nomeExibido = (l) => (ehQuadrinho(l) && l.serie ? `${l.serie} · ${rotuloCap(l)}` : l.titulo);
function ordemCapitulos(a, b) {
  const va = a.vol >= 0 ? a.vol : -1, vb = b.vol >= 0 ? b.vol : -1;
  if (va !== vb && va >= 0 && vb >= 0) return va - vb;
  if (a.cap >= 0 && b.cap >= 0 && a.cap !== b.cap) return a.cap - b.cap;
  if (va !== vb) return va - vb;
  return ordemNatural(a.arquivo, b.arquivo);
}
function proximoCapitulo(l) {
  if (!l || !ehQuadrinho(l)) return null;
  const caps = [...livros.values()].filter((x) => ehQuadrinho(x) && x.serie === l.serie).sort(ordemCapitulos);
  return caps[caps.indexOf(l) + 1] || null;
}

// biblioteca: a série com mais de um capítulo vira um cartão só (a não ser na busca, que mostra os capítulos)
let serieAberta = '';
function agruparSeries(lista, buscando) {
  if (buscando || serieAberta) return lista;
  const series = new Map(), fora = [];
  for (const l of lista) {
    if (!ehQuadrinho(l)) { fora.push(l); continue; }
    if (!series.has(l.serie)) series.set(l.serie, []);
    series.get(l.serie).push(l);
  }
  for (const [serie, caps] of series) {
    if (caps.length === 1) { fora.push(caps[0]); continue; }
    caps.sort(ordemCapitulos);
    const lidos = caps.filter((c) => situacao(c) === 'terminados').length;
    fora.push({
      grupo: true, id: 'serie:' + serie, serie, titulo: serie, autor: caps.find((c) => c.autor)?.autor || '', itens: caps,
      lido: Math.max(...caps.map((c) => c.lido || 0)), adicionado: Math.max(...caps.map((c) => c.adicionado || 0)),
      lidos, paginas: caps.length, pagina: lidos, terminado: lidos === caps.length, favorito: caps.some((c) => c.favorito),
    });
  }
  return fora;
}
function cartaoSerie(g) {
  const atual = g.itens.filter((c) => c.lido && situacao(c) !== 'terminados').sort((a, b) => b.lido - a.lido)[0];
  const p = Math.round((g.lidos / g.itens.length) * 100);
  return el('div', { class: 'livro serie', 'data-id': g.id, title: g.serie, onclick: () => { serieAberta = g.serie; limiteGrade = 240; desenharBiblioteca(); scrollTo(0, 0); } },
    el('div', { class: 'pilha' }, capaEl(g.itens[0])),
    el('span', { class: 'formato' }, `${g.itens.length} caps`),
    g.terminado ? el('span', { class: 'selo' }, '✓ lido') : null,
    el('div', { class: 'titulo' }, '🗾 ' + g.serie),
    el('div', { class: 'autor' }, atual ? 'lendo ' + rotuloCap(atual) : g.autor || ' '),
    el('div', { class: 'progresso' }, el('i', { style: `width:${p}%` })),
    el('div', { class: 'pct' }, el('span', {}, `${g.lidos} de ${g.itens.length} lidos`), el('span', {}, g.lidos ? p + '%' : '')));
}

// ---- abrir os arquivos
async function abrirDocumento(l) {
  const fonte = fontes.get(l.id);
  return ehQuadrinho(l) ? abrirQuadrinho(fonte, l) : abrirPdf(fonte);
}
// bytes [ini, fim) da fonte: no celular um pedido com Range; no PC um pedaço do arquivo
async function pedaco(fonte, arquivo, ini, fim) {
  if (fonte.url) {
    const r = await fetch(fonte.url, { headers: { Range: `bytes=${ini}-${fim - 1}` } });
    const b = new Uint8Array(await r.arrayBuffer());
    return r.status === 200 && b.length > fim - ini ? b.subarray(ini, fim) : b;   // quem não entende Range manda tudo
  }
  return new Uint8Array(await arquivo.slice(ini, fim).arrayBuffer());
}
async function inflar(dados) {
  const s = new Blob([dados]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function paginasDoZip(fonte, tamanho) {
  const arquivo = fonte.url ? null : await fonte();
  if (arquivo) tamanho = arquivo.size;
  const ini = Math.max(0, tamanho - 65557);
  const cauda = await pedaco(fonte, arquivo, ini, tamanho);
  const p = K.Zip.fimCentral(cauda, cauda.length);
  if (p < 0) throw new Error('não é um .cbz (zip) válido');
  const cIni = K.Zip.inicioCentral(cauda, p), cTam = K.Zip.tamanhoCentral(cauda, p);
  if (cIni < 0 || cTam < 0) throw new Error('arquivo grande demais (mais de 2 GB)');
  const cd = cIni >= ini ? cauda.subarray(cIni - ini, cIni - ini + cTam) : await pedaco(fonte, arquivo, cIni, cIni + cTam);
  const idx = new K.Indice(cd, cd.length, K.Zip.quantos(cauda, p));
  if (idx.cifrado()) throw new Error('esse arquivo tem senha');
  const utf8 = new TextDecoder('utf-8');
  const itens = [];
  for (let i = 0; i < idx.quantos(); i++) {
    const nome = utf8.decode(cd.subarray(idx.nomeIni(i), idx.nomeIni(i) + idx.nomeLen(i)));
    const base = nome.split('/').pop();
    if (!IMAGEM.test(nome) || nome.startsWith('__MACOSX') || base.startsWith('.')) continue;
    itens.push({ nome, metodo: idx.metodo(i), comp: idx.comprimido(i), local: idx.local(i) });
  }
  itens.sort((a, b) => ordemNatural(a.nome, b.nome));
  return {
    nomes: itens.map((x) => x.nome),
    async imagem(k) {
      const it = itens[k];
      const d = K.Zip.inicioDados(await pedaco(fonte, arquivo, it.local, it.local + 30));
      if (d < 0) throw new Error('zip estragado');
      let dados = await pedaco(fonte, arquivo, it.local + d, it.local + d + it.comp);
      if (it.metodo === 8) dados = await inflar(dados);
      else if (it.metodo !== 0) throw new Error('compressão do zip que eu não leio (' + it.metodo + ')');
      return new Blob([dados], { type: mimeDe(it.nome) });
    },
  };
}
// o unrar é um só pra página inteira: um RAR por vez
let filaRar = Promise.resolve(), wasmRar = null;
const naFilaRar = (f) => (filaRar = filaRar.then(f, f));
async function paginasDoRar(fonte) {
  const dados = fonte.url ? await (await fetch(fonte.url)).arrayBuffer() : await (await fonte()).arrayBuffer();
  if (!wasmRar) wasmRar = Uint8Array.from(atob(UNRAR_WASM), (c) => c.charCodeAt(0)).buffer;
  const abrir = () => KofUnrar.createExtractorFromData({ wasmBinary: wasmRar, data: dados });
  const lista = await naFilaRar(async () => [...(await abrir()).getFileList().fileHeaders]
    .filter((h) => !h.flags.directory && IMAGEM.test(h.name) && !h.name.split('/').pop().startsWith('.')).map((h) => h.name).sort(ordemNatural));
  return {
    nomes: lista,
    imagem: (k) => naFilaRar(async () => {
      const f = [...(await abrir()).extract({ files: [lista[k]] }).files][0];
      if (!f || !f.extraction) throw new Error('não consegui tirar ' + lista[k] + ' do RAR');
      return new Blob([f.extraction], { type: mimeDe(lista[k]) });
    }),
  };
}
// corta as bordas brancas: o Kof (Bordas) mede numa cópia pequena da página
function medirBordas(bmp) {
  const w = 160, h = Math.max(8, Math.round((bmp.height / bmp.width) * 160));
  const c = new OffscreenCanvas(w, h), ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const [x0, y0, x1, y1] = K.Bordas.medir(d, w, h);
  const fx = bmp.width / w, fy = bmp.height / h;
  return [Math.floor(x0 * fx), Math.floor(y0 * fy), Math.ceil((x1 - x0) * fx), Math.ceil((y1 - y0) * fy)];
}
async function abrirQuadrinho(fonte, l) {
  const pags = tipoDe(l.arquivo) === 'cbr' ? await paginasDoRar(fonte) : await paginasDoZip(fonte, l.tamanho);
  if (!pags.nomes.length) throw new Error('não achei nenhuma imagem dentro do arquivo');
  const cache = new Map(), uso = [];
  const cortar = !!(L.livro === l && L.modo ? L.modo.cortar : modoManga().cortar);
  const doc = {
    numPages: pags.nomes.length, quadrinho: true,
    loadingTask: { destroy: async () => { for (const p of cache.values()) p.then((x) => x.bmp.close(), () => {}); cache.clear(); } },
    getMetadata: async () => ({ info: {} }),
    bitmap(n) {
      let p = cache.get(n);
      if (!p) {
        p = pags.imagem(n - 1).then((b) => createImageBitmap(b)).then((bmp) => ({ bmp, corte: cortar ? medirBordas(bmp) : null }));
        cache.set(n, p);
        uso.push(n);
        while (cache.size > 14) { const v = uso.shift(); if (v !== n && cache.has(v)) { cache.get(v).then((x) => x.bmp.close(), () => {}); cache.delete(v); } }
      }
      return p;
    },
    async getPage(n) {
      const { bmp, corte } = await doc.bitmap(n);
      const [cx, cy, cw, ch] = corte || [0, 0, bmp.width, bmp.height];
      return {
        getViewport: ({ scale }) => ({ width: cw * scale, height: ch * scale, scale }),
        render: ({ canvasContext, viewport }) => ({ promise: Promise.resolve().then(() => {
          canvasContext.imageSmoothingQuality = 'high';
          canvasContext.drawImage(bmp, cx, cy, cw, ch, 0, 0, viewport.width, viewport.height);
        }) }),
      };
    },
  };
  return doc;
}

// ---- leitor paginado (mangá): uma página, ou duas lado a lado em tela larga; direita->esquerda por padrão
function modoManga() { return Object.assign({ direcao: 'rtl', dupla: true, cortar: false }, config.manga || {}); }
const paginado = () => !!(L.doc && L.doc.quadrinho && L.modo && L.modo.direcao !== 'vertical');
const sentido = () => (paginado() && L.modo.direcao === 'rtl' ? -1 : 1);   // tecla/toque pra "frente" no mangá japonês é pra esquerda
function passo(d) {
  if (!L.doc) return;
  if (!paginado()) { irPara(L.atual + d, false); return; }
  if (d > 0) {
    const ultima = Math.max(...(L.mostradas || [L.atual]));
    if (ultima >= L.doc.numPages) { fimDoCapitulo(); return; }
    mostrar(ultima + 1);
  } else {
    if (!$('#fimCap').hidden) { $('#fimCap').hidden = true; return; }
    const primeira = (L.mostradas || [L.atual])[0];
    if (primeira <= 1) return;
    mostrar(primeira - 1, true);
  }
}
function montarPaginado() {
  const box = $('#paginas');
  if (L.observa) L.observa.disconnect();
  for (const c of L.desenhadas.values()) c.width = 0;
  L.desenhadas.clear(); L.fila.clear();
  L.paginas = []; L.mostradas = null; L.zoomPag = 1;
  box.replaceChildren(el('div', { class: 'folha' + (L.modo.direcao === 'rtl' ? ' rtl' : '') }));
  box.classList.add('paginado');
  marcarBotoes();
}
// página larga (página dupla desenhada junto) fica sozinha; a capa (1) também
async function larga(n) { const v = (await L.doc.getPage(n)).getViewport({ scale: 1 }); return v.width > v.height * 1.05; }
async function mostrar(n, voltando = false) {
  const doc = L.doc; if (!doc) return;
  n = Math.max(1, Math.min(doc.numPages, n));
  const vez = (L.vez = (L.vez || 0) + 1);
  const box = $('#paginas'), folha = box.querySelector('.folha');
  const dupla = L.modo.dupla && box.clientWidth > box.clientHeight * 1.1 && L.zoomPag === 1;
  let pares = [n];
  if (dupla) {
    if (voltando && n > 2 && !(await larga(n)) && !(await larga(n - 1))) pares = [n - 1, n];
    else if (!voltando && n > 1 && n < doc.numPages && !(await larga(n)) && !(await larga(n + 1))) pares = [n, n + 1];
  }
  const pgs = await Promise.all(pares.map((k) => doc.getPage(k)));
  if (vez !== L.vez || doc !== L.doc) return;
  const W = box.clientWidth - 8, H = box.clientHeight - 8;
  const vs = pgs.map((p) => p.getViewport({ scale: 1 }));
  const larguraTotal = vs.reduce((a, v) => a + v.width / v.height, 0);   // largura de tudo com altura 1
  L.escalaBase = Math.min(W / (larguraTotal * Math.max(...vs.map((v) => v.height))), H / Math.max(...vs.map((v) => v.height)));
  const escala = L.escalaBase * (L.zoomPag || 1);
  L.escala = escala;   // a pinça do celular parte daqui
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const telas = [];
  for (let i = 0; i < pgs.length; i++) {
    const v = pgs[i].getViewport({ scale: escala * dpr });
    const c = document.createElement('canvas');
    c.width = Math.round(v.width); c.height = Math.round(v.height);
    c.style.width = Math.round(v.width / dpr) + 'px'; c.style.height = Math.round(v.height / dpr) + 'px';
    const ctx = c.getContext('2d', { willReadFrequently: L.tema !== null });
    await pgs[i].render({ canvas: c, canvasContext: ctx, viewport: v }).promise;
    pintar(c, ctx);
    telas.push(c);
  }
  if (vez !== L.vez || doc !== L.doc) return;
  for (const c of folha.querySelectorAll('canvas')) c.width = 0;
  folha.replaceChildren(...telas);
  folha.classList.toggle('zoom', L.zoomPag > 1);
  box.scrollTop = 0; box.scrollLeft = L.modo.direcao === 'rtl' ? box.scrollWidth : 0;
  $('#fimCap').hidden = true;
  L.mostradas = pares;
  mudouPagina(pares[0]);
  if (pares[pares.length - 1] >= doc.numPages && L.livro && !L.livro.terminado) { L.livro.terminado = true; salvarDepois(L.livro); }
  marcarPaginas();
  // já deixa as próximas prontas (virar é na hora)
  for (let k = pares[pares.length - 1] + 1; k <= Math.min(doc.numPages, pares[pares.length - 1] + 4); k++) doc.bitmap(k).catch(() => {});
  if (pares[0] > 1) doc.bitmap(pares[0] - 1).catch(() => {});
}
function fimDoCapitulo() {
  const p = proximoCapitulo(L.livro);
  $('#fimTitulo').textContent = 'Fim de ' + nomeExibido(L.livro);
  $('#btFimProx').hidden = !p;
  if (p) $('#btFimProx').textContent = 'Próximo: ' + rotuloCap(p) + ' →';
  $('#fimCap').hidden = false;
}
// muda direção, página dupla ou corte de bordas (vale pra todos os mangás) e reabre a página atual
async function mudarManga(m) {
  await guardarConfig('manga', { ...modoManga(), ...m });
  if (!L.doc || !L.doc.quadrinho) { desenharPainelTemas(); return; }
  const n = L.atual, l = L.livro;
  if ('cortar' in m) { await abrirLivro(l); alternarPainel('temas'); return; }   // o corte muda o tamanho das páginas: abre de novo
  L.modo = modoManga();
  $('#paginas').classList.remove('paginado');
  if (paginado()) montarPaginado();
  else { L.zoom = 'largura'; montarPaginas(); }
  irPara(n, false);
  desenharPainelTemas();
}

// ---------------------------------------------------------------- celular (app Android)
// A pasta de livros do celular e os livros que vieram do PC são listados pelo app (android/Biblioteca.java); a
// página lê cada PDF por /pasta?u=..., aos pedaços.
let abrirDepois = null;
function iniciarCelular() {
  $('#avisoPasta').hidden = true;
  $('#vazio p').innerHTML = 'Toque em <b>📁 Escolher pasta</b> e escolha a pasta dos seus livros no celular, ou mande os livros do PC '
    + 'pelo <b>📱</b> (os dois na mesma Wi-Fi). Também dá pra abrir um PDF de qualquer lugar com <b>Abrir com → KOFlibrary</b>.';
  $('#btPasta').title = 'Escolher a pasta dos livros no celular';
  window.__pastaLida = (lista) => {
    for (const it of lista) {
      const partes = it.c.split('/');
      const l = registrar({ name: it.n, size: it.t }, it.c, partes.length > 1 ? partes[0] : (it.r ? (livros.get(it.n + '|' + it.t)?.estante || '') : ''));
      const url = '/pasta?u=' + encodeURIComponent(it.u);
      const f = () => fetch(url).then((r) => r.blob());
      f.url = url;
      fontes.set(l.id, f);
    }
    desenharBiblioteca();
    fazerCapas();
    if (abrirDepois && livros.get(abrirDepois)) { const l = livros.get(abrirDepois); abrirDepois = null; abrirLivro(l); }
  };
  window.__pastaEscolhida = (ok) => { if (ok) { toast('📁 Lendo a pasta "' + APK.pastaNome() + '"...'); APK.listar(); } };
  window.__pdfsAdicionados = (n) => { toast(n ? `📚 ${n} arquivo${n === 1 ? '' : 's'} adicionado${n === 1 ? '' : 's'}` : 'Nenhum arquivo adicionado.'); APK.listar(); };
  let espera = 0;
  window.__livroChegou = (nome) => { toast('📥 Chegou do PC: ' + K.Nome.titulo(nome)); clearTimeout(espera); espera = setTimeout(() => APK.listar(), 800); };
  window.__abrirDeFora = (chave) => { if (!$('#leitor').hidden) fecharLivro(); abrirDepois = chave; APK.listar(); };
  window.__volume = (d) => { if (L.doc) passo(d); };
  window.__pausou = () => { if (L.livro) salvarLivro(L.livro); };
  window.__sincronia = (id, json) => {
    let r = '';
    try { r = JSON.stringify(receberSincronia(JSON.parse(json))); } catch (e) { console.warn('sincronia', e); }
    APK.responder(id, r);
  };
  // voltar do Android: fecha o que estiver aberto; nada aberto = sai do app
  window.__voltar = () => {
    const d = document.querySelector('dialog[open]');
    if (d) { d.close(); return true; }
    if (!$('#painelTemas').hidden || !$('#painelNotas').hidden) { fecharPaineis(); return true; }
    if (!$('#fimCap').hidden) { $('#fimCap').hidden = true; return true; }
    if (!$('#leitor').hidden) { fecharLivro(); return true; }
    if ($('#busca').value) { $('#busca').value = ''; desenharBiblioteca(); return true; }
    return false;
  };
  const p = APK.pronta();
  if (p) abrirDepois = p;
  APK.listar();
}
function fecharPaineis() {
  $('#painelTemas').hidden = $('#painelNotas').hidden = true;
  $('#btTemas').classList.remove('ligado'); $('#btNotas').classList.remove('ligado');
}

// ---------------------------------------------------------------- toque (celular e tablet)
// toque no meio mostra/esconde as barras; nas beiradas vira a página; arrastar pro lado vira a página; pinça = zoom
function ligarToque() {
  const box = $('#paginas');
  let ini = null, pinca = null;
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  box.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      pinca = { d: dist(e.touches), x: (e.touches[0].clientX + e.touches[1].clientX) / 2, y: (e.touches[0].clientY + e.touches[1].clientY) / 2, f: 1 };
      ini = null;
    } else if (e.touches.length === 1 && !pinca) {
      ini = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now(), topo: box.scrollTop };
    }
  }, { passive: true });
  box.addEventListener('touchmove', (e) => {
    if (!pinca || e.touches.length !== 2) return;
    e.preventDefault();
    pinca.f = Math.max(0.4, Math.min(4, dist(e.touches) / pinca.d));
    const r = box.getBoundingClientRect();
    box.style.transformOrigin = `${pinca.x - r.left}px ${pinca.y - r.top}px`;
    box.style.transform = `scale(${pinca.f})`;
  }, { passive: false });
  box.addEventListener('touchend', (e) => {
    if (pinca) {
      if (e.touches.length) return;
      const f = pinca.f; pinca = null;
      box.style.transform = ''; box.style.transformOrigin = '';
      if (Math.abs(f - 1) > 0.05 && L.doc) zoom(L.escala * f);
      return;
    }
    if (!ini || !L.doc) return;
    const t = e.changedTouches[0], dx = t.clientX - ini.x, dy = t.clientY - ini.y, dt = Date.now() - ini.t;
    const rolou = Math.abs(box.scrollTop - ini.topo) > 4;
    ini = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy) && dt < 700 && box.scrollWidth <= box.clientWidth + 2) {
      passo((dx < 0 ? 1 : -1) * sentido());   // arrastou pro lado (só sem zoom maior que a tela, senão é rolar)
    } else if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && dt < 400 && !rolou) {
      if (!$('#painelTemas').hidden || !$('#painelNotas').hidden) { fecharPaineis(); return; }
      const x = t.clientX / innerWidth;
      if (x < 0.25) passo(-sentido());
      else if (x > 0.75) passo(sentido());
      else $('#leitor').classList.toggle('limpo');
    }
  });
}

// ---------------------------------------------------------------- sincronia PC <-> celular
// O celular (app Android) tem um servidor na rede de casa (android/Sincronia.java, porta 8643, senha de 4 números).
// O PC manda os registros dele (progresso, notas, marcadores, tempo), o celular junta e devolve os dele, e o PC junta
// também: os dois ficam iguais. Depois o PC manda os PDFs que o celular ainda não tem. Nada passa pela internet.
const CAMPOS = ['id', 'arquivo', 'tamanho', 'estante', 'titulo', 'autor', 'ano', 'paginas', 'pagina', 'lido', 'zoom', 'editadoEm',
  'favorito', 'terminado', 'leitura', 'marcadores', 'marcadoresEm', 'notas', 'notasApagadas', 'segundosPor', 'paginasPor', 'adicionado',
  'serie', 'cap', 'vol'];
function paraEnviar(l) { const r = {}; for (const k of CAMPOS) if (l[k] !== undefined) r[k] = l[k]; return r; }
function maiores(a = {}, b = {}) { const r = { ...a }; for (const [k, v] of Object.entries(b)) r[k] = Math.max(r[k] || 0, v); return r; }
const soma = (m) => Object.values(m || {}).reduce((a, b) => a + b, 0);
// junta o registro de outro aparelho no meu: vale o mais novo de cada parte
function juntarLivro(meu, dele) {
  if (!meu) {
    const r = { ...paraEnviar(dele), caminho: dele.arquivo, noBanco: false, notas: dele.notas || [], marcadores: dele.marcadores || [] };
    r.segundos = soma(r.segundosPor); r.paginasLidas = soma(r.paginasPor);
    if (ehQuadrinho(r) && r.serie === undefined) marcarQuadrinho(r, r.arquivo);
    return r;
  }
  if ((dele.lido || 0) > (meu.lido || 0)) {
    meu.pagina = dele.pagina; meu.lido = dele.lido; meu.zoom = dele.zoom;
    if (Math.max(dele.lido || 0, dele.editadoEm || 0) > (meu.editadoEm || 0)) meu.terminado = !!dele.terminado;
  }
  if (dele.paginas && !meu.paginas) meu.paginas = dele.paginas;
  if ((dele.editadoEm || 0) > (meu.editadoEm || 0)) {
    meu.titulo = dele.titulo; meu.autor = dele.autor; meu.favorito = !!dele.favorito; meu.terminado = !!dele.terminado; meu.editadoEm = dele.editadoEm;
    if (dele.leitura) meu.leitura = dele.leitura; else delete meu.leitura;
  }
  if ((dele.marcadoresEm || 0) > (meu.marcadoresEm || 0)) { meu.marcadores = [...(dele.marcadores || [])]; meu.marcadoresEm = dele.marcadoresEm; }
  const apagadas = new Set([...(meu.notasApagadas || []), ...(dele.notasApagadas || [])]);
  const notas = new Map();
  for (const n of [...(meu.notas || []), ...(dele.notas || [])]) if (!apagadas.has(n.id) && !notas.has(n.id)) notas.set(n.id, n);
  meu.notas = [...notas.values()].sort((a, b) => a.pagina - b.pagina || a.data - b.data);
  meu.notasApagadas = [...apagadas];
  meu.segundosPor = maiores(meu.segundosPor, dele.segundosPor); meu.segundos = soma(meu.segundosPor);
  meu.paginasPor = maiores(meu.paginasPor, dele.paginasPor); meu.paginasLidas = soma(meu.paginasPor);
  meu.adicionado = Math.min(meu.adicionado || Date.now(), dele.adicionado || Date.now());
  return meu;
}
function juntarTodos(lista) {
  for (const dele of lista || []) {
    if (!dele || !dele.id) continue;
    const r = juntarLivro(livros.get(dele.id), dele);
    livros.set(r.id, r); normal.delete(r.id); salvarLivro(r);
  }
}
// celular: o PC mandou os registros dele
function receberSincronia(pedido) {
  juntarTodos(pedido.livros);
  if (L.livro) marcarPaginas();
  if ($('#leitor').hidden) desenharBiblioteca();
  return { nome: 'celular', aparelho: config.aparelho, livros: [...livros.values()].map(paraEnviar), temArquivo: [...fontes.keys()] };
}

// PC: o lado que chama
const Sinc = { rodando: false, auto: 0, estado: '' };
function enderecoCelular() {
  const e = (config.celular?.endereco || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return e && !e.includes(':') ? e + ':8643' : e;
}
function statusSinc(txt, tipo = '') {
  Sinc.estado = txt;
  const s = $('#sincStatus'); if (s) { s.textContent = txt; s.className = 'sinc-status ' + tipo; }
  const b = $('#btCelular'); if (b) b.classList.toggle('ligado', tipo === 'ok');
}
async function pedir(caminho, opcoes = {}) {
  const r = await fetch('http://' + enderecoCelular() + caminho, {
    ...opcoes,
    headers: { 'X-Kof-Senha': config.celular.senha || '', 'X-Kof-Pc': encodeURIComponent(navigator.platform || 'PC'), ...(opcoes.headers || {}) },
  });
  if (r.status === 403) throw new Error('senha');
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r;
}
async function sincronizarCelular(silencioso) {
  if (APK || Sinc.rodando) return;
  if (!enderecoCelular()) { if (!silencioso) abrirSincronia(); return; }
  Sinc.rodando = true;
  try {
    statusSinc('🔄 Juntando progresso e notas...');
    const r = await pedir('/sincronizar', { method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ nome: 'PC', aparelho: config.aparelho, livros: [...livros.values()].map(paraEnviar) }) });
    const resp = await r.json();
    juntarTodos(resp.livros);
    if ($('#leitor').hidden) desenharBiblioteca(); else marcarPaginas();
    // os PDFs que o celular ainda não tem
    const tem = new Set(resp.temArquivo || []);
    const modo = config.celular.enviar || 'lendo';
    let faltam = [...livros.values()].filter((l) => fontes.has(l.id) && !tem.has(l.id));
    if (modo === 'lendo') faltam = faltam.filter((l) => situacao(l) === 'lendo' || l.favorito);
    else if (modo === 'nenhum') faltam = [];
    faltam.sort((a, b) => (b.lido - a.lido) || (b.adicionado - a.adicionado));
    let n = 0;
    for (const l of faltam) {
      const f = await fontes.get(l.id)();
      statusSinc(`📤 Enviando ${++n} de ${faltam.length}: ${l.titulo} (${(f.size / 1048576).toFixed(1)} MB)...`);
      await pedir(`/livro?nome=${encodeURIComponent(l.arquivo)}&estante=${encodeURIComponent(l.estante || '')}&tamanho=${f.size}`, { method: 'PUT', body: f });
    }
    await guardarConfig('celular', { ...config.celular, ultima: Date.now() });
    statusSinc(`✅ Sincronizado às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` + (n ? ` · ${n} livro${n === 1 ? '' : 's'} enviado${n === 1 ? '' : 's'}` : ''), 'ok');
    if (!silencioso && n) toast(`📱 ${n} livro${n === 1 ? '' : 's'} enviado${n === 1 ? '' : 's'} pro celular`);
  } catch (e) {
    statusSinc(e.message === 'senha' ? '🔒 Senha errada: confira a senha que aparece no celular.' : explicarFalha(), 'erro');
  } finally { Sinc.rodando = false; }
}
function explicarFalha() {
  const e = enderecoCelular();
  return `📵 Não achei o celular em ${e}. Confira: o KOFlibrary aberto no celular, os dois na mesma Wi-Fi e o endereço igual ao do celular. `
    + `Teste abrindo http://${e} no navegador do PC: se aparecer "Celular achado", a rede está ok e é o navegador bloqueando `
    + `a página de falar com a rede local: clique no cadeado/ícone ao lado do endereço e permita "Dispositivos da rede local", e sincronize de novo.`;
}
// o PC sincroniza sozinho a cada 2 minutos enquanto está aberto (e quando fecha um livro)
function iniciarSincroniaPc() {
  if (enderecoCelular()) setTimeout(() => sincronizarCelular(true), 3000);
  Sinc.auto = setInterval(() => { if (enderecoCelular() && !document.hidden) sincronizarCelular(true); }, 120000);
}
function abrirSincronia() {
  const d = $('#dlgCelular');
  if (APK) {
    const atualizar = () => {
      let s = {};
      try { s = JSON.parse(APK.sincronia()); } catch (e) { /* sem servidor */ }
      $('#sincCelular').replaceChildren(
        s.erro ? el('p', {}, '⚠️ ' + s.erro) : el('div', {},
          el('p', {}, 'No PC, abra o KOFlibrary, clique em 📱 e digite:'),
          el('div', { class: 'sinc-codigo' }, el('span', {}, 'Endereço'), el('b', {}, `${s.ip}:${s.porta}`)),
          el('div', { class: 'sinc-codigo' }, el('span', {}, 'Senha'), el('b', {}, s.senha)),
          s.casa ? null : el('p', { class: 'sinc-status erro' }, '⚠️ Parece que o celular não está numa Wi-Fi de casa (4G ou VPN?). Ligue a Wi-Fi da mesma rede do PC.'),
          el('p', { class: 'dica' }, s.ultima ? `Última sincronização: ${quando(s.ultima)}` : 'Ainda não sincronizou com o PC.'),
          el('p', { class: 'dica' }, 'O PC manda os livros e o progresso sozinho enquanto o KOFlibrary estiver aberto nos dois.')));
    };
    atualizar();
    clearInterval(abrirSincronia.t); abrirSincronia.t = setInterval(() => (d.open ? atualizar() : clearInterval(abrirSincronia.t)), 2000);
    $('#sincPc').hidden = true;
  } else {
    $('#sincCelular').replaceChildren();
    $('#sincPc').hidden = false;
    const c = config.celular || {};
    $('#sincEndereco').value = c.endereco || ''; $('#sincSenha').value = c.senha || ''; $('#sincEnviar').value = c.enviar || 'lendo';
    statusSinc(Sinc.estado || (c.ultima ? `Última sincronização: ${quando(c.ultima)}` : ''), Sinc.estado.startsWith('✅') ? 'ok' : '');
  }
  d.showModal();
}
async function guardarCelular() {
  await guardarConfig('celular', { ...(config.celular || {}), endereco: $('#sincEndereco').value.trim(), senha: $('#sincSenha').value.trim(), enviar: $('#sincEnviar').value });
}

// ---------------------------------------------------------------- início
async function iniciar() {
  $('#versao').textContent = VERSAO.split(' ')[0];
  ligarEventos();
  try { await Banco.abrir(); } catch (e) { toast('O navegador não deixou guardar dados: ' + e.message, 8000); return; }
  for (const k of ['pastas', 'temaApp', 'leitura', 'ordem', 'aparelho', 'celular']) config[k] = await Banco.get('config', k);
  if (!config.aparelho) await guardarConfig('aparelho', (APK ? 'cel-' : 'pc-') + Math.random().toString(36).slice(2, 10));
  aplicarTemaApp(config.temaApp);
  if (config.ordem) $('#ordem').value = config.ordem;
  for (const l of await Banco.todos('livros')) {
    // livros da v1: o tempo e as páginas que já tinham passam a ser deste aparelho
    if (!l.segundosPor) l.segundosPor = { [config.aparelho]: l.segundos || 0 };
    if (!l.paginasPor) l.paginasPor = { [config.aparelho]: l.paginasLidas || 0 };
    livros.set(l.id, l);
    if (l.noBanco) fontes.set(l.id, () => Banco.get('arquivos', l.id));
  }
  desenharBiblioteca();
  if (APK) iniciarCelular();
  else if ((config.pastas || []).length) await reabrirPastas(false);
  else fazerCapas();
  if (!APK) iniciarSincroniaPc();
}
iniciar();

// pros testes
window.KOFlibrary = { livros, fontes, L, temas, config, abrirLivro, adicionarArquivos, irPara, ajustar, fecharLivro, sincronizarCelular, juntarLivro };
