"""Gera mangás de teste (.cbz e .cbr) com páginas desenhadas: número grande, quadros, borda branca e uma página dupla.
Uso: gerar-mangas.py <pasta>   (o .cbr só sai se o comando rar existir)"""
import io
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from PIL import Image, ImageDraw, ImageFont

def pagina(n, larga=False, cor=False):
    w, h = (1200, 900) if larga else (600, 900)
    im = Image.new("RGB", (w, h), "white")
    d = ImageDraw.Draw(im)
    m = 50   # borda branca (pro "cortar bordas")
    d.rectangle([m, m, w - m, h - m], outline="black", width=6)
    d.line([m, h // 2, w - m, h // 2], fill="black", width=5)
    d.line([w // 2, m, w // 2, h // 2], fill="black", width=5)
    if cor:
        d.ellipse([m + 30, h // 2 + 40, m + 230, h // 2 + 240], fill=(220, 40, 40))
    try:
        f = ImageFont.truetype("DejaVuSans-Bold.ttf", 220)
    except OSError:
        f = ImageFont.load_default()
    d.text((w // 2, h * 3 // 4), str(n), fill="black", font=f, anchor="mm")
    return im

def salvar(im, fmt):
    b = io.BytesIO()
    im.save(b, fmt, quality=85)
    return b.getvalue()

def cbz(caminho, n, larga=0, comprimir=True):
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    with zipfile.ZipFile(caminho, "w", zipfile.ZIP_DEFLATED if comprimir else zipfile.ZIP_STORED) as z:
        for i in range(1, n + 1):
            # nomes que só ordenam certo com ordem natural (p2 antes de p10)
            z.writestr(f"pag{i}.{'png' if i % 2 else 'jpg'}", salvar(pagina(i, larga == i, cor=i == 2), "PNG" if i % 2 else "JPEG"))
        z.writestr("info.txt", "não é imagem")

pasta = sys.argv[1]
cbz(f"{pasta}/Mangas/One Piece/One Piece v01 c001.cbz", 12, larga=6)
cbz(f"{pasta}/Mangas/One Piece/One Piece v01 c002.cbz", 6, comprimir=False)
cbz(f"{pasta}/Mangas/Berserk - Cap. 1.cbz", 4)
if shutil.which("rar"):
    with tempfile.TemporaryDirectory() as t:
        for i in range(1, 6):
            pagina(i).save(f"{t}/{i:02d}.jpg", quality=85)
        destino = os.path.abspath(f"{pasta}/Mangas/One Piece/One Piece v01 c003.cbr")
        if os.path.exists(destino):
            os.remove(destino)
        subprocess.run(["rar", "a", "-ep", "-idq", destino] + [f"{t}/{i:02d}.jpg" for i in range(1, 6)], check=True)
