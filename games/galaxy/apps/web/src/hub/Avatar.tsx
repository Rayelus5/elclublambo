// A pixel avatar drawn from the username until players can pick one: a mirrored 5×5 pattern in one accent colour,
// stable for a name (FNV-1a), so the same operator always looks the same.
const INKS = ['var(--color-solar)', 'var(--color-nova)', 'var(--color-terminal)', 'var(--color-ice)', 'var(--color-uv)'];

function fnv(text: string): number {
  let h = 2166136261;
  for (const c of text) {
    h ^= c.codePointAt(0)!;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function Avatar({ name }: { name: string }) {
  const h = fnv(name);
  const cells: { x: number; y: number }[] = [];
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      if ((h >>> (y * 3 + x)) & 1) {
        cells.push({ x, y });
        if (x < 2) cells.push({ x: 4 - x, y });
      }
    }
  }
  return (
    <svg className="avatar" viewBox="-1 -1 7 7" aria-hidden="true" shapeRendering="crispEdges">
      {cells.map((c) => (
        <rect key={`${c.x}-${c.y}`} x={c.x} y={c.y} width="1" height="1" fill={INKS[(h >>> 16) % INKS.length]} />
      ))}
    </svg>
  );
}
