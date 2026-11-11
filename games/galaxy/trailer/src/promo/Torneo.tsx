import type { CSSProperties, ReactNode } from 'react';
import { AbsoluteFill, Img, staticFile } from 'remotion';
import { Fonts, Logo } from '../parts';
import { C, DISPLAY, PLAY_URL, SANS } from '../theme';

// Weekend tournament promo (13–22 Nov 2026): an external contest the owner runs on the in-game General ranking, reset
// on Friday. Four stills, two art directions in two formats: «Podio» (the prizes as a podium over a solo horde) and
// «Solo o en grupo» (the screen split between a solo run and a group run). Everything said lives in TORNEO, once.

export const TORNEO = {
  title: 'Torneo de fin de semana',
  dates: 'Del viernes 13 al domingo 22 de noviembre',
  rules: ['Todos empiezan de cero el viernes', 'Gana quien más puntos de temporada consiga', 'Solo o en grupo: todo suma', 'Mínimo 5.000 puntos para optar a premio'],
  prizes: [
    { place: '1.º', amount: '10 €' },
    { place: '2.º', amount: '5 €' },
    { place: '3.º', amount: '3 €' },
  ],
  cta: `Juega gratis en ${PLAY_URL}`,
  fine: 'Del viernes a las 00:00 al domingo a las 23:59, hora peninsular. Pago por Bizum al terminar; avisamos a los ganadores por el buzón del juego. No cuentan las partidas marcadas como sospechosas.',
};

const OUTLINE = (o: string, w: number) =>
  [`${w}px 0 ${o}`, `-${w}px 0 ${o}`, `0 ${w}px ${o}`, `0 -${w}px ${o}`, `${w * 0.7}px ${w * 0.7}px ${o}`, `-${w * 0.7}px ${w * 0.7}px ${o}`, `${w * 0.7}px -${w * 0.7}px ${o}`, `-${w * 0.7}px -${w * 0.7}px ${o}`].join(', ');
const display = (size: number, color: string = C.ink): CSSProperties => ({
  fontFamily: DISPLAY,
  fontSize: size,
  lineHeight: 0.95,
  color,
  textShadow: `${OUTLINE(C.outline, Math.max(3, size / 22))}, 0 ${size / 10}px 0 rgba(8,9,30,.9)`,
});

/** Podium colours: the game's Solar for the first, then silver and bronze, each with its lip. */
const PLACE = [
  { face: 'linear-gradient(180deg, #ffe08a, #ffc94a 60%, #f0a92c)', lip: '#a8701a', ink: '#2a1a00', glow: 'rgba(255,201,74,.55)' },
  { face: 'linear-gradient(180deg, #f4f7ff, #c9d3ee 60%, #a9b5d6)', lip: '#5d6a8c', ink: '#141a33', glow: 'rgba(191,227,255,.35)' },
  { face: 'linear-gradient(180deg, #ffc9a0, #e8975e 60%, #c77440)', lip: '#7a3f1c', ink: '#2a1206', glow: 'rgba(232,151,94,.35)' },
];

/** A real capture of the game, dimmed so the type reads over it. */
function Shot({ name, dim = 0.55, zoom = 1.12, x = 50, y = 50, style }: { name: string; dim?: number; zoom?: number; x?: number; y?: number; style?: CSSProperties }) {
  return (
    <div style={{ position: 'absolute', overflow: 'hidden', background: C.void, ...style }}>
      <Img src={staticFile(`promo/${name}.png`)} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: `${x}% ${y}%`, transform: `scale(${zoom})` }} />
      <div style={{ position: 'absolute', inset: 0, background: `rgba(5, 6, 26, ${dim})` }} />
    </div>
  );
}

function Rules({ size, gap }: { size: number; gap: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap }}>
      {TORNEO.rules.map((r) => (
        <div key={r} style={{ display: 'flex', alignItems: 'center', gap: size * 0.6, fontFamily: SANS, fontWeight: 600, fontSize: size, color: C.ink, textShadow: '0 2px 0 rgba(5,6,26,.9), 0 0 18px rgba(5,6,26,.8)' }}>
          <span style={{ width: size * 0.42, height: size * 0.42, flex: 'none', background: C.solar, boxShadow: `0 ${size * 0.1}px 0 #a8701a` }} />
          {r}
        </div>
      ))}
    </div>
  );
}

function Cta({ size }: { size: number }) {
  return (
    <div style={{ display: 'inline-block', fontFamily: SANS, fontWeight: 700, fontSize: size, color: '#2a1a00', background: C.solar, padding: `${size * 0.45}px ${size * 1.1}px`, borderRadius: size * 1.2, boxShadow: `0 ${size * 0.3}px 0 #a8701a, 0 ${size * 0.5}px ${size * 1.4}px rgba(255,201,74,.35)` }}>
      {TORNEO.cta}
    </div>
  );
}

function Fine({ size, width }: { size: number; width?: number }) {
  return <div style={{ fontFamily: SANS, fontWeight: 500, fontSize: size, lineHeight: 1.35, color: '#aab2dc', maxWidth: width, textShadow: '0 1px 0 rgba(5,6,26,.9)' }}>{TORNEO.fine}</div>;
}

/** One podium block: its place, its prize and its colour; `h` is how tall the block stands. */
function Step({ i, w, h, size }: { i: number; w: number; h: number; size: number }) {
  const p = TORNEO.prizes[i]!;
  const c = PLACE[i]!;
  return (
    <div style={{ width: w, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end' }}>
      <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: size * 0.46, lineHeight: 1, color: C.ink, marginBottom: size * 0.2, textShadow: `${OUTLINE(C.outline, 3)}, 0 3px 0 rgba(8,9,30,.9)` }}>{p.place}</div>
      <div
        style={{
          width: '100%',
          height: h,
          borderRadius: size * 0.22,
          background: c.face,
          boxShadow: `0 ${size * 0.16}px 0 ${c.lip}, 0 0 ${size * 0.9}px ${c.glow}, inset 0 ${size * 0.06}px 0 rgba(255,255,255,.6)`,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          paddingTop: size * 0.22,
        }}
      >
        <div style={{ fontFamily: DISPLAY, fontSize: size, lineHeight: 1, color: c.ink, letterSpacing: '-0.02em' }}>{p.amount}</div>
      </div>
    </div>
  );
}

/** The podium: second, first, third, the first the tallest. */
function Podium({ w, size, heights }: { w: number; size: number; heights: [number, number, number] }) {
  const order = [1, 0, 2];
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: w * 0.08 }}>
      {order.map((i) => (
        <Step key={i} i={i} w={w} h={heights[i]!} size={i === 0 ? size : size * 0.82} />
      ))}
    </div>
  );
}

/** The three prizes in a row (the split direction). */
function PrizeRow({ size, gap }: { size: number; gap: number }) {
  return (
    <div style={{ display: 'flex', gap }}>
      {TORNEO.prizes.map((p, i) => (
        <div key={p.place} style={{ display: 'flex', alignItems: 'baseline', gap: size * 0.25, padding: `${size * 0.22}px ${size * 0.45}px`, borderRadius: size * 0.3, background: PLACE[i]!.face, boxShadow: `0 ${size * 0.12}px 0 ${PLACE[i]!.lip}, 0 0 ${size * 0.7}px ${PLACE[i]!.glow}` }}>
          <span style={{ fontFamily: SANS, fontWeight: 700, fontSize: size * 0.42, color: PLACE[i]!.ink }}>{p.place}</span>
          <span style={{ fontFamily: DISPLAY, fontSize: size, lineHeight: 1, color: PLACE[i]!.ink }}>{p.amount}</span>
        </div>
      ))}
    </div>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <AbsoluteFill style={{ background: C.void, overflow: 'hidden' }}>
      <Fonts />
      {children}
    </AbsoluteFill>
  );
}

/** «Todo suma», set on the split line between the two halves. */
function Badge({ size, tilt }: { size: number; tilt: number }) {
  return (
    <div style={{ display: 'inline-block', transform: `rotate(${tilt}deg)`, fontFamily: DISPLAY, fontSize: size, lineHeight: 1, color: '#2a1a00', background: C.solar, padding: `${size * 0.32}px ${size * 0.6}px`, borderRadius: size * 0.3, boxShadow: `0 ${size * 0.14}px 0 #a8701a, 0 0 ${size * 1.2}px rgba(255,201,74,.45)` }}>
      Todo suma
    </div>
  );
}

/** A label on one half of the split: SOLO or EN GRUPO. */
function Tag({ text, size, color }: { text: string; size: number; color: string }) {
  return <div style={{ display: 'inline-block', ...display(size, color) }}>{text}</div>;
}

// ——— «Podio» ———————————————————————————————————————————————————————————————————

export function PodioH() {
  return (
    <Frame>
      <Shot name="horde" dim={0.5} zoom={1.15} style={{ inset: 0 }} />
      <AbsoluteFill style={{ background: 'linear-gradient(90deg, rgba(5,6,26,.92) 0%, rgba(5,6,26,.78) 46%, rgba(5,6,26,.35) 100%)' }} />
      <div style={{ position: 'absolute', left: 120, top: 92, width: 900 }}>
        <Logo scale={0.4} braille={0} />
        <div style={{ ...display(96), marginTop: 46, width: 860 }}>{TORNEO.title}</div>
        <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: 40, color: C.ice, marginTop: 26, textShadow: '0 2px 0 rgba(5,6,26,.9)' }}>{TORNEO.dates}</div>
        <div style={{ marginTop: 44 }}>
          <Rules size={34} gap={18} />
        </div>
      </div>
      <div style={{ position: 'absolute', right: 120, bottom: 230 }}>
        <Podium w={220} size={92} heights={[330, 250, 196]} />
      </div>
      <div style={{ position: 'absolute', right: 120, bottom: 112 }}>
        <Cta size={32} />
      </div>
      <div style={{ position: 'absolute', left: 120, right: 120, bottom: 44 }}>
        <Fine size={19} />
      </div>
    </Frame>
  );
}

export function PodioV() {
  return (
    <Frame>
      <Shot name="horde" dim={0.55} zoom={1.15} x={30} style={{ inset: 0 }} />
      <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(5,6,26,.9) 0%, rgba(5,6,26,.55) 38%, rgba(5,6,26,.6) 62%, rgba(5,6,26,.95) 100%)' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 250, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        <Logo scale={0.34} braille={0} />
        <div style={{ ...display(98), marginTop: 54, width: 900 }}>{TORNEO.title}</div>
        <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: 40, color: C.ice, marginTop: 28, textShadow: '0 2px 0 rgba(5,6,26,.9)' }}>{TORNEO.dates}</div>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 820, display: 'flex', justifyContent: 'center' }}>
        <Podium w={250} size={100} heights={[330, 250, 196]} />
      </div>
      <div style={{ position: 'absolute', left: 110, right: 90, top: 1290 }}>
        <Rules size={36} gap={16} />
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 1600, display: 'flex', justifyContent: 'center' }}>
        <Cta size={34} />
      </div>
      <div style={{ position: 'absolute', left: 90, right: 90, bottom: 96, textAlign: 'center' }}>
        <Fine size={20} />
      </div>
    </Frame>
  );
}

// ——— «Solo o en grupo» ——————————————————————————————————————————————————————————

export function GrupoH() {
  // The split lives in a band between the header and the information, so the line never crosses any text.
  const [top, bottom] = [220, 720];
  return (
    <Frame>
      <Shot name="boss" dim={0.38} zoom={1.25} x={62} y={40} style={{ left: 0, right: 0, top, height: bottom - top, clipPath: 'polygon(0 0, 54.2% 0, 45.8% 100%, 0 100%)' }} />
      <Shot name="coop" dim={0.38} zoom={1.2} x={45} y={55} style={{ left: 0, right: 0, top, height: bottom - top, clipPath: 'polygon(54.2% 0, 100% 0, 100% 100%, 45.8% 100%)' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: top - 2, height: 40, background: `linear-gradient(180deg, ${C.void}, transparent)` }} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: bottom - 60, height: 62, background: `linear-gradient(0deg, ${C.void}, transparent)` }} />
      <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}>
        <line x1={1040} y1={top} x2={880} y2={bottom} stroke={C.solar} strokeWidth={8} />
      </svg>
      <div style={{ position: 'absolute', left: 120, top: 62, display: 'flex', alignItems: 'center', gap: 52 }}>
        <Logo scale={0.3} braille={0} tag={0} />
        <div style={display(80)}>{TORNEO.title}</div>
      </div>
      <div style={{ position: 'absolute', left: 120, top: 400 }}>
        <Tag text="Solo" size={120} color={C.ink} />
      </div>
      <div style={{ position: 'absolute', right: 120, top: 400, textAlign: 'right' }}>
        <Tag text="En grupo" size={120} color={C.ink} />
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 422, display: 'flex', justifyContent: 'center' }}>
        <Badge size={52} tilt={-4} />
      </div>
      <div style={{ position: 'absolute', left: 120, top: 776 }}>
        <PrizeRow size={78} gap={26} />
      </div>
      <div style={{ position: 'absolute', right: 120, top: 770, textAlign: 'right', fontFamily: SANS, fontWeight: 700, fontSize: 36, lineHeight: 1.32, color: C.ice }}>
        {TORNEO.dates}
        <br />
        <span style={{ color: C.ink, fontWeight: 600, fontSize: 32 }}>Gana quien más puntos de temporada consiga</span>
        <br />
        <span style={{ color: C.ink, fontWeight: 600, fontSize: 32 }}>Mínimo 5.000 puntos para optar a premio</span>
      </div>
      <div style={{ position: 'absolute', left: 120, top: 920 }}>
        <Cta size={30} />
      </div>
      <div style={{ position: 'absolute', left: 120, right: 120, bottom: 34 }}>
        <Fine size={19} />
      </div>
    </Frame>
  );
}

export function GrupoV() {
  // Stories put their own buttons on the top and bottom ~250 px: everything that matters sits between.
  const [top, bottom] = [585, 1255];
  const cut = 0.56;
  return (
    <Frame>
      <Shot name="boss" dim={0.36} zoom={1.3} x={64} y={38} style={{ left: 0, right: 0, top, height: bottom - top, clipPath: `polygon(0 0, 100% 0, 100% ${cut * 100 - 9}%, 0 ${cut * 100 + 9}%)` }} />
      <Shot name="coop" dim={0.36} zoom={1.25} x={48} y={58} style={{ left: 0, right: 0, top, height: bottom - top, clipPath: `polygon(0 ${cut * 100 + 9}%, 100% ${cut * 100 - 9}%, 100% 100%, 0 100%)` }} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: top - 2, height: 50, background: `linear-gradient(180deg, ${C.void}, transparent)` }} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: bottom - 70, height: 72, background: `linear-gradient(0deg, ${C.void}, transparent)` }} />
      <svg width={1080} height={1920} style={{ position: 'absolute', inset: 0 }}>
        <line x1={0} y1={top + (bottom - top) * (cut + 0.09)} x2={1080} y2={top + (bottom - top) * (cut - 0.09)} stroke={C.solar} strokeWidth={8} />
      </svg>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 250, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        <Logo scale={0.3} braille={0} />
        <div style={{ ...display(84), marginTop: 26, width: 940 }}>{TORNEO.title}</div>
      </div>
      <div style={{ position: 'absolute', left: 80, top: top + 70 }}>
        <Tag text="Solo" size={124} color={C.ink} />
      </div>
      <div style={{ position: 'absolute', right: 80, top: bottom - 190, textAlign: 'right' }}>
        <Tag text="En grupo" size={108} color={C.ink} />
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: top + (bottom - top) * cut - 40, display: 'flex', justifyContent: 'center' }}>
        <Badge size={58} tilt={-7} />
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 1295, display: 'flex', justifyContent: 'center' }}>
        <PrizeRow size={72} gap={18} />
      </div>
      <div style={{ position: 'absolute', left: 70, right: 70, top: 1432, textAlign: 'center', fontFamily: SANS, fontWeight: 700, fontSize: 36, lineHeight: 1.3, color: C.ice }}>
        {TORNEO.dates}
        <br />
        <span style={{ color: C.ink, fontWeight: 600, fontSize: 32 }}>Gana quien más puntos de temporada consiga</span>
        <br />
        <span style={{ color: C.ink, fontWeight: 600, fontSize: 32 }}>Mínimo 5.000 puntos para optar a premio</span>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 1610, display: 'flex', justifyContent: 'center' }}>
        <Cta size={32} />
      </div>
      <div style={{ position: 'absolute', left: 90, right: 90, bottom: 96, textAlign: 'center' }}>
        <Fine size={20} />
      </div>
    </Frame>
  );
}
