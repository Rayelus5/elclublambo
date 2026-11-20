"""Coins' parts: a coin, stacks and heaps, a cloth sack, an open chest (wood or royal) and the sparkles."""
import math
import numpy as np
from core import S, XX, YY, PX, PY, Canvas, ell, rect, poly, fill, tones, hexc, sphere_light, dilate4

GOLD = ['#fffbe6', '#ffe68a', '#ffc93d', '#f6a224', '#d8731b', '#a24a13', '#6b2c0e']
WOOD = ['#f0b878', '#cf8a4c', '#a8642f', '#7c431d', '#552a10', '#3a1a08']
CLOTH = ['#f7cf98', '#e3a565', '#c47d43', '#9b5a2c', '#6e3a1a', '#47220d']
ROPE = ['#fff2c8', '#f2cf86', '#cf9f55', '#9c6c33', '#6b4520']
ROYAL = ['#c9a6ff', '#9a6dff', '#7446e0', '#5530b0', '#3a1d80', '#24104f']


def coin(cv, cx, cy, r, ratio=0.55, rot=0.0, thick=None, pal=GOLD, emblem=True):
    """A coin seen from above and in front: a bright raised rim, a slightly darker inset with its own shadow at the
    upper left, an arc of shine, and the edge below it (lit along its top, reeded on the bigger ones)."""
    if thick is None:
        thick = max(2.0, r * 0.32)
    tdir = (-math.sin(rot), math.cos(rot))
    face, u, v = ell(cx, cy, r, r * ratio, rot)
    side = np.zeros_like(face)
    k = 0.5
    while k <= thick + 1e-6:
        m, _, _ = ell(cx + tdir[0] * k, cy + tdir[1] * k, r, r * ratio, rot)
        side |= m
        k += 0.5
    side &= ~face
    col = fill(pal[4])
    side_top = side & dilate4(face)
    col[side_top] = hexc(pal[3])
    if r >= 8:
        col[side & ~side_top & (XX % 3 == 0)] = hexc(pal[5])
    d = u * u + v * v
    sx, sy = (PX - cx) / r, (PY - cy) / (r * ratio)
    lit = (sx * 0.8 + sy) < 0
    inner = face & (d <= (0.42 if r >= 7 else 0.3))
    rim = face & ~inner
    col[rim] = hexc(pal[1])
    col[rim & ~lit] = hexc(pal[2])
    col[inner] = hexc(pal[2])
    inner_edge = inner & dilate4(rim)
    col[inner_edge & lit] = hexc(pal[3])
    col[inner_edge & ~lit] = hexc(pal[1])
    # Shine: an arc on the rim at the upper left.
    shine = rim & (sx * 0.8 + sy < -0.75) & (d > 0.55)
    col[shine] = hexc(pal[0])
    cv.obj(face | side, col, pal[6])
    if emblem and r >= 9:
        ex, ey = int(cx), int(cy)
        for (x, y) in ((ex, ey - 1), (ex - 1, ey), (ex + 1, ey), (ex, ey + 1)):
            cv.px(x, y, pal[3])
        cv.px(ex, ey, pal[1])


def stack(cv, cx, base, n, r, seed=0, ratio=0.52):
    rng = np.random.default_rng(seed)
    t = max(2.0, r * 0.3)
    for i in range(n):
        jx = rng.uniform(-0.8, 0.8)
        coin(cv, cx + jx, base - i * (t + 0.6), r, ratio=ratio, rot=rng.uniform(-0.05, 0.05), thick=t, emblem=i == n - 1)


def pile(cv, cx, base, width, height, n, r, seed=1, tilted=0.25, rmin=None):
    """A heap of coins on a dome, back ones first; some stand tilted for life."""
    rng = np.random.default_rng(seed)
    pts = []
    tries = 0
    while len(pts) < n and tries < 4000:
        tries += 1
        x = rng.uniform(-1, 1)
        top = (1 - x * x) ** 0.75
        y = rng.uniform(0, top)
        p = (cx + x * width / 2, base - y * height)
        if all(math.hypot(p[0] - q[0], (p[1] - q[1]) * 1.7) > r * 1.25 for q in pts):
            pts.append(p)
    pts.sort(key=lambda p: p[1])
    for (x, y) in pts:
        rr = r * rng.uniform(0.9, 1.08) if rmin is None else rng.uniform(rmin, r)
        if rng.random() < tilted:
            coin(cv, x, y, rr, ratio=rng.uniform(0.78, 0.95), rot=rng.choice([-1, 1]) * rng.uniform(0.35, 0.7))
        else:
            coin(cv, x, y, rr, ratio=rng.uniform(0.55, 0.68), rot=rng.uniform(-0.22, 0.22))


def ground(cv, cx, cy, a, b):
    m, _, _ = ell(cx, cy, a, b)
    cv.soft(m, '#05030f', 95)


def sack(cv, cx, base, w, h, pal=CLOTH, patch=True):
    """A cloth sack: a round body lit at the upper left, folds from the neck, a patch, the neck cinched by a rope with a
    knot and its two ends, and the ruffled mouth on top (open)."""
    body_h = h * 0.74
    bcy = base - body_h / 2
    body, u, v = ell(cx, bcy, w / 2, body_h / 2)
    neck_y0 = base - h
    neck = poly([(cx - w * 0.17, bcy - body_h * 0.36), (cx + w * 0.17, bcy - body_h * 0.36), (cx + w * 0.13, neck_y0 + h * 0.2), (cx - w * 0.13, neck_y0 + h * 0.2)])
    mouth, mu, mv = ell(cx, neck_y0 + h * 0.13, w * 0.3, h * 0.11)
    col = fill(pal[2])
    val = sphere_light(u, v * 1.05)
    tones(col, body, val, pal[0:5], dither=False)
    # folds: darker curves from the neck down
    for k, off in enumerate((-0.42, -0.12, 0.2, 0.46)):
        t = np.linspace(0, 1, 40)
        xs = cx + w * (off * 0.35 + off * 0.5 * t)
        ys = bcy - body_h * 0.36 + t * body_h * (0.42 + 0.1 * (k % 2))
        for x, y in zip(xs, ys):
            xi, yi = int(x), int(y)
            if 0 <= xi < S and 0 <= yi < S and body[yi, xi]:
                col[yi, xi] = hexc(pal[4] if off > 0 else pal[3])
    col[neck] = hexc(pal[3])
    col[neck & (PX < cx - w * 0.04)] = hexc(pal[2])
    tones(col, mouth, np.clip(0.75 - mv * 0.3, 0, 1), pal[0:3])
    cv.obj(body | neck | mouth, col, pal[5])
    if patch and w >= 30:
        px0, py0 = cx + w * 0.12, bcy + body_h * 0.02
        pm = rect(px0, py0, px0 + w * 0.2, py0 + w * 0.16)
        pcol = fill(pal[1])
        pcol[pm & (PY > py0 + w * 0.1)] = hexc(pal[2])
        cv.obj(pm, pcol, pal[4])
        for x in range(int(px0) + 1, int(px0 + w * 0.2), 2):
            cv.px(x, int(py0) - 1, pal[0])
    # The rope round the neck, a knot and its ends.
    ry = bcy - body_h * 0.36 - 1.5
    band = rect(cx - w * 0.2, ry - 1.4, cx + w * 0.2, ry + 1.6)
    rcol = fill(ROPE[2])
    rcol[band & (PY < ry)] = hexc(ROPE[1])
    rcol[band & ((XX + YY) % 3 == 0)] = hexc(ROPE[3])
    cv.obj(band, rcol, ROPE[4])
    knot, ku, kv = ell(cx + w * 0.05, ry + 0.2, 2.6, 2.3)
    kcol = fill(ROPE[2])
    tones(kcol, knot, sphere_light(ku, kv), ROPE[0:4])
    cv.obj(knot, kcol, ROPE[4])
    for dx, ang in ((-1, 2.0), (1, 1.15)):
        m = np.zeros((S, S), bool)
        for t in np.linspace(0, 1, 30):
            x = cx + w * 0.05 + dx * 1.5 + math.cos(ang) * t * w * 0.2
            y = ry + 1.5 + math.sin(ang) * t * w * 0.24
            m |= ell(x, y, 1.1, 1.1)[0]
        ecol = fill(ROPE[2])
        ecol[m & (PX < cx + w * 0.05)] = hexc(ROPE[1])
        cv.obj(m, ecol, ROPE[4])
    return neck_y0 + h * 0.13  # the mouth's centre line


def chest(cv, cx, base, w, h, wood=WOOD, trim=GOLD, inner=None, royal=False):
    """An open chest seen from the front and a little above: the lid tipped back (its inside dark), the open top, the
    front with planks and gold bands, rivets and the lock. Returns (y of the open top, x0, x1, draw_front) so the
    coins go in before the front is drawn."""
    x0, x1 = cx - w / 2, cx + w / 2
    y1 = base
    y0 = base - h
    depth = h * 0.28
    lid_h = h * 0.95
    # The lid, tipped back: its inside (dark) framed in gold.
    def arch(inset):
        pts = [(x0 + 1 + inset, y0 - depth + 1 - inset * 0.5), (x1 - 1 - inset, y0 - depth + 1 - inset * 0.5)]
        lx0, lx1 = x0 + w * 0.04 + inset, x1 - w * 0.04 - inset
        top = y0 - depth - lid_h * 0.72 + inset
        bulge = lid_h * 0.28 - inset * 0.4
        for i in range(21):
            t = i / 20
            pts.append((lx1 - (lx1 - lx0) * t, top - bulge * math.sin(math.pi * t)))
        return poly(pts)
    lid = arch(0)
    lid_in = arch(4)
    lcol = fill(trim[3])
    lcol[lid & ~dilate4(dilate4(~lid)) & ~lid_in & (PY < y0 - depth - lid_h * 0.55)] = hexc(trim[1])
    lcol[lid & (PX < x0 + w * 0.05 + 3)] = hexc(trim[2])
    inner_pal = inner or wood
    lcol[lid_in] = hexc(inner_pal[4])
    for yy in range(int(y0 - depth - lid_h + 6), int(y0 - depth), 4):
        lcol[lid_in & (YY == yy)] = hexc(inner_pal[5])
    cv.obj(lid, lcol, trim[5])
    # The open top: the box's inside.
    top = poly([(x0, y0), (x1, y0), (x1 - 2, y0 - depth), (x0 + 2, y0 - depth)])
    tcol = fill(inner_pal[5])
    cv.obj(top, tcol, inner_pal[5])

    def front():
        box = rect(x0, y0, x1, y1)
        col = fill(wood[2])
        planks = max(2, int(h // 6))
        for i in range(planks):
            py = y0 + (i + 0.5) * h / planks
            band = box & (PY >= py - h / planks / 2) & (PY < py + h / planks / 2)
            col[band & (PY < py - h / planks / 2 + 1.5)] = hexc(wood[1])
            col[box & (np.abs(PY - (py + h / planks / 2)) < 0.5)] = hexc(wood[4])
        rng = np.random.default_rng(int(w * 7 + h))
        for _ in range(int(w * h / 40)):
            gx, gy = int(rng.uniform(x0 + 2, x1 - 3)), int(rng.uniform(y0 + 2, y1 - 2))
            for k in range(int(rng.integers(2, 5))):
                if 0 <= gx + k < S:
                    col[gy, gx + k] = hexc(wood[3])
        col[box & (PY > y1 - 2.5)] = hexc(wood[4])
        if royal:
            panel = rect(x0 + 6, y0 + 4, x1 - 6, y1 - 3)
            tones(col, panel, np.clip(0.95 - (PY - y0) / h, 0, 1), ROYAL[1:5], dither=False)
        # gold bands: left, right, top lip, bottom
        bw = max(3.0, w * 0.075)
        bands = rect(x0, y0, x0 + bw, y1) | rect(x1 - bw, y0, x1, y1) | rect(x0, y0, x1, y0 + 2.5)
        if royal:
            bands |= rect(x0, y1 - 3, x1, y1) | rect(cx - bw / 2, y0, cx + bw / 2, y1)
        col[bands] = hexc(trim[2])
        col[bands & (PY < y0 + 1.5)] = hexc(trim[1])
        col[bands & ((PX < x0 + 1.5) | ((PX > cx - bw / 2) & (PX < cx - bw / 2 + 1.2)))] = hexc(trim[1])
        col[bands & ((PX > x1 - 1.5) | (PY > y1 - 1.5))] = hexc(trim[4])
        cv.obj(box, col, wood[5])
        for (rx, ry) in ((x0 + bw / 2, y0 + 5), (x0 + bw / 2, y1 - 4), (x1 - bw / 2, y0 + 5), (x1 - bw / 2, y1 - 4)):
            cv.px(int(rx), int(ry), trim[0])
            cv.px(int(rx) + 1, int(ry) + 1, trim[4])
        # the lock
        lw, lh = max(7.0, w * 0.16), max(8.0, h * 0.42)
        lk = poly([(cx - lw / 2, y0 + 1), (cx + lw / 2, y0 + 1), (cx + lw / 2, y0 + lh * 0.7), (cx, y0 + lh), (cx - lw / 2, y0 + lh * 0.7)])
        kcol = fill(trim[2])
        kcol[lk & (PX < cx - lw * 0.15)] = hexc(trim[1])
        kcol[lk & (PX > cx + lw * 0.2)] = hexc(trim[3])
        cv.obj(lk, kcol, trim[5])
        hole, _, _ = ell(cx, y0 + lh * 0.38, 1.4, 1.4)
        slot = rect(cx - 0.6, y0 + lh * 0.38, cx + 0.6, y0 + lh * 0.66)
        hc = fill('#2a0f0a')
        cv.obj(hole | slot, hc, '#2a0f0a')

    return y0 - depth * 0.5, x0, x1, front


def star_chest_aura(cv, cx, cy, r):
    m, u, v = ell(cx, cy, r, r * 0.9)
    cv.soft(m, '#ffd34d', 38)
    m2, _, _ = ell(cx, cy, r * 0.7, r * 0.62)
    cv.soft(m2, '#ffe68a', 48)


def sparkle(cv, x, y, big=False, color='#fffbe6', mid='#ffe68a', tip='#ffc93d'):
    cv.glint(x, y, color)
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        cv.glint(x + dx, y + dy, mid)
    if big:
        for dx, dy in ((2, 0), (-2, 0), (0, 2), (0, -2)):
            cv.glint(x + dx, y + dy, tip)
