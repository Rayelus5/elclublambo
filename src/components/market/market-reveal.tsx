"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { ChangeIcon, changeTone } from "@/components/market/change";
import { MarketRow } from "@/components/market/market-row";
import { TD, TIER_LG, TIER_MD, TIER_SM, TIER_XL } from "@/components/market/market-tiers";
import { SparklineSvg } from "@/components/market/sparkline";
import { Button } from "@/components/ui/button";
import type { MarketChange, MarketRowData } from "@/lib/market/row-data";
import { cn } from "@/lib/utils";

export const MARKET_PAGE_SIZE = 10;

function Change({ value, tier }: { value: MarketChange; tier?: string }) {
  return (
    <td className={cn(TD, tier, "whitespace-nowrap", changeTone(value.dir))}>
      <span className="inline-flex items-center justify-end gap-1">
        <ChangeIcon dir={value.dir} />
        {value.text}
      </span>
    </td>
  );
}

function Row({ c }: { c: MarketRowData }) {
  return (
    // The whole row opens the coin on tap (MarketRow); the name link is the single tab stop for keyboard and screen
    // readers, so the table keeps its row/cell semantics.
    <MarketRow href={c.href}>
      <td className={cn(TIER_SM, "px-3 py-2 text-left tabular-nums text-fg-muted")}>{c.rank}</td>
      {/* w-full + max-w-0: this column takes the leftover width and never grows past it, so a long name is truncated
          inside the cell instead of widening the table. */}
      <td className="w-full max-w-0 px-3 py-2 text-left">
        <Link
          href={c.href}
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
              <span className="shrink-0 tabular-nums @min-[26rem]:hidden">{`#${c.rank}`}</span>
              {/* Untrusted length: capped and truncated so it never widens or spills out of the cell. */}
              <span className="min-w-0 max-w-[6ch] truncate uppercase" title={c.symbol.toUpperCase()}>
                {c.symbol}
              </span>
            </span>
          </span>
        </Link>
      </td>
      <td className={cn(TD, "whitespace-nowrap")}>
        <span className="block">{c.price}</span>
        {/* Compact rows: the 24 h change sits under the price until the 24 h column has room of its own. */}
        <span data-compact-change className={cn("mt-0.5 flex items-center justify-end gap-1 text-[13px] @min-[26rem]:hidden", changeTone(c.change24h.dir))}>
          <span className="sr-only">Cambio 24 h:</span>
          <ChangeIcon dir={c.change24h.dir} />
          {c.change24h.text}
        </span>
      </td>
      <Change value={c.change1h} tier={TIER_XL} />
      <Change value={c.change24h} tier={TIER_SM} />
      <Change value={c.change7d} tier={TIER_MD} />
      <td className={cn(TD, TIER_MD, "whitespace-nowrap")}>{c.marketCap}</td>
      <td className={cn(TD, TIER_XL, "whitespace-nowrap")}>{c.volume}</td>
      <td className={cn(TD, TIER_LG)}>
        <span className="inline-flex justify-end">
          {c.spark ? <SparklineSvg coords={c.spark.coords} label={c.spark.label} className={`h-8 w-24 ${c.spark.tone}`} /> : null}
        </span>
      </td>
    </MarketRow>
  );
}

/**
 * T-005: shows the market rows ten at a time. The whole top 100 is in the same cached response, so «Ver más» only
 * reveals more of them: no request, no reload. T-006: the rows arrive as plain data (MarketRowData), not rendered
 * markup, and only the revealed ones are drawn. After each reveal focus goes to the link of the first new row, and the
 * counter lives in a polite live region.
 */
export function MarketReveal({ caption, head, rows }: { caption: string; head: ReactNode; rows: MarketRowData[] }) {
  const total = rows.length;
  const [revealed, setRevealed] = useState(MARKET_PAGE_SIZE);
  // Clamped on render: a revalidated, shorter list never reads «Mostrando 20 de 7».
  const visible = Math.min(revealed, total);
  const tbody = useRef<HTMLTableSectionElement>(null);
  const focusRow = useRef<number | null>(null);

  useEffect(() => {
    const index = focusRow.current;
    if (index === null) return;
    focusRow.current = null;
    tbody.current?.rows[index]?.querySelector<HTMLAnchorElement>("a[href]")?.focus();
  }, [visible]);

  function showMore() {
    focusRow.current = visible;
    setRevealed(Math.min(visible + MARKET_PAGE_SIZE, total));
  }

  return (
    <>
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        {head}
        <tbody ref={tbody}>
          {rows.slice(0, visible).map((c) => (
            <Row key={c.id} c={c} />
          ))}
        </tbody>
      </table>
      <div className="flex flex-col items-stretch gap-2 border-t border-border p-3 @min-[26rem]:flex-row @min-[26rem]:items-center @min-[26rem]:justify-between">
        <p aria-live="polite" className="text-center text-[13px] text-fg-muted tabular-nums">
          {`Mostrando ${visible} de ${total}`}
        </p>
        {visible < total ? (
          <Button type="button" variant="secondary" onClick={showMore}>
            Ver más
            <ChevronDown aria-hidden />
          </Button>
        ) : null}
      </div>
    </>
  );
}
