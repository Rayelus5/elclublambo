"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addAccessWalletAction, removeAccessWalletAction } from "@/lib/admin/actions";
import { shortAddress } from "@/lib/auth/wallet";
import { rpcErrorMessage } from "@/lib/errors";

const WALLET = /^0x[0-9a-fA-F]{40}$/;
const NOTE_MAX = 80;

export type AccessItem = { wallet: string; note: string | null; createdAt: string };

/** Wallets that, with the password, can get in during maintenance. Removing one does not ask (A-R18). */
export function AccessList({ items }: { items: AccessItem[] }) {
  const uid = useId();
  const router = useRouter();
  const [wallet, setWallet] = useState("");
  const [note, setNote] = useState("");
  const [walletError, setWalletError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const w = wallet.trim();
    if (!WALLET.test(w)) {
      setWalletError(true);
      setError(rpcErrorMessage("wallet_invalid"));
      return;
    }
    setWalletError(false);
    setBusy("add");
    startTransition(async () => {
      const res = await addAccessWalletAction(w, note.trim());
      setBusy(null);
      if (!res.ok) {
        setWalletError(res.error === "wallet_invalid");
        setError(rpcErrorMessage(res.error));
        return;
      }
      setWallet("");
      setNote("");
      router.refresh();
    });
  }

  function remove(w: string) {
    setError(null);
    setBusy(w);
    startTransition(async () => {
      const res = await removeAccessWalletAction(w);
      setBusy(null);
      if (!res.ok) {
        setError(rpcErrorMessage(res.error));
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={add} noValidate className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] sm:items-end">
        <div className="flex min-w-0 flex-col gap-2">
          <Label htmlFor={`${uid}-wallet`}>Wallet</Label>
          <Input
            id={`${uid}-wallet`}
            value={wallet}
            onChange={(e) => setWallet(e.target.value)}
            placeholder="0x…"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={walletError || undefined}
            aria-describedby={error ? `${uid}-error` : undefined}
            className="font-mono"
            disabled={busy !== null}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <Label htmlFor={`${uid}-note`}>Nota (opcional)</Label>
          <Input
            id={`${uid}-note`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={NOTE_MAX}
            placeholder="Ana — moderadora"
            disabled={busy !== null}
          />
        </div>
        <Button type="submit" variant="outline" disabled={busy !== null}>
          Añadir
        </Button>
      </form>

      {error ? (
        <p id={`${uid}-error`} role="alert" className="flex items-start gap-2 text-sm break-words text-danger">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}

      {items.length === 0 ? (
        <p className="text-sm text-fg-muted">Nadie en la lista. Durante el mantenimiento solo entrarás tú.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-panel border border-border bg-surface px-4">
          {items.map((item) => (
            <li key={item.wallet} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
                <span title={item.wallet} className="font-mono text-sm text-fg">
                  {shortAddress(item.wallet)}
                </span>
                {item.note ? <span className="min-w-0 text-sm break-words text-fg-muted">{item.note}</span> : null}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start sm:self-auto"
                aria-label={`Quitar ${shortAddress(item.wallet)}`}
                disabled={busy !== null}
                onClick={() => remove(item.wallet)}
              >
                Quitar
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
