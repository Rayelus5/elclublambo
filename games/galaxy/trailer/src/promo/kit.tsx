import type { CSSProperties, ReactNode } from 'react';
import { AbsoluteFill, Img, staticFile } from 'remotion';
import { Fonts } from '../parts';
import { C, DISPLAY, PLAY_URL, SANS } from '../theme';

// Shared pieces of the promo stills (Season 2 and the Christmas tournament, Nov 2026): the game's outlined lettering,
// real captures dimmed under the type, pixel-art sprites cut from the game's own strips and scaled by whole numbers
// (never smoothed), the Solar call to action, the small print, deterministic snow and the game's line icons.

export const OUTLINE = (o: string, w: number) =>
  [`${w}px 0 ${o}`, `-${w}px 0 ${o}`, `0 ${w}px ${o}`, `0 -${w}px ${o}`, `${w * 0.7}px ${w * 0.7}px ${o}`, `-${w * 0.7}px ${w * 0.7}px ${o}`, `${w * 0.7}px -${w * 0.7}px ${o}`, `-${w * 0.7}px -${w * 0.7}px ${o}`].join(', ');

/** The game's display lettering: Bungee, outlined like the logo, with its lip. */
export const display = (size: number, color: string = C.ink): CSSProperties => ({
  fontFamily: DISPLAY,
  fontSize: size,
  lineHeight: 0.95,
  color,
  textShadow: `${OUTLINE(C.outline, Math.max(3, size / 22))}, 0 ${size / 10}px 0 rgba(8,9,30,.9)`,
});

/** Body lettering over art: Fredoka with a dark lip so it reads on anything. */
export const sans = (size: number, color: string = C.ink, weight = 600): CSSProperties => ({
  fontFamily: SANS,
  fontWeight: weight,
  fontSize: size,
  color,
  textShadow: '0 2px 0 rgba(5,6,26,.9), 0 0 18px rgba(5,6,26,.8)',
});

export function Frame({ children, bg = C.void }: { children: ReactNode; bg?: string }) {
  return (
    <AbsoluteFill style={{ background: bg, overflow: 'hidden' }}>
      <Fonts />
      {children}
    </AbsoluteFill>
  );
}

/** A real capture of the game, dimmed so the type reads over it. */
export function Shot({ name, dim = 0.55, zoom = 1.12, x = 50, y = 50, style }: { name: string; dim?: number; zoom?: number; x?: number; y?: number; style?: CSSProperties }) {
  return (
    <div style={{ position: 'absolute', overflow: 'hidden', background: C.void, ...style }}>
      <Img src={staticFile(`promo/${name}.png`)} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: `${x}% ${y}%`, transform: `scale(${zoom})` }} />
      <div style={{ position: 'absolute', inset: 0, background: `rgba(5, 6, 26, ${dim})` }} />
    </div>
  );
}

/**
 * One cell of a pixel-art strip from the game (`promo/art/<file>.png`, `frames` cells of `cell` px side by side), drawn
 * at a whole `scale` with nearest-neighbour sampling. An <Img> (not a CSS background) so the render waits for it.
 */
export function Sprite({ file, frame = 0, frames, cell, scale, style }: { file: string; frame?: number; frames: number; cell: number; scale: number; style?: CSSProperties }) {
  const side = cell * scale;
  return (
    <div style={{ position: 'relative', width: side, height: side, overflow: 'hidden', flex: 'none', ...style }}>
      <Img
        src={staticFile(`promo/art/${file}.png`)}
        style={{ position: 'absolute', left: -frame * side, top: 0, width: frames * side, height: side, maxWidth: 'none', imageRendering: 'pixelated' }}
      />
    </div>
  );
}

export const PROBES = ['lumen', 'bastion', 'spark', 'sentinel', 'anchor', 'prism', 'comet', 'echo'] as const;
export type Probe = (typeof PROBES)[number];
export const PROBE_NAME: Record<Probe, string> = { lumen: 'Lumen', bastion: 'Bastión', spark: 'Chispa', sentinel: 'Vigía', anchor: 'Áncora', prism: 'Prisma', comet: 'Cometa', echo: 'Eco' };

/** A probe in a skin line: Aurora strips have 6 cells, Navidad 8. */
export function Skin({ probe, line, scale, frame, style }: { probe: Probe; line: 'aurora' | 'navidad'; scale: number; frame?: number; style?: CSSProperties }) {
  return <Sprite file={`${probe}-${line}`} frames={line === 'aurora' ? 6 : 8} frame={frame ?? 2} cell={24} scale={scale} style={style} />;
}

/** A profile frame (48 px, 6 cells) around the default pilot (32 px at 8,8), as the game shows a frame. */
export function ProfileFrame({ id, scale, style }: { id: 'nebula' | 'abyss' | 'crown'; scale: number; style?: CSSProperties }) {
  return (
    <div style={{ position: 'relative', width: 48 * scale, height: 48 * scale, flex: 'none', ...style }}>
      <Sprite file="avatar-crew-pilot" frames={1} cell={32} scale={scale} style={{ position: 'absolute', left: 8 * scale, top: 8 * scale }} />
      <Sprite file={`frame-${id}`} frames={6} frame={1} cell={48} scale={scale} style={{ position: 'absolute', left: 0, top: 0 }} />
    </div>
  );
}

export const TIERS = [
  { id: 'bronze', name: 'Bronce' },
  { id: 'silver', name: 'Plata' },
  { id: 'gold', name: 'Oro' },
  { id: 'platinum', name: 'Platino' },
  { id: 'stellar', name: 'Estelar' },
] as const;

/** A season tier emblem (32 px, 4 cells). */
export function TierEmblem({ id, scale }: { id: (typeof TIERS)[number]['id']; scale: number }) {
  return <Sprite file={`tier-${id}`} frames={4} frame={0} cell={32} scale={scale} />;
}

/** The Solar pill that says where to play. */
export function Cta({ size, text = `Juega gratis en ${PLAY_URL}` }: { size: number; text?: string }) {
  return (
    <div style={{ display: 'inline-block', whiteSpace: 'nowrap', fontFamily: SANS, fontWeight: 700, fontSize: size, color: '#2a1a00', background: C.solar, padding: `${size * 0.45}px ${size * 1.1}px`, borderRadius: size * 1.2, boxShadow: `0 ${size * 0.3}px 0 #a8701a, 0 ${size * 0.5}px ${size * 1.4}px rgba(255,201,74,.35)` }}>
      {text}
    </div>
  );
}

export function Fine({ size, children, width, align }: { size: number; children: ReactNode; width?: number; align?: 'left' | 'center' }) {
  return <div style={{ fontFamily: SANS, fontWeight: 500, fontSize: size, lineHeight: 1.35, color: '#aab2dc', maxWidth: width, textAlign: align, textShadow: '0 1px 0 rgba(5,6,26,.9)' }}>{children}</div>;
}

/** A tilted sticker, like «Beta Cerrada» on the logo. */
export function Sticker({ text, size, tilt = -4, bg = C.solar, ink = '#2a1a00', lip = '#a8701a', glow = 'rgba(255,201,74,.45)' }: { text: string; size: number; tilt?: number; bg?: string; ink?: string; lip?: string; glow?: string }) {
  return (
    <div style={{ display: 'inline-block', whiteSpace: 'nowrap', transform: `rotate(${tilt}deg)`, fontFamily: DISPLAY, fontSize: size, lineHeight: 1, color: ink, background: bg, padding: `${size * 0.32}px ${size * 0.6}px`, borderRadius: size * 0.3, boxShadow: `0 ${size * 0.14}px 0 ${lip}, 0 0 ${size * 1.2}px ${glow}` }}>
      {text}
    </div>
  );
}

/** A rounded panel in the game's style: deep body, lip below, soft outline. */
export function Panel({ children, style, tint = 'rgba(24,26,61,.86)', edge = 'rgba(155,134,255,.28)' }: { children: ReactNode; style?: CSSProperties; tint?: string; edge?: string }) {
  return <div style={{ position: 'absolute', borderRadius: 30, background: tint, boxShadow: `0 10px 0 rgba(11,12,36,.95), inset 0 0 0 3px ${edge}, 0 24px 60px rgba(0,0,0,.45)`, ...style }}>{children}</div>;
}

/** Deterministic pixel snow: square flakes and a few «+» sparkles, like the Navidad skins' own snow. */
export function Snow({ width, height, count = 160, seed = 11, opacity = 1 }: { width: number; height: number; count?: number; seed?: number; opacity?: number }) {
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const flakes = Array.from({ length: count }, () => ({ x: rnd() * width, y: rnd() * height, z: rnd(), plus: rnd() < 0.16 }));
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', opacity }}>
      {flakes.map((f, i) => {
        const px = f.z > 0.85 ? 8 : f.z > 0.55 ? 6 : 4;
        const color = f.z > 0.7 ? '#ffffff' : C.ice;
        const alpha = 0.35 + 0.6 * f.z;
        if (f.plus)
          return (
            <div key={i} style={{ position: 'absolute', left: f.x, top: f.y, width: px * 3, height: px * 3, opacity: alpha }}>
              <div style={{ position: 'absolute', left: px, top: 0, width: px, height: px * 3, background: color }} />
              <div style={{ position: 'absolute', left: 0, top: px, width: px * 3, height: px, background: color }} />
            </div>
          );
        return <div key={i} style={{ position: 'absolute', left: f.x, top: f.y, width: px, height: px, background: color, opacity: alpha }} />;
      })}
    </AbsoluteFill>
  );
}

const ICON: Record<'ticket' | 'shard' | 'scroll' | 'trophy' | 'calendar' | 'star', ReactNode> = {
  star: <path d="M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.6L12 16.5l-5.1 2.7 1-5.6-4.1-4 5.7-.8z" fill="currentColor" />,
  ticket: (
    <>
      <path d="M3 7h18v3.2a2 2 0 000 3.6V17H3v-3.2a2 2 0 000-3.6z" />
      <path d="M14.5 7.5v9" strokeDasharray="1.6 2.2" />
    </>
  ),
  shard: (
    <>
      <path d="M12 2.5l5 6.5-5 12.5-5-12.5z" fill="currentColor" stroke="none" opacity=".25" />
      <path d="M12 2.5l5 6.5-5 12.5-5-12.5zM7 9h10M12 2.5v19" />
    </>
  ),
  scroll: (
    <>
      <path d="M7 4.5h10.5A2.5 2.5 0 0120 7v.5h-3" />
      <path d="M17 7v11.5a2 2 0 01-2 2H6.5A2.5 2.5 0 014 18v-.5h9.5V7A2.5 2.5 0 0016 4.5" />
      <path d="M7 4.5A2.5 2.5 0 004.5 7v8" />
      <path d="M8 9h5M8 12.5h5" />
    </>
  ),
  trophy: (
    <>
      <path d="M8 4h8v5a4 4 0 01-8 0z" />
      <path d="M8 6H5a3 3 0 003 3.5M16 6h3a3 3 0 01-3 3.5" />
      <path d="M12 13v4M8.5 20h7" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
};

/** The game's line icons (apps/web/src/ui/Icon.tsx): 24×24, round strokes. */
export function Icon({ name, size, color }: { name: keyof typeof ICON; size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none', color, filter: 'drop-shadow(0 2px 0 rgba(5,6,26,.9))' }}>
      {ICON[name]}
    </svg>
  );
}

/** «N señales» with the ticket icon in Ice, the game's colour for Señales de galaxia. */
export function Signals({ amount, size, color = C.ink, iconColor = C.ice, flat = false, plus = false }: { amount: number; size: number; color?: string; iconColor?: string; flat?: boolean; plus?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.3, whiteSpace: 'nowrap' }}>
      <Icon name="ticket" size={size * 1.15} color={iconColor} />
      <span style={{ fontFamily: DISPLAY, fontSize: size, lineHeight: 1, color, textShadow: flat ? 'none' : `${OUTLINE(C.outline, Math.max(2, size / 16))}` }}>{plus ? `+${amount}` : amount}</span>
      <span style={{ fontFamily: SANS, fontWeight: 700, fontSize: size * 0.62, color, textShadow: flat ? 'none' : '0 2px 0 rgba(5,6,26,.9)' }}>señales</span>
    </span>
  );
}

/** A soft coloured glow behind a hero sprite. */
export function Glow({ x, y, r, color }: { x: number; y: number; r: number; color: string }) {
  return <div style={{ position: 'absolute', left: x - r, top: y - r, width: r * 2, height: r * 2, borderRadius: '50%', background: `radial-gradient(circle, ${color} 0%, transparent 68%)` }} />;
}
