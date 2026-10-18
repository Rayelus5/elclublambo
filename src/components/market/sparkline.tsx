// Hand-rolled 7-day sparkline, exposed as an image with a text equivalent from the caller.
const W = 100;
const H = 32;
const PAD = 2;

export function Sparkline({ points, label, className }: { points: number[]; label: string; className?: string }) {
  if (points.length < 2) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    if (p < min) min = p;
    if (p > max) max = p;
  }
  const span = max - min || 1; // flat series: a straight line, no 0/0
  const last = points.length - 1;
  const coords = points
    .map((p, i) => `${((i / last) * W).toFixed(2)},${(H - PAD - ((p - min) / span) * (H - 2 * PAD)).toFixed(2)}`)
    .join(" ");
  const tone = points[last]! > points[0]! ? "text-success" : points[last]! < points[0]! ? "text-danger" : "text-fg-muted";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} preserveAspectRatio="none" className={className ?? `h-8 w-24 ${tone}`}>
      <polyline points={coords} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
