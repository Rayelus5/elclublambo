"""Pixel art engine for the shop's pack sprites: 84x84, hard edges, per-object outlines in the material's own dark tone
and an ink silhouette at the end (selective outline), cel shading with a few hue-shifted tones per material."""
import math
import numpy as np
from PIL import Image

S = 84
YY, XX = np.mgrid[0:S, 0:S]
PX = XX + 0.5
PY = YY + 0.5
INK = '#140c26'
BAYER = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]) / 16.0
DITHER = BAYER[YY % 4, XX % 4]


def hexc(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def dilate4(m):
    o = m.copy()
    o[1:, :] |= m[:-1, :]
    o[:-1, :] |= m[1:, :]
    o[:, 1:] |= m[:, :-1]
    o[:, :-1] |= m[:, 1:]
    return o


def ell(cx, cy, a, b, rot=0.0):
    c, s = math.cos(rot), math.sin(rot)
    dx, dy = PX - cx, PY - cy
    u = (dx * c + dy * s) / a
    v = (-dx * s + dy * c) / b
    return (u * u + v * v) <= 1.0, u, v


def rect(x0, y0, x1, y1):
    return (PX >= x0) & (PX < x1) & (PY >= y0) & (PY < y1)


def poly(pts):
    """Even-odd point in polygon over the whole grid."""
    inside = np.zeros((S, S), bool)
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        if y1 == y2:
            continue
        cond = (PY > min(y1, y2)) & (PY <= max(y1, y2))
        xi = x1 + (PY - y1) * (x2 - x1) / (y2 - y1)
        inside ^= cond & (PX < xi)
    return inside


class Canvas:
    def __init__(self):
        self.c = np.zeros((S, S, 3), np.uint8)
        self.a = np.zeros((S, S), np.uint8)
        # 0 empty, 1 soft (shadow, glow), 2 fill, 3 line
        self.k = np.zeros((S, S), np.uint8)

    def soft(self, mask, color, alpha):
        m = mask & (self.k < 2)
        self.c[m] = hexc(color)
        self.a[m] = alpha
        self.k[m] = 1

    def obj(self, mask, col, line):
        """An object: its own outline (one pixel round it, in `line`) and then its fill `col` (an SxSx3 array)."""
        ring = dilate4(mask) & ~mask
        self.c[ring] = hexc(line)
        self.a[ring] = 255
        self.k[ring] = 3
        self.c[mask] = col[mask]
        self.a[mask] = 255
        self.k[mask] = 2

    def px(self, x, y, color):
        if 0 <= x < S and 0 <= y < S:
            self.c[y, x] = hexc(color)
            self.a[y, x] = 255
            if self.k[y, x] < 2:
                self.k[y, x] = 2

    def glint(self, x, y, color):
        """A pixel of light: no outline round it."""
        if 0 <= x < S and 0 <= y < S:
            self.c[y, x] = hexc(color)
            self.a[y, x] = 255
            self.k[y, x] = 4

    def finish(self):
        solid = (self.k == 2) | (self.k == 3)
        edge = solid & dilate4(~solid & (self.k != 4))
        self.c[edge] = hexc(INK)
        return self

    def image(self):
        arr = np.dstack([self.c, self.a])
        return Image.fromarray(arr, 'RGBA')


def fill(color):
    col = np.zeros((S, S, 3), np.uint8)
    col[:, :] = hexc(color)
    return col


def tones(col, mask, value, ramp, dither=True):
    """Paints `mask` with `ramp` (light to dark) by `value` in 0..1 (1 = lit), ordered dither at the band edges."""
    n = len(ramp)
    x = np.clip((1 - value) * (n - 1), 0, n - 1)
    lo = np.floor(x).astype(int)
    frac = x - lo
    idx = lo + ((frac > DITHER) if dither else (frac > 0.5)).astype(int)
    idx = np.clip(idx, 0, n - 1)
    for i, h in enumerate(ramp):
        col[mask & (idx == i)] = hexc(h)


LIGHT = np.array([-0.55, -0.65, 0.52])
LIGHT = LIGHT / np.linalg.norm(LIGHT)


def sphere_light(u, v):
    nz = np.sqrt(np.clip(1 - u * u - v * v, 0, 1))
    return np.clip(u * LIGHT[0] + v * LIGHT[1] + nz * LIGHT[2], 0, 1)
