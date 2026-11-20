"""The other avatars to earn (bloque C, C3): the static ghost (a lost operator rewritten by the Static), the
Cartographer (Ivet Sorn, whom nobody has seen: her face stays in the hood's shadow) and first contact (a hand that
is not human touching a visor)."""
import math
import numpy as np
from core import hexc, mix, sphere_light, BAYER
from palette import INK, CYAN, GOLD, UV, ICE, STEEL, TERM, TEAL, SOLAR
from portrait import canvas, shoulders, head_mask, HEAD
from fx import nebula_back, stars, noise


def static_ghost(f=0):
    """A lost operator made of static: a helmeted bust of noise in magenta and cyan, torn by scanlines, with two
    white eyes, dissolving at the bottom into the dark."""
    cv = canvas()
    nebula_back(cv, ['#33104a', '#26093a', '#1a062a', '#10031c', '#08010f'], seed=801, glow=(16, 14, 16, 0.25))
    # Braille cells, faint.
    for bx, by in ((2, 3), (26, 5), (3, 20), (27, 22)):
        for i in (0, 2, 3, 5):
            cv.back(cv.cells([(bx + (i // 3) * 2, by + (i % 3) * 2)]), '#541a6e')
    sh, _, _ = shoulders(cv, 22.5, 14)
    helmet, hu, hv = cv.ell(16, 12.5, 9.2, 10)
    body = sh | helmet
    n = noise(32, 32, 77, cell=3.0, octaves=2)
    col = cv.fill('#2a0d3a')
    col[body & (n > 0.38)] = hexc('#541a6e')
    col[body & (n > 0.5)] = hexc('#b73fe0')
    col[body & (n > 0.58)] = hexc('#ff4d6d')
    col[body & (n > 0.66)] = hexc('#6fe3ff')
    col[body & (n > 0.74)] = hexc('#ffffff')
    # The visor: darker, an opening of nothing.
    visor, _, _ = cv.ell(16, 13.5, 6.4, 4.4)
    col[visor] = hexc('#12051e')
    col[visor & (n > 0.62)] = hexc('#3a1450')
    # Dissolve at the bottom.
    keep = body & ~((cv.PY > 24) & (BAYER[cv.YY % 4, cv.XX % 4] < (cv.PY - 24) / 8))
    for y, x in zip(*np.nonzero(keep)):
        cv.glint(int(x), int(y), '#%02x%02x%02x' % tuple(col[y, x]))
    # Scanlines: some rows torn sideways.
    for y, dx in ((8, 2), (15, -2), (19, 1), (26, -1)):
        row = cv.c[y].copy()
        cv.c[y] = np.roll(row, dx, axis=0)
    # Chromatic fringes.
    edge_l = keep & ~np.roll(keep, 1, axis=1)
    edge_r = keep & ~np.roll(keep, -1, axis=1)
    for y, x in zip(*np.nonzero(edge_l)):
        if x > 0:
            cv.glint(int(x) - 1, int(y), '#ff4d6d')
    for y, x in zip(*np.nonzero(edge_r)):
        if x < 31:
            cv.glint(int(x) + 1, int(y), '#6fe3ff')
    # Eyes.
    for ex in (12, 19):
        cv.glint(ex, 13, '#ffffff')
        cv.glint(ex + 1, 13, '#ffffff')
        cv.glint(ex, 14, '#b8f6ff')
        cv.glint(ex + 1, 14, '#6fe3ff')
    return cv


def cartographer(f=0):
    """The Cartographer: a deep UV hood trimmed in gold, the face lost in shadow but for the chin and a monocle of
    braille light; behind her, a star chart and the ring of an astrolabe."""
    cv = canvas()
    nebula_back(cv, ['#26389a', '#1e2c80', '#172264', '#111848', '#0b0f30'], seed=802, glow=(16, 12, 18, 0.35))
    # Astrolabe ring and the chart.
    cv.back(cv.ring(16, 13, 13.2, 13.9), '#c27a12')
    cv.back(cv.ring(16, 13, 13.2, 13.9) & (cv.PY < 10), '#ffc94a')
    for k in range(12):
        a = k * math.pi / 6
        x, y = int(16 + math.cos(a) * 14.8), int(13 + math.sin(a) * 14.8)
        if 0 <= x < 32 and 0 <= y < 32:
            cv.back(cv.cells([(x, y)]), '#ffc94a')
    chart = (((3, 5), (6, 3), (9, 6)), ((24, 4), (27, 7), (29, 5)), ((2, 18), (4, 21)), ((28, 17), (30, 20)))
    for line in chart:
        for (x0, y0), (x1, y1) in zip(line, line[1:]):
            n = max(abs(x1 - x0), abs(y1 - y0))
            for i in range(1, n):
                cv.back(cv.cells([(round(x0 + (x1 - x0) * i / n), round(y0 + (y1 - y0) * i / n))]), '#3a58e0')
        for (x, y) in line:
            cv.back(cv.cells([(x, y)]), '#bfe3ff')
    cloak = ['#9b86ff', '#7259ee', '#5a43d6', '#3a2a9a', '#22185e', '#130c36']
    # The cloak over the shoulders.
    sh, u, v = shoulders(cv, 21.5, 15.5)
    ccol = cv.fill(cloak[3])
    cv.tones(ccol, sh, np.clip(0.55 - u * 0.5 - (v + 0.5) * 0.2, 0, 1), cloak[1:5], dither=False)
    cv.obj(sh, ccol, cloak[5])
    # The hood.
    hood = cv.poly([(16, 2), (21, 3), (25, 7), (26.5, 13), (26, 20), (24, 25), (8, 25), (6, 20), (5.5, 13), (7, 7),
                    (11, 3)])
    hcol = cv.fill(cloak[2])
    cv.tones(hcol, hood, np.clip(0.95 - (cv.PX - 5) / 22 - (cv.PY - 2) / 30, 0, 1), cloak[0:4], dither=True,
             spread=0.5)
    cv.obj(hood, hcol, cloak[5])
    # Fold lines.
    for pts in (((9, 8), (8, 11), (8, 14)), ((23, 9), (24, 12), (24, 16))):
        for x, y in pts:
            cv.px(x, y, cloak[3])
    # The opening: shadow, with a gold trim.
    opening = cv.poly([(16, 6), (20, 7.5), (22, 11), (22, 18), (19, 23), (13, 23), (10, 18), (10, 11), (12, 7.5)])
    ocol = cv.fill('#0b0820')
    # Only the line of the jaw and the lips catch a little light.
    jaw = opening & (np.abs(np.hypot((cv.PX - 16) / 4.6, (cv.PY - 17.2) / 4.6) - 1) < 0.12) & (cv.PY > 18.5)
    ocol[jaw] = hexc('#3e2a44')
    cv.obj(opening, ocol, GOLD[3])
    cv.px(15, 19, '#6a3a52')
    cv.px(16, 19, '#6a3a52')
    # Gold trim highlight on the left of the opening.
    for x, y in ((11, 9), (10, 12), (10, 15)):
        cv.px(x, y, GOLD[1])
    # The braille monocle on the right eye, and the other eye a faint glint.
    cv.stamp(17, 12, ['.gg.', 'gwcg', 'gccg', '.gg.'], {'g': GOLD[2], 'w': '#ffffff', 'c': '#bfe3ff'})
    cv.glint(13, 14, '#6f86c8')
    # The brooch: an ECN plate with braille dots.
    cv.stamp(14, 25, ['gggg', 'gwkg', 'gkwg', 'gggg'], {'g': GOLD[2], 'w': GOLD[0], 'k': '#7a3d08'})
    cv.finish()
    cv.glint(19, 13, '#ffffff')
    for x, y in ((21, 11), (22, 13), (20, 10)):
        cv.glint(x, y, '#e6f6ff') if (x + y) % 2 else None
    cv.sparkle(5, 27, 1, core='#ffffff', mid='#bfe3ff')
    return cv


def first_contact(f=0):
    """First contact: an operator's helmet with a gold visor and, reaching in from the edge, a hand that is not
    human; where its fingertip touches the glass, light ripples out."""
    cv = canvas()
    nebula_back(cv, ['#2a40b0', '#203296', '#1a2670', '#121a4e', '#0b0f30'], seed=803, glow=(21, 13, 16, 0.4))
    # A spiral galaxy far behind.
    gal, gu, gv = cv.ell(26, 6, 4.5, 2.2, rot=-0.4)
    cv.back(gal, '#7259ee')
    cv.back(cv.ell(26, 6, 2.4, 1.2, rot=-0.4)[0], '#b39dff')
    cv.back(cv.cells([(26, 6)]), '#ffffff')
    stars(cv, 10, 21, colors=('#ffffff', '#bfe3ff'), big=1)
    white = ['#ffffff', '#e6f0ff', '#c4d2f2', '#8f9dd0', '#5d6aa6']
    # Shoulders of the suit.
    sh, u, v = shoulders(cv, 25, 13, cx=12)
    scol = cv.fill(white[2])
    cv.tones(scol, sh, np.clip(0.6 - u * 0.5 - (v + 0.5) * 0.2, 0, 1), white[1:5], dither=False)
    cv.obj(sh, scol, '#3a4270')
    # The helmet shell.
    shell, hu, hv = cv.ell(12.5, 15, 10.5, 10.5)
    hcol = cv.fill(white[2])
    cv.tones(hcol, shell, sphere_light(np.clip(hu, -1, 1), np.clip(hv, -1, 1)), white, dither=False)
    cv.obj(shell, hcol, '#3a4270')
    # Gold visor with reflections.
    visor, vu, vv = cv.ell(13.2, 15.5, 7.6, 6.4)
    vcol = cv.fill(GOLD[3])
    cv.tones(vcol, visor, np.clip(0.95 - (vv + 1) * 0.5 - vu * 0.15, 0, 1),
             ['#fffbe6', '#ffe58a', '#ffc94a', '#e0962a', '#c27a12', '#7a3d08', '#3a1d08'], dither=True, spread=0.5)
    cv.obj(visor, vcol, '#3a1d08')
    # The reflection of the galaxy and a streak.
    for x, y in ((9, 12), (10, 11), (11, 11)):
        cv.glint(x, y, '#ffffff')
    cv.glint(8, 13, '#fff3c4')
    # The hand: teal skin, long fingers, a palm entering from the right.
    skin = ['#c8fff4', '#7ff0e4', '#3fe0d0', '#22b3a8', '#0a4f4c']
    palm, pu, pv = cv.ell(30.5, 21.5, 4.2, 3.8, rot=0.2)
    palm |= cv.rect(29.5, 18, 32, 27)
    for fm in (cv.seg(29, 26, 25.5, 28.5, 0.95), cv.seg(28, 23.2, 24, 23.6, 0.95)):
        fcol = cv.fill(skin[2])
        fcol[fm & (cv.PY < cv.PY.mean())] = hexc(skin[2])
        cv.obj(fm, fcol, skin[4])
    kcol = cv.fill(skin[2])
    kcol[palm & (cv.PY < 20)] = hexc(skin[1])
    kcol[palm & (cv.PX > 30.5)] = hexc(skin[3])
    cv.obj(palm, kcol, skin[4])
    index = cv.seg(27.5, 19.5, 20.2, 15.3, 1.0)
    icol = cv.fill(skin[1])
    icol[index & (cv.PY > 17.5 - (cv.PX - 20) * 0.55)] = hexc(skin[2])
    cv.obj(index, icol, skin[4])
    cv.px(24, 17, skin[3])
    cv.finish()
    # The touch: a glowing fingertip and ripples on the visor.
    cv.glint(19, 15, '#ffffff')
    cv.glint(20, 15, '#b8f6ff')
    for r, c in ((2.2, '#b8f6ff'), (3.6, '#6fe3ff')):
        ring = cv.ring(19.2, 15.5, r - 0.45, r + 0.45) & visor & (cv.PX < 19.5)
        for y, x in zip(*np.nonzero(ring)):
            cv.glint(int(x), int(y), c)
    for x, y in ((22, 20), (25, 26)):
        cv.glint(x, y, '#c8fff4')
    return cv
