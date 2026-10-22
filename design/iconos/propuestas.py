"""Propuestas de icono para Clinómetro Solar (dibujo vectorial simple, renderizado a PNG)."""
import math
from PIL import Image, ImageDraw, ImageFont

S = 2048                      # lienzo de trabajo (se reduce con antialias)
ORANGE, ORANGE2 = (246, 128, 44), (255, 166, 77)
NAVY, NAVY2, INK = (19, 32, 52), (33, 54, 86), (12, 20, 33)
CREAM, WHITE, SKY = (247, 243, 236), (255, 255, 255), (96, 156, 230)

def canvas(bg):
    im = Image.new("RGBA", (S, S), bg + (255,)); return im, ImageDraw.Draw(im)
def grad(c1, c2, vertical=True):
    g = Image.new("RGBA", (1, 256) if vertical else (256, 1))
    for i in range(256):
        t = i / 255; c = tuple(round(c1[k] + (c2[k] - c1[k]) * t) for k in range(3)) + (255,)
        g.putpixel((0, i) if vertical else (i, 0), c)
    return g.resize((S, S))
def circle(d, cx, cy, r, **kw): d.ellipse([cx - r, cy - r, cx + r, cy + r], **kw)

def A():   # Sol tras el horizonte: sol grande medio oculto por un perfil escalonado
    im = grad(NAVY2, NAVY); d = ImageDraw.Draw(im)
    sun = grad(ORANGE2, ORANGE); m = Image.new("L", (S, S), 0); circle(ImageDraw.Draw(m), S * .58, S * .56, S * .25, fill=255)
    im.paste(sun, (0, 0), m)
    d.polygon([(0, S), (0, S * .62), (S * .30, S * .62), (S * .30, S * .50), (S * .52, S * .50), (S * .52, S * .66), (S, S * .66), (S, S)], fill=INK)
    return im
def B():   # Arco: una sola trayectoria y el sol sobre ella, línea de horizonte con obstáculo
    im, d = canvas(WHITE)
    w = int(S * .075); box = [S * .18, S * .26, S * .82, S * .98]
    d.arc(box, 180, 360, fill=ORANGE, width=w)
    a = math.radians(-50); cx, cy = S * .5 + S * .32 * math.cos(a), S * .62 + S * .36 * math.sin(a)
    circle(d, cx, cy, S * .085, fill=ORANGE, outline=WHITE, width=int(S * .03))
    d.rectangle([S * .14, S * .62, S * .86, S * .62 + w], fill=NAVY)
    d.rectangle([S * .24, S * .47, S * .40, S * .62 + w], fill=NAVY)
    return im
def C():   # Eclipse geométrico: círculo naranja recortado por un bloque
    im, d = canvas(CREAM)
    circle(d, S * .54, S * .46, S * .27, fill=ORANGE)
    d.rectangle([S * .22, S * .52, S * .56, S * .80], fill=NAVY)
    d.rectangle([S * .56, S * .66, S * .80, S * .80], fill=NAVY)
    return im
def D():   # Retícula solar: el sol dentro de la mira del instrumento
    im = grad(NAVY2, INK); d = ImageDraw.Draw(im)
    c, r = S / 2, S * .17; lw = int(S * .028)
    circle(d, c, c, S * .30, outline=(255, 255, 255, 70), width=lw)
    for dx, dy in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
        d.line([(c + dx * S * .21, c + dy * S * .21), (c + dx * S * .38, c + dy * S * .38)], fill=WHITE, width=lw)
    sun = grad(ORANGE2, ORANGE); m = Image.new("L", (S, S), 0); circle(ImageDraw.Draw(m), c, c, r, fill=255); im.paste(sun, (0, 0), m)
    return im
def E():   # Clinómetro: cuadrante con el ángulo de elevación hasta el sol
    im = grad(NAVY2, NAVY); d = ImageDraw.Draw(im)
    ox, oy, R = S * .24, S * .76, S * .56
    lay = Image.new("RGBA", (S, S), (0, 0, 0, 0)); ImageDraw.Draw(lay).pieslice([ox - R, oy - R, ox + R, oy + R], 270, 360, fill=(255, 255, 255, 30))
    im.alpha_composite(lay); d = ImageDraw.Draw(im)
    d.arc([ox - R, oy - R, ox + R, oy + R], 270, 360, fill=WHITE, width=int(S * .02))
    d.line([(ox, oy), (ox + R, oy)], fill=WHITE, width=int(S * .028))
    a = math.radians(-38); ex, ey = ox + R * .86 * math.cos(a), oy + R * .86 * math.sin(a)
    d.line([(ox, oy), (ex, ey)], fill=ORANGE, width=int(S * .045))
    d.arc([ox - R * .32, oy - R * .32, ox + R * .32, oy + R * .32], 322, 360, fill=ORANGE2, width=int(S * .03))
    circle(d, ex, ey, S * .085, fill=ORANGE)
    return im
def F():   # Gnomon: un bloque y la sombra que proyecta, con el sol al fondo
    im = grad((132, 186, 240), (226, 238, 250)); d = ImageDraw.Draw(im)
    circle(d, S * .70, S * .30, S * .12, fill=ORANGE)
    base = S * .72
    d.polygon([(S * .36, base), (S * .36, S * .40), (S * .48, S * .40), (S * .48, base)], fill=NAVY)
    d.polygon([(S * .36, base), (S * .48, base), (S * .08, S * .90), (0, S * .90), (0, S * .86)], fill=(19, 32, 52, 255))
    d.rectangle([0, base, S, S], fill=(200, 214, 230))
    d.polygon([(S * .36, base), (S * .48, base), (S * .02, S), (-S * .1, S)], fill=(70, 92, 122))
    d.rectangle([S * .36, S * .40, S * .48, base], fill=NAVY)
    return im

PROPS = [("A", "Sol tras el horizonte", A), ("B", "Trayectoria", B), ("C", "Eclipse", C),
         ("D", "Mira solar", D), ("E", "Clinómetro", E), ("F", "Gnomon y sombra", F)]

def squircle(im, size):
    im = im.resize((size, size), Image.LANCZOS)
    m = Image.new("L", (size * 4, size * 4), 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, size * 4 - 1, size * 4 - 1], int(size * 4 * .23), fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0)); out.paste(im, (0, 0), m.resize((size, size), Image.LANCZOS)); return out

if __name__ == "__main__":
    import sys, os
    out = sys.argv[1]; os.makedirs(out, exist_ok=True)
    try: font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 30); small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 24)
    except Exception: font = small = ImageFont.load_default()
    cols, cw, ch = 3, 520, 470
    sheet = Image.new("RGB", (cols * cw, 2 * ch), (236, 239, 243)); sd = ImageDraw.Draw(sheet)
    for i, (k, name, fn) in enumerate(PROPS):
        art = fn(); art.convert("RGB").resize((1024, 1024), Image.LANCZOS).save(f"{out}/icono-{k}.png")
        x0, y0 = (i % cols) * cw, (i // cols) * ch
        sd.rounded_rectangle([x0 + 20, y0 + 20, x0 + cw - 20, y0 + ch - 20], 28, fill=(255, 255, 255))
        sheet.paste(squircle(art, 240), (x0 + 40, y0 + 60), squircle(art, 240))
        # en fondo oscuro y a tamaño real de pantalla de inicio
        sd.rounded_rectangle([x0 + 310, y0 + 60, x0 + cw - 40, y0 + 300], 22, fill=(28, 32, 40))
        sheet.paste(squircle(art, 96), (x0 + 345, y0 + 90), squircle(art, 96))
        sheet.paste(squircle(art, 48), (x0 + 365, y0 + 215), squircle(art, 48))
        sd.text((x0 + 40, y0 + 330), k + ". " + name, fill=(18, 27, 38), font=font)
    sheet.save(f"{out}/propuestas.png")
    print("ok")
