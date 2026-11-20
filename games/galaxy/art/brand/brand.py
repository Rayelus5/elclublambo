"""Galaxy Survivor brand icons (plan «galaxysurvivor.es», PR 4): the six braille dots of apps/web/public/favicon.svg
drawn at 8x and scaled down, for the landing (favicon.ico, apple-touch-icon) and the installable app (PR 3).

Run from games/galaxy:  python art/brand/brand.py
Writes apps/landing/public/ (served at the site root, fixed names) and apps/web/public/icons/ (committed outputs).
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
VOID = (7, 10, 28, 255)
SOLAR = (255, 201, 74, 255)
ICE = (191, 227, 255, 255)
# favicon.svg, viewBox 16: (cx, cy, colour) with r = 1.4, a 4-radius rounded square.
DOTS = [(5, 4, SOLAR), (5, 8, SOLAR), (11, 8, SOLAR), (11, 4, ICE), (5, 12, ICE), (11, 12, ICE)]
SS = 8  # supersampling


def icon(size: int, *, bleed: bool = False, logo: float = 1.0) -> Image.Image:
    """The logo at `size` px. `bleed`: full-square background (maskable, apple-touch); `logo`: the dots' scale."""
    big = size * SS
    img = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    unit = big / 16
    if bleed:
        d.rectangle((0, 0, big, big), fill=VOID)
    else:
        d.rounded_rectangle((0, 0, big - 1, big - 1), radius=4 * unit, fill=VOID)
    c = big / 2
    for cx, cy, col in DOTS:
        x = c + (cx - 8) * unit * logo
        y = c + (cy - 8) * unit * logo
        r = 1.4 * unit * logo
        d.ellipse((x - r, y - r, x + r, y + r), fill=col)
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    landing = ROOT / 'apps' / 'landing' / 'public'
    web = ROOT / 'apps' / 'web' / 'public' / 'icons'
    landing.mkdir(parents=True, exist_ok=True)
    web.mkdir(parents=True, exist_ok=True)
    outputs = {
        'icon-192.png': icon(192),
        'icon-512.png': icon(512),
        # Maskable: the platform crops to a circle of 80 %; the dots stay inside at 60 %.
        'maskable-512.png': icon(512, bleed=True, logo=0.6),
        'apple-touch-icon.png': icon(180, bleed=True, logo=0.78),
    }
    for name, img in outputs.items():
        img.save(landing / name)
        img.save(web / name)
    icon(48).save(landing / 'favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)])
    (landing / 'favicon.svg').write_text((ROOT / 'apps' / 'web' / 'public' / 'favicon.svg').read_text(encoding='utf-8'), encoding='utf-8')
    print('ok', sorted(outputs))


if __name__ == '__main__':
    main()
