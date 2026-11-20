"""Landing assets (plan «galaxysurvivor.es», PR 4): the community banners as WebP, and the silent gameplay loops with
their posters. The loops come from the trailer's own captures (footage is not in the repo; pass its folder).

Run from games/galaxy/apps/landing:
  python scripts/assets.py <path to games/galaxy/trailer/public/footage>
Needs Pillow and ffmpeg on PATH. Writes src/assets/{banners,clips,posters,sprites}/ and public/shots/ (committed outputs).
"""

import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parents[1]
WEB = HERE.parent / 'web'
OUT = HERE / 'src' / 'assets'
BANNERS = ['clanes', 'mercado', 'temporada', 'torneo', 'evento']
# clip: (start s, length s). Short loops, 960 wide, 30 fps, no audio (the trailer's music is not ours to publish).
CLIPS = {'lobby': (0, 7), 'horde': (1, 8), 'boss': (0, 8), 'extract': (2, 8), 'collection': (0, 6), 'coop': (0, 8)}


def banners() -> None:
    (OUT / 'banners').mkdir(parents=True, exist_ok=True)
    for name in BANNERS:
        img = Image.open(WEB / 'src' / 'news' / 'art' / f'{name}.png').convert('RGB')
        img = img.resize((640, round(img.height * 640 / img.width)), Image.LANCZOS)
        img.save(OUT / 'banners' / f'{name}.webp', 'WEBP', quality=82, method=6)


def clips(footage: Path) -> None:
    ffmpeg = shutil.which('ffmpeg')
    if not ffmpeg:
        sys.exit('ffmpeg not found')
    (OUT / 'clips').mkdir(parents=True, exist_ok=True)
    (OUT / 'posters').mkdir(parents=True, exist_ok=True)
    for name, (start, length) in CLIPS.items():
        src = footage / f'{name}.mp4'
        subprocess.run([ffmpeg, '-v', 'error', '-y', '-ss', str(start), '-t', str(length), '-i', str(src), '-an',
                        '-vf', 'scale=960:-2,fps=30', '-c:v', 'libx264', '-preset', 'slow', '-crf', '30',
                        '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(OUT / 'clips' / f'{name}.mp4')], check=True)
        png = OUT / 'posters' / f'{name}.png'
        subprocess.run([ffmpeg, '-v', 'error', '-y', '-ss', str(start), '-i', str(src), '-frames:v', '1',
                        '-vf', 'scale=960:-2', str(png)], check=True)
        Image.open(png).convert('RGB').save(OUT / 'posters' / f'{name}.webp', 'WEBP', quality=78, method=6)
        png.unlink()
    # The probes' sprite strips (art/ stays out of the Docker build context: games/galaxy/.dockerignore).
    (OUT / 'sprites').mkdir(parents=True, exist_ok=True)
    for probe in ('spark', 'prism', 'comet', 'lumen'):
        shutil.copyfile(HERE.parent.parent / 'art' / 'probes' / f'{probe}.png', OUT / 'sprites' / f'probe-{probe}.png')
    # Fixed-name copies for structured data (the VideoGame's screenshots), served from the site root.
    shots = HERE / 'public' / 'shots'
    shots.mkdir(parents=True, exist_ok=True)
    for clip, name in (('horde', 'incursion'), ('boss', 'nucleo'), ('coop', 'grupo')):
        shutil.copyfile(OUT / 'posters' / f'{clip}.webp', shots / f'{name}.webp')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    banners()
    clips(Path(sys.argv[1]))
    print('ok')
