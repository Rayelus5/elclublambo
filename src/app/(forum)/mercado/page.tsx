import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { MarketStatus } from "@/components/market/market-status";
import { MarketTable } from "@/components/market/market-table";
import { getTopMarkets } from "@/lib/market/cache";
import { MarketUnavailableError, type Cached, type MarketCoin } from "@/lib/market/types";

export const metadata: Metadata = { title: "Mercado" };

// Reads the network/DB (dynamic): with cacheComponents it must live inside a Suspense.
async function MarketContent() {
  let markets: Cached<MarketCoin[]>;
  try {
    markets = await getTopMarkets();
  } catch (e) {
    // Only the "no usable copy" case is a UI state; anything else is a real bug and surfaces.
    if (!(e instanceof MarketUnavailableError)) throw e;
    return (
      <div role="alert" className="flex flex-col items-start gap-2 rounded-panel border border-border bg-surface p-4 sm:p-6">
        <p className="font-bold">No se pudieron cargar los precios ahora mismo.</p>
        <Link
          href="/mercado"
          className="inline-flex min-h-11 items-center rounded-control text-sm font-bold text-accent underline underline-offset-4 outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          Reintentar
        </Link>
      </div>
    );
  }
  return (
    <>
      <MarketStatus fetchedAt={markets.fetchedAt} stale={markets.stale} />
      <MarketTable coins={markets.data} />
    </>
  );
}

function MarketSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-2">
      <p role="status" className="sr-only">
        Cargando precios…
      </p>
      <div aria-hidden className="h-96 w-full rounded-panel border border-border bg-surface" />
    </div>
  );
}

export default function MercadoPage() {
  return (
    <div className="flex w-full flex-col gap-4">
      <header className="flex flex-col gap-2">
        <h1 className="text-h1">Mercado</h1>
        <p className="text-fg-muted">Precios de referencia; no son consejo de inversión.</p>
      </header>
      <Suspense fallback={<MarketSkeleton />}>
        <MarketContent />
      </Suspense>
    </div>
  );
}
