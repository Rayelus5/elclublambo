import { TipList } from "@/components/payments/tip-list";
import { NETWORKS, type ChainId } from "@/lib/economy/networks";
import { formatAmount } from "@/lib/payments/amounts";
import type { TipEntry, TipTotal } from "@/lib/payments/queries";

export const RECENT_TIPS = 20;

/**
 * `totals` are the exact server-side sums per token for the active chain (not derived from `entries`); `entries` are
 * the most recent tips, any chain, listed with the same anonymity rules as the message popover.
 */
export function TipsReceived({
  entries,
  totals,
  activeChainId,
}: {
  entries: readonly TipEntry[];
  totals: readonly TipTotal[];
  activeChainId: ChainId;
}) {
  const network = NETWORKS[activeChainId];

  return (
    <section aria-labelledby="tips-received-title" className="flex flex-col gap-4">
      <h2 id="tips-received-title" className="text-h2">
        Propinas recibidas
      </h2>
      {entries.length === 0 && totals.length === 0 ? (
        <p className="text-fg-muted">Todavía no hay propinas.</p>
      ) : (
        <>
          {totals.length === 0 ? (
            <p className="text-fg-muted">Sin propinas en {network.name}.</p>
          ) : (
            <div className="flex flex-col gap-1">
              <p id="tips-totals-title" className="text-sm text-fg-muted">
                Totales en {network.name}
              </p>
              <dl aria-labelledby="tips-totals-title" className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
                {totals.map((t) => (
                  <div key={t.token} className="flex items-baseline gap-2">
                    <dt className="sr-only">{t.token}</dt>
                    <dd className="font-mono text-lg font-bold text-fg">
                      {formatAmount(t.total, t.token)} {t.token}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          <TipList entries={entries.slice(0, RECENT_TIPS)} time="absolute" />
        </>
      )}
    </section>
  );
}
