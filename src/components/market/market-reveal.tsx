"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";

export const MARKET_PAGE_SIZE = 10;

/**
 * T-005: shows the market rows ten at a time. The rows arrive already rendered by the server (the whole top 100 is in
 * the same cached response), so «Ver más» only reveals more of them: no request, no reload. After each reveal focus
 * goes to the link of the first new row, and the counter lives in a polite live region.
 */
export function MarketReveal({ caption, head, rows }: { caption: string; head: ReactNode; rows: ReactNode[] }) {
  const total = rows.length;
  const [visible, setVisible] = useState(Math.min(MARKET_PAGE_SIZE, total));
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
    setVisible(Math.min(visible + MARKET_PAGE_SIZE, total));
  }

  return (
    <>
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        {head}
        <tbody ref={tbody}>{rows.slice(0, visible)}</tbody>
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
