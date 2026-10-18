// Hand-rolled SVG charts for /dao: no chart library, theme tokens only, every figure also given in text.
import type { DonutSlice } from "@/lib/treasury/charts";
import { formatBps } from "@/lib/treasury/format";

const R = 42;
const CIRC = 2 * Math.PI * R;

/** Donut arcs as dashed circles, first slice at 12 o'clock, clockwise. */
function Arcs({ slices, stroke }: { slices: readonly { key: string; bps: number; color: string }[]; stroke: number }) {
  const lengths = slices.map((s) => (s.bps / 10000) * CIRC);
  const offsets = lengths.map((_, i) => lengths.slice(0, i).reduce((a, b) => a + b, 0));
  return (
    <g transform="rotate(-90 50 50)">
      <circle cx="50" cy="50" r={R} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
      {slices.map((s, i) => {
        const len = lengths[i]!;
        return (
          <circle
            key={s.key}
            data-slice={s.key}
            cx="50"
            cy="50"
            r={R}
            fill="none"
            stroke={s.color}
            strokeWidth={stroke}
            // A 1-unit gap between slices keeps neighbours apart without relying on colour alone.
            strokeDasharray={`${Math.max(len - (slices.length > 1 ? 1 : 0), 0)} ${CIRC}`}
            strokeDashoffset={-offsets[i]!}
          />
        );
      })}
    </g>
  );
}

export function ShareDonut({ slices, donors }: { slices: readonly DonutSlice[]; donors: number }) {
  if (slices.length === 0) return <p className="text-fg-muted">Aún no hay aportaciones.</p>;
  const summary = `Reparto de la DAO: ${slices.map((s) => `${s.label} ${formatBps(s.bps)}`).join(", ")}`;
  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center lg:flex-col xl:flex-row">
      <div className="relative size-44 shrink-0">
        <svg viewBox="0 0 100 100" role="img" aria-label={summary} className="size-full">
          <Arcs slices={slices} stroke={14} />
        </svg>
        <div aria-hidden className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-3xl font-black text-fg">{donors}</span>
          <span className="text-[13px] text-fg-muted">{donors === 1 ? "donante" : "donantes"}</span>
        </div>
      </div>
      <ul aria-label="Leyenda del reparto" className="flex w-full min-w-0 flex-col gap-2">
        {slices.map((s) => (
          <li key={s.key} className="flex min-w-0 items-center gap-3 text-sm">
            <span aria-hidden className="size-3 shrink-0 rounded-[1px]" style={{ background: s.color }} />
            <span className="min-w-0 flex-1 truncate text-fg" title={s.label}>
              {s.label}
            </span>
            <span className="font-mono font-bold text-fg tabular-nums">{formatBps(s.bps)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The viewer's own share as a single-arc ring. */
export function ShareRing({ bps }: { bps: number }) {
  return (
    <svg viewBox="0 0 100 100" role="img" aria-label={`Tu parte de la DAO: ${formatBps(bps)}`} className="size-20 shrink-0">
      <Arcs slices={bps > 0 ? [{ key: "me", bps: Math.min(bps, 10000), color: "var(--accent)" }] : []} stroke={12} />
    </svg>
  );
}
