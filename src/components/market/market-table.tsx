import Link from "next/link";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { Sparkline } from "@/components/market/sparkline";
import { formatChange, formatCompactUsd, formatPrice } from "@/lib/market/format";
import type { MarketCoin } from "@/lib/market/types";
import { cn } from "@/lib/utils";

// Ruling F4b-R4: the table always fits its panel (never a sideways scroll, inside or outside). Columns appear in tiers
// by the PANEL's width (container queries), because the forum shell's sidebar and right rail make <main> narrower at
// 1024 px than at 768 px. Base: #, Cripto, Precio, 24 h.
const TIER_MD = "hidden @min-[38rem]:table-cell"; // 7 d, Capitalización (panel ≥ 38rem: fits at 1280 px with the rail)
const TIER_LG = "hidden @3xl:table-cell"; // 7-day sparkline (≥ 48rem)
const TIER_XL = "hidden @5xl:table-cell"; // 1 h, Volumen 24 h (≥ 64rem)
const th = "px-3 py-2 text-right text-[13px] font-bold text-fg-muted";
const td = "px-3 py-2 text-right tabular-nums";

function Change({ value, tier }: { value: number | null; tier?: string }) {
  const { text, dir } = formatChange(value);
  const Icon = dir === "up" ? ArrowUp : dir === "down" ? ArrowDown : Minus;
  return (
    <td className={cn(td, tier, dir === "up" && "text-success", dir === "down" && "text-danger", dir === "flat" && "text-fg-muted")}>
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
    <div className="@container rounded-panel border border-border bg-surface" data-testid="market-table-panel">
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
            <th scope="col" className={cn(th, TIER_XL)}>
              1 h
            </th>
            <th scope="col" className={th}>
              24 h
            </th>
            <th scope="col" className={cn(th, TIER_MD)}>
              7 d
            </th>
            <th scope="col" className={cn(th, TIER_MD)}>
              Capitalización
            </th>
            <th scope="col" className={cn(th, TIER_XL)}>
              Volumen 24 h
            </th>
            <th scope="col" className={cn(th, TIER_LG)}>
              7 días
            </th>
          </tr>
        </thead>
        <tbody>
          {coins.map((c, i) => (
            <tr key={c.id} className="border-b border-border last:border-b-0">
              <td className="px-3 py-2 text-left tabular-nums text-fg-muted">{c.rank ?? i + 1}</td>
              {/* w-full + max-w-0: this column takes the leftover width and never grows past it, so a long name is
                  truncated inside the cell instead of widening the table. */}
              <td className="w-full max-w-0 px-3 py-2 text-left">
                <Link
                  href={`/mercado/${c.id}`}
                  className="flex min-h-11 max-w-full items-center gap-2 rounded-control font-bold outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- remote CoinGecko icon, host-checked in the client */}
                  {c.image ? <img src={c.image} alt="" width={20} height={20} loading="lazy" className="size-5 shrink-0 rounded-full" /> : null}
                  <span className="min-w-0 truncate" title={c.name}>
                    {c.name}
                  </span>
                  {/* Untrusted length: capped and truncated so it never widens or spills out of the cell. */}
                  <span className="min-w-0 max-w-[6ch] truncate text-[13px] font-normal text-fg-muted uppercase" title={c.symbol.toUpperCase()}>
                    {c.symbol}
                  </span>
                </Link>
              </td>
              <td className={cn(td, "whitespace-nowrap")}>{formatPrice(c.priceUsd)}</td>
              <Change value={c.change1h} tier={TIER_XL} />
              <Change value={c.change24h} />
              <Change value={c.change7d} tier={TIER_MD} />
              <td className={cn(td, TIER_MD, "whitespace-nowrap")}>{formatCompactUsd(c.marketCapUsd)}</td>
              <td className={cn(td, TIER_XL, "whitespace-nowrap")}>{formatCompactUsd(c.volumeUsd)}</td>
              <td className={cn(td, TIER_LG)}>
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
