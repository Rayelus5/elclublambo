import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { formatChange, formatPrice, RANGE_LABEL } from "@/lib/market/format";
import type { ChartPoint, ChartRange } from "@/lib/market/types";
import { cn } from "@/lib/utils";

const W = 600;
const H = 180;
const PAD = 8;

/** Price line with a faint area, hand-rolled like the DAO charts. The trend is also stated in text (never colour alone). */
export function PriceChart({ name, range, points }: { name: string; range: ChartRange; points: ChartPoint[] }) {
  if (points.length < 2) return <p className="text-sm text-fg-muted">Sin datos para este periodo.</p>;

  const t0 = points[0]![0];
  const t1 = Math.max(points[points.length - 1]![0], t0 + 1);
  let min = Infinity;
  let max = -Infinity;
  for (const [, p] of points) {
    if (p < min) min = p;
    if (p > max) max = p;
  }
  const span = max - min || 1; // flat series: draw a centred line, never divide by zero
  const x = (t: number) => ((t - t0) / (t1 - t0)) * W;
  const y = (p: number) => (max === min ? H / 2 : H - PAD - ((p - min) / span) * (H - 2 * PAD));

  const line = points.map(([t, p], i) => `${i === 0 ? "M" : "L"} ${x(t).toFixed(1)} ${y(p).toFixed(1)}`).join(" ");
  const area = `${line} L ${W} ${H} L 0 ${H} Z`;
  const first = points[0]![1];
  const last = points[points.length - 1]![1];
  const change = formatChange(first === 0 ? null : ((last - first) / first) * 100);
  const Icon = change.dir === "up" ? ArrowUp : change.dir === "down" ? ArrowDown : Minus;
  const label = `Precio de ${name} en ${RANGE_LABEL[range]}: de ${formatPrice(min)} a ${formatPrice(max)}, último ${formatPrice(last)}`;

  return (
    <figure className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={label}
        className="h-56 w-full overflow-visible rounded-control border border-border bg-bg"
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="var(--border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        <path d={area} fill="var(--accent)" fillOpacity="0.12" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[13px] text-fg-muted">
        <span>
          Mínimo <span className="font-mono font-bold text-fg">{formatPrice(min)}</span>
        </span>
        <span>
          Máximo <span className="font-mono font-bold text-fg">{formatPrice(max)}</span>
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1 font-mono font-bold",
            change.dir === "up" && "text-success",
            change.dir === "down" && "text-danger",
          )}
        >
          <Icon className="size-3.5 shrink-0" aria-hidden />
          {change.text} en {RANGE_LABEL[range]}
        </span>
      </figcaption>
    </figure>
  );
}
