"""The shop's avatars (bloque C, C3): premium pieces sold for real money, so each carries more than a crew portrait.
The Nebula Queen and the Void Knight are animated (four frames at 6 fps, looping); the star fox and the comet rider
are still but full of light."""
import math
import numpy as np
from core import hexc, mix, sphere_light, BAYER
from palette import INK, GOLD, UV, CYAN, SOLAR, ICE, STEEL, SKIN, NOVA, CORAL, GLITCH
from portrait import canvas, backdrop, shoulders, shade_body, head, neck, eyes, brows, nose, mouth, head_mask, \
    skin_shade, HEAD, done, rim_light
from fx import nebula_back, stars, noise

FRAMES = 4


def twinkle(cv, spots, f, core='#ffffff', mid='#f3efff'):
    """Stars that grow and fade out of phase across the loop."""
    for i, (x, y) in enumerate(spots):
        phase = (f + i) % FRAMES
        if phase == 0:
            cv.sparkle(x, y, 1, core=core, mid=mid)
        elif phase == 1:
            cv.glint(x, y, core)
        elif phase == 3:
            cv.glint(x, y, mid)


def nebula_queen(f=0):
    """The Nebula Queen: lavender skin, eyes of white light and a tiara of stars; her hair is a nebula whose colours
    flow through pink, violet and cyan, with stars twinkling in it. A high gold collar on a starry gown."""
    cv = canvas()
    nebula_back(cv, ['#3a1450', '#2a0d3a', '#1e0a2c', '#14061e', '#0a0212'], seed=901, glow=(16, 12, 16, 0.2))
    stars(cv, 8, 41, colors=('#f3efff', '#b39dff'))
    # The hair: a cloud round the head, its edge broken by noise, its colours cycling across the loop.
    n_edge = noise(32, 32, 55, cell=4.0, octaves=2)
    n_col = noise(32, 32, 56, cell=7.0, octaves=2)
    ex = np.hypot((cv.PX - 16) / 14.5, (cv.PY - 13) / 12.5)
    hair = (ex < 0.9 + (n_edge - 0.5) * 0.45) & (cv.PY < 27)
    cyc = ['#ff8fb3', '#ff6b9a', '#e05cff', '#b39dff', '#7259ee', '#4767f2', '#6fb7ff', '#6fe3ff']
    deep = ['#c94f7c', '#b02a6a', '#8e2bb3', '#6a4bd8', '#3a2a9a', '#26389a', '#3a58e0', '#2fb8e0']
    v = (n_col * 2.0 + f / FRAMES) % 1.0
    idx = np.floor(v * len(cyc)).astype(int) % len(cyc)
    col = cv.fill(cyc[0])
    outer = ex > 0.72 + (n_edge - 0.5) * 0.3
    for i in range(len(cyc)):
        col[hair & (idx == i)] = hexc(cyc[i])
        col[hair & (idx == i) & outer] = hexc(deep[i])
    # Shade the right side of the cloud.
    sh = hair & (cv.PX > 22) & (BAYER[cv.YY % 4, cv.XX % 4] < 0.5)
    for i in range(len(cyc)):
        col[sh & (idx == i)] = hexc(deep[i])
    cv.obj(hair, col, '#3a1450')
    tone = ['#f3efff', '#d6ccff', '#ad9df0', '#7f6fcc', '#3e2a80']
    # Gown and collar.
    gown = ['#7259ee', '#5a43d6', '#3a2a9a', '#22185e', '#130c36']
    sm, u, vv = shoulders(cv, 23.5, 14.5)
    gcol = shade_body(cv, sm, u, vv, gown)
    cv.obj(sm, gcol, gown[4])
    for x, y in ((6, 28), (9, 30), (24, 27), (27, 30), (21, 30)):
        cv.px(x, y, '#f3efff')
    neck(cv, tone, top=18, bottom=23, half=2.5)
    collar = cv.poly([(9, 21.5), (12.5, 23), (16, 24), (19.5, 23), (23, 21.5), (24, 25.5), (16, 28), (8, 25.5)])
    ccol = cv.fill(GOLD[2])
    ccol[collar & (cv.PY < 24)] = hexc(GOLD[1])
    ccol[collar & (cv.PX > 19)] = hexc(GOLD[3])
    cv.obj(collar, ccol, GOLD[5])
    gem = cv.cells([(15, 25), (16, 25), (15, 26), (16, 26)])
    cv.obj(gem, '#6fe3ff', '#0e4a6e')
    cv.px(15, 25, '#f3feff')
    # Face.
    hm = head(cv, tone, widths=[8, 10, 12, 12, 12, 12, 12, 12, 12, 12, 10, 10, 8, 6, 4], line='#3e2a80')
    # Hair falling over the forehead edges.
    fr = cv.poly([(9.5, 6), (16, 4.5), (22.5, 6), (22, 10.5), (20, 8), (16, 7), (12, 8), (10, 10.5)])
    fcol = col.copy()
    cv.obj(fr, fcol, '#3a1450')
    # Eyes of light, two pixels tall, with lashes.
    for x in (11, 12, 13, 18, 19, 20):
        cv.px(x, 11, '#3e2a80')
    cv.px(10, 10, '#3e2a80')
    cv.px(21, 10, '#3e2a80')
    for x, c in ((11, '#6fe3ff'), (12, '#ffffff'), (13, '#b8f6ff'), (18, '#b8f6ff'), (19, '#ffffff'),
                 (20, '#6fe3ff')):
        cv.glint(x, 12, c)
    for x, c in ((11, '#2fb8e0'), (12, '#6fe3ff'), (13, '#6fe3ff'), (18, '#6fe3ff'), (19, '#6fe3ff'),
                 (20, '#2fb8e0')):
        cv.glint(x, 13, c)
    cv.px(12, 14, tone[3])
    cv.px(19, 14, tone[3])
    nose(cv, 15, tone)
    cv.px(15, 18, '#b02a6a')
    cv.px(16, 18, '#b02a6a')
    cv.px(15, 17, '#e05cff')
    # The star on the forehead and the tiara.
    cv.stamp(15, 9, ['.s', 'ss'], {'s': GOLD[1]})
    tiara = [(10, 6, 0), (13, 4, 1), (16, 2, 2), (19, 4, 1), (22, 6, 0)]
    for x, y, size in tiara:
        cv.stamp(x - size, y - size, ['.s.', 'sws', '.s.'] if size < 2 else ['..s..', '.sss.', 'sswss', '.sss.',
                                                                               '..s..'],
                 {'s': GOLD[2], 'w': '#ffffff'})
    done(cv, rim='#e05cff', t=0.4)
    twinkle(cv, [(4, 6), (27, 9), (6, 18), (25, 20), (13, 1)], f)
    # The tiara's centre star flashes once per loop.
    if f == 0:
        cv.sparkle(16, 2, 2, core='#ffffff', mid='#fffbe6', tip=GOLD[1])
    return cv


def void_knight(f=0):
    """The Void Knight: a horned great helm of dark steel lit violet by the rift behind it, its T visor burning,
    and void flames rising from the pauldrons. The visor pulses and the flames climb across the loop."""
    cv = canvas()
    nebula_back(cv, ['#22185e', '#1a1248', '#120c34', '#0b0822', '#060412'], seed=902, glow=(16, 14, 16, 0.15))
    # The rift: a jagged crack of light behind the helm, pulsing.
    rng = np.random.default_rng(5)
    x = 16.0
    pulse = (0, 1, 2, 1)[f]
    for y in range(0, 32):
        x += rng.uniform(-1.2, 1.2)
        x = np.clip(x, 13, 19)
        w = 1.4 + pulse * 0.4 + (0.8 if 10 < y < 22 else 0)
        for dx in range(-3, 4):
            px = int(x) + dx
            if 0 <= px < 32:
                dd = abs(dx)
                if dd <= w * 0.4:
                    cv.back(cv.cells([(px, y)]), '#f3efff' if pulse == 2 else '#d9ccff')
                elif dd <= w:
                    cv.back(cv.cells([(px, y)]), '#9b86ff')
                elif dd <= w + 1.2:
                    cv.back(cv.cells([(px, y)]), '#5a43d6')
    # Void flames rising from the shoulders.
    for (x0, amp, ph) in ((4.5, 1.5, 0.0), (8, 1.2, 1.7), (24, 1.2, 0.9), (27.5, 1.5, 2.4)):
        for y in range(10, 27):
            t = (26 - y) / 16
            cxw = x0 + amp * math.sin(y / 2.2 + ph - f * math.pi / 2)
            wdt = 2.6 * (1 - t) + 0.3
            for xx in range(int(cxw - wdt), int(cxw + wdt) + 1):
                if 0 <= xx < 32:
                    edge = abs(xx + 0.5 - cxw) > wdt - 1
                    cv.back(cv.cells([(xx, y)]), '#7259ee' if edge else '#3a2a9a')
    steel = ['#9b86ff', '#6a5fb0', '#4b4580', '#2e2a58', '#1c1838', '#0e0c20']
    # Gorget plates and rounded pauldrons with a lilac band.
    gorget = cv.rect(10, 21, 22, 32)
    gcol = cv.fill(steel[3])
    gcol[gorget & (cv.YY % 3 == 1)] = hexc(steel[2])
    gcol[gorget & (cv.YY % 3 == 0)] = hexc(steel[4])
    cv.obj(gorget, gcol, steel[5])
    for cx0 in (4.0, 28.0):
        pl, pu, pv = cv.ell(cx0, 29, 9, 6.5)
        pcol = cv.fill(steel[2])
        cv.tones(pcol, pl, sphere_light(np.clip(pu, -1, 1), np.clip(pv, -1, 1)), steel[0:5], dither=False)
        band = pl & (np.abs(np.hypot((cv.PX - cx0) / 9, (cv.PY - 29) / 6.5) - 0.62) < 0.08)
        pcol[band] = hexc('#b39dff')
        cv.obj(pl, pcol, steel[5])
    # Horns: thick at the helm, curling out and up, ringed.
    bone = ['#efeaff', '#c9c0f0', '#9a8fd0', '#62579a', '#2e2858']
    for side in (-1, 1):
        hm = np.zeros((32, 32), bool)
        tt = np.zeros((32, 32))
        for t in np.linspace(0, 1, 40):
            hx = 16 + side * (8 + 7.5 * math.sin(t * 2.0))
            hy = 11 - 9.5 * t
            c_ = cv.circle(hx, hy, 2.6 - t * 2.0)
            tt = np.where(c_ & ~hm, t, tt)
            hm |= c_
        hcol = cv.fill(bone[2])
        hcol[hm & (tt < 0.5) & ((cv.PY - 11 + 9.5 * tt) < 0)] = hexc(bone[1])
        hcol[hm & (np.floor(tt * 7) % 2 == 1)] = hexc(bone[3])
        hcol[hm & (tt > 0.8)] = hexc(bone[0])
        cv.obj(hm, hcol, bone[4])
    # The helm: a dome over a face plate that narrows to the jaw.
    dome, du, dv = cv.ell(16, 11.5, 8.4, 9)
    dome &= cv.PY < 12
    plate = cv.poly([(7.6, 11.5), (24.4, 11.5), (24, 18), (20.5, 23), (11.5, 23), (8, 18)])
    helm = dome | plate
    hc = cv.fill(steel[2])
    lv = np.clip(0.8 - (cv.PX - 8) / 17 - (cv.PY - 3) / 26, 0, 1)
    cv.tones(hc, helm, lv, steel[0:5], dither=False)
    # The crest ridge, the rim of the dome and the rift's violet on the right edge.
    hc[helm & (np.abs(cv.PX - 16) < 0.6) & (cv.PY < 10)] = hexc('#d9ccff')
    hc[helm & (np.abs(cv.PX - 15) < 0.6) & (cv.PY < 10)] = hexc(steel[1])
    hc[helm & (np.abs(cv.PY - 11.5) < 0.6)] = hexc(steel[4])
    hc[helm & (np.abs(cv.PY - 10.5) < 0.5) & (cv.PX < 15)] = hexc('#b39dff')
    cv.obj(helm, hc, steel[5])
    # Fin on top and the brow gem.
    cv.obj(cv.rect(15, 0.5, 17, 3), '#d9ccff', steel[5])
    cv.stamp(15, 8, ['gg', 'GG'], {'g': '#6fe3ff', 'G': '#2fb8e0'})
    cv.glint(15, 8, '#f3feff')
    # Breathing holes.
    for x, y in ((12, 19), (13, 20), (12, 21), (19, 19), (18, 20), (19, 21)):
        cv.px(x, y, steel[5])
    # The T visor: dark slit, its light pulsing.
    slit = cv.rect(10, 12, 22, 14) | cv.rect(15, 14, 17, 20)
    cv.obj(slit, '#05030c', '#05030c')
    glow = [('#5a43d6', '#9b86ff'), ('#7259ee', '#d9ccff'), ('#9b86ff', '#ffffff'), ('#7259ee', '#d9ccff')][f]
    for x in range(11, 21):
        cv.glint(x, 12, glow[0])
        cv.glint(x, 13, glow[1] if 12 <= x <= 19 else glow[0])
    for y in range(14, 19):
        cv.glint(15, y, glow[0])
        cv.glint(16, y, glow[1] if y < 17 else glow[0])
    done(cv, rim='#9b86ff', t=0.5)
    # Embers of void drifting up.
    for i, (x, y0) in enumerate(((3, 22), (28, 20), (7, 14), (25, 12))):
        y = y0 - ((f + i) % FRAMES) * 2
        cv.glint(x, y, '#b39dff')
    return cv


def star_fox(f=0):
    """A celestial fox: night-blue fur scattered with stars and a constellation on its brow, a white muzzle, golden
    eyes and ears that glow; a crescent moon rises behind it in a twilight sky."""
    cv = canvas()
    sky = ['#ff8fb3', '#c94f7c', '#7a3a8a', '#4a2a7a', '#2a1c5a', '#160f38']
    val = np.clip((cv.PY - 2) / 34, 0, 1)
    col = cv.fill(sky[-1])
    cv.tones(col, np.ones((32, 32), bool), val, sky[::-1], dither=True, spread=0.6)
    cv.back(np.ones((32, 32), bool), col)
    stars(cv, 9, 31, colors=('#ffffff', '#ffe58a'), avoid=(cv.PY > 18))
    # Crescent moon.
    moon = cv.circle(26.5, 5.5, 3.8) & ~cv.circle(28, 4.5, 3.2)
    cv.back(moon, '#ffe58a')
    cv.back(moon & (cv.PX < 24.5), '#fffbe6')
    fur = ['#8fa8ff', '#5a78f0', '#3a52c8', '#26389a', '#17225e', '#0e1440']
    cream = ['#ffffff', '#e6f0ff', '#bfd2f5', '#8fa0d8']
    # Chest fluff.
    chest = cv.poly([(5, 32), (8, 25), (12, 23), (16, 25), (20, 23), (24, 25), (27, 32)])
    ccol = cv.fill(cream[1])
    ccol[chest & (cv.PX > 19)] = hexc(cream[2])
    for x, y in ((10, 27), (14, 28), (18, 28), (22, 27), (12, 30), (20, 30)):
        ccol[y, x] = hexc(cream[2])
    cv.obj(chest, ccol, cream[3])
    # Ears.
    for side in (-1, 1):
        ear = cv.poly([(16 + side * 3, 7), (16 + side * 10.5, 0), (16 + side * 11, 11)])
        ecol = cv.fill(fur[2])
        ecol[ear & ((cv.PX - 16) * side > 9.5)] = hexc(fur[3])
        inner = cv.poly([(16 + side * 5.5, 7), (16 + side * 9.8, 2.5), (16 + side * 9.8, 9)])
        ecol[inner] = hexc(SOLAR[2])
        ecol[inner & (cv.PY < 5)] = hexc(SOLAR[1])
        cv.obj(ear, ecol, fur[5])
    # Head: wide cheeks with tufts, narrowing to the muzzle.
    headp = cv.poly([(16, 5), (21, 6), (24.5, 10), (26, 15), (28.5, 18), (24.5, 19), (21, 22.5), (18, 24.5),
                     (14, 24.5), (11, 22.5), (7.5, 19), (3.5, 18), (6, 15), (7.5, 10), (11, 6)])
    hcol = cv.fill(fur[2])
    lv = np.clip(0.85 - (cv.PX - 4) / 26 - (cv.PY - 5) / 26, 0, 1)
    cv.tones(hcol, headp, lv, fur[0:5], dither=False)
    # White cheeks and muzzle.
    cheeks = headp & (cv.PY > 15.5) & (np.abs(cv.PX - 16) > 1.5 + (cv.PY - 15.5) * 0.1)
    muzzle = headp & (np.abs(cv.PX - 16) < 3.5 - (cv.PY - 16) * 0.25) & (cv.PY > 15)
    hcol[cheeks | muzzle] = hexc(cream[1])
    hcol[(cheeks | muzzle) & (cv.PX > 19)] = hexc(cream[2])
    # Stars in the fur.
    for x, y in ((9, 11), (23, 12), (20, 8), (11, 16), (24, 16)):
        hcol[y, x] = hexc('#ffffff')
    cv.obj(headp, hcol, fur[5])
    # The constellation on the brow.
    for (x, y) in ((14, 8), (15, 9), (16, 10), (17, 9), (18, 8)):
        cv.px(x, y, fur[1])
    for (x, y) in ((14, 8), (16, 10), (18, 8)):
        cv.glint(x, y, '#ffffff')
    # Eyes: golden almonds with slit pupils.
    cv.stamp(10, 13, ['kkkk.', 'ksskk', '.kssk', '..kk.'], {'k': fur[5], 's': SOLAR[2]})
    cv.stamp(17, 13, ['.kkkk', 'kkssk', 'kssk.', '.kk..'], {'k': fur[5], 's': SOLAR[2]})
    cv.px(12, 14, '#3a1700')
    cv.px(19, 14, '#3a1700')
    cv.glint(11, 14, '#fffbe6')
    cv.glint(18, 14, '#fffbe6')
    # Nose and mouth.
    cv.stamp(15, 19, ['kk', 'kk'], {'k': '#160f38'})
    cv.glint(15, 19, '#6f86c8')
    cv.px(16, 21, '#8fa0d8')
    cv.px(15, 22, '#8fa0d8')
    cv.px(17, 22, '#8fa0d8')
    # Gold collar with a star charm.
    col_band = cv.poly([(9, 24), (16, 26), (23, 24), (23, 25.5), (16, 27.5), (9, 25.5)])
    bcol = cv.fill(GOLD[2])
    bcol[col_band & (cv.PY < 25.2)] = hexc(GOLD[1])
    cv.obj(col_band, bcol, GOLD[5])
    cv.stamp(15, 27, ['.s.', 'sws', '.s.'], {'s': GOLD[2], 'w': '#ffffff'})
    done(cv, rim='#ff8fb3', t=0.35)
    cv.sparkle(4, 4, 1, core='#ffffff', mid='#ffe58a')
    cv.sparkle(29, 22, 1, core='#ffffff', mid='#ffb8d0')
    return cv


def comet_rider(f=0):
    """The comet rider: goggles up, a wink and a grin, hair and a long scarf whipped back by the wind of the comet
    that streaks behind them across the night."""
    cv = canvas()
    nebula_back(cv, ['#3a58e0', '#2a40b0', '#1e2c80', '#151e58', '#0c1236'], seed=904, glow=(26, 5, 14, 0.5))
    stars(cv, 9, 51, colors=('#ffffff', '#bfe3ff'))
    # The comet: a bright head at the top right, its tail streaming down to the left behind the rider.
    a = math.atan2(1, -1.1)
    along = -(cv.PX - 27) * 0.74 + (cv.PY - 5) * 0.67
    across = (cv.PX - 27) * 0.67 + (cv.PY - 5) * 0.74
    tail = (along > 0) & (np.abs(across) < 1.2 + along * 0.22)
    tv = np.clip(1 - along / 40 - np.abs(across) / (1.5 + along * 0.25) * 0.6, 0, 1)
    tcol = cv.fill('#3a58e0')
    cv.tones(tcol, tail, tv, ['#ffffff', '#bff3ff', '#6fd0e8', '#6fb7ff', '#3a58e0'], dither=True, spread=0.7)
    cv.back(tail, tcol)
    cv.back(cv.circle(27, 5, 3.2), '#bff3ff')
    cv.back(cv.circle(27, 5, 2.1), '#ffffff')
    tone = 'light'
    jacket = ['#ffffff', '#e4e8f8', '#b9c0e0', '#7f88b8', '#454c80']
    sm, u, v = shoulders(cv, 23, 14.5)
    jcol = shade_body(cv, sm, u, v, jacket)
    # A Solar racing stripe.
    stripe = sm & (np.abs(cv.PX - 10.5 + (cv.PY - 23) * 0.3) < 1.3)
    jcol[stripe] = hexc(SOLAR[2])
    cv.obj(sm, jcol, jacket[4])
    neck(cv, tone)
    # Scarf flowing back to the left.
    sc = np.zeros((32, 32), bool)
    for t in np.linspace(0, 1, 40):
        x = 16 - t * 17
        y = 21.5 + math.sin(t * 7) * 1.4 + t * 2
        sc |= cv.circle(x, y, 2.2 - t * 0.6)
    wrap = cv.rect(11, 20, 21, 23.5)
    scol = cv.fill(NOVA[2])
    scol[(sc | wrap) & (cv.PY < 21)] = hexc(NOVA[1])
    scol[(sc | wrap) & (cv.PY > 22.5)] = hexc(NOVA[3])
    cv.obj(sc | wrap, scol, NOVA[4])
    # Hair whipped back.
    hair = ['#5a5a86', '#36365e', '#22223f', '#141428']
    hm = cv.poly([(9.5, 13), (8, 8), (10.5, 4.5), (15, 3), (20, 3.5), (22.5, 6), (22.5, 10), (21, 8), (17, 7.5),
                   (13, 8), (10.5, 10)])
    streams = cv.poly([(10, 6), (3, 5), (6, 7.5), (1, 9), (7, 10), (3, 12.5), (9.5, 12)])
    hcol = cv.fill(hair[1])
    hcol[(hm | streams) & (cv.PY < 7)] = hexc(hair[0])
    hcol[(hm | streams) & (cv.PX > 19)] = hexc(hair[2])
    cv.obj(hm | streams, hcol, hair[3])
    head(cv, tone)
    # Hair over the forehead again (drawn after the head).
    fringe = cv.poly([(10, 9.5), (11, 5.5), (16, 4), (21, 5), (22, 9.5), (19, 7.5), (15, 7), (12, 8.5)])
    fcol = cv.fill(hair[1])
    fcol[fringe & (cv.PY < 6.5)] = hexc(hair[0])
    cv.obj(fringe, fcol, hair[3])
    # Goggles pushed up.
    cv.obj(cv.rect(9, 7, 23, 8.5), STEEL[3], STEEL[5])
    for gx in (12.5, 19.5):
        g, gu, gv = cv.ell(gx, 7.5, 2.4, 1.9)
        gcol = cv.fill(CYAN[2])
        gcol[g & (cv.PY < 7.5)] = hexc(CYAN[1])
        gcol[g & (cv.PX > gx + 0.5) & (cv.PY > 7.5)] = hexc(CYAN[3])
        cv.obj(g, gcol, STEEL[5])
        cv.glint(int(gx) - 1, 7, '#ffffff')
    # A wink and a grin.
    brows(cv, 10, hair[2], shape='arch')
    for x, y in ((11, 13), (12, 12), (13, 13)):
        cv.px(x, y, SKIN[tone][4])
    cv.px(18, 12, SKIN[tone][4])
    cv.px(19, 12, SKIN[tone][4])
    cv.px(18, 13, '#2a1a12')
    cv.px(19, 13, '#f3f5ff')
    nose(cv, 15, tone)
    mouth(cv, 18, tone, 'grin')
    done(cv, rim='#bff3ff', t=0.5)
    cv.sparkle(27, 5, 2, core='#ffffff', mid='#ffffff', tip='#bff3ff')
    for x, y in ((3, 18), (6, 26)):
        cv.glint(x, y, '#bff3ff')
    return cv
