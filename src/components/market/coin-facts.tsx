import { formatChange, formatCompactUsd, formatDate, formatPrice, formatSupply } from "@/lib/market/format";
import type { CoinDetail } from "@/lib/market/types";
import { cn } from "@/lib/utils";

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function Fact({ term, children, className }: { term: string; children: React.ReactNode; className?: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border py-3 sm:border-b-0">
      <dt className="text-[13px] text-fg-muted">{term}</dt>
      <dd className={cn("font-bold tabular-nums", className)}>{children}</dd>
    </div>
  );
}

export function CoinFacts({ coin }: { coin: CoinDetail }) {
  const change = formatChange(coin.change24h);
  const sym = coin.symbol.toUpperCase();
  return (
    <dl className="grid gap-x-6 rounded-panel border border-border bg-surface px-4 sm:grid-cols-2 sm:py-2 lg:grid-cols-3">
      <Fact term="Precio">{formatPrice(coin.priceUsd)}</Fact>
      <Fact term="Variación 24 h" className={cn(change.dir === "up" && "text-success", change.dir === "down" && "text-danger")}>
        {change.text}
      </Fact>
      <Fact term="Capitalización">{formatCompactUsd(coin.marketCapUsd)}</Fact>
      <Fact term="Volumen 24 h">{formatCompactUsd(coin.volumeUsd)}</Fact>
      <Fact term="Puesto">{coin.rank === null ? "—" : `#${coin.rank}`}</Fact>
      <Fact term="Suministro circulante">
        {coin.circulatingSupply === null ? "—" : `${formatSupply(coin.circulatingSupply)} ${sym}`}
      </Fact>
      <Fact term="Suministro máximo">{coin.maxSupply === null ? "Sin límite" : `${formatSupply(coin.maxSupply)} ${sym}`}</Fact>
      <Fact term="Máximo histórico">
        {coin.athUsd === null ? (
          "—"
        ) : (
          <>
            {formatPrice(coin.athUsd)}
            {coin.athDate ? <span className="ml-2 text-[13px] font-normal text-fg-muted">{formatDate(coin.athDate)}</span> : null}
          </>
        )}
      </Fact>
      {coin.homepage ? (
        <Fact term="Web">
          <a
            href={coin.homepage}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center rounded-control break-all underline underline-offset-4 outline-none hover:text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            {hostOf(coin.homepage)}
          </a>
        </Fact>
      ) : null}
    </dl>
  );
}
