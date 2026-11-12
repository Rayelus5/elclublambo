"""The animated frames (bloque C, C3): six frames at 8 fps that loop. The epics (Nebulosa, Abismo, Aurora, Ascua and,
from the shop, Solar) move with their material; the legendaries (Corona, Cuásar and, from the shop, Prisma) add
lights that run round the whole frame. Every motion closes its loop exactly on the sixth frame."""
import math
import numpy as np
from core import hexc, mix, sphere_light, dilate4, apply_lift, lift_map
from palette import GOLD, UV, SOLAR, CYAN, TERM, SILVER, ICE, NOVA, LAVA, STEEL
from framekit import S, W0, W1, FRAMES, canvas, Band, gem, cut_gem, rivet, done, point_at, run_shine, heads, \
    clear_window
from fx import noise, noise_at

GOLD6 = ['#fffbe6', '#ffe58a', '#ffc94a', '#e0962a', '#c27a12', '#7a3d08']
RUBY = ['#ffd0d6', '#ff6b7a', '#e8435a', '#9c2238', '#4a0f22']
SAPPHIRE = ['#bfe3ff', '#6fb7ff', '#3a58e0', '#26389a', '#17225e']
EMERALD = ['#c8ffe8', '#45e3a6', '#17b07e', '#0b7352', '#04281c']
AMETHYST = ['#e8ddff', '#b39dff', '#7259ee', '#3a2a9a', '#1c1450']


def twinkles(cv, spots, f, core='#ffffff', mid='#bfe3ff', period=3):
    """Stars that pop and fade out of phase; `period` divides the six frames so the loop closes."""
    for i, (x, y) in enumerate(spots):
        ph = (f + i) % period
        if ph == 0:
            cv.sparkle(x, y, 1, core=core, mid=mid)
        elif ph == 1:
            cv.glint(x, y, mid)


def nebula(f=0):
    """Nebulosa: the band is a nebula; its gas flows round the frame through pink, violet and blue (palette cycling,
    one step a frame), with dark lanes of space and stars that twinkle, between a lilac rim and a UV lip."""
    cv = canvas()
    b = Band(cv, outer=1, corner=4)
    cyc = ['#ff8fb3', '#e05cff', '#b39dff', '#7259ee', '#4767f2', '#9b86ff']
    deep = ['#c94f7c', '#8e2bb3', '#6a4bd8', '#3a2a9a', '#26389a', '#5a43d6']
    n = noise_at(b.s, b.r.astype(float), 21, b.P, k=10, octaves=2, cell_y=3.0)
    lanes = noise_at(b.s, b.r.astype(float), 22, b.P, k=7, octaves=2, cell_y=4.0)
    idx = (np.floor(((n * 2.2) % 1.0) * 6).astype(int) - f) % 6
    col = cv.fill('#1c1450')
    gas = b.mask & (b.r >= 1) & (b.r <= 5)
    for i in range(6):
        col[gas & (idx == i)] = hexc(cyc[i])
        col[gas & (idx == i) & (b.lit < 0)] = hexc(deep[i])
    col[gas & (lanes < 0.36)] = hexc('#22185e')
    col[gas & (lanes < 0.3)] = hexc('#130c36')
    col[b.rows(1) & (b.lit > 0)] = hexc('#e8ddff')
    col[b.rows(1) & (b.lit < 0)] = hexc('#9b86ff')
    col[b.rows(5) & (b.lit > 0)] = hexc('#b39dff')
    col[b.rows(5) & (b.lit < 0)] = hexc('#5a43d6')
    cv.obj(b.mask, col)
    run_shine(cv, b, f, b.rows(1), [['#ffffff', '#e8ddff', '#b39dff', '#9b86ff']], n=2, tail=8)
    twinkles(cv, [(5, 14), (42, 9), (20, 4), (43, 33), (30, 43), (4, 36)], f)
    return done(cv)


def abyss(f=0):
    """Abismo: a band of the deepest dark with an ice rim inside and out. Two tentacles with glowing suckers wrap up
    the sides from the bottom corners and sway, a lure hangs from the top and pulses, lights of living things chase
    round the band and bubbles rise."""
    cv = canvas()
    deep = ['#2a5a8a', '#1e3f6e', '#142a52', '#0c1a3a', '#070f26', '#04060f']
    b = Band(cv, outer=1, corner=3)
    col = b.shade(cv.fill(deep[3]), [(0.5, 0), (0.3, 1), (0.6, 0.3), (0.75, 0), (0.7, 0), (0.4, 0), (0.5, 0)],
                  deep)
    col[b.rows(1) & (b.lit > 0)] = hexc('#6fb7ff')
    col[b.rows(1) & (b.lit < 0)] = hexc('#3a58e0')
    col[b.rows(5) & (b.lit > 0)] = hexc('#bfe3ff')
    col[b.rows(5) & (b.lit < 0)] = hexc('#6fb7ff')
    cv.obj(b.mask, col)
    # Chasing lights along the middle of the band.
    for k in range(12):
        sp = k * b.P / 12 + 3
        x, y = point_at(b, sp, 3)
        lvl = (k + f) % 3
        cv.glint(x, y, ('#f3feff', '#6fe3ff', '#1a7fa8')[lvl])
    run_shine(cv, b, f, b.rows(5), [['#ffffff', '#e6f6ff', '#bfe3ff', '#6fb7ff']], n=2, tail=10)
    # Tentacles from the bottom corners: they climb the sides over the band and curl into a hook, swaying.
    flesh = ['#9b7ad8', '#6a4bb0', '#4a2f88', '#2e1a5e', '#140a30']
    sway = (0, 1, 2, 2, 1, 0)[f] * 0.5
    for side in (-1, 1):
        path = []
        for i in range(30):
            t = i / 29
            path.append((4.0 + 1.4 * math.sin(t * 7 + f * math.pi / 3) * (1 - t * 0.5) + sway * t, 46.5 - t * 26,
                         2.0 - t * 0.7))
        cx0, cy0 = 4.6 + sway, 20.5
        for i in range(1, 16):
            a = math.pi - i / 15 * math.pi * 1.25
            path.append((cx0 + math.cos(a) * 2.4, cy0 - math.sin(a) * 2.4, 1.5 - i / 15 * 0.9))
        if side > 0:
            path = [(S - x, y, r) for (x, y, r) in path]
        tm = np.zeros((S, S), bool)
        lit = np.zeros((S, S), bool)
        for (x, y, r) in path:
            c_ = cv.circle(x, y, r)
            tm |= c_
            lit |= cv.circle(x - 0.5, y - 0.5, r * 0.5) & c_
        tcol = cv.fill(flesh[2])
        tcol[lit] = hexc(flesh[1])
        cv.obj(tm, tcol, flesh[4])
        for k in (4, 10, 16, 22):
            x, y, r = path[k]
            cv.glint(int(round(x - side * 0.8)), int(round(y)), '#6fe3ff')
    # The lure: a short stalk from the top and a glowing bulb that breathes.
    for x, y in ((20, 1), (21, 1), (22, 2), (23, 2)):
        cv.px(x, y, '#4a2f88')
    rr = (1.6, 2.0, 2.4, 2.4, 2.0, 1.6)[f]
    bulb = cv.circle(24.5, 4.0, rr)
    cv.obj(bulb, '#b8f6ff', '#1a7fa8')
    cv.finish()
    cv.glint(24, 3, '#ffffff')
    if f in (2, 3):
        cv.sparkle(24, 4, 1, core='#ffffff', mid='#b8f6ff')
    # Bubbles rising up the sides (two pixels a frame, twelve apart, so the loop closes).
    for x0 in (2, 45):
        for k in range(4):
            y = 40 - ((k * 12 + f * 2) % 48)
            if 2 < y < 45:
                cv.glint(x0, y, '#bfe3ff')
    clear_window(cv)
    return cv


def crown(f=0):
    """Corona: a gold moulding round a UV velvet channel with gold beads, a cut gem at each corner (ruby, sapphire,
    emerald and amethyst) and a crown on top. Four shines run round the gold, the crown's points flash in turn and the
    gems catch the light one after another."""
    cv = canvas()
    b = Band(cv, outer=1)
    col = b.shade(cv.fill(GOLD6[2]), [(0.5, 0), (0.2, 1), (0.05, 0.4), (0.5, 0), (0.5, 0), (0.25, 0.8),
                                      (0.5, 0)], GOLD6)
    velvet = b.rows(3, 4)
    col[velvet] = hexc('#5a43d6')
    col[velvet & (b.lit < 0)] = hexc('#3a2a9a')
    col[b.rows(3) & (b.lit > 0)] = hexc('#7259ee')
    beads = b.rows(4) & (np.mod(np.round(b.s), 4) == 0)
    col[beads] = hexc(GOLD6[1])
    cv.obj(b.mask, col)
    gold_mask = b.mask & ~velvet
    # Corner settings with cut gems.
    for (x0, y0), ramp in zip(((1, 1), (39, 1), (1, 39), (39, 39)), (RUBY, SAPPHIRE, EMERALD, AMETHYST)):
        boss = cv.rect(x0, y0, x0 + 8, y0 + 8) & ~((cv.PX - x0 - 4) ** 2 + (cv.PY - y0 - 4) ** 2 > 22)
        bcol = cv.fill(GOLD6[2])
        bcol[boss & (cv.PX + cv.PY < x0 + y0 + 7)] = hexc(GOLD6[1])
        bcol[boss & (cv.PX + cv.PY > x0 + y0 + 10)] = hexc(GOLD6[3])
        cv.obj(boss, bcol, GOLD6[5])
        gold_mask |= boss
        cut_gem(cv, x0 + 4, y0 + 4, 2.6, ramp)
    # The crown.
    base = cv.rect(15, 5, 33, 8)
    pts = [(15, 5), (15, 2.5), (18, 4), (20.5, 1.5), (24, 3.5), (27.5, 1.5), (30, 4), (33, 2.5), (33, 5)]
    crownm = cv.poly(pts) | base
    ccol = cv.fill(GOLD6[2])
    ccol[crownm & (cv.PY < 4)] = hexc(GOLD6[1])
    ccol[crownm & (cv.PX > 30)] = hexc(GOLD6[3])
    ccol[base] = hexc(GOLD6[3])
    ccol[base & (cv.PY < 6)] = hexc(GOLD6[1])
    cv.obj(crownm, ccol, GOLD6[5])
    gold_mask |= crownm
    for x, ramp in ((19, SAPPHIRE), (24, RUBY), (29, SAPPHIRE)):
        cv.stamp(x - 1, 6, ['ab'], {'a': ramp[0], 'b': ramp[2]})
    tips = [(15, 2), (20, 1), (24, 2), (28, 1), (33, 2)]
    for x, y in tips:
        cv.px(x, y, '#ffffff')
    run_shine(cv, b, f, gold_mask & ~crownm, [GOLD6], n=4, tail=8)
    # A point of the crown flashes each frame, in turn (five points over six frames: the centre one twice).
    order = [2, 1, 3, 0, 4, 2]
    tx, ty = tips[order[f]]
    cv.finish()
    cv.sparkle(tx, max(1, ty), 2 if order[f] == 2 else 1, core='#ffffff', mid='#fffbe6', tip=GOLD6[1])
    # The gems glint in turn.
    gx, gy = [(4, 4), (42, 4), (42, 42), (4, 42), (4, 4), (42, 4)][f]
    cv.glint(gx, gy, '#ffffff')
    cv.glint(gx - 1, gy, '#ffffff')
    clear_window(cv)
    return cv


def aurora(f=0):
    """Aurora: a night band with stars where curtains of aurora (green below, teal and violet above) ripple round
    the frame; a frosted lip inside."""
    cv = canvas()
    night = ['#2a2f5e', '#1c2050', '#141838', '#0e1030', '#0b0c24', '#070a1c']
    b = Band(cv, outer=1, corner=4)
    col = b.shade(cv.fill(night[3]), [(0.5, 0), (0.35, 1), (0.6, 0), (0.7, 0), (0.7, 0), (0.4, 0.4), (0.5, 0)],
                  night)
    rng = np.random.default_rng(6)
    ys, xs = np.nonzero(b.rows(1, 4))
    for i in rng.choice(len(xs), 18, replace=False):
        col[ys[i], xs[i]] = hexc('#bfe3ff' if i % 2 else '#6f86c8')
    sp = 2 * math.pi * b.s / b.P
    ph = 2 * math.pi * f / FRAMES
    curtain = (0.55 * np.sin(sp * 3 + ph) + 0.35 * np.sin(sp * 7 - ph * 2 + 1.3) + 0.25 * np.sin(sp * 13 + ph * 3))
    rays = 0.5 + 0.5 * np.sin(sp * 29 - ph)
    intensity = curtain + rays * 0.35
    r = b.r.astype(float)
    band = b.mask & (b.r >= 1) & (b.r <= 4)
    # The curtain hangs from the inner edge and reaches further out where it is stronger; dark sky between.
    reach = 4.6 - np.clip((intensity + 0.25) * 2.6, 0, 3.6)
    lit = band & (r >= reach) & (intensity > -0.2)
    # Green at the foot (inner rows), teal, then violet at the top of each ray.
    foot = r >= 3.6
    mid = (r >= 2.6) & ~foot
    strong = intensity > 0.6
    col[lit & foot] = hexc('#45e3a6')
    col[lit & foot & strong] = hexc('#9df5d0')
    col[lit & mid] = hexc('#22b3a8')
    col[lit & mid & strong] = hexc('#3fe0d0')
    col[lit & ~foot & ~mid] = hexc('#7259ee')
    col[lit & ~foot & ~mid & strong] = hexc('#b39dff')
    col[b.rows(1) & (b.lit > 0)] = hexc('#8fb4e8')
    col[b.rows(1) & (b.lit < 0)] = hexc('#4a5a98')
    col[b.rows(5) & (b.lit > 0)] = hexc('#e6f6ff')
    col[b.rows(5) & (b.lit < 0)] = hexc('#8fb4e8')
    cv.obj(b.mask, col)
    twinkles(cv, [(6, 3), (40, 44), (44, 20), (3, 30)], f, mid='#9df5d0')
    return done(cv)


def ember(f=0):
    """Ascua: forged iron crusted with slag, its cracks glowing and throbbing hotter towards the bottom, and embers
    that rise off it all round."""
    cv = canvas()
    iron = ['#7a625a', '#5a4440', '#3e2c28', '#2a1c1a', '#1a100e', '#0c0606']
    b = Band(cv, outer=1, chamfer=3)
    col = b.shade(cv.fill(iron[2]), [(0.5, 0), (0.2, 1), (0.4, 0.5), (0.55, 0), (0.6, -0.5), (0.4, 0.5),
                                     (0.5, 0)], iron)
    tex = noise(S, S, 61, cell=3.0, octaves=2)
    slag = b.mask & (b.r >= 2) & (b.r <= 4) & (tex > 0.62)
    col[slag] = hexc(iron[1])
    n = noise(S, S, 62, cell=5.0, octaves=2)
    heat = np.clip((cv.PY - 4) / 40, 0, 1)  # hotter at the bottom
    crack = b.mask & (b.r >= 1) & (b.r <= 5) & (np.abs(n - 0.5) < 0.035 + heat * 0.04)
    # Each crack segment throbs on a three-frame cycle, out of phase along the frame.
    lvl = (np.floor(b.s / 7).astype(int) + f) % 3
    hot = ['#fff2b0', '#ffc94a', '#ff9a3c']
    warm = ['#ff9a3c', '#ff5a1f', '#c2300f']
    for i in range(3):
        col[crack & (lvl == i) & (heat > 0.55)] = hexc(hot[i])
        col[crack & (lvl == i) & (heat <= 0.55)] = hexc(warm[i])
    # The glow round the cracks.
    near = b.mask & dilate4(crack) & ~crack & (b.r >= 1) & (b.r <= 5)
    col[near & (heat > 0.5)] = hexc('#7a2a14')
    col[b.rows(1) & (b.side == 2)] = hexc('#c2300f')
    cv.obj(b.mask, col)
    cv.finish()
    # Embers rising: two pixels a frame, twelve apart, so the loop closes.
    rng = np.random.default_rng(14)
    for k in range(16):
        x = int(rng.integers(1, 47))
        y0 = int(rng.integers(0, 12))
        for rep in range(4):
            y = 46 - ((y0 + rep * 12 + f * 2) % 48)
            inside = W0 - 1 <= x <= W1 and W0 - 1 <= y <= W1
            if not inside and 0 <= y < S:
                c = '#fff2b0' if (k + rep) % 4 == 0 else '#ffc94a' if (k + rep) % 2 else '#ff9a3c'
                cv.glint(x, y, c)
    clear_window(cv)
    return cv


def quasar(f=0):
    """Cuásar: a band of deep space with a channel of energy; at the top, a white core inside a turning accretion
    disk; pulses of light run from it down both sides and meet in a burst at the bottom."""
    cv = canvas()
    space = ['#3a2a9a', '#2a1c70', '#1c1450', '#130c36', '#0b0824', '#05030f']
    b = Band(cv, outer=1, corner=3)
    col = b.shade(cv.fill(space[3]), [(0.5, 0), (0.15, 1), (0.6, 0), (0.6, 0), (0.6, 0), (0.3, 0.6), (0.5, 0)],
                  space)
    rng = np.random.default_rng(9)
    ys, xs = np.nonzero(b.rows(2) | b.rows(4))
    for i in rng.choice(len(xs), 16, replace=False):
        col[ys[i], xs[i]] = hexc('#e8ddff' if i % 2 else '#9b86ff')
    jet = b.rows(3)
    col[b.rows(2, 4)] = hexc('#0e4a6e')
    col[jet] = hexc('#1a7fa8')
    col[b.rows(1) & (b.lit > 0)] = hexc('#b39dff')
    col[b.rows(1) & (b.lit < 0)] = hexc('#5a43d6')
    col[b.rows(5) & (b.lit > 0)] = hexc('#9b86ff')
    col[b.rows(5) & (b.lit < 0)] = hexc('#3a2a9a')
    cv.obj(b.mask, col)
    # Pulses running down both sides from the top centre.
    s_top = 24 - (1 + W0) / 2.0
    q = np.minimum(np.mod(b.s - s_top, b.P), np.mod(s_top - b.s, b.P))  # distance from the top centre
    Q = b.P / 2
    best = np.full(q.shape, 1e9)
    for h in [(i + f / FRAMES) * Q / 3 for i in range(3)]:
        ds = h - q  # behind the head (towards the core)
        best = np.where((ds >= 0) & (ds < best), ds, best)
    lmap2 = {hexc('#1a7fa8'): hexc('#ffffff'), hexc('#0e4a6e'): hexc('#6fe3ff')}
    lmap1 = {hexc('#1a7fa8'): hexc('#6fe3ff'), hexc('#0e4a6e'): hexc('#1a7fa8')}
    chan = b.rows(2, 4)
    apply_lift(cv, chan & (best < 2.5), lmap2)
    apply_lift(cv, chan & (best >= 2.5) & (best < 9), lmap1)
    # The accretion disk and the core.
    d, a = np.hypot((cv.PX - 24) / 11.5, (cv.PY - 4) / 3.4), np.arctan2((cv.PY - 4) / 3.4, (cv.PX - 24) / 11.5)
    disk = (d <= 1) & (d >= 0.3)
    seg = (np.floor((a / (2 * math.pi)) * 12) + f * 2) % 3
    dcol = cv.fill('#e05cff')
    dcol[disk & (seg == 0)] = hexc('#ffb8d0')
    dcol[disk & (seg == 1)] = hexc('#e05cff')
    dcol[disk & (seg == 2)] = hexc('#8e2bb3')
    dcol[disk & (d < 0.55)] = hexc('#ffe58a')
    dcol[disk & (d < 0.42)] = hexc('#fffbe6')
    cv.obj(disk, dcol, '#2a0d3a')
    core = cv.circle(24, 4, 2.6)
    ccol = cv.fill('#ffffff')
    ccol[np.hypot(cv.PX - 24, cv.PY - 4) > 1.6] = hexc('#b8f6ff')
    cv.obj(core, ccol, '#2fb8e0')
    cv.finish()
    cv.sparkle(24, 4, 2 if f % 2 == 0 else 1, core='#ffffff', mid='#b8f6ff', tip='#6fe3ff')
    # The burst at the bottom where the jets meet.
    size = (0, 1, 2, 2, 1, 0)[f]
    cv.sparkle(24, 44, size, core='#ffffff', mid='#6fe3ff', tip='#2fb8e0')
    clear_window(cv)
    return cv


def prism(f=0):
    """Prisma: a frame of cut crystal with a spectrum caught inside that runs round it, prism gems at the corners
    and a white flash that sweeps the glass."""
    cv = canvas()
    glass = ['#ffffff', '#eef4ff', '#d4e2ff', '#b4c4f0', '#8a9cd8', '#5a6aa8']
    b = Band(cv, outer=1, chamfer=4)
    col = b.shade(cv.fill(glass[2]), [(0.5, 0), (0.1, 1), (0.3, 0.8), (0.45, 0), (0.45, 0), (0.25, -0.9),
                                      (0.5, 0)], glass)
    spec = ['#ff6b7a', '#ff9a3c', '#ffe58a', '#45e3a6', '#6fe3ff', '#9b86ff']
    spec_d = ['#e8435a', '#e0762a', '#e0b84a', '#17b07e', '#2fb8e0', '#7259ee']
    idx = (np.floor(b.s / 3).astype(int) - f) % 6
    for i in range(6):
        col[b.rows(3) & (idx == i)] = hexc(spec[i])
        col[b.rows(4) & (idx == i)] = hexc(spec_d[i])
    cv.obj(b.mask, col)
    glass_mask = b.mask & ~b.rows(3, 4)
    # Corner prisms: triangles of crystal with a rainbow edge.
    for (cx, cy, sx, sy) in ((4.5, 4.5, -1, -1), (43.5, 4.5, 1, -1), (4.5, 43.5, -1, 1), (43.5, 43.5, 1, 1)):
        tri = cv.poly([(cx + sx * 3.8, cy + sy * 3.8), (cx - sx * 3.2, cy + sy * 3.8), (cx + sx * 3.8, cy - sy * 3.2)])
        tcol = cv.fill('#eef4ff')
        tcol[tri & ((cv.PX - cx) * sx + (cv.PY - cy) * sy > 2.2)] = hexc('#b4c4f0')
        cv.obj(tri, tcol, '#5a6aa8')
        for i, c in enumerate(spec[:4]):
            x = int(cx - sx * 1.5 + sx * i)
            y = int(cy + sy * 2.5 - sy * i)
            cv.glint(x, y, c)
    run_shine(cv, b, f, glass_mask, [glass], n=4, tail=6, top='#ffffff')
    cv.finish()
    hs = heads(f, 4, b.P)
    for h in hs[:2]:
        x, y = point_at(b, h, 1)
        cv.sparkle(x, y, 1, core='#ffffff', mid='#eef4ff')
    clear_window(cv)
    return cv


def solar(f=0):
    """Solar: a band of molten gold with a sun on top; its rays turn round the frame a pixel a frame, long and short
    in turn, and a shine runs along the gold."""
    cv = canvas()
    sun = ['#fffbe6', '#ffe58a', '#ffc94a', '#ff9a3c', '#e0762a', '#c25f1c', '#7a3510']
    b = Band(cv, outer=3)
    col = b.shade(cv.fill(sun[2]), [(0.5, 0), (0.15, 1), (0.05, 0.3), (0.5, -0.9), (0.5, 0)], sun)
    cv.obj(b.mask, col)
    # Rays: every six pixels along the outer edge, turning one pixel a frame, long and short in turn.
    rays = np.zeros((S, S), bool)
    rcol = cv.fill(sun[1])
    for k in range(int(round(b.P / 6))):
        sp = k * 6 + f
        long = k % 2 == 0
        for r, w in ((-1, 1), (-2, 1 if long else 0), (-3, 0 if long else -1)):
            if w < 0:
                continue
            for dw in range(-w, w + 1):
                x, y = point_at(b, sp + dw, r)
                if 0 <= x < S and 0 <= y < S:
                    rays[y, x] = True
                    rcol[y, x] = hexc(sun[0] if (dw == 0 and r <= -2) else sun[1] if dw == 0 else sun[2])
    cv.obj(rays & ~b.mask, rcol)
    run_shine(cv, b, f, b.mask, [sun], n=2, tail=10)
    # The sun on top.
    corona = cv.circle(24, 4.5, 5.2) & ~b.mask
    cv.obj(corona, sun[3], sun[5])
    disc, u, v = cv.ell(24, 4.5, 3.9, 3.9)
    dcol = cv.fill(sun[1])
    dcol[(u * u + v * v) < 0.45] = hexc(sun[0])
    dcol[disc & (u + v > 0.9)] = hexc(sun[2])
    cv.obj(disc, dcol, sun[5])
    cv.finish()
    cv.glint(22, 3, '#ffffff')
    cv.glint(23, 3, '#ffffff')
    if f % 3 == 0:
        cv.sparkle(24, 4, 2, core='#ffffff', mid='#fffbe6', tip=sun[1])
    clear_window(cv)
    return cv
