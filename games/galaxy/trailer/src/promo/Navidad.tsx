import type { ReactNode } from 'react';
import { AbsoluteFill } from 'remotion';
import { Logo } from '../parts';
import { C, DISPLAY, SANS } from '../theme';
import { Cta, display, Fine, Frame, Glow, Icon, PROBES, type Probe, sans, Shot, Signals, Skin, Snow, Sticker } from './kit';

// «Torneo Navideño» promo stills (1–31 Dec 2026, the game's own tournament with in-game prizes): a simple, festive pair
// (the eight Navidad probes stacked as a Christmas tree, the dates, «Gana el Pack Navidad»), a full pair with the prize
// podium, the places that earn señales and the rules, and the two pictures the tournament page takes (an 8:3 banner
// with no text, the title sits beside it in the game, and a 16:9 prize picture). Everything said lives in NAV, once.

export const NAV = {
  title: ['Torneo', 'Navideño'],
  dates: 'Del 1 al 31 de diciembre',
  hook: 'Gana el Pack Navidad',
  sub: 'Las 8 skins navideñas, animadas',
  podium: [
    { place: '1.º', what: 'Pack Navidad completo', skins: 8, signals: 30 },
    { place: '2.º', what: 'Elige 3 skins del pack', skins: 3, signals: 25 },
    { place: '3.º', what: 'Elige 1 skin del pack', skins: 1, signals: 20 },
  ],
  places: [
    { label: 'Puestos 4 al 10', signals: 15 },
    { label: 'Puestos 11 al 100', signals: 10 },
  ],
  rules: ['Gana quien más puntos sume con todas sus partidas', 'Cuentan las partidas desde que te apuntas', 'Solo o en grupo, todo suma', 'Desde el nivel 5. Apúntate en Torneos'],
  fine: 'Del 1 de diciembre a las 00:00 al 31 de diciembre a las 23:59, hora peninsular. Si ya tienes alguna skin del Pack Navidad, recibes 10 señales por cada una que no se pueda dar. Comprobamos las partidas antes de entregar los premios y los recoges en la página del torneo.',
};

const RED = '#ff5a6e';
const RED_LIP = '#9c2238';
const GREEN_GLOW = 'rgba(69,227,166,.34)';
const RED_GLOW = 'rgba(255,90,110,.32)';

/** The festive backdrop: a dim real capture, red and green glows, and pixel snow. */
function Night({ w, h, shot = 'coop', dim = 0.7, x = 50, glows, snow = 1, band = 240 }: { w: number; h: number; shot?: string; dim?: number; x?: number; glows: { x: number; y: number; r: number; c: string }[]; snow?: number; band?: number }) {
  return (
    <>
      <Shot name={shot} dim={dim} zoom={1.15} x={x} style={{ inset: 0 }} />
      {glows.map((g, i) => (
        <Glow key={i} x={g.x} y={g.y} r={g.r} color={g.c} />
      ))}
      <Snow width={w} height={h} count={Math.round(((w * h) / 9000) * snow)} seed={w + h} />
      {/* Where the small print sits, the snow fades under a dark band so every word reads. */}
      {snow < 1 ? <AbsoluteFill style={{ background: `linear-gradient(0deg, rgba(5,6,26,.94) 0, rgba(5,6,26,.75) ${((band * 0.55) / h) * 100}%, transparent ${(band / h) * 100}%)` }} /> : null}
    </>
  );
}

/** The eight Navidad probes stacked as a tree (1, 3, 4) under a Solar star. */
function Tree({ cx, top, scale, gap }: { cx: number; top: number; scale: number; gap: number }) {
  const side = 24 * scale;
  const rows: Probe[][] = [['sentinel'], ['spark', 'prism', 'comet'], ['lumen', 'bastion', 'anchor', 'echo']];
  const star = side * 0.62;
  return (
    <div style={{ position: 'absolute', left: cx - (4 * side + 3 * gap) / 2, top, width: 4 * side + 3 * gap }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: gap * 0.2 }}>
        <div style={{ filter: 'drop-shadow(0 0 24px rgba(255,201,74,.8))' }}>
          <Icon name="star" size={star} color={C.solar} />
        </div>
      </div>
      {rows.map((row, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'center', gap, marginTop: i === 0 ? 0 : gap * 0.35 }}>
          {row.map((p) => (
            <Skin key={p} probe={p} line="navidad" scale={scale} frame={(i * 3 + p.length) % 8} style={{ filter: 'drop-shadow(0 10px 0 rgba(5,6,26,.55))' }} />
          ))}
        </div>
      ))}
    </div>
  );
}

function Title({ size, align = 'left' }: { size: number; align?: 'left' | 'center' }) {
  return (
    <div style={{ textAlign: align }}>
      <div style={display(size)}>{NAV.title[0]}</div>
      <div style={{ ...display(size, RED), marginTop: size * 0.04 }}>{NAV.title[1]}</div>
    </div>
  );
}

const hookSticker = (size: number, tilt = -4) => <Sticker text={NAV.hook} size={size} tilt={tilt} bg={RED} ink="#ffffff" lip={RED_LIP} glow="rgba(255,90,110,.5)" />;

// ——— Simple ——————————————————————————————————————————————————————————————————————————

export function NavidadH() {
  return (
    <Frame>
      <Night w={1920} h={1080} glows={[{ x: 1480, y: 560, r: 560, c: GREEN_GLOW }, { x: 300, y: 1000, r: 520, c: RED_GLOW }]} />
      <AbsoluteFill style={{ background: 'linear-gradient(90deg, rgba(5,6,26,.9) 0%, rgba(5,6,26,.6) 46%, rgba(5,6,26,0) 75%)' }} />
      <Tree cx={1450} top={140} scale={7} gap={18} />
      <div style={{ position: 'absolute', left: 120, top: 92 }}>
        <Logo scale={0.4} braille={0} />
      </div>
      <div style={{ position: 'absolute', left: 120, top: 330 }}>
        <Title size={132} />
      </div>
      <div style={{ position: 'absolute', left: 120, top: 640 }}>
        <div style={sans(46, C.ice, 700)}>{NAV.dates}</div>
      </div>
      <div style={{ position: 'absolute', left: 124, top: 730 }}>{hookSticker(52)}</div>
      <div style={{ position: 'absolute', left: 120, top: 856 }}>
        <div style={sans(32, C.ink, 600)}>{NAV.sub}</div>
      </div>
      <div style={{ position: 'absolute', left: 120, top: 940 }}>
        <Cta size={32} />
      </div>
    </Frame>
  );
}

export function NavidadV() {
  return (
    <Frame>
      <Night w={1080} h={1920} x={40} glows={[{ x: 540, y: 1080, r: 600, c: GREEN_GLOW }, { x: 120, y: 1700, r: 420, c: RED_GLOW }, { x: 1000, y: 420, r: 380, c: RED_GLOW }]} />
      <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(5,6,26,.85) 0%, rgba(5,6,26,.35) 40%, rgba(5,6,26,.4) 65%, rgba(5,6,26,.92) 100%)' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 252, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <Logo scale={0.32} braille={0} />
        <div style={{ marginTop: 40 }}>
          <Title size={124} align="center" />
        </div>
      </div>
      <Tree cx={540} top={700} scale={7} gap={20} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 1384, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 26 }}>
        <div style={sans(46, C.ice, 700)}>{NAV.dates}</div>
        {hookSticker(54, -3)}
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 1592, display: 'flex', justifyContent: 'center' }}>
        <Cta size={34} />
      </div>
    </Frame>
  );
}

// ——— Premios ———————————————————————————————————————————————————————————————————————

const PLACE = [
  { face: 'linear-gradient(180deg, #ffe08a, #ffc94a 60%, #f0a92c)', lip: '#a8701a', ink: '#2a1a00', glow: 'rgba(255,201,74,.55)' },
  { face: 'linear-gradient(180deg, #f4f7ff, #c9d3ee 60%, #a9b5d6)', lip: '#5d6a8c', ink: '#141a33', glow: 'rgba(191,227,255,.35)' },
  { face: 'linear-gradient(180deg, #ffc9a0, #e8975e 60%, #c77440)', lip: '#7a3f1c', ink: '#2a1206', glow: 'rgba(232,151,94,.35)' },
];

/** The skins a podium place takes: all eight in two rows, or the ones to choose with a «?» mark on each. */
function PrizeSkins({ count, scale }: { count: number; scale: number }) {
  const side = 24 * scale;
  const picks: Probe[] = count === 8 ? [...PROBES] : count === 3 ? ['spark', 'lumen', 'comet'] : ['echo'];
  const cell = (p: Probe) => (
    <div key={p} style={{ position: 'relative', width: side, height: side, borderRadius: side * 0.22, background: 'rgba(11,12,36,.82)', boxShadow: 'inset 0 0 0 2px rgba(255,255,255,.18)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Skin probe={p} line="navidad" scale={scale - (scale > 3 ? 1 : 0)} />
      {count < 8 ? (
        <div style={{ position: 'absolute', right: -side * 0.12, top: -side * 0.12, width: side * 0.42, height: side * 0.42, borderRadius: '50%', background: RED, color: '#fff', fontFamily: DISPLAY, fontSize: side * 0.28, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 3px 0 ${RED_LIP}` }}>?</div>
      ) : null}
    </div>
  );
  if (count === 8)
    return (
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(4, ${side}px)`, gap: 8 }}>
        {picks.map(cell)}
      </div>
    );
  return <div style={{ display: 'flex', gap: 12 }}>{picks.map(cell)}</div>;
}

/** One podium block: the place on top, the skins, what it is and the señales. */
function Block({ i, w, h, scale, size }: { i: number; w: number; h: number; scale: number; size: number }) {
  const p = NAV.podium[i]!;
  const c = PLACE[i]!;
  return (
    <div style={{ width: w, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end' }}>
      <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: size * 1.5, lineHeight: 1, color: C.ink, marginBottom: size * 0.4, textShadow: '0 3px 0 rgba(8,9,30,.9), 0 0 14px rgba(5,6,26,.8)' }}>{p.place}</div>
      <div style={{ width: '100%', height: h, borderRadius: size * 0.7, background: c.face, boxShadow: `0 ${size * 0.4}px 0 ${c.lip}, 0 0 ${size * 2.4}px ${c.glow}, inset 0 ${size * 0.15}px 0 rgba(255,255,255,.6)`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', paddingTop: size * 0.9, gap: size * 0.7 }}>
        <PrizeSkins count={p.skins} scale={scale} />
        <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: size, lineHeight: 1.12, color: c.ink, textAlign: 'center', padding: `0 ${size * 0.5}px` }}>{p.what}</div>
        <Signals amount={p.signals} size={size * 1.25} color={c.ink} iconColor={c.ink} flat plus />
      </div>
    </div>
  );
}

function Podium({ widths, heights, scales, size, gap }: { widths: [number, number, number]; heights: [number, number, number]; scales: [number, number, number]; size: number; gap: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap }}>
      {[1, 0, 2].map((i) => (
        <Block key={i} i={i} w={widths[i]!} h={heights[i]!} scale={scales[i]!} size={size} />
      ))}
    </div>
  );
}

function Places({ size, gap, column = false }: { size: number; gap: number; column?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: column ? 'column' : 'row', gap }}>
      {NAV.places.map((p) => (
        <div key={p.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: size * 1.2, padding: `${size * 0.5}px ${size * 0.9}px`, borderRadius: size * 0.8, background: 'rgba(24,26,61,.9)', boxShadow: `0 ${size * 0.25}px 0 rgba(11,12,36,.95), inset 0 0 0 3px rgba(69,227,166,.4)` }}>
          <span style={sans(size, C.ink, 700)}>{p.label}</span>
          <Signals amount={p.signals} size={size * 1.15} />
        </div>
      ))}
    </div>
  );
}

function Rules({ size, gap }: { size: number; gap: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap }}>
      {NAV.rules.map((r) => (
        <div key={r} style={{ display: 'flex', alignItems: 'center', gap: size * 0.6, ...sans(size) }}>
          <span style={{ width: size * 0.42, height: size * 0.42, flex: 'none', background: C.terminal, boxShadow: `0 ${size * 0.1}px 0 #0b7352` }} />
          {r}
        </div>
      ))}
    </div>
  );
}

function Header({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

export function NavidadPremiosH() {
  return (
    <Frame>
      <Night w={1920} h={1080} shot="horde" dim={0.86} snow={0.45} glows={[{ x: 1320, y: 640, r: 620, c: GREEN_GLOW }, { x: 200, y: 200, r: 420, c: RED_GLOW }]} />
      <Header>
        <div style={{ position: 'absolute', left: 100, top: 56, display: 'flex', alignItems: 'center', gap: 44 }}>
          <Logo scale={0.27} braille={0} tag={0} />
          <div>
            <div style={{ display: 'flex', gap: 26 }}>
              <span style={display(82)}>{NAV.title[0]}</span>
              <span style={display(82, RED)}>{NAV.title[1]}</span>
            </div>
            <div style={{ ...sans(36, C.ice, 700), marginTop: 12 }}>{NAV.dates}</div>
          </div>
        </div>
      </Header>
      <div style={{ position: 'absolute', left: 100, top: 300, width: 600 }}>
        <Rules size={30} gap={18} />
        <div style={{ marginTop: 44 }}>
          <Places size={30} gap={18} column />
        </div>
      </div>
      <div style={{ position: 'absolute', right: 100, bottom: 160 }}>
        <Podium widths={[420, 330, 300]} heights={[450, 375, 315]} scales={[4, 4, 5]} size={25} gap={18} />
      </div>
      <div style={{ position: 'absolute', right: 100, bottom: 50 }}>
        <Cta size={30} />
      </div>
      <div style={{ position: 'absolute', left: 100, bottom: 40, width: 1000 }}>
        <Fine size={18}>{NAV.fine}</Fine>
      </div>
    </Frame>
  );
}

export function NavidadPremiosV() {
  return (
    <Frame>
      <Night w={1080} h={1920} shot="horde" dim={0.86} x={35} snow={0.45} band={440} glows={[{ x: 540, y: 900, r: 620, c: GREEN_GLOW }, { x: 1000, y: 300, r: 380, c: RED_GLOW }]} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 250, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        <Logo scale={0.24} braille={0} tag={0} />
        <div style={{ display: 'flex', gap: 22, marginTop: 24 }}>
          <span style={display(78)}>{NAV.title[0]}</span>
          <span style={display(78, RED)}>{NAV.title[1]}</span>
        </div>
        <div style={{ ...sans(36, C.ice, 700), marginTop: 12 }}>{NAV.dates}</div>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 540, display: 'flex', justifyContent: 'center' }}>
        <Podium widths={[350, 330, 320]} heights={[410, 340, 290]} scales={[3, 4, 5]} size={23} gap={12} />
      </div>
      <div style={{ position: 'absolute', left: 60, right: 60, top: 1170, display: 'flex', justifyContent: 'center' }}>
        <Places size={27} gap={14} />
      </div>
      <div style={{ position: 'absolute', left: 80, right: 60, top: 1290 }}>
        <Rules size={30} gap={14} />
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 1515, display: 'flex', justifyContent: 'center' }}>
        <Cta size={30} />
      </div>
      <div style={{ position: 'absolute', left: 70, right: 70, top: 1600 }}>
        <Fine size={18} align="center">
          {NAV.fine}
        </Fine>
      </div>
    </Frame>
  );
}

// ——— Pictures for the tournament page ——————————————————————————————————————————————

/** 8:3 banner (1600×600): art only, on the right; the game darkens the left and sets the title there. */
export function NavidadBanner() {
  return (
    <Frame>
      <Night w={1600} h={600} dim={0.7} glows={[{ x: 1180, y: 330, r: 420, c: GREEN_GLOW }, { x: 700, y: 560, r: 360, c: RED_GLOW }]} />
      <Tree cx={1180} top={40} scale={5} gap={14} />
    </Frame>
  );
}

/** 16:9 prize picture (1600×900) for the tournament page: the podium and the places, no call to play. */
export function NavidadDetalles() {
  return (
    <Frame>
      <Night w={1600} h={900} shot="horde" dim={0.86} snow={0.45} glows={[{ x: 800, y: 520, r: 600, c: GREEN_GLOW }, { x: 120, y: 120, r: 320, c: RED_GLOW }]} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 44, display: 'flex', justifyContent: 'center', gap: 22 }}>
        <span style={display(60)}>Premios del</span>
        <span style={display(60, RED)}>{NAV.title.join(' ')}</span>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 170, display: 'flex', justifyContent: 'center' }}>
        <Podium widths={[420, 330, 300]} heights={[390, 325, 275]} scales={[4, 4, 5]} size={23} gap={18} />
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 742, display: 'flex', justifyContent: 'center' }}>
        <Places size={26} gap={18} />
      </div>
      <div style={{ position: 'absolute', left: 120, right: 120, bottom: 22, textAlign: 'center' }}>
        <Fine size={16} align="center">
          Si ya tienes alguna skin del Pack Navidad, recibes 10 señales por cada una que no se pueda dar
        </Fine>
      </div>
    </Frame>
  );
}
