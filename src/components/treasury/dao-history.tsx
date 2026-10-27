import { legacyExplorerTx, type LegacyChainId } from "@/lib/legacy/linea";
import { formatUsdc } from "@/lib/treasury/format";
import type { HistoryEntry } from "@/lib/treasury/queries";

const date = (iso: string) => new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(iso));

/** Credited donations, newest first. The explorer link only exists when the server unmasked the hash for the viewer. */
export function DaoHistory({ entries, chainId }: { entries: HistoryEntry[]; chainId: LegacyChainId }) {
  if (entries.length === 0) return <p className="text-fg-muted">Todavía no hay donaciones acreditadas.</p>;
  return (
    <ul className="flex flex-col divide-y divide-border border-y border-border">
      {entries.map((e) => (
        <li key={e.ledgerId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-bold text-fg">{e.label}</span>
            <span className="text-[13px] text-fg-muted">{date(e.creditedAt)}</span>
          </div>
          <span className="font-mono text-sm font-bold text-fg">{formatUsdc(e.amount)}</span>
          {e.txHash ? (
            <a
              href={legacyExplorerTx(chainId, e.txHash)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Ver en el explorador: donación de ${e.label}`}
              className="inline-flex min-h-11 items-center rounded-control text-sm font-bold text-accent underline underline-offset-4 outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              Ver en el explorador
            </a>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
