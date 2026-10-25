"use client";

import { clubPath } from "@/lib/club/paths";
import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Ban, CircleAlert, CircleCheck, CircleDot, Clock, Hourglass, ShieldX, Trophy, UserX, type LucideIcon } from "lucide-react";
import { NetworkLogo } from "@/components/economy/network-logo";
import { useOptionalEconomy } from "@/components/payments/economy-provider";
import { TipDialog, type TipRecipient } from "@/components/payments/tip-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { cancelBountyAction } from "@/lib/bounties/actions";
import type { BountyDetail, BountyStatus } from "@/lib/bounties/queries";
import { rpcErrorMessage } from "@/lib/errors";
import { formatAmount } from "@/lib/payments/amounts";
import { findInFlight } from "@/lib/payments/pending-sends";
import { cn } from "@/lib/utils";

const DAY_MS = 86_400_000;

function subscribeStorage(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

/** What the local ledger holds for this bounty: a signature still pending in the wallet, or nothing. */
function ledgerState(memberId: string, bountyId: string): "inflight" | null {
  return findInFlight(memberId, "bounty", bountyId) ? "inflight" : null;
}

const CHIP: Record<BountyStatus, { icon: LucideIcon; tone: string }> = {
  open: { icon: CircleDot, tone: "border-accent text-accent" },
  solution_marked: { icon: Clock, tone: "border-warning text-warning" },
  paid: { icon: CircleCheck, tone: "border-success text-success" },
  paid_late: { icon: CircleCheck, tone: "border-warning text-warning" },
  unpaid: { icon: CircleAlert, tone: "border-danger text-danger" },
  expired: { icon: Hourglass, tone: "border-border text-fg-muted" },
  cancelled: { icon: Ban, tone: "border-border text-fg-muted" },
  // payment impossible: neutral, never the danger tone of an unpaid mark (F3-R1)
  removed: { icon: ShieldX, tone: "border-border text-fg-muted" },
  solver_unavailable: { icon: UserX, tone: "border-border text-fg-muted" },
};

/** Exact chip copy per status; "solution_marked" counts the days left to pay (rounded up, at least one). */
export function statusLabel(bounty: Pick<BountyDetail, "status" | "payDeadline">, now: Date): string {
  switch (bounty.status) {
    case "open":
      return "Abierto";
    case "solution_marked": {
      const deadline = bounty.payDeadline ? Date.parse(bounty.payDeadline) : NaN;
      const days = Number.isNaN(deadline) ? 7 : Math.max(1, Math.ceil((deadline - now.getTime()) / DAY_MS));
      return days === 1 ? "Solución elegida · queda 1 día para pagar" : `Solución elegida · quedan ${days} días para pagar`;
    }
    case "paid":
      return "Pagado";
    case "paid_late":
      return "Pagado tarde";
    case "unpaid":
      return "Impagado";
    case "expired":
      return "Expirado";
    case "cancelled":
      return "Cancelado";
    case "removed":
      return "Retirado por moderación";
    case "solver_unavailable":
      return "Solucionador no disponible";
  }
}

/**
 * Header of a bounty message: amount, network, status and the author's actions. The description is the message body,
 * rendered by MessageItem right after this card. Payment goes through the tip dialog in bounty mode.
 */
export function BountyCard({
  messageId,
  channelId,
  bounty,
  isAuthor,
  solver,
  now,
  onChanged,
}: {
  messageId: string;
  channelId: string;
  bounty: BountyDetail;
  isAuthor: boolean;
  /** The solution's author: who gets paid. Null when unknown. */
  solver: TipRecipient | null;
  /** Injected by tests; defaults to the current time. */
  now?: Date;
  /** The bounty changed (cancelled): the list re-reads it. */
  onChanged?: () => void;
}) {
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  const chip = CHIP[bounty.status];
  const Icon = chip.icon;
  const canCancel = isAuthor && bounty.status === "open";
  // F3c-R7 / N1: a payment already under way (a signature waiting in the wallet) must stay reachable
  // whatever the status became (solver_unavailable...): the dialog shows the pending signature.
  // Paid bounties are excluded (the transfer could no longer be credited). The ledger lives in localStorage:
  // null on the server and during hydration, re-read on every render and on storage events.
  const economy = useOptionalEconomy();
  const memberId = economy?.memberId ?? null;
  const ongoing = useSyncExternalStore(
    subscribeStorage,
    () => (isAuthor && memberId ? ledgerState(memberId, messageId) : null),
    () => null,
  );
  const settled = bounty.status === "paid" || bounty.status === "paid_late";
  const canStart = bounty.status === "solution_marked" || bounty.status === "unpaid";
  const canPay = isAuthor && solver !== null && !settled && (canStart || ongoing !== null);

  const cancel = async () => {
    setCancelling(true);
    setCancelError(null);
    const res = await cancelBountyAction(messageId).catch(() => ({ ok: false as const, error: rpcErrorMessage("unknown") }));
    setCancelling(false);
    if (!res.ok) {
      setCancelError(res.error);
      return;
    }
    setConfirmCancel(false);
    onChanged?.();
  };

  return (
    <div className="flex w-full max-w-2xl flex-col gap-3 rounded-panel border border-border-strong bg-surface p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="inline-flex min-h-7 items-center gap-1.5 rounded-control border border-accent px-2 text-[13px] font-bold text-accent">
          <Trophy aria-hidden className="size-3.5" />
          Bounty
        </span>
        <NetworkLogo chainId={bounty.chainId} withName />
      </div>

      <p className="font-mono text-2xl font-bold break-all text-fg">{`${formatAmount(bounty.amount, bounty.token)} ${bounty.token}`}</p>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          data-testid="bounty-status"
          suppressHydrationWarning
          className={cn("inline-flex min-h-7 items-center gap-1.5 rounded-control border px-2 text-[13px] font-bold", chip.tone)}
        >
          <Icon aria-hidden className="size-3.5 shrink-0" />
          {statusLabel(bounty, now ?? new Date())}
        </span>
        {bounty.solutionMessageId ? (
          <Link
            href={clubPath(`/c/${channelId}?m=${bounty.solutionMessageId}&thread=${messageId}`)}
            className="inline-flex min-h-11 items-center rounded-control px-1 text-sm font-bold text-accent underline underline-offset-4 outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent"
          >
            Ver solución
          </Link>
        ) : null}
      </div>

      {canCancel || canPay ? (
        <div className="flex flex-wrap gap-2">
          {canPay ? (
            <Button type="button" onClick={() => setPaying(true)}>
              <Trophy aria-hidden />
              Pagar bounty
            </Button>
          ) : null}
          {canCancel ? (
            <Button type="button" variant="outline" onClick={() => setConfirmCancel(true)}>
              Cancelar bounty
            </Button>
          ) : null}
        </div>
      ) : null}

      {paying && solver ? (
        <TipDialog
          mode={{ kind: "bounty", bountyId: messageId, token: bounty.token, minAmount: bounty.amount, chainId: bounty.chainId, solverId: solver.id }}
          recipient={solver}
          open={paying}
          onOpenChange={(open) => {
            setPaying(open);
            // Closed after paying or after leaving a verification running: the card re-reads the bounty either way.
            if (!open) onChanged?.();
          }}
        />
      ) : null}

      <AlertDialog
        open={confirmCancel}
        onOpenChange={(open) => {
          if (cancelling) return;
          setConfirmCancel(open);
          if (!open) setCancelError(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cancelar este bounty?</AlertDialogTitle>
            <AlertDialogDescription>
              Quedará visible como cancelado y ya no se podrá marcar una solución ni pagarlo. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {cancelError ? (
            <p role="alert" className="text-sm text-danger">
              {cancelError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelling}>Volver</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={cancelling}
              onClick={(e) => {
                // Keep the dialog open until the server answers, so an error can be shown in it.
                e.preventDefault();
                void cancel();
              }}
            >
              Sí, cancelar bounty
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
