"""The parts every 32×32 portrait shares: the backdrop (a lit card behind the bust), shoulders, neck, head and face.
Front-facing busts, light from the upper left, the head centred on x = 16 so faces stay symmetric."""
import math
import numpy as np
from core import Canvas, hexc, mix, BACK
from palette import INK, SKIN, LIPS

N = 32
CX = 16.0


def canvas():
    return Canvas(N)


def backdrop(cv, ramp, cx=16.0, cy=12.0, r=22.0, stars=None, seed=0, star_color='#ffffff', dim_star=None, spread=0.55):
    """A card behind the figure: `ramp` light to dark, brightest round (cx, cy), bands with a dithered seam, darker
    corners, and a few stars (`stars` of them) in the dark part."""
    d = np.hypot(cv.PX - cx, (cv.PY - cy) * 1.05) / r
    val = np.clip(1.0 - d, 0, 1) ** 0.9
    col = cv.fill(ramp[-1])
    cv.tones(col, np.ones((N, N), bool), val, ramp, dither=True, spread=spread)
    cv.rim = ramp[1]
    cv.back(np.ones((N, N), bool), col)
    if stars:
        rng = np.random.default_rng(seed)
        placed = 0
        tries = 0
        while placed < stars and tries < 500:
            tries += 1
            x, y = int(rng.integers(0, N)), int(rng.integers(0, N))
            if val[y, x] > 0.45:
                continue
            c = star_color if rng.random() < 0.45 else (dim_star or mix(star_color, ramp[-1], 0.45))
            cv.back(cv.cells([(x, y)]), c)
            placed += 1


def shoulders(cv, top=22.5, half=14.5, cx=CX):
    """The mask of a pair of shoulders: a wide dome from `top` down past the bottom edge."""
    m, u, v = cv.ell(cx, top + 11.5, half, 11.5)
    return m & (cv.PY >= top), u, v


def shade_body(cv, mask, u, v, ramp, dither=False, bias=0.0):
    col = cv.fill(ramp[1])
    val = np.clip(0.55 - u * 0.55 - (v + 0.6) * 0.25 + bias, 0, 1)
    cv.tones(col, mask, val, ramp, dither=dither)
    return col


def head_mask(cv, widths, top, cx=CX):
    """A head from its pixel width per row (`widths[i]` for row top+i), centred on cx."""
    m = np.zeros((N, N), bool)
    for i, w in enumerate(widths):
        y = top + i
        if 0 <= y < N and w > 0:
            x0 = int(round(cx - w / 2))
            m[y, max(0, x0):min(N, x0 + w)] = True
    return m


HEAD = [8, 10, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 10, 10, 8, 6]  # rows 5..20


def skin_shade(cv, mask, tone, cx=CX, cy=12.5, rx=6.5, ry=8.5, dither=False):
    """Face shading by bands: lit at the upper left, shade down the right and under the jaw."""
    ramp = SKIN[tone] if isinstance(tone, str) else tone
    u = (cv.PX - cx) / rx
    v = (cv.PY - cy) / ry
    val = np.clip(0.62 - u * 0.42 - v * 0.22 - np.clip(v - 0.55, 0, 1) * 0.6, 0, 1)
    col = cv.fill(ramp[1])
    cv.tones(col, mask, val, ramp[:4], dither=dither)
    return col


def head(cv, tone, widths=HEAD, top=5, ears=(12, 15), cx=CX, ear_x=None, line=None):
    """Neck, ears and head in a skin `tone`. Returns the head mask."""
    ramp = SKIN[tone] if isinstance(tone, str) else tone
    line = line or ramp[4]
    hm = head_mask(cv, widths, top, cx)
    if ears:
        ex0, ex1 = ear_x if ear_x else (int(cx - widths[ears[0] - top] / 2) - 1, int(cx + widths[ears[0] - top] / 2))
        em = cv.cells([(ex0, y) for y in range(ears[0], ears[1])] + [(ex1, y) for y in range(ears[0], ears[1])])
        ecol = cv.fill(ramp[2])
        ecol[cv.cells([(ex0, ears[0] + 1)])] = hexc(ramp[1])
        cv.obj(em, ecol, line)
    col = skin_shade(cv, hm, ramp, cx=cx, cy=top + 7.5)
    cv.obj(hm, col, line)
    return hm


def neck(cv, tone, top=18, bottom=24, half=3, cx=CX, line=None):
    ramp = SKIN[tone] if isinstance(tone, str) else tone
    m = cv.rect(cx - half, top, cx + half, bottom)
    col = cv.fill(ramp[2])
    col[m & (cv.PX < cx - half + 1.5)] = hexc(ramp[1])
    col[m & (cv.PY < top + 2.5)] = hexc(ramp[3])
    cv.obj(m, col, line or ramp[4])
    return m


def eyes(cv, y, tone, iris='#2a1a12', lx=12, rx=18, lid=None, white='#f3f5ff', style='open', lash=False):
    """Two eyes two pixels wide: the lid line on top and the eye below (iris inward so the gaze meets the viewer)."""
    ramp = SKIN[tone] if isinstance(tone, str) else tone
    lid = lid or ramp[4]
    if style == 'closed':
        for x in (lx, lx + 1, rx, rx + 1):
            cv.px(x, y + 1, lid)
        return
    for x in (lx, lx + 1, rx, rx + 1):
        cv.px(x, y, lid)
    cv.px(lx, y + 1, white)
    cv.px(lx + 1, y + 1, iris)
    cv.px(rx, y + 1, iris)
    cv.px(rx + 1, y + 1, white)
    if lash:
        cv.px(lx - 1, y, lid)
        cv.px(rx + 2, y, lid)


def brows(cv, y, color, lx=12, rx=18, shape='flat'):
    if shape == 'flat':
        pts = [(lx, y), (lx + 1, y), (rx, y), (rx + 1, y)]
    elif shape == 'arch':
        pts = [(lx, y), (lx + 1, y - 1), (rx, y - 1), (rx + 1, y)]
    elif shape == 'stern':
        pts = [(lx, y - 1), (lx + 1, y), (rx, y), (rx + 1, y - 1)]
    elif shape == 'thick':
        pts = [(lx - 1, y), (lx, y), (lx + 1, y), (rx, y), (rx + 1, y), (rx + 2, y)]
    else:
        pts = []
    for x, yy in pts:
        cv.px(x, yy, color)


def nose(cv, y, tone, cx=CX):
    ramp = SKIN[tone] if isinstance(tone, str) else tone
    cv.px(int(cx), y, ramp[3])
    cv.px(int(cx) - 1, y - 1, ramp[0])


def mouth(cv, y, tone, style='smile', cx=CX, color=None):
    ramp = SKIN[tone] if isinstance(tone, str) else tone
    lip = color or LIPS.get(tone if isinstance(tone, str) else '', ramp[3])
    x = int(cx)
    if style == 'smile':
        cv.px(x - 2, y - 1, ramp[3])
        cv.px(x - 1, y, lip)
        cv.px(x, y, lip)
        cv.px(x + 1, y - 1, ramp[3])
    elif style == 'flat':
        cv.px(x - 1, y, lip)
        cv.px(x, y, lip)
    elif style == 'grin':
        cv.px(x - 2, y - 1, lip)
        cv.px(x - 1, y, lip)
        cv.px(x, y, lip)
        cv.px(x + 1, y - 1, lip)
        cv.px(x - 1, y - 1, '#ffffff')
        cv.px(x, y - 1, '#ffffff')
    elif style == 'soft':
        cv.px(x - 1, y, lip)
        cv.px(x, y, lip)
        cv.px(x - 1, y + 1, ramp[2])
        cv.px(x, y + 1, ramp[2])


def blush(cv, y, tone, lx=11, rx=20, color=None):
    ramp = SKIN[tone] if isinstance(tone, str) else tone
    c = color or mix(ramp[1], '#ff6b7a', 0.35)
    cv.px(lx, y, c)
    cv.px(rx, y, c)


def rim_light(cv, color, t=0.45, side=1):
    """The card's light catching the figure's far edge: the pixels just inside the silhouette on the right (or left)
    lean towards `color`. Call before finish()."""
    from core import FILL, LINE, EMPTY, SOFT, dilate4
    solid = (cv.k == FILL) | (cv.k == LINE)
    outside = (cv.k == EMPTY) | (cv.k == SOFT) | (cv.k == BACK)
    edge = solid & dilate4(outside)
    nxt = np.zeros_like(edge)
    if side > 0:
        nxt[:, :-1] = edge[:, 1:]
    else:
        nxt[:, 1:] = edge[:, :-1]
    m = solid & ~edge & nxt
    rgb = np.array(hexc(color), float)
    cur = cv.c[m].astype(float)
    cv.c[m] = np.round(cur + (rgb - cur) * t).astype(np.uint8)


def done(cv, rim=True, t=0.45):
    """Rim light from the card (unless rim is False), then the ink silhouette."""
    if rim and getattr(cv, 'rim', None):
        rim_light(cv, cv.rim if rim is True else rim, t)
    return cv.finish()


def badge(cv, x, y, color='#ffc94a', dark='#7a3510'):
    """The ECN badge: a 3×3 plate with braille dots (the squad's mark)."""
    cv.stamp(x, y, ['ddd', 'dcd', 'ddd'], {'d': dark, 'c': color})
    cv.px(x, y, color)
    cv.px(x + 2, y + 2, color)
