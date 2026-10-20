// Hand-rolled 7-day sparkline, exposed as an image with a text equivalent from the caller.
const W = 100;
const H = 32;
const PAD = 2;

/**
 * The polyline of `points` inside the 100x32 box, one decimal per coordinate. With `maxPoints`, the series is first
 * reduced to that many evenly spaced points (first and last kept): a 96 px line cannot show more than that.
 */
export function sparklineCoords(points: number[], maxPoints = Infinity): string | null {
  if (points.length < 2) return null;
  const n = Math.max(2, Math.min(points.length, Math.floor(maxPoints)));
  const series = n === points.length ? points : Array.from({ length: n }, (_, i) => points[Math.round((i * (points.length - 1)) / (n - 1))]!);
  let min = Infinity;
  let max = -Infinity;
  for (const p of series) {
    if (p < min) min = p;
    if (p > max) max = p;
  }
  const span = max - min || 1; // flat series: a straight line, no 0/0
  const last = series.length - 1;
  return series.map((p, i) => `${((i / last) * W).toFixed(1)},${(H - PAD - ((p - min) / span) * (H - 2 * PAD)).toFixed(1)}`).join(" ");
}

/** Token colour of the week's direction (paired with the text label, never colour alone). */
export function sparklineTone(points: number[]): string {
  const first = points[0]!;
  const last = points[points.length - 1]!;
  return last > first ? "text-success" : last < first ? "text-danger" : "text-fg-muted";
}

/** The drawn line, from coordinates computed elsewhere (the market rows get them as plain data). */
export function SparklineSvg({ coords, label, className }: { coords: string; label: string; className: string }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} preserveAspectRatio="none" className={className}>
      <polyline points={coords} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function Sparkline({ points, label, className }: { points: number[]; label: string; className?: string }) {
  const coords = sparklineCoords(points);
  if (coords === null) return null;
  return <SparklineSvg coords={coords} label={label} className={className ?? `h-8 w-24 ${sparklineTone(points)}`} />;
}
