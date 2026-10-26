"""Desenha o ícone do app (três livros na estante, nas cores café do KOFstation) em todos os tamanhos do Android.
Uso: icone.py <pasta res>"""
import os
import sys
from PIL import Image, ImageDraw

def icone(n):
    k = n / 192
    im = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, n - 1, n - 1], radius=int(40 * k), fill=(43, 29, 20, 255))
    # estante
    d.rectangle([int(26 * k), int(150 * k), int(166 * k), int(160 * k)], fill=(111, 78, 55, 255))
    # livros
    d.rounded_rectangle([int(38 * k), int(44 * k), int(72 * k), int(150 * k)], radius=int(5 * k), fill=(192, 133, 82, 255))
    d.rectangle([int(38 * k), int(64 * k), int(72 * k), int(70 * k)], fill=(43, 29, 20, 255))
    d.rounded_rectangle([int(78 * k), int(58 * k), int(108 * k), int(150 * k)], radius=int(5 * k), fill=(217, 185, 155, 255))
    d.rectangle([int(78 * k), int(120 * k), int(108 * k), int(126 * k)], fill=(111, 78, 55, 255))
    livro = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    ImageDraw.Draw(livro).rounded_rectangle([int(118 * k), int(48 * k), int(150 * k), int(150 * k)], radius=int(5 * k), fill=(160, 97, 47, 255))
    livro = livro.rotate(-12, center=(int(118 * k), int(150 * k)), resample=Image.BICUBIC)
    im.alpha_composite(livro)
    return im

for d, n in (("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)):
    os.makedirs(f"{sys.argv[1]}/mipmap-{d}", exist_ok=True)
    icone(n).save(f"{sys.argv[1]}/mipmap-{d}/ic_launcher.png")
