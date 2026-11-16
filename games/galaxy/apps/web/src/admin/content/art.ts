import { spriteDataUrl } from '../../arena/sprites';

/** A drawing as an image for the editor, or null where it cannot be drawn (an unknown id; no canvas in tests). */
export function artUrl(id: string, scale = 2, frame = 0): string | null {
  try {
    return spriteDataUrl(id, scale, frame) || null;
  } catch {
    return null;
  }
}
