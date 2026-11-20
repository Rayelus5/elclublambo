import { parseConfig } from '@galaxy/shared';
import { expect, test } from 'vitest';
import { closest, layoutBoard, layoutCore, MIN_SPACING } from '../src/lab/board/layout';

// Where the Laboratorio's whiteboard puts each node (shop and lab plan, F3): the same tree always lands the same way,
// no two nodes crowd each other (even a tree of about a hundred and ten), a node's `at` hint wins, every node is
// further out than the one it hangs from, and the season's core sits clear to the right of the permanent one.

const cfg = parseConfig('lab', {});
const BRANCHES = ['probe', 'relics', 'station', 'extraction'] as const;

/** A big tree: per branch, a root, four children, three grandchildren each and a great-grandchild each (116 nodes). */
function bigTree() {
  const nodes: { id: string; branch: (typeof BRANCHES)[number]; requires: string | null; at: null }[] = [];
  for (const b of BRANCHES) {
    nodes.push({ id: `${b}-r`, branch: b, requires: null, at: null });
    for (let i = 0; i < 4; i++) {
      nodes.push({ id: `${b}-${i}`, branch: b, requires: `${b}-r`, at: null });
      for (let j = 0; j < 3; j++) {
        nodes.push({ id: `${b}-${i}-${j}`, branch: b, requires: `${b}-${i}`, at: null });
        nodes.push({ id: `${b}-${i}-${j}-x`, branch: b, requires: `${b}-${i}-${j}`, at: null });
      }
    }
  }
  return nodes;
}

test('el árbol de hoy queda siempre igual, sin nodos apiñados y con cada nodo más afuera que el suyo', () => {
  const a = layoutCore(cfg.nodes, { x: 0, y: 0 }, BRANCHES);
  const b = layoutCore(cfg.nodes, { x: 0, y: 0 }, BRANCHES);
  expect(a).toEqual(b);
  expect(a.nodes).toHaveLength(16);
  expect(closest(a.nodes)).toBeGreaterThanOrEqual(MIN_SPACING);
  const at = new Map(a.nodes.map((n) => [n.id, n]));
  for (const n of a.nodes) {
    if (!n.parent) continue;
    const p = at.get(n.parent)!;
    expect(Math.hypot(n.x, n.y)).toBeGreaterThan(Math.hypot(p.x, p.y));
  }
  // The first branch (Sonda) is top left; nothing hangs straight below the core (its title is there).
  expect(at.get('hull')!.y).toBeLessThan(0);
  expect(at.get('hull')!.x).toBeLessThan(0);
  expect(a.nodes.filter((n) => Math.abs(n.x) < 40 && n.y > 0)).toEqual([]);
});

test('un árbol de unos 110 nodos abre sus anillos hasta que ninguno se apiña', () => {
  const tree = bigTree();
  expect(tree.length).toBeGreaterThan(100);
  const l = layoutCore(tree, { x: 0, y: 0 }, BRANCHES);
  expect(l.nodes).toHaveLength(tree.length);
  expect(closest(l.nodes)).toBeGreaterThanOrEqual(MIN_SPACING);
});

test('la pista de colocación de un nodo manda', () => {
  const nodes = cfg.nodes.map((n) => (n.id === 'magnet' ? { ...n, at: { angle: 0, ring: 2 } } : n));
  const l = layoutCore(nodes, { x: 0, y: 0 }, BRANCHES);
  const magnet = l.nodes.find((n) => n.id === 'magnet')!;
  expect(magnet.y).toBe(0);
  expect(magnet.x).toBeGreaterThan(0);
});

test('el núcleo de temporada queda a la derecha, sin tocar el permanente', () => {
  const season = [
    { id: 's-a', branch: 'probe' as const, requires: null, at: null },
    { id: 's-b', branch: 'probe' as const, requires: 's-a', at: null },
    { id: 's-c', branch: 'extraction' as const, requires: null, at: null },
  ];
  const board = layoutBoard(cfg.nodes, season);
  expect(board.season).not.toBeNull();
  const s = board.season!;
  expect(s.center.x - s.radius).toBeGreaterThan(board.permanent.center.x + board.permanent.radius);
  expect(layoutBoard(cfg.nodes, []).season).toBeNull();
  expect(layoutBoard(cfg.nodes, null).season).toBeNull();
});
