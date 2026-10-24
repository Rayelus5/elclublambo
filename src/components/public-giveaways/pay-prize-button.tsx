"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { CircleCheck, Loader2, RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { shortAddress } from "@/lib/auth/wallet";
import type { ChainId } from "@/lib/economy/networks";
import type { Dictionary } from "@/lib/i18n";
import { fill } from "@/lib/i18n/fill";
import { useEnsureChain } from "@/lib/payments/use-ensure-chain";
import { useSendTransfer } from "@/lib/payments/use-send-transfer";
import { markPublicPrizePaidAction } from "@/lib/public-giveaways/actions";

type HostLabels = Dictionary["giveaways"]["detail"]["host"];
type Errors = Dictionary["giveaways"]["errors"];
type Hash = `0x${string}`;

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
/** First check plus five retries, 4 s apart, while the chain has not confirmed the transfer yet. */
const PENDING_RETRIES = 5;

function isUserRejection(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { name?: string; code?: number; cause?: unknown };
  if (e.name === "UserRejectedRequestError" || e.code === 4001) return true;
  return e.cause ? isUserRejection(e.cause) : false;
}

type Outcome = { kind: "paid" } | { kind: "pending" } | { kind: "error"; text: string };

/** markPublicPrizePaidAction, asked again every `delayMs` while it answers `pending` (up to `retries` more times). */
function useVerifyPayment(prizeId: string, errors: Errors, delayMs: number) {
  const router = useRouter();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return async function verify(hash: Hash, retries: number): Promise<Outcome | null> {
    for (let i = 0; i <= retries; i++) {
      const r = await markPublicPrizePaidAction(prizeId, hash);
      if (!alive.current) return null;
      if (r.ok) {
        router.refresh();
        return { kind: "paid" };
      }
      if (r.error !== "pending") return { kind: "error", text: errors[r.error] ?? errors.unknown };
      if (i < retries) await new Promise((res) => setTimeout(res, delayMs));
    }
    return { kind: "pending" };
  };
}

type Phase = "idle" | "switching" | "sending" | "confirming" | "paid" | "pending";

/**
 * «Pagar ahora»: the host's wallet moves to the prize's network, sends the USDC to the winner (useSendTransfer adds the
 * Builder Code on Base) and the hash is verified on chain. Once a hash exists the button never offers to pay again:
 * any later failure offers «Comprobar de nuevo» on that same hash, so a slow RPC cannot lead to a double payment.
 */
export function PayPrizeButton({
  prizeId,
  chainId,
  winnerAddress,
  hostAddress,
  amount,
  t,
  errors,
  retryDelayMs = 4000,
}: {
  prizeId: string;
  chainId: ChainId;
  winnerAddress: string;
  hostAddress: string;
  /** USDC base units as text. */
  amount: string;
  t: HostLabels;
  errors: Errors;
  retryDelayMs?: number;
}) {
  const { ensure } = useEnsureChain();
  const { send } = useSendTransfer();
  const { address, isConnected } = useAccount();
  const verify = useVerifyPayment(prizeId, errors, retryDelayMs);
  const [phase, setPhase] = useState<Phase>("idle");
  const [hash, setHash] = useState<Hash | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function check(h: Hash, retries: number) {
    setError(null);
    setPhase("confirming");
    const r = await verify(h, retries);
    if (!r) return;
    if (r.kind === "paid") setPhase("paid");
    else if (r.kind === "pending") setPhase("pending");
    else {
      setError(r.text);
      setPhase("pending");
    }
  }

  async function pay() {
    if (phase !== "idle") return;
    setError(null);
    if (!isConnected || !address || address.toLowerCase() !== hostAddress.toLowerCase()) {
      setError(fill(t.useHostWallet, { address: shortAddress(hostAddress) }));
      return;
    }
    setPhase("switching");
    if (!(await ensure(chainId))) {
      setError(t.switchFailed);
      setPhase("idle");
      return;
    }
    setPhase("sending");
    let h: Hash;
    try {
      h = await send({ chain: chainId, token: "USDC", to: winnerAddress as Hash, amount: BigInt(amount), account: hostAddress as Hash });
    } catch (e) {
      setError(isUserRejection(e) ? t.sendCancelled : t.sendFailed);
      setPhase("idle");
      return;
    }
    setHash(h);
    await check(h, PENDING_RETRIES);
  }

  if (phase === "paid") {
    return (
      <p role="status" className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-success">
        <CircleCheck aria-hidden className="size-4" />
        {t.paidOk}
      </p>
    );
  }

  const busy = phase === "switching" || phase === "sending" || phase === "confirming";
  const busyText = phase === "switching" ? t.switching : phase === "sending" ? t.sending : t.confirming;
  return (
    <div className="flex flex-col items-start gap-2">
      {hash === null ? (
        <Button type="button" onClick={pay} disabled={busy}>
          {busy ? <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" /> : <Send aria-hidden />}
          {busy ? busyText : t.payNow}
        </Button>
      ) : (
        <>
          {phase === "pending" && !error ? <p className="text-sm text-fg-muted">{t.pendingLong}</p> : null}
          <Button type="button" variant="outline" onClick={() => check(hash, 0)} disabled={busy}>
            {busy ? <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" /> : <RefreshCw aria-hidden />}
            {busy ? busyText : t.checkAgain}
          </Button>
        </>
      )}
      <div aria-live="polite">
        {error ? <p className="text-sm text-danger">{error}</p> : null}
      </div>
    </div>
  );
}

/** «Ya lo pagué»: the host paid outside the app and pastes the hash, which is verified on chain like any payment. */
export function PastePaymentForm({ prizeId, t, errors }: { prizeId: string; t: HostLabels; errors: Errors }) {
  const fieldId = useId();
  const verify = useVerifyPayment(prizeId, errors, 0);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const h = value.trim();
    if (!TX_HASH.test(h)) {
      setInvalid(true);
      inputRef.current?.focus();
      return;
    }
    setInvalid(false);
    setBusy(true);
    const r = await verify(h as Hash, 0);
    setBusy(false);
    if (!r) return;
    if (r.kind === "paid") setDone(true);
    else setError(r.kind === "pending" ? errors.pending : r.text);
  }

  if (done) {
    return (
      <p role="status" className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-success">
        <CircleCheck aria-hidden className="size-4" />
        {t.paidOk}
      </p>
    );
  }

  if (!open) {
    return (
      <Button type="button" variant="ghost" onClick={() => setOpen(true)}>
        {t.alreadyPaid}
      </Button>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex w-full flex-col gap-2">
      <label htmlFor={fieldId} className="text-sm font-bold">
        {t.txHash}
      </label>
      <Input
        ref={inputRef}
        id={fieldId}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoComplete="off"
        spellCheck={false}
        inputMode="text"
        placeholder="0x…"
        className="font-mono"
        aria-invalid={invalid}
        aria-describedby={`${fieldId}-hint${invalid ? ` ${fieldId}-error` : ""}`}
      />
      <p id={`${fieldId}-hint`} className="text-[13px] text-fg-muted">
        {t.txHashHint}
      </p>
      {invalid ? (
        <p id={`${fieldId}-error`} role="alert" className="text-sm text-danger">
          {t.errTxHash}
        </p>
      ) : null}
      <Button type="submit" variant="outline" className="self-start" disabled={busy}>
        {busy ? <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
        {busy ? t.confirming : t.submitHash}
      </Button>
      <div aria-live="polite">{error ? <p className="text-sm text-danger">{error}</p> : null}</div>
    </form>
  );
}
