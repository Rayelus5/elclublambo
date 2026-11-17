import { CELL, CELLET, HIVE, MITE, RAY, SHELL, SPITTER } from './fauna';
import { BOSSES } from './bosses';
import { DECOR } from './decor';
import { EVENT_ART } from './event-art';
import { FAUNA2 } from './fauna2';
import { FORMS } from './forms';
import { ICONS } from './icons';
import { ITEMS } from './items';
import { PROBE_ART, PROBE_NOZZLE, SKIN_ART } from './probe-art';
import { PROPS } from './props';
import { turnedProbe } from './rotate';
import { rasterize, type SpriteDef } from './types';

export { pixels, rasterize, type SpriteDef } from './types';
export { SKIN_ART } from './probe-art';

/** Every sprite of the arena by id (the content's `sprite` and `icon` ids, plus loot, shots and decoration). */
export const SPRITES: Record<string, SpriteDef> = {
  mite: MITE,
  cell: CELL,
  cellet: CELLET,
  ray: RAY,
  spitter: SPITTER,
  shell: SHELL,
  hive: HIVE,
  ...PROBE_ART,
  ...FAUNA2,
  ...BOSSES,
  ...FORMS,
  ...DECOR,
  ...ITEMS,
  ...EVENT_ART,
  ...PROPS,
  ...ICONS,
};

// Each probe also faces up, down and the two right-hand diagonals (open beta); left is the mirror (rotate.ts).
for (const [id, def] of Object.entries(PROBE_ART)) Object.assign(SPRITES, turnedProbe(id, def));

const turnedSkins = new Map<string, Record<string, SpriteDef>>();

/**
 * The skins a run draws (plan «skins», part C), each with its four turned drawings like the probes': only those, so a
 * run without skins never turns or packs the rest. Ids without art (null, a retired skin) are left out.
 */
export function skinSprites(ids: readonly (string | null | undefined)[]): Record<string, SpriteDef> {
  const out: Record<string, SpriteDef> = {};
  for (const id of ids) {
    const def = id ? SKIN_ART[id] : undefined;
    if (!id || !def) continue;
    let turned = turnedSkins.get(id);
    if (!turned) {
      turned = turnedProbe(id, def);
      turnedSkins.set(id, turned);
    }
    Object.assign(out, { [id]: def }, turned);
  }
  return out;
}

/** What a probe is drawn as outside the arena: its skin when it has art (a retired or newer id falls back), or its own. */
export function probeDrawing(skin: string | null | undefined, sprite: string): string {
  return skin && SKIN_ART[skin] ? skin : sprite;
}

/** A skin's own flame, embers and dash afterimages (plan «skins», part C2): Aurora's polar light, Leyenda's gold, and each shop pack's (2026-11-17). */
export interface ProbeFlame {
  flame: number[];
  embers: number[];
  dash: number;
}
const FLAMES: Record<string, ProbeFlame> = {
  aurora: { flame: [0xffffff, 0xd8fff0, 0x7cffc4], embers: [0x45e3a6, 0x3fe0d0, 0xb39dff, 0x7259ee], dash: 0x45e3a6 },
  leyenda: { flame: [0xffffff, 0xfff2b8, 0xffc94a], embers: [0xffc94a, 0xe05cff, 0x8e2bb3, 0xffc94a], dash: 0xffc94a },
  // The shop's complete packs (2026-11-17).
  navidad: { flame: [0xffffff, 0xff7a8a, 0xd8283c], embers: [0xffffff, 0x3cb86c, 0xd8283c, 0xffc94a], dash: 0x3cb86c },
  fuego: { flame: [0xffffff, 0xffd24a, 0xff6a1c], embers: [0xffd24a, 0xff6a1c, 0xe8561c, 0xb0220c], dash: 0xff6a1c },
  agua: { flame: [0xffffff, 0xb4fff0, 0x4fa8ff], embers: [0xe8fffb, 0x7ff0e6, 0x4fa8ff, 0x25b6d6], dash: 0x4fa8ff },
  galaxia: { flame: [0xffffff, 0xff8ad8, 0xb39dff], embers: [0xffffff, 0xff8ad8, 0xd43aa8, 0xbfd0ff], dash: 0xd43aa8 },
  carbono: { flame: [0xffffff, 0xc8f8ff, 0x22d3ff], embers: [0x22d3ff, 0xc8f8ff, 0x8a94a8, 0x22d3ff], dash: 0x22d3ff },
  rubi: { flame: [0xffffff, 0xffd0dc, 0xff5a7a], embers: [0xff6a8a, 0xffe0ea, 0xe01848, 0xff8fb3], dash: 0xe01848 },
};

/** The flame of what a probe is drawn as: a skin's own (Aurora, Leyenda, the shop's packs), or null for the usual one. */
export function probeFlame(drawing: string): ProbeFlame | null {
  const line = drawing.startsWith('skin-') ? drawing.slice(drawing.lastIndexOf('-') + 1) : '';
  return FLAMES[line] ?? null;
}

/** How far behind its centre a probe drawing's nozzle is (px), where its thruster's flame comes out. */
export function probeNozzle(sprite: string): number {
  return PROBE_NOZZLE[sprite] ?? 8;
}

/** A drawing of the arena or a skin by id (undefined: none). */
export function spriteDef(id: string): SpriteDef | undefined {
  return SPRITES[id] ?? SKIN_ART[id];
}

/**
 * A drawing the arena can draw: `id`, or `fallback` when it has no such drawing (the content editor, 2026-11-16, P5).
 * Publishing refuses unknown ids; this keeps a run alive if one slips through anyway.
 */
export function drawableId(id: string, fallback: string, has: (id: string) => boolean = (x) => Object.hasOwn(SPRITES, x)): string {
  return has(id) ? id : fallback;
}

const urls = new Map<string, string>();

/** A sprite as an image URL for the HUD and the hangar (`data:` URLs are allowed by the CSP). */
export function spriteDataUrl(id: string, scale = 3, frame = 0): string {
  const key = `${id}:${scale}:${frame}`;
  let url = urls.get(key);
  if (!url) {
    const def = SPRITES[id] ?? SKIN_ART[id];
    url = def ? rasterize(def, frame, scale).toDataURL('image/png') : '';
    urls.set(key, url);
  }
  return url;
}
