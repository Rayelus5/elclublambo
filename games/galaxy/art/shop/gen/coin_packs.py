"""Coins, after the products' names: Puñado, Bolsa, Saco, Cofre, Arca and Bóveda estelar."""
import math
import numpy as np
from core import S, XX, YY, PX, PY, Canvas, ell, rect, poly, fill, tones, hexc, sphere_light, dilate4
from coins import coin, stack, pile, ground, sack, chest, sparkle, GOLD, WOOD, ROYAL
from components import METAL

IRON = ['#e9ecff', '#b9bfe6', '#8890c4', '#5d6399', '#3c4070', '#23264f']


def vault(cv, cx, cy, r):
    """The star vault: a round metal door in a thick gold frame, its bolts round it, a wheel with spokes, a star."""
    frame, fu, fv = ell(cx, cy, r, r)
    col = fill(GOLD[2])
    tones(col, frame, sphere_light(fu * 0.6, fv * 0.6), GOLD[0:5], dither=False)
    door, du, dv = ell(cx, cy, r * 0.8, r * 0.8)
    tones(col, door, np.clip(0.75 - (du + dv) * 0.35, 0, 1), IRON[0:5], dither=False)
    groove = door & (np.hypot(du, dv) > 0.62) & (np.hypot(du, dv) < 0.7)
    col[groove] = hexc(IRON[4])
    cv.obj(frame, col, GOLD[6])
    for k in range(12):
        a = k * math.pi / 6
        bx, by = cx + math.cos(a) * r * 0.9, cy + math.sin(a) * r * 0.9
        b, _, _ = ell(bx, by, 1.6, 1.6)
        cv.obj(b, fill(GOLD[1]), GOLD[5])
    # the wheel: a hub, a ring and six spokes
    wheel = np.zeros((S, S), bool)
    for k in range(6):
        a = k * math.pi / 3 + 0.26
        for t in np.linspace(0.1, 0.46, 10):
            wheel |= ell(cx + math.cos(a) * r * t, cy + math.sin(a) * r * t, 1.3, 1.3)[0]
    ring = (np.hypot(PX - cx, PY - cy) > r * 0.4) & (np.hypot(PX - cx, PY - cy) < r * 0.48)
    hub, _, _ = ell(cx, cy, r * 0.16, r * 0.16)
    wcol = fill(GOLD[2])
    wcol[(wheel | ring | hub) & ((PX - cx) + (PY - cy) < 0)] = hexc(GOLD[1])
    cv.obj(wheel | ring | hub, wcol, GOLD[6])
    # a star on the hub
    for (x, y) in ((0, -1), (-1, 0), (0, 0), (1, 0), (0, 1)):
        cv.px(int(cx) + x, int(cy) + y, GOLD[0])


def tier(n):
    cv = Canvas()
    if n == 1:  # Puñado
        ground(cv, 42, 70, 28, 6)
        pile(cv, 38, 68, 40, 10, 5, 10.5, seed=3, tilted=0.0)
        coin(cv, 55, 52, 13, ratio=0.93, rot=0.42, thick=4)
        sparkle(cv, 66, 34, True)
    elif n == 2:  # Bolsa
        ground(cv, 42, 72, 30, 6)
        mouth = sack(cv, 38, 70, 34, 42, patch=False)
        pile(cv, 38, mouth + 3, 18, 8, 4, 7.5, seed=11, tilted=0.3)
        stack(cv, 62, 70, 4, 9.5, seed=4)
        pile(cv, 44, 76, 44, 4, 3, 9, seed=12, tilted=0.0)
        sparkle(cv, 16, 30, True)
    elif n == 3:  # Saco
        ground(cv, 42, 75, 38, 7)
        stack(cv, 67, 72, 7, 8.5, seed=21)
        mouth = sack(cv, 36, 73, 50, 60)
        pile(cv, 36, mouth + 4, 30, 13, 9, 8, seed=14, tilted=0.3)
        pile(cv, 42, 78, 60, 6, 7, 8, seed=15, tilted=0.2)
        sparkle(cv, 70, 22, True)
    elif n == 4:  # Cofre
        ground(cv, 42, 76, 40, 7)
        top, x0, x1, front = chest(cv, 42, 71, 58, 26)
        pile(cv, 42, top + 4, 50, 14, 13, 8, seed=31, tilted=0.3)
        front()
        pile(cv, 44, 80, 62, 5, 6, 8, seed=33, tilted=0.25)
        sparkle(cv, 14, 22, True)
        sparkle(cv, 70, 14)
    elif n == 5:  # Arca
        ground(cv, 42, 77, 41, 7)
        stack(cv, 10, 73, 6, 8, seed=41)
        stack(cv, 74, 74, 7, 8, seed=42)
        top, x0, x1, front = chest(cv, 42, 71, 60, 29, royal=True)
        pile(cv, 42, top + 4, 54, 18, 17, 8.5, seed=43, tilted=0.3)
        front()
        pile(cv, 42, 81, 66, 4, 6, 8, seed=44, tilted=0.25)
        sparkle(cv, 8, 20, True)
        sparkle(cv, 76, 12, True)
        sparkle(cv, 62, 6)
    elif n == 6:  # Bóveda estelar
        ground(cv, 42, 78, 41, 7)
        vault(cv, 42, 32, 27)
        stack(cv, 9, 74, 7, 8, seed=51)
        stack(cv, 75, 75, 8, 8, seed=52)
        pile(cv, 42, 72, 56, 16, 15, 8.5, seed=53, tilted=0.3)
        pile(cv, 42, 81, 68, 4, 6, 8, seed=54, tilted=0.25)
        sparkle(cv, 6, 12, True)
        sparkle(cv, 78, 8, True)
        sparkle(cv, 74, 46)
        sparkle(cv, 10, 46)
    return cv.finish()
