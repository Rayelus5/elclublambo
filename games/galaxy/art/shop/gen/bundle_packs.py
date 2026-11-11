"""The bundles: Pack de bienvenida (a gift box), Kit de arranque (a supply crate), Kit del explorador (a backpack) and
Kit del comandante (the commander's chest), each with the three currencies."""
import math
import numpy as np
from core import S, XX, YY, PX, PY, Canvas, ell, rect, poly, fill, tones, hexc, sphere_light, dilate4
from coins import coin, stack, pile, ground, chest, sparkle, GOLD, WOOD, ROYAL
from dust import DUST, crystal, heap, vial
from components import METAL, TEAL, gear, nut, cell

RIBBON = ['#ffd0d8', '#ff8fa3', '#ff5d79', '#d63a5c', '#9c2238', '#5c1023']
GIFT = ['#d6e9ff', '#9ec7ff', '#6f9cf0', '#4a72c9', '#2f4b94', '#1c2c60']
CANVAS = ['#e6d49a', '#c9b06a', '#a68b48', '#7c6532', '#55431f', '#352812']
LEATHER = ['#e0a070', '#bf7a48', '#99592f', '#6f3d1e', '#4a2611', '#2e1609']


def mixed(cv, cx, base, width, height, n, seed=0, scale=1.0):
    """A heap of the three currencies: coins, star crystals, gears and nuts, back ones first."""
    rng = np.random.default_rng(seed)
    pts = []
    tries = 0
    while len(pts) < n and tries < 4000:
        tries += 1
        x = rng.uniform(-1, 1)
        y = rng.uniform(0, (1 - x * x) ** 0.75)
        p = (cx + x * width / 2, base - y * height)
        if all(math.hypot(p[0] - q[0], (p[1] - q[1]) * 1.6) > 8.5 * scale for q in pts):
            pts.append(p)
    pts.sort(key=lambda p: p[1])
    kinds = ['coin', 'coin', 'coin', 'crystal', 'crystal', 'gear', 'tgear', 'nut']
    for (x, y) in pts:
        k = kinds[int(rng.integers(0, len(kinds)))]
        if k == 'coin':
            coin(cv, x, y, rng.uniform(7, 8.5) * scale, ratio=rng.uniform(0.55, 0.9), rot=rng.uniform(-0.4, 0.4))
        elif k == 'crystal':
            crystal(cv, x, y - 2, rng.uniform(5.5, 7.5) * scale, rot=rng.uniform(-0.3, 0.3))
        elif k == 'gear':
            gear(cv, x, y, rng.uniform(5.5, 7) * scale, teeth=8, rot=rng.uniform(0, 1), tilt=rng.uniform(0.65, 1.0))
        elif k == 'tgear':
            gear(cv, x, y, rng.uniform(5.5, 7) * scale, teeth=8, rot=rng.uniform(0, 1), pal=TEAL, tilt=rng.uniform(0.65, 1.0))
        else:
            nut(cv, x, y, rng.uniform(4, 5) * scale, rot=rng.uniform(0, 1), tilt=rng.uniform(0.6, 0.9))


def gift(cv, cx, base, w, h):
    """A gift box with its lid lifted on one side, a ribbon across and a big bow; returns where the goods peek out."""
    x0, x1, y0 = cx - w / 2, cx + w / 2, base - h

    def front():
        box = rect(x0, y0, x1, base)
        col = fill(GIFT[2])
        col[box & (PX < x0 + 3)] = hexc(GIFT[1])
        col[box & (PX > x1 - w * 0.3)] = hexc(GIFT[3])
        col[box & (PY > base - 3)] = hexc(GIFT[3])
        band = box & (np.abs(PX - cx) < 3.5)
        col[band] = hexc(RIBBON[2])
        col[band & (PX < cx - 1)] = hexc(RIBBON[1])
        col[band & (PX > cx + 2)] = hexc(RIBBON[3])
        # little stars printed on the paper
        for (sx, sy) in ((x0 + 7, y0 + 7), (x1 - 9, y0 + 12), (x0 + 10, base - 8), (x1 - 7, base - 6)):
            for (dx, dy) in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)):
                col[int(sy) + dy, int(sx) + dx] = hexc(GIFT[0])
        cv.obj(box, col, GIFT[5])

    def lid():
        # tipped up on the right
        pts = [(x0 - 2, y0 + 1), (x1 + 2, y0 - 9), (x1 + 2, y0 - 16), (x0 - 2, y0 - 6)]
        m = poly(pts)
        col = fill(GIFT[1])
        col[m & (PY > y0 - 6 + (PX - x0) * -0.18 + 3)] = hexc(GIFT[2])
        band = m & (np.abs(PX - cx) < 3.5)
        col[band] = hexc(RIBBON[1])
        cv.obj(m, col, GIFT[5])
        # the bow on the lid
        bx, by = cx, y0 - 13
        for side in (-1, 1):
            loop, lu, lv = ell(bx + side * 6, by - 2, 6.5, 4.5, rot=side * -0.5)
            hole, _, _ = ell(bx + side * 6, by - 2, 2.6, 1.6, rot=side * -0.5)
            lc = fill(RIBBON[2])
            tones(lc, loop, sphere_light(lu, lv), RIBBON[0:5], dither=False)
            lc[hole] = hexc(RIBBON[4])
            cv.obj(loop, lc, RIBBON[5])
        knot, ku, kv = ell(bx, by, 3.2, 3)
        kc = fill(RIBBON[2])
        tones(kc, knot, sphere_light(ku, kv), RIBBON[0:4], dither=False)
        cv.obj(knot, kc, RIBBON[5])
    return y0 - 2, front, lid


def crate_wood(cv, cx, base, w, h):
    """A supply crate of planks with metal corners and rope handles. Returns (top, front)."""
    x0, x1, y0 = cx - w / 2, cx + w / 2, base - h
    inside = poly([(x0 + 1, y0), (x1 - 1, y0), (x1 - 3, y0 - 5), (x0 + 3, y0 - 5)])
    cv.obj(inside, fill(WOOD[4]), WOOD[5])

    def front():
        box = rect(x0, y0, x1, base)
        col = fill(WOOD[2])
        for i in range(3):
            py = y0 + (i + 0.5) * h / 3
            col[box & (np.abs(PY - (y0 + (i + 1) * h / 3)) < 0.5)] = hexc(WOOD[4])
            col[box & (np.abs(PY - (y0 + i * h / 3 + 1)) < 0.5)] = hexc(WOOD[1])
        # the diagonal brace
        brace = box & (np.abs((PY - y0) - (PX - x0) * h / w) < 1.6)
        col[brace] = hexc(WOOD[1])
        col[box & (np.abs((PY - y0) - (PX - x0) * h / w - 1.6) < 0.6)] = hexc(WOOD[4])
        corners = rect(x0, y0, x0 + 4, y0 + 4) | rect(x1 - 4, y0, x1, y0 + 4) | rect(x0, base - 4, x0 + 4, base) | rect(x1 - 4, base - 4, x1, base)
        col[corners] = hexc(METAL[2])
        col[corners & ((PX < x0 + 1.5) | (PY < y0 + 1.5))] = hexc(METAL[1])
        cv.obj(box, col, WOOD[5])
    return y0 - 2, front


def backpack(cv, cx, base, w, h):
    """An explorer's backpack of canvas and leather: the body, a flap thrown back, a front pocket, straps and buckles, a
    compass hanging from it. Returns (top, front)."""
    x0, x1, y0 = cx - w / 2, cx + w / 2, base - h
    body, u, v = ell(cx, base - h * 0.48, w / 2, h * 0.52)
    body &= PY <= base
    body |= rect(x0 + 2, base - h * 0.4, x1 - 2, base)
    back = poly([(x0 + 4, y0 + 6), (x1 - 4, y0 + 6), (x1 - 7, y0 - 4), (x0 + 7, y0 - 4)])
    cv.obj(back, fill(CANVAS[3]), CANVAS[5])

    def front():
        col = fill(CANVAS[2])
        tones(col, body, sphere_light(u * 0.8, v * 0.8), CANVAS[0:5], dither=False)
        cv.obj(body, col, CANVAS[5])
        pocket = rect(cx - w * 0.28, base - h * 0.42, cx + w * 0.28, base - 3)
        pc = fill(LEATHER[2])
        pc[pocket & (PY < base - h * 0.42 + 2)] = hexc(LEATHER[1])
        pc[pocket & (PX > cx + w * 0.18)] = hexc(LEATHER[3])
        cv.obj(pocket, pc, LEATHER[5])
        for sx in (cx - w * 0.3, cx + w * 0.22):
            strap = rect(sx, y0 + 4, sx + 4, base - h * 0.44)
            sc = fill(LEATHER[2])
            sc[strap & (PX < sx + 1.5)] = hexc(LEATHER[1])
            cv.obj(strap, sc, LEATHER[5])
            buckle = rect(sx - 0.5, base - h * 0.56, sx + 4.5, base - h * 0.5)
            cv.obj(buckle, fill(GOLD[2]), GOLD[5])
        # a compass on a cord at the side
        cc, cu, cv_ = ell(x1 - 2, base - h * 0.3, 6, 6)
        ccol = fill(GOLD[2])
        tones(ccol, cc, sphere_light(cu, cv_), GOLD[0:5], dither=False)
        face, _, _ = ell(x1 - 2, base - h * 0.3, 4, 4)
        ccol[face] = hexc('#f4f2e6')
        ccol[face & (np.abs((PX - (x1 - 2)) + (PY - (base - h * 0.3))) < 0.8) & (PY < base - h * 0.3)] = hexc(RIBBON[3])
        ccol[face & (np.abs((PX - (x1 - 2)) + (PY - (base - h * 0.3))) < 0.8) & (PY >= base - h * 0.3)] = hexc('#3a3f80')
        cv.obj(cc, ccol, GOLD[6])
    return y0 + 2, front


def bspark(cv, x, y, big=False):
    sparkle(cv, x, y, big, color='#ffffff', mid=RIBBON[1], tip=RIBBON[2])


def tier(n):
    cv = Canvas()
    if n == 1:  # Pack de bienvenida
        ground(cv, 42, 76, 34, 6)
        top, front, lid = gift(cv, 42, 74, 46, 32)
        mixed(cv, 42, top + 4, 34, 8, 6, seed=2)
        front()
        lid()
        coin(cv, 14, 72, 7.5, ratio=0.6)
        crystal(cv, 72, 66, 7)
        bspark(cv, 12, 20, True)
        bspark(cv, 72, 14, True)
    elif n == 2:  # Kit de arranque
        ground(cv, 42, 76, 36, 6)
        top, front = crate_wood(cv, 42, 74, 50, 26)
        vial(cv, 30, top + 4, 12, 30, fill_to=0.8, seed=3)
        mixed(cv, 46, top + 4, 34, 9, 6, seed=4)
        front()
        stack(cv, 72, 76, 4, 7.5, seed=5)
        gear(cv, 12, 70, 7, teeth=8, pal=TEAL, rot=0.3)
        bspark(cv, 70, 16, True)
    elif n == 3:  # Kit del explorador
        ground(cv, 42, 78, 38, 7)
        top, front = backpack(cv, 40, 76, 46, 50)
        vial(cv, 30, top + 6, 12, 30, fill_to=0.85, seed=6)
        mixed(cv, 44, top + 6, 30, 10, 6, seed=7)
        front()
        pile(cv, 64, 80, 22, 5, 3, 7.5, seed=8)
        crystal(cv, 12, 66, 8)
        bspark(cv, 70, 12, True)
        bspark(cv, 10, 24)
    elif n == 4:  # Kit del comandante
        ground(cv, 42, 78, 41, 7)
        stack(cv, 9, 74, 6, 7.5, seed=11)
        cell(cv, 76, 76, 8, 18)
        top, x0, x1, front = chest(cv, 42, 72, 60, 28, royal=True)
        mixed(cv, 42, top + 4, 54, 17, 16, seed=12)
        front()
        mixed(cv, 42, 81, 64, 4, 5, seed=13)
        bspark(cv, 8, 16, True)
        bspark(cv, 76, 10, True)
        bspark(cv, 60, 4)
    return cv.finish()
