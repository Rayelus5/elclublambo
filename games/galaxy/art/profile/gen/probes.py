"""Portraits of the probes Lumen, Bastión and Chispa (bloque C, C3): the in-game 16×16 sprites
(apps/web/src/arena/sprites/fauna.ts and probes.ts) redrawn as heroic close-ups, each in flight on its own card."""
import math
import numpy as np
from core import hexc, mix, sphere_light
from palette import INK, ICE, CYAN, SOLAR, STEEL, UV, SKY
from portrait import canvas
from fx import nebula_back, stars, hex_cells

WHITE = ['#ffffff', '#f3f5ff', '#dfe8ff', '#bfe3ff', '#8fb4e8', '#5f7fc0']


def streaks(cv, rows, color, seed, dx=1, length=(3, 7)):
    """Speed lines on the backdrop."""
    rng = np.random.default_rng(seed)
    for y in rows:
        x0 = int(rng.integers(0, 20))
        n = int(rng.integers(*length))
        cv.back(cv.rect(x0, y, x0 + n, y + 1), color)


def flame(cv, x, y, length, ramp=SOLAR, up=False):
    """A thruster flame pointing left (or down), a white core in a Solar body, flickering edge."""
    for i in range(length):
        t = i / max(1, length - 1)
        h = 2.6 * (1 - t) + 0.6
        for dy in range(-int(h), int(h) + 1):
            c = ramp[0] if abs(dy) < h * 0.35 and t < 0.5 else ramp[2] if abs(dy) < h * 0.7 else ramp[3]
            if up:
                cv.glint(x + dy, y + i, c)
            else:
                cv.glint(x - i, y + dy, c)


def lumen(f=0):
    """Lumen: the ice-white capsule with its cyan visor, the Solar thruster burning, flying to the right through the
    stars."""
    cv = canvas()
    nebula_back(cv, ['#3a58e0', '#2a40b0', '#1e2c80', '#151e58', '#0c1236'], seed=701, glow=(18, 15, 18, 0.25))
    streaks(cv, (4, 9, 21, 26, 29), '#4767f2', 3)
    stars(cv, 8, 11, colors=('#ffffff', '#bfe3ff'))
    # Top and bottom fins.
    for top in (True, False):
        y0, y1 = (3, 8) if top else (24, 29)
        fin = cv.poly([(10, y1 if top else y0), (21, y1 if top else y0), (18, y0 if top else y1),
                       (13, y0 if top else y1)])
        fcol = cv.fill('#bfe3ff')
        fcol[fin & (cv.PX < 15)] = hexc('#f3f5ff')
        fcol[fin & (cv.PX > 18)] = hexc('#8fb4e8')
        cv.obj(fin, fcol, '#3a58e0')
    # The capsule.
    body, u, v = cv.ell(16, 16, 13, 9.2)
    col = cv.fill(WHITE[2])
    cv.tones(col, body, sphere_light(np.clip(u, -1, 1), np.clip(v, -1, 1)), WHITE[:5], dither=False)
    # Panel seams and a band.
    col[body & (np.abs(cv.PX - 9.5) < 0.5)] = hexc('#8fb4e8')
    col[body & (np.abs(cv.PY - 22.5) < 0.5)] = hexc('#8fb4e8')
    cv.obj(body, col, '#26389a')
    # The visor: a dark frame with cyan glass and a reflection.
    vis = cv.poly([(15, 11), (26.5, 11), (28, 13.5), (28, 18.5), (26.5, 21), (15, 21), (14, 19), (14, 13)])
    vcol = cv.fill('#161935')
    cv.obj(vis, vcol, '#0b0c24')
    glass = cv.poly([(16.5, 12.5), (26, 12.5), (27, 14.5), (27, 18), (26, 19.5), (16.5, 19.5), (15.5, 18),
                     (15.5, 14)])
    gcol = cv.fill(CYAN[3])
    cv.tones(gcol, glass, np.clip(0.9 - (cv.PX - 15) / 14 - (cv.PY - 12) / 12, 0, 1), CYAN[1:5], dither=False)
    cv.paint(glass, gcol)
    # The eye light inside the visor.
    cv.paint(cv.rect(22, 14, 25, 18), '#ffffff')
    cv.paint(cv.rect(22, 14, 25, 15), '#b8f6ff')
    for x, y in ((17, 13), (18, 13), (19, 13), (17, 14)):
        cv.glint(x, y, '#ffffff')
    # Thruster nozzle at the back.
    noz = cv.rect(1, 13, 4, 19)
    ncol = cv.fill(STEEL[2])
    ncol[noz & (cv.PY < 14.5)] = hexc(STEEL[1])
    cv.obj(noz, ncol, STEEL[4])
    cv.finish()
    for y in (14, 15, 16, 17):
        cv.glint(0, y, SOLAR[2] if y in (15, 16) else SOLAR[3])
    cv.glint(0, 15, SOLAR[0])
    cv.glint(0, 16, SOLAR[1])
    cv.glint(8, 10, '#ffffff')
    cv.glint(7, 11, '#ffffff')
    return cv


def bastion(f=0):
    """Bastión: the armoured steel block with its Solar core burning behind the slot, rivets and plates, and the hex
    shield it raises shimmering round it."""
    cv = canvas()
    nebula_back(cv, ['#7a4a28', '#5a3420', '#3e2418', '#261610', '#140c08'], seed=702, glow=(16, 15, 18, 0.35))
    # The shield: a dome of hexagons, faint.
    d = np.hypot(cv.PX - 16, cv.PY - 16)
    bid, edge, _, _ = hex_cells(cv.PX / 4.0, cv.PY / 4.0)
    shield = (d < 15.5) & (d > 11) & (edge < 0.1)
    cv.back(shield, '#c27a12')
    cv.back((np.abs(d - 15.2) < 0.6), '#ffc94a')
    steel = ['#e6e9f8', '#b9bfe6', '#8890c4', '#6a7090', '#4b5390', '#2a2f5e', '#161935']
    # Feet.
    for x0 in (8, 20):
        foot = cv.rect(x0, 26, x0 + 4, 32)
        fcol = cv.fill(steel[4])
        fcol[foot & (cv.PX < x0 + 1.5)] = hexc(steel[3])
        cv.obj(foot, fcol, steel[6])
    # The hull: an outer plate and an inner bevelled plate.
    hull = cv.poly([(5, 6), (27, 6), (29, 9), (29, 24), (27, 27), (5, 27), (3, 24), (3, 9)])
    hcol = cv.fill(steel[3])
    hcol[hull & (cv.PY < 8)] = hexc(steel[1])
    hcol[hull & (cv.PX < 5)] = hexc(steel[2])
    hcol[hull & (cv.PX > 27)] = hexc(steel[4])
    hcol[hull & (cv.PY > 25)] = hexc(steel[5])
    cv.obj(hull, hcol, steel[6])
    inner = cv.poly([(7, 9), (25, 9), (26, 10), (26, 22), (25, 24), (7, 24), (6, 22), (6, 10)])
    icol = cv.fill(steel[2])
    icol[inner & (cv.PY < 10.5)] = hexc(steel[0])
    icol[inner & (cv.PX < 7.5)] = hexc(steel[1])
    icol[inner & (cv.PX > 24.5)] = hexc(steel[3])
    icol[inner & (cv.PY > 22.5)] = hexc(steel[3])
    cv.obj(inner, icol, steel[5])
    # The core slot: a dark frame, Solar glass and the white-hot core.
    slot = cv.rect(8, 13, 24, 19)
    cv.obj(slot, '#3a1700', steel[6])
    core = cv.rect(9, 14, 23, 18)
    ccol = cv.fill(SOLAR[3])
    ccol[core & (cv.PY < 15)] = hexc(SOLAR[2])
    ccol[core & (np.abs(cv.PX - 16) < 4.5)] = hexc(SOLAR[2])
    ccol[core & (np.abs(cv.PX - 16) < 2.5)] = hexc(SOLAR[1])
    ccol[core & (np.abs(cv.PX - 16) < 1) & (cv.PY > 15)] = hexc('#ffffff')
    cv.paint(core, ccol)
    # Rivets.
    for x, y in ((8, 11), (24, 11), (8, 21), (24, 21), (16, 11), (16, 21)):
        cv.px(x, y, steel[0])
        cv.px(x + 1, y + 1 if y < 31 else y, steel[4])
    # Antenna stubs on top.
    for x in (10, 21):
        cv.obj(cv.rect(x, 3, x + 2, 6), steel[2], steel[6])
    cv.finish()
    for x in (10, 22):
        cv.glint(x, 2, SOLAR[1])
    cv.glint(9, 14, '#fffbe6')
    cv.glint(10, 14, '#fffbe6')
    return cv


def spark(f=0):
    """Chispa: the violet arrow diving up and to the right on its jump, the cyan core blazing, arcs of electricity
    crackling off its wings and a trail of afterimages behind."""
    cv = canvas()
    nebula_back(cv, ['#5a43d6', '#46349e', '#33276e', '#22184a', '#120c2c'], seed=703, glow=(19, 13, 16, 0.3))
    # Diagonal speed lines.
    for k, (x0, y0, n) in enumerate(((2, 22, 6), (6, 28, 5), (0, 14, 4), (12, 30, 4), (1, 30, 3))):
        for i in range(n):
            if 0 <= x0 + i < 32 and 0 <= y0 - i < 32:
                cv.back(cv.cells([(x0 + i, y0 - i)]), '#7259ee' if k % 2 else '#9b86ff')
    stars(cv, 6, 13, colors=('#f3efff', '#b39dff'))
    rot = -0.62
    cx, cy, sc = 17.0, 15.5, 14.0
    c, si = math.cos(rot), math.sin(rot)

    def to(x, y):
        return (cx + (x * c - y * si) * sc, cy + (x * si + y * c) * sc)

    # A trail of light behind the notch.
    bx, by = to(-0.3, 0)
    for k, w in ((0, '#9b86ff'), (1, '#6fe3ff'), (-1, '#7259ee')):
        for i in range(2, 14):
            x = bx - c * i + si * k * 2.2
            y = by - si * i - c * k * 2.2
            if (i + k) % 3:
                cv.back(cv.cells([(int(x), int(y))]), w)
    shape = cv.poly([to(1.05, 0), to(-0.6, -0.78), to(-0.28, 0), to(-0.6, 0.78)])
    col = cv.fill(UV[3])
    side = -(cv.PX - cx) * si + (cv.PY - cy) * c
    along = (cv.PX - cx) * c + (cv.PY - cy) * si
    col[shape & (side < 0)] = hexc('#b39dff')
    col[shape & (side < -3.5)] = hexc('#d9ccff')
    col[shape & (side > 0)] = hexc('#5a43d6')
    col[shape & (side > 3.5)] = hexc('#3a2a9a')
    col[shape & (np.abs(side) < 0.7) & (along > 2)] = hexc('#f3efff')
    # Steel trim along the trailing edges.
    trail = shape & (along < -2.4 - np.abs(side) * 0.15)
    col[trail & (side < 0)] = hexc(STEEL[1])
    col[trail & (side >= 0)] = hexc(STEEL[3])
    cv.obj(shape, col, '#22185e')
    # The core.
    ox, oy = to(0.12, 0)
    core = cv.circle(ox, oy, 3.3)
    ccol = cv.fill(CYAN[2])
    d = np.hypot(cv.PX - ox, cv.PY - oy)
    ccol[d < 2.2] = hexc(CYAN[1])
    ccol[d < 1.1] = hexc('#ffffff')
    cv.obj(core, ccol, '#0e4a6e')
    cv.finish()
    # Thruster at the notch.
    nx, ny = to(-0.36, 0)
    for i, col_ in enumerate((SOLAR[0], SOLAR[1], SOLAR[2], SOLAR[3])):
        cv.glint(int(nx - c * i), int(ny - si * i), col_)
        cv.glint(int(nx - c * i) + 1, int(ny - si * i), col_ if i else SOLAR[1])
    # Electric arcs off the wings.
    for pts in (((25, 3), (26, 4), (27, 3), (28, 4), (29, 3)), ((29, 12), (28, 13), (29, 14), (28, 15)),
                ((6, 8), (5, 9), (6, 10), (5, 11))):
        for i, (x, y) in enumerate(pts):
            cv.glint(x, y, '#ffffff' if i % 2 else '#6fe3ff')
    cv.sparkle(30, 1, 0, core='#ffffff')
    return cv
