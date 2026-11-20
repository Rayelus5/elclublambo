// The Laboratorio whiteboard's camera (shop and lab plan, F3): where the world is (x, y) and how big (k). Pure maths
// here, so the zoom towards the cursor, the fit and the level of detail are tested without a browser; the board keeps
// the camera in a ref and writes it straight to the SVG (no React render per frame).

export interface Cam {
  x: number;
  y: number;
  k: number;
}

export const ZOOM_MIN = 0.3;
export const ZOOM_MAX = 2.5;

const clampK = (k: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, k));

/** Zooms by `f` keeping the world point under (px, py) where it is. */
export function zoomed(cam: Cam, f: number, px: number, py: number): Cam {
  const k = clampK(cam.k * f);
  return { k, x: px - (px - cam.x) * (k / cam.k), y: py - (py - cam.y) * (k / cam.k) };
}

/** The camera that shows a box whole in a viewport (with a margin), its middle in the viewport's. */
export function fitted(box: { minX: number; minY: number; maxX: number; maxY: number }, view: { w: number; h: number }, margin = 80): Cam {
  const bw = Math.max(1, box.maxX - box.minX + margin * 2);
  const bh = Math.max(1, box.maxY - box.minY + margin * 2);
  const k = clampK(Math.min(view.w / bw, view.h / bh));
  return { k, x: view.w / 2 - (k * (box.minX + box.maxX)) / 2, y: view.h / 2 - (k * (box.minY + box.maxY)) / 2 };
}

/** The camera that puts a world point in the middle of the viewport, at the same zoom. */
export function centered(cam: Cam, p: { x: number; y: number }, view: { w: number; h: number }): Cam {
  return { k: cam.k, x: view.w / 2 - p.x * cam.k, y: view.h / 2 - p.y * cam.k };
}

/** How much the board shows: far hides the labels, near shows everything. */
export function lodOf(k: number): 'far' | 'mid' | 'near' {
  return k < 0.45 ? 'far' : k < 0.9 ? 'mid' : 'near';
}

/** Between two cameras, eased out (t from 0 to 1). */
export function between(from: Cam, to: Cam, t: number): Cam {
  const e = 1 - (1 - t) ** 3;
  return { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, k: from.k + (to.k - from.k) * e };
}

/** The node nearest to `from` in a direction (arrow keys), or null. */
export function nearestIn<T extends { id: string; x: number; y: number }>(nodes: readonly T[], from: T, dir: 'up' | 'down' | 'left' | 'right'): T | null {
  let best: T | null = null;
  let score = Infinity;
  for (const n of nodes) {
    if (n.id === from.id) continue;
    const dx = n.x - from.x;
    const dy = n.y - from.y;
    const along = dir === 'right' ? dx : dir === 'left' ? -dx : dir === 'down' ? dy : -dy;
    const across = dir === 'right' || dir === 'left' ? Math.abs(dy) : Math.abs(dx);
    if (along <= 0) continue;
    const s = along + across * 2;
    if (s < score) {
      score = s;
      best = n;
    }
  }
  return best;
}
