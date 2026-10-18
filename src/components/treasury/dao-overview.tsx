import type { ReactNode } from "react";
import { NetworkBadge } from "@/components/economy/network-badge";
import { explorerTx } from "@/lib/economy/networks";
import { formatBps, formatShares, formatUsdc } from "@/lib/treasury/format";
import type { DaoOverview as Data } from "@/lib/treasury/queries";

const linkClass =
  "inline-flex min-h-11 items-center rounded-control text-sm font-bold text-accent underline underline-offset-4 outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

const dateTime = (iso: string) =>
  new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(iso)) + " UTC";

/** Balance, donors and the viewer's own position on the active network. Text and tables only: no charts. */
export function DaoOverview({ data, donate }: { data: Data; donate: ReactNode }) {
  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Tesorería" className="flex flex-col gap-4 rounded-panel border border-border bg-surface p-4 sm:p-6">
        <NetworkBadge chainId={data.chainId} className="self-start" />
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-fg-muted">Balance de la tesorería</dt>
            <dd data-testid="dao-balance" className="font-display text-3xl font-black text-fg">
              {formatUsdc(data.valueUsdc)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-fg-muted">Donantes</dt>
            <dd data-testid="dao-donors" className="font-display text-3xl font-black text-fg">
              {data.donors}
            </dd>
          </div>
        </dl>
        {donate ? <div className="flex flex-wrap items-center gap-3">{donate}</div> : null}
      </section>

      <section aria-labelledby="my-position" className="flex flex-col gap-4 rounded-panel border border-border bg-surface p-4 sm:p-6">
        <h2 id="my-position" className="text-h2">
          Tu participación
        </h2>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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

        {data.myPending.length > 0 ? (
          <ul aria-label="Donaciones pendientes" className="flex flex-col divide-y divide-border border-t border-border">
            {data.myPending.map((p) => (
              <li key={p.ledgerId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-1">
                <div className="flex flex-col">
                  <span className="font-mono text-sm font-bold text-fg">{formatUsdc(p.amount)}</span>
                  <span className="text-[13px] text-fg-muted">{dateTime(p.createdAt)}</span>
                </div>
                <span className="rounded-control border border-warning px-2 py-1 text-[13px] text-warning">Pendiente de finalización</span>
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
