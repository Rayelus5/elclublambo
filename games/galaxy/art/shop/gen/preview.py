"""The approval sheet (`python preview.py out.png`): every pack at 2x over a card like the shop's (panel gradient and
the currency's glow), with its name, and a row at 1x."""
import sys
from PIL import Image, ImageDraw, ImageFont
from core import S

GLOW = {'coins': (255, 201, 74), 'dust': (155, 134, 255), 'components': (69, 227, 166)}
NAMES = {
    'coins': ['Puñado', 'Bolsa', 'Saco', 'Cofre', 'Arca', 'Bóveda estelar'],
    'dust': ['Pizca', 'Frasco', 'Tarro', 'Ánfora', 'Nebulosa embotellada', 'Galaxia de polvo'],
    'components': ['Caja de piezas', 'Kit', 'Cajón técnico', 'Palé', 'Contenedor de carga', 'Fábrica en una caja'],
}
TITLES = {'coins': 'Monedas', 'dust': 'Polvo estelar', 'components': 'Componentes'}


def font(sz, bold=False):
    for name in (('arialbd.ttf' if bold else 'arial.ttf'), 'segoeui.ttf'):
        try:
            return ImageFont.truetype(name, sz)
        except Exception:
            pass
    return ImageFont.load_default()


def card(w, h, glow):
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / h
        c = (int(38 - 10 * t), int(42 - 12 * t), int(96 - 30 * t), 255)
        d.line([(0, y), (w, y)], fill=c)
    g = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    gd = ImageDraw.Draw(g)
    cx, cy = w / 2, h * 0.5
    for i in range(30, 0, -1):
        r = w * 0.42 * i / 30
        a = int(70 * (1 - i / 30) ** 1.2)
        gd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=glow + (a,))
    img.alpha_composite(g)
    mask = Image.new('L', (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], 22, fill=255)
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def sheet(rows, out):
    """rows: [(kind, [Image x6])]."""
    scale = 2
    cw, ch = S * scale + 24, S * scale + 56
    pad = 18
    W = pad + 6 * (cw + pad)
    H = 70 + len(rows) * (ch + 56) + 40 + len(rows) * (S + 16)
    img = Image.new('RGBA', (W, H), (12, 13, 36, 255))
    d = ImageDraw.Draw(img)
    d.text((pad, 22), 'Tienda: packs nuevos (84×84, vistos a ×2 como en las tarjetas)', fill=(235, 238, 255), font=font(24, True))
    y = 70
    for kind, sprites in rows:
        d.text((pad, y), TITLES[kind], fill=GLOW[kind], font=font(20, True))
        y += 34
        x = pad
        for i, spr in enumerate(sprites):
            img.alpha_composite(card(cw, ch, GLOW[kind]), (x, y))
            big = spr.resize((S * scale, S * scale), Image.NEAREST)
            img.alpha_composite(big, (x + 12, y + 8))
            d.text((x + cw / 2, y + ch - 22), f'{i + 1} · {NAMES[kind][i]}', fill=(225, 230, 255), anchor='mm', font=font(16))
            x += cw + pad
        y += ch + 22
    d.text((pad, y), 'A tamaño real (×1)', fill=(200, 205, 240), font=font(16, True))
    y += 26
    for kind, sprites in rows:
        x = pad
        for spr in sprites:
            img.alpha_composite(card(S + 8, S + 8, GLOW[kind]), (x, y))
            img.alpha_composite(spr, (x + 4, y + 4))
            x += S + 16
        y += S + 16
    img.save(out)


if __name__ == '__main__':
    import coin_packs, dust_packs, component_packs
    rows = [(k, [m.tier(n).image() for n in range(1, 7)]) for k, m in (('coins', coin_packs), ('dust', dust_packs), ('components', component_packs))]
    sheet(rows, sys.argv[1])
    print('ok')
