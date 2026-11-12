"""Effects shared by the richer pieces: value-noise clouds, nebula backdrops, star fields, hex lattices and jagged
cracks. Everything is seeded, so a build always paints the same pixels."""
import math
import numpy as np
from core import hexc


def smooth(t):
    return t * t * (3 - 2 * t)


def noise(w, h, seed, cell=8.0, octaves=2, ox=0.0, oy=0.0, wrap_x=None):
    """Smooth value noise in 0..1. `wrap_x` (in pixels, a multiple of `cell`) makes it tile horizontally."""
    rng = np.random.default_rng(seed)
    ys, xs = np.mgrid[0:h, 0:w].astype(float)
    out = np.zeros((h, w))
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        c = cell / (2 ** o)
        gw = int(math.ceil((w + abs(ox)) / c)) + 3
        gh = int(math.ceil((h + abs(oy)) / c)) + 3
        if wrap_x:
            gw = max(1, int(round(wrap_x / c)))
        g = rng.random((gh, gw if wrap_x else gw))
        gx = (xs + ox) / c
        gy = (ys + oy) / c
        x0 = np.floor(gx).astype(int)
        y0 = np.floor(gy).astype(int)
        fx = smooth(gx - x0)
        fy = smooth(gy - y0)
        if wrap_x:
            xa, xb = x0 % gw, (x0 + 1) % gw
        else:
            xa, xb = np.clip(x0, 0, gw - 1), np.clip(x0 + 1, 0, gw - 1)
        ya, yb = np.clip(y0, 0, gh - 1), np.clip(y0 + 1, 0, gh - 1)
        top = g[ya, xa] * (1 - fx) + g[ya, xb] * fx
        bot = g[yb, xa] * (1 - fx) + g[yb, xb] * fx
        out += (top * (1 - fy) + bot * fy) * amp
        tot += amp
        amp *= 0.5
    return out / tot


def noise_at(xs, ys, seed, period, k=8, octaves=2, cell_y=3.0):
    """Value noise sampled at float coordinates, tiling exactly every `period` along x (k cells per period): for
    textures that run round a frame without a seam."""
    rng = np.random.default_rng(seed)
    out = np.zeros(np.shape(xs))
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        kk = k * (2 ** o)
        cx = period / kk
        cy = cell_y / (2 ** o)
        g = rng.random((64, kk))
        gx = xs / cx
        gy = ys / cy + 8
        x0 = np.floor(gx).astype(int)
        y0 = np.floor(gy).astype(int)
        fx = smooth(gx - x0)
        fy = smooth(gy - y0)
        xa, xb = x0 % kk, (x0 + 1) % kk
        ya, yb = np.clip(y0, 0, 63), np.clip(y0 + 1, 0, 63)
        top = g[ya, xa] * (1 - fx) + g[ya, xb] * fx
        bot = g[yb, xa] * (1 - fx) + g[yb, xb] * fx
        out += (top * (1 - fy) + bot * fy) * amp
        tot += amp
        amp *= 0.5
    return out / tot


def nebula_back(cv, ramp, seed, cell=9.0, glow=None, bias=0.0, spread=0.6):
    """An opaque backdrop of dithered gas clouds in `ramp` (light to dark); `glow` = (cx, cy, r, strength) adds a lit
    centre."""
    n = noise(cv.w, cv.h, seed, cell, 3)
    val = np.clip((n - 0.3) * 1.25 + bias, 0, 1)
    if glow:
        gx, gy, gr, gs = glow
        d = np.hypot(cv.PX - gx, cv.PY - gy) / gr
        val = np.clip(val * 0.75 + np.clip(1 - d, 0, 1) * gs, 0, 1)
    col = cv.fill(ramp[-1])
    cv.tones(col, np.ones((cv.h, cv.w), bool), val, ramp, dither=True, spread=spread)
    cv.back(np.ones((cv.h, cv.w), bool), col)
    return val


def stars(cv, n, seed, colors=('#ffffff', '#bfe3ff'), avoid=None, big=0):
    """Single-pixel stars on the backdrop (and `big` plus-shaped ones)."""
    rng = np.random.default_rng(seed)
    placed, tries = 0, 0
    while placed < n and tries < 800:
        tries += 1
        x, y = int(rng.integers(0, cv.w)), int(rng.integers(0, cv.h))
        if avoid is not None and avoid[y, x]:
            continue
        c = colors[int(rng.integers(0, len(colors)))]
        cv.back(cv.cells([(x, y)]), c)
        if placed < big:
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                if 0 <= x + dx < cv.w and 0 <= y + dy < cv.h:
                    cv.back(cv.cells([(x + dx, y + dy)]), colors[-1])
        placed += 1


def hex_cells(gx, gy):
    """For lattice coordinates (gx, gy), the id of the nearest pointy hex centre and how close the point is to a wall
    (0 on the wall, larger inside), plus the offset from that centre."""
    rt = math.sqrt(3) / 2
    j0 = np.floor(gy / rt).astype(int)
    best = np.full(gx.shape, 1e9)
    second = np.full(gx.shape, 1e9)
    bid = np.zeros(gx.shape, int)
    bdx = np.zeros(gx.shape)
    bdy = np.zeros(gx.shape)
    for dj in (-1, 0, 1, 2):
        j = j0 + dj
        off = (j % 2) * 0.5
        i0 = np.floor(gx - off).astype(int)
        for di in (-1, 0, 1, 2):
            i = i0 + di
            cx = i + off
            cy = j * rt
            d = np.hypot(gx - cx, gy - cy)
            closer = d < best
            second = np.where(closer, best, np.minimum(second, d))
            bid = np.where(closer, i * 1000 + j, bid)
            bdx = np.where(closer, gx - cx, bdx)
            bdy = np.where(closer, gy - cy, bdy)
            best = np.where(closer, d, best)
    return bid, second - best, bdx, bdy


def crack(cv, x0, y0, ang, length, seed, jitter=0.6):
    """A jagged crack from (x0, y0) along `ang`: the list of pixels it crosses."""
    rng = np.random.default_rng(seed)
    pts = []
    x, y = x0, y0
    a = ang
    for _ in range(int(length * 2)):
        a += rng.uniform(-jitter, jitter) * 0.5
        a = ang + np.clip(a - ang, -0.6, 0.6)
        x += math.cos(a) * 0.5
        y += math.sin(a) * 0.5
        p = (int(math.floor(x)), int(math.floor(y)))
        if not pts or pts[-1] != p:
            pts.append(p)
    return pts


def mite(cv, x, y, flip=False):
    """A static mite (the in-game 8×8 one, smaller): magenta body, white eye."""
    rows = ['k...k', '.kmk.', 'kmnwk', 'kmnnk', '.kxk.']
    if flip:
        rows = [r[::-1] for r in rows]
    cv.stamp(x, y, rows, {'k': '#0b0c24', 'm': '#ff4d6d', 'n': '#ff6b7a', 'w': '#f3f5ff', 'x': '#9c2238'})
