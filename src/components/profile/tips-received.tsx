import { TipList } from "@/components/payments/tip-list";
import { NETWORKS, type ChainId } from "@/lib/economy/networks";
import { formatAmount, type Token } from "@/lib/payments/amounts";
import type { TipEntry } from "@/lib/payments/queries";

const ORDER: Token[] = ["USDC", "ETH"];

/** Totals per token for the active chain, then the most recent tips (same anonymity rules as the message popover). */
export const RECENT_TIPS = 20;

/** `entries` may hold more than the 20 listed: the totals add them all up, the list shows the most recent ones. */
export function TipsReceived({ entries, activeChainId }: { entries: readonly TipEntry[]; activeChainId: ChainId }) {
  const totals = new Map<Token, bigint>();
  for (const e of entries) if (e.chainId === activeChainId) totals.set(e.token, (totals.get(e.token) ?? 0n) + e.amount);
  const network = NETWORKS[activeChainId];

  return (
    <section aria-labelledby="tips-received-title" className="flex flex-col gap-4">
      <h2 id="tips-received-title" className="text-h2">
        Propinas recibidas
      </h2>
      {entries.length === 0 ? (
        <p className="text-fg-muted">Todavía no hay propinas.</p>
      ) : (
        <>
          <p aria-label={`Totales en ${network.name}`} className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            {ORDER.filter((t) => totals.has(t)).map((t) => (
              <span key={t} className="font-mono text-lg font-bold text-fg">
                {formatAmount(totals.get(t)!, t)} {t}
              </span>
            ))}
            <span className="text-sm text-fg-muted">en {network.name}</span>
          </p>
          <TipList entries={entries.slice(0, RECENT_TIPS)} time="absolute" />
        </>
      )}
    </section>
  );
}
