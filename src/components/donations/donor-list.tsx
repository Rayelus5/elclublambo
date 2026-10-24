import type { DonorRankRow } from "@/lib/donations/queries";
import { formatUsd } from "@/lib/treasury/format";
import { cn } from "@/lib/utils";

/** Members who donated and chose to appear (P1-R2), biggest total first. The viewer's own row always shows, marked «Tú». */
export function DonorList({ rows }: { rows: readonly DonorRankRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-fg-muted">Todavía no hay donantes en la lista.</p>;
  return (
    <ol aria-label="Lista de donantes" className="flex flex-col divide-y divide-border">
      {rows.map((r, i) => (
        <li key={r.memberId} className={cn("flex min-h-11 items-center gap-3 py-2 text-sm", r.isMe && "font-bold")}>
          <span className="w-6 shrink-0 text-right font-mono text-[13px] text-fg-muted tabular-nums">{i + 1}</span>
          <span className="min-w-0 flex-1 truncate text-fg">{r.label}</span>
          {r.isMe ? <span className="shrink-0 rounded-control bg-surface-2 px-2 py-0.5 text-[13px] text-fg">Tú</span> : null}
          <span className="shrink-0 font-mono text-fg tabular-nums">{formatUsd(r.totalUsd6)}</span>
        </li>
      ))}
    </ol>
  );
}
