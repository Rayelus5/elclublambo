"use client";

import { useId, useState, useTransition } from "react";
import { Ban } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { shortAddress } from "@/lib/auth/wallet";
import { rpcErrorMessage } from "@/lib/errors";
import { banMemberAction } from "@/lib/moderation/actions";
import type { MemberSummary } from "./sponsor-tree";

const MIN = 3;
const MAX = 500;

const nameOf = (m: MemberSummary) => m.displayName ?? shortAddress(m.walletAddress);

export function BanDialog({
  member,
  sponsor,
  sponsorIsAdmin = false,
  onBanned,
}: {
  member: MemberSummary;
  sponsor: MemberSummary | null;
  /** Admins are never penalized (SQL skips it), so the option is hidden for them. */
  sponsorIsAdmin?: boolean;
  onBanned?: (member: MemberSummary) => void;
}) {
  const uid = useId();
  const reasonId = `${uid}-reason`;
  const sponsorId = `${uid}-sponsor`;
  const errorId = `${uid}-error`;
  const canPenalize = sponsor !== null && sponsor.status === "active" && !sponsorIsAdmin;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [penalize, setPenalize] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [pending, startTransition] = useTransition();

  function onOpenChange(next: boolean) {
    if (pending) return;
    setOpen(next);
    if (!next) {
      setReason("");
      setPenalize(false);
      setError(null);
      setInvalid(false);
    }
  }

  function submit() {
    const trimmed = reason.trim();
    if (trimmed.length < MIN || trimmed.length > MAX) {
      setError(`Escribe un motivo de entre ${MIN} y ${MAX} caracteres.`);
      setInvalid(true);
      return;
    }
    setError(null);
    setInvalid(false);
    startTransition(async () => {
      const res = await banMemberAction({
        memberId: member.id,
        reason: trimmed,
        penalizeSponsor: canPenalize && penalize,
      });
      if (res.error) {
        setError(rpcErrorMessage(res.error));
        return;
      }
      setOpen(false);
      setReason("");
      setPenalize(false);
      onBanned?.(member);
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          aria-label={`Banear a ${nameOf(member)}`}
          className="border-danger text-danger"
        >
          <Ban aria-hidden />
          Banear
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="data-[size=default]:max-w-md data-[size=default]:sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Banear a {nameOf(member)}</AlertDialogTitle>
          <AlertDialogDescription>
            Perderá el acceso al foro y sus invitaciones activas se anularán. Esta acción queda registrada.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor={reasonId}>Motivo</Label>
          <textarea
            id={reasonId}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={MAX}
            rows={3}
            disabled={pending}
            aria-required="true"
            aria-invalid={invalid}
            aria-describedby={invalid && error ? `${reasonId}-count ${errorId}` : `${reasonId}-count`}
            className="min-h-24 w-full resize-y border border-border-strong bg-surface px-3 py-2 text-sm text-fg rounded-control outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-50"
          />
          <p id={`${reasonId}-count`} className="text-right text-[13px] text-fg-muted">
            {reason.length}/{MAX}
          </p>
        </div>

        {canPenalize && sponsor ? (
          <div className="flex items-start gap-3">
            <Checkbox
              id={sponsorId}
              checked={penalize}
              onCheckedChange={(v) => setPenalize(v === true)}
              disabled={pending}
              className="mt-0.5"
            />
            <Label htmlFor={sponsorId} className="items-start text-sm leading-snug font-normal">
              Penalizar también a {nameOf(sponsor)}: pierde el permiso de invitar y se anulan sus invitaciones
              activas
            </Label>
          </div>
        ) : null}

        {error ? (
          <p id={errorId} role="alert" className="border border-danger px-3 py-2 text-[13px] text-danger rounded-control">
            {error}
          </p>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={(e) => {
              // Keep the dialog open until the action resolves (or fails).
              e.preventDefault();
              submit();
            }}
          >
            {pending ? "Baneando…" : "Banear"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
