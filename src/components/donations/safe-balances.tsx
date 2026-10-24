import { NetworkLogo } from "@/components/economy/network-logo";
import type { SafeBalance } from "@/lib/donations/safe-balances";
import { explorerAddress, NETWORKS } from "@/lib/economy/networks";
import { formatToken } from "@/lib/treasury/format";

const LINK =
  "inline-flex min-h-11 items-center rounded-control text-[13px] font-bold text-accent underline underline-offset-4 outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent";

function Amount({ value, token }: { value: bigint | null; token: "USDC" | "ETH" }) {
  if (value === null) return <span className="text-fg-muted">No disponible</span>;
  return <span className="font-mono text-fg tabular-nums">{formatToken(value, token)}</span>;
}

/** What the club Safe holds on each network, read on-chain now. Anyone can check it in the explorer. */
export function SafeBalances({ balances, safe }: { balances: readonly SafeBalance[]; safe: string | null }) {
  return (
    <ul aria-label="Saldos de la Safe" className="flex flex-col divide-y divide-border">
      {balances.map((b) => (
        <li key={b.chainId} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <NetworkLogo chainId={b.chainId} withName className="text-sm" />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <Amount value={b.usdc} token="USDC" />
            <Amount value={b.eth} token="ETH" />
            {safe ? (
              <a
                href={explorerAddress(b.chainId, safe)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Ver la Safe en el explorador de ${NETWORKS[b.chainId].name}`}
                className={LINK}
              >
                Explorador
              </a>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
