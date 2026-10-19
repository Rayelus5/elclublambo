"use client";

// The treasurer's raffles (cards, not a table: no horizontal scroll at 375 px; on md+ the actions sit beside the
// details). Dialogs live here, not in the rows: a refresh changes the row and the success message must stay on screen.
import { useId, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyHashButton } from "@/components/treasury/raffles/copy-hash-button";
import { explorerTx, type ChainId } from "@/lib/economy/networks";
import { formatWhen } from "@/lib/treasury/panel";
import { formatPrize, raffleStatusLabel, type TreasuryRaffle } from "@/lib/treasury/raffles";
import { CancelRaffleDialog } from "./cancel-raffle-dialog";
import { MarkRafflePaidDialog } from "./mark-raffle-paid-dialog";

const badgeClass = "inline-flex items-center rounded-control border px-2 py-0.5 text-[13px] font-bold";
const linkClass =
  "inline-flex min-h-11 items-center rounded-control text-sm font-bold text-accent underline underline-offset-4 outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

const recorded = (r: TreasuryRaffle) => r.payoutRecordedAt !== null || r.payoutTxHash !== null;
const labelOf = (r: TreasuryRaffle) => raffleStatusLabel({ status: r.status, payoutRecorded: recorded(r), unpaid: r.unpaid, paidLate: false });

export function RafflesTable({ rows, bannedIds, chainId }: { rows: TreasuryRaffle[]; bannedIds: string[]; chainId: ChainId }) {
  const [active, setActive] = useState<{ id: string; action: "cancel" | "paid" } | null>(null);
  const idBase = useId();
  const target = active ? (rows.find((r) => r.id === active.id) ?? null) : null;
  const close = (open: boolean) => {
    if (!open) setActive(null);
  };

  if (rows.length === 0) return <p className="text-fg-muted">No hay sorteos activos ni recientes.</p>;
  return (
    <>
      <ul className="flex flex-col divide-y divide-border">
        {rows.map((r) => (
          <Row
            key={r.id}
            r={r}
            labelId={`${idBase}-${r.id}`}
            banned={r.winnerMemberId !== null && bannedIds.includes(r.winnerMemberId)}
            chainId={chainId}
            onAction={(action) => setActive({ id: r.id, action })}
          />
        ))}
      </ul>
      {target && active?.action === "cancel" ? <CancelRaffleDialog key={target.id} raffle={target} open onOpenChange={close} /> : null}
      {target && active?.action === "paid" ? <MarkRafflePaidDialog key={target.id} raffle={target} open onOpenChange={close} /> : null}
    </>
  );
}

function Row({
  r,
  labelId,
  banned,
  chainId,
  onAction,
}: {
  r: TreasuryRaffle;
  labelId: string;
  banned: boolean;
  chainId: ChainId;
  onAction: (a: "cancel" | "paid") => void;
}) {
  const canCancel = r.status === "open" || r.status === "closed";
  const canMarkPaid = r.status === "drawn" && !recorded(r);
  const hasWinner = r.status === "drawn" || r.status === "paid";
  return (
    <li className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 md:flex-row md:items-start md:justify-between">
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span id={labelId} className="text-sm font-bold break-words text-fg">
            {r.title}
          </span>
          {r.unpaid && !recorded(r) ? <span className={`${badgeClass} border-warning text-warning`}>Impagado</span> : null}
          {banned ? <span className={`${badgeClass} border-warning text-warning`}>Miembro baneado</span> : null}
        </div>
        <p className="text-sm font-bold text-fg">{labelOf(r)}</p>
        <p className="text-[13px] text-fg-muted">
          {`Premio: ${formatPrize(r.prizeAmount, r.prizeToken)}`}
          <span aria-hidden> · </span>
          {`Cierre: ${formatWhen(r.closesAt)}`}
        </p>
        <p className="text-[13px] text-fg-muted">
          <span>{`Participantes: ${r.entries}`}</span>
          <span aria-hidden> · </span>
          <span>{r.mode === "weighted" ? "Ponderado por participación" : "Igualitario"}</span>
        </p>

        {hasWinner && r.winnerLabel ? (
          <div className="flex flex-col gap-1">
            <p className="text-sm text-fg">{`Ganador: ${r.winnerLabel}`}</p>
            {r.winnerAddress ? (
              <div className="flex flex-wrap items-center gap-x-1 text-[13px] text-fg-muted">
                <span>Wallet:</span>
                <span className="font-mono break-all">{r.winnerAddress}</span>
                <CopyHashButton value={r.winnerAddress} label={`Copiar la wallet de ${r.winnerLabel}`} />
              </div>
            ) : null}
          </div>
        ) : null}
        {r.status === "cancelled" && r.cancelReason ? <p className="text-[13px] break-words text-fg-muted">{`Motivo: ${r.cancelReason}`}</p> : null}
        {r.status === "paid" && r.payoutTxHash ? (
          <a href={explorerTx(chainId, r.payoutTxHash)} target="_blank" rel="noopener noreferrer" className={`${linkClass} self-start`}>
            Ver el pago en el explorador
          </a>
        ) : null}
        {banned ? (
          <p className="flex max-w-md items-start gap-1.5 text-[13px] text-warning">
            <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            El ganador fue baneado después del sorteo. El premio sigue siendo suyo.
          </p>
        ) : null}
      </div>

      {canCancel || canMarkPaid ? (
        <div className="flex flex-wrap gap-2 md:shrink-0">
          {canMarkPaid ? (
            <Button size="sm" aria-describedby={labelId} onClick={() => onAction("paid")}>
              Marcar como pagado
            </Button>
          ) : null}
          {canCancel ? (
            <Button size="sm" variant="secondary" aria-describedby={labelId} onClick={() => onAction("cancel")}>
              Cancelar sorteo
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
