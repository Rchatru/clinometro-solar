"""Genera el icono y la pantalla de inicio de Clinómetro Solar (Android)."""
import math, os, glob
from PIL import Image, ImageDraw, ImageFilter

BG1, BG2 = (13, 21, 33), (28, 42, 64)
WINTER, MID, SUMMER = (74, 134, 232), (155, 127, 208), (255, 148, 71)
RET = (255, 210, 122)

def lerp(a, b, t): return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))

def art(size, with_bg=True, scale=1.0):
    S = size * 4
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    if with_bg:
        g = Image.new("RGBA", (1, 256))
        for y in range(256): g.putpixel((0, y), lerp(BG2, BG1, y / 255) + (255,))
        im.paste(g.resize((S, S)), (0, 0))
    d = ImageDraw.Draw(im)
    c = S / 2
    k = S * 0.34 * scale          # radio base
    base = c + k * 0.62           # línea de horizonte
    w = max(2, int(S * 0.028 * scale))
    # trayectorias solares: diciembre, equinoccio, junio
    for col, rx, ry in [(WINTER, .62, .55), (MID, .84, .95), (SUMMER, 1.0, 1.32)]:
        box = [c - k * rx, base - k * ry, c + k * rx, base + k * ry]
        d.arc(box, 180, 360, fill=col + (255,), width=w)
    # silueta de obstáculo
    sil = [(c - k * 1.08, base), (c - k * 1.08, base - k * .28), (c - k * .78, base - k * .28), (c - k * .78, base - k * .52),
           (c - k * .40, base - k * .52), (c - k * .40, base - k * .36), (c - k * .12, base - k * .36), (c - k * .12, base)]
    d.polygon(sil, fill=(236, 241, 247, 255))
    d.line([(c - k * 1.15, base), (c + k * 1.15, base)], fill=(236, 241, 247, 255), width=max(2, w // 2))
    # sol sobre la trayectoria de verano, con retícula
    a = math.radians(305)
    sx, sy = c + k * 1.0 * math.cos(a), base + k * 1.32 * math.sin(a)
    r = k * 0.11
    d.ellipse([sx - r, sy - r, sx + r, sy + r], fill=SUMMER + (255,))
    rr, gap, ln = k * 0.2, k * 0.1, k * 0.2
    lw = max(2, int(w * 0.6))
    d.ellipse([sx - rr, sy - rr, sx + rr, sy + rr], outline=RET + (255,), width=lw)
    for dx, dy in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
        d.line([(sx + dx * (rr + gap * .2), sy + dy * (rr + gap * .2)), (sx + dx * (rr + ln), sy + dy * (rr + ln))], fill=RET + (255,), width=lw)
    return im.resize((size, size), Image.LANCZOS)

def rounded(im, rad):
    m = Image.new("L", im.size, 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, im.size[0] - 1, im.size[1] - 1], rad, fill=255)
    out = Image.new("RGBA", im.size, (0, 0, 0, 0)); out.paste(im, (0, 0), m); return out

def circle(im):
    m = Image.new("L", im.size, 0); ImageDraw.Draw(m).ellipse([0, 0, im.size[0] - 1, im.size[1] - 1], fill=255)
    out = Image.new("RGBA", im.size, (0, 0, 0, 0)); out.paste(im, (0, 0), m); return out

res = "android/app/src/main/res"
dens = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
for name, f in dens.items():
    leg, fg = round(48 * f), round(108 * f)
    full = art(leg)
    rounded(full, leg * 0.22).save(f"{res}/mipmap-{name}/ic_launcher.png")
    circle(full).save(f"{res}/mipmap-{name}/ic_launcher_round.png")
    art(fg, with_bg=False, scale=0.70).save(f"{res}/mipmap-{name}/ic_launcher_foreground.png")
# fondo del icono adaptativo
open(f"{res}/values/ic_launcher_background.xml", "w").write(
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#152235</color>\n</resources>\n')
# pantalla de inicio: mismo dibujo centrado sobre fondo oscuro
for p in glob.glob(f"{res}/drawable*/splash.png"):
    W, H = Image.open(p).size
    sp = Image.new("RGBA", (W, H), (5, 8, 12, 255))
    s = int(min(W, H) * 0.42)
    sp.alpha_composite(rounded(art(s), s * 0.22), ((W - s) // 2, (H - s) // 2))
    sp.convert("RGB").save(p)
# icono de la tienda (512) y vista previa
rounded(art(512), 512 * 0.22).save("design/icon-512.png")
art(512).convert("RGB").save("design/play-icon-512.png")
print("ok")
