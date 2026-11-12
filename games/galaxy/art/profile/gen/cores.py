"""Portraits of the Núcleos (bloque C, C3), earned by purging them: the six bosses of the incursions as close-up,
heroic cards. Each keeps the in-game silhouette and colours (apps/web/src/arena/sprites/bosses.ts and the hive in
fauna.ts) and adds what a 40×40 sprite cannot: depth, glow and its sector behind it."""
import math
import numpy as np
from core import hexc, mix, dilate4, sphere_light, FILL
from palette import P, INK, NOVA, ICE, CYAN, TERM, CORAL, UV, GLITCH, SOLAR, STEEL, LAVA
from portrait import canvas
from fx import nebula_back, stars, hex_cells, crack, mite, noise


def sph(cv, cx, cy, r):
    m, u, v = cv.ell(cx, cy, r, r)
    return m, np.clip(u, -0.999, 0.999), np.clip(v, -0.999, 0.999)


def halo(cv, cx, cy, r0, r1, color, alpha):
    """A soft ring of light on the backdrop (blended, outside the figure)."""
    d = np.hypot(cv.PX - cx, cv.PY - cy)
    for k in range(4):
        rr = r0 + (r1 - r0) * (k + 1) / 4
        m = (d <= rr) & (cv.k == 5)
        cv.blend(m, color, int(alpha * (1 - k / 4) * 0.5))


def hive(f=0):
    """La Colmena Rota: the cracked hive close up, its hexagonal cells, the three cracks of the Static and the hungry
    core that glows where the queen used to be. Mites swarm round it in the pink gas of the Nebulosa Exterior."""
    cv = canvas()
    nebula_back(cv, ['#6a2048', '#4a1434', '#33102a', '#200a1c', '#120410'], seed=101, glow=(16, 18, 20, 0.2))
    stars(cv, 7, 3, colors=('#ffd0e0', '#ff8fb3'))
    cx, cy, R = 16.0, 18.0, 13.6
    halo(cv, cx, cy, R, R + 2.5, '#ff8fb3', 90)
    body, u, v = sph(cv, cx, cy, R)
    lat = np.arcsin(v)
    lon = np.arcsin(np.clip(u / np.sqrt(1 - v * v), -1, 1))
    gx, gy = lon * 1.45 + 7.3, lat * 1.45 + 7.0
    bid, edge, bdx, bdy = hex_cells(gx, gy)
    light = sphere_light(u, v)
    col = cv.fill(NOVA[3])
    ramp = ['#ffb0b9', '#ff6b7a', '#e8435a', '#b02a48', '#7a1a34', '#4a0f22']
    cell_v = light * 0.8 + 0.1 + np.clip(bdx + bdy, -0.5, 0.5) * 0.5
    cv.tones(col, body, np.clip(cell_v, 0, 1), ramp, dither=False)
    walls = body & (edge < 0.14)
    col[walls] = hexc('#3a0a1c')
    # The rim of each wall catches the light on its upper left.
    ridge = body & ~walls & dilate4(walls) & ((bdx + bdy) < -0.1) & (light > 0.45)
    col[ridge] = hexc('#ffb0b9')
    # Larva cells: some glow magenta.
    h = (bid * 2654435761) % 11
    larva = body & ~walls & (h == 3) & (np.hypot(u, v) < 0.85)
    col[larva] = hexc('#ff4d6d')
    col[larva & (np.hypot(bdx, bdy) < 0.22)] = hexc('#ffd0dc')
    cv.obj(body, col, '#2a0816')
    # Cracks of the Static, jagged, white near the core and cyan out to the rim.
    for k, a in enumerate((0.4, 2.5, 4.3)):
        pts = crack(cv, cx + math.cos(a) * 3.5, cy + math.sin(a) * 3.5, a, R - 3.2, seed=40 + k)
        for i, (x, y) in enumerate(pts):
            if 0 <= x < 32 and 0 <= y < 32 and body[y, x]:
                cv.glint(x, y, '#ffffff' if i < 3 else '#6fe3ff')
                if i < 5:
                    nx, ny = x + (1 if abs(math.sin(a)) > 0.5 else 0), y + (0 if abs(math.sin(a)) > 0.5 else 1)
                    if body[ny % 32, nx % 32]:
                        cv.glint(nx, ny, '#b8f6ff')
    # The core: a ring of dark flesh, then Solar to white.
    core = cv.circle(cx, cy, 4.6)
    ccol = cv.fill(SOLAR[3])
    d = np.hypot(cv.PX - cx, cv.PY - cy)
    ccol[d < 3.6] = hexc(SOLAR[2])
    ccol[d < 2.4] = hexc(SOLAR[1])
    ccol[d < 1.3] = hexc('#ffffff')
    cv.obj(core, ccol, '#4a0f22')
    cv.glint(int(cx) - 2, int(cy) - 2, '#fffbe6')
    # Mites, the in-game ones.
    m8 = ['k......k', '.k.kk.k.', '..kmmk..', '.kmnnmk.', 'kmnwcnmk', 'kmnnnnmk', '.kxmmxk.', '.k.kk.k.']
    pal = {'k': '#0b0c24', 'm': '#ff4d6d', 'n': '#ff6b7a', 'w': '#f3f5ff', 'c': '#6fe3ff', 'x': '#9c2238'}
    cv.stamp(0, 0, m8, pal)
    cv.stamp(24, 1, [r[::-1] for r in m8], pal)
    cv.finish()
    for x, y in ((6, 9), (24, 6), (5, 24), (28, 22)):
        cv.glint(x, y, '#6fe3ff')
    return cv


def glacier(f=0):
    """La Madre Glaciar: a crown of six ice spires round a faceted frozen body; in its heart, glowing cyan, something
    curled that it keeps from waking. Cold mist and the rings of the Anillos de Escarcha behind."""
    cv = canvas()
    nebula_back(cv, ['#4a7fc8', '#2e5ea8', '#1f4282', '#152c5e', '#0c1a3c'], seed=202, glow=(16, 17, 20, 0.3))
    # A planetary ring arc behind.
    ringm, ru, rv = cv.ell(16, 19, 19, 5.2, rot=-0.32)
    ringi, _, _ = cv.ell(16, 19, 17, 3.8, rot=-0.32)
    cv.back(ringm & ~ringi, '#6f9fe0')
    cv.back(ringm & ~ringi & (cv.PY > 19), '#4a7fc8')
    stars(cv, 8, 5, colors=('#ffffff', '#bfe3ff'))
    cx, cy = 16.0, 17.0
    a = np.arctan2(cv.PY - cy, cv.PX - cx)
    d = np.hypot(cv.PX - cx, cv.PY - cy)
    spires = np.zeros((32, 32), bool)
    sp_col = cv.fill(ICE[2])
    for k in range(6):
        ang = k * math.pi / 3 - math.pi / 2
        length = 17.5 if k in (0, 3) else 15.5
        w = 0.42
        rel = np.angle(np.exp(1j * (a - ang)))
        m = (np.abs(rel) < w * np.clip(1 - d / length, 0, 1)) & (d > 6)
        spires |= m
        lit_side = rel < 0
        sp_col[m & lit_side] = hexc('#ffffff' if k in (0, 4, 5) else '#e6f6ff')
        sp_col[m & ~lit_side] = hexc('#8fcaf5' if k in (0, 4, 5) else '#3a7fc8')
        sp_col[m & ~lit_side & (d > length * 0.55)] = hexc('#6fb7ff' if k in (0, 4, 5) else '#2a5ea0')
    cv.obj(spires, sp_col, '#1d3f7a')
    body = d <= 10.2
    col = cv.fill(ICE[3])
    facet = (np.floor((a + math.pi / 6) / (math.pi / 3)) % 2 == 0)
    inner = d <= 6.4
    lightv = np.clip(0.55 - (cv.PX - cx) / 22 - (cv.PY - cy) / 18, 0, 1)
    cv.tones(col, body & facet, lightv + 0.25, ['#ffffff', '#e6f6ff', '#bfe3ff', '#8fcaf5'], dither=False)
    cv.tones(col, body & ~facet, lightv, ['#bfe3ff', '#8fcaf5', '#6fb7ff', '#3a7fc8'], dither=False)
    # Facet edges.
    edge_ring = body & (np.abs(d - 6.6) < 0.5)
    col[edge_ring] = hexc('#ffffff')
    col[edge_ring & (cv.PX > cx + 1)] = hexc('#8fcaf5')
    cv.obj(body, col, '#1d3f7a')
    # The heart: glowing cyan, with the curled shape inside.
    heart = d <= 4.4
    hcol = cv.fill(CYAN[2])
    hcol[d < 3.4] = hexc(CYAN[1])
    hcol[d < 2.2] = hexc('#f3feff')
    cv.obj(heart, hcol, '#1a7fa8')
    cv.glint(14, 15, '#ffffff')
    cv.finish()
    for x, y in ((4, 26), (27, 5), (25, 27), (3, 10)):
        cv.sparkle(x, y, 1, core='#ffffff', mid='#bfe3ff')
    return cv


def anemone(f=0):
    """La Anémona Rey: twelve swaying arms, coral with white tips and lilac with green tips, round a mouth that
    drinks the light of the Arrecife Hueco. Bubbles rise in the violet and teal water."""
    cv = canvas()
    nebula_back(cv, ['#2f8a9a', '#256a8a', '#22487a', '#1f2d63', '#140f3a'], seed=303, glow=(16, 18, 19, 0.3))
    rng = np.random.default_rng(7)
    for _ in range(6):
        bx, by = int(rng.integers(2, 30)), int(rng.integers(2, 30))
        cv.back(cv.ring(bx + 0.5, by + 0.5, 0.9, 1.6), '#7ff0e4')
    cx, cy = 16.0, 18.0
    d = np.hypot(cv.PX - cx, cv.PY - cy)
    # Twelve arms, each its own outlined tentacle that curls as it leaves the body; the far ones first.
    order = sorted(range(12), key=lambda k: -math.sin(k * math.pi / 6 + 0.2))
    for k in order:
        a0 = k * math.pi / 6 + 0.2
        coral = k % 2 == 0
        pts = []
        for i in range(26):
            t = i / 25
            r = 6.0 + t * 12.5
            ang = a0 + 0.55 * t * t + 0.12 * math.sin(t * 5 + k)
            pts.append((cx + math.cos(ang) * r, cy + math.sin(ang) * r, 2.3 - t * 1.5, t))
        best = np.full((32, 32), 99.0)
        ox = np.zeros((32, 32))
        oy = np.zeros((32, 32))
        tt = np.zeros((32, 32))
        m = np.zeros((32, 32), bool)
        for (px, py, rr, t) in pts:
            dx, dy = cv.PX - px, cv.PY - py
            dist = np.hypot(dx, dy)
            inside = dist <= rr
            m |= inside
            closer = inside & (dist < best)
            best = np.where(closer, dist, best)
            ox = np.where(closer, dx, ox)
            oy = np.where(closer, dy, oy)
            tt = np.where(closer, t, tt)
        lit = (ox * -0.6 + oy * -0.8) > 0.15
        dark = (ox * -0.6 + oy * -0.8) < -0.6
        if coral:
            ramp = ('#ffb8d0', '#ff8fb3', '#c94f7c', '#ffffff', '#ffe4ee', '#ffb8d0', '#7a2a50')
        else:
            ramp = ('#c7b8ff', '#9b86ff', '#5a43d6', '#e4fff4', '#45e3a6', '#17b07e', '#22185e')
        col = cv.fill(ramp[1])
        col[m & lit] = hexc(ramp[0])
        col[m & dark] = hexc(ramp[2])
        tip = m & (tt > 0.62)
        col[tip] = hexc(ramp[4])
        col[tip & lit] = hexc(ramp[3])
        col[tip & dark] = hexc(ramp[5])
        cv.obj(m, col, ramp[6])
    body = d <= 8.6
    bcol = cv.fill(CORAL[3])
    lightv = np.clip(0.6 - (cv.PX - cx) / 16 - (cv.PY - cy) / 14, 0, 1)
    cv.tones(bcol, body, lightv, ['#ffb8d0', '#ff8fb3', '#ff6b7a', '#e8435a', '#c94f7c'], dither=False)
    # Ridges round the mouth.
    for k in range(12):
        ang = k * math.pi / 6
        for r in (5.6, 6.6, 7.6):
            x, y = int(cx + math.cos(ang) * r), int(cy + math.sin(ang) * r)
            bcol[y, x] = hexc('#c94f7c')
    cv.obj(body, bcol, '#7a2a50')
    mouth = d <= 4.6
    mcol = cv.fill('#4a0f22')
    mcol[d < 3.6] = hexc('#17b07e')
    mcol[d < 2.6] = hexc('#45e3a6')
    mcol[d < 1.4] = hexc('#e4fff4')
    cv.obj(mouth, mcol, '#2a0816')
    cv.glint(15, 17, '#ffffff')
    cv.finish()
    for x, y in ((3, 4), (28, 3), (29, 29)):
        cv.glint(x, y, '#9df5d0')
    return cv


def anvil(f=0):
    """El Yunque: the old forge's anvil seen from below, two red eyes on its face and its waist split open on molten
    metal. Sparks fly from the face into the brown smoke of the Forja Rota."""
    cv = canvas()
    nebula_back(cv, ['#7a4028', '#5a2e1c', '#3e1f14', '#26120a', '#140806'], seed=404, glow=(16, 20, 18, 0.35))
    rng = np.random.default_rng(9)
    for _ in range(9):
        x, y = int(rng.integers(0, 32)), int(rng.integers(0, 32))
        cv.back(cv.cells([(x, y)]), '#ff9a3c' if rng.random() < 0.5 else '#ff5a1f')
    steel = ['#e6e9f8', '#b9bfe6', '#8890c4', '#4b5390', '#2a2f5e', '#161935']
    # Base, waist and the face (top), drawn back to front.
    base = cv.poly([(3, 32), (29, 32), (27, 27), (5, 27)])
    bcol = cv.fill(steel[3])
    bcol[base & (cv.PY < 28)] = hexc(steel[2])
    bcol[base & (cv.PX > 23)] = hexc(steel[4])
    cv.obj(base, bcol, steel[5])
    waist = cv.poly([(9.5, 15), (22.5, 15), (20, 27), (12, 27)])
    wcol = cv.fill(steel[3])
    wcol[waist & (cv.PX < 13)] = hexc(steel[2])
    wcol[waist & (cv.PX > 19)] = hexc(steel[4])
    cv.obj(waist, wcol, steel[5])
    # The molten split, glowing.
    sx = np.abs(cv.PX - 16)
    split = waist & (sx < 3.4 - np.abs(cv.PY - 21) * 0.22)
    scol = cv.fill(LAVA[3])
    scol[sx < 2.4 - np.abs(cv.PY - 21) * 0.18] = hexc(LAVA[2])
    scol[sx < 1.2] = hexc(LAVA[1])
    scol[(sx < 0.6) & (np.abs(cv.PY - 21) < 3)] = hexc('#ffffff')
    cv.paint(split, scol)
    glow = waist & ~split & (sx < 5)
    cv.c[glow] = np.round(cv.c[glow] * 0.55 + np.array(hexc('#ff5a1f')) * 0.45).astype(np.uint8)
    # The face: horn to the left, a wide top with a bright bevel.
    face = cv.poly([(0, 6), (5, 5.5), (30.5, 5.5), (31.5, 8), (29, 15.5), (5, 15.5), (3, 10), (0, 9)])
    fcol = cv.fill(steel[2])
    fcol[face & (cv.PY < 7.5)] = hexc(steel[0])
    fcol[face & (cv.PY >= 7.5) & (cv.PY < 9)] = hexc(steel[1])
    fcol[face & (cv.PY > 13.5)] = hexc(steel[3])
    fcol[face & (cv.PX > 27.5) & (cv.PY >= 7.5)] = hexc(steel[3])
    fcol[face & (cv.PX < 4)] = hexc(steel[1])
    # Dents and scratches.
    for x, y in ((8, 12), (9, 12), (24, 11), (19, 13), (12, 10)):
        fcol[y, x] = hexc(steel[3])
    cv.obj(face, fcol, steel[5])
    # Red eyes.
    for ex in (9, 20):
        cv.stamp(ex, 10, ['kkkk', 'kmnk', 'kxmk', '.kk.'], {'k': '#2a0816', 'm': '#ff4d6d', 'n': '#ffb0b9',
                                                          'x': '#9c2238'})
        cv.glint(ex + 2, 11, '#ffffff')
    cv.finish()
    # Sparks flying up off the face.
    for (x0, y0, dx, dy) in ((6, 4, -1, -1), (12, 3, 0, -1), (22, 3, 1, -1), (27, 4, 1, -1), (17, 2, 0, -1)):
        cv.glint(x0, y0, '#fffbe6')
        cv.glint(x0 + dx, y0 + dy, '#ffc94a')
    for x, y in ((2, 18), (29, 20), (4, 22), (27, 24)):
        cv.glint(x, y, '#ff9a3c')
    return cv


def echo_core(f=0):
    """El Eco Profundo: a dark sphere that is one great eye, ringed by broken bands of signal; in the rings, faint
    copies of the probes it lost. The black of the deepest layers behind."""
    cv = canvas()
    nebula_back(cv, ['#2a2f5e', '#1c2050', '#13163a', '#0b0c24', '#05060f'], seed=505, glow=(16, 16, 18, 0.25))
    stars(cv, 6, 8, colors=('#6fe3ff', '#2fb8e0'))
    cx, cy = 16.0, 16.0
    d = np.hypot(cv.PX - cx, cv.PY - cy)
    a = np.arctan2(cv.PY - cy, cv.PX - cx)
    # Broken rings (behind and in front are the same: they read as orbiting arcs).
    rings = ((np.abs(d - 14.6) < 0.6) & (np.floor((a + 3.2) / (2 * math.pi) * 9) % 3 != 2))
    cv.back(rings, '#2fb8e0')
    cv.back(rings & (cv.PY < cy), '#6fe3ff')
    body, u, v = sph(cv, cx, cy, 12.4)
    col = cv.fill(UV[4])
    cv.tones(col, body, sphere_light(u, v), ['#9b86ff', '#7259ee', '#5a43d6', '#3a2a9a', '#22185e'], dither=True,
             spread=0.5)
    # The wine shadow at the lower right, as in the arena.
    col[body & (u * 0.7 + v * 0.7 > 0.55)] = hexc('#4a0f22')
    col[body & (u * 0.7 + v * 0.7 > 0.78)] = hexc('#2a0816')
    col[body & (np.abs(d - 9.6) < 0.5)] = hexc('#7259ee')
    cv.obj(body, col, '#130c36')
    # The eye.
    eye, eu, ev = cv.ell(cx, cy, 6.6, 5.2)
    ecol = cv.fill(CYAN[2])
    er = np.hypot(eu, ev)
    ecol[er > 0.72] = hexc(CYAN[3])
    ecol[er < 0.55] = hexc('#dff9ff')
    cv.obj(eye, ecol, '#0e4a6e')
    iris, _, _ = cv.ell(cx, cy, 3.2, 4.2)
    cv.paint(iris, CYAN[2])
    pupil, _, _ = cv.ell(cx, cy, 0.9, 3.8)
    cv.paint(pupil, INK)
    cv.glint(13, 13, '#ffffff')
    cv.glint(14, 13, '#ffffff')
    cv.glint(13, 14, '#f3feff')
    # Ghost probes caught in the rings.
    ghost = {'g': '#2fb8e0', 'G': '#6fe3ff'}
    cv.stamp(1, 9, ['.gg.', 'gGGg', '.gg.'], ghost, kind=4)
    cv.stamp(26, 24, ['.gg.', 'gGGg', '.gg.'], ghost, kind=4)
    cv.finish()
    return cv


def signal(f=0):
    """La Señal: a broadcasting diamond under an antenna, rings of signal widening from it and the Static's glitch
    cutting through. In the violet of the Fisura, braille dots: the Signal is written in braille."""
    cv = canvas()
    nebula_back(cv, ['#6a2088', '#4a1666', '#33104a', '#200a32', '#12051e'], seed=606, glow=(16, 19, 18, 0.35))
    # Glitch bars on the backdrop.
    for y, x0, x1 in ((4, 0, 9), (12, 24, 32), (26, 0, 6), (29, 22, 32)):
        cv.back(cv.rect(x0, y, x1, y + 1), '#8e2bb3')
    # Braille cells.
    for bx, by, dots in ((2, 15, (0, 1, 3, 5)), (26, 13, (0, 2, 3)), (3, 27, (1, 2, 4)), (27, 2, (0, 3, 4, 5))):
        for i in dots:
            cv.back(cv.cells([(bx + (i // 3) * 2, by + (i % 3) * 2)]), '#e05cff')
    cx, cy = 16.0, 19.5
    d = np.hypot(cv.PX - cx, cv.PY - cy)
    rings = ((np.abs(d - 12.2) < 0.55) | (np.abs(d - 15.6) < 0.55)) & (np.abs(cv.PX - cx) > 4) & (cv.PY < 31)
    cv.back(rings, '#6fe3ff')
    dd = np.abs(cv.PX - cx) + np.abs(cv.PY - cy)
    dia = dd <= 10.5
    col = cv.fill(GLITCH[3])
    left = cv.PX < cx
    top = cv.PY < cy
    col[dia & left & top] = hexc('#f0a6ff')
    col[dia & ~left & top] = hexc('#e05cff')
    col[dia & left & ~top] = hexc('#b73fe0')
    col[dia & ~left & ~top] = hexc('#8e2bb3')
    col[dia & (dd > 8.6) & left & top] = hexc('#fbe4ff')
    col[dia & (dd > 8.6) & ~left & ~top] = hexc('#541a6e')
    col[dia & (dd <= 5.2)] = hexc('#e05cff')
    col[dia & (dd <= 4.2)] = hexc(CYAN[2])
    col[dia & (dd <= 2.6)] = hexc(CYAN[1])
    col[dia & (dd <= 1.2)] = hexc('#ffffff')
    cv.obj(dia, col, '#2a0d3a')
    # Antenna.
    mast = cv.rect(15, 3, 17, 9.5)
    mcol = cv.fill(STEEL[1])
    mcol[mast & (cv.PX > 16)] = hexc(STEEL[3])
    cv.obj(mast, mcol, STEEL[5])
    tip = cv.circle(16, 2.5, 1.7)
    cv.obj(tip, CYAN[1], '#1a7fa8')
    cv.glint(15, 2, '#ffffff')
    cv.finish()
    # The Static's glitch: a slice of the diamond pushed sideways with red and cyan fringes.
    ys = (22, 23)
    for y in ys:
        row = cv.c[y].copy()
        k = cv.k[y].copy()
        a = cv.a[y].copy()
        cv.c[y, 2:] = row[:-2]
        cv.k[y, 2:] = k[:-2]
        cv.a[y, 2:] = a[:-2]
    for y in ys:
        xs = [x for x in range(32) if cv.k[y, x] in (2, 3)]
        if xs:
            cv.glint(min(xs) - 1, y, '#ff4d6d')
            cv.glint(max(xs) + 1, y, '#6fe3ff')
    cv.sparkle(16, 2, 1, core='#ffffff', mid='#b8f6ff')
    return cv
