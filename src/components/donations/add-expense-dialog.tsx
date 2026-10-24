"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { addExpenseAction } from "@/lib/donations/expenses";
import { NETWORKS, type ChainId } from "@/lib/economy/networks";
import { parseAmount } from "@/lib/payments/amounts";

const NOTE_MAX = 280;
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const FIELD =
  "min-h-11 w-full rounded-control border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg md:text-sm";

/** «Anotar gasto»: only rendered for treasurers. The server checks the hash on-chain before it records anything. */
export function AddExpenseTrigger({ chains }: { chains: readonly ChainId[] }) {
  const [open, setOpen] = useState(false);
  if (chains.length === 0) return null;
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Plus aria-hidden className="size-4" />
        Anotar gasto
      </Button>
      {open ? <AddExpenseDialog onOpenChange={setOpen} chains={chains} /> : null}
    </>
  );
}

function AddExpenseDialog({ onOpenChange, chains }: { onOpenChange: (open: boolean) => void; chains: readonly ChainId[] }) {
  const router = useRouter();
  const [chainId, setChainId] = useState<ChainId>(chains[0]!);
  const [token, setToken] = useState<"USDC" | "ETH">("USDC");
  const [amount, setAmount] = useState("");
  const [txHash, setTxHash] = useState("");
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const units = parseAmount(amount, token);
  const errors = {
    amount: units === null || units <= 0n ? "Escribe un importe mayor que 0." : null,
    txHash: HASH_RE.test(txHash.trim()) ? null : "El hash empieza por 0x y tiene 64 caracteres.",
    note: note.trim().length >= 1 && note.trim().length <= NOTE_MAX ? null : `Escribe una nota de 1 a ${NOTE_MAX} caracteres.`,
  };
  const valid = !errors.amount && !errors.txHash && !errors.note;
  const touch = (k: string) => setTouched((t) => ({ ...t, [k]: true }));
  const shown = (k: keyof typeof errors) => (touched[k] ? errors[k] : null);

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched({ amount: true, txHash: true, note: true });
    if (!valid) return;
    setError(null);
    start(async () => {
      try {
        const r = await addExpenseAction({ chainId, token, amount, txHash: txHash.trim(), note });
        if (!r.ok) return setError(r.error);
        router.refresh();
        onOpenChange(false);
      } catch {
        setError("No se pudo anotar el gasto. Inténtalo de nuevo.");
      }
    });
  }

  return (
    <Dialog open onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-lg font-bold">Anotar gasto</DialogTitle>
          <DialogDescription>Pega el hash de una salida de la Safe. Se comprueba en la red antes de guardarlo.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm font-bold text-fg">
              Red
              <select className={FIELD} value={chainId} onChange={(e) => setChainId(Number(e.target.value) as ChainId)} disabled={pending}>
                {chains.map((c) => (
                  <option key={c} value={c}>
                    {NETWORKS[c].name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-bold text-fg">
              Token
              <select className={FIELD} value={token} onChange={(e) => setToken(e.target.value as "USDC" | "ETH")} disabled={pending}>
                <option value="USDC">USDC</option>
                <option value="ETH">ETH</option>
              </select>
            </label>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="expense-amount" className="text-sm font-bold text-fg">
              Importe
            </label>
            <Input
              id="expense-amount"
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onBlur={() => touch("amount")}
              aria-invalid={!!shown("amount")}
              aria-describedby="expense-amount-hint"
              disabled={pending}
            />
            <p id="expense-amount-hint" role={shown("amount") ? "alert" : undefined} className={shown("amount") ? "text-sm text-danger" : "text-[13px] text-fg-muted"}>
              {shown("amount") ?? (token === "ETH" ? "Lo que salió de la Safe, en ETH." : "El importe exacto de la transferencia, en USDC.")}
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="expense-hash" className="text-sm font-bold text-fg">
              Hash de la transacción
            </label>
            <Input
              id="expense-hash"
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
              value={txHash}
              onChange={(e) => setTxHash(e.target.value)}
              onBlur={() => touch("txHash")}
              aria-invalid={!!shown("txHash")}
              aria-describedby={shown("txHash") ? "expense-hash-error" : undefined}
              disabled={pending}
            />
            {shown("txHash") ? (
              <p id="expense-hash-error" role="alert" className="text-sm text-danger">
                {shown("txHash")}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="expense-note" className="text-sm font-bold text-fg">
              Nota
            </label>
            <textarea
              id="expense-note"
              rows={3}
              maxLength={NOTE_MAX}
              className={`${FIELD} resize-y py-2`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => touch("note")}
              aria-invalid={!!shown("note")}
              aria-describedby="expense-note-hint"
              disabled={pending}
            />
            <p id="expense-note-hint" role={shown("note") ? "alert" : undefined} className={shown("note") ? "text-sm text-danger" : "text-[13px] text-fg-muted"}>
              {shown("note") ?? `En qué se gastó. ${note.length}/${NOTE_MAX}`}
            </p>
          </div>
          {error ? (
            <p role="alert" className="rounded-control border border-danger p-3 text-sm text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> : null}
              {pending ? "Comprobando…" : "Anotar gasto"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
