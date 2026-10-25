"use client";

import { Send } from "lucide-react";
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
import type { Dictionary } from "@/lib/i18n";
import { fill } from "@/lib/i18n/fill";

/**
 * The explicit step before any signature (P6-R8): «Vas a enviar {total} USDC a {n} direcciones en {red}. Cada envío es
 * definitivo.», «Confirmar y firmar» and «Volver». A Radix alert dialog: focus is trapped inside, starts on «Volver»
 * (the safe choice), Esc closes it, and focus goes back to the button that opened it.
 */
export function ConfirmDialog({
  t,
  open,
  onOpenChange,
  total,
  count,
  checks,
  balanceUnknown = false,
  network,
  onConfirm,
}: {
  t: Dictionary["multisend"]["confirm"];
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Already formatted for the language. */
  total: string;
  count: number;
  /** Lines only re-checked on chain in this run, never signed (C2). */
  checks: number;
  /** The balance could not be read: it does not block, but the user is told to check it (finding 12). */
  balanceUnknown?: boolean;
  network: string;
  onConfirm(): void;
}) {
  const body = fill(count === 1 ? t.bodyOne : t.body, { total, n: count, network });
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="data-[size=default]:max-w-[calc(100%-2rem)] data-[size=default]:sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display text-lg font-bold text-fg">{t.title}</AlertDialogTitle>
          <AlertDialogDescription className="text-base text-fg">{body}</AlertDialogDescription>
          {balanceUnknown ? <p className="text-sm font-bold text-fg">{fill(t.balanceUnknown, { total })}</p> : null}
          {checks > 0 ? <p className="text-sm text-fg-muted">{checks === 1 ? t.checksOne : fill(t.checks, { n: checks })}</p> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel autoFocus>{t.back}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            <Send aria-hidden />
            {t.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
