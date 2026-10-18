import Link from "next/link";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { Sparkline } from "@/components/market/sparkline";
import { formatChange, formatCompactUsd, formatPrice } from "@/lib/market/format";
import type { MarketCoin } from "@/lib/market/types";
import { cn } from "@/lib/utils";

const SECONDARY = "hidden md:table-cell";
const th = "px-3 py-2 text-right text-[13px] font-bold text-fg-muted";
const td = "px-3 py-2 text-right tabular-nums";

function Change({ value, secondary }: { value: number | null; secondary?: boolean }) {
  const { text, dir } = formatChange(value);
  const Icon = dir === "up" ? ArrowUp : dir === "down" ? ArrowDown : Minus;
  return (
    <td className={cn(td, secondary && SECONDARY, dir === "up" && "text-success", dir === "down" && "text-danger", dir === "flat" && "text-fg-muted")}>
      <span className="inline-flex items-center justify-end gap-1">
        <Icon className="size-3.5 shrink-0" aria-hidden />
        {text}
      </span>
    </td>
  );
}

function trendLabel(c: MarketCoin): string {
  const first = c.sparkline7d[0]!;
  const last = c.sparkline7d[c.sparkline7d.length - 1]!;
  return `Tendencia de 7 días de ${c.name}: ${last > first ? "sube" : last < first ? "baja" : "sin cambios"}`;
}

export function MarketTable({ coins }: { coins: MarketCoin[] }) {
  return (
    <div className="overflow-x-auto rounded-panel border border-border bg-surface" data-testid="market-table-panel">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">Las 100 criptos con mayor capitalización</caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className={cn(th, "w-10 text-left")}>
              #
            </th>
            <th scope="col" className={cn(th, "text-left")}>
              Cripto
            </th>
            <th scope="col" className={th}>
              Precio
            </th>
            <th scope="col" className={cn(th, SECONDARY)}>
              1 h
            </th>
            <th scope="col" className={th}>
              24 h
            </th>
            <th scope="col" className={cn(th, SECONDARY)}>
              7 d
            </th>
            <th scope="col" className={cn(th, SECONDARY)}>
              Capitalización
            </th>
            <th scope="col" className={cn(th, SECONDARY)}>
              Volumen 24 h
            </th>
            <th scope="col" className={cn(th, SECONDARY)}>
              7 días
            </th>
          </tr>
        </thead>
        <tbody>
          {coins.map((c, i) => (
            <tr key={c.id} className="border-b border-border last:border-b-0">
              <td className="px-3 py-2 text-left tabular-nums text-fg-muted">{c.rank ?? i + 1}</td>
              {/* Below md, w-full + max-w-0: this column takes the leftover width and never grows past it, so a long
                  name is truncated inside the cell instead of widening the table (375 px, no horizontal scroll). From md
                  the name has a fixed cap instead and the panel scrolls sideways when all the columns do not fit. */}
              <td className="px-3 py-2 text-left max-md:w-full max-md:max-w-0">
                <Link
                  href={`/mercado/${c.id}`}
                  className="flex min-h-11 max-w-full items-center gap-2 rounded-control font-bold outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- remote CoinGecko icon, host-checked in the client */}
                  {c.image ? <img src={c.image} alt="" width={20} height={20} loading="lazy" className="size-5 shrink-0 rounded-full" /> : null}
                  <span className="min-w-0 truncate md:max-w-56" title={c.name}>
                    {c.name}
                  </span>
                  <span className="shrink-0 text-[13px] font-normal text-fg-muted uppercase">{c.symbol}</span>
                </Link>
              </td>
              <td className={cn(td, "whitespace-nowrap")}>{formatPrice(c.priceUsd)}</td>
              <Change value={c.change1h} secondary />
              <Change value={c.change24h} />
              <Change value={c.change7d} secondary />
              <td className={cn(td, SECONDARY, "whitespace-nowrap")}>{formatCompactUsd(c.marketCapUsd)}</td>
              <td className={cn(td, SECONDARY, "whitespace-nowrap")}>{formatCompactUsd(c.volumeUsd)}</td>
              <td className={cn(td, SECONDARY)}>
                <span className="inline-flex justify-end">
                  <Sparkline points={c.sparkline7d} label={trendLabel(c)} />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
