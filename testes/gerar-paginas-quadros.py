"""Gera páginas de mangá sintéticas e difíceis, com o gabarito dos quadros (ordem japonesa), pro teste do quadro a
quadro: grade, fileiras desiguais, balão atravessando a calha, quadro sem borda, calha inclinada, página inteira e
página de fundo preto. Saída: <pasta>/paginaNN.png + gabarito.json
  {arquivo: {quadros: [[x0,y0,x1,y1] em ordem], aceita_junto: bool}}
Uso: gerar-paginas-quadros.py <pasta>"""
import json
import os
import random
import sys
from PIL import Image, ImageDraw

W, H = 900, 1300
random.seed(7)
pasta = sys.argv[1]
os.makedirs(pasta, exist_ok=True)
gab = {}


def arte(d, x0, y0, x1, y1, escuro=False):
    """desenho dentro do quadro: formas, retícula (pontinhos) e um balão de fala"""
    tinta = 255 if escuro else 0
    for _ in range(6):
        a, b = random.randint(x0, x1 - 20), random.randint(y0, y1 - 20)
        c, e = min(x1 - 4, a + random.randint(20, 160)), min(y1 - 4, b + random.randint(20, 160))
        if random.random() < .5:
            d.ellipse([a, b, c, e], outline=tinta, width=3)
        else:
            d.line([a, b, c, e], fill=tinta, width=4)
    for yy in range(y0 + 10, y1 - 10, 9):   # retícula num canto
        for xx in range(x0 + 10, min(x1 - 10, x0 + 140), 9):
            d.ellipse([xx, yy, xx + 3, yy + 3], fill=150)
        if yy > y0 + 120:
            break
    bx, by = random.randint(x0 + 10, max(x0 + 11, x1 - 140)), random.randint(y0 + 10, max(y0 + 11, y1 - 90))
    d.ellipse([bx, by, bx + 120, by + 70], fill=255 if not escuro else 0, outline=tinta, width=3)


def quadro(d, r, borda=True, escuro=False):
    if borda:
        d.rectangle(r, outline=255 if escuro else 0, width=5)
    arte(d, r[0] + 6, r[1] + 6, r[2] - 6, r[3] - 6, escuro)


def salvar(nome, im, quadros, junto=False):
    im.save(os.path.join(pasta, nome))
    gab[nome] = {"quadros": quadros, "aceita_junto": junto}


m, g = 40, 22   # margem e calha
# 1. grade 3x2 (ordem japonesa: direita->esquerda em cada fileira)
im = Image.new("L", (W, H), 255); d = ImageDraw.Draw(im); q = []
alt = (H - 2 * m - 2 * g) // 3; larg = (W - 2 * m - g) // 2
for f in range(3):
    for c in (1, 0):
        r = [m + c * (larg + g), m + f * (alt + g), m + c * (larg + g) + larg, m + f * (alt + g) + alt]
        quadro(d, r); q.append(r)
salvar("pagina01.png", im, q)
# 2. fileiras desiguais: 1 / 3 / 2
im = Image.new("L", (W, H), 255); d = ImageDraw.Draw(im); q = []
y = m
for n, a in ((1, 330), (3, 360), (2, H - 2 * m - 2 * g - 330 - 360)):
    larg = (W - 2 * m - (n - 1) * g) // n
    for c in reversed(range(n)):
        r = [m + c * (larg + g), y, m + c * (larg + g) + larg, y + a]
        quadro(d, r); q.append(r)
    y += a + g
salvar("pagina02.png", im, q)
# 3. balão atravessando a calha entre dois quadros da mesma fileira (tem que cortar mesmo assim: rabinho pequeno)
im = Image.new("L", (W, H), 255); d = ImageDraw.Draw(im); q = []
a = (H - 2 * m - g) // 2; larg = (W - 2 * m - g) // 2
for f in range(2):
    for c in (1, 0):
        r = [m + c * (larg + g), m + f * (a + g), m + c * (larg + g) + larg, m + f * (a + g) + a]
        quadro(d, r); q.append(r)
cx = m + larg + g // 2
d.line([cx - 30, m + 200, cx + 30, m + 215], fill=0, width=3)   # rabinho do balão por cima da calha
salvar("pagina03.png", im, q)
# 4. quadros sem borda (só o desenho), em grade 2x2
im = Image.new("L", (W, H), 255); d = ImageDraw.Draw(im); q = []
for f in range(2):
    for c in (1, 0):
        r = [m + c * (larg + g + 10), m + f * (a + g + 10), m + c * (larg + g + 10) + larg - 10, m + f * (a + g + 10) + a - 10]
        d.rectangle([r[0] + 20, r[1] + 20, r[2] - 20, r[3] - 20], fill=200)   # o "fundo" do desenho, sem traço de borda
        arte(d, r[0] + 20, r[1] + 20, r[2] - 20, r[3] - 20)
        q.append([r[0] + 20, r[1] + 20, r[2] - 20, r[3] - 20])
salvar("pagina04.png", im, q)
# 5. calha inclinada entre duas fileiras (o XY-cut não corta: aceita os quadros juntos)
im = Image.new("L", (W, H), 255); d = ImageDraw.Draw(im)
d.polygon([(m, m), (W - m, m), (W - m, 560), (m, 700)], outline=0, width=5)
d.polygon([(m, 730), (W - m, 590), (W - m, H - m), (m, H - m)], outline=0, width=5)
arte(d, m + 20, m + 20, W - m - 20, 520); arte(d, m + 20, 760, W - m - 20, H - m - 20)
salvar("pagina05.png", im, [[m, m, W - m, 700], [m, 590, W - m, H - m]], junto=True)
# 6. página inteira (splash): um quadro só
im = Image.new("L", (W, H), 255); d = ImageDraw.Draw(im)
quadro(d, [m, m, W - m, H - m])
salvar("pagina06.png", im, [[m, m, W - m, H - m]])
# 7. página de fundo preto (lembrança/flashback): calhas pretas, quadros com traço branco
im = Image.new("L", (W, H), 0); d = ImageDraw.Draw(im); q = []
a = (H - 2 * m - 2 * g) // 3
for f in range(3):
    r = [m, m + f * (a + g), W - m, m + f * (a + g) + a]
    d.rectangle(r, fill=40); quadro(d, r, escuro=True); q.append(r)
salvar("pagina07.png", im, q)
json.dump(gab, open(os.path.join(pasta, "gabarito.json"), "w"), indent=1)
print(f"{len(gab)} páginas em {pasta}")
