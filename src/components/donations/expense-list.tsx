import { ExternalLink } from "lucide-react";
import { NetworkLogo } from "@/components/economy/network-logo";
import { relativeTime } from "@/components/payments/tip-list";
import type { ClubExpense } from "@/lib/donations/queries";
import { explorerTx, isChainId } from "@/lib/economy/networks";
import { formatToken } from "@/lib/treasury/format";

/**
 * What the Safe has spent, as noted by a treasurer, newest first. Each row opens its transaction in the explorer so
 * anyone can check the amount and the destination (P1-R7).
 */
export function ExpenseList({ items }: { items: readonly ClubExpense[] }) {
  if (items.length === 0) return <p className="text-sm text-fg-muted">Aún no hay gastos anotados.</p>;
  return (
    <ul aria-label="Gastos de la Safe" className="flex flex-col divide-y divide-border">
      {items.map((e) => (
        <li key={e.id} className="flex flex-col gap-1 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono font-bold text-fg tabular-nums">{formatToken(e.amount, e.token)}</span>
            {isChainId(e.chainId) ? <NetworkLogo chainId={e.chainId} withName className="text-[13px] font-normal text-fg-muted" /> : null}
            <time dateTime={e.recordedAt} suppressHydrationWarning className="ml-auto text-[13px] text-fg-muted">
              {relativeTime(e.recordedAt)}
            </time>
          </div>
          <p className="break-words text-fg">{e.note}</p>
          <div className="flex flex-wrap items-center gap-x-3 text-[13px] text-fg-muted">
            <span>Anotado por {e.recorderLabel}</span>
            {isChainId(e.chainId) ? (
              <a
                href={explorerTx(e.chainId, e.txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-1 rounded-control text-fg underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
              >
                Ver transacción
                <ExternalLink aria-hidden className="size-3.5" />
              </a>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
