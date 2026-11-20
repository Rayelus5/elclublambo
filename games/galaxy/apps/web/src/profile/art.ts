import { DEFAULT_COSMETICS } from '@galaxy/shared';

// The profile cosmetics' art (Nov plan C2/C3): pixel-art PNGs under ./art, served as files (never inlined). An
// avatar is 32×32 (an animated one, a strip of 4); a frame is 48×48 round a 32×32 window (an animated one, a strip
// of 6). Which pieces are animated comes from the art set (the default catalog), not from the live config.
const AVATARS = import.meta.glob<string>('./art/avatars/*.png', { eager: true, query: '?no-inline', import: 'default' });
const FRAMES = import.meta.glob<string>('./art/frames/*.png', { eager: true, query: '?no-inline', import: 'default' });

const ANIMATED_AVATARS = new Set(DEFAULT_COSMETICS.avatars.filter((a) => a.animated).map((a) => a.id as string));
const ANIMATED_FRAMES = new Set(DEFAULT_COSMETICS.frames.filter((f) => f.animated).map((f) => f.id as string));

export type Art = { url: string; frames: number };

export function avatarArt(id: string): Art | undefined {
  const url = AVATARS[`./art/avatars/${id}.png`];
  return url ? { url, frames: ANIMATED_AVATARS.has(id) ? 4 : 1 } : undefined;
}

export function frameArt(id: string): Art | undefined {
  const url = FRAMES[`./art/frames/${id}.png`];
  return url ? { url, frames: ANIMATED_FRAMES.has(id) ? 6 : 1 } : undefined;
}
