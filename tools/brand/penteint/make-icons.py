"""Penteint Projects app icons from public/icons/penteint-mark.svg (the silver faceted figure).
Black square, the mark with the brand-kit glow (white blur 2 @90%, #b4c8ff blur 18 @55%, #4278e1 blur 60 @72%).
Run:  pip install cairosvg pillow && python3 tools/brand/penteint/make-icons.py"""
import io, os, cairosvg
from PIL import Image, ImageFilter

ROOT = os.path.join(os.path.dirname(__file__), '..', '..', '..')
SVG = os.path.join(ROOT, 'public', 'icons', 'penteint-mark.svg')
OUT = os.path.join(ROOT, 'public', 'icons')

def mark(h):
    png = cairosvg.svg2png(url=SVG, output_height=h)
    return Image.open(io.BytesIO(png)).convert('RGBA')

def glow_icon(size, scale=0.66, bg=(0, 0, 0, 255), glow=True):
    big = size * 4                                   # draw large, then shrink: smooth edges
    m = mark(int(big * scale))
    canvas = Image.new('RGBA', (big, big), bg)
    x, y = (big - m.width) // 2, (big - m.height) // 2
    if glow:
        alpha = Image.new('L', (big, big), 0); alpha.paste(m.split()[3], (x, y))
        for color, blur, op in [((66, 120, 225), 60, .72), ((180, 200, 255), 18, .55), ((255, 255, 255), 2, .9)]:
            a = alpha.filter(ImageFilter.GaussianBlur(blur * big / 1024)).point(lambda v: int(v * op))
            layer = Image.new('RGBA', (big, big), color + (0,)); layer.putalpha(a)
            canvas = Image.alpha_composite(canvas, layer)
    canvas.alpha_composite(m, (x, y))
    return canvas.resize((size, size), Image.LANCZOS)

for name, size, scale in [('icon-512.png', 512, .66), ('icon-192.png', 192, .66), ('apple-touch-icon.png', 180, .62),
                          ('maskable-512.png', 512, .5), ('favicon-144.png', 144, .74), ('favicon-96.png', 96, .78),
                          ('favicon-48.png', 48, .82), ('favicon-32.png', 32, .86), ('logo-96.png', 96, .78)]:
    glow_icon(size, scale).convert('RGB' if name != 'logo-96.png' else 'RGBA').save(os.path.join(OUT, name), optimize=True)
# the mark on its own, transparent, for screens that draw their own background
mark(1024).save(os.path.join(OUT, 'penteint-mark.png'), optimize=True)
print('icons written to', os.path.normpath(OUT))
