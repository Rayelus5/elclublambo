import { AbsoluteFill } from 'remotion';
import { Logo } from '../parts';
import { C } from '../theme';
import { Cta, display, Frame, Glow, Icon, Panel, PROBE_NAME, PROBES, ProfileFrame, sans, Shot, Skin, TierEmblem, TIERS } from './kit';

// Season 2 promo stills (23 Nov – 31 Dec 2026): a simple, loud one («Temporada 2», the date, one Aurora probe as the
// hero over a real Núcleo capture) and the rewards one (the season route's 8 Aurora skins, the frames, the titles and
// the closing tiers). The game calls the free pass «Ruta de temporada» and the shop «Tienda de temporada»; the copy
// uses those names. Everything said lives in T2, once.

export const T2 = {
  title: 'Temporada',
  number: '2',
  dates: 'Ya disponible hasta el 31 de diciembre',
  hook: 'Sube de tramo y llévate las 8 skins Aurora',
  rewardsTitle: 'Recompensas de la Temporada 2',
  rewardsHook: 'Juega, suma puntos de temporada y sube de tramo',
  route: 'Ruta de temporada',
  routeSub: 'Gratis al sumar puntos',
  frames: 'Marcos',
  titles: 'Títulos',
  titleList: ['Leyenda de la Temporada 2', 'Podio de la Temporada 2', 'Forjado en estática', 'Transcriptor'],
  closing: 'Premios de cierre',
  closingSub: 'Monedas, polvo y señales según tu tramo',
  frameTags: [
    { id: 'nebula', name: 'Nebulosa', where: 'Ruta' },
    { id: 'abyss', name: 'Abismo', where: 'Tienda' },
    { id: 'crown', name: 'Corona', where: 'Podio' },
  ] as const,
};

const AURORA_GLOW_A = 'rgba(69,227,166,.38)';
const AURORA_GLOW_B = 'rgba(114,89,238,.45)';

/** The hero: Cometa aurora big, three more of the line flying around it, over an aurora glow. */
function Squadron({ cx, cy, big, small }: { cx: number; cy: number; big: number; small: number }) {
  const side = 24 * big;
  const s = 24 * small;
  return (
    <>
      <Glow x={cx - side * 0.25} y={cy} r={side * 1.05} color={AURORA_GLOW_B} />
      <Glow x={cx + side * 0.3} y={cy - side * 0.2} r={side * 0.8} color={AURORA_GLOW_A} />
      <Skin probe="spark" line="aurora" scale={small} style={{ position: 'absolute', left: cx - side * 0.95, top: cy - side * 0.95, opacity: 0.95 }} />
      <Skin probe="prism" line="aurora" scale={small} style={{ position: 'absolute', left: cx + side * 0.45, top: cy + side * 0.38 }} />
      <Skin probe="lumen" line="aurora" scale={Math.max(2, small - 2)} style={{ position: 'absolute', left: cx + side * 0.55, top: cy - side * 0.92, opacity: 0.9 }} />
      <Skin probe="comet" line="aurora" scale={big} style={{ position: 'absolute', left: cx - side / 2, top: cy - side / 2, filter: 'drop-shadow(0 18px 0 rgba(5,6,26,.55))' }} />
      <div style={{ position: 'absolute', left: cx - s / 2, top: cy + side * 0.62, width: s, height: 0 }} />
    </>
  );
}

export function T2H() {
  return (
    <Frame>
      <Shot name="t2-boss" dim={0.52} zoom={1.12} x={60} y={60} style={{ inset: 0 }} />
      <AbsoluteFill style={{ background: 'linear-gradient(90deg, rgba(5,6,26,.95) 0%, rgba(5,6,26,.84) 42%, rgba(5,6,26,.3) 100%), linear-gradient(180deg, rgba(5,6,26,.85) 0%, transparent 24%)' }} />
      <Squadron cx={1440} cy={560} big={17} small={8} />
      <div style={{ position: 'absolute', left: 120, top: 96 }}>
        <Logo scale={0.4} braille={0} />
      </div>
      <div style={{ position: 'absolute', left: 120, top: 330 }}>
        <div style={display(132)}>{T2.title}</div>
      </div>
      <div style={{ position: 'absolute', left: 112, top: 462, display: 'flex', alignItems: 'center', gap: 52 }}>
        <div style={{ ...display(380, C.solar), lineHeight: 0.86 }}>{T2.number}</div>
        <div style={{ width: 660 }}>
          <div style={{ ...sans(40, C.ice, 700), lineHeight: 1.15 }}>Ya disponible</div>
          <div style={{ ...sans(50, C.ink, 700), lineHeight: 1.15 }}>hasta el 31 de diciembre</div>
          <div style={{ ...sans(32, C.ink, 600), marginTop: 22, lineHeight: 1.25 }}>
            Sube de tramo y llévate
            <br />
            las 8 skins Aurora
          </div>
        </div>
      </div>
      <div style={{ position: 'absolute', left: 120, top: 900 }}>
        <Cta size={34} />
      </div>
    </Frame>
  );
}

export function T2V() {
  return (
    <Frame>
      <Shot name="t2-boss" dim={0.6} zoom={1.1} x={62} style={{ inset: 0 }} />
      <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(5,6,26,.97) 0%, rgba(5,6,26,.7) 26%, rgba(5,6,26,.45) 58%, rgba(5,6,26,.96) 100%)' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 255, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        <Logo scale={0.34} braille={0} />
        <div style={{ ...display(122), marginTop: 48 }}>{T2.title}</div>
        <div style={{ ...display(330, C.solar), lineHeight: 0.9 }}>{T2.number}</div>
      </div>
      <Squadron cx={540} cy={1095} big={14} small={7} />
      <div style={{ position: 'absolute', left: 60, right: 60, top: 1430, textAlign: 'center' }}>
        <div style={sans(42, C.ice, 700)}>{T2.dates}</div>
        <div style={{ ...sans(34), marginTop: 12 }}>{T2.hook}</div>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 1566, display: 'flex', justifyContent: 'center' }}>
        <Cta size={34} />
      </div>
    </Frame>
  );
}

// ——— Recompensas ——————————————————————————————————————————————————————————————————

function Label({ text, sub, size }: { text: string; sub?: string; size: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: size * 0.6, flexWrap: 'wrap' }}>
      <span style={display(size, C.solar)}>{text}</span>
      {sub ? <span style={sans(size * 0.62, C.ice, 600)}>{sub}</span> : null}
    </div>
  );
}

/** One Aurora skin on its card: the probe big, its name under it. */
function SkinCard({ probe, scale, w }: { probe: (typeof PROBES)[number]; scale: number; w: number }) {
  return (
    <div style={{ width: w, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      <div style={{ width: w, height: 24 * scale + 28, borderRadius: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'radial-gradient(circle at 50% 55%, rgba(114,89,238,.42), rgba(69,227,166,.12) 55%, rgba(11,12,36,.6) 80%)', boxShadow: 'inset 0 0 0 3px rgba(179,157,255,.35), 0 6px 0 rgba(11,12,36,.95)' }}>
        <Skin probe={probe} line="aurora" scale={scale} />
      </div>
      <div style={sans(Math.round(scale * 4.4), C.ink, 700)}>{PROBE_NAME[probe]}</div>
    </div>
  );
}

function TitleChip({ text, size }: { text: string; size: number }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.45, padding: `${size * 0.35}px ${size * 0.7}px`, borderRadius: size, background: 'rgba(11,12,36,.75)', boxShadow: `inset 0 0 0 2px rgba(255,201,74,.45)` }}>
      <Icon name="scroll" size={size * 1.1} color={C.solar} />
      <span style={sans(size, C.ink, 600)}>{text}</span>
    </div>
  );
}

function FramesRow({ scale, gap }: { scale: number; gap: number }) {
  return (
    <div style={{ display: 'flex', gap, justifyContent: 'center' }}>
      {T2.frameTags.map((f) => (
        <div key={f.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <ProfileFrame id={f.id} scale={scale} />
          <div style={sans(scale * 7, C.ink, 700)}>{f.name}</div>
          <div style={{ ...sans(scale * 5.4, C.ice, 600), marginTop: -6 }}>{f.where}</div>
        </div>
      ))}
    </div>
  );
}

function TiersRow({ scale, gap }: { scale: number; gap: number }) {
  return (
    <div style={{ display: 'flex', gap, justifyContent: 'center' }}>
      {TIERS.map((t) => (
        <div key={t.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <TierEmblem id={t.id} scale={scale} />
          <div style={sans(scale * 8, C.ink, 700)}>{t.name}</div>
        </div>
      ))}
    </div>
  );
}

export function RecompensasH() {
  return (
    <Frame>
      <Shot name="horde" dim={0.84} zoom={1.15} style={{ inset: 0 }} />
      <AbsoluteFill style={{ background: 'radial-gradient(80% 60% at 50% 20%, rgba(114,89,238,.28), transparent 70%)' }} />
      <div style={{ position: 'absolute', left: 80, top: 50, display: 'flex', alignItems: 'center', gap: 48 }}>
        <Logo scale={0.27} braille={0} tag={0} />
        <div>
          <div style={display(70)}>{T2.rewardsTitle}</div>
          <div style={{ ...sans(32, C.ice, 600), marginTop: 12 }}>{T2.rewardsHook}</div>
        </div>
      </div>
      <Panel style={{ left: 80, right: 80, top: 230, height: 350, padding: '26px 38px' }}>
        <Label text={T2.route} sub={`${T2.routeSub}: las 8 skins Aurora, animadas`} size={40} />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 22 }}>
          {PROBES.map((p) => (
            <SkinCard key={p} probe={p} scale={7} w={194} />
          ))}
        </div>
      </Panel>
      <Panel style={{ left: 80, width: 560, top: 620, height: 330, padding: '24px 30px' }}>
        <Label text={T2.frames} size={36} />
        <div style={{ marginTop: 22 }}>
          <FramesRow scale={3} gap={34} />
        </div>
      </Panel>
      <Panel style={{ left: 680, width: 560, top: 620, height: 330, padding: '24px 30px' }}>
        <Label text={T2.titles} size={36} />
        <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 11 }}>
          {T2.titleList.map((t) => (
            <TitleChip key={t} text={t} size={24} />
          ))}
        </div>
      </Panel>
      <Panel style={{ left: 1280, width: 560, top: 620, height: 330, padding: '24px 30px' }}>
        <Label text={T2.closing} size={36} />
        <div style={{ ...sans(25, C.ice, 600), marginTop: 10 }}>{T2.closingSub}</div>
        <div style={{ marginTop: 22 }}>
          <TiersRow scale={3} gap={14} />
        </div>
      </Panel>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 982, display: 'flex', justifyContent: 'center' }}>
        <Cta size={30} />
      </div>
    </Frame>
  );
}

export function RecompensasV() {
  return (
    <Frame>
      <Shot name="horde" dim={0.87} zoom={1.2} x={35} style={{ inset: 0 }} />
      <AbsoluteFill style={{ background: 'radial-gradient(90% 50% at 50% 25%, rgba(114,89,238,.28), transparent 70%)' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 250, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        <Logo scale={0.24} braille={0} tag={0} />
        <div style={{ ...display(70), marginTop: 24, width: 960 }}>{T2.rewardsTitle}</div>
      </div>
      <Panel style={{ left: 50, right: 50, top: 548, height: 650, padding: '24px 30px' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={display(44, C.solar)}>{T2.route}</div>
          <div style={{ ...sans(28, C.ice, 600), marginTop: 8 }}>{`${T2.routeSub}: las 8 skins Aurora, animadas`}</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 214px)', justifyContent: 'space-between', rowGap: 18, marginTop: 22 }}>
          {PROBES.map((p) => (
            <SkinCard key={p} probe={p} scale={7} w={214} />
          ))}
        </div>
      </Panel>
      <Panel style={{ left: 50, right: 50, top: 1226, height: 362, padding: '22px 30px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div>
            <div style={display(36, C.solar)}>{T2.frames}</div>
            <div style={{ marginTop: 16 }}>
              <FramesRow scale={3} gap={22} />
            </div>
          </div>
          <div style={{ width: 400 }}>
            <div style={display(36, C.solar)}>{T2.closing}</div>
            <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', rowGap: 10 }}>
              {TIERS.map((t) => (
                <div key={t.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <TierEmblem id={t.id} scale={2} />
                  <div style={sans(20, C.ink, 700)}>{t.name}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
          {[T2.titleList[0]!, T2.titleList[1]!].map((t) => (
            <TitleChip key={t} text={t} size={22} />
          ))}
        </div>
      </Panel>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 1614, display: 'flex', justifyContent: 'center' }}>
        <Cta size={30} />
      </div>
    </Frame>
  );
}
