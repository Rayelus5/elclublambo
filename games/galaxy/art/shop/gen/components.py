"""Components' parts: gears, nuts, bolts, chips and power cells; a toolbox, a crate, a hard case and the cargo pod."""
import math
import numpy as np
from core import S, XX, YY, PX, PY, Canvas, ell, rect, poly, fill, tones, hexc, sphere_light, dilate4
from coins import ground, sparkle

METAL = ['#f4f7ff', '#c9d0ee', '#9aa3d2', '#6c74ab', '#474d80', '#2b2f57']
TEAL = ['#e6fff6', '#9cf5d4', '#45e3a6', '#1fb582', '#127a5a', '#0a4a38']
COPPER = ['#ffe2bf', '#ffb37a', '#e07b3c', '#a34a1e', '#6a2a0e']
BOARD = ['#3b4b8a', '#2a3670', '#1d2550', '#141a3a']
HAZ = ['#ffe680', '#ffc93d', '#d89a1e']


def gear(cv, cx, cy, r, teeth=8, rot=0.0, pal=METAL, tilt=1.0, thick=None):
    """A gear: teeth round a disc, a recessed hub with a hole, lit from the upper left; tilted ones show their side."""
    if thick is None:
        thick = max(1.5, r * 0.28) if tilt < 0.95 else 0.0

    def shape(oy):
        dx, dy = PX - cx, (PY - cy - oy) / tilt
        rad = np.hypot(dx, dy)
        ang = np.arctan2(dy, dx) - rot
        tooth = (np.cos(ang * teeth) > 0.25)
        return (rad <= r * 0.74) | ((rad <= r) & tooth), rad, dx, dy
    face, rad, dx, dy = shape(0)
    side = np.zeros_like(face)
    k = 0.5
    while k <= thick + 1e-6:
        side |= shape(k)[0]
        k += 0.5
    side &= ~face
    hole = face & (rad <= r * 0.24)
    hub = face & (rad <= r * 0.5) & ~hole
    col = fill(pal[3])
    lit = np.clip(0.62 - (dx + dy) / (r * 2.4), 0, 1)
    tones(col, face, lit, pal[0:5], dither=False)
    col[face & (rad > r * 0.74)] = hexc(pal[2])
    col[face & (rad > r * 0.74) & ((dx + dy) < 0)] = hexc(pal[1])
    col[hub] = hexc(pal[3])
    col[hub & ((dx + dy) > 0) & (rad > r * 0.38)] = hexc(pal[2])
    col[hub & ((dx + dy) < 0) & (rad > r * 0.38)] = hexc(pal[4])
    col[hole] = hexc('#10142e')
    col[side] = hexc(pal[4])
    col[side & dilate4(face)] = hexc(pal[3])
    cv.obj(face | side, col, pal[5])
    # a glint on the teeth at the upper left
    gy, gx = int(cy - r * 0.62 * tilt), int(cx - r * 0.55)
    cv.glint(gx, gy, pal[0])


def nut(cv, cx, cy, r, rot=0.0, pal=METAL, tilt=1.0):
    pts = [(cx + math.cos(rot + k * math.pi / 3) * r, cy + math.sin(rot + k * math.pi / 3) * r * tilt) for k in range(6)]
    m = poly(pts)
    hole, _, _ = ell(cx, cy, r * 0.42, r * 0.42 * tilt)
    col = fill(pal[2])
    ang = np.arctan2((PY - cy) / tilt, PX - cx) - rot
    sl = np.floor((ang % (2 * math.pi)) / (math.pi / 3)).astype(int)
    for k in range(6):
        mid = rot + (k + 0.5) * math.pi / 3
        lit = -(math.cos(mid) * 0.6 + math.sin(mid) * 0.8)
        col[m & (sl == k)] = hexc(pal[1] if lit > 0.35 else pal[2] if lit > -0.35 else pal[3])
    inner_ring = m & ~hole & dilate4(hole)
    col[inner_ring] = hexc(pal[4])
    col[hole] = hexc('#10142e')
    cv.obj(m, col, pal[5])


def bolt(cv, x, y, length, ang, r=3.5, pal=METAL):
    """A bolt lying at `ang`: a hex head and a threaded shaft."""
    ca, sa = math.cos(ang), math.sin(ang)
    w = r * 0.55
    shaft = poly([(x + sa * w, y - ca * w), (x + ca * length + sa * w, y + sa * length - ca * w), (x + ca * length - sa * w, y + sa * length + ca * w), (x - sa * w, y + ca * w)])
    col = fill(pal[2])
    t = (PX - x) * ca + (PY - y) * sa
    col[shaft & (np.floor(t) % 2 == 0)] = hexc(pal[3])
    col[shaft & (((PX - x) * -sa + (PY - y) * ca) < -w * 0.2)] = hexc(pal[1])
    cv.obj(shaft, col, pal[5])
    nut(cv, x, y, r, rot=ang, pal=pal)


def chip(cv, cx, cy, w, h):
    """A chip: a dark board with gold pins and a glowing teal core and traces."""
    board = rect(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)
    pins = np.zeros((S, S), bool)
    for i in range(int(cx - w / 2) + 1, int(cx + w / 2) - 1, 2):
        pins |= rect(i, cy - h / 2 - 2, i + 1, cy - h / 2) | rect(i, cy + h / 2, i + 1, cy + h / 2 + 2)
    pcol = fill(HAZ[1])
    cv.obj(pins, pcol, HAZ[2])
    col = fill(BOARD[1])
    col[board & (PY < cy - h / 2 + 1.5)] = hexc(BOARD[0])
    col[board & (PY > cy + h / 2 - 1.5)] = hexc(BOARD[2])
    core = rect(cx - w * 0.22, cy - h * 0.25, cx + w * 0.22, cy + h * 0.25)
    col[core] = hexc(TEAL[2])
    col[core & (PX < cx)] = hexc(TEAL[1])
    col[board & ~core & (np.abs(PY - cy) < 0.5)] = hexc(TEAL[3])
    cv.obj(board, col, BOARD[3])
    cv.glint(int(cx - w * 0.15), int(cy - h * 0.15), TEAL[0])


def cell(cv, cx, base, w, h):
    """A power cell: a cylinder with metal caps and a glowing teal window."""
    body = rect(cx - w / 2, base - h + 3, cx + w / 2, base - 2)
    top, _, _ = ell(cx, base - h + 3, w / 2, 2.2)
    bot, _, _ = ell(cx, base - 2, w / 2, 2.2)
    shape = body | top | bot
    col = fill(METAL[2])
    xs = (PX - (cx - w / 2)) / w
    tones(col, shape, np.clip(1 - xs * 1.1, 0, 1), METAL[0:5], dither=False)
    win = rect(cx - w / 2 + 2, base - h * 0.72, cx + w / 2 - 2, base - h * 0.3)
    tones(col, win, np.clip(1 - xs * 0.9, 0, 1), TEAL[0:4], dither=False)
    col[top] = hexc(METAL[1])
    cv.obj(shape, col, METAL[5])
    term = rect(cx - 1.5, base - h, cx + 1.5, base - h + 2)
    cv.obj(term, fill(METAL[1]), METAL[5])


def wrench(cv, x, y, length, ang, pal=METAL):
    ca, sa = math.cos(ang), math.sin(ang)
    w = 2.2
    handle = poly([(x + sa * w, y - ca * w), (x + ca * length + sa * w, y + sa * length - ca * w), (x + ca * length - sa * w, y + sa * length + ca * w), (x - sa * w, y + ca * w)])
    hx, hy = x + ca * length, y + sa * length
    head, _, _ = ell(hx, hy, 5.2, 5.2)
    jaw = poly([(hx + ca * 1.5 + sa * 2.2, hy + sa * 1.5 - ca * 2.2), (hx + ca * 7 + sa * 2.6, hy + sa * 7 - ca * 2.6), (hx + ca * 7 - sa * 2.6, hy + sa * 7 + ca * 2.6), (hx + ca * 1.5 - sa * 2.2, hy + sa * 1.5 + ca * 2.2)])
    m = (handle | head) & ~jaw
    col = fill(pal[2])
    side = ((PX - x) * -sa + (PY - y) * ca)
    col[m & (side < 0)] = hexc(pal[1])
    col[m & (side > 1.2)] = hexc(pal[3])
    cv.obj(m, col, pal[5])
    cv.glint(int(x + ca * length * 0.3 + sa * -1), int(y + sa * length * 0.3 - ca * 1), pal[0])


def parts(cv, cx, base, width, height, n, seed=0, scale=1.0):
    """A heap of parts on a dome, back ones first: gears (steel, teal, copper), nuts, chips and bolts."""
    rng = np.random.default_rng(seed)
    pts = []
    tries = 0
    while len(pts) < n and tries < 4000:
        tries += 1
        x = rng.uniform(-1, 1)
        y = rng.uniform(0, (1 - x * x) ** 0.75)
        p = (cx + x * width / 2, base - y * height)
        if all(math.hypot(p[0] - q[0], (p[1] - q[1]) * 1.5) > 8 * scale for q in pts):
            pts.append(p)
    pts.sort(key=lambda p: p[1])
    for i, (x, y) in enumerate(pts):
        kind = rng.choice(['gear', 'gear', 'tgear', 'nut', 'chip', 'cgear'])
        if kind == 'gear':
            gear(cv, x, y, rng.uniform(6, 8.5) * scale, teeth=int(rng.integers(7, 10)), rot=rng.uniform(0, 1), tilt=rng.uniform(0.6, 1.0))
        elif kind == 'tgear':
            gear(cv, x, y, rng.uniform(6, 8.5) * scale, teeth=8, rot=rng.uniform(0, 1), pal=TEAL, tilt=rng.uniform(0.6, 1.0))
        elif kind == 'cgear':
            gear(cv, x, y, rng.uniform(5, 6.5) * scale, teeth=7, rot=rng.uniform(0, 1), pal=COPPER + ['#3e1606'], tilt=rng.uniform(0.6, 1.0))
        elif kind == 'nut':
            nut(cv, x, y, rng.uniform(4, 5.5) * scale, rot=rng.uniform(0, 1), tilt=rng.uniform(0.6, 1.0))
        else:
            chip(cv, x, y, 10 * scale, 7 * scale)


def toolbox(cv, cx, base, w, h):
    """An open toolbox painted teal: a metal handle across, latches, a darker inside lip. Returns (top y, front)."""
    x0, x1, y0 = cx - w / 2, cx + w / 2, base - h
    inside = poly([(x0 + 1, y0), (x1 - 1, y0), (x1 - 3, y0 - 5), (x0 + 3, y0 - 5)])
    cv.obj(inside, fill(TEAL[5]), TEAL[5])
    handle = rect(cx - w * 0.3, y0 - 17, cx + w * 0.3, y0 - 14) | rect(cx - w * 0.3, y0 - 17, cx - w * 0.3 + 3, y0 - 3) | rect(cx + w * 0.3 - 3, y0 - 17, cx + w * 0.3, y0 - 3)
    hcol = fill(METAL[2])
    hcol[handle & (PY < y0 - 15.5)] = hexc(METAL[1])
    cv.obj(handle, hcol, METAL[5])

    def front():
        box = poly([(x0, y0), (x1, y0), (x1 - 3, base), (x0 + 3, base)])
        col = fill(TEAL[2])
        col[box & (PY < y0 + 3)] = hexc(TEAL[1])
        col[box & (PY > base - 3)] = hexc(TEAL[3])
        col[box & (PX > x1 - 7)] = hexc(TEAL[3])
        col[box & (np.abs(PY - (y0 + 4)) < 0.5)] = hexc(TEAL[4])
        cv.obj(box, col, TEAL[5])
        for lx in (x0 + w * 0.2, x1 - w * 0.2 - 4):
            lt = rect(lx, y0 + 1, lx + 4, y0 + 7)
            lc = fill(METAL[2])
            lc[lt & (PY < y0 + 3)] = hexc(METAL[1])
            cv.obj(lt, lc, METAL[5])
        cv.glint(int(x0 + 4), int(y0 + 1), TEAL[0])
    return y0 - 2, front


def crate(cv, cx, base, w, h):
    """An open sci-fi crate: a thick metal frame, dark panels with a teal light strip and hazard corners."""
    x0, x1, y0 = cx - w / 2, cx + w / 2, base - h
    inside = poly([(x0 + 1, y0), (x1 - 1, y0), (x1 - 3, y0 - 6), (x0 + 3, y0 - 6)])
    cv.obj(inside, fill(METAL[5]), METAL[5])

    def front():
        box = rect(x0, y0, x1, base)
        col = fill(METAL[2])
        frame = 3.5
        panel = rect(x0 + frame, y0 + frame, x1 - frame, base - frame)
        col[box & (PY < y0 + 1.5)] = hexc(METAL[1])
        col[box & (PX < x0 + 1.5)] = hexc(METAL[1])
        col[box & (PX > x1 - 1.5)] = hexc(METAL[3])
        col[box & (PY > base - 1.5)] = hexc(METAL[3])
        tones(col, panel, np.clip(0.8 - (PY - y0) / h * 0.6, 0, 1), METAL[2:6], dither=False)
        strip = rect(x0 + frame + 2, y0 + h * 0.42, x1 - frame - 2, y0 + h * 0.42 + 2.5)
        col[strip] = hexc(TEAL[1])
        col[strip & (PY > y0 + h * 0.42 + 1.2)] = hexc(TEAL[2])
        for (hx0, hx1) in ((x0, x0 + 9), (x1 - 9, x1)):
            hz = rect(hx0, base - 6, hx1, base) & box
            col[hz & (((XX + YY) // 2) % 2 == 0)] = hexc(HAZ[1])
            col[hz & (((XX + YY) // 2) % 2 == 1)] = hexc('#20223e')
        cv.obj(box, col, METAL[5])
        for (rx, ry) in ((x0 + 2, y0 + 2), (x1 - 3, y0 + 2)):
            cv.px(int(rx), int(ry), METAL[0])
        cv.glint(int(x0 + frame + 3), int(y0 + h * 0.42), TEAL[0])
    return y0 - 3, front


def case(cv, cx, base, w, h):
    """A hard case, open: the lid up with its foam, the bottom with slots holding glowing cells and chips."""
    x0, x1, y0 = cx - w / 2, cx + w / 2, base - h
    lid = poly([(x0 + 1, y0 + 1), (x1 - 1, y0 + 1), (x1 - 4, y0 - h * 1.25), (x0 + 4, y0 - h * 1.25)])
    lcol = fill(METAL[4])
    foam = poly([(x0 + 5, y0 - 1), (x1 - 5, y0 - 1), (x1 - 7, y0 - h * 1.25 + 4), (x0 + 7, y0 - h * 1.25 + 4)])
    lcol[foam] = hexc('#2b2f57')
    lcol[foam & ((XX // 2 + YY // 2) % 2 == 0)] = hexc('#353a6a')
    lcol[lid & ~foam & (PX < x0 + 6)] = hexc(METAL[3])
    cv.obj(lid, lcol, METAL[5])
    led = rect(cx - 6, y0 - h * 1.25 + 1.5, cx + 6, y0 - h * 1.25 + 3)
    cv.obj(led, fill(TEAL[1]), TEAL[4])

    def front():
        box = rect(x0, y0, x1, base)
        col = fill(METAL[3])
        col[box & (PY < y0 + 2)] = hexc(METAL[1])
        col[box & (PY > base - 2)] = hexc(METAL[4])
        col[box & (PX < x0 + 2)] = hexc(METAL[2])
        stripe = rect(x0, y0 + h * 0.45, x1, y0 + h * 0.45 + 2)
        col[stripe] = hexc(TEAL[2])
        cv.obj(box, col, METAL[5])
        for lx in (x0 + 6, x1 - 10):
            lt = rect(lx, y0 - 1, lx + 4, y0 + 4)
            cv.obj(lt, fill(METAL[1]), METAL[5])
        cv.glint(int(x0 + 3), int(y0 + 1), METAL[0])
    return y0 - 1, front


def pod(cv, cx, cy, w, h):
    """The cargo pod: a rounded hull with hazard bands, a dome window showing a glowing core, fins and a beacon."""
    hull, u, v = ell(cx, cy, w / 2, h / 2)
    col = fill(METAL[2])
    tones(col, hull, sphere_light(u, v * 0.9), METAL[0:5], dither=False)
    band = hull & (np.abs(PY - (cy + h * 0.18)) < 2.5)
    col[band & (((XX + YY) // 3) % 2 == 0)] = hexc(HAZ[1])
    col[band & (((XX + YY) // 3) % 2 == 1)] = hexc('#20223e')
    seam = hull & (np.abs(PY - (cy - h * 0.05)) < 0.5)
    col[seam] = hexc(METAL[4])
    for fx in (-1, 1):
        fin = poly([(cx + fx * w * 0.3, cy + h * 0.3), (cx + fx * w * 0.55, cy + h * 0.62), (cx + fx * w * 0.2, cy + h * 0.5)])
        fcol = fill(TEAL[3])
        fcol[fin & (PX < cx)] = hexc(TEAL[2])
        cv.obj(fin, fcol, TEAL[5])
    cv.obj(hull, col, METAL[5])
    dome, du, dv = ell(cx, cy - h * 0.12, w * 0.24, w * 0.24)
    dcol = fill(TEAL[4])
    rad = np.hypot(du, dv)
    tones(dcol, dome, np.clip(1.15 - rad * 1.1, 0, 1), TEAL[0:6], dither=False)
    shine = dome & (du < -0.25) & (dv < -0.3) & (rad > 0.55) & (rad < 0.85)
    dcol[shine] = hexc('#ffffff')
    cv.obj(dome, dcol, TEAL[5])
    ring = dilate4(dome) & ~dome
    cv.c[ring] = hexc(METAL[1])
    cv.k[ring] = 2
    cv.a[ring] = 255
    ant = rect(cx - 0.5, cy - h / 2 - 7, cx + 1, cy - h / 2 + 1)
    cv.obj(ant, fill(METAL[2]), METAL[5])
    bulb, _, _ = ell(cx + 0.25, cy - h / 2 - 8, 2, 2)
    cv.obj(bulb, fill(HAZ[0]), HAZ[2])


def spark(cv, x, y, big=False):
    sparkle(cv, x, y, big, color='#ffffff', mid=TEAL[1], tip=TEAL[2])
