"""Variaciones de la propuesta C (sol recortado por un bloque)."""
import sys, os
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, os.path.dirname(__file__))
from propuestas import S, ORANGE, ORANGE2, NAVY, NAVY2, INK, CREAM, WHITE, canvas, grad, circle, squircle

AMBER = (255, 184, 77)
def sun_grad(cx, cy, r, c1=ORANGE2, c2=ORANGE):
    m = Image.new("L", (S, S), 0); circle(ImageDraw.Draw(m), cx, cy, r, fill=255); return grad(c1, c2), m

def C1():   # original
    im, d = canvas(CREAM)
    circle(d, S*.54, S*.46, S*.27, fill=ORANGE)
    d.rectangle([S*.22, S*.52, S*.56, S*.80], fill=NAVY); d.rectangle([S*.56, S*.66, S*.80, S*.80], fill=NAVY)
    return im
def C2():   # fondo azul noche, bloque crema
    im = grad(NAVY2, NAVY); d = ImageDraw.Draw(im)
    g, m = sun_grad(S*.54, S*.46, S*.27); im.paste(g, (0, 0), m)
    d.rectangle([S*.22, S*.52, S*.56, S*.80], fill=CREAM); d.rectangle([S*.56, S*.66, S*.80, S*.80], fill=CREAM)
    return im
def C3():   # fondo naranja, sol crema, bloque azul
    im = grad(ORANGE2, ORANGE); d = ImageDraw.Draw(im)
    circle(d, S*.54, S*.46, S*.27, fill=CREAM)
    d.rectangle([S*.22, S*.52, S*.56, S*.80], fill=NAVY); d.rectangle([S*.56, S*.66, S*.80, S*.80], fill=NAVY)
    return im
def C4():   # un solo bloque, sol más grande y centrado
    im, d = canvas(CREAM)
    g, m = sun_grad(S*.50, S*.45, S*.30); im.paste(g, (0, 0), m)
    d.rectangle([S*.20, S*.54, S*.58, S*.80], fill=NAVY)
    return im
def C5():   # solo el sol con el mordisco del bloque (espacio negativo)
    im = grad(NAVY2, NAVY); d = ImageDraw.Draw(im)
    g, m = sun_grad(S*.54, S*.46, S*.29); md = ImageDraw.Draw(m)
    md.rectangle([0, S*.53, S*.58, S], fill=0); md.rectangle([S*.58, S*.67, S, S], fill=0)
    im.paste(g, (0, 0), m)
    return im
def C6():   # con línea de horizonte de lado a lado
    im, d = canvas(CREAM)
    circle(d, S*.56, S*.44, S*.25, fill=ORANGE)
    d.rectangle([S*.26, S*.48, S*.54, S*.72], fill=NAVY); d.rectangle([S*.54, S*.60, S*.74, S*.72], fill=NAVY)
    d.rectangle([S*.12, S*.72, S*.88, S*.75], fill=NAVY)
    return im
def C7():   # perfil de dos alturas, sol detrás
    im, d = canvas(CREAM)
    circle(d, S*.56, S*.44, S*.26, fill=ORANGE)
    d.rectangle([S*.20, S*.56, S*.40, S*.80], fill=NAVY); d.rectangle([S*.40, S*.46, S*.58, S*.80], fill=NAVY); d.rectangle([S*.58, S*.64, S*.80, S*.80], fill=NAVY)
    return im
def C8():   # bloque separado del sol por un filete del color del fondo
    im, d = canvas(CREAM)
    circle(d, S*.54, S*.46, S*.27, fill=ORANGE)
    gap = S*.03
    d.rectangle([S*.22-gap, S*.52-gap, S*.56+gap, S*.80], fill=CREAM); d.rectangle([S*.56, S*.66-gap, S*.80+gap, S*.80], fill=CREAM)
    d.rectangle([S*.22, S*.52, S*.56, S*.80], fill=NAVY); d.rectangle([S*.56, S*.66, S*.80, S*.80], fill=NAVY)
    return im
def C9():   # formas suavizadas (esquinas redondeadas), fondo blanco
    im, d = canvas(WHITE)
    g, m = sun_grad(S*.54, S*.46, S*.27, AMBER, ORANGE); im.paste(g, (0, 0), m)
    r = int(S*.035)
    d.rounded_rectangle([S*.22, S*.52, S*.56, S*.80], r, fill=NAVY); d.rounded_rectangle([S*.50, S*.66, S*.80, S*.80], r, fill=NAVY)
    return im

VARS = [("C1", "Original", C1), ("C2", "Noche", C2), ("C3", "Fondo naranja", C3),
        ("C4", "Un solo bloque", C4), ("C5", "Solo el recorte", C5), ("C6", "Con horizonte", C6),
        ("C7", "Perfil de tres alturas", C7), ("C8", "Con filete", C8), ("C9", "Suavizado", C9)]

if __name__ == "__main__":
    out = sys.argv[1]; os.makedirs(out, exist_ok=True)
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 28)
    cols, cw, ch = 3, 520, 400
    sheet = Image.new("RGB", (cols * cw, 3 * ch), (236, 239, 243)); sd = ImageDraw.Draw(sheet)
    for i, (k, name, fn) in enumerate(VARS):
        art = fn(); art.convert("RGB").resize((1024, 1024), Image.LANCZOS).save(f"{out}/icono-{k}.png")
        x0, y0 = (i % cols) * cw, (i // cols) * ch
        sd.rounded_rectangle([x0 + 20, y0 + 20, x0 + cw - 20, y0 + ch - 20], 28, fill=(255, 255, 255))
        sheet.paste(squircle(art, 220), (x0 + 40, y0 + 50), squircle(art, 220))
        sd.rounded_rectangle([x0 + 290, y0 + 50, x0 + cw - 40, y0 + 270], 22, fill=(28, 32, 40))
        sheet.paste(squircle(art, 96), (x0 + 327, y0 + 72), squircle(art, 96))
        sheet.paste(squircle(art, 48), (x0 + 351, y0 + 196), squircle(art, 48))
        sd.text((x0 + 40, y0 + 300), k + " · " + name, fill=(18, 27, 38), font=font)
    sheet.save(f"{out}/variantes_c.png"); print("ok")
