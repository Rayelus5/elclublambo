"""The default avatars: the ECN crew (bloque C, C3). Twelve front-facing busts, each on its own coloured card, varied
in skin, age, body and species: pilots, technicians, androids, xenos and the station cat."""
import math
import numpy as np
from core import hexc, mix, dilate4
from palette import (P, INK, SKIN, HAIR, LIPS, SKY, UV, TERM, TEAL, SOLAR, NOVA, CORAL, ICE, CYAN, STEEL, IRON,
                     SILVER, GOLD, NIGHT, GLITCH)
from portrait import (canvas, backdrop, shoulders, shade_body, head, neck, eyes, brows, nose, mouth, blush, badge,
                      head_mask, skin_shade, HEAD, CX, done)

ORANGE_SUIT = ['#ffd27a', '#ff9a3c', '#d9681f', '#9c4512', '#5a2208']
NAVY = ['#6a76c8', '#3f4a9a', '#2a3270', '#1a1f4a', '#0e1130']
WHITE_COAT = ['#ffffff', '#e4e8f8', '#b9c0e0', '#7f88b8', '#454c80']
TEAL_SCRUBS = ['#bff7ea', '#5fd8bf', '#22a58f', '#13706a', '#0a3f3c']


def suit(cv, ramp, top=23.0, half=14.5, line=None):
    m, u, v = shoulders(cv, top, half)
    col = shade_body(cv, m, u, v, ramp)
    cv.obj(m, col, line or ramp[-1])
    return m


def pilot(f=0):
    """Pilot: flight helmet with the visor up, a Solar stripe, ear cups and a mic; an orange flight suit."""
    cv = canvas()
    backdrop(cv, ['#9fc4ff', '#6f97f5', '#4767f2', '#3a58e0', '#26389a', '#17225e'], cy=11, r=21, stars=6, seed=3)
    tone = 'brown'
    suit(cv, ORANGE_SUIT)
    # Collar: a grey inner neck and the zip.
    coll = cv.poly([(11, 23), (21, 23), (18.5, 28), (16, 30), (13.5, 28)])
    ccol = cv.fill(STEEL[2])
    ccol[coll & (cv.PX < 16)] = hexc(STEEL[1])
    cv.obj(coll, ccol, STEEL[4])
    for y in range(26, 32):
        cv.px(16, y, ORANGE_SUIT[3])
    badge(cv, 7, 26)
    cv.stamp(22, 26, ['nnn', 'www'], {'n': '#ff6b7a', 'w': '#f3f5ff'})
    neck(cv, tone, top=18, bottom=24)
    hm = head(cv, tone)
    # Hair peeking under the helmet.
    hair = HAIR['black']
    for x in range(11, 21):
        cv.px(x, 9, hair[2] if x % 3 else hair[1])
    cv.px(10, 10, hair[2])
    cv.px(21, 10, hair[2])
    # Helmet: a round shell that wraps the sides of the face down to the jaw, the raised visor on its brow, the
    # Solar stripe over the top and round ear cups.
    shell, u, v = cv.ell(16, 11, 9.4, 9.6)
    opening = cv.rect(10, 9.5, 22, 32) | cv.poly([(10, 9.6), (22, 9.6), (21, 8.6), (11, 8.6)])
    shell &= ~opening & (cv.PY < 19)
    hcol = cv.fill(ICE[2])
    white = ['#ffffff', '#e6f0ff', '#c4d2f2', '#8f9dd0', '#5d6aa6']
    cv.tones(hcol, shell, np.clip(0.8 - u * 0.45 - v * 0.35, 0, 1), white, dither=False)
    stripe = shell & (np.abs(cv.PX - 16) < 1.6) & (cv.PY < 8)
    hcol[stripe] = hexc(SOLAR[2])
    hcol[stripe & (cv.PX > 16)] = hexc(SOLAR[3])
    # A seam where the sides meet the dome.
    hcol[shell & (np.abs(cv.PY - 12.5) < 0.5) & ((cv.PX < 10) | (cv.PX > 22))] = hexc(white[3])
    cv.obj(shell, hcol, '#3a4270')
    visor, vu, vv = cv.ell(16, 5.6, 7.6, 2.4)
    vcol = cv.fill(CYAN[3])
    cv.tones(vcol, visor, np.clip(0.6 - vu * 0.5 - vv * 0.3, 0, 1), [CYAN[1], CYAN[2], CYAN[3], CYAN[4]], dither=False)
    cv.obj(visor, vcol, '#0e3a5e')
    for x in (13, 14, 15):
        cv.glint(x, 4, '#ffffff')
    cv.glint(11, 5, '#e6f6ff')
    for cx0 in (7.5, 24.5):
        cup, cu, cvv = cv.ell(cx0, 14.5, 2.3, 3.2)
        ccol = cv.fill(STEEL[3])
        cv.tones(ccol, cup, np.clip(0.6 - cu * 0.4 - cvv * 0.4, 0, 1), STEEL[1:5], dither=False)
        cv.obj(cup, ccol, STEEL[5])
    cv.px(7, 14, SOLAR[2])
    # Face.
    brows(cv, 11, hair[2])
    eyes(cv, 12, tone, iris='#24140c')
    nose(cv, 15, tone)
    mouth(cv, 18, tone, 'smile')
    # Mic boom from the right cup.
    for x, y in ((23, 17), (22, 18), (21, 18), (20, 18)):
        cv.px(x, y, STEEL[2])
    cv.px(19, 18, INK)
    cv.px(19, 17, STEEL[4])
    return done(cv)


def navigator(f=0):
    """Navigator: short black hair with a side part, a headset with a holo-monocle over one eye, a navy uniform with
    gold trim."""
    cv = canvas()
    backdrop(cv, ['#c8b8ff', '#9b86ff', '#7259ee', '#5a43d6', '#3a2a9a', '#22185e'], cy=11, r=21, stars=7, seed=5)
    tone = 'olive'
    suit(cv, NAVY)
    coll = cv.poly([(12, 23), (20, 23), (18, 26), (14, 26)])
    cv.obj(coll, NAVY[3], NAVY[4])
    # Gold piping down the front and epaulettes.
    for y in range(26, 32):
        cv.px(15, y, GOLD[2])
    ep = cv.rect(3, 25, 8, 27) | cv.rect(24, 25, 29, 27)
    ecol = cv.fill(GOLD[2])
    ecol[ep & (cv.PY < 26)] = hexc(GOLD[1])
    cv.obj(ep, ecol, GOLD[5])
    badge(cv, 20, 28)
    neck(cv, tone)
    head(cv, tone)
    hair = HAIR['black']
    hmask = cv.poly([(9, 12), (9, 7), (11, 4.5), (15, 3.5), (20, 4), (23, 6.5), (23, 12), (21.5, 9), (17, 8.5),
                     (13, 9.5), (11, 10)])
    hcol = cv.fill(hair[2])
    cv.tones(hcol, hmask, np.clip(0.8 - (cv.PX - 9) / 16 - (cv.PY - 4) / 14, 0, 1), hair, dither=False)
    cv.obj(hmask, hcol, hair[3])
    for x, y in ((13, 6), (14, 5), (12, 7)):
        cv.px(x, y, hair[0])
    brows(cv, 11, hair[3])
    eyes(cv, 12, tone, iris='#1c1410')
    nose(cv, 15, tone)
    mouth(cv, 18, tone, 'flat')
    # Headset band over the hair and the holo monocle on the right eye.
    for x, y in ((9, 9), (9, 10), (9, 11), (8, 12), (8, 13), (8, 14)):
        cv.px(x, y, STEEL[3])
    cv.px(8, 15, STEEL[2])
    mono = cv.rect(17, 11, 21, 15)
    mcol = cv.fill(CYAN[2])
    mcol[mono & (cv.PY < 12.5)] = hexc(CYAN[1])
    cv.paint(mono & ~cv.rect(18, 12, 20, 14), CYAN[3])
    cv.px(18, 12, CYAN[1])
    cv.px(19, 13, '#24140c')
    cv.px(18, 13, '#dff9ff')
    cv.px(19, 12, CYAN[2])
    for x in (21, 22):
        cv.px(x, 13, STEEL[3])
    cv.glint(21, 10, CYAN[1])
    return done(cv)


def technician(f=0):
    """Technician: an afro with goggles pushed up, a smudge of grease, Solar overalls over a dark tee."""
    cv = canvas()
    backdrop(cv, ['#9df5d0', '#45e3a6', '#17b07e', '#0b7352', '#064a35', '#04281c'], cy=11, r=21, stars=5, seed=7,
             star_color='#d8fff0')
    tone = 'deep'
    tee = suit(cv, ['#5d628f', '#3d4170', '#262a4f', '#161833', '#0b0c1e'])
    # Overalls bib and straps.
    bib = cv.rect(10, 26, 22, 32) | cv.rect(9, 23, 12, 27) | cv.rect(20, 23, 23, 27)
    bcol = cv.fill(ORANGE_SUIT[1])
    bcol[bib & (cv.PX < 12)] = hexc(ORANGE_SUIT[0])
    bcol[bib & (cv.PX > 20)] = hexc(ORANGE_SUIT[2])
    cv.obj(bib, bcol, ORANGE_SUIT[4])
    cv.px(10, 26, SILVER[1])
    cv.px(21, 26, SILVER[1])
    # A wrench in the bib pocket.
    cv.stamp(13, 27, ['.ss', '..s', '.s.', 's..'], {'s': STEEL[1]})
    cv.stamp(18, 28, ['nn', 'nn'], {'n': '#ff6b7a'})
    neck(cv, tone)
    hm = head(cv, tone)
    hair = ['#6a4a3a', '#432a20', '#2a1812', '#180c08']
    afro, au, av = cv.ell(16, 8.5, 11, 8.2)
    afro &= ~(hm & (cv.PY > 9.5)) & (cv.PY < 15)
    acol = cv.fill(hair[2])
    val = np.clip(0.7 - au * 0.45 - av * 0.45, 0, 1)
    cv.tones(acol, afro, val, hair, dither=True)
    cv.obj(afro, acol, hair[3])
    # Goggles on the forehead.
    strap = cv.rect(6, 8, 26, 9.5)
    cv.obj(strap, '#3d4170', '#161833')
    for gx in (12, 19):
        g, gu, gv = cv.ell(gx + 0.5, 8.5, 2.6, 2.2)
        gcol = cv.fill(SOLAR[3])
        cv.tones(gcol, g, np.clip(0.6 - gu * 0.5 - gv * 0.5, 0, 1), [SOLAR[1], SOLAR[2], SOLAR[3], SOLAR[4]],
                 dither=False)
        cv.obj(g, gcol, STEEL[4])
        cv.glint(gx - 1, 7, '#fffbe6')
    brows(cv, 11, hair[3])
    eyes(cv, 12, tone, iris='#1a0c08', lash=True)
    nose(cv, 15, tone)
    mouth(cv, 18, tone, 'grin')
    cv.px(19, 16, '#3a2a28')
    cv.px(20, 16, '#4a3430')
    return done(cv)


def medic(f=0):
    """Medic: a teal hijab framing the face, white coat with the Nova cross, a kind smile."""
    cv = canvas()
    backdrop(cv, ['#ffd0d6', '#ff9aa6', '#ff6b7a', '#c94f7c', '#7a2a50', '#3e1029'], cy=11, r=21, stars=4, seed=11)
    tone = 'tan'
    coat = suit(cv, WHITE_COAT)
    # Hijab: the drape over head, round the face and over the shoulders.
    scarf = TEAL_SCRUBS
    drape, du, dv = cv.ell(16, 11.5, 9.6, 10.5)
    drape |= cv.poly([(7, 16), (25, 16), (24, 26), (19, 28), (13, 28), (8, 26)])
    dcol = cv.fill(scarf[2])
    cv.tones(dcol, drape, np.clip(0.75 - (cv.PX - 7) / 20 - (cv.PY - 2) / 40, 0, 1), scarf[:4], dither=False)
    cv.obj(drape, dcol, scarf[4])
    # Folds.
    for x, y in ((10, 20), (10, 21), (11, 22), (22, 20), (22, 21), (21, 22), (14, 25), (15, 26), (18, 25)):
        cv.px(x, y, scarf[3])
    # The face opening.
    face = head_mask(cv, [0, 0, 0, 0, 8, 10, 10, 10, 10, 10, 10, 10, 8, 8, 6, 4], 5)
    col = skin_shade(cv, face, tone, cy=13.5)
    cv.obj(face, col, SKIN[tone][4])
    # The band of the underscarf across the forehead.
    for x in range(12, 20):
        cv.px(x, 9, scarf[1] if x < 15 else scarf[2])
    brows(cv, 11, '#3a2016')
    eyes(cv, 12, tone, iris='#2a140a', lash=True)
    nose(cv, 15, tone)
    mouth(cv, 18, tone, 'smile')
    blush(cv, 16, tone, lx=12, rx=19)
    # Nova cross on the coat.
    cv.stamp(24, 27, ['.n.', 'nnn', '.n.'], {'n': '#e8435a'})
    cv.px(24, 28, '#ff6b7a')
    # Stethoscope.
    for x, y in ((9, 28), (9, 29), (10, 30), (11, 31)):
        cv.px(x, y, STEEL[2])
    return done(cv)


def sphere(u, v):
    from core import sphere_light
    return sphere_light(np.clip(u, -1, 1), np.clip(v, -1, 1))


def cadet(f=0):
    """Cadet: young, freckled, ginger hair spilling from under a peaked cadet cap, a sky jacket with a white collar."""
    cv = canvas()
    backdrop(cv, ['#fff2b0', '#ffe58a', '#ffc94a', '#ff9a3c', '#c25f1c', '#7a3510'], cy=11, r=21, stars=4, seed=13,
             star_color='#fffbe6')
    tone = 'porcelain'
    jacket = ['#bfe3ff', '#6fb7ff', '#4767f2', '#26389a', '#17225e']
    suit(cv, jacket)
    coll = cv.poly([(10, 23), (16, 27.5), (22, 23), (22, 25.5), (16, 30), (10, 25.5)])
    ccol = cv.fill('#f3f5ff')
    ccol[coll & (cv.PX > 16)] = hexc('#c9d0ea')
    cv.obj(coll, ccol, '#7f88b8')
    for y in (28, 30):
        cv.px(16, y, GOLD[2])
    cv.stamp(6, 27, ['sss', 'ooo'], {'s': GOLD[1], 'o': GOLD[3]})
    neck(cv, tone)
    head(cv, tone)
    hair = HAIR['auburn']
    # Hair: sideburn tufts and a fringe out from under the brim.
    tuft = cv.poly([(8.5, 8), (11, 8), (11, 15), (9.5, 13), (8.5, 11)]) | cv.poly([(21, 8), (23.5, 8), (23.5, 11),
                                                                                   (22.5, 13), (21, 15)])
    fringe = cv.poly([(10, 8), (22, 8), (21, 11), (19.5, 9.5), (18, 11.5), (16, 9.5), (14, 11.5), (12.5, 9.5),
                      (11, 11)])
    hm = tuft | fringe
    hcol = cv.fill(hair[1])
    hcol[hm & (cv.PX > 17)] = hexc(hair[2])
    hcol[hm & (cv.PY < 9)] = hexc(hair[2])
    cv.obj(hm, hcol, hair[3])
    # Peaked cap: the crown, its band and the brim.
    cap, cu, cvv = cv.ell(16, 6.5, 9.5, 4.2)
    cap &= cv.PY < 8.5
    capcol = cv.fill(NAVY[2])
    cv.tones(capcol, cap, np.clip(0.75 - cu * 0.45 - cvv * 0.4, 0, 1), NAVY[:4], dither=False)
    band = cap & (cv.PY > 6.5)
    capcol[band] = hexc(NAVY[3])
    cv.obj(cap, capcol, NAVY[4])
    brim = cv.poly([(8.5, 8), (23.5, 8), (21.5, 10), (10.5, 10)])
    cv.obj(brim, '#11132e', '#0b0c24')
    cv.stamp(15, 4, ['sS', 'Ss'], {'s': GOLD[1], 'S': GOLD[3]})
    brows(cv, 11, hair[2], shape='arch')
    eyes(cv, 12, tone, iris='#2f5fc0', lid='#5a2a2a', lash=True)
    nose(cv, 15, tone)
    mouth(cv, 18, tone, 'grin')
    for x, y in ((11, 15), (12, 16), (20, 15), (19, 16)):
        cv.px(x, y, SKIN[tone][3])
    return done(cv)


def veteran(f=0):
    """Veteran: deep skin, a white beard and buzz cut, a scar and a cybernetic eye, a coat with service ribbons."""
    cv = canvas()
    backdrop(cv, ['#b9bfe6', '#8890c4', '#6a7090', '#4b5390', '#2a2f5e', '#161935'], cy=11, r=21, stars=5, seed=17)
    tone = 'deep'
    coat = ['#7d8a6a', '#5c6a4c', '#434f36', '#2c3524', '#161c12']
    suit(cv, coat)
    lap = cv.poly([(10, 23), (14, 23), (16, 28), (16, 32), (13, 32), (9, 26)]) | cv.poly(
        [(22, 23), (18, 23), (16, 28), (16, 32), (19, 32), (23, 26)])
    lcol = cv.fill(coat[2])
    lcol[lap & (cv.PX < 16)] = hexc(coat[1])
    cv.obj(lap, lcol, coat[4])
    cv.stamp(20, 28, ['nsg', 'uob'], {'n': '#e8435a', 's': GOLD[2], 'g': '#45e3a6', 'u': '#7259ee', 'o': '#ff9a3c',
                                      'b': '#6fb7ff'})
    cv.stamp(9, 28, ['.s.', 'sws', '.s.'], {'s': GOLD[2], 'w': GOLD[0]})
    neck(cv, tone)
    head(cv, tone)
    white = HAIR['white']
    # Buzz cut on top.
    buzz = head_mask(cv, [8, 10, 12, 12], 5) & ~head_mask(cv, [0, 0, 8, 10], 5)
    bcol = cv.fill(white[2])
    bcol[buzz & (cv.PX < 15)] = hexc(white[1])
    cv.obj(buzz, bcol, white[3])
    # Beard: round the jaw and the chin, a moustache.
    beard = head_mask(cv, [12, 12, 12, 10, 10, 8, 6], 14) & ~head_mask(cv, [0, 0, 0, 0, 4, 0, 0], 14)
    beard &= ~cv.rect(11, 14, 21, 16)
    beard |= cv.rect(13, 16, 19, 17)
    becol = cv.fill(white[1])
    becol[beard & (cv.PX > 17)] = hexc(white[2])
    becol[beard & (cv.PY > 19)] = hexc(white[2])
    cv.obj(beard, becol, white[3])
    cv.px(15, 18, LIPS['deep'])
    cv.px(16, 18, LIPS['deep'])
    brows(cv, 11, white[1], shape='thick')
    eyes(cv, 12, tone, iris='#1a0c08')
    # Cybernetic right eye: a steel ring with a red lens.
    cv.stamp(17, 11, ['tTTt', 'TmnT', 'TxmT', 'tTTt'], {'t': STEEL[4], 'T': STEEL[2], 'm': '#ff4d6d', 'n': '#ffb0b9',
                                                      'x': '#9c2238'})
    cv.glint(19, 12, '#ffe3e7')
    # A scar through the left brow.
    for x, y in ((11, 10), (12, 11), (13, 13), (13, 14)):
        cv.px(x, y, SKIN[tone][0])
    nose(cv, 15, tone)
    return done(cv)


def scientist(f=0):
    """Scientist: lilac undercut, round glasses that catch the light, a lab coat with the ECN badge and a pen."""
    cv = canvas()
    backdrop(cv, ['#cffff8', '#7ff0e4', '#3fe0d0', '#22b3a8', '#13867f', '#0a4f4c'], cy=11, r=21, stars=0)
    # A faint holographic grid behind.
    for x in range(1, 32, 5):
        cv.back(cv.rect(x, 0, x + 1, 32) & (cv.PY > 18), '#2bc4b6')
    for y in range(20, 32, 4):
        cv.back(cv.rect(0, y, 32, y + 1), '#2bc4b6')
    tone = 'light'
    suit(cv, WHITE_COAT)
    shirt = cv.poly([(12, 23), (20, 23), (17.5, 29), (14.5, 29)])
    cv.obj(shirt, '#7259ee', '#3a2a9a')
    lap = cv.poly([(11, 23), (13, 23), (15.5, 31), (14, 32), (9, 26)]) | cv.poly([(21, 23), (19, 23), (16.5, 31),
                                                                                  (18, 32), (23, 26)])
    lcol = cv.fill(WHITE_COAT[1])
    lcol[lap & (cv.PX > 16)] = hexc(WHITE_COAT[2])
    cv.obj(lap, lcol, WHITE_COAT[3])
    cv.stamp(23, 26, ['s', 's', 'k'], {'s': SOLAR[2], 'k': '#3a2a9a'})
    badge(cv, 7, 27, color='#3fe0d0', dark='#13867f')
    neck(cv, tone)
    head(cv, tone)
    hair = HAIR['lilac']
    # Undercut: the left side shaved to stubble, a long sweep parted on the left that falls over the right ear.
    stubble = cv.rect(9.5, 7, 12, 12)
    cv.paint(stubble & head_mask(cv, HEAD, 5) | cv.cells([(9, 12), (9, 13)]), mix(SKIN[tone][2], hair[3], 0.5))
    sweep = cv.poly([(11.5, 7.5), (12, 5), (14, 3.4), (18, 2.8), (22, 4), (24.6, 7), (25, 12), (24, 15.5),
                     (22.6, 13), (22, 10), (20.5, 9), (18, 9.6), (15.5, 9), (13, 8.4)])
    hcol = cv.fill(hair[1])
    cv.tones(hcol, sweep, np.clip(0.95 - (cv.PX - 11) / 16 - (cv.PY - 3) / 16, 0, 1), hair, dither=False)
    # Strands: darker lines that follow the sweep.
    for pts in (((13, 6), (15, 5), (17, 4)), ((15, 8), (17, 7), (19, 6), (21, 6)), ((20, 8), (22, 8), (23, 10),
                                                                                    (23, 12))):
        for x, y in pts:
            hcol[y, x] = hexc(hair[2])
    for x, y in ((14, 4), (15, 4), (13, 5), (16, 3)):
        hcol[y, x] = hexc(hair[0])
    cv.obj(sweep, hcol, hair[3])
    brows(cv, 11, hair[3])
    eyes(cv, 12, tone, iris='#3a2a28', lid=SKIN[tone][3])
    # Round glasses: thin UV frames, the lenses catch the light at the top.
    frame = '#3a2a9a'
    cv.stamp(10, 11, ['.ffff.', 'f....f', 'f....f', '.ffff.'], {'f': frame})
    cv.stamp(16, 11, ['.ffff.', 'f....f', 'f....f', '.ffff.'], {'f': frame})
    cv.px(9, 12, frame)
    cv.px(22, 12, frame)
    for x in (11, 17):
        cv.glint(x, 12, '#ffffff')
    cv.glint(14, 13, '#dff9ff')
    cv.glint(20, 13, '#dff9ff')
    nose(cv, 15, tone)
    mouth(cv, 18, tone, 'smile')
    return done(cv)


def android(f=0):
    """Android: white plating with seams, a visor of two cyan eye bars, ear ports and a cabled neck, a core light."""
    cv = canvas()
    backdrop(cv, ['#4767f2', '#3a58e0', '#26389a', '#1a2266', '#11163f', '#0b0c24'], cy=11, r=20, stars=0)
    # Circuit traces on the card.
    tr = [((2, 4), (6, 4), (8, 6), (8, 12)), ((30, 6), (26, 6), (25, 7), (25, 14)), ((1, 20), (4, 20), (6, 18)),
          ((31, 19), (28, 19), (27, 18))]
    for path in tr:
        for (x0, y0), (x1, y1) in zip(path, path[1:]):
            n = max(abs(x1 - x0), abs(y1 - y0))
            for i in range(n + 1):
                x = round(x0 + (x1 - x0) * i / n)
                y = round(y0 + (y1 - y0) * i / n)
                cv.back(cv.cells([(x, y)]), '#2fb8e0' if (x + y) % 5 else '#6fe3ff')
        cv.back(cv.cells([path[-1]]), '#b8f6ff')
    tone = SKIN['plating']
    body = ['#f3f5ff', '#c9d0ea', '#9aa3d2', '#5d6699', '#2e3462']
    suit(cv, body)
    # Joints and the chest core.
    for x0, x1 in ((8, 10), (22, 24)):
        cv.paint(cv.rect(x0, 24, x1, 32), '#2a2f5e')
    core = cv.circle(16, 28, 2.2)
    cv.obj(core, '#6fe3ff', '#0e4a6e')
    cv.glint(16, 28, '#ffffff')
    cv.glint(15, 27, '#f3feff')
    # Cabled neck.
    nk = cv.rect(13, 18, 19, 24)
    ncol = cv.fill('#2a2f5e')
    for y in (19, 21, 23):
        ncol[nk & (cv.YY == y)] = hexc('#4b5390')
    ncol[nk & (cv.XX == 15)] = hexc('#3fe0d0')
    cv.obj(nk, ncol, '#161935')
    widths = [8, 10, 12, 12, 12, 12, 12, 12, 12, 12, 12, 10, 10, 8, 8, 6]
    hm = head_mask(cv, widths, 4)
    col = skin_shade(cv, hm, tone, cy=11.5)
    cv.obj(hm, col, tone[4])
    # Seams: the brow plate, cheek lines and the jaw.
    for x in range(11, 21):
        cv.px(x, 9, tone[3])
    for y in range(14, 18):
        cv.px(11, y, tone[3])
        cv.px(20, y, tone[3])
    for x in range(13, 19):
        cv.px(x, 17, tone[3])
    # Visor eyes: two bars of cyan light.
    for x in (11, 12, 13):
        cv.glint(x, 12, '#6fe3ff')
    for x in (18, 19, 20):
        cv.glint(x, 12, '#6fe3ff')
    cv.glint(12, 12, '#f3feff')
    cv.glint(19, 12, '#f3feff')
    for x in (11, 12, 13, 18, 19, 20):
        cv.px(x, 11, '#2a2f5e')
        cv.px(x, 13, '#2a2f5e')
    # Ear ports.
    for ex in (9, 22):
        cv.stamp(ex, 11, ['T', 'c', 'T'], {'T': '#4b5390', 'c': '#3fe0d0'})
    # Mouth grille.
    for x in (14, 15, 16, 17):
        cv.px(x, 19, tone[3])
    cv.glint(12, 6, '#ffffff')
    return done(cv)


def drone(f=0):
    """Drone: a round service drone with one big green lens, an antenna with a red light and side thrusters."""
    cv = canvas()
    backdrop(cv, ['#e6f6ff', '#bfe3ff', '#8fcaf5', '#6fb7ff', '#3a7fc8', '#1d3f7a'], cy=14, r=22, stars=0)
    # Hangar floor lines.
    for y in (26, 29):
        cv.back(cv.rect(0, y, 32, y + 1), '#3a7fc8')
    shadow, _, _ = cv.ell(16, 28.5, 8, 1.6)
    cv.back(shadow, '#1d3f7a')
    # Antenna.
    cv.obj(cv.rect(15, 2, 17, 6), STEEL[2], STEEL[4])
    cv.obj(cv.circle(16, 2.5, 1.6), '#ff4d6d', '#9c2238')
    cv.glint(15, 2, '#ffe3e7')
    # Side arms and thrusters.
    for x0 in (3, 25):
        arm = cv.rect(x0, 13, x0 + 4, 19)
        acol = cv.fill(STEEL[2])
        acol[arm & (cv.PY < 14.5)] = hexc(STEEL[1])
        acol[arm & (cv.PY > 17.5)] = hexc(STEEL[3])
        cv.obj(arm, acol, STEEL[4])
        cv.paint(cv.rect(x0 + 1, 19, x0 + 3, 20), SOLAR[2])
    body, u, v = cv.ell(16, 15, 10.2, 10)
    bcol = cv.fill(ICE[2])
    cv.tones(bcol, body, sphere(u, v), ['#ffffff', '#e6ebfa', '#b9c1e3', '#7f88bd', '#545c94'], dither=False)
    # Panel seam round the middle.
    seam = body & (np.abs(cv.PY - (15 + 4.5)) < 0.5)
    bcol[seam] = hexc('#7f88bd')
    cv.obj(body, bcol, '#2a2f5e')
    # The lens.
    lens = cv.circle(16, 13.5, 5.6)
    cv.obj(lens, '#161935', '#0b0c24')
    iris = cv.ring(16, 13.5, 2.2, 4.4)
    irc = cv.fill(TERM[3])
    cv.tones(irc, iris, np.clip(0.75 - (cv.PX - 16) * 0.1 - (cv.PY - 13.5) * 0.15, 0, 1), TERM[:5], dither=False)
    cv.paint(iris, irc)
    cv.paint(cv.circle(16, 13.5, 2.1), '#04281c')
    cv.glint(14, 11, '#ffffff')
    cv.glint(15, 11, '#e4fff4')
    cv.glint(14, 12, '#e4fff4')
    cv.glint(18, 15, '#9df5d0')
    # Thruster glow under.
    cv.px(15, 25, SOLAR[2])
    cv.px(16, 25, SOLAR[2])
    cv.glint(15, 26, SOLAR[1])
    cv.glint(16, 26, SOLAR[0])
    return done(cv)


def xeno_green(f=0):
    """Green xeno: a wide head with ear fins and spots, big amber eyes with slit pupils, a friendly grin."""
    cv = canvas()
    backdrop(cv, ['#f0a6ff', '#e05cff', '#b73fe0', '#8e2bb3', '#541a6e', '#2a0d3a'], cy=11, r=21, stars=6, seed=23)
    tone = 'green'
    suit(cv, ['#c9d0ea', '#9aa3d2', '#6c74ab', '#474d80', '#2b2f57'])
    coll = cv.rect(10, 23, 22, 25)
    cv.obj(coll, '#45e3a6', '#0b7352')
    badge(cv, 21, 27)
    neck(cv, tone, half=2.5)
    # Ear fins.
    for side in (-1, 1):
        fin = cv.poly([(16 + side * 6, 9), (16 + side * 12.5, 6), (16 + side * 11, 10), (16 + side * 12, 13),
                       (16 + side * 6, 15)])
        fcol = cv.fill(SKIN[tone][2])
        fcol[fin & (cv.PY < 10)] = hexc(SKIN[tone][1])
        cv.obj(fin, fcol, SKIN[tone][4])
        for k in (1, 2):
            x = int(16 + side * (6 + k * 2))
            cv.px(x, 10 + k, SKIN[tone][3])
    widths = [8, 12, 14, 14, 14, 14, 14, 14, 14, 12, 12, 10, 8, 6]
    head(cv, tone, widths=widths, top=5, ears=None)
    # Spots on the crown.
    for x, y in ((12, 7), (14, 6), (18, 6), (20, 8), (13, 9)):
        cv.px(x, y, SKIN[tone][3])
    # Big eyes: amber with slit pupils.
    for ex in (10, 18):
        cv.stamp(ex, 11, ['kkkk', 'kaok', 'kaak', '.kk.'] if ex == 10 else ['kkkk', 'koak', 'kaak', '.kk.'],
                 {'k': '#11483a', 'a': '#ffc94a', 'o': '#3a1700'})
        cv.glint(ex + 1, 12, '#fffbe6')
    # Nostrils and a wide grin.
    cv.px(15, 15, SKIN[tone][3])
    cv.px(17, 15, SKIN[tone][3])
    for x in range(12, 20):
        cv.px(x, 17, '#11483a')
    cv.px(11, 16, '#11483a')
    cv.px(20, 16, '#11483a')
    for x in (14, 17):
        cv.px(x, 18, '#ffffff')
    for x in (13, 15, 16, 18):
        cv.px(x, 18, '#7a2a50')
    return done(cv)


def xeno_violet(f=0):
    """Violet xeno: a dome head with tentacles that hang like braids, four eyes and glowing cyan freckles."""
    cv = canvas()
    backdrop(cv, ['#fff2b0', '#ffe58a', '#ffc94a', '#e0962a', '#c27a12', '#7a3d08'], cy=10, r=21, stars=3, seed=29,
             star_color='#fffbe6')
    tone = 'violet'
    ramp = SKIN[tone]
    suit(cv, ['#9df5d0', '#45e3a6', '#17b07e', '#0b7352', '#04281c'])
    coll = cv.poly([(11, 23), (21, 23), (16, 28)])
    cv.obj(coll, '#04281c', '#04281c')
    badge(cv, 21, 27, color='#fffbe6', dark='#0b7352')
    # Tentacles behind: four hanging braids.
    for x0, sway in ((8.5, -1), (11.5, -0.5), (20.5, 0.5), (23.5, 1)):
        tm = np.zeros((32, 32), bool)
        for t in np.linspace(0, 1, 30):
            x = x0 + sway * 1.6 * math.sin(t * 3.2)
            y = 12 + t * 13
            r = 1.6 - t * 0.8
            tm |= cv.circle(x, y, r)
        tcol = cv.fill(ramp[2])
        tcol[tm & (cv.PX < x0)] = hexc(ramp[1])
        cv.obj(tm, tcol, ramp[4])
        for t in (0.3, 0.55, 0.8):
            cv.px(int(x0 + sway * 1.6 * math.sin(t * 3.2)), int(12 + t * 13), ramp[0])
    dome, u, v = cv.ell(16, 11, 8.8, 9.2)
    dome &= cv.PY < 20
    col = cv.fill(ramp[1])
    cv.tones(col, dome, sphere(u, v), ramp[:4], dither=False)
    cv.obj(dome, col, ramp[4])
    # Four eyes: two big glowing almonds and two small ones above them.
    eye = {'k': '#22185e', 'c': '#6fe3ff', 'C': '#2fb8e0', 'w': '#f3feff'}
    cv.stamp(10, 12, ['.kkk.', 'kcwck', '.kCCk', '..kk.'], eye)
    cv.stamp(17, 12, ['.kkk.', 'kcwck', 'kCCk.', '.kk..'], eye)
    cv.stamp(12, 9, ['kk', 'kc'], eye)
    cv.stamp(18, 9, ['kk', 'ck'], eye)
    # Bioluminescent freckles.
    for x, y in ((9, 16), (10, 17), (22, 16), (21, 17), (16, 4), (14, 5), (18, 5)):
        cv.glint(x, y, '#6fe3ff')
    # A small beak-like mouth.
    cv.px(15, 17, ramp[4])
    cv.px(16, 17, ramp[4])
    cv.px(15, 18, ramp[3])
    cv.px(16, 18, ramp[3])
    cv.glint(12, 5, '#ffffff')
    cv.glint(11, 6, '#f0d6ff')
    return done(cv)


def cat(f=0):
    """The station cat: an orange tabby in a glass bubble helmet, big green eyes, a collar with the ECN tag."""
    cv = canvas()
    backdrop(cv, ['#5a43d6', '#3a2a9a', '#2a206e', '#1c1450', '#130c36', '#0b0824'], cy=12, r=20, stars=12, seed=31)
    # A little planet low in the card.
    pl, pu, pv = cv.ell(27, 27, 5, 5)
    pcol = cv.fill('#ff8fb3')
    cv.tones(pcol, pl, sphere(pu, pv), ['#ffb8d0', '#ff8fb3', '#c94f7c', '#7a2a50'], dither=False)
    cv.back(pl, pcol)
    fur = ['#ffd9a0', '#ffb060', '#e8803a', '#b8561f', '#6e2e10']
    # Suit collar ring.
    suit(cv, ['#f3f5ff', '#c9d0ea', '#9aa3d2', '#5d6699', '#2e3462'], top=25, half=12)
    ringm = cv.rect(8, 23, 24, 26)
    rcol = cv.fill(STEEL[2])
    rcol[ringm & (cv.PY < 24)] = hexc(STEEL[1])
    cv.obj(ringm, rcol, STEEL[4])
    cv.stamp(15, 26, ['ss', 'ss'], {'s': GOLD[2]})
    cv.px(15, 26, GOLD[0])
    # Head: round, with ears.
    for side in (-1, 1):
        ear = cv.poly([(16 + side * 3, 8), (16 + side * 8.5, 3), (16 + side * 8.5, 11)])
        ecol = cv.fill(fur[2])
        inner = cv.poly([(16 + side * 5, 8), (16 + side * 7.6, 5), (16 + side * 7.6, 9.5)])
        ecol[inner] = hexc('#ff8fb3')
        cv.obj(ear, ecol, fur[4])
    hm, u, v = cv.ell(16, 14, 8.2, 7.2)
    col = cv.fill(fur[1])
    cv.tones(col, hm, sphere(u, v), fur[:4], dither=False)
    # Stripes on the forehead and cheeks.
    for x, y in ((14, 7), (16, 7), (18, 7), (14, 8), (18, 8), (16, 8), (9, 13), (10, 13), (22, 13), (21, 13),
                 (9, 15), (22, 15)):
        col[y, x] = hexc(fur[3])
    # White muzzle.
    muzzle, _, _ = cv.ell(16, 17.5, 4.2, 2.8)
    col[muzzle] = hexc('#fff3e6')
    col[muzzle & (cv.PX > 17.5)] = hexc('#e8d8cc')
    cv.obj(hm, col, fur[4])
    for ex in (11, 18):
        cv.stamp(ex, 11, ['kkk', 'gkg', 'gkg'], {'k': '#11132e', 'g': '#45e3a6'})
        cv.glint(ex, 12, '#e4fff4')
    cv.px(15, 16, '#ff6b7a')
    cv.px(16, 16, '#ff6b7a')
    cv.px(15, 17, '#9c2238')
    cv.px(16, 18, '#9c2238')
    cv.px(14, 18, '#9c2238')
    # Whiskers.
    for x, y in ((6, 16), (7, 16), (6, 18), (7, 17), (24, 16), (25, 16), (24, 17), (25, 18)):
        cv.glint(x, y, '#f3f5ff')
    cv.finish()
    # The bubble helmet: a glass ring and its shine over everything.
    rim = cv.ring(16, 13.5, 12.4, 13.4) & (cv.PY < 24)
    for y, x in zip(*np.nonzero(rim)):
        cv.glint(int(x), int(y), '#8fcaf5' if (x + y) % 2 else '#bfe3ff')
    for x, y in ((7, 8), (8, 6), (9, 5), (10, 4), (8, 7)):
        cv.glint(x, y, '#ffffff')
    cv.glint(23, 4, '#e6f6ff')
    return cv
