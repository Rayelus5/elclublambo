import { type CSSProperties, type ReactNode, useEffect, useState } from 'react';
import { AbsoluteFill, continueRender, delayRender, Easing, interpolate, OffthreadVideo, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { BRAILLE_BRAND, C, DISPLAY, SANS } from './theme';

// The trailer's building blocks: the game's fonts, a recorded clip with a camera move, the two-line captions in the
// game's lettering, flashes, the vignette, and the logo.

/** Loads the game's fonts before any frame is rendered. */
export function Fonts() {
  const [handle] = useState(() => delayRender('fonts'));
  useEffect(() => {
    const faces = [
      new FontFace('Bungee', `url(${staticFile('fonts/bungee-latin.woff2')})`),
      new FontFace('Fredoka', `url(${staticFile('fonts/fredoka-latin.woff2')})`, { weight: '300 700' }),
    ];
    Promise.all(faces.map((f) => f.load()))
      .then((loaded) => loaded.forEach((f) => (document.fonts as unknown as { add(face: FontFace): void }).add(f)))
      .finally(() => continueRender(handle));
  }, [handle]);
  return null;
}

/** A recorded clip from `start` seconds, at `rate`, with a camera move: zoom and pan (percent) from → to. */
export function Clip({ name, start = 0, rate = 1, zoom = [1, 1], pan = [0, 0, 0, 0], punch = false, dim = 0 }: { name: string; start?: number; rate?: number; zoom?: [number, number]; pan?: [number, number, number, number]; punch?: boolean; dim?: number }) {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();
  const k = interpolate(frame, [0, durationInFrames], [0, 1], { extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) });
  let scale = zoom[0] + (zoom[1] - zoom[0]) * k;
  // A beat punch: the cut lands a little closer and settles.
  if (punch) scale *= 1 + 0.06 * Math.exp(-frame / 6);
  const x = pan[0] + (pan[2] - pan[0]) * k;
  const y = pan[1] + (pan[3] - pan[1]) * k;
  return (
    <AbsoluteFill style={{ overflow: 'hidden', background: C.void }}>
      <AbsoluteFill style={{ transform: `translate(${x}%, ${y}%) scale(${scale})`, transformOrigin: '50% 50%' }}>
        <OffthreadVideo src={staticFile(`footage/${name}.mp4`)} startFrom={Math.round(start * fps)} playbackRate={rate} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </AbsoluteFill>
      {dim > 0 ? <AbsoluteFill style={{ background: `rgba(5, 6, 26, ${dim})` }} /> : null}
    </AbsoluteFill>
  );
}

const OUTLINE = (o: string, w: number) =>
  [`${w}px 0 ${o}`, `-${w}px 0 ${o}`, `0 ${w}px ${o}`, `0 -${w}px ${o}`, `${w * 0.7}px ${w * 0.7}px ${o}`, `-${w * 0.7}px ${w * 0.7}px ${o}`, `${w * 0.7}px -${w * 0.7}px ${o}`, `-${w * 0.7}px -${w * 0.7}px ${o}`].join(', ');

/**
 * The captions, as in the owner's presentation video but animated: two lines in the game's display face, the first
 * white and the second Solar, outlined like the logo; each line slams in on its beat and both leave together.
 */
export function Caption({ top, bottom, at = 'low', size = 118, hold, side = 'center' }: { top: string; bottom?: string; at?: 'low' | 'mid' | 'high'; size?: number; hold?: number; side?: 'center' | 'left' }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const end = hold ?? durationInFrames;
  const line = (delay: number) => {
    const s = spring({ frame: frame - delay, fps, config: { damping: 13, stiffness: 190, mass: 0.7 } });
    const out = interpolate(frame, [end - 9, end], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    return { opacity: Math.min(1, s * 1.6) * out, transform: `translateY(${(1 - s) * 46}px) scale(${1.32 - 0.32 * s})` } as CSSProperties;
  };
  const y = at === 'low' ? { bottom: '11%' } : at === 'high' ? { top: '12%' } : { top: '50%', transform: 'translateY(-50%)' };
  const text: CSSProperties = { fontFamily: DISPLAY, lineHeight: 0.95, letterSpacing: '0.01em', textShadow: `${OUTLINE(C.outline, 6)}, 0 14px 0 rgba(8, 9, 30, .9), 0 24px 50px rgba(0,0,0,.6)` };
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <AbsoluteFill style={{ background: side === 'left' ? 'linear-gradient(90deg, rgba(5,6,26,.6), transparent 55%)' : at === 'low' ? 'linear-gradient(180deg, transparent 55%, rgba(5,6,26,.55))' : 'radial-gradient(70% 40% at 50% 50%, rgba(5,6,26,.45), transparent 75%)', opacity: interpolate(frame, [0, 8, end - 9, end], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }} />
      <div style={{ position: 'absolute', left: side === 'left' ? '5%' : 0, right: side === 'left' ? '48%' : 0, textAlign: side, ...y }}>
        <div style={{ ...text, fontSize: size, color: C.ink, ...line(0) }}>{top}</div>
        {bottom ? <div style={{ ...text, fontSize: size * 0.92, color: C.solar, marginTop: size * 0.06, ...line(5) }}>{bottom}</div> : null}
      </div>
    </AbsoluteFill>
  );
}

/** One big word on a downbeat (the climax). */
export function Slam({ word, color = C.ink, size = 210 }: { word: string; color?: string; size?: number }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 11, stiffness: 240, mass: 0.6 } });
  const out = interpolate(frame, [durationInFrames - 6, durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
      <div style={{ fontFamily: DISPLAY, fontSize: size, color, lineHeight: 1, opacity: Math.min(1, s * 2) * out, transform: `scale(${1.8 - 0.8 * s}) rotate(${(1 - s) * -4}deg)`, textShadow: `${OUTLINE(C.outline, 9)}, 0 20px 0 rgba(8,9,30,.9), 0 30px 70px rgba(0,0,0,.7)` }}>{word}</div>
    </AbsoluteFill>
  );
}

/** A white (or tinted) flash that fades over `frames`. */
export function Flash({ frames = 14, color = '#ffffff', peak = 0.85 }: { frames?: number; color?: string; peak?: number }) {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [0, frames], [peak, 0], { extrapolateRight: 'clamp', easing: Easing.out(Easing.quad) });
  return <AbsoluteFill style={{ background: color, opacity: o, pointerEvents: 'none', mixBlendMode: 'screen' }} />;
}

export function Vignette() {
  return <AbsoluteFill style={{ pointerEvents: 'none', background: 'radial-gradient(120% 100% at 50% 50%, transparent 60%, rgba(0,0,0,.55))' }} />;
}

/** A field of stars drifting slowly (behind the logo). */
export function Stars({ seed = 7, count = 180 }: { seed?: number; count?: number }) {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const stars = Array.from({ length: count }, () => ({ x: rnd(), y: rnd(), z: 0.3 + rnd() * 0.7, tw: rnd() * 6.28 }));
  return (
    <AbsoluteFill style={{ background: `radial-gradient(70% 60% at 50% 45%, #1a1650, ${C.void} 75%)` }}>
      {stars.map((st, i) => {
        const x = ((st.x * width - frame * st.z * 0.6) % width + width) % width;
        const size = st.z > 0.85 ? 4 : st.z > 0.6 ? 3 : 2;
        return <div key={i} style={{ position: 'absolute', left: x, top: st.y * height, width: size, height: size, background: st.z > 0.85 ? C.ice : '#c9d0ea', opacity: 0.35 + 0.65 * st.z * (0.75 + 0.25 * Math.sin(frame / 14 + st.tw)) }} />;
      })}
    </AbsoluteFill>
  );
}

/** The game's logo: GALAXY in white, SURVIVOR in Solar, outlined; the braille line; the «Beta Abierta» tag. */
export function Logo({ scale = 1, braille = 1, tag = 1, children }: { scale?: number; braille?: number; tag?: number; children?: ReactNode }) {
  const big: CSSProperties = { fontFamily: DISPLAY, fontSize: 190 * scale, lineHeight: 0.88, textShadow: `${OUTLINE(C.outline, 10 * scale)}, 0 ${18 * scale}px 0 #0c0d2b, 0 ${30 * scale}px ${60 * scale}px rgba(0,0,0,.55)` };
  return (
    <div style={{ position: 'relative', display: 'inline-block', textAlign: 'left' }}>
      <div style={{ ...big, color: C.ink }}>GALAXY</div>
      <div style={{ ...big, color: C.solar }}>SURVIVOR</div>
      <div style={{ marginTop: 22 * scale, marginLeft: 8 * scale, fontSize: 46 * scale, letterSpacing: '0.12em', color: C.ice, opacity: braille, textShadow: '0 0 18px rgba(150,205,255,.7)', fontFamily: "'Segoe UI Symbol', 'Noto Sans Symbols 2', sans-serif" }}>{BRAILLE_BRAND}</div>
      <div style={{ position: 'absolute', left: 860 * scale, top: -6 * scale, transform: `rotate(-6deg) scale(${tag})`, transformOrigin: '20% 50%', opacity: Math.min(1, tag), whiteSpace: 'nowrap', fontFamily: SANS, fontWeight: 700, fontSize: 44 * scale, background: C.nova, color: '#fff', padding: `${10 * scale}px ${28 * scale}px`, borderRadius: 22 * scale, boxShadow: `0 ${10 * scale}px 0 ${C.novaLip}` }}>Beta Abierta</div>
      {children}
    </div>
  );
}
