package dev.koflibrary.android;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import android.webkit.WebResourceResponse;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Os PDFs do celular, de dois lugares:
 * - a pasta de livros que a pessoa escolhe uma vez (seletor de pasta do Android; a permissão fica guardada), com as
 *   subpastas (até 3 níveis; a primeira subpasta é a estante, igual no PC);
 * - a pasta do próprio app (recebidos/), onde caem os livros que vieram do PC (Sincronia) e os abertos de fora
 *   ("Abrir com", "Compartilhar", ➕ PDF).
 * A página lê cada um por https://appassets.androidplatform.net/pasta?u=<endereço>, aos pedaços (Range): o pdf.js só
 * busca as partes da página que vai desenhar, então um livro de 300 MB abre na hora. Só os arquivos da última
 * listagem podem ser lidos.
 */
final class Biblioteca {
    static final class Item {
        final String nome, caminho;
        final Uri uri;
        final long tamanho;
        Item(String nome, Uri uri, long tamanho, String caminho) { this.nome = nome; this.uri = uri; this.tamanho = tamanho; this.caminho = caminho; }
    }

    private final Activity a;
    private final SharedPreferences prefs;
    final File recebidos;
    private volatile Map<String, Item> porUri = new HashMap<String, Item>();

    Biblioteca(Activity a) {
        this.a = a;
        prefs = a.getSharedPreferences("pasta", Context.MODE_PRIVATE);
        File base = a.getExternalFilesDir(null);
        recebidos = new File(base != null ? base : a.getFilesDir(), "recebidos");
        recebidos.mkdirs();
    }

    private Uri arvore() {
        String s = prefs.getString("arvore", null);
        return s == null ? null : Uri.parse(s);
    }

    /** O nome da pasta escolhida ("" = nenhuma, ou a permissão se perdeu). */
    String nome() {
        Uri t = arvore();
        if (t == null || !temPermissao(t)) return "";
        String id = DocumentsContract.getTreeDocumentId(t);   // "primary:Livros/PDF"
        return id.substring(Math.max(id.lastIndexOf(':'), id.lastIndexOf('/')) + 1);
    }

    private boolean temPermissao(Uri t) {
        for (UriPermission p : a.getContentResolver().getPersistedUriPermissions())
            if (p.getUri().equals(t) && p.isReadPermission()) return true;
        return false;
    }

    /** Guarda a pasta que voltou do seletor (ACTION_OPEN_DOCUMENT_TREE): vale também nas próximas aberturas do app. */
    void guardar(Uri t) {
        a.getContentResolver().takePersistableUriPermission(t, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        Uri antiga = arvore();
        if (antiga != null && !antiga.equals(t)) {
            try { a.getContentResolver().releasePersistableUriPermission(antiga, Intent.FLAG_GRANT_READ_URI_PERMISSION); } catch (Exception e) { /* já não tinha */ }
        }
        prefs.edit().putString("arvore", t.toString()).apply();
    }

    /** Lista os PDFs: JSON [{n: nome, u: endereço, t: tamanho, c: caminho dentro da pasta, r: veio do PC/de fora}]. */
    String listar() {
        List<Item> pasta = new ArrayList<Item>(), deFora = new ArrayList<Item>();
        Uri t = arvore();
        if (t != null && temPermissao(t)) varrer(a.getContentResolver(), t, DocumentsContract.getTreeDocumentId(t), "", 0, pasta);
        varrerArquivos(recebidos, "", deFora);
        Map<String, Item> m = new HashMap<String, Item>();
        Set<String> ids = new HashSet<String>();
        JSONArray j = new JSONArray();
        try {
            for (Item it : pasta) {
                ids.add(it.nome + "|" + it.tamanho);
                m.put(it.uri.toString(), it);
                j.put(new JSONObject().put("n", it.nome).put("u", it.uri.toString()).put("t", it.tamanho).put("c", it.caminho).put("r", false));
            }
            for (Item it : deFora) {
                if (ids.contains(it.nome + "|" + it.tamanho)) continue;   // o mesmo livro já está na pasta: vale o de lá
                m.put(it.uri.toString(), it);
                j.put(new JSONObject().put("n", it.nome).put("u", it.uri.toString()).put("t", it.tamanho).put("c", it.caminho).put("r", true));
            }
        } catch (Exception e) { /* JSONObject só reclama de número inválido */ }
        porUri = m;
        return j.toString();
    }

    private static boolean ehPdf(String nome) { return nome.toLowerCase().endsWith(".pdf"); }

    private static void varrer(ContentResolver cr, Uri t, String doc, String caminho, int prof, List<Item> l) {
        Uri filhos = DocumentsContract.buildChildDocumentsUriUsingTree(t, doc);
        Cursor c = null;
        try {
            c = cr.query(filhos, new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                    DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_SIZE}, null, null, null);
            while (c != null && c.moveToNext()) {
                String id = c.getString(0), nome = c.getString(1), mime = c.getString(2);
                if (nome == null || nome.startsWith(".")) continue;
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                    if (prof < 3) varrer(cr, t, id, caminho + nome + "/", prof + 1, l);
                } else if (ehPdf(nome)) {
                    l.add(new Item(nome, DocumentsContract.buildDocumentUriUsingTree(t, id), c.isNull(3) ? -1 : c.getLong(3), caminho + nome));
                }
            }
        } catch (Exception e) {
            /* subpasta que não deixa ler: fica de fora */
        } finally {
            if (c != null) c.close();
        }
    }

    private static void varrerArquivos(File dir, String caminho, List<Item> l) {
        File[] fs = dir.listFiles();
        if (fs == null) return;
        for (File f : fs) {
            if (f.getName().startsWith(".")) continue;
            if (f.isDirectory()) varrerArquivos(f, caminho + f.getName() + "/", l);
            else if (ehPdf(f.getName())) l.add(new Item(f.getName(), Uri.fromFile(f), f.length(), caminho + f.getName()));
        }
    }

    /** Copia um PDF de fora (Abrir com, Compartilhar, ➕ PDF) pra recebidos/. Devolve o arquivo (null = não deu). */
    File copiarDeFora(Uri u) {
        String nome = null;
        Cursor c = null;
        try {
            c = a.getContentResolver().query(u, new String[]{android.provider.OpenableColumns.DISPLAY_NAME}, null, null, null);
            if (c != null && c.moveToFirst()) nome = c.getString(0);
        } catch (Exception e) { /* sem nome */ } finally { if (c != null) c.close(); }
        if (nome == null) nome = u.getLastPathSegment();
        nome = Sincronia.limpo(nome == null ? "livro.pdf" : nome);
        if (!ehPdf(nome)) nome = nome + ".pdf";
        File f = new File(recebidos, nome);
        try {
            InputStream in = a.getContentResolver().openInputStream(u);
            Sincronia.gravar(in, f, -1);
            return f;
        } catch (Exception e) {
            f.delete();
            return null;
        }
    }

    /** Responde o pedido da página por um arquivo, inteiro ou o pedaço do cabeçalho Range ("bytes=ini-fim"). */
    WebResourceResponse servir(Uri pedido, Map<String, String> cabecalhos) {
        Item it = porUri.get(pedido.getQueryParameter("u"));
        if (it == null) return vazio(404, "Not Found");
        try {
            final ParcelFileDescriptor pfd = a.getContentResolver().openFileDescriptor(it.uri, "r");
            long tam = it.tamanho >= 0 ? it.tamanho : pfd.getStatSize();
            long ini = 0, fim = tam - 1;
            String rg = null;
            for (Map.Entry<String, String> e : cabecalhos.entrySet()) if ("range".equalsIgnoreCase(e.getKey())) rg = e.getValue();
            boolean parte = rg != null && rg.startsWith("bytes=");
            if (parte) {
                String[] ab = rg.substring(6).split("-", -1);
                if (!ab[0].isEmpty()) ini = Long.parseLong(ab[0].trim());
                if (ab.length > 1 && !ab[1].isEmpty()) fim = Math.min(fim, Long.parseLong(ab[1].trim()));
                if (ab[0].isEmpty() && ab.length > 1) { ini = Math.max(0, tam - Long.parseLong(ab[1].trim())); fim = tam - 1; }   // "bytes=-500": os últimos 500
            }
            FileInputStream in = new FileInputStream(pfd.getFileDescriptor());
            try { in.getChannel().position(ini); } catch (Exception e) { long s = ini; while (s > 0) { long k = in.skip(s); if (k <= 0) break; s -= k; } }
            final long total = Math.max(0, fim - ini + 1);
            InputStream corpo = new FilterInputStream(in) {
                long falta = total;
                @Override public int read() throws IOException { if (falta <= 0) return -1; int b = super.read(); if (b >= 0) falta--; return b; }
                @Override public int read(byte[] b, int o, int n) throws IOException {
                    if (falta <= 0) return -1;
                    int k = super.read(b, o, (int) Math.min(n, falta));
                    if (k > 0) falta -= k;
                    return k;
                }
                @Override public void close() throws IOException { super.close(); pfd.close(); }
            };
            Map<String, String> h = new HashMap<String, String>();
            h.put("Accept-Ranges", "bytes");
            h.put("Content-Length", String.valueOf(total));
            h.put("Cache-Control", "no-store");
            if (parte) h.put("Content-Range", "bytes " + ini + "-" + fim + "/" + tam);
            return new WebResourceResponse("application/pdf", null, parte ? 206 : 200, parte ? "Partial Content" : "OK", h, corpo);
        } catch (Exception e) {
            return vazio(500, "Erro");
        }
    }

    private static WebResourceResponse vazio(int codigo, String motivo) {
        return new WebResourceResponse("text/plain", "utf-8", codigo, motivo, new HashMap<String, String>(), new ByteArrayInputStream(new byte[0]));
    }
}
