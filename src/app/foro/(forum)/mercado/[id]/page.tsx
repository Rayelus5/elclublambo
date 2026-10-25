import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { CoinFacts } from "@/components/market/coin-facts";
import { MarketError } from "@/components/market/market-error";
import { MarketStatus } from "@/components/market/market-status";
import { PriceChart } from "@/components/market/price-chart";
import { RangeTabs } from "@/components/market/range-tabs";
import { getChart, getCoin } from "@/lib/market/cache";
import { isCoinId } from "@/lib/market/coingecko";
import { parseRange } from "@/lib/market/format";
import {
  CoinNotFoundError,
  MarketUnavailableError,
  type Cached,
  type ChartPoint,
  type CoinDetail,
} from "@/lib/market/types";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Pick<Props, "params">): Promise<Metadata> {
  const { id } = await params;
  if (!isCoinId(id)) return { title: "Mercado" };
  try {
    return { title: (await getCoin(id)).data.name };
  } catch {
    return { title: "Mercado" };
  }
}

// Reads the network/DB (dynamic): with cacheComponents it must live inside a Suspense.
async function CoinContent({ id, searchParams }: { id: string; searchParams: Props["searchParams"] }) {
  const range = parseRange((await searchParams).r);
  const retryHref = `/mercado/${id}?r=${range}`;

  // Both reads start together; each outcome is handled separately below.
  const coinP = getCoin(id).then(
    (v) => ({ ok: true as const, v }),
    (e: unknown) => ({ ok: false as const, e }),
  );
  const chartP = getChart(id, range).then(
    (v) => ({ ok: true as const, v }),
    (e: unknown) => ({ ok: false as const, e }),
  );
  const [coinR, chartR] = await Promise.all([coinP, chartP]);

  if (!coinR.ok) {
    if (coinR.e instanceof CoinNotFoundError) notFound();
    // Only the "no usable copy" case is a UI state; anything else is a real bug and surfaces.
    if (!(coinR.e instanceof MarketUnavailableError)) throw coinR.e;
    return <MarketError message="No se pudieron cargar los datos de esta cripto ahora mismo." retryHref={retryHref} />;
  }
  const coin: Cached<CoinDetail> = coinR.v;

  let chart: Cached<ChartPoint[]> | null = null;
  if (chartR.ok) chart = chartR.v;
  else if (chartR.e instanceof CoinNotFoundError) notFound();
  else if (!(chartR.e instanceof MarketUnavailableError)) throw chartR.e;

  // The figures on screen are as old as the oldest of the two copies.
  const fetchedAt = chart && chart.fetchedAt < coin.fetchedAt ? chart.fetchedAt : coin.fetchedAt;
  const stale = coin.stale || (chart?.stale ?? false);
  const c = coin.data;

  return (
    <>
      <header className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- remote CoinGecko icon, host-checked in the client */}
        {c.image ? <img src={c.image} alt="" width={40} height={40} className="size-10 shrink-0 rounded-full" /> : null}
        <div className="flex min-w-0 flex-col">
          <h1 className="text-h1 break-words">
            {c.name}{" "}
            {/* Untrusted length: capped and truncated (inline-block so it sits on the name's line when it fits). */}
            <span className="inline-block max-w-[10ch] truncate align-bottom text-fg-muted uppercase" title={c.symbol.toUpperCase()}>
              {c.symbol}
            </span>
          </h1>
          {c.rank !== null ? <p className="text-[13px] text-fg-muted">Puesto #{c.rank} por capitalización</p> : null}
        </div>
      </header>
      <RangeTabs id={id} active={range} />
      {chart ? (
        <PriceChart name={c.name} range={range} points={chart.data} />
      ) : (
        <MarketError message="No se pudo cargar el gráfico ahora mismo." retryHref={retryHref} />
      )}
      <CoinFacts coin={c} />
      <MarketStatus fetchedAt={fetchedAt} stale={stale || chart === null} />
    </>
  );
}

function CoinSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-2">
      <p role="status" className="sr-only">
        Cargando datos…
      </p>
      <div aria-hidden className="h-72 w-full rounded-panel border border-border bg-surface" />
    </div>
  );
}

export default async function CoinPage({ params, searchParams }: Props) {
  const { id } = await params;
  // Hostile ids (../, uppercase, 200 chars) never reach the API.
  if (!isCoinId(id)) notFound();
  return (
    <div className="flex w-full flex-col gap-4">
      <Link
        href="/mercado"
        className="inline-flex min-h-11 items-center gap-1 self-start rounded-control text-sm font-bold text-fg-muted outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Mercado
      </Link>
      <Suspense fallback={<CoinSkeleton />}>
        <CoinContent id={id} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
