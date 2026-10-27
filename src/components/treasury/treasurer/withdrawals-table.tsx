"use client";

// The treasurer's lists of withdrawal requests (cards, not a table: no horizontal scroll at 375 px; on md+ the actions
// sit beside the details). Three kinds share one component: pending, approved (unpaid or awaiting finality) and recent
// (closed in the last 30 days). Dialogs live here, not in the rows: an approval moves the row to another list on refresh
// and its success message must stay on screen.
import { useId, useState } from "react";
import { Check, Copy, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { shortAddress } from "@/lib/auth/wallet";
import { legacyExplorerTx, type LegacyChainId } from "@/lib/legacy/linea";
import { formatBps, formatUsd, formatUsdc } from "@/lib/treasury/format";
import { formatDay, formatWhen, payoutRecorded } from "@/lib/treasury/panel";
import { withdrawalLabel, type TreasuryWithdrawal } from "@/lib/treasury/withdrawals";
import { ApproveDialog } from "./approve-dialog";
import { MarkPaidDialog } from "./mark-paid-dialog";
import { RejectDialog } from "./reject-dialog";

export type WithdrawalsKind = "pending" | "approved" | "recent";

const EMPTY: Record<WithdrawalsKind, string> = {
  pending: "No hay retiradas pendientes.",
  approved: "No hay retiradas aprobadas pendientes de pago.",
  recent: "Aún no hay retiradas cerradas en los últimos 30 días.",
};

const badgeClass = "inline-flex items-center rounded-control border px-2 py-0.5 text-[13px] font-bold";
const linkClass =
  "inline-flex min-h-11 items-center rounded-control text-sm font-bold text-accent underline underline-offset-4 outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

const labelOf = (w: TreasuryWithdrawal) =>
  withdrawalLabel({ status: w.status, payoutRecorded: payoutRecorded(w), lastExpiredAt: w.lastExpiredAt });

/** The share of the member's position the request covers, in basis points (capped at 100 %). */
function positionBps(w: TreasuryWithdrawal): number | null {
  if (w.positionShares <= 0n) return null;
  const bps = (w.shares * 10_000n) / w.positionShares;
  return Number(bps > 10_000n ? 10_000n : bps);
}

export function WithdrawalsTable({
  kind,
  rows,
  meId,
  bannedIds,
  chainId,
}: {
  kind: WithdrawalsKind;
  rows: TreasuryWithdrawal[];
  /** The viewer's member id, to tell their own request. */
  meId: string | null;
  /** Members banned after requesting (ruling F4c-R2: they can still be approved and paid). */
  bannedIds: string[];
  /** For the explorer link of a paid request. */
  chainId?: LegacyChainId;
}) {
  const [active, setActive] = useState<{
    id: string;
    action: "approve" | "reject" | "paid";
    approved: boolean;
    banned: boolean;
    unexplainedOutflow: boolean;
  } | null>(null);
  const idBase = useId();
  const close = (open: boolean) => {
    if (!open) setActive(null);
  };

  return (
    <>
      {rows.length === 0 ? (
        <p className="text-fg-muted">{EMPTY[kind]}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {rows.map((w) => (
            <Row
              key={w.id}
              w={w}
              kind={kind}
              labelId={`${idBase}-${w.id}`}
              own={meId !== null && w.memberId === meId}
              banned={bannedIds.includes(w.memberId)}
              chainId={chainId}
              onAction={(action) =>
                setActive({
                  id: w.id,
                  action,
                  approved: w.status === "approved",
                  banned: bannedIds.includes(w.memberId),
                  unexplainedOutflow: w.unexplainedOutflow,
                })
              }
            />
          ))}
        </ul>
      )}
      {active?.action === "approve" ? <ApproveDialog key={active.id} requestId={active.id} banned={active.banned} open onOpenChange={close} /> : null}
      {active?.action === "reject" ? (
        <RejectDialog
          key={active.id}
          requestId={active.id}
          approved={active.approved}
          unexplainedOutflow={active.unexplainedOutflow}
          open
          onOpenChange={close}
        />
      ) : null}
      {active?.action === "paid" ? <MarkPaidDialog key={active.id} requestId={active.id} open onOpenChange={close} /> : null}
    </>
  );
}

function Row({
  w,
  kind,
  labelId,
  own,
  banned,
  chainId,
  onAction,
}: {
  w: TreasuryWithdrawal;
  kind: WithdrawalsKind;
  labelId: string;
  own: boolean;
  banned: boolean;
  chainId?: LegacyChainId;
  onAction: (a: "approve" | "reject" | "paid") => void;
}) {
  const recorded = payoutRecorded(w);
  const bps = positionBps(w);
  return (
    <li className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 md:flex-row md:items-start md:justify-between">
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span id={labelId} className="text-sm font-bold break-words text-fg">
            {w.memberLabel}
          </span>
          {own ? <span className={`${badgeClass} border-accent text-accent`}>Tu solicitud</span> : null}
          {banned ? <span className={`${badgeClass} border-warning text-warning`}>Miembro baneado</span> : null}
          {w.selfApproved ? <span className={`${badgeClass} border-warning text-warning`}>Autoaprobada</span> : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-1 text-[13px] text-fg-muted">
          <span className="font-mono">{shortAddress(w.wallet)}</span>
          <CopyWallet address={w.wallet} who={w.memberLabel} />
        </div>

        {kind === "pending" ? (
          <>
            <p className="text-sm text-fg">
              {bps !== null ? <span>{`${formatBps(bps)} de su posición`}</span> : null}
              {bps !== null && w.estimateUsd6 !== null ? <span aria-hidden> · </span> : null}
              {w.estimateUsd6 !== null ? <span className="text-fg-muted">{`≈ ${formatUsd(w.estimateUsd6)}`}</span> : null}
            </p>
            {w.lastExpiredAt ? <p className="text-[13px] font-bold text-warning">{labelOf(w)}</p> : null}
            <p className="text-[13px] text-fg-muted">{`Solicitada el ${formatWhen(w.createdAt)}`}</p>
          </>
        ) : null}

        {kind === "approved" ? (
          <>
            {recorded ? (
              <>
                <p className="text-sm font-bold text-fg">{labelOf(w)}</p>
                {w.amountUsdc !== null ? <p className="text-[13px] text-fg-muted">{`Importe fijado: ${formatUsdc(w.amountUsdc)}`}</p> : null}
              </>
            ) : (
              <p className="text-sm font-bold text-fg">{`Aprobada · ${w.amountUsdc !== null ? formatUsdc(w.amountUsdc) : "—"}`}</p>
            )}
            <p className="text-[13px] text-fg-muted">
              {w.expiresAt ? `Caduca el ${formatDay(w.expiresAt)}` : null}
              {w.approvedByLabel ? `${w.expiresAt ? " · " : ""}Aprobada por ${w.approvedByLabel}` : null}
            </p>
          </>
        ) : null}

        {kind === "recent" ? <RecentDetails w={w} chainId={chainId} /> : null}
      </div>

      {kind === "pending" ? (
        <div className="flex flex-wrap gap-2 md:shrink-0">
          <Button size="sm" variant="outline" aria-describedby={labelId} onClick={() => onAction("approve")}>
            Aprobar
          </Button>
          <Button size="sm" variant="secondary" aria-describedby={labelId} onClick={() => onAction("reject")}>
            Rechazar
          </Button>
        </div>
      ) : null}
      {kind === "approved" ? (
        <div className="flex flex-col gap-2 md:shrink-0 md:items-end">
          <div className="flex flex-wrap gap-2">
            {!recorded ? (
              <Button size="sm" variant="outline" aria-describedby={labelId} onClick={() => onAction("paid")}>
                Marcar como pagada
              </Button>
            ) : null}
            {!recorded ? (
              <Button size="sm" variant="secondary" aria-describedby={labelId} disabled={w.payoutLinked} onClick={() => onAction("reject")}>
                Rechazar
              </Button>
            ) : null}
          </div>
          {!recorded && w.payoutLinked ? (
            <p className="flex max-w-xs items-start gap-1.5 text-[13px] text-warning">
              <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              Hay un pago detectado pendiente de verificar.
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function RecentDetails({ w, chainId }: { w: TreasuryWithdrawal; chainId?: LegacyChainId }) {
  const closedAt = w.paidAt ?? w.createdAt;
  // F4c minor #3: "≥ pays", so an overpayment is valid but lowers everyone else's NAV; the excess is shown.
  const overpaid =
    w.status === "paid" && w.payoutAmount !== null && w.amountUsdc !== null && w.payoutAmount > w.amountUsdc
      ? w.payoutAmount - w.amountUsdc
      : null;
  return (
    <>
      <p className="text-sm font-bold text-fg">
        {w.status === "paid" ? `${labelOf(w)} · ${formatUsdc(w.payoutAmount ?? w.amountUsdc ?? 0n)}` : labelOf(w)}
      </p>
      {overpaid !== null ? (
        <p className="flex items-start gap-1.5 text-[13px] font-bold text-warning">
          <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {`Pagado de más: ${formatUsdc(overpaid)}`}
        </p>
      ) : null}
      {w.status === "rejected" && w.rejectReason ? <p className="text-[13px] break-words text-fg-muted">{`Motivo: ${w.rejectReason}`}</p> : null}
      <p className="text-[13px] text-fg-muted">
        {w.status === "paid"
          ? `Pagada el ${formatWhen(closedAt)}`
          : w.status === "rejected" && w.rejectedAt
            ? `Rechazada el ${formatWhen(w.rejectedAt)}`
            : w.status === "cancelled" && w.cancelledAt
              ? `Cancelada el ${formatWhen(w.cancelledAt)}`
              : `Solicitada el ${formatWhen(w.createdAt)}`}
      </p>
      {w.status === "paid" && w.payoutTxHash && chainId ? (
        <a href={legacyExplorerTx(chainId, w.payoutTxHash)} target="_blank" rel="noopener noreferrer" className={`${linkClass} self-start`}>
          Ver el pago en el explorador
        </a>
      ) : null}
    </>
  );
}

function CopyWallet({ address, who }: { address: string; who: string }) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setState("copied");
    } catch {
      setState("error");
    }
    setTimeout(() => setState("idle"), 2000);
  }
  return (
    <>
      <Button type="button" size="icon-sm" variant="ghost" aria-label={`Copiar la wallet de ${who}`} onClick={copy}>
        {state === "copied" ? <Check aria-hidden /> : <Copy aria-hidden />}
      </Button>
      <span aria-live="polite" className="text-[13px] text-fg-muted">
        {state === "copied" ? "Copiada" : state === "error" ? "No se pudo copiar" : ""}
      </span>
    </>
  );
}
