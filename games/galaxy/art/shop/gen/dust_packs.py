"""Stardust, after the products' names: Pizca, Frasco, Tarro, Ánfora, Nebulosa embotellada and Galaxia de polvo."""
import math
import numpy as np
from core import S, XX, YY, PX, PY, Canvas, ell, rect, poly, fill, tones, hexc, sphere_light, dilate4
from coins import ground, GOLD
from dust import DUST, crystal, heap, vial, jar, flask, orb, star_spark

CLAY = ['#7e8bd9', '#5a63bd', '#434a9e', '#31357c', '#22245a', '#15163d']


def amphora(cv, cx, base, w, h, seed=0):
    """An amphora of dark blue clay with gold bands, two handles, dust glowing over its mouth."""
    belly_cy = base - h * 0.42
    belly, u, v = ell(cx, belly_cy, w / 2, h * 0.36)
    neck = rect(cx - w * 0.17, base - h * 0.92, cx + w * 0.17, belly_cy - h * 0.2)
    foot = poly([(cx - w * 0.16, base - h * 0.1), (cx + w * 0.16, base - h * 0.1), (cx + w * 0.22, base), (cx - w * 0.22, base)])
    lip, _, _ = ell(cx, base - h * 0.92, w * 0.27, h * 0.05)
    shape = belly | neck | foot | lip
    col = fill(CLAY[2])
    tones(col, belly, sphere_light(u, v), CLAY[0:5], dither=False)
    col[neck] = hexc(CLAY[3])
    col[neck & (PX < cx - w * 0.04)] = hexc(CLAY[2])
    col[foot] = hexc(CLAY[3])
    tones(col, lip, np.clip(1.0 - (PX - (cx - w * 0.27)) / (w * 0.54), 0, 1), CLAY[0:4], dither=False)
    for by in (belly_cy - h * 0.18, belly_cy + h * 0.16):
        band = belly & (np.abs(PY - by) < 1.3)
        col[band] = hexc(GOLD[2])
        col[band & (PX < cx - w * 0.1)] = hexc(GOLD[1])
        col[band & (PX > cx + w * 0.25)] = hexc(GOLD[4])
    # meander dots between the bands
    for k in range(-3, 4):
        x = int(cx + k * w * 0.12)
        y = int(belly_cy)
        if belly[y, x]:
            col[y, x] = hexc(GOLD[2])
    cv.obj(shape, col, CLAY[5])
    for side in (-1, 1):
        m = np.zeros((S, S), bool)
        for t in np.linspace(0, math.pi, 30):
            x = cx + side * (w * 0.17 + math.sin(t) * w * 0.2)
            y = base - h * 0.86 + (1 - math.cos(t)) * h * 0.14
            m |= ell(x, y, 1.4, 1.4)[0]
        m &= ~shape
        hc = fill(CLAY[3])
        hc[m & (PY < base - h * 0.8)] = hexc(CLAY[1])
        cv.obj(m, hc, CLAY[5])
    heap(cv, cx, base - h * 0.94, w * 0.5, h * 0.14, seed=seed)


def pinch_spark(cv, x, y):
    star_spark(cv, x, y, True)


def tier(n):
    cv = Canvas()
    if n == 1:  # Pizca
        ground(cv, 42, 70, 28, 6)
        heap(cv, 40, 70, 46, 14, seed=1)
        crystal(cv, 56, 52, 11, rot=0.15)
        crystal(cv, 27, 58, 7, rot=-0.2)
        star_spark(cv, 66, 30, True)
        star_spark(cv, 18, 36)
    elif n == 2:  # Frasco
        ground(cv, 42, 73, 30, 6)
        vial(cv, 40, 71, 22, 58, fill_to=0.78, seed=4)
        heap(cv, 58, 76, 30, 6, seed=5)
        crystal(cv, 64, 60, 8)
        crystal(cv, 18, 66, 6, rot=0.3)
        star_spark(cv, 66, 22, True)
    elif n == 3:  # Tarro
        ground(cv, 42, 75, 34, 7)
        jar(cv, 40, 72, 38, 50, seed=8)
        heap(cv, 44, 78, 58, 6, seed=10)
        crystal(cv, 13, 66, 8)
        crystal(cv, 70, 62, 7, rot=0.2)
        star_spark(cv, 70, 18, True)
        star_spark(cv, 12, 30)
    elif n == 4:  # Ánfora
        ground(cv, 42, 76, 36, 7)
        amphora(cv, 40, 74, 40, 62, seed=6)
        heap(cv, 46, 79, 60, 5, seed=7)
        crystal(cv, 70, 64, 8)
        crystal(cv, 12, 60, 7, rot=0.25)
        star_spark(cv, 70, 18, True)
        star_spark(cv, 10, 26, True)
    elif n == 5:  # Nebulosa embotellada
        ground(cv, 42, 76, 38, 7)
        flask(cv, 40, 74, 20, seed=11)
        vial(cv, 70, 75, 13, 38, fill_to=0.8, seed=12)
        heap(cv, 40, 79, 62, 6, seed=13)
        crystal(cv, 13, 64, 9)
        crystal(cv, 64, 50, 7, rot=0.3)
        crystal(cv, 20, 36, 5)
        star_spark(cv, 70, 14, True)
        star_spark(cv, 10, 22, True)
    elif n == 6:  # Galaxia de polvo
        ground(cv, 42, 78, 40, 7)
        orb(cv, 42, 38, 25, seed=14)
        heap(cv, 42, 81, 66, 5, seed=15)
        crystal(cv, 11, 64, 9)
        crystal(cv, 73, 62, 9, rot=0.2)
        crystal(cv, 9, 26, 6, rot=0.4)
        crystal(cv, 75, 22, 6)
        star_spark(cv, 42, 5, True)
        star_spark(cv, 20, 8)
        star_spark(cv, 66, 8)
    return cv.finish()
