"""Icono de Clinómetro Solar (propuesta C1: sol recortado por un perfil de dos alturas).
Genera los iconos de Android (normal, redondo, adaptativo y monocromo), la pantalla de inicio,
los iconos de la web y el icono de 512 px para Google Play."""
import glob, os
from PIL import Image, ImageDraw

CREAM, ORANGE, NAVY = (247, 243, 236), (246, 128, 44), (19, 32, 52)
SS = 4  # sobremuestreo para el antialias

# Geometría en unidades del lienzo (0-1). Caja de la figura: x 0,22-0,81 · y 0,19-0,80
SUN = (0.54, 0.46, 0.27)
BLOCKS = [(0.22, 0.52, 0.56, 0.80), (0.56, 0.66, 0.80, 0.80)]
BOX = (0.22, 0.19, 0.81, 0.80)

def art(size, bg=True, scale=1.0, mono=False):
    """Dibuja la figura. scale < 1 la reduce hacia el centro (zona segura del icono adaptativo)."""
    S = size * SS
    im = Image.new("RGBA", (S, S), (CREAM + (255,)) if bg else (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx0, cy0 = (BOX[0] + BOX[2]) / 2, (BOX[1] + BOX[3]) / 2
    def tx(x): return ((x - cx0) * scale + 0.5) * S
    def ty(y): return ((y - cy0) * scale + 0.5) * S
    sx, sy, r = SUN
    sun_col = (255, 255, 255, 255) if mono else ORANGE + (255,)
    blk_col = (255, 255, 255, 255) if mono else NAVY + (255,)
    d.ellipse([tx(sx - r), ty(sy - r), tx(sx + r), ty(sy + r)], fill=sun_col)
    if mono:  # en monocromo el bloque se separa del sol con un hueco transparente
        gap = 0.035
        for x0, y0, x1, y1 in BLOCKS:
            d.rectangle([tx(x0 - gap), ty(y0 - gap), tx(x1 + gap), ty(y1)], fill=(0, 0, 0, 0))
    for x0, y0, x1, y1 in BLOCKS:
        d.rectangle([tx(x0), ty(y0), tx(x1), ty(y1)], fill=blk_col)
    return im.resize((size, size), Image.LANCZOS)

def mask(im, shape, rad=0.22):
    n = im.size[0]; m = Image.new("L", (n * SS, n * SS), 0); md = ImageDraw.Draw(m)
    if shape == "circle": md.ellipse([0, 0, n * SS - 1, n * SS - 1], fill=255)
    else: md.rounded_rectangle([0, 0, n * SS - 1, n * SS - 1], int(n * SS * rad), fill=255)
    out = Image.new("RGBA", im.size, (0, 0, 0, 0)); out.paste(im, (0, 0), m.resize(im.size, Image.LANCZOS)); return out

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
res = os.path.join(root, "android/app/src/main/res")
for name, f in {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}.items():
    leg, fg = round(48 * f), round(108 * f)
    full = art(leg)
    mask(full, "rounded").save(f"{res}/mipmap-{name}/ic_launcher.png")
    mask(full, "circle").save(f"{res}/mipmap-{name}/ic_launcher_round.png")
    art(fg, bg=False, scale=0.72).save(f"{res}/mipmap-{name}/ic_launcher_foreground.png")
    art(fg, bg=False, scale=0.72, mono=True).save(f"{res}/mipmap-{name}/ic_launcher_monochrome.png")

open(f"{res}/values/ic_launcher_background.xml", "w").write(
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#F7F3EC</color>\n</resources>\n')
adaptive = ('<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
            '    <background android:drawable="@color/ic_launcher_background"/>\n'
            '    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n'
            '    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>\n</adaptive-icon>\n')
for f in ("ic_launcher.xml", "ic_launcher_round.xml"):
    open(f"{res}/mipmap-anydpi-v26/{f}", "w").write(adaptive)

# Pantalla de inicio (Android < 12): figura centrada sobre crema
for p in glob.glob(f"{res}/drawable*/splash.png"):
    W, H = Image.open(p).size
    s = int(min(W, H) * 0.40)
    sp = Image.new("RGBA", (W, H), CREAM + (255,))
    sp.alpha_composite(art(s, bg=False, scale=1.0), ((W - s) // 2, (H - s) // 2))
    sp.convert("RGB").save(p)

# Web y tienda
web = os.path.join(root, "web/icons"); os.makedirs(web, exist_ok=True)
for n in (16, 32, 48, 192, 512):
    mask(art(n), "rounded").save(f"{web}/icon-{n}.png")
art(180).convert("RGB").save(f"{web}/apple-touch-icon.png")           # iOS aplica su propia máscara
art(512, bg=True, scale=0.78).convert("RGB").save(f"{web}/icon-maskable-512.png")
art(512).convert("RGB").save(os.path.join(root, "design/play-icon-512.png"))  # Google Play recorta las esquinas
mask(art(512), "rounded").save(os.path.join(root, "design/icon-512.png"))
print("ok")
