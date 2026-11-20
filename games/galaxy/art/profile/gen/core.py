"""Pixel art engine for the profile cosmetics (bloque C, C3): the shop's engine (art/shop/gen/core.py) made to work at
any size. Hard edges, per-object outlines in the material's own dark tone, cel shading by bands with a few
hue-shifted tones, and a selective ink silhouette at the end. Portraits paint an opaque backdrop first (kind 5): the
figure on top of it still gets its ink silhouette, the backdrop never does."""
import math
import numpy as np
from PIL import Image

INK = '#0b0c24'  # the game's outline (palette `k`, --panel-lip)
BAYER = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]) / 16.0

EMPTY, SOFT, FILL, LINE, GLINT, BACK = 0, 1, 2, 3, 4, 5


def hexc(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def tohex(rgb):
    return '#%02x%02x%02x' % tuple(int(v) for v in rgb)


def mix(a, b, t):
    """A colour between two hex colours (for the extra shades a ramp needs)."""
    ca, cb = hexc(a), hexc(b)
    return tohex(tuple(round(ca[i] + (cb[i] - ca[i]) * t) for i in range(3)))


def dilate4(m):
    o = m.copy()
    o[1:, :] |= m[:-1, :]
    o[:-1, :] |= m[1:, :]
    o[:, 1:] |= m[:, :-1]
    o[:, :-1] |= m[:, 1:]
    return o


def dilate8(m):
    o = dilate4(m)
    o[1:, 1:] |= m[:-1, :-1]
    o[1:, :-1] |= m[:-1, 1:]
    o[:-1, 1:] |= m[1:, :-1]
    o[:-1, :-1] |= m[1:, 1:]
    return o


LIGHT = np.array([-0.55, -0.65, 0.52])
LIGHT = LIGHT / np.linalg.norm(LIGHT)


def sphere_light(u, v):
    """Lambert on a unit sphere seen from the front, light from the upper left (1 = lit)."""
    nz = np.sqrt(np.clip(1 - u * u - v * v, 0, 1))
    return np.clip(u * LIGHT[0] + v * LIGHT[1] + nz * LIGHT[2], 0, 1)


class Canvas:
    """A w×h sprite. `k` keeps what each pixel is (empty, soft, fill, line, glint, backdrop) for the ink pass."""

    def __init__(self, w, h=None):
        h = w if h is None else h
        self.w, self.h = w, h
        self.YY, self.XX = np.mgrid[0:h, 0:w]
        self.PX = self.XX + 0.5
        self.PY = self.YY + 0.5
        self.DITHER = BAYER[self.YY % 4, self.XX % 4]
        self.c = np.zeros((h, w, 3), np.uint8)
        self.a = np.zeros((h, w), np.uint8)
        self.k = np.zeros((h, w), np.uint8)

    # Shapes -----------------------------------------------------------------------------------------------------------
    def ell(self, cx, cy, a, b, rot=0.0):
        c, s = math.cos(rot), math.sin(rot)
        dx, dy = self.PX - cx, self.PY - cy
        u = (dx * c + dy * s) / a
        v = (-dx * s + dy * c) / b
        return (u * u + v * v) <= 1.0, u, v

    def circle(self, cx, cy, r):
        return self.ell(cx, cy, r, r)[0]

    def ring(self, cx, cy, r0, r1):
        d = np.hypot(self.PX - cx, self.PY - cy)
        return (d >= r0) & (d <= r1)

    def rect(self, x0, y0, x1, y1):
        return (self.PX >= x0) & (self.PX < x1) & (self.PY >= y0) & (self.PY < y1)

    def poly(self, pts):
        """Even-odd point in polygon over the whole grid."""
        inside = np.zeros((self.h, self.w), bool)
        n = len(pts)
        for i in range(n):
            x1, y1 = pts[i]
            x2, y2 = pts[(i + 1) % n]
            if y1 == y2:
                continue
            cond = (self.PY > min(y1, y2)) & (self.PY <= max(y1, y2))
            xi = x1 + (self.PY - y1) * (x2 - x1) / (y2 - y1)
            inside ^= cond & (self.PX < xi)
        return inside

    def seg(self, x0, y0, x1, y1, r):
        """A thick segment (capsule) of radius r."""
        dx, dy = x1 - x0, y1 - y0
        L2 = dx * dx + dy * dy or 1e-9
        t = np.clip(((self.PX - x0) * dx + (self.PY - y0) * dy) / L2, 0, 1)
        qx, qy = x0 + t * dx, y0 + t * dy
        return np.hypot(self.PX - qx, self.PY - qy) <= r

    def cells(self, pts):
        """A mask from a list of (x, y) pixels."""
        m = np.zeros((self.h, self.w), bool)
        for x, y in pts:
            if 0 <= x < self.w and 0 <= y < self.h:
                m[y, x] = True
        return m

    # Colour arrays ----------------------------------------------------------------------------------------------------
    def fill(self, color):
        col = np.zeros((self.h, self.w, 3), np.uint8)
        col[:, :] = hexc(color)
        return col

    def tones(self, col, mask, value, ramp, dither=True, spread=1.0):
        """Paints `mask` of `col` with `ramp` (light to dark) by `value` in 0..1 (1 = lit), ordered dither at the band
        edges (or hard bands). `spread` < 1 keeps the dither to a narrower seam between bands."""
        n = len(ramp)
        x = np.clip((1 - value) * (n - 1), 0, n - 1)
        lo = np.floor(x).astype(int)
        frac = x - lo
        thr = 0.5 + (self.DITHER - 0.5) * spread
        idx = lo + ((frac > thr) if dither else (frac > 0.5)).astype(int)
        idx = np.clip(idx, 0, n - 1)
        for i, h in enumerate(ramp):
            col[mask & (idx == i)] = hexc(h)
        return col

    # Painting ---------------------------------------------------------------------------------------------------------
    def back(self, mask, color):
        """The portrait's backdrop: opaque, never outlined, never the cause of an outline."""
        if isinstance(color, str):
            self.c[mask] = hexc(color)
        else:
            self.c[mask] = color[mask]
        self.a[mask] = 255
        self.k[mask] = BACK

    def blend(self, mask, color, alpha):
        """Mixes a colour into what is already there (glows on the backdrop); keeps each pixel's kind."""
        rgb = np.array(hexc(color), float)
        t = alpha / 255.0
        cur = self.c[mask].astype(float)
        self.c[mask] = np.round(cur + (rgb - cur) * t).astype(np.uint8)
        empty = mask & (self.a == 0)
        self.c[empty] = hexc(color)
        self.a[empty] = alpha
        self.k[empty] = SOFT

    def soft(self, mask, color, alpha):
        m = mask & (self.k < FILL)
        self.c[m] = hexc(color)
        self.a[m] = alpha
        self.k[m] = SOFT

    def obj(self, mask, col, line=None):
        """An object: its own outline (one pixel round it, in `line`; none if None) and then its fill `col` (a colour
        or an h×w×3 array)."""
        if isinstance(col, str):
            col = self.fill(col)
        if line is not None:
            ring = dilate4(mask) & ~mask
            self.c[ring] = hexc(line)
            self.a[ring] = 255
            self.k[ring] = LINE
        self.c[mask] = col[mask]
        self.a[mask] = 255
        self.k[mask] = FILL

    def paint(self, mask, color):
        """Paints over pixels without touching their kind (details on an object)."""
        m = mask
        if isinstance(color, str):
            self.c[m] = hexc(color)
        else:
            self.c[m] = color[m]
        self.a[m] = 255
        self.k[m & (self.k < FILL)] = FILL

    def px(self, x, y, color):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.c[y, x] = hexc(color)
            self.a[y, x] = 255
            if self.k[y, x] < FILL or self.k[y, x] == BACK:
                self.k[y, x] = FILL

    def glint(self, x, y, color):
        """A pixel of light: no outline round it."""
        if 0 <= x < self.w and 0 <= y < self.h:
            self.c[y, x] = hexc(color)
            self.a[y, x] = 255
            self.k[y, x] = GLINT

    def stamp(self, x0, y0, rows, pal, kind=FILL):
        """Hand-placed pixels: one character per pixel, '.' and ' ' skip, the rest are keys of `pal`."""
        for j, row in enumerate(rows):
            for i, ch in enumerate(row):
                if ch in '. ':
                    continue
                x, y = x0 + i, y0 + j
                if 0 <= x < self.w and 0 <= y < self.h:
                    self.c[y, x] = hexc(pal[ch])
                    self.a[y, x] = 255
                    self.k[y, x] = kind

    def sparkle(self, x, y, size=1, core='#ffffff', mid='#fff3c4', tip=None):
        """A four-point twinkle made of glints (size 0: a dot, 1: a plus, 2: a long plus)."""
        self.glint(x, y, core)
        if size >= 1:
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                self.glint(x + dx, y + dy, mid)
        if size >= 2:
            for dx, dy in ((2, 0), (-2, 0), (0, 2), (0, -2)):
                self.glint(x + dx, y + dy, tip or mid)

    def finish(self, ink=INK):
        """The selective ink: every solid pixel that touches empty space (or the backdrop) becomes ink."""
        solid = (self.k == FILL) | (self.k == LINE)
        outside = (self.k == EMPTY) | (self.k == SOFT) | (self.k == BACK)
        edge = solid & dilate4(outside)
        self.c[edge] = hexc(ink)
        return self

    def image(self):
        return Image.fromarray(np.dstack([self.c, self.a]), 'RGBA')


def strip(images):
    """Frames side by side, the way the web plays them (CSS steps)."""
    w, h = images[0].size
    out = Image.new('RGBA', (w * len(images), h), (0, 0, 0, 0))
    for i, im in enumerate(images):
        out.alpha_composite(im, (i * w, 0))
    return out


def lift_map(ramps, steps=1, top=None):
    """For a shine: each colour of each ramp (light to dark) goes `steps` tones lighter; past the lightest, `top`."""
    out = {}
    for ramp in ramps:
        for i, h in enumerate(ramp):
            j = i - steps
            out[hexc(h)] = hexc(ramp[j]) if j >= 0 else hexc(top or ramp[0])
    return out


def apply_lift(cv, mask, lmap):
    """Lightens the pixels of `mask` whose colour is in a ramp (the rest stay: ink, gems, glints)."""
    ys, xs = np.nonzero(mask)
    for y, x in zip(ys, xs):
        t = tuple(int(v) for v in cv.c[y, x])
        if t in lmap:
            cv.c[y, x] = lmap[t]
