export type ChannelKind = "category" | "forum" | "text";

export type ChannelRow = {
  id: string;
  parentId: string | null;
  kind: ChannelKind;
  name: string;
  topic: string | null;
  position: number;
};

/** Fila completa (con ajustes) para el editor de ajustes. Serializable. */
export type ChannelDetailRow = ChannelRow & {
  slowmodeSeconds: number;
  ticketsEnabled: boolean;
  alphaEnabled: boolean;
};

export type TreeNode = ChannelRow & { children: TreeNode[] };

/** Árbol ordenado por `position`. Descarta huérfanos (su padre no es visible) y todo lo que cuelga de ellos. */
export function buildTree(rows: ChannelRow[]): TreeNode[] {
  const byParent = new Map<string | null, ChannelRow[]>();
  for (const row of rows) {
    const list = byParent.get(row.parentId) ?? [];
    list.push(row);
    byParent.set(row.parentId, list);
  }
  const build = (parentId: string | null, seen: Set<string>): TreeNode[] =>
    (byParent.get(parentId) ?? [])
      .toSorted((a, b) => a.position - b.position)
      .filter((row) => !seen.has(row.id))
      .map((row) => ({ ...row, children: build(row.id, new Set(seen).add(row.id)) }));
  return build(null, new Set());
}

const UNITS: [seconds: number, singular: string, plural: string][] = [
  [604800, "semana", "semanas"],
  [86400, "día", "días"],
  [3600, "h", "h"],
  [60, "min", "min"],
];

/** "5 s", "1 min", "1 h", "1 día", "1 semana"; si no es múltiplo exacto de una unidad, segundos. */
export function formatSlowmode(seconds: number): string {
  for (const [size, singular, plural] of UNITS) {
    if (seconds >= size && seconds % size === 0) {
      const n = seconds / size;
      return `${n} ${n === 1 ? singular : plural}`;
    }
  }
  return `${seconds} s`;
}

/** Camino raíz → nodo (ambos incluidos). Vacío si el id no está en el árbol. */
export function findPath(tree: TreeNode[], id: string): TreeNode[] {
  for (const node of tree) {
    if (node.id === id) return [node];
    const below = findPath(node.children, id);
    if (below.length > 0) return [node, ...below];
  }
  return [];
}

export const MAX_DEPTH = 6;
export const SLOWMODE_MIN = 5;
export const SLOWMODE_MAX = 604800;

export type ParentOption = { id: string | null; label: string };

function height(node: TreeNode): number {
  return 1 + Math.max(0, ...node.children.map(height));
}

function findNode(tree: TreeNode[], id: string): TreeNode | null {
  for (const n of tree) {
    if (n.id === id) return n;
    const below = findNode(n.children, id);
    if (below) return below;
  }
  return null;
}

/**
 * Padres válidos para mover `node`: una categoría solo a la raíz; foros y textos solo bajo categorías o foros
 * (nunca la raíz, ni textos), fuera de su propio subárbol y sin pasar de 6 niveles.
 */
export function validParents(tree: TreeNode[], node: { id: string; kind: ChannelKind }): ParentOption[] {
  if (node.kind === "category") return [{ id: null, label: "Raíz" }];
  const self = findNode(tree, node.id);
  const h = self ? height(self) : 1;
  const out: ParentOption[] = [];
  const walk = (nodes: TreeNode[], path: string[]) => {
    for (const n of nodes) {
      if (n.id === node.id || n.kind === "text") continue;
      const here = [...path, n.name];
      // n está a profundidad `here.length`; el nodo movido quedaría en length+1 y su subárbol llegaría a length+h.
      if (here.length + h <= MAX_DEPTH) out.push({ id: n.id, label: here.join(" / ") });
      walk(n.children, here);
    }
  };
  walk(tree, []);
  return out;
}
