import type { LabNodeView } from '@galaxy/shared';

// Where the Laboratorio's whiteboard puts each node (shop and lab plan, F3; the approved F0 mockup). Pure and
// deterministic: the same tree always lands the same way. Each core is a radial tree: its branches share the circle
// in wedges as wide as their leaves, a node sits in the middle of its wedge and splits it among the nodes it opens, and
// each depth is a ring further out. A node's `at` hint (degrees round its core, ring from it) overrides its place.
// The season's core sits to the right of the permanent one, clear of it.

export interface Point {
  x: number;
  y: number;
}

export interface PlacedNode extends Point {
  id: string;
  /** The node it hangs from (null: from its core). */
  parent: string | null;
  depth: number;
}

export interface CoreLayout {
  center: Point;
  /** How far its outer ring reaches. */
  radius: number;
  nodes: PlacedNode[];
}

export const NODE_RADIUS = 34;
const R0 = 190;
const GAP = 150;
const CORE_MARGIN = 260;

type Tree = Pick<LabNodeView, 'id' | 'branch' | 'requires' | 'at'>;

/** The closest two nodes of a layout (Infinity with fewer than two). */
export function closest(nodes: readonly Point[]): number {
  let best = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) best = Math.min(best, Math.hypot(nodes[i]!.x - nodes[j]!.x, nodes[i]!.y - nodes[j]!.y));
  }
  return best;
}

/** Room between two nodes: their discs, their labels and some air. */
export const MIN_SPACING = NODE_RADIUS * 2 + 40;

/**
 * Lays out one core's tree around `center`, branches in `order` (any other after, in config order). A big tree opens
 * its rings until no two nodes crowd each other (the same steps every time, so it stays deterministic).
 */
export function layoutCore(nodes: readonly Tree[], center: Point, order: readonly string[]): CoreLayout {
  let scale = 1;
  let out = radial(nodes, center, order, scale);
  for (let i = 0; i < 12 && closest(out.nodes) < MIN_SPACING; i++) {
    scale *= 1.15;
    out = radial(nodes, center, order, scale);
  }
  return out;
}

function radial(nodes: readonly Tree[], center: Point, order: readonly string[], scale: number): CoreLayout {
  const ids = new Set(nodes.map((n) => n.id));
  const kids = new Map<string, Tree[]>();
  const roots: Tree[] = [];
  for (const n of nodes) {
    if (n.requires && ids.has(n.requires) && n.requires !== n.id) kids.set(n.requires, [...(kids.get(n.requires) ?? []), n]);
    else roots.push(n);
  }
  const leaves = new Map<string, number>();
  const seen = new Set<string>();
  const count = (n: Tree): number => {
    if (leaves.has(n.id)) return leaves.get(n.id)!;
    if (seen.has(n.id)) return 1;
    seen.add(n.id);
    const c = (kids.get(n.id) ?? []).reduce((a, k) => a + count(k), 0);
    const v = Math.max(1, c);
    leaves.set(n.id, v);
    return v;
  };
  const branches = [...new Set([...order.filter((b) => roots.some((r) => r.branch === b)), ...roots.map((r) => r.branch)])];
  const total = roots.reduce((a, r) => a + count(r), 0) || 1;
  const placed: PlacedNode[] = [];
  const done = new Set<string>();
  let maxDepth = 0;

  const place = (n: Tree, from: number, to: number, depth: number, parent: string | null) => {
    if (done.has(n.id)) return;
    done.add(n.id);
    const angle = n.at ? n.at.angle : (from + to) / 2;
    const ring = n.at ? n.at.ring : depth;
    const r = (R0 + ring * GAP) * scale;
    const rad = (angle * Math.PI) / 180;
    placed.push({ id: n.id, parent, depth, x: Math.round(center.x + Math.cos(rad) * r), y: Math.round(center.y + Math.sin(rad) * r) });
    maxDepth = Math.max(maxDepth, ring);
    const children = kids.get(n.id) ?? [];
    const sum = children.reduce((a, k) => a + count(k), 0) || 1;
    let at = from;
    for (const k of children) {
      const span = ((to - from) * count(k)) / sum;
      place(k, at, at + span, depth + 1, n.id);
      at += span;
    }
  };

  // The first branch centred top left: the branches go diagonally and leave room above and below the core for its title.
  let start = -135 - (180 * (roots.filter((r) => r.branch === branches[0]).reduce((a, r) => a + count(r), 0) || 0)) / total;
  for (const b of branches) {
    for (const root of roots.filter((r) => r.branch === b)) {
      const span = (360 * count(root)) / total;
      place(root, start, start + span, 0, null);
      start += span;
    }
  }
  return { center, radius: (R0 + maxDepth * GAP) * scale + NODE_RADIUS, nodes: placed };
}

/** Both cores: the permanent one at the origin and the season's (when there is one) to its right, clear of it. */
export function layoutBoard(permanent: readonly Tree[], season: readonly Tree[] | null): { permanent: CoreLayout; season: CoreLayout | null } {
  const perm = layoutCore(permanent, { x: 0, y: 0 }, ['probe', 'relics', 'station', 'extraction']);
  if (!season || season.length === 0) return { permanent: perm, season: null };
  // Lay it out once to know its size, then move it beside the permanent one.
  const probe = layoutCore(season, { x: 0, y: 0 }, ['probe', 'relics', 'station', 'extraction']);
  const x = perm.radius + CORE_MARGIN + probe.radius;
  return { permanent: perm, season: layoutCore(season, { x, y: 0 }, ['probe', 'relics', 'station', 'extraction']) };
}

/** The box around some points (with the node's own size). */
export function boundsOf(points: readonly Point[]): { minX: number; minY: number; maxX: number; maxY: number } {
  if (points.length === 0) return { minX: -1, minY: -1, maxX: 1, maxY: 1 };
  return {
    minX: Math.min(...points.map((p) => p.x)) - NODE_RADIUS,
    minY: Math.min(...points.map((p) => p.y)) - NODE_RADIUS,
    maxX: Math.max(...points.map((p) => p.x)) + NODE_RADIUS,
    maxY: Math.max(...points.map((p) => p.y)) + NODE_RADIUS,
  };
}
