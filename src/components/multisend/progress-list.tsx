"use client";

import { CircleCheck, CircleDashed, CircleHelp, CircleX, ExternalLink, Loader2, RefreshCw, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { explorerTx, type ChainId } from "@/lib/economy/networks";
import type { Dictionary } from "@/lib/i18n";
import { fill } from "@/lib/i18n/fill";
import type { RowState } from "@/lib/multisend/progress";

const ICON = {
  todo: { Icon: CircleDashed, tone: "text-fg-muted" },
  sent: { Icon: Loader2, tone: "text-fg-muted animate-spin motion-reduce:animate-none" },
  confirmed: { Icon: CircleCheck, tone: "text-success" },
  unconfirmed: { Icon: CircleHelp, tone: "text-warning" },
  not_found: { Icon: SearchX, tone: "text-warning" },
  scan_failed: { Icon: CircleX, tone: "text-danger" },
} as const;

/**
 * One row per recipient with its status (icon and text, never colour alone) and, once the wallet returned a hash, the
 * explorer link. Only a `not_found` row (a successful scan found nothing) explains itself and offers «Comprobé que no se
 * envió»: only a ticked one may be sent again. A `scan_failed` row is never tickable: its one action is «Reintentar
 * comprobación». Stacked, with addresses that wrap, so it fits 375 px. Status changes are announced politely.
 */
export function ProgressList({
  t,
  chainId,
  rows,
  lines,
  formatUsdc,
  released,
  onRelease,
  onRetry,
  retryDisabled,
  releaseDisabled,
  releaseBlocked,
}: {
  t: Dictionary["multisend"]["progress"];
  chainId: ChainId;
  rows: readonly RowState[];
  /** The line number in the pasted text of each row (same order). */
  lines: readonly number[];
  formatUsdc(units: bigint): string;
  released: ReadonlySet<string>;
  onRelease(id: string, on: boolean): void;
  onRetry(): void;
  retryDisabled: boolean;
  /** R1: no tick while the wallet has a pending tx or its nonces are unknown; `releaseBlocked` says why. */
  releaseDisabled: boolean;
  releaseBlocked: string | null;
}) {
  return (
    <ol aria-label={t.title} aria-live="polite" className="flex flex-col gap-2">
      {rows.map((r, i) => {
        const { Icon, tone } = ICON[r.status];
        const n = lines[i] ?? i + 1;
        return (
          <li key={r.id} className="flex min-w-0 flex-col gap-2 rounded-control border border-border p-3">
            <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
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
            </div>
            {r.status === "scan_failed" ? (
              <Button type="button" variant="outline" className="self-start" disabled={retryDisabled} onClick={onRetry}>
                <RefreshCw aria-hidden />
                {t.retryCheck}
              </Button>
            ) : null}
            {r.status === "not_found" ? (
              <div className="flex flex-col gap-1">
                <p className="text-sm text-fg">{t.releaseHint}</p>
                <label className={`flex min-h-11 items-center gap-3 text-sm text-fg ${releaseDisabled ? "cursor-not-allowed" : "cursor-pointer"}`}>
                  <Checkbox checked={released.has(r.id)} disabled={releaseDisabled} onCheckedChange={(v) => onRelease(r.id, v === true)} />
                  {t.release}
                </label>
                {releaseBlocked ? <p className="text-sm font-bold text-fg">{releaseBlocked}</p> : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
