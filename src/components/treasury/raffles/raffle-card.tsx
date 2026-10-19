import Link from "next/link";
import { Info, TriangleAlert } from "lucide-react";
import { CopyHashButton } from "@/components/treasury/raffles/copy-hash-button";
import { JoinRaffleButton } from "@/components/treasury/raffles/join-raffle-button";
import { COMMIT_HELP, WEIGHTS_NOTE, WETH_NOTE } from "@/components/treasury/raffles/raffle-notes";
import { formatParticipaciones } from "@/lib/treasury/format";
import { formatWhen } from "@/lib/treasury/panel";
import { formatPrize, raffleStatusLabel, type RaffleCard as Card } from "@/lib/treasury/raffles";

const MODE_LABEL = { equal: "Igualitario", weighted: "Ponderado por participación" } as const;

/**
 * One raffle on /dao. `unlockedShares` is the viewer's participaciones not locked by a withdrawal (weighted raffles
 * weigh those); omitted when unknown.
 */
export function RaffleCard({ raffle: r, unlockedShares }: { raffle: Card; unlockedShares?: bigint }) {
  const label = raffleStatusLabel(r);
  const open = r.status === "open";
  const closed = r.status === "closed";
  const hasWinner = r.status === "drawn" || r.status === "paid";
  const unpaidShown = r.status === "drawn" && r.unpaid && !r.payoutRecorded;
  const weighted = r.mode === "weighted";

  return (
    <article className="flex flex-col gap-3 rounded-panel border border-border bg-surface-2 p-4">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <h4 className="min-w-0 text-base font-bold break-words">{r.title}</h4>
        <span
          className={`inline-flex items-center gap-1.5 rounded-control border px-2 py-1 text-[13px] font-bold ${
            unpaidShown ? "border-warning text-warning" : "border-border-strong text-fg"
          }`}
        >
          {unpaidShown ? <TriangleAlert aria-hidden className="size-4 shrink-0" /> : null}
          <span>{label}</span>
        </span>
      </header>

      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <li>{`Premio: ${formatPrize(r.prizeAmount, r.prizeToken)}`}</li>
        <li>{`${open ? "Cierra" : "Cerró"} el ${formatWhen(r.closesAt)}`}</li>
        <li>{MODE_LABEL[r.mode]}</li>
        <li>{`Participantes: ${r.entries}`}</li>
      </ul>

      {r.prizeToken === "WETH" ? <p className="text-[13px] text-fg-muted">{WETH_NOTE}</p> : null}

      {weighted && (open || closed) ? <p className="text-[13px] text-fg-muted">{WEIGHTS_NOTE}</p> : null}
      {weighted && open && unlockedShares === 0n ? (
        <p className="flex items-start gap-2 text-sm text-warning">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            En este sorteo pesan tus participaciones sin bloquear al cerrar. Ahora no tienes: puedes apuntarte, pero pesarías 0 y no podrías ganar.
          </span>
        </p>
      ) : null}
      {weighted && r.myWeight !== null && r.totalWeight !== null ? (
        <p className="text-sm">{`Tu peso: ${formatParticipaciones(r.myWeight)} de ${formatParticipaciones(r.totalWeight)}`}</p>
      ) : null}

      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="min-w-0 font-mono text-[13px] break-all">{`Compromiso: ${r.commit}`}</span>
          <CopyHashButton value={r.commit} label="Copiar compromiso" />
        </div>
        <p className="text-[13px] text-fg-muted">{COMMIT_HELP}</p>
      </div>

      {closed ? (
        <p className="text-sm text-fg-muted">El ganador sale cuando la red finaliza el primer bloque posterior al cierre (puede tardar unas horas).</p>
      ) : null}

      {hasWinner ? (
        <div className="flex flex-col gap-1 text-sm">
          <p className="font-bold">{`Ganador: ${r.winnerLabel ?? "Anónimo"}`}</p>
          {r.iWon ? <p className="font-bold text-success">¡Has ganado!</p> : null}
        </div>
      ) : null}
      {r.seedReveal ? <p className="font-mono text-[13px] break-all">{`Semilla: ${r.seedReveal}`}</p> : null}
      {r.drawBlockNumber !== null ? <p className="font-mono text-[13px]">{`Bloque: ${r.drawBlockNumber}`}</p> : null}

      {r.status === "void" ? <p className="text-sm">Sin ganador: nadie con peso se apuntó.</p> : null}
      {r.status === "cancelled" ? <p className="text-sm">{`Cancelado: ${r.cancelReason ?? "sin motivo"}`}</p> : null}

      {open ? <JoinRaffleButton id={r.id} entered={r.iEntered} disabled={!open} closesAt={r.closesAt} /> : null}

      <Link
        href={`/dao/sorteos/${r.id}`}
        className="inline-flex min-h-11 items-center self-start rounded-control text-sm font-bold text-accent underline underline-offset-4 outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        Ver participantes y cómo comprobarlo
      </Link>
    </article>
  );
}
