package dev.koflibrary.android;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * KOFlibrary no Android: uma WebView em tela cheia com o mesmo KOFlibrary.html do PC (assets/index.html), servido em
 * https://appassets.androidplatform.net/ (endereço seguro: IndexedDB, WebAssembly). O Java faz só o que a página não
 * consegue sozinha: a pasta de livros (Biblioteca), receber livros e progresso do PC (Sincronia), "Abrir com", salvar
 * as anotações exportadas, as teclas de volume virando a página e se atualizar sozinho (Atualizador).
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final int PEDIDO_PASTA = 1, PEDIDO_PDF = 2, PEDIDO_SALVAR = 3;
    // sobe a cada mudança neste Java: página publicada com casca maior pede APK novo (ela pode usar algo que esta não tem)
    static final int CASCA = 2;
    private static final String FONTE = "https://raw.githubusercontent.com/Marcelao98/KOFLibrary/main/publicado/";
    private static final String APK = "https://raw.githubusercontent.com/Marcelao98/KOFLibrary/main/android/apk/KOFlibrary.apk";

    private WebView web;
    private File raizWeb;   // pasta da versão baixada (null = a que veio dentro do APK)
    private Biblioteca biblioteca;
    private Sincronia sincronia;
    private volatile boolean paginaPronta = false, leitorAberto = false;
    private String paraAbrir;          // PDF que chegou por "Abrir com" antes da página carregar
    private String paraSalvar;
    private final Map<Integer, String[]> respostas = new ConcurrentHashMap<Integer, String[]>();
    private final Map<Integer, CountDownLatch> esperas = new ConcurrentHashMap<Integer, CountDownLatch>();
    private final AtomicInteger pedidos = new AtomicInteger();

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        biblioteca = new Biblioteca(this);
        web = new WebView(this);
        setContentView(web);
        web.setBackgroundColor(0xFF1A110B);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setBuiltInZoomControls(false);
        s.setSupportZoom(false);
        s.setTextZoom(100);   // a fonte grande do sistema não estoura a interface (o zoom do livro é do próprio leitor)
        try { WebView.setWebContentsDebuggingEnabled(true); } catch (Throwable t) { /* sem depuração */ }
        web.addJavascriptInterface(new Ponte(), "KOFlibraryApk");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if (HOST.equals(u.getHost()) && "/pasta".equals(u.getPath())) return biblioteca.servir(u, r.getRequestHeaders());
                if (HOST.equals(u.getHost())) return servir(u.getPath());
                return null;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, String url) {
                if (url.startsWith("https://" + HOST)) return false;
                abrirFora(url);
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                android.util.Log.d("KOFlibrary", m.message() + " (" + m.sourceId() + ":" + m.lineNumber() + ")");
                return true;
            }
        });
        final Atualizador at = new Atualizador(new File(getFilesDir(), "web"), FONTE, CASCA, new Atualizador.Embutidos() {
            public InputStream abrir(String nome) throws IOException { return getAssets().open(nome); }
        });
        raizWeb = at.raiz();
        web.loadUrl("https://" + HOST + "/index.html");
        receber(getIntent());
        iniciarSincronia();
        new Thread(new Runnable() {
            public void run() {
                final int r = at.atualizar(raizWeb);
                android.util.Log.d("KOFlibrary", "atualização: " + r + " " + at.erro);
                runOnUiThread(new Runnable() {
                    public void run() {
                        if (isFinishing()) return;
                        if (r == Atualizador.NOVA) Toast.makeText(MainActivity.this, "KOFlibrary atualizado: a versão nova abre na próxima vez", Toast.LENGTH_LONG).show();
                        else if (r == Atualizador.CASCA_NOVA) new AlertDialog.Builder(MainActivity.this)
                                .setTitle("KOFlibrary novo").setMessage("Essa atualização precisa instalar o app de novo (seus livros e notas continuam). Baixar agora?")
                                .setPositiveButton("Baixar", new DialogInterface.OnClickListener() { public void onClick(DialogInterface d, int w) { abrirFora(APK); } })
                                .setNegativeButton("Depois", null).show();
                    }
                });
            }
        }).start();
    }

    /** O servidor pro PC mandar livros e progresso: liga junto com o app, sempre com a mesma senha. */
    private void iniciarSincronia() {
        try {
            SharedPreferences p = getSharedPreferences("sincronia", MODE_PRIVATE);
            String senha = p.getString("senha", "");
            if (senha.length() != 4) { senha = Sincronia.novaSenha(); p.edit().putString("senha", senha).apply(); }
            sincronia = new Sincronia(senha, Sincronia.PORTA, biblioteca.recebidos, new Sincronia.Pagina() {
                public String sincronizar(String json) throws Exception { return perguntarPagina("__sincronia", json); }
                public void livroChegou(String nome) { js("window.__livroChegou && window.__livroChegou(" + JSONObject.quote(nome) + ")"); }
                public String nome() { return Build.MANUFACTURER + " " + Build.MODEL; }
                public String versao() { return "@VERSAO_NOME@"; }
            });
        } catch (Exception e) {
            android.util.Log.d("KOFlibrary", "sincronia não ligou: " + e);
        }
    }

    /** Chama window.<funcao>(id, json) na página e espera ela responder pela Ponte.responder (até 30 s). */
    private String perguntarPagina(String funcao, String json) throws Exception {
        final int id = pedidos.incrementAndGet();
        CountDownLatch l = new CountDownLatch(1);
        esperas.put(id, l);
        try {
            js("window." + funcao + " ? window." + funcao + "(" + id + ", " + JSONObject.quote(json) + ") : KOFlibraryApk.responder(" + id + ", '')");
            if (!l.await(30, TimeUnit.SECONDS)) throw new Exception("a página não respondeu");
            String[] r = respostas.remove(id);
            if (r == null || r[0].isEmpty()) throw new Exception("a página ainda não está pronta");
            return r[0];
        } finally { esperas.remove(id); }
    }

    private void js(final String codigo) {
        runOnUiThread(new Runnable() { public void run() { web.evaluateJavascript(codigo, null); } });
    }

    private WebResourceResponse servir(String caminho) {
        String nome = (caminho == null || caminho.equals("/") || caminho.isEmpty()) ? "index.html" : caminho.substring(1);
        try {
            File f = raizWeb == null || nome.contains("..") ? null : new File(raizWeb, nome);
            InputStream in = f != null && f.isFile() ? new FileInputStream(f) : getAssets().open(nome);   // a versão baixada, senão a do APK
            String mime = nome.endsWith(".html") ? "text/html" : nome.endsWith(".js") ? "application/javascript" : "application/octet-stream";
            return new WebResourceResponse(mime, "utf-8", in);
        } catch (IOException e) {
            return new WebResourceResponse("text/plain", "utf-8", new ByteArrayInputStream(new byte[0]));
        }
    }

    private void abrirFora(String url) {
        try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); }
        catch (Exception e) { Toast.makeText(this, "não consegui abrir o link", Toast.LENGTH_SHORT).show(); }
    }

    // ---------------------------------------------------------------- "Abrir com" / "Compartilhar"
    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        receber(i);
    }

    private void receber(Intent i) {
        if (i == null) return;
        Uri u = null;
        if (Intent.ACTION_VIEW.equals(i.getAction())) u = i.getData();
        else if (Intent.ACTION_SEND.equals(i.getAction())) u = i.getParcelableExtra(Intent.EXTRA_STREAM);
        if (u == null) return;
        final Uri uri = u;
        new Thread(new Runnable() { public void run() {
            final File f = biblioteca.copiarDeFora(uri);
            runOnUiThread(new Runnable() { public void run() {
                if (f == null) { Toast.makeText(MainActivity.this, "não consegui abrir esse PDF", Toast.LENGTH_LONG).show(); return; }
                String chave = f.getName() + "|" + f.length();
                if (paginaPronta) web.evaluateJavascript("window.__abrirDeFora && window.__abrirDeFora(" + JSONObject.quote(chave) + ")", null);
                else paraAbrir = chave;
            } });
        } }).start();
    }

    /** O que a página enxerga como window.KOFlibraryApk. */
    public class Ponte {
        @JavascriptInterface
        public String versao() { return "@VERSAO_NOME@"; }

        @JavascriptInterface
        public int casca() { return CASCA; }

        /** A página carregou: devolve o PDF que chegou por "Abrir com" antes dela ("" = nenhum). */
        @JavascriptInterface
        public String pronta() { paginaPronta = true; String p = paraAbrir; paraAbrir = null; return p == null ? "" : p; }

        @JavascriptInterface
        public void pastaEscolher() {
            runOnUiThread(new Runnable() { public void run() {
                try { startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE), PEDIDO_PASTA); }
                catch (ActivityNotFoundException e) { Toast.makeText(MainActivity.this, "esse Android não deixa escolher pasta", Toast.LENGTH_LONG).show(); }
            } });
        }

        @JavascriptInterface
        public String pastaNome() { return biblioteca.nome(); }

        /** Lista em segundo plano; a resposta chega em window.__pastaLida(lista). */
        @JavascriptInterface
        public void listar() {
            new Thread(new Runnable() { public void run() {
                final String j = biblioteca.listar();
                js("window.__pastaLida && window.__pastaLida(" + j + ")");
            } }, "KOFpasta").start();
        }

        @JavascriptInterface
        public void adicionarPdf() {
            runOnUiThread(new Runnable() { public void run() {
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");   // .cbz/.cbr não têm tipo certo em todo celular: deixa escolher qualquer um e filtra pelo nome
                i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/pdf", "application/zip", "application/x-cbz", "application/x-cbr",
                        "application/vnd.comicbook+zip", "application/vnd.comicbook-rar", "application/x-rar-compressed", "application/octet-stream"});
                i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try { startActivityForResult(i, PEDIDO_PDF); }
                catch (ActivityNotFoundException e) { Toast.makeText(MainActivity.this, "não achei o seletor de arquivos", Toast.LENGTH_LONG).show(); }
            } });
        }

        /** Salvar um arquivo de texto (anotações .md) onde a pessoa escolher. */
        @JavascriptInterface
        public void salvar(String nome, String mime, String texto) {
            paraSalvar = texto;
            final Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType(mime == null || mime.isEmpty() ? "text/plain" : mime);
            i.putExtra(Intent.EXTRA_TITLE, nome);
            runOnUiThread(new Runnable() { public void run() { startActivityForResult(i, PEDIDO_SALVAR); } });
        }

        /** {ip, casa, porta, senha, pc, ultima}: o que o celular mostra pra ligar o PC. */
        @JavascriptInterface
        public String sincronia() {
            Sincronia s = sincronia;
            if (s == null) return "{\"erro\":\"o servidor não ligou\"}";
            String ip = Sincronia.ipLocal();
            return "{\"ip\":" + Sincronia.json(ip) + ",\"casa\":" + Sincronia.redeDeCasa(ip) + ",\"porta\":" + s.porta
                + ",\"senha\":" + Sincronia.json(s.senha) + ",\"pc\":" + Sincronia.json(s.ultimoPc) + ",\"ultima\":" + s.ultimaVez + "}";
        }

        @JavascriptInterface
        public void responder(int id, String json) {
            CountDownLatch l = esperas.get(id);
            if (l == null) return;
            respostas.put(id, new String[]{json == null ? "" : json});
            l.countDown();
        }

        /** Leitor aberto: as teclas de volume viram a página, a tela não apaga e as barras do sistema somem. */
        @JavascriptInterface
        public void leitor(final boolean aberto) {
            leitorAberto = aberto;
            runOnUiThread(new Runnable() { public void run() {
                if (aberto) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                imersivo();
            } });
        }

        @JavascriptInterface
        public void sair() { runOnUiThread(new Runnable() { public void run() { finish(); } }); }
    }

    @Override
    protected void onActivityResult(int pedido, int resultado, Intent dados) {
        super.onActivityResult(pedido, resultado, dados);
        if (pedido == PEDIDO_PASTA) {
            boolean ok = false;
            if (resultado == RESULT_OK && dados != null && dados.getData() != null) {
                try { biblioteca.guardar(dados.getData()); ok = true; } catch (Exception e) { Toast.makeText(this, "não consegui guardar a pasta", Toast.LENGTH_LONG).show(); }
            }
            web.evaluateJavascript("window.__pastaEscolhida && window.__pastaEscolhida(" + ok + ")", null);
        } else if (pedido == PEDIDO_PDF && resultado == RESULT_OK && dados != null) {
            final java.util.List<Uri> us = new java.util.ArrayList<Uri>();
            if (dados.getClipData() != null) { ClipData c = dados.getClipData(); for (int k = 0; k < c.getItemCount(); k++) us.add(c.getItemAt(k).getUri()); }
            else if (dados.getData() != null) us.add(dados.getData());
            new Thread(new Runnable() { public void run() {
                int n = 0;
                for (Uri u : us) if (biblioteca.copiarDeFora(u) != null) n++;
                js("window.__pdfsAdicionados && window.__pdfsAdicionados(" + n + ")");
            } }).start();
        } else if (pedido == PEDIDO_SALVAR) {
            if (resultado == RESULT_OK && dados != null && dados.getData() != null && paraSalvar != null) {
                try {
                    OutputStream o = getContentResolver().openOutputStream(dados.getData());
                    o.write(paraSalvar.getBytes("UTF-8"));
                    o.close();
                    Toast.makeText(this, "anotações salvas", Toast.LENGTH_SHORT).show();
                } catch (Exception e) {
                    Toast.makeText(this, "não consegui salvar o arquivo", Toast.LENGTH_LONG).show();
                }
            }
            paraSalvar = null;
        }
    }

    // volume pra baixo = próxima página, pra cima = anterior (só com o leitor aberto; fora dele o volume é volume)
    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        int k = e.getKeyCode();
        if (leitorAberto && (k == KeyEvent.KEYCODE_VOLUME_DOWN || k == KeyEvent.KEYCODE_VOLUME_UP)) {
            if (e.getAction() == KeyEvent.ACTION_DOWN) js("window.__volume && window.__volume(" + (k == KeyEvent.KEYCODE_VOLUME_DOWN ? 1 : -1) + ")");
            return true;
        }
        return super.dispatchKeyEvent(e);
    }

    // voltar: a página fecha o painel/leitor; se ela não tinha nada pra fechar, sai do app
    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.__voltar ? window.__voltar() : false", new ValueCallback<String>() {
            public void onReceiveValue(String v) { if (!"true".equals(v)) finish(); }
        });
    }

    @Override
    protected void onPause() { super.onPause(); web.onPause(); js("window.__pausou && window.__pausou()"); }

    @Override
    protected void onResume() { super.onResume(); web.onResume(); imersivo(); }

    @Override
    protected void onDestroy() { if (sincronia != null) sincronia.parar(); super.onDestroy(); }

    @Override
    public void onWindowFocusChanged(boolean foco) { super.onWindowFocusChanged(foco); if (foco) imersivo(); }

    private void imersivo() {
        View d = getWindow().getDecorView();
        if (leitorAberto) d.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        else d.setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
    }
}
