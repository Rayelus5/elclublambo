// What the Safe holds at the latest valuation: each asset's amount and its USD value, and the ETH price used.
import { formatBps, formatToken, formatUsd, type FundAsset } from "@/lib/treasury/format";
import type { Composition } from "@/lib/treasury/queries";

const SOURCE: Record<Composition["priceSource"], string> = { chainlink: "Chainlink", coingecko: "CoinGecko" };
const COLOR: Record<FundAsset, string> = { USDC: "var(--chart-1)", ETH: "var(--chart-2)", WETH: "var(--chart-3)" };

const dateTime = (iso: string) =>
  new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(iso)) + " UTC";

/** wei · price_e8 / 10^20 = USD6 (floor), the same formula SQL and the valuation use. USDC is 1 USD. */
const weiToUsd6 = (wei: bigint, priceE8: bigint) => (wei * priceE8) / 10n ** 20n;

export function FundComposition({ composition }: { composition: Composition | null }) {
  if (!composition) return <p className="text-sm text-fg-muted">El fondo aún no tiene valoración.</p>;
  const c = composition;
  const rows: { asset: FundAsset; amount: bigint; usd6: bigint }[] = [
    { asset: "USDC", amount: c.usdcUnits, usd6: c.usdcUnits },
    { asset: "ETH", amount: c.ethWei, usd6: weiToUsd6(c.ethWei, c.ethPriceE8) },
    { asset: "WETH", amount: c.wethWei, usd6: weiToUsd6(c.wethWei, c.ethPriceE8) },
  ];
  const total = rows.reduce((sum, r) => sum + r.usd6, 0n);
  const bps = (v: bigint) => (total > 0n ? Number((v * 10_000n) / total) : 0);

  return (
    <div className="flex flex-col gap-4">
      {total > 0n ? (
        // The split is also given in text below; the bar is a glance aid only.
        <div aria-hidden className="flex h-2 w-full gap-0.5 overflow-hidden rounded-control bg-surface-2">
          {rows
            .filter((r) => r.usd6 > 0n)
            .map((r) => (
              <span key={r.asset} className="h-full" style={{ width: `${bps(r.usd6) / 100}%`, background: COLOR[r.asset] }} />
            ))}
        </div>
      ) : null}
      <ul aria-label="Composición del fondo" className="flex flex-col divide-y divide-border">
        {rows.map((r) => (
          <li key={r.asset} className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2">
            <span aria-hidden className="size-3 shrink-0 self-center rounded-[1px]" style={{ background: COLOR[r.asset] }} />
            <span className="min-w-0 flex-1 font-mono text-sm font-bold break-all text-fg">{formatToken(r.amount, r.asset)}</span>
            <span className="font-mono text-sm text-fg tabular-nums">{formatUsd(r.usd6)}</span>
            <span className="w-14 text-right font-mono text-[13px] text-fg-muted tabular-nums">{formatBps(bps(r.usd6))}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-0.5 text-[13px] text-fg-muted">
        <p>{`Precio ETH: ${formatUsd(c.ethPriceE8 / 100n)} · ${SOURCE[c.priceSource]}`}</p>
        <p>
          Valoración del <time dateTime={c.takenAt}>{dateTime(c.takenAt)}</time>
        </p>
      </div>
    </div>
  );
}
