package dev.koflibrary.android;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.Map;
import java.util.Random;

/**
 * O celular recebe os livros e o progresso do PC pela rede de casa (nada passa pela internet). Um servidor HTTP
 * mínimo na porta 8643; a página do KOFlibrary no PC chama, sempre com o cabeçalho X-Kof-Senha:
 *   GET  /oi                          -> {"nome": "<celular>", "versao": "..."}
 *   POST /sincronizar  (JSON)         -> a página do celular junta os registros (progresso, notas, marcadores) e
 *                                        devolve os dela + quais livros ela tem o arquivo
 *   PUT  /livro?nome=&estante=&tamanho=  (o PDF)  -> grava em recebidos/<estante>/<nome>
 * Quem junta os registros é a página (o banco dela fica no IndexedDB da WebView): o servidor só repassa (Pagina).
 * GET / sem senha responde uma página "celular achado" (pra testar a rede pelo navegador do PC). Sem nada de Android
 * dentro: dá pra testar no Linux (testes/sincronia.cjs).
 */
final class Sincronia {
    static final int PORTA = 8643;

    /** O lado da página do celular. */
    interface Pagina {
        /** Junta os registros que o PC mandou e devolve a resposta (JSON). Pode demorar: roda fora da linha da tela. */
        String sincronizar(String json) throws Exception;
        /** Um livro novo chegou em recebidos/: a página lista de novo. */
        void livroChegou(String nome);
        String nome();
        String versao();
    }

    private final ServerSocket servidor;
    private final File recebidos;
    private final Pagina pagina;
    final String senha;
    final int porta;
    volatile String ultimoPc = "";
    volatile long ultimaVez = 0;

    Sincronia(String senha, int porta, File recebidos, Pagina pagina) throws IOException {
        this.senha = senha; this.recebidos = recebidos; this.pagina = pagina;
        ServerSocket s;
        try { s = new ServerSocket(porta); } catch (IOException e) { s = new ServerSocket(0); }   // porta ocupada: qualquer uma
        servidor = s; this.porta = s.getLocalPort();
        Thread t = new Thread(new Runnable() { public void run() { aceitar(); } }, "KOFsincronia");
        t.setDaemon(true); t.start();
    }

    static String novaSenha() { return String.format("%04d", new Random().nextInt(10000)); }

    void parar() { try { servidor.close(); } catch (Exception e) { /* já fechado */ } }

    private void aceitar() {
        while (!servidor.isClosed()) {
            try {
                final Socket c = servidor.accept();
                Thread t = new Thread(new Runnable() { public void run() { atender(c); } }, "KOFsincronia-pc");
                t.setDaemon(true); t.start();
            } catch (Exception e) { /* servidor fechado */ }
        }
    }

    private void atender(Socket c) {
        try {
            c.setSoTimeout(60000);
            InputStream in = c.getInputStream();
            String primeira = linha(in);
            String[] pr = primeira.split(" ");
            if (pr.length < 2) return;
            String metodo = pr[0], alvo = pr[1];
            Map<String, String> cab = new HashMap<String, String>();
            for (String l; !(l = linha(in)).isEmpty(); ) {
                int k = l.indexOf(':');
                if (k > 0) cab.put(l.substring(0, k).trim().toLowerCase(), l.substring(k + 1).trim());
            }
            String caminho = alvo.contains("?") ? alvo.substring(0, alvo.indexOf('?')) : alvo;
            Map<String, String> q = consulta(alvo);
            long tam = cab.containsKey("content-length") ? Long.parseLong(cab.get("content-length")) : 0;
            if (metodo.equals("OPTIONS")) { responder(c, 204, "text/plain", new byte[0]); return; }
            if (metodo.equals("GET") && caminho.equals("/")) { responder(c, 200, "text/html; charset=utf-8", achado().getBytes("UTF-8")); return; }
            if (!senha.equals(cab.get("x-kof-senha"))) { responder(c, 403, "text/plain", "senha errada".getBytes("UTF-8")); return; }
            ultimaVez = System.currentTimeMillis();
            if (cab.containsKey("x-kof-pc")) ultimoPc = URLDecoder.decode(cab.get("x-kof-pc"), "UTF-8");
            if (metodo.equals("GET") && caminho.equals("/oi")) {
                String j = "{\"nome\":" + json(pagina.nome()) + ",\"versao\":" + json(pagina.versao()) + "}";
                responder(c, 200, "application/json", j.getBytes("UTF-8"));
            } else if (metodo.equals("POST") && caminho.equals("/sincronizar")) {
                if (tam > 64L << 20) { responder(c, 413, "text/plain", new byte[0]); return; }
                String corpo = new String(lerTudo(in, (int) tam), "UTF-8");
                responder(c, 200, "application/json", pagina.sincronizar(corpo).getBytes("UTF-8"));
            } else if (metodo.equals("PUT") && caminho.equals("/livro")) {
                String nome = limpo(q.get("nome")), estante = q.containsKey("estante") ? limpo(q.get("estante")) : "";
                if (nome.isEmpty() || !nome.toLowerCase().endsWith(".pdf")) { responder(c, 400, "text/plain", "nome".getBytes("UTF-8")); return; }
                File dir = estante.isEmpty() ? recebidos : new File(recebidos, estante);
                dir.mkdirs();
                gravar(in, new File(dir, nome), tam);
                responder(c, 200, "application/json", "{\"ok\":true}".getBytes("UTF-8"));
                pagina.livroChegou(nome);
            } else {
                responder(c, 404, "text/plain", new byte[0]);
            }
        } catch (Exception e) {
            try { responder(c, 500, "text/plain", String.valueOf(e.getMessage()).getBytes("UTF-8")); } catch (Exception x) { /* caiu */ }
        } finally {
            try { c.close(); } catch (Exception e) { /* já fechado */ }
        }
    }

    /** Nome de arquivo/pasta sem barra nem "..": o PC não escolhe onde gravar fora de recebidos/. */
    static String limpo(String s) {
        if (s == null) return "";
        String r = s.replace('/', '_').replace('\\', '_').replace("\0", "").trim();
        while (r.startsWith(".")) r = r.substring(1);
        return r.length() > 180 ? r.substring(r.length() - 180) : r;
    }

    /** Grava o que vem em `in` (tam bytes; -1 = até acabar) num .parte e só no fim troca pro nome certo. */
    static void gravar(InputStream in, File f, long tam) throws IOException {
        File parte = new File(f.getPath() + ".parte");
        OutputStream o = new FileOutputStream(parte);
        long n = 0;
        try {
            byte[] buf = new byte[1 << 16];
            while (tam < 0 || n < tam) {
                int k = in.read(buf, 0, tam < 0 ? buf.length : (int) Math.min(buf.length, tam - n));
                if (k < 0) break;
                o.write(buf, 0, k);
                n += k;
            }
        } finally { o.close(); }
        if (tam >= 0 && n != tam) { parte.delete(); throw new IOException("veio " + n + " de " + tam + " bytes"); }
        f.delete();
        if (!parte.renameTo(f)) { parte.delete(); throw new IOException("não consegui gravar " + f.getName()); }
    }

    private static byte[] lerTudo(InputStream in, int tam) throws IOException {
        ByteArrayOutputStream o = new ByteArrayOutputStream(Math.max(tam, 16));
        byte[] buf = new byte[1 << 16];
        int n = 0;
        while (n < tam) {
            int k = in.read(buf, 0, Math.min(buf.length, tam - n));
            if (k < 0) break;
            o.write(buf, 0, k);
            n += k;
        }
        return o.toByteArray();
    }

    private static Map<String, String> consulta(String alvo) throws Exception {
        Map<String, String> m = new HashMap<String, String>();
        int k = alvo.indexOf('?');
        if (k < 0) return m;
        for (String par : alvo.substring(k + 1).split("&")) {
            int e = par.indexOf('=');
            if (e > 0) m.put(URLDecoder.decode(par.substring(0, e), "UTF-8"), URLDecoder.decode(par.substring(e + 1), "UTF-8"));
        }
        return m;
    }

    private static void responder(Socket c, int codigo, String tipo, byte[] corpo) throws IOException {
        String txt = codigo == 200 ? "OK" : codigo == 204 ? "No Content" : codigo == 403 ? "Forbidden" : codigo == 404 ? "Not Found" : "Erro";
        // o PC fala com o celular de uma página file:// (ou outra origem): libera CORS e a rede local do Chrome
        String cab = "HTTP/1.1 " + codigo + " " + txt + "\r\nContent-Type: " + tipo
            + "\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, PUT, OPTIONS"
            + "\r\nAccess-Control-Allow-Headers: X-Kof-Senha, X-Kof-Pc, Content-Type"
            + "\r\nAccess-Control-Allow-Private-Network: true\r\nAccess-Control-Allow-Local-Network: true"
            + "\r\nAccess-Control-Max-Age: 600\r\nCache-Control: no-store"
            + "\r\nContent-Length: " + corpo.length + "\r\nConnection: close\r\n\r\n";
        OutputStream o = c.getOutputStream();
        o.write(cab.getBytes("UTF-8"));
        o.write(corpo);
        o.flush();
    }

    private String achado() {
        return "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'><title>KOFlibrary</title>"
            + "<body style='font:18px sans-serif;max-width:34em;margin:2em auto;padding:0 1em;background:#1a110b;color:#f3e6d8'>"
            + "<h1>✅ Celular achado</h1><p>O PC enxerga o KOFlibrary do celular (" + esc(pagina.nome()) + ") nesta rede. Volte pro "
            + "KOFlibrary do PC, clique em 📱 e digite o endereço e a senha que aparecem no celular.</p><p>Se esta página abre mas "
            + "o KOFlibrary do PC não conecta, é o navegador bloqueando o acesso à rede local: na janela do KOFlibrary, permita "
            + "\"Dispositivos da rede local\" (no cadeado ao lado do endereço ou quando o navegador perguntar).</p>";
    }

    private static String esc(String s) { return s.replace("&", "&amp;").replace("<", "&lt;"); }

    static String json(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (char ch : s.toCharArray()) {
            if (ch == '"' || ch == '\\') b.append('\\').append(ch);
            else if (ch < 32) b.append(String.format("\\u%04x", (int) ch));
            else b.append(ch);
        }
        return b.append('"').toString();
    }

    private static String linha(InputStream in) throws IOException {
        StringBuilder s = new StringBuilder();
        for (int b; (b = in.read()) >= 0; ) { if (b == '\n') break; if (b != '\r') s.append((char) b); if (s.length() > 8192) break; }
        return s.toString();
    }

    /** O IPv4 da rede de casa (Wi-Fi): prefere a interface wlan, depois qualquer endereço local. */
    static String ipLocal() {
        try {
            String local = null, reserva = null;
            for (Enumeration<NetworkInterface> e = NetworkInterface.getNetworkInterfaces(); e != null && e.hasMoreElements(); ) {
                NetworkInterface ni = e.nextElement();
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (Enumeration<InetAddress> a = ni.getInetAddresses(); a.hasMoreElements(); ) {
                    InetAddress x = a.nextElement();
                    if (!(x instanceof Inet4Address)) continue;
                    if (x.isSiteLocalAddress() && ni.getName().startsWith("wlan")) return x.getHostAddress();
                    if (x.isSiteLocalAddress() && local == null) local = x.getHostAddress();
                    if (reserva == null) reserva = x.getHostAddress();
                }
            }
            return local != null ? local : reserva == null ? "" : reserva;
        } catch (Exception e) { return ""; }
    }

    static boolean redeDeCasa(String ip) {
        try { return !ip.isEmpty() && InetAddress.getByName(ip).isSiteLocalAddress(); } catch (Exception e) { return false; }
    }

    /**
     * Pros testes no Linux: java Sincronia <senha> <porta> <pasta recebidos>. A "página" é quem roda o teste: cada
     * pedido de sincronizar sai no stdout ("SINCRONIZAR <json>") e a resposta volta numa linha do stdin.
     */
    public static void main(String[] a) throws Exception {
        final java.io.BufferedReader entrada = new java.io.BufferedReader(new java.io.InputStreamReader(System.in, "UTF-8"));
        final java.io.PrintStream saida = new java.io.PrintStream(System.out, true, "UTF-8");
        Sincronia s = new Sincronia(a[0], Integer.parseInt(a[1]), new File(a[2]), new Pagina() {
            public synchronized String sincronizar(String json) throws Exception { saida.println("SINCRONIZAR " + json.replace("\n", " ")); return entrada.readLine(); }
            public void livroChegou(String nome) { saida.println("CHEGOU " + nome); }
            public String nome() { return "Celular de teste"; }
            public String versao() { return "teste"; }
        });
        saida.println("porta " + s.porta);
        Thread.sleep(Long.MAX_VALUE);
    }
}
