"""Gera um PDF "escaneado": cada página é uma imagem JPEG 2000 (/JPXDecode), como em livro digitalizado.
Uso: gerar-escaneado.py <saida.pdf>"""
import io
import sys
from PIL import Image, ImageDraw, ImageFont

def pagina(n):
    im = Image.new("L", (1240, 1754), 235)   # papel amarelado/cinza de scan
    d = ImageDraw.Draw(im)
    try:
        f = ImageFont.truetype("DejaVuSerif.ttf", 34)
        g = ImageFont.truetype("DejaVuSerif-Bold.ttf", 70)
    except OSError:
        f = g = ImageFont.load_default()
    d.text((140, 160), f"Capítulo {n}", fill=20, font=g)
    for i in range(30):
        d.text((140, 300 + i * 44), "Texto de livro escaneado em JPEG 2000, linha %d da página %d." % (i + 1, n), fill=30, font=f)
    b = io.BytesIO()
    im.save(b, "JPEG2000", quality_mode="dB", quality_layers=[38])
    return im.size, b.getvalue()

objs, paginas = [], []
def obj(conteudo):
    objs.append(conteudo)
    return len(objs)
catalogo = obj(None); arvore = obj(None)
for n in range(1, 4):
    (w, h), jp2 = pagina(n)
    img = obj(b"<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /JPXDecode /Length %d >>\nstream\n" % (w, h, len(jp2)) + jp2 + b"\nendstream")
    desenho = b"q 595 0 0 842 0 0 cm /Im0 Do Q"
    cont = obj(b"<< /Length %d >>\nstream\n" % len(desenho) + desenho + b"\nendstream")
    paginas.append(obj(b"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 %d 0 R >> >> /Contents %d 0 R >>" % (arvore, img, cont)))
objs[catalogo - 1] = b"<< /Type /Catalog /Pages %d 0 R >>" % arvore
objs[arvore - 1] = b"<< /Type /Pages /Kids [%s] /Count %d >>" % (b" ".join(b"%d 0 R" % p for p in paginas), len(paginas))
saida = io.BytesIO(); saida.write(b"%PDF-1.5\n")
pos = []
for i, o in enumerate(objs, 1):
    pos.append(saida.tell()); saida.write(b"%d 0 obj\n" % i + o + b"\nendobj\n")
xref = saida.tell()
saida.write(b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1) + b"".join(b"%010d 00000 n \n" % p for p in pos))
saida.write(b"trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, catalogo, xref))
open(sys.argv[1], "wb").write(saida.getvalue())
