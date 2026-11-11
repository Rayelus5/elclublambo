"""The shop's pack sprites (shop and lab plan, F5c; approved by the owner 2026-11-11), drawn by code at 84x84.

`python build.py` writes the strip the web serves (apps/web/src/shop/packs.png: coins 1-6, dust 1-6, components 1-6)
and one PNG per pack in frames/, which are imported into art/shop/tienda-packs.aseprite (one frame each, the same
order). `python preview.py out.png` makes the approval sheet. Needs Pillow and numpy."""
from pathlib import Path
from PIL import Image
import coin_packs, dust_packs, component_packs
from core import S

HERE = Path(__file__).resolve().parent
STRIP = HERE.parents[2] / 'apps' / 'web' / 'src' / 'shop' / 'packs.png'
PACKS = (('coins', coin_packs), ('dust', dust_packs), ('components', component_packs))

if __name__ == '__main__':
    frames = HERE / 'frames'
    frames.mkdir(exist_ok=True)
    strip = Image.new('RGBA', (S * 18, S), (0, 0, 0, 0))
    for i, (kind, mod) in enumerate(PACKS):
        for n in range(1, 7):
            im = mod.tier(n).image()
            im.save(frames / f'{kind}-{n}.png')
            strip.alpha_composite(im, ((i * 6 + n - 1) * S, 0))
    strip.save(STRIP)
    print(f'{STRIP} and {frames}')
