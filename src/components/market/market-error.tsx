import Link from "next/link";

/** Clear error state when CoinGecko failed and there is no copy at all. */
export function MarketError({ message, retryHref }: { message: string; retryHref: string }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2 rounded-panel border border-border bg-surface p-4 sm:p-6">
      <p className="font-bold">{message}</p>
      <Link
        href={retryHref}
        className="inline-flex min-h-11 items-center rounded-control text-sm font-bold text-accent underline underline-offset-4 outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        Reintentar
      </Link>
    </div>
  );
}
