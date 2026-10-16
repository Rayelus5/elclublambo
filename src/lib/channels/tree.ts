export type ChannelKind = "category" | "forum" | "text";

export type ChannelRow = {
  id: string;
  parentId: string | null;
  kind: ChannelKind;
  name: string;
  topic: string | null;
  position: number;
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
