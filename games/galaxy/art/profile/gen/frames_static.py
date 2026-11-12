"""The still frames (bloque C, C3): Bronce and Plata (common: clean bevelled mouldings), and the rares, Oro,
Circuito, Órbita, Escarcha and, from the shop, Eclipse and Luz estelar, each with its own ornament."""
import math
import numpy as np
from core import hexc, mix, sphere_light, dilate4
from palette import BRONZE, SILVER, GOLD, ICE, PLATINUM, SKY, UV, NOVA, TERM, SOLAR, STEEL, CYAN
from framekit import S, W0, W1, canvas, Band, gem, cut_gem, rivet, mirror4, done, point_at
from fx import noise

SAPPHIRE = ['#bfe3ff', '#6fb7ff', '#3a58e0', '#26389a', '#17225e']
RUBY = ['#ffd0d6', '#ff6b7a', '#e8435a', '#9c2238', '#4a0f22']
EMERALD = ['#c8ffe8', '#45e3a6', '#17b07e', '#0b7352', '#04281c']
AMETHYST = ['#e8ddff', '#b39dff', '#7259ee', '#3a2a9a', '#1c1450']
GOLD6 = ['#fffbe6', '#ffe58a', '#ffc94a', '#e0962a', '#c27a12', '#7a3d08']


def bronze(f=0):
    """Bronce: a rounded bronze moulding, a darker channel with punched dots and a rivet in each corner."""
    cv = canvas()
    b = Band(cv, outer=1, corner=3)
    col = b.shade(cv.fill(BRONZE[2]), [(0.5, 0), (0.25, 1), (0.35, 0.6), (0.62, 0), (0.42, -1), (0.3, 0.7),
                                       (0.5, 0)], BRONZE)
    dots = b.rows(3) & (np.mod(np.round(b.s), 4) == 0)
    col[dots] = hexc(BRONZE[1])
    cv.obj(b.mask, col)
    for x, y in ((3, 3), (42, 3), (3, 42), (42, 42)):
        cv.stamp(x, y, ['.ab', 'abc', 'bcd'][0:3], {'a': BRONZE[0], 'b': BRONZE[1], 'c': BRONZE[3], 'd': BRONZE[4]})
    return done(cv)


def silver(f=0):
    """Plata: chamfered corners, a double moulding with an engraved groove, and a diamond stud at each corner."""
    cv = canvas()
    b = Band(cv, outer=1, chamfer=5)
    col = b.shade(cv.fill(SILVER[2]), [(0.5, 0), (0.15, 1), (0.4, 0.4), (0.8, 0), (0.25, 0.9), (0.45, -0.7),
                                       (0.5, 0)], SILVER)
    cv.obj(b.mask, col)
    for x, y in ((4, 4), (43, 4), (4, 43), (43, 43)):
        cut_gem(cv, x + 0.5, y + 0.5, 2.2, ['#ffffff', '#e6f6ff', '#bfe3ff', '#8fb4e8', '#3b4060'])
    # A small plate at the top centre.
    plate = cv.rect(21, 2, 27, 6)
    pcol = cv.fill(SILVER[1])
    pcol[plate & (cv.PY < 3)] = hexc(SILVER[0])
    pcol[plate & (cv.PX > 25)] = hexc(SILVER[3])
    cv.obj(plate, pcol, SILVER[4])
    cv.px(24, 4, SILVER[3])
    return done(cv)


def gold(f=0):
    """Oro: a gold moulding with a crest of light and a channel of beads, square bosses set with sapphires at the
    corners and a ruby crest at the top."""
    cv = canvas()
    b = Band(cv, outer=1)
    col = b.shade(cv.fill(GOLD6[2]), [(0.5, 0), (0.2, 1), (0.08, 0.5), (0.5, -0.9), (0.85, 0), (0.25, 0.8),
                                      (0.5, 0)], GOLD6)
    beads = b.rows(4) & (np.mod(np.round(b.s), 3) == 0)
    col[beads] = hexc(GOLD6[1])
    beads2 = b.rows(4) & (np.mod(np.round(b.s), 3) == 1)
    col[beads2] = hexc(GOLD6[3])
    cv.obj(b.mask, col)
    for x0, y0 in ((1, 1), (39, 1), (1, 39), (39, 39)):
        boss = cv.rect(x0, y0, x0 + 8, y0 + 8)
        bcol = cv.fill(GOLD6[2])
        bcol[boss & ((cv.PX < x0 + 1.5) | (cv.PY < y0 + 1.5))] = hexc(GOLD6[0])
        bcol[boss & ((cv.PX > x0 + 6.5) | (cv.PY > y0 + 6.5))] = hexc(GOLD6[4])
        cv.obj(boss, bcol, GOLD6[5])
        gem(cv, x0 + 4, y0 + 4, 2.3, SAPPHIRE)
    crest = cv.poly([(18, 1), (30, 1), (29, 5), (24, 8.5), (19, 5)])
    ccol = cv.fill(GOLD6[2])
    ccol[crest & (cv.PX < 22)] = hexc(GOLD6[1])
    ccol[crest & (cv.PX > 27)] = hexc(GOLD6[3])
    cv.obj(crest, ccol, GOLD6[5])
    cut_gem(cv, 24, 4, 2.5, RUBY)
    cv.glint(23, 3, '#ffffff')
    return done(cv)


def circuit(f=0):
    """Circuito: a green board with Terminal traces, vias and pads, a chip in each corner (one with a Solar LED)
    and a resistor at the top."""
    cv = canvas()
    board = ['#2a9a70', '#178060', '#0e684c', '#0a523c', '#063a2a', '#04281c']
    b = Band(cv, outer=1, chamfer=3)
    col = b.shade(cv.fill(board[2]), [(0.5, 0), (0.15, 1), (0.5, 0), (0.55, 0), (0.55, 0), (0.75, -0.4),
                                      (0.5, 0)], board)
    trace, pad = '#45e3a6', '#c8ffe8'
    rng = np.random.default_rng(12)
    P = b.P
    # Two lanes of traces with gaps, joined by short links with vias.
    for lane in (2, 4):
        on = np.zeros(int(P) + 1, bool)
        pos = 0.0
        while pos < P:
            n = rng.integers(5, 14)
            on[int(pos):int(min(P, pos + n))] = True
            pos += n + rng.integers(2, 4)
        lm = b.rows(lane) & on[np.clip(np.round(b.s).astype(int), 0, len(on) - 1)]
        col[lm] = hexc(trace)
        ends = b.rows(lane) & ~on[np.clip(np.round(b.s).astype(int), 0, len(on) - 1)] & dilate4(lm)
        col[ends] = hexc(pad)
    for sp in np.arange(4, P, 9.5):
        for r in (2, 3, 4):
            x, y = point_at(b, sp, r)
            if 0 <= x < S and 0 <= y < S and b.mask[y, x]:
                col[y, x] = hexc(trace if r == 3 else pad)
    cv.obj(b.mask, col)
    # Chips in the corners.
    for i, (x0, y0) in enumerate(((1, 1), (40, 1), (1, 40), (40, 40))):
        chip = cv.rect(x0 + 1, y0 + 1, x0 + 6, y0 + 6)
        pins = (cv.rect(x0, y0 + 2, x0 + 7, y0 + 5) | cv.rect(x0 + 2, y0, x0 + 5, y0 + 7)) & ~chip
        pcol = cv.fill('#b9bfe6')
        pcol[pins & ((cv.XX + cv.YY) % 2 == 0)] = hexc('#8890c4')
        cv.obj(pins, pcol, '#161935')
        ccol = cv.fill('#2a2f5e')
        ccol[chip & (cv.PY < y0 + 2)] = hexc('#4b5390')
        cv.obj(chip, ccol, '#161935')
        cv.px(x0 + 2, y0 + 2, '#8890c4')
        if i == 1:
            cv.glint(x0 + 4, y0 + 4, SOLAR[1])
            cv.glint(x0 + 3, y0 + 4, SOLAR[2])
    # Resistor at the top centre.
    res = cv.rect(20, 2, 28, 5)
    rcol = cv.fill('#e8d0a0')
    for x, c in ((22, '#e8435a'), (24, '#ff9a3c'), (26, '#7259ee')):
        rcol[res & (cv.XX == x)] = hexc(c)
    rcol[res & (cv.PY < 3)] = hexc('#fff2d0')
    cv.obj(res, rcol, '#5a4020')
    return done(cv)


def orbit(f=0):
    """Órbita: a night band with stars and an orbital track, a ringed Solar planet on the top right corner, a moon
    and a red planet riding the track."""
    cv = canvas()
    night = ['#5a63a8', '#3a4280', '#262c5e', '#1c2050', '#141838', '#0b0c24']
    b = Band(cv, outer=1, corner=5)
    col = b.shade(cv.fill(night[3]), [(0.5, 0), (0.1, 1), (0.6, 0), (0.7, 0), (0.7, 0), (0.45, 0.6),
                                      (0.5, 0)], night)
    # The sky lip and the track.
    col[b.rows(1) & (b.lit > 0)] = hexc('#6fb7ff')
    col[b.rows(1) & (b.lit < 0)] = hexc('#3a58e0')
    track = b.rows(3)
    col[track] = hexc('#3a58e0')
    col[track & (np.mod(np.round(b.s), 5) < 2)] = hexc('#6fb7ff')
    rng = np.random.default_rng(4)
    ys, xs = np.nonzero(b.rows(2) | b.rows(4) | b.rows(5))
    for i in rng.choice(len(xs), 22, replace=False):
        col[ys[i], xs[i]] = hexc('#ffffff' if i % 3 else '#bfe3ff')
    cv.obj(b.mask, col)
    # The ringed planet on the top right corner.
    PX0, PY0 = 40.0, 7.0
    ring_back, _, _ = cv.ell(PX0, PY0, 8.4, 2.6, rot=-0.5)
    ring_gap, _, _ = cv.ell(PX0, PY0, 6.4, 1.4, rot=-0.5)
    planet, pu, pv = cv.ell(PX0, PY0, 5.0, 5.0)
    rcol = cv.fill('#e6f6ff')
    rcol[cv.PX > 41] = hexc('#8fb4e8')
    cv.obj(ring_back & ~ring_gap & ~planet & (cv.PY < PY0 + (cv.PX - PX0) * -0.55), rcol, '#26389a')
    pcol = cv.fill(SOLAR[2])
    cv.tones(pcol, planet, sphere_light(np.clip(pu, -1, 1), np.clip(pv, -1, 1)),
             ['#fff2b0', '#ffc94a', '#ff9a3c', '#c25f1c', '#7a3510'], dither=False)
    pcol[planet & (np.abs(cv.PY - PY0 - 1.5 + (cv.PX - PX0) * 0.5) < 0.6)] = hexc('#e0962a')
    cv.obj(planet, pcol, '#3a1700')
    front = ring_back & ~ring_gap & (cv.PY >= PY0 + (cv.PX - PX0) * -0.55)
    cv.obj(front, rcol, '#26389a')
    # The moon on the left and the red planet at the bottom, on the track.
    for (sp, rr, ramp) in ((140, 2.4, ['#ffffff', '#bfe3ff', '#8fb4e8', '#4a6aa8', '#1d3f7a']),
                           (100, 2.6, ['#ffd0d6', '#ff6b7a', '#e8435a', '#9c2238', '#4a0f22'])):
        x, y = point_at(b, sp, 3)
        m, u, v = cv.ell(x + 0.5, y + 0.5, rr, rr)
        mcol = cv.fill(ramp[2])
        cv.tones(mcol, m, sphere_light(np.clip(u, -1, 1), np.clip(v, -1, 1)), ramp[:4], dither=False)
        cv.obj(m, mcol, ramp[4])
    cv.glint(38, 4, '#ffffff')
    cv.glint(37, 5, '#fff2b0')
    return done(cv)


def frost(f=0):
    """Escarcha: a band of faceted ice whose outer edge grows crystal shards, clusters of them at the corners, and
    snowflakes caught in it."""
    cv = canvas()
    ice = ['#ffffff', '#e6f6ff', '#bfe3ff', '#8fcaf5', '#5f9fe0', '#3a6fb8', '#1d3f7a']
    b = Band(cv, outer=3)
    # Facets: cells of flat ice, each its own shade, lit by side.
    from fx import hex_cells
    bid, edge, bdx, bdy = hex_cells(cv.PX / 3.4 + 0.3, cv.PY / 3.4)
    h = (bid * 2654435761 % 97) / 97.0
    col = b.shade(cv.fill(ice[3]), [(0.4, 0), (0.15, 1), (0.3, 0.7), (0.4, 0.3), (0.45, 0), (0.3, -0.6)], ice)
    facet = b.mask & (b.r >= 1) & (b.r <= 4)
    shade_idx = np.clip(np.round(1 + h * 3 - b.lit * 1.2), 0, 5).astype(int)
    for i in range(6):
        col[facet & (shade_idx == i)] = hexc(ice[i])
    col[facet & (edge < 0.08)] = hexc('#ffffff')
    # Crystal shards on the outer edge.
    shards = np.zeros((S, S), bool)
    scol = cv.fill(ice[2])

    def shard(x0, y0, x1, y1, w):
        dx, dy = x1 - x0, y1 - y0
        L = math.hypot(dx, dy)
        nx, ny = -dy / L, dx / L
        m = cv.poly([(x0 + nx * w, y0 + ny * w), (x1, y1), (x0 - nx * w, y0 - ny * w)])
        lit = ((cv.PX - x0) * nx + (cv.PY - y0) * ny) * (-0.7 * nx - 0.7 * ny) > 0
        scol[m & lit] = hexc('#ffffff')
        scol[m & ~lit] = hexc(ice[3])
        return m

    for t in (12, 19, 29, 36):
        shards |= shard(t, 4, t + 1, 0.5 if t % 2 else 1.5, 1.8)
        shards |= shard(t, 44, t - 1, 47.5 if t % 2 else 46.5, 1.8)
        shards |= shard(4, t, 0.5 if t % 2 else 1.5, t + 1, 1.8)
        shards |= shard(44, t, 47.5 if t % 2 else 46.5, t - 1, 1.8)
    for (cx, cy, sx, sy) in ((4, 4, -1, -1), (43, 4, 1, -1), (4, 43, -1, 1), (43, 43, 1, 1)):
        shards |= shard(cx, cy, cx + sx * 4.5, cy + sy * 4.5, 2.2)
        shards |= shard(cx, cy + sy * -1, cx + sx * 4.5, cy - sy * 0.5, 1.4)
        shards |= shard(cx + sx * -1, cy, cx - sx * 0.5, cy + sy * 4.5, 1.4)
    cv.obj(shards & ~b.mask, scol, '#1d3f7a')
    cv.obj(b.mask, col, '#1d3f7a')
    # Snowflakes.
    for x, y in ((16, 5), (32, 42), (5, 26), (42, 20), (24, 44)):
        cv.sparkle(x, y, 1, core='#ffffff', mid='#bfe3ff')
    return done(cv)


def eclipse(f=0):
    """Eclipse: a dark band with a gold inner lip; at the top the moon covers the sun and its corona spills along
    the frame, brightest near it; a diamond of light breaks out at its edge."""
    cv = canvas()
    dark = ['#4b5390', '#2a2f5e', '#20234f', '#181a3d', '#11132e', '#0b0c24']
    b = Band(cv, outer=1, corner=2)
    col = b.shade(cv.fill(dark[3]), [(0.5, 0), (0.25, 1), (0.55, 0.3), (0.75, 0), (0.6, -0.5), (0.5, 0),
                                     (0.5, 0)], dark)
    # The corona's light along the outer rows, fading away from the top centre.
    s_top = 24 - (1 + W0) / 2.0
    dist = np.minimum(np.mod(b.s - s_top, b.P), np.mod(s_top - b.s, b.P))
    glow = np.clip(1 - dist / 70, 0, 1)
    cor = ['#fffbe6', '#ffe58a', '#ffc94a', '#ff9a3c', '#c25f1c', '#7a3510']
    for r in (1, 2):
        m = b.rows(r)
        idx = np.clip(np.round((1 - glow) * 5 + (r - 1) * 1.2), 0, 5).astype(int)
        for i, c in enumerate(cor):
            col[m & (idx == i) & (glow > 0.05)] = hexc(c)
    # The gold inner lip.
    col[b.rows(5) & (b.lit > 0)] = hexc(GOLD6[1])
    col[b.rows(5) & (b.lit < 0)] = hexc(GOLD6[3])
    cv.obj(b.mask, col)
    # The eclipse.
    d = np.hypot(cv.PX - 24, cv.PY - 4.5)
    corona = (d <= 5.6) & (d > 3.6)
    ccol = cv.fill('#ffe58a')
    ccol[d > 4.6] = hexc('#ff9a3c')
    ccol[d <= 4.2] = hexc('#fffbe6')
    cv.obj(corona, ccol)
    disc = d <= 3.6
    cv.obj(disc, '#05030c')
    # Rays.
    for ang in (0.2, 0.6, 1.0, 2.15, 2.55, 2.95, -0.3, -2.85):
        for rr in (6, 7, 8):
            x, y = int(24 + math.cos(ang) * rr), int(4.5 + math.sin(ang) * rr)
            if 0 <= y < 8 and 0 <= x < S:
                cv.glint(x, y, '#ffe58a' if rr < 8 else '#ff9a3c')
    cv.finish()
    cv.sparkle(21, 2, 1, core='#ffffff', mid='#fffbe6')
    from framekit import clear_window
    clear_window(cv)
    return cv


def starlight(f=0):
    """Luz estelar: a midnight velvet band between two silver lips, sown with stars, a big four-point star of
    silver at each corner and faint constellations."""
    cv = canvas()
    velvet = ['#4767f2', '#3a58e0', '#26389a', '#1e2c80', '#151e58', '#0c1236']
    b = Band(cv, outer=1)
    n = noise(S, S, 33, cell=4.0, octaves=2)
    col = b.shade(cv.fill(velvet[3]), [(0.5, 0), (0.15, 1), (0.45, 0), (0.55, 0), (0.6, 0), (0.25, 0.8),
                                       (0.5, 0)], velvet)
    vel = b.mask & (b.r >= 2) & (b.r <= 4)
    idx = np.clip(np.round(2 + (n - 0.5) * 4), 1, 4).astype(int)
    for i in range(1, 5):
        col[vel & (idx == i)] = hexc(velvet[i + 1] if i < 4 else velvet[5])
    # Silver lips.
    for r in (1, 5):
        col[b.rows(r) & (b.lit > 0)] = hexc(SILVER[0] if r == 1 else SILVER[1])
        col[b.rows(r) & (b.lit < 0)] = hexc(SILVER[2] if r == 1 else SILVER[3])
    rng = np.random.default_rng(8)
    ys, xs = np.nonzero(vel)
    picks = rng.choice(len(xs), 26, replace=False)
    for i in picks:
        col[ys[i], xs[i]] = hexc('#ffffff' if i % 2 else '#bfe3ff')
    cv.obj(b.mask, col)
    # Constellation lines (dim) between a few stars.
    for (x0, y0), (x1, y1) in (((12, 3), (17, 5)), ((17, 5), (20, 3)), ((44, 14), (42, 19)), ((30, 44), (35, 42))):
        n_ = max(abs(x1 - x0), abs(y1 - y0))
        for i in range(n_ + 1):
            x, y = round(x0 + (x1 - x0) * i / n_), round(y0 + (y1 - y0) * i / n_)
            cv.px(x, y, '#6f86c8')
        cv.px(x0, y0, '#ffffff')
        cv.px(x1, y1, '#ffffff')
    # Corner stars: silver four-point stars.
    for cx, cy in ((4, 4), (43, 4), (4, 43), (43, 43)):
        star = (np.abs(cv.PX - cx - 0.5) * np.abs(cv.PY - cy - 0.5) < 1.1) & (np.abs(cv.PX - cx - 0.5) < 4.6) & (
            np.abs(cv.PY - cy - 0.5) < 4.6)
        scol = cv.fill(SILVER[1])
        scol[star & ((cv.PX < cx + 0.5) & (cv.PY < cy + 0.5))] = hexc('#ffffff')
        scol[star & ((cv.PX > cx + 0.5) & (cv.PY > cy + 0.5))] = hexc(SILVER[2])
        cv.obj(star, scol, '#26389a')
        cv.glint(cx, cy, '#ffffff')
    cv.sparkle(24, 3, 1, core='#ffffff', mid='#bfe3ff')
    return done(cv)
