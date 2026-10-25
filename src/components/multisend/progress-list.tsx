import { CircleCheck, CircleDashed, CircleX, ExternalLink, Loader2 } from "lucide-react";
import { explorerTx, type ChainId } from "@/lib/economy/networks";
import type { Dictionary } from "@/lib/i18n";
import { fill } from "@/lib/i18n/fill";
import type { RowState } from "@/lib/multisend/progress";

const ICON = {
  todo: { Icon: CircleDashed, tone: "text-fg-muted" },
  sent: { Icon: Loader2, tone: "text-fg-muted animate-spin motion-reduce:animate-none" },
  confirmed: { Icon: CircleCheck, tone: "text-success" },
  failed: { Icon: CircleX, tone: "text-danger" },
} as const;

/**
 * One row per recipient with its status (icon and text, never colour alone) and, once the wallet returned a hash, the
 * explorer link. Stacked, with addresses that wrap, so it fits 375 px. Status changes are announced politely.
 */
export function ProgressList({
  t,
  chainId,
  rows,
  lines,
  formatUsdc,
}: {
  t: Dictionary["multisend"]["progress"];
  chainId: ChainId;
  rows: readonly RowState[];
  /** The line number in the pasted text of each row (same order). */
  lines: readonly number[];
  formatUsdc(units: bigint): string;
}) {
  return (
    <ol aria-label={t.title} aria-live="polite" className="flex flex-col gap-2">
      {rows.map((r, i) => {
        const { Icon, tone } = ICON[r.status];
        const n = lines[i] ?? i + 1;
        return (
          <li key={`${r.to}-${i}`} className="flex min-w-0 flex-col gap-1 rounded-control border border-border p-3 sm:flex-row sm:items-center sm:gap-4">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="font-mono text-[13px] break-all text-fg">{r.to}</span>
              <span className="text-sm font-bold text-fg tabular-nums">{formatUsdc(BigInt(r.amount))} USDC</span>
            </div>
            <span className="flex items-center gap-2 text-sm text-fg">
              <Icon aria-hidden className={`size-4 shrink-0 ${tone}`} />
              {t.status[r.status]}
            </span>
            {r.hash ? (
              <a
                href={explorerTx(chainId, r.hash)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={fill(t.viewTx, { n })}
                className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 self-start text-sm font-bold text-accent underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none sm:self-center"
              >
                <ExternalLink aria-hidden className="size-4 shrink-0" />
              </a>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
