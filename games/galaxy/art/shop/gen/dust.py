"""Stardust's parts: star crystals (the game's dust icon), glowing heaps, vials, a jar, an alchemy flask and the
nebula orb."""
import math
import numpy as np
from core import S, XX, YY, PX, PY, Canvas, ell, rect, poly, fill, tones, hexc, sphere_light, dilate4
from coins import sack, ground, sparkle, GOLD, WOOD

DUST = ['#ffffff', '#f0e8ff', '#d4c2ff', '#ad93ff', '#8a6cf5', '#6a4bd8', '#4a2fa8', '#2e1c70']
GLASS = ['#f4fbff', '#cfe6ff', '#9fbdf0', '#6f86c8', '#46549a', '#2a3168']
VELVET = ['#d9a8ff', '#b075f2', '#8a4fd6', '#6634ab', '#45207e', '#2c1152']
METAL = ['#f4f7ff', '#c9d0ee', '#9aa3d2', '#6c74ab', '#474d80', '#2b2f57']
CORK = WOOD


def crystal(cv, cx, cy, r, rot=0.0):
    """A four-point star crystal: eight facets lit from the upper left, a white heart."""
    pts = []
    for k in range(8):
        a = rot - math.pi / 2 + k * math.pi / 4
        rr = r if k % 2 == 0 else r * 0.36
        pts.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr))
    m = poly(pts)
    col = fill(DUST[4])
    ang = np.arctan2(PY - cy, PX - cx)
    # facets: which of the 8 slices, lit by its outward normal against the light (upper left)
    sl = np.floor(((ang - rot + math.pi / 2) % (2 * math.pi)) / (math.pi / 4)).astype(int)
    for k in range(8):
        mid = rot - math.pi / 2 + (k + 0.5) * math.pi / 4
        lit = -(math.cos(mid) * 0.6 + math.sin(mid) * 0.8)
        side = 1 if k % 2 == 0 else -1
        val = 0.5 + 0.45 * lit + 0.12 * side
        idx = int(np.clip(round((1 - val) * 5), 0, 5)) + 1
        col[m & (sl == k)] = hexc(DUST[idx])
    cv.obj(m, col, DUST[7])
    cv.glint(int(cx), int(cy), DUST[0])
    if r >= 6:
        cv.glint(int(cx) - 1, int(cy), DUST[1])
        cv.glint(int(cx), int(cy) - 1, DUST[1])


def heap(cv, cx, base, w, h, seed=0):
    """A heap of glowing dust: lighter at the top, specks of light."""
    m, u, v = ell(cx, base, w / 2, h)
    m &= PY <= base
    col = fill(DUST[4])
    val = np.clip(0.95 - (PY - (base - h)) / h * 0.8 - np.abs(u) * 0.15, 0, 1)
    tones(col, m, val, DUST[1:7])
    cv.obj(m, col, DUST[6])
    rng = np.random.default_rng(seed)
    ys, xs = np.nonzero(m)
    for i in rng.choice(len(xs), size=min(len(xs), max(2, len(xs) // 14)), replace=False):
        cv.glint(int(xs[i]), int(ys[i]), DUST[0] if rng.random() < 0.5 else DUST[1])


def glass_body(cv, body, cx, top_fill, x_left, seed=0, swirl=None):
    """Fills a glass shape: dust up to `top_fill` (y), glass above it, a highlight line on the left, specks."""
    col = fill(GLASS[4])
    air = body & (PY < top_fill)
    dust = body & (PY >= top_fill)
    col[air] = hexc(GLASS[4])
    col[air & (PY < top_fill - 2)] = hexc('#3a4486')
    ys = np.where(dust, PY, 0)
    if swirl is not None:
        sx, sy, sr = swirl
        ang = np.arctan2(PY - sy, PX - sx)
        rad = np.hypot(PX - sx, PY - sy) / sr
        arms = np.sin(ang * 2 + rad * 7)
        val = 0.18 + 0.5 * (arms > 0.15) * (1 - np.clip(rad, 0, 1)) + 0.55 * np.clip(1 - rad * 2.4, 0, 1)
        tones(col, dust, np.clip(val, 0, 1), DUST[1:8])
    else:
        val = np.clip(1.0 - (PY - top_fill) / 22.0, 0, 1)
        tones(col, dust, val, DUST[2:7])
    surface = dust & dilate4(air)
    col[surface] = hexc(DUST[1])
    hl = body & (PX >= x_left + 1.5) & (PX < x_left + 2.5)
    col[hl & ~surface] = hexc(GLASS[1])
    rng = np.random.default_rng(seed)
    return col, dust


def vial(cv, cx, base, w, h, fill_to=0.7, rot=0.0, seed=0):
    """A small vial with a cork: glass outline, glowing dust inside."""
    bw = w
    neck_w = w * 0.5
    body_top = base - h * 0.72
    body = rect(cx - bw / 2, body_top + bw * 0.2, cx + bw / 2, base - bw * 0.45)
    bot, _, _ = ell(cx, base - bw * 0.45, bw / 2, bw * 0.45)
    shoulder, _, _ = ell(cx, body_top + bw * 0.25, bw / 2, bw * 0.3)
    neck = rect(cx - neck_w / 2, base - h * 0.9, cx + neck_w / 2, body_top + 2)
    shape = body | bot | shoulder | neck
    top_fill = base - (h * 0.72) * fill_to
    col, dust = glass_body(cv, shape, cx, top_fill, cx - bw / 2, seed)
    cv.obj(shape, col, GLASS[5])
    lip = rect(cx - neck_w / 2 - 1, base - h * 0.9 - 1.5, cx + neck_w / 2 + 1, base - h * 0.9 + 0.5)
    lcol = fill(GLASS[2])
    cv.obj(lip, lcol, GLASS[5])
    cork = rect(cx - neck_w / 2 + 0.5, base - h - 0.5, cx + neck_w / 2 - 0.5, base - h * 0.9 - 1.5)
    ccol = fill(CORK[1])
    ccol[cork & (PX < cx)] = hexc(CORK[0])
    ccol[cork & (PX > cx + neck_w * 0.25)] = hexc(CORK[2])
    cv.obj(cork, ccol, CORK[4])
    ys, xs = np.nonzero(dust)
    rng = np.random.default_rng(seed + 5)
    for i in rng.choice(len(xs), size=min(len(xs), 3), replace=False):
        cv.glint(int(xs[i]), int(ys[i]), DUST[0])
    cv.glint(int(cx - bw / 2 + 2), int(base - bw * 0.6), GLASS[0])


def jar(cv, cx, base, w, h, seed=0):
    """A wide glass jar with a metal lid, a swirl of nebula inside."""
    body = rect(cx - w / 2, base - h + 5, cx + w / 2, base - 3)
    bot, _, _ = ell(cx, base - 3, w / 2, 3)
    shape = body | bot
    col, dust = glass_body(cv, shape, cx, base - h + 9, cx - w / 2, seed, swirl=(cx, base - h * 0.45, w * 0.55))
    cv.obj(shape, col, GLASS[5])
    lid = rect(cx - w / 2 - 1, base - h, cx + w / 2 + 1, base - h + 5)
    lcol = fill(METAL[2])
    lcol[lid & (PY < base - h + 2)] = hexc(METAL[1])
    lcol[lid & (XX % 3 == 0) & (PY >= base - h + 2)] = hexc(METAL[3])
    cv.obj(lid, lcol, METAL[5])
    for (gx, gy) in ((cx - w * 0.3, base - h * 0.6), (cx + w * 0.15, base - h * 0.35), (cx - w * 0.05, base - h * 0.7), (cx + w * 0.3, base - h * 0.55)):
        cv.glint(int(gx), int(gy), DUST[0])
    for yy in range(int(base - h + 7), int(base - 4)):
        cv.glint(int(cx - w / 2 + 1), yy, GLASS[1]) if yy % 5 else None
    cv.glint(int(cx - w / 2 + 2), int(base - h + 8), GLASS[0])


def flask(cv, cx, base, r, seed=0):
    """A round-bottomed alchemy flask: a ball of swirling dust, a long neck and a cork."""
    ball, u, v = ell(cx, base - r, r, r)
    neck = rect(cx - r * 0.28, base - r * 2.75, cx + r * 0.28, base - r * 1.6)
    shape = ball | neck
    col, dust = glass_body(cv, shape, cx, base - r * 1.45, cx - r, seed, swirl=(cx, base - r, r))
    shine = ball & (u < -0.35) & (v < -0.3) & (u * u + v * v > 0.45) & (u * u + v * v < 0.75)
    col[shine] = hexc(GLASS[0])
    cv.obj(shape, col, GLASS[5])
    lip = rect(cx - r * 0.28 - 1.5, base - r * 2.75 - 1.5, cx + r * 0.28 + 1.5, base - r * 2.75 + 0.5)
    cv.obj(lip, fill(GLASS[2]), GLASS[5])
    cork = rect(cx - r * 0.28 + 0.5, base - r * 2.75 - 6, cx + r * 0.28 - 0.5, base - r * 2.75 - 1.5)
    ccol = fill(CORK[1])
    ccol[cork & (PX < cx - 1)] = hexc(CORK[0])
    cv.obj(cork, ccol, CORK[4])
    rng = np.random.default_rng(seed)
    for _ in range(6):
        a, d = rng.uniform(0, 2 * math.pi), rng.uniform(0.1, 0.75)
        cv.glint(int(cx + math.cos(a) * d * r), int(base - r + math.sin(a) * d * r), DUST[0])


def orb(cv, cx, cy, r, seed=0):
    """The nebula orb on a gold stand: a glass sphere with a spiral galaxy of dust inside."""
    # stand
    base = cy + r * 1.05
    st = poly([(cx - r * 0.55, cy + r * 0.78), (cx + r * 0.55, cy + r * 0.78), (cx + r * 0.75, base + 4), (cx - r * 0.75, base + 4)])
    scol = fill(GOLD[2])
    scol[st & (PX < cx - r * 0.2)] = hexc(GOLD[1])
    scol[st & (PX > cx + r * 0.35)] = hexc(GOLD[3])
    scol[st & (PY > base + 1)] = hexc(GOLD[4])
    cv.obj(st, scol, GOLD[6])
    ball, u, v = ell(cx, cy, r, r)
    col = fill(DUST[6])
    ang = np.arctan2(PY - cy, PX - cx)
    rad = np.hypot(PX - cx, PY - cy) / r
    arms = np.sin(ang * 2 - rad * 6.5)
    val = 0.25 + 0.45 * (arms > 0.2) * (1 - rad) + 0.5 * np.clip(1 - rad * 2.2, 0, 1)
    tones(col, ball, np.clip(val, 0, 1), DUST[0:8])
    edge = ball & (u * u + v * v > 0.8)
    col[edge] = hexc(DUST[7])
    shine = ball & (u < -0.3) & (v < -0.35) & (u * u + v * v > 0.5) & (u * u + v * v < 0.72)
    col[shine] = hexc(GLASS[0])
    cv.obj(ball, col, DUST[7])
    ring = ell(cx, cy + r * 0.82, r * 0.6, r * 0.16)[0]
    rcol = fill(GOLD[2])
    rcol[ring & (PY < cy + r * 0.8)] = hexc(GOLD[1])
    cv.obj(ring, rcol, GOLD[6])
    rng = np.random.default_rng(seed)
    for _ in range(9):
        a, d = rng.uniform(0, 2 * math.pi), rng.uniform(0.05, 0.8)
        cv.glint(int(cx + math.cos(a) * d * r), int(cy + math.sin(a) * d * r), DUST[0])


def star_spark(cv, x, y, big=False):
    sparkle(cv, x, y, big, color='#ffffff', mid=DUST[2], tip=DUST[4])
