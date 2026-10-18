import type { ReactNode } from "react";
import { NetworkBadge } from "@/components/economy/network-badge";
import { Clock } from "lucide-react";
import { ShareRing } from "@/components/treasury/dao-charts";
import { explorerTx } from "@/lib/economy/networks";
import { finalityEta, formatEta } from "@/lib/treasury/eta";
import { formatBps, formatShares, formatUsdc } from "@/lib/treasury/format";
import type { DaoOverview as Data } from "@/lib/treasury/queries";

const linkClass =
  "inline-flex min-h-11 items-center rounded-control text-sm font-bold text-accent underline underline-offset-4 outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

const dateTime = (iso: string) =>
  new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(iso)) + " UTC";

/** The network's finality lag (null when unknown) and the render time, both in seconds. */
export type Finality = { lagSeconds: number | null; nowSeconds: number };

/** Fund value at market (with its chart), value per participación, donors and the viewer's own position on the active network. */
export function DaoOverview({
  data,
  donate,
  chart,
  finality,
}: {
  data: Data;
  donate: ReactNode;
  chart?: ReactNode;
  finality?: Finality;
}) {
  const pendingTotal = data.myPending.reduce((sum, p) => sum + p.amount, 0n);
  const etaText = (createdAt: string) =>
    finality?.lagSeconds != null
      ? formatEta(finalityEta(Date.parse(createdAt) / 1000, finality.lagSeconds, finality.nowSeconds))
      : null;
  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Tesorería" className="flex flex-col gap-4 rounded-panel border border-border bg-surface p-4 sm:p-6">
        <NetworkBadge chainId={data.chainId} className="self-start" />
        <dl className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <dt className="text-sm text-fg-muted">Valor del fondo</dt>
            <dd data-testid="dao-balance" className="font-display text-3xl font-black break-all text-fg">
              {formatUsdc(data.navUsd6)}
            </dd>
            {data.navAt ? (
              <dd className="text-[13px] text-fg-muted">
                A precio de mercado · <time dateTime={data.navAt}>{dateTime(data.navAt)}</time>
              </dd>
            ) : null}
          </div>
          <div>
            <dt className="text-sm text-fg-muted">Valor por participación</dt>
            <dd data-testid="dao-share-price" className="font-mono text-lg font-bold break-all text-fg">
              {data.sharePriceUsd6 > 0n ? formatUsdc(data.sharePriceUsd6) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-fg-muted">Donantes</dt>
            <dd data-testid="dao-donors" className="font-mono text-lg font-bold text-fg">
              {data.donors}
            </dd>
          </div>
        </dl>
        {pendingTotal > 0n ? (
          <p className="flex items-center gap-2 text-sm text-fg-muted">
            <Clock aria-hidden className="size-4 shrink-0" />
            {`+${formatUsdc(pendingTotal)} tuyos en camino`}
          </p>
        ) : null}
        {chart}
        {donate ? <div className="flex flex-wrap items-center gap-3">{donate}</div> : null}
      </section>

      <section aria-labelledby="my-position" className="flex flex-col gap-4 rounded-panel border border-border bg-surface p-4 sm:p-6">
        <h2 id="my-position" className="text-h2">
          Tu participación
        </h2>
        <p data-testid="my-value" className="text-fg">
          <span className="text-fg-muted">Tu parte: </span>
          <strong className="font-display text-2xl font-black break-all">{formatUsdc(data.myValueUsd6)}</strong>
        </p>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <ShareRing bps={data.myShareBps} />
          <dl className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-sm text-fg-muted">De la DAO</dt>
              <dd data-testid="my-share" className="font-mono text-lg font-bold text-fg">
                {formatBps(data.myShareBps)}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-fg-muted">Participaciones</dt>
              <dd data-testid="my-shares" className="font-mono text-lg font-bold text-fg">
                {formatShares(data.myShares)}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-fg-muted">Aportado</dt>
              <dd data-testid="my-net" className="font-mono text-lg font-bold text-fg">
                {formatUsdc(data.myNet)}
              </dd>
            </div>
          </dl>
        </div>

        {data.myPending.length > 0 ? (
          <ul aria-label="Donaciones pendientes" className="flex flex-col divide-y divide-border border-t border-border">
            {data.myPending.map((p) => (
              <li key={p.ledgerId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-1">
                <div className="flex flex-col">
                  <span className="font-mono text-sm font-bold text-fg">{formatUsdc(p.amount)}</span>
                  <span className="text-[13px] text-fg-muted">{dateTime(p.createdAt)}</span>
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="self-start rounded-control border border-success px-2 py-0.5 text-[13px] text-success">Confirmada en la red</span>
                  <span className="text-[13px] text-fg-muted">
                    {etaText(p.createdAt)
                      ? `Tus participaciones se acreditan ${etaText(p.createdAt)}, cuando Linea finalice el bloque.`
                      : "Tus participaciones se acreditan cuando Linea finalice el bloque (puede tardar unas horas)."}
                  </span>
                </div>
                <a
                  href={explorerTx(data.chainId, p.txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Ver en el explorador: donación pendiente"
                  className={linkClass}
                >
                  Ver en el explorador
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
