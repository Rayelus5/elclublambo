"use client";

// The fund's value (NAV) or the value of one participación over time, from the hourly snapshots (dao_nav_history).
// Hand-rolled step area like the old balance chart: theme tokens only, the trend also given in text.
import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/browser";
import { formatUsd, formatUsdPrecise } from "@/lib/treasury/format";
import { getNavHistory, type NavPoint, type NavRange } from "@/lib/treasury/queries";
import { cn } from "@/lib/utils";

const RANGES: { id: NavRange; label: string }[] = [
  { id: "24h", label: "24 h" },
  { id: "7d", label: "7 días" },
  { id: "30d", label: "30 días" },
  { id: "all", label: "Todo" },
];

type Series = "nav" | "price";
const SERIES: { id: Series; label: string }[] = [
  { id: "nav", label: "Valor del fondo" },
  { id: "price", label: "Valor por participación" },
];

const W = 600;
const H = 180;
const day = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", timeZone: "UTC" });
const hour = new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

const toggleClass =
  "inline-flex min-h-11 items-center rounded-control border px-3 text-[13px] font-bold outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg motion-reduce:transition-none";

function Toggles<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={o.id === value}
          onClick={() => onChange(o.id)}
          className={cn(
            toggleClass,
            o.id === value ? "border-accent bg-surface-2 text-fg" : "border-border text-fg-muted hover:bg-surface-2 hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** `points` is the last range read (null before the first); `loading` is true while a (new) range is on its way. */
type State = { loading: boolean; error: boolean; points: NavPoint[] | null; range: NavRange };

/** `navAt` is the latest valuation time: when it changes (a live refresh of /dao), the history is read again. */
export function NavChart({ navAt = null }: { navAt?: string | null }) {
  const [range, setRange] = useState<NavRange>("7d");
  const [series, setSeries] = useState<Series>("nav");
  const [state, setState] = useState<State>({ loading: true, error: false, points: null, range: "7d" });

  useEffect(() => {
    let live = true;
    getNavHistory(createBrowserClient(), range).then(
      (points) => live && setState({ loading: false, error: false, points, range }),
      () => live && setState({ loading: false, error: true, points: null, range }),
    );
    return () => {
      live = false;
    };
  }, [range, navAt]);

  const label = SERIES.find((s) => s.id === series)!.label;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Toggles label="Serie" options={SERIES} value={series} onChange={setSeries} />
        <Toggles
          label="Periodo"
          options={RANGES}
          value={range}
          onChange={(r) => {
            if (r === range) return;
            setRange(r);
            setState((s) => ({ ...s, loading: true }));
          }}
        />
      </div>
      <div aria-busy={state.loading} className="flex flex-col">
        {state.loading ? (
          <p role="status" className="sr-only">
            Cargando…
          </p>
        ) : null}
        {state.error ? (
          <p role="alert" className="text-sm text-danger">
            No se pudo cargar el gráfico.
          </p>
        ) : state.points === null ? (
          <div aria-hidden className="h-44 w-full rounded-control border border-border bg-bg" />
        ) : state.points.length === 0 ? (
          state.loading ? (
            <div aria-hidden className="h-44 w-full rounded-control border border-border bg-bg" />
          ) : (
            <p className="text-sm text-fg-muted">El gráfico aparecerá con la primera valoración.</p>
          )
        ) : (
          // While another range loads, the previous one stays as a dimmed placeholder, hidden from assistive tech so
          // its dates are never read as the newly selected range.
          <div aria-hidden={state.loading || undefined} className={cn(state.loading && "opacity-50")}>
            <StepArea points={state.points} series={series} label={label} short={state.range === "24h"} />
          </div>
        )}
      </div>
    </div>
  );
}

function StepArea({ points, series, label, short }: { points: NavPoint[]; series: Series; label: string; short: boolean }) {
  const values = useMemo(() => points.map((p) => (series === "nav" ? p.navUsd6 : p.sharePriceUsd6)), [points, series]);
  const times = points.map((p) => new Date(p.takenAt).getTime());
  const t0 = times[0]!;
  const t1 = Math.max(times.at(-1)!, t0 + 1);
  const max = values.reduce((m, v) => (v > m ? v : m), 1n);
  // Floats only to place pixels; every figure shown as text comes from the exact bigint.
  const x = (t: number) => ((t - t0) / (t1 - t0)) * W;
  const y = (v: bigint) => H - (Number(v) / Number(max)) * (H - 8);

  let d = `M 0 ${y(values[0]!)}`;
  for (let i = 1; i < values.length; i++) d += ` H ${x(times[i]!)} V ${y(values[i]!)}`;
  d += ` H ${W}`;
  const area = `${d} V ${H} H 0 Z`;
  const first = values[0]!;
  const last = values.at(-1)!;
  const money = series === "price" ? formatUsdPrecise : formatUsd;
  const when = (iso: string) => (short ? hour.format(new Date(iso)) : day.format(new Date(iso)));
  const from = when(points[0]!.takenAt);
  const to = when(points.at(-1)!.takenAt);

  return (
    <figure className="flex flex-col gap-2">
      {max !== last ? <span className="self-end font-mono text-[13px] text-fg-muted">{money(max)}</span> : null}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label}: de ${money(first)} a ${money(last)} entre ${from} y ${to}`}
        className="h-44 w-full overflow-visible rounded-control border border-border bg-bg"
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="var(--border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        <path d={area} fill="var(--accent)" fillOpacity="0.12" />
        <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      <figcaption className="flex items-baseline justify-between gap-2 text-[13px] text-fg-muted">
        <span>{from}</span>
        <span className="font-mono font-bold text-fg">{money(last)}</span>
        <span>{to}</span>
      </figcaption>
    </figure>
  );
}
