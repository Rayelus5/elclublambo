"""The parts every 48×48 frame shares (bloque C, C3). A frame is a band 8 px wide round a transparent 32×32 window.
The band is mitred like a picture frame: each pixel knows its side (and that side's outward normal), how far it is
from the outer edge (`r`, in pixels) and where it lies along the perimeter (`s`, clockwise from the top left), so
mouldings can be shaded by profile and lights can run round it."""
import math
import numpy as np
from core import Canvas, hexc, mix, dilate4, apply_lift, lift_map, FILL, LINE, GLINT, EMPTY
from palette import INK

S = 48
W0, W1 = 8, 40  # the window
FRAMES = 6
LIGHT = np.array([-0.7071, -0.7071])


def canvas():
    return Canvas(S)


class Band:
    """The band's geometry between `outer` (inset of its outer edge) and the window, with optional round corners."""

    def __init__(self, cv, outer=1, corner=0, chamfer=0):
        self.cv = cv
        self.outer = outer
        x, y = cv.XX, cv.YY
        lo, hi = outer, S - 1 - outer
        dl, dr, dt, db = x - lo, hi - x, y - lo, hi - y
        d = np.minimum(np.minimum(dl, dr), np.minimum(dt, db))
        inside = d >= 0
        if corner:
            for cx, cy in ((lo + corner, lo + corner), (hi - corner, lo + corner), (lo + corner, hi - corner),
                           (hi - corner, hi - corner)):
                q = ((x - cx) * np.sign(cx - S / 2) > 0) & ((y - cy) * np.sign(cy - S / 2) > 0)
                inside &= ~(q & (np.hypot(x - cx, y - cy) > corner + 0.3))
        if chamfer:
            for sx in (-1, 1):
                for sy in (-1, 1):
                    ex = lo if sx < 0 else hi
                    ey = lo if sy < 0 else hi
                    inside &= ~((np.abs(x - ex) + np.abs(y - ey)) < chamfer)
        window = (x >= W0) & (x < W1) & (y >= W0) & (y < W1)
        self.mask = inside & ~window
        self.r = np.where(self.mask, d, -1)
        self.depth = W0 - outer  # pixels from the outer edge to the window
        side = np.argmin(np.stack([dt, dr, db, dl]), axis=0)  # 0 top, 1 right, 2 bottom, 3 left
        self.side = side
        nx = np.select([side == 1, side == 3], [1.0, -1.0], 0.0)
        ny = np.select([side == 0, side == 2], [-1.0, 1.0], 0.0)
        self.lit = nx * LIGHT[0] + ny * LIGHT[1]  # +0.71 on the top and left sides, -0.71 on the others
        c = (outer + W0) / 2.0
        L = (S - 1 - c) - c
        self.L = L
        self.P = 4 * L
        px, py = x + 0.5 - 0.5, y + 0.5 - 0.5
        s = np.select([side == 0, side == 1, side == 2, side == 3],
                      [px - c, L + (py - c), 2 * L + (S - 1 - c - px), 3 * L + (S - 1 - c - py)])
        self.s = np.mod(s, self.P)

    def rows(self, r0, r1=None):
        r1 = r0 if r1 is None else r1
        return self.mask & (self.r >= r0) & (self.r <= r1)

    def shade(self, col, profile, ramp):
        """Paints the band by a moulding profile: profile[r] = (base, facing) for r = 0..depth-1, where base is the
        tone (0 light .. 1 dark) and facing +1 means that row faces outwards (lit on the top and left sides), -1
        inwards (lit on the bottom and right)."""
        n = len(ramp)
        for r, (base, facing) in enumerate(profile):
            m = self.rows(r)
            v = base - facing * self.lit * 0.42
            idx = np.clip(np.round(v * (n - 1)), 0, n - 1).astype(int)
            for i, h in enumerate(ramp):
                col[m & (idx == i)] = hexc(h)
        return col


def clear_window(cv):
    """The window is always fully transparent, whatever was drawn over it."""
    win = (cv.XX >= W0) & (cv.XX < W1) & (cv.YY >= W0) & (cv.YY < W1)
    cv.a[win] = 0
    cv.c[win] = 0
    cv.k[win] = EMPTY


def heads(f, n, P, frames=FRAMES, offset=0.0):
    """Positions along the perimeter of `n` lights spaced evenly, moving so the loop closes after `frames`."""
    return [((i + f / frames) * P / n + offset) % P for i in range(n)]


def run_shine(cv, band, f, mask, ramps, n=4, tail=9, top='#ffffff', frames=FRAMES, offset=0.0):
    """A shine that runs round the frame: `n` heads, each lifting the tones of `mask` two steps at the head and one
    along its tail."""
    hs = heads(f, n, band.P, frames, offset)
    best = np.full(band.s.shape, 1e9)
    for h in hs:
        ds = np.mod(h - band.s, band.P)  # how far behind the head
        best = np.minimum(best, ds)
    l2 = lift_map(ramps, 2, top)
    l1 = lift_map(ramps, 1, top)
    apply_lift(cv, mask & (best < 2.5), l2)
    apply_lift(cv, mask & (best >= 2.5) & (best < tail), l1)
    return hs


def point_at(band, s, r):
    """The pixel at perimeter position s and distance r from the outer edge."""
    c = (band.outer + W0) / 2.0
    L = band.L
    s = s % band.P
    off = r - (c - band.outer)
    if s < L:
        return int(round(c + s)), int(round(c + off))
    if s < 2 * L:
        return int(round(S - 1 - c - off)), int(round(c + s - L))
    if s < 3 * L:
        return int(round(S - 1 - c - (s - 2 * L))), int(round(S - 1 - c - off))
    return int(round(c + off)), int(round(S - 1 - c - (s - 3 * L)))


def gem(cv, cx, cy, r, ramp, line=None):
    """A round cabochon: lit at the upper left, dark at the lower right, a white glint."""
    m, u, v = cv.ell(cx, cy, r, r)
    col = cv.fill(ramp[2])
    val = np.clip(0.75 - u * 0.4 - v * 0.5, 0, 1)
    cv.tones(col, m, val, ramp[:4], dither=False)
    cv.obj(m, col, line or ramp[-1])
    gx, gy = int(math.floor(cx - r * 0.45)), int(math.floor(cy - r * 0.45))
    cv.glint(gx, gy, '#ffffff')
    return m


def cut_gem(cv, cx, cy, r, ramp, line=None):
    """A faceted gem seen from above: four facets round a bright table."""
    m = (np.abs(cv.PX - cx) + np.abs(cv.PY - cy)) <= r
    col = cv.fill(ramp[2])
    left = cv.PX < cx
    top = cv.PY < cy
    col[m & left & top] = hexc(ramp[0])
    col[m & ~left & top] = hexc(ramp[1])
    col[m & left & ~top] = hexc(ramp[2])
    col[m & ~left & ~top] = hexc(ramp[3])
    table = (np.abs(cv.PX - cx) + np.abs(cv.PY - cy)) <= r * 0.4
    col[m & table] = hexc(ramp[1])
    cv.obj(m, col, line or ramp[-1])
    return m


def rivet(cv, x, y, light, dark):
    cv.px(x, y, light)
    cv.px(x + 1, y, mix(light, dark, 0.5))
    cv.px(x, y + 1, mix(light, dark, 0.5))
    cv.px(x + 1, y + 1, dark)


def mirror4(pts):
    """A point list mirrored into the four corners (given for the top-left one)."""
    out = []
    for x, y in pts:
        out += [(x, y), (S - 1 - x, y), (x, S - 1 - y), (S - 1 - x, S - 1 - y)]
    return out


def done(cv):
    """Clears the window, inks the silhouette (outside and round the window) and clears the window again (glints)."""
    clear_window(cv)
    cv.finish()
    clear_window(cv)
    return cv
