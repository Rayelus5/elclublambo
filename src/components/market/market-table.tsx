import Link from "next/link";
import { ChangeIcon, changeTone } from "@/components/market/change";
import { MarketReveal } from "@/components/market/market-reveal";
import { MarketRow } from "@/components/market/market-row";
import { Sparkline } from "@/components/market/sparkline";
import { formatChange, formatCompactUsd, formatPrice } from "@/lib/market/format";
import type { MarketCoin } from "@/lib/market/types";
import { cn } from "@/lib/utils";

// Ruling F4b-R4: the table always fits its panel (never a sideways scroll, inside or outside). Columns appear in tiers
// by the PANEL's width (container queries), because the forum shell's sidebar and right rail make <main> narrower at
// 1024 px than at 768 px. Base (T-003, compact exchange-style rows on a phone): Cripto (logo, name over symbol and
// rank) and Precio (price over the 24 h change).
const TIER_SM = "hidden @min-[26rem]:table-cell"; // #, 24 h as their own columns (panel ≥ 26rem: 768 px, 1024 px)
const TIER_MD = "hidden @min-[38rem]:table-cell"; // 7 d, Capitalización (panel ≥ 38rem: fits at 1280 px with the rail)
const TIER_LG = "hidden @3xl:table-cell"; // 7-day sparkline (≥ 48rem)
const TIER_XL = "hidden @5xl:table-cell"; // 1 h, Volumen 24 h (≥ 64rem)
const th = "px-3 py-2 text-right text-[13px] font-bold text-fg-muted";
const td = "px-3 py-2 text-right tabular-nums";

function Change({ value, tier }: { value: number | null; tier?: string }) {
  const { text, dir } = formatChange(value);
  return (
    <td className={cn(td, tier, "whitespace-nowrap", changeTone(dir))}>
      <span className="inline-flex items-center justify-end gap-1">
        <ChangeIcon dir={dir} />
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

const head = (
  <thead>
    <tr className="border-b border-border">
      <th scope="col" className={cn(th, TIER_SM, "w-10 text-left")}>
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
      <th scope="col" className={cn(th, TIER_SM)}>
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
);

function Row({ c, rank }: { c: MarketCoin; rank: number }) {
  const day = formatChange(c.change24h);
  return (
    // The whole row opens the coin on tap (MarketRow); the name link is the single tab stop for keyboard and screen
    // readers, so the table keeps its row/cell semantics.
    <MarketRow href={`/mercado/${c.id}`}>
      <td className={cn(TIER_SM, "px-3 py-2 text-left tabular-nums text-fg-muted")}>{rank}</td>
      {/* w-full + max-w-0: this column takes the leftover width and never grows past it, so a long name is truncated
          inside the cell instead of widening the table. */}
      <td className="w-full max-w-0 px-3 py-2 text-left">
        <Link
          href={`/mercado/${c.id}`}
          // Its keyboard focus is drawn as an outline around the whole row (MarketRow), plus an underline here.
          className="flex min-h-11 max-w-full items-center gap-3 underline-offset-4 outline-none focus-visible:underline"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- remote CoinGecko icon, host-checked in the client */}
          {c.image ? <img src={c.image} alt="" width={28} height={28} loading="lazy" className="size-7 shrink-0 rounded-full" /> : null}
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-bold text-fg" title={c.name}>
              {c.name}
            </span>
            <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-fg-muted">
              <span className="shrink-0 tabular-nums @min-[26rem]:hidden">{`#${rank}`}</span>
              {/* Untrusted length: capped and truncated so it never widens or spills out of the cell. */}
              <span className="min-w-0 max-w-[6ch] truncate uppercase" title={c.symbol.toUpperCase()}>
                {c.symbol}
              </span>
            </span>
          </span>
        </Link>
      </td>
      <td className={cn(td, "whitespace-nowrap")}>
        <span className="block">{formatPrice(c.priceUsd)}</span>
        {/* Compact rows: the 24 h change sits under the price until the 24 h column has room of its own. */}
        <span data-compact-change className={cn("mt-0.5 flex items-center justify-end gap-1 text-[13px] @min-[26rem]:hidden", changeTone(day.dir))}>
          <span className="sr-only">Cambio 24 h:</span>
          <ChangeIcon dir={day.dir} />
          {day.text}
        </span>
      </td>
      <Change value={c.change1h} tier={TIER_XL} />
      <Change value={c.change24h} tier={TIER_SM} />
      <Change value={c.change7d} tier={TIER_MD} />
      <td className={cn(td, TIER_MD, "whitespace-nowrap")}>{formatCompactUsd(c.marketCapUsd)}</td>
      <td className={cn(td, TIER_XL, "whitespace-nowrap")}>{formatCompactUsd(c.volumeUsd)}</td>
      <td className={cn(td, TIER_LG)}>
        <span className="inline-flex justify-end">
          <Sparkline points={c.sparkline7d} label={trendLabel(c)} />
        </span>
      </td>
    </MarketRow>
  );
}

export function MarketTable({ coins }: { coins: MarketCoin[] }) {
  return (
    <div className="@container rounded-panel border border-border bg-surface" data-testid="market-table-panel">
      <MarketReveal
        caption="Criptos con mayor capitalización"
        head={head}
        rows={coins.map((c, i) => (
          <Row key={c.id} c={c} rank={c.rank ?? i + 1} />
        ))}
      />
    </div>
  );
}
