import { CELL, CELLET, HIVE, MITE, PROBE_LUMEN, RAY, SHELL, SPITTER } from './fauna';
import { ICONS } from './icons';
import { ITEMS } from './items';
import { rasterize, type SpriteDef } from './types';

export { pixels, rasterize, type SpriteDef } from './types';

/** Every sprite of the arena by id (the content's `sprite` and `icon` ids, plus loot, shots and decoration). */
export const SPRITES: Record<string, SpriteDef> = {
  'probe-lumen': PROBE_LUMEN,
  mite: MITE,
  cell: CELL,
  cellet: CELLET,
  ray: RAY,
  spitter: SPITTER,
  shell: SHELL,
  hive: HIVE,
  ...ITEMS,
  ...ICONS,
};

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
