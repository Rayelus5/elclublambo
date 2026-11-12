import { CELL, CELLET, HIVE, MITE, RAY, SHELL, SPITTER } from './fauna';
import { BOSSES } from './bosses';
import { DECOR } from './decor';
import { FAUNA2 } from './fauna2';
import { FORMS } from './forms';
import { ICONS } from './icons';
import { ITEMS } from './items';
import { PROBE_ART, PROBE_NOZZLE } from './probe-art';
import { PROPS } from './props';
import { turnedProbe } from './rotate';
import { rasterize, type SpriteDef } from './types';

export { pixels, rasterize, type SpriteDef } from './types';

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
  ...PROPS,
  ...ICONS,
};

// Each probe also faces up, down and the two right-hand diagonals (open beta); left is the mirror (rotate.ts).
for (const [id, def] of Object.entries(PROBE_ART)) Object.assign(SPRITES, turnedProbe(id, def));

/** How far behind its centre a probe drawing's nozzle is (px), where its thruster's flame comes out. */
export function probeNozzle(sprite: string): number {
  return PROBE_NOZZLE[sprite] ?? 8;
}

const urls = new Map<string, string>();

/** A sprite as an image URL for the HUD and the hangar (`data:` URLs are allowed by the CSP). */
export function spriteDataUrl(id: string, scale = 3, frame = 0): string {
  const key = `${id}:${scale}:${frame}`;
  let url = urls.get(key);
  if (!url) {
    const def = SPRITES[id];
    url = def ? rasterize(def, frame, scale).toDataURL('image/png') : '';
    urls.set(key, url);
  }
  return url;
}
