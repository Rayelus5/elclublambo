import { ChangeIcon, changeTone } from "@/components/market/change";
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

function Fact({
  term,
  children,
  className,
  wide,
}: {
  term: string;
  children: React.ReactNode;
  className?: string;
  /** Takes the whole row of the two-column phone grid (the website, a long value). */
  wide?: boolean;
}) {
  return (
    // One small card per figure: label on top, value below, wrapping instead of clipping on a narrow phone.
    <div className={cn("flex min-w-0 flex-col gap-1 rounded-panel border border-border bg-surface p-3", wide && "col-span-2 @lg:col-span-1")}>
      <dt className="text-[13px] text-fg-muted">{term}</dt>
      <dd className={cn("font-bold break-words tabular-nums", className)}>{children}</dd>
    </div>
  );
}

export function CoinFacts({ coin }: { coin: CoinDetail }) {
  const change = formatChange(coin.change24h);
  const sym = coin.symbol.toUpperCase();
  return (
    // Cards reflow by the panel's own width (the forum's sidebar and rail change it): 2, 3, then 4 per row.
    <div className="@container">
      <dl className="grid grid-cols-2 gap-2 @lg:grid-cols-3 @3xl:grid-cols-4">
        <Fact term="Precio">{formatPrice(coin.priceUsd)}</Fact>
        <Fact term="Variación 24 h" className={cn("inline-flex items-center gap-1", changeTone(change.dir))}>
          <ChangeIcon dir={change.dir} />
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
              {coin.athDate ? <span className="block text-[13px] font-normal text-fg-muted">{formatDate(coin.athDate)}</span> : null}
            </>
          )}
        </Fact>
        {coin.homepage ? (
          <Fact term="Web" wide>
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
    </div>
  );
}
