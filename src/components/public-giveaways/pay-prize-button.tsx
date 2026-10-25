"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { CircleCheck, Loader2, RefreshCw, RotateCcw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { shortAddress } from "@/lib/auth/wallet";
import type { ChainId } from "@/lib/economy/networks";
import type { Dictionary } from "@/lib/i18n";
import { fill } from "@/lib/i18n/fill";
import { useEnsureChain } from "@/lib/payments/use-ensure-chain";
import { useSendTransfer } from "@/lib/payments/use-send-transfer";
import { getPublicPrizeStatusAction, markPublicPrizePaidAction } from "@/lib/public-giveaways/actions";

type HostLabels = Dictionary["giveaways"]["detail"]["host"];
type Errors = Dictionary["giveaways"]["errors"];
type Hash = `0x${string}`;

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
/** First check plus five retries, 4 s apart, while the chain has not confirmed the transfer yet. */
const PENDING_RETRIES = 5;
/** A sent hash the chain still does not know after this long is taken as never broadcast. */
const NOT_FOUND_GIVE_UP_MS = 10 * 60_000;

function isUserRejection(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { name?: string; code?: number; cause?: unknown };
  if (e.name === "UserRejectedRequestError" || e.code === 4001) return true;
  return e.cause ? isUserRejection(e.cause) : false;
}

/**
 * Whether a verification answer for a sent hash is final (the hash will never pay this prize): it failed on chain, does
 * not match the prize, was already used, or the chain still does not know it ten minutes after it was sent. Then the
 * host may discard it and pay again. pending, rpc_unavailable and the rest only offer «Comprobar de nuevo».
 */
export function isDefinitiveFailure(code: string, sentAt: number, now: number): boolean {
  if (code === "tx_failed" || code === "tx_mismatch" || code === "tx_already_used") return true;
  return code === "tx_not_found" && now - sentAt >= NOT_FOUND_GIVE_UP_MS;
}

/**
 * Per prize, what this browser did with it: `{hash, sentAt}` while a sent payout waits for verification, then the
 * terminal marker `paid:<hash>`. Any stored value blocks «Pagar ahora»: a reload, a second tab or a stale page resumes on
 * the hash (or shows it paid) instead of sending a second transfer. Only a definitive failure clears it. Storage may be
 * missing or throw (private mode, blocked site data): every access is guarded and the button then falls back to its
 * in-memory state (and the fresh server status read before paying).
 */
type Stored = { kind: "sent"; hash: Hash; sentAt: number } | { kind: "paid"; hash: Hash };

const storageKey = (prizeId: string) => `elclub:pg-pay:${prizeId}`;

function readRaw(prizeId: string): string | null {
  try {
    return window.localStorage.getItem(storageKey(prizeId));
  } catch {
    return null;
  }
}

function parseStored(raw: string | null): Stored | null {
  if (!raw) return null;
  if (raw.startsWith("paid:")) {
    const h = raw.slice(5);
    return TX_HASH.test(h) ? { kind: "paid", hash: h as Hash } : null;
  }
  // A bare hash (older format): its send time is unknown.
  if (TX_HASH.test(raw)) return { kind: "sent", hash: raw as Hash, sentAt: 0 };
  try {
    const v = JSON.parse(raw) as { hash?: unknown; sentAt?: unknown };
    if (typeof v.hash === "string" && TX_HASH.test(v.hash) && typeof v.sentAt === "number" && Number.isFinite(v.sentAt)) {
      return { kind: "sent", hash: v.hash as Hash, sentAt: v.sentAt };
    }
  } catch {
    // Not ours.
  }
  return null;
}

function writeStored(prizeId: string, value: Stored): void {
  try {
    window.localStorage.setItem(storageKey(prizeId), value.kind === "paid" ? `paid:${value.hash}` : JSON.stringify({ hash: value.hash, sentAt: value.sentAt }));
  } catch {
    // Without storage the guard only lasts while the page is open.
  }
}

function clearStored(prizeId: string): void {
  try {
    window.localStorage.removeItem(storageKey(prizeId));
  } catch {
    // Nothing stored, or no storage at all.
  }
}

/** Re-reads when another tab stores or clears a value. The server snapshot is null (no storage there). */
const subscribeStorage = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
};
const noStored = () => null;

type Outcome = { kind: "paid" } | { kind: "pending" } | { kind: "error"; code: string; text: string };

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
      if (r.error !== "pending") return { kind: "error", code: r.error, text: errors[r.error] ?? errors.unknown };
      if (i < retries) await new Promise((res) => setTimeout(res, delayMs));
    }
    return { kind: "pending" };
  };
}

type Phase = "idle" | "switching" | "sending" | "confirming" | "paid" | "pending" | "failed";

/**
 * «Pagar ahora»: the host's wallet moves to the prize's network, the prize's status is read fresh from the server (a
 * stale page must not pay a prize already paid elsewhere), the USDC goes to the winner (useSendTransfer adds the Builder
 * Code on Base) and the hash is verified on chain. Once a hash exists the button never offers to pay again: a pending or
 * unreachable chain offers «Comprobar de nuevo» on that same hash; only a definitive failure (isDefinitiveFailure) clears
 * it and offers «Descartar y volver a pagar» with a warning. See Stored for the per-prize memory across tabs and reloads.
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
  onSentHash,
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
  /** True while a sent hash (or the paid marker) exists for this prize (the panel hides «Ya lo pagué» then). */
  onSentHash?: (sent: boolean) => void;
}) {
  const router = useRouter();
  const { ensure } = useEnsureChain();
  const { send } = useSendTransfer();
  const { address, isConnected } = useAccount();
  const verify = useVerifyPayment(prizeId, errors, retryDelayMs);
  const [phase, setPhase] = useState<Phase>("idle");
  const [local, setLocal] = useState<Stored | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A value stored before a reload (or by another tab) counts as this button's own: resume on it.
  const raw = useSyncExternalStore(subscribeStorage, () => readRaw(prizeId), noStored);
  const stored = parseStored(raw);
  const current: Stored | null = local ?? stored;
  const blocked = current !== null;

  useEffect(() => {
    onSentHash?.(blocked);
  }, [blocked, onSentHash]);

  async function check(s: { hash: Hash; sentAt: number }, retries: number) {
    setError(null);
    setPhase("confirming");
    const r = await verify(s.hash, retries);
    if (!r) return;
    if (r.kind === "paid") {
      const paid: Stored = { kind: "paid", hash: s.hash };
      writeStored(prizeId, paid);
      setLocal(paid);
      setPhase("paid");
    } else if (r.kind === "pending") setPhase("pending");
    else if (isDefinitiveFailure(r.code, s.sentAt, Date.now())) {
      clearStored(prizeId);
      setLocal(null);
      setError(r.text);
      setPhase("failed");
    } else {
      setError(r.text);
      setPhase("pending");
    }
  }

  /** Something already happened to this prize in this browser: never send, resume on it. */
  async function resume(s: Stored) {
    setLocal(s);
    if (s.kind === "paid") {
      setPhase("paid");
      router.refresh();
      return;
    }
    await check(s, 0);
  }

  async function pay() {
    if (phase !== "idle") return;
    setError(null);
    const before = parseStored(readRaw(prizeId)) ?? local;
    if (before) return resume(before);
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
    // Fresh status right before the wallet opens: another device (or a stale tab without storage) may have paid it.
    const fresh = await getPublicPrizeStatusAction(prizeId);
    if (!fresh.ok || fresh.status !== "awarded") {
      setError(fresh.ok ? t.stalePrize : (errors[fresh.error] ?? errors.unknown));
      setPhase("idle");
      router.refresh();
      return;
    }
    const meanwhile = parseStored(readRaw(prizeId));
    if (meanwhile) return resume(meanwhile);
    setPhase("sending");
    let h: Hash;
    try {
      h = await send({ chain: chainId, token: "USDC", to: winnerAddress as Hash, amount: BigInt(amount), account: hostAddress as Hash });
    } catch (e) {
      setError(isUserRejection(e) ? t.sendCancelled : t.sendFailed);
      setPhase("idle");
      return;
    }
    const sent: Stored = { kind: "sent", hash: h, sentAt: Date.now() };
    writeStored(prizeId, sent);
    setLocal(sent);
    await check(sent, PENDING_RETRIES);
  }

  function discard() {
    setError(null);
    setPhase("idle");
  }

  if (phase === "paid" || current?.kind === "paid") {
    return (
      <p role="status" className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-success">
        <CircleCheck aria-hidden className="size-4" />
        {t.paidOk}
      </p>
    );
  }

  if (phase === "failed") {
    return (
      <div className="flex flex-col items-start gap-2">
        <div role="alert" className="flex flex-col gap-1">
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <p className="text-sm text-fg-muted">{t.discardWarning}</p>
        </div>
        <Button type="button" variant="outline" onClick={discard}>
          <RotateCcw aria-hidden />
          {t.discardRetry}
        </Button>
      </div>
    );
  }

  const busy = phase === "switching" || phase === "sending" || phase === "confirming";
  const busyText = phase === "switching" ? t.switching : phase === "sending" ? t.sending : t.confirming;
  return (
    <div className="flex flex-col items-start gap-2">
      {current === null ? (
        <Button type="button" onClick={pay} disabled={busy}>
          {busy ? <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" /> : <Send aria-hidden />}
          {busy ? busyText : t.payNow}
        </Button>
      ) : (
        <>
          {!busy && !error ? <p className="text-sm text-fg-muted">{t.pendingLong}</p> : null}
          <Button type="button" variant="outline" onClick={() => check(current, 0)} disabled={busy}>
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
