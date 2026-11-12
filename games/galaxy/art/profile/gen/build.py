"""The profile cosmetics' art (bloque C, C3), drawn by code: 28 avatars of 32×32 and 16 frames of 48×48.

`python build.py` writes one PNG per piece where the web imports them:
  apps/web/src/profile/art/avatars/<id>.png  (32×32, or a 128×32 strip of 4 frames played at 6 fps)
  apps/web/src/profile/art/frames/<id>.png   (48×48 with a transparent 32×32 window, or a 288×48 strip of 6 at 8 fps)
`python build.py --frames <dir>` also writes every frame as its own PNG (<dir>/<kind>/<id>-<n>.png), the input for
`sources.lua`, which saves the editable Aseprite files in art/profile/avatars and art/profile/frames.
`python preview.py` makes the approval sheet art/profile/sheet.png. Needs Python 3 with Pillow and numpy."""
import sys
from pathlib import Path
from catalog import AVATARS, FRAMES, render
from core import strip

HERE = Path(__file__).resolve().parent
WEB = HERE.parents[2] / 'apps' / 'web' / 'src' / 'profile' / 'art'


def build(frames_dir=None):
    for kind, items, size in (('avatars', AVATARS, 32), ('frames', FRAMES, 48)):
        out = WEB / kind
        out.mkdir(parents=True, exist_ok=True)
        for pid, draw, n, *_ in items:
            ims = render(draw, n)
            for im in ims:
                assert im.size == (size, size), (pid, im.size)
            if kind == 'frames':
                for im in ims:
                    window = im.crop((8, 8, 40, 40))
                    assert window.getextrema()[3][1] == 0, f'{pid}: the window is not transparent'
            strip(ims).save(out / f'{pid}.png', optimize=True)
            if frames_dir:
                d = Path(frames_dir) / kind
                d.mkdir(parents=True, exist_ok=True)
                for i, im in enumerate(ims):
                    im.save(d / f'{pid}-{i + 1}.png')
        print(f'{len(items)} {kind} in {out}')


if __name__ == '__main__':
    args = sys.argv[1:]
    build(args[args.index('--frames') + 1] if '--frames' in args else None)
