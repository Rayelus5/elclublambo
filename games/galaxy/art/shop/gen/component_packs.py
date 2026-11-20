"""Components, after the products' names: Caja de piezas, Kit de componentes, Cajón técnico, Palé de componentes,
Contenedor de carga and Fábrica en una caja."""
import math
import numpy as np
from core import S, XX, YY, PX, PY, Canvas, ell, rect, poly, fill, tones, hexc, sphere_light, dilate4
from coins import ground, WOOD
from components import METAL, TEAL, HAZ, gear, nut, bolt, chip, cell, wrench, parts, toolbox, crate, pod, spark

CARD = ['#f6cf98', '#e0a96c', '#c3884c', '#966233', '#6a411d', '#45290f']


def card_box(cv, cx, base, w, h):
    """An open cardboard box: the back flap up, the side flaps open, a strip of tape on the front. Returns (top, front)."""
    x0, x1, y0 = cx - w / 2, cx + w / 2, base - h
    back = poly([(x0 + 3, y0), (x1 - 3, y0), (x1 - 6, y0 - h * 0.45), (x0 + 6, y0 - h * 0.45)])
    bcol = fill(CARD[3])
    bcol[back & (PY < y0 - h * 0.3)] = hexc(CARD[2])
    cv.obj(back, bcol, CARD[5])
    inside = poly([(x0 + 1, y0), (x1 - 1, y0), (x1 - 4, y0 - 4), (x0 + 4, y0 - 4)])
    cv.obj(inside, fill(CARD[4]), CARD[5])

    def front():
        for side in (-1, 1):
            ex = x0 if side < 0 else x1
            flap = poly([(ex, y0 + 1), (ex, y0 - 5), (ex + side * w * 0.26, y0 - 11), (ex + side * w * 0.3, y0 - 3)])
            fcol = fill(CARD[1] if side < 0 else CARD[2])
            cv.obj(flap, fcol, CARD[5])
        box = rect(x0, y0, x1, base)
        col = fill(CARD[2])
        col[box & (PY < y0 + 2)] = hexc(CARD[1])
        col[box & (PX > x1 - w * 0.3)] = hexc(CARD[3])
        col[box & (PY > base - 2)] = hexc(CARD[3])
        tape = box & (np.abs(PX - cx) < 3)
        col[tape] = hexc('#f2e6c8')
        col[tape & (PX > cx + 1)] = hexc('#d9c89e')
        cv.obj(box, col, CARD[5])
    return y0 - 2, front


def closed_box(cv, x0, y0, w, h, label=True):
    """A closed metal crate with a teal strip and its corners."""
    box = rect(x0, y0, x0 + w, y0 + h)
    col = fill(METAL[3])
    col[box & (PY < y0 + 2)] = hexc(METAL[1])
    col[box & (PX < x0 + 2)] = hexc(METAL[2])
    col[box & (PX > x0 + w - 2)] = hexc(METAL[4])
    col[box & (PY > y0 + h - 2)] = hexc(METAL[4])
    if label:
        strip = rect(x0 + 3, y0 + h * 0.45, x0 + w - 3, y0 + h * 0.45 + 2)
        col[strip] = hexc(TEAL[2])
    cv.obj(box, col, METAL[5])
    for (rx, ry) in ((x0 + 2, y0 + 2), (x0 + w - 3, y0 + 2), (x0 + 2, y0 + h - 3), (x0 + w - 3, y0 + h - 3)):
        cv.px(int(rx), int(ry), METAL[0])


def pallet(cv, cx, base, w):
    """A wooden pallet: a deck of planks over three blocks."""
    x0 = cx - w / 2
    deck = rect(x0, base - 7, x0 + w, base - 3)
    col = fill(WOOD[1])
    col[deck & (PY < base - 5.5)] = hexc(WOOD[0])
    for i in range(1, 5):
        gx = x0 + i * w / 5
        col[deck & (np.abs(PX - gx) < 0.5)] = hexc(WOOD[3])
    cv.obj(deck, col, WOOD[5])
    for bx in (x0 + 2, cx - 3, x0 + w - 8):
        blk = rect(bx, base - 3, bx + 6, base)
        bc = fill(WOOD[2])
        cv.obj(blk, bc, WOOD[5])
    return base - 7


def factory(cv, cx, base, w, h):
    """A little factory: a sawtooth roof, windows glowing teal, a chimney with hazard stripes and puffs, a gear."""
    x0, x1, y0 = cx - w / 2, cx + w / 2, base - h
    chim = rect(x1 - w * 0.28, y0 - h * 0.7, x1 - w * 0.12, y0 + 2)
    ccol = fill(METAL[3])
    ccol[chim & (PX < x1 - w * 0.22)] = hexc(METAL[2])
    top_band = chim & (PY < y0 - h * 0.7 + 4)
    ccol[top_band & (((XX + YY) // 2) % 2 == 0)] = hexc(HAZ[1])
    ccol[top_band & (((XX + YY) // 2) % 2 == 1)] = hexc('#20223e')
    cv.obj(chim, ccol, METAL[5])
    pts = [(x0, base), (x0, y0)]
    teeth = 3
    tw = w * 0.62 / teeth
    for i in range(teeth):
        pts += [(x0 + i * tw, y0), (x0 + i * tw + tw * 0.7, y0 - h * 0.35), (x0 + (i + 1) * tw, y0 - h * 0.35), (x0 + (i + 1) * tw, y0)]
    pts += [(x1, y0), (x1, base)]
    body = poly(pts)
    col = fill(METAL[2])
    col[body & (PY < y0)] = hexc(METAL[1])
    col[body & (PY < y0) & (((PX - x0) % tw) > tw * 0.7)] = hexc(METAL[3])
    col[body & (PX > x1 - 4)] = hexc(METAL[3])
    for i in range(3):
        for j in range(2):
            wx, wy = x0 + 4 + i * (w - 8) / 3, y0 + 4 + j * (h * 0.36)
            win = rect(wx, wy, wx + (w - 8) / 3 - 3, wy + h * 0.22)
            col[win] = hexc(TEAL[1])
            col[win & (PX > wx + 2)] = hexc(TEAL[2])
    cv.obj(body, col, METAL[5])
    for k, (px_, py_, r) in enumerate(((x1 - w * 0.2, y0 - h * 0.84, 3.5), (x1 - w * 0.12, y0 - h * 1.08, 4.5), (x1 - w * 0.02, y0 - h * 1.36, 5.5))):
        puff, pu, pv = ell(px_, py_, r, r * 0.85)
        pc = fill(TEAL[1])
        tones(pc, puff, sphere_light(pu, pv), [TEAL[0], TEAL[1], '#7fe7c4'], dither=False)
        cv.obj(puff, pc, TEAL[3])
    gear(cv, x0 + 2, y0 + h * 0.15, w * 0.2, teeth=9, rot=0.3, pal=TEAL)


def tier(n):
    cv = Canvas()
    if n == 1:  # Caja de piezas
        ground(cv, 42, 72, 30, 6)
        top, front = card_box(cv, 42, 70, 44, 26)
        gear(cv, 34, top - 4, 10, teeth=9, rot=0.2, pal=TEAL)
        gear(cv, 51, top - 1, 8, teeth=8, rot=0.5)
        bolt(cv, 40, top + 1, 14, -0.7)
        front()
        nut(cv, 70, 72, 5, rot=0.3, tilt=0.7)
        spark(cv, 68, 26, True)
    elif n == 2:  # Kit de componentes
        ground(cv, 42, 74, 34, 6)
        top, front = toolbox(cv, 40, 71, 52, 22)
        wrench(cv, 22, top - 2, 26, -0.75)
        parts(cv, 42, top + 3, 40, 10, 7, seed=5)
        front()
        nut(cv, 68, 74, 5, rot=0.4, tilt=0.65)
        bolt(cv, 10, 74, 11, -0.1)
        spark(cv, 70, 22, True)
    elif n == 3:  # Cajón técnico
        ground(cv, 42, 75, 38, 7)
        top, front = crate(cv, 42, 72, 58, 28)
        parts(cv, 42, top + 4, 50, 15, 12, seed=7)
        front()
        parts(cv, 44, 79, 64, 5, 5, seed=8)
        spark(cv, 12, 18, True)
        spark(cv, 72, 12)
    elif n == 4:  # Palé de componentes
        ground(cv, 42, 78, 40, 6)
        deck = pallet(cv, 42, 78, 70)
        closed_box(cv, 10, deck - 22, 30, 22)
        closed_box(cv, 18, deck - 40, 24, 18)
        top, front = crate(cv, 58, deck, 30, 20)
        parts(cv, 58, top + 3, 26, 10, 6, seed=21, scale=0.9)
        front()
        chip(cv, 30, deck - 46, 12, 8)
        spark(cv, 72, 16, True)
        spark(cv, 8, 14)
    elif n == 5:  # Contenedor de carga
        ground(cv, 42, 78, 40, 7)
        pod(cv, 42, 42, 50, 54)
        parts(cv, 42, 80, 70, 8, 8, seed=11)
        cell(cv, 10, 76, 8, 18)
        cell(cv, 75, 77, 8, 18)
        spark(cv, 42, 4, True)
        spark(cv, 12, 16, True)
        spark(cv, 72, 18, True)
    elif n == 6:  # Fábrica en una caja
        ground(cv, 42, 79, 41, 7)
        top, front = crate(cv, 42, 76, 62, 24)
        factory(cv, 40, top + 2, 40, 28)
        parts(cv, 42, top + 4, 56, 6, 6, seed=31)
        front()
        parts(cv, 42, 82, 70, 4, 5, seed=32)
        spark(cv, 10, 16, True)
        spark(cv, 76, 30, True)
        spark(cv, 66, 4)
    return cv.finish()
