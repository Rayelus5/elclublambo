import { LocalClock } from "@/components/market/local-clock";

/** When the figures are from (in the viewer's time zone), whether the last refresh failed, and the mandatory CoinGecko attribution. */
export function MarketStatus({ fetchedAt, stale }: { fetchedAt: string; stale: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-fg-muted">
      {stale ? (
        <p role="status" className="font-bold text-warning">
          No se pudo actualizar. Datos de las <LocalClock iso={fetchedAt} />.
        </p>
      ) : (
        <p>
          Actualizado a las <LocalClock iso={fetchedAt} />
        </p>
      )}
      <a
        href="https://www.coingecko.com"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center rounded-control underline underline-offset-4 outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        Datos de CoinGecko
      </a>
    </div>
  );
}
