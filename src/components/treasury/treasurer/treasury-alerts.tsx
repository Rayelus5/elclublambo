import { AlertTriangle, CircleCheck } from "lucide-react";
import { shortAddress } from "@/lib/auth/wallet";
import { formatToken, formatUsdc } from "@/lib/treasury/format";
import { drawRefusalText, formatWhen, type TreasuryAlertsData } from "@/lib/treasury/panel";

const linkClass =
  "inline-flex min-h-11 items-center rounded-control text-sm font-bold text-accent underline underline-offset-4 outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

/** «Avisos»: what the treasurer should act on. Each line has an icon and text, never colour alone. */
export function TreasuryAlerts({ alerts }: { alerts: TreasuryAlertsData }) {
  const none =
    alerts.expiring.length === 0 &&
    alerts.underfunded === null &&
    alerts.unexplained === 0 &&
    alerts.unpaidRaffles.length === 0 &&
    alerts.prizeUnderfunded.length === 0 &&
    alerts.refusedDraws.length === 0 &&
    alerts.paused.length === 0 &&
    alerts.scanStuck === null;
  if (none) {
    return (
      <p className="flex items-center gap-2 text-sm text-fg-muted">
        <CircleCheck aria-hidden className="size-4 shrink-0" />
        Sin avisos.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {alerts.scanStuck ? (
        <li className="flex flex-col gap-0.5 text-sm">
          <span className="flex items-start gap-2 font-bold text-danger">
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
            El escaneo de la Safe está atascado
          </span>
          <span className="pl-6 text-[13px] text-fg-muted">
            {`${alerts.scanStuck.runs === 1 ? "1 pasada" : `${alerts.scanStuck.runs} pasadas seguidas`} desde el ${formatWhen(alerts.scanStuck.since)}: el nodo no devolvió todos los movimientos de la Safe, así que el foro no avanza. Mientras tanto las donaciones esperan para acreditarse y las aprobaciones pueden fallar. Revisa el nodo RPC de Linea que usa el servidor.`}
          </span>
        </li>
      ) : null}
      {alerts.paused.map((p) => (
        <li key={`paused-${p.id}`} className="flex flex-col gap-0.5 text-sm">
          <span className="flex items-start gap-2 font-bold text-danger">
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span className="break-words">
              {`Créditos en pausa: hay una salida sin explicar a ${shortAddress(p.destination)} mientras ${p.kind === "withdrawal" ? `la retirada de ${p.who}` : `el premio de «${p.who}»`} sigue pendiente de pago`}
            </span>
          </span>
          <span className="pl-6 text-[13px] text-fg-muted">
            Las donaciones, las aprobaciones y la valoración esperan. Si fue un pago parcial o repartido, pide que lo devuelva o completa el pago con
            una sola transferencia de al menos el importe y añade una nota a las salidas parciales. Si la salida no tiene que ver, añádele una nota.
            Si una sola transferencia pagó dos cosas, ya está enlazada a la otra: añádele la nota en «Operaciones» de la DAO.
          </span>
          <a href="#sin-explicar" className={`${linkClass} self-start pl-6`}>
            Ver las salidas sin explicar
          </a>
        </li>
      ))}
      {alerts.expiring.map((e) => (
        <li key={e.id} className="flex flex-col gap-0.5 text-sm">
          <span className="flex items-start gap-2 font-bold text-warning">
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span className="break-words">{`Caduca pronto: ${e.label} · ${formatUsdc(e.amountUsdc)}`}</span>
          </span>
          <span className="pl-6 text-[13px] text-fg-muted">{`Caduca el ${formatWhen(e.expiresAt)}`}</span>
        </li>
      ))}
      {alerts.underfunded ? (
        <li className="flex flex-col gap-0.5 text-sm">
          <span className="flex items-start gap-2 font-bold text-warning">
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
            Pagos aprobados sin USDC suficiente en la Safe
          </span>
          <span className="pl-6 text-[13px] text-fg-muted">
            {`Aprobado sin pagar: ${formatUsdc(alerts.underfunded.reserved)}. En la Safe: ${formatUsdc(alerts.underfunded.safeUsdc)}.`}
          </span>
        </li>
      ) : null}
      {alerts.unpaidRaffles.map((r) => (
        <li key={r.id} className="flex items-start gap-2 text-sm">
          <AlertTriangle aria-hidden className="mt-3 size-4 shrink-0 text-warning" />
          <a href="#sorteos" className={`${linkClass} break-words`}>{`Premio impagado: ${r.title} · ${r.prize}`}</a>
        </li>
      ))}
      {alerts.refusedDraws.map((r) => (
        <li key={`refused-${r.id}`} className="flex flex-col gap-0.5 text-sm">
          <span className="flex items-start gap-2">
            <AlertTriangle aria-hidden className="mt-3 size-4 shrink-0 text-warning" />
            <a href="#sorteos" className={`${linkClass} break-words`}>{`No se pudo hacer el sorteo: ${r.title}`}</a>
          </span>
          <span className="pl-6 text-[13px] text-fg-muted">
            {`${drawRefusalText(r.code)} El cron lo reintenta cada hora; si no se resuelve, cancélalo.`}
          </span>
        </li>
      ))}
      {alerts.prizeUnderfunded.map((p) => (
        <li key={p.token} className="flex flex-col gap-0.5 text-sm">
          <span className="flex items-start gap-2 font-bold text-warning">
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
            {`Premios en ${p.token} sin saldo suficiente en la Safe`}
          </span>
          <span className="pl-6 text-[13px] text-fg-muted">
            {`Por pagar: ${formatToken(p.reserved, p.token)}. En la Safe: ${formatToken(p.safe, p.token)}.`}
          </span>
        </li>
      ))}
      {alerts.unexplained > 0 ? (
        <li className="flex items-start gap-2 text-sm">
          <AlertTriangle aria-hidden className="mt-3 size-4 shrink-0 text-warning" />
          <a href="#sin-explicar" className={linkClass}>
            {alerts.unexplained === 1 ? "1 salida sin explicar" : `${alerts.unexplained} salidas sin explicar`}
          </a>
        </li>
      ) : null}
    </ul>
  );
}
