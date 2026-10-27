import { NetworkLogo } from "@/components/economy/network-logo";
import { relativeTime } from "@/components/payments/tip-list";
import type { DonationOverview } from "@/lib/donations/queries";
import { isChainId } from "@/lib/economy/networks";
import { formatToken, formatUsd } from "@/lib/treasury/format";

/** Total donated (USD at the moment of each donation), distinct donors and the split by network. */
export function DonationSummary({ overview }: { overview: DonationOverview }) {
  const chains = overview.byChain.filter((c) => isChainId(c.chainId));
  return (
    <div className="flex flex-col gap-5">
      <dl className="grid grid-cols-2 gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <dt className="text-[13px] text-fg-muted">Total donado</dt>
          <dd className="font-display text-2xl font-bold break-words text-fg tabular-nums sm:text-3xl">{formatUsd(overview.totalUsd6)}</dd>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <dt className="text-[13px] text-fg-muted">Donantes</dt>
          <dd className="font-display text-2xl font-bold text-fg tabular-nums sm:text-3xl">{overview.donorCount}</dd>
        </div>
      </dl>
      {chains.length > 0 ? (
        <ul aria-label="Por red" className="flex flex-col divide-y divide-border border-t border-border">
          {chains.map((c) => (
            <li key={c.chainId} className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm">
              {isChainId(c.chainId) ? <NetworkLogo chainId={c.chainId} withName /> : null}
              <span className="font-mono text-fg tabular-nums">{formatUsd(c.usd6)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-[13px] text-fg-muted">El valor en USD se fija al registrar cada donación: el USDC cuenta 1:1 y el ETH al precio de Chainlink de ese momento.</p>
    </div>
  );
}

/** The last donations, newest first. A donor who chose to be anonymous or to leave the list reads «Anónimo». */
export function RecentDonations({ items }: { items: DonationOverview["recent"] }) {
  if (items.length === 0) return <p className="text-sm text-fg-muted">Aún no hay donaciones. La primera puede ser la tuya.</p>;
  return (
    <ul aria-label="Donaciones recientes" className="flex flex-col divide-y divide-border">
      {items.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
          <span className="min-w-0 flex-1 truncate font-bold text-fg">{d.donorLabel ?? "Anónimo"}</span>
          <span className="font-mono text-fg tabular-nums">{formatToken(d.amount, d.token)}</span>
          {isChainId(d.chainId) ? <NetworkLogo chainId={d.chainId} withName className="text-[13px] font-normal text-fg-muted" /> : null}
          <time dateTime={d.at} suppressHydrationWarning className="text-[13px] text-fg-muted">
            {relativeTime(d.at)}
          </time>
        </li>
      ))}
    </ul>
  );
}
