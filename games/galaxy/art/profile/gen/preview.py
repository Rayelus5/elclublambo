"""The approval sheet (`python preview.py [out.png]`, by default art/profile/sheet.png): every avatar and frame at ×4
(nearest neighbour) on the game's void, the animated ones with all their frames, every frame round an avatar, with
the proposed name and rarity under each; then everything at real size."""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from catalog import AVATARS, FRAMES, render

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / 'sheet.png'
VOID = (7, 10, 28, 255)
INK = (243, 245, 255)
SOFT = (185, 191, 230)
TIER = {'común': (201, 208, 234), 'raro': (111, 183, 255), 'épico': (179, 157, 255), 'legendario': (255, 201, 74)}
SC = 4
GAP = 16
PAD = 28
W = 1780


def font(sz, bold=False):
    for name in (('arialbd.ttf' if bold else 'arial.ttf'), 'segoeui.ttf', 'DejaVuSans.ttf'):
        try:
            return ImageFont.truetype(name, sz)
        except Exception:
            pass
    return ImageFont.load_default()


def big(im):
    return im.resize((im.width * SC, im.height * SC), Image.NEAREST)


def label(d, x, y, w, name, rarity, extra=''):
    d.text((x + w / 2, y + 8), name, fill=INK, anchor='mt', font=font(17, True))
    d.text((x + w / 2, y + 31), rarity + extra, fill=TIER[rarity], anchor='mt', font=font(15))


def framed(frame_im, avatar_im):
    comp = Image.new('RGBA', (48, 48), (0, 0, 0, 0))
    comp.alpha_composite(avatar_im, (8, 8))
    comp.alpha_composite(frame_im)
    return comp


def sheet(out):
    avatars = [(pid, render(draw, n), name, rar, grp) for pid, draw, n, name, rar, grp in AVATARS]
    frames = [(pid, render(draw, n), name, rar, grp) for pid, draw, n, name, rar, grp in FRAMES]
    crew = [ims[0] for pid, ims, *_ in avatars if pid.startswith('crew-')]
    img = Image.new('RGBA', (W, 4200), VOID)
    d = ImageDraw.Draw(img)
    d.text((PAD, 24), 'Perfil: avatares y marcos', fill=INK, font=font(30, True))
    d.text((PAD, 64), 'Vistos a ×4. Las piezas animadas, con todos sus fotogramas (avatares a 6 fps, marcos a 8 fps). '
                      'Nombres y rarezas de los avatares: propuesta', fill=SOFT, font=font(17))
    y = 110
    tile = 32 * SC
    d.text((PAD, y), 'Avatares', fill=INK, font=font(24, True))
    y += 42
    for group in ('De serie', 'Por jugar', 'De tienda'):
        d.text((PAD, y), group, fill=SOFT, font=font(19, True))
        y += 30
        x = PAD
        for pid, ims, name, rar, grp in avatars:
            if grp != group:
                continue
            w = len(ims) * (tile + 6) - 6
            if x + w > W - PAD:
                x = PAD
                y += tile + 66
            for i, im in enumerate(ims):
                img.alpha_composite(big(im), (x + i * (tile + 6), y))
            label(d, x, y + tile, w, name, rar, f' · {len(ims)} fotogramas' if len(ims) > 1 else '')
            x += w + GAP
        y += tile + 74
    d.text((PAD, y), 'Marcos (cada uno alrededor de un avatar de serie)', fill=INK, font=font(24, True))
    y += 42
    ftile = 48 * SC
    x = PAD
    k = 0
    for pid, ims, name, rar, grp in frames:
        if len(ims) > 1:
            continue
        if x + ftile > W - PAD:
            x = PAD
            y += ftile + 66
        img.alpha_composite(big(framed(ims[0], crew[k % len(crew)])), (x, y))
        label(d, x, y + ftile, ftile, name, rar)
        x += ftile + GAP
        k += 1
    y += ftile + 74
    for pid, ims, name, rar, grp in frames:
        if len(ims) == 1:
            continue
        av = crew[k % len(crew)]
        for i, im in enumerate(ims):
            img.alpha_composite(big(framed(im, av)), (PAD + i * (ftile + 8), y))
        lx = PAD + len(ims) * (ftile + 8) + 10
        d.text((lx, y + ftile / 2 - 22), name, fill=INK, font=font(22, True))
        d.text((lx, y + ftile / 2 + 8), f'{rar} · {len(ims)} fotogramas', fill=TIER[rar], font=font(17))
        y += ftile + 18
        k += 1
    y += 30
    d.text((PAD, y), 'A tamaño real (×1 y ×2)', fill=INK, font=font(24, True))
    y += 40
    x = PAD
    for pid, ims, *_ in avatars:
        img.alpha_composite(ims[0], (x, y))
        x += 40
    y += 48
    x = PAD
    for i, (pid, ims, *_) in enumerate(frames):
        img.alpha_composite(framed(ims[0], crew[i % len(crew)]), (x, y))
        x += 56
    y += 60
    x = PAD
    for i, (pid, ims, *_) in enumerate(frames):
        im = framed(ims[0], crew[i % len(crew)])
        img.alpha_composite(im.resize((96, 96), Image.NEAREST), (x, y))
        x += 104
        if x + 96 > W - PAD:
            x = PAD
            y += 104
    y += 120
    img.crop((0, 0, W, y)).save(out, optimize=True)
    print(out)


if __name__ == '__main__':
    sheet(sys.argv[1] if len(sys.argv) > 1 else OUT)
