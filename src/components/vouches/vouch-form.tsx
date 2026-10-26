"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, Info, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { shortAddress } from "@/lib/auth/wallet";
import type { Dictionary } from "@/lib/i18n";
import { fill } from "@/lib/i18n/fill";
import { ADDRESS_RE } from "@/lib/pay/target";
import { recordVouchAction } from "@/lib/vouches/actions";
import type { VouchChainId } from "@/lib/vouches/eas";
import { VOUCH_KINDS, vouchKindKey, type VouchKind } from "@/lib/vouches/kinds";
import type { GivenVouch } from "@/lib/vouches/types";
import { useSessionWalletMatch } from "@/lib/vouches/use-session-wallet";
import { useVouchWrite } from "@/lib/vouches/use-vouch-write";
import { clearSent, noStored, parseSent, readSentRaw, recordUntilSettled, sentAtNow, subscribeStorage, writeSent, type Sent } from "@/lib/web3/signing";
import { isFinalVouchError, PENDING_DELAYS_MS, writeErrorText } from "./vouch-flow";

type Hash = `0x${string}`;

/**
 * Per recipient, the hash of a vouch this browser signed and the server has not recorded yet (see `writeSent`). While
 * it exists the form offers «Comprobar de nuevo» on that hash instead of signing again, like the prize button of P2; a
 * definitive answer (isFinalVouchError: a failed tx, or one the chain still does not know ten minutes later) drops it.
 */
const storageKey = (recipient: string) => `elclub:vouch:${recipient.toLowerCase()}`;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

type Phase = "idle" | "signing" | "confirming" | "pending" | "done";

/**
 * Vouch form (P5-R4): recipient and kind, «Avalar» signs EAS attest with the session's wallet on Base, then the hash is
 * recorded on the server, retried with back-off while the chain has not mined it. Blocked before signing: the session's
 * own address, a kind this wallet already vouched to that recipient, and a connected wallet other than the session's
 * (warned up front, «Avalar» disabled).
 */
export function VouchForm({
  t,
  chainId,
  sessionWallet,
  defaultRecipient,
  given,
  retryDelaysMs = PENDING_DELAYS_MS,
}: {
  t: Dictionary["vouches"];
  chainId: VouchChainId;
  sessionWallet: `0x${string}`;
  defaultRecipient: string;
  given: GivenVouch[];
  retryDelaysMs?: readonly number[];
}) {
  const id = useId();
  const router = useRouter();
  const { attest } = useVouchWrite(sessionWallet);
  const wallet = useSessionWalletMatch(sessionWallet);
  const [recipient, setRecipient] = useState(defaultRecipient);
  const [kind, setKind] = useState<VouchKind | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [kindMissing, setKindMissing] = useState(false);
  const [local, setLocal] = useState<({ recipient: string } & Sent) | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const r = recipient.trim();
  const valid = ADDRESS_RE.test(r);
  const isSelf = valid && same(r, sessionWallet);
  const duplicate = valid && kind !== null && given.some((g) => same(g.recipient, r) && g.kind === kind);
  // The snapshot is the raw string (stable between renders); parsed here.
  const stored = parseSent(useSyncExternalStore(subscribeStorage, () => (valid ? readSentRaw(storageKey(r)) : null), noStored));
  const pending: Sent | null = stored ?? (valid && local && same(local.recipient, r) ? local : null);
  const busy = phase === "signing" || phase === "confirming";

  async function check(to: string, sent: Sent) {
    setError(null);
    setPhase("confirming");
    const res = await recordUntilSettled(() => recordVouchAction({ chainId, txHash: sent.hash }), retryDelaysMs, () => alive.current);
    if (res === null) return;
    if (res === "pending") {
      setPhase("pending");
      return;
    }
    if (res.ok) {
      clearSent(storageKey(to));
      setLocal(null);
      setKind(null);
      setPhase("done");
      router.refresh();
      return;
    }
    if (isFinalVouchError(res.error, sent.sentAt)) {
      clearSent(storageKey(to));
      setLocal(null);
    }
    setError(t.form.errors[res.error] ?? t.form.errors.unknown);
    setPhase("idle");
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (!valid) {
      setInvalid(true);
      inputRef.current?.focus();
      return;
    }
    if (isSelf) return;
    if (pending) return check(r, pending);
    if (duplicate || !wallet.matches) return;
    if (kind === null) {
      setKindMissing(true);
      return;
    }
    setPhase("signing");
    let hash: Hash;
    try {
      hash = await attest(r as Hash, kind);
    } catch (err) {
      if (!alive.current) return;
      setError(writeErrorText(err, t.form));
      setPhase("idle");
      return;
    }
    const sent: Sent = { hash, sentAt: sentAtNow() };
    writeSent(storageKey(r), sent);
    setLocal({ recipient: r, ...sent });
    await check(r, sent);
  }

  const errorId = `${id}-error`;
  const selfId = `${id}-self`;
  const describedBy = [invalid ? errorId : null, isSelf ? selfId : null].filter(Boolean).join(" ") || undefined;
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <label htmlFor={`${id}-to`} className="text-sm font-bold text-fg">
          {t.form.recipient}
        </label>
        <Input
          ref={inputRef}
          id={`${id}-to`}
          name="recipient"
          value={recipient}
          onChange={(e) => {
            setRecipient(e.target.value);
            setInvalid(false);
            setError(null);
            if (phase === "done" || phase === "pending") setPhase("idle");
          }}
          placeholder="0x…"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={invalid || isSelf ? true : undefined}
          aria-describedby={describedBy}
          className="font-mono"
        />
        {invalid ? (
          <p id={errorId} role="alert" className="flex items-start gap-2 text-sm text-danger">
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            {t.form.invalid}
          </p>
        ) : null}
        {isSelf ? (
          <p id={selfId} className="flex items-start gap-2 text-sm text-danger">
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            {t.form.self}
          </p>
        ) : null}
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-bold text-fg">{t.form.kind}</legend>
        {VOUCH_KINDS.map((k) => (
          <label
            key={k}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-control border border-border px-3 py-2 text-base text-fg transition-colors duration-150 hover:bg-surface-2 has-[:checked]:border-accent has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent"
          >
            <input
              type="radio"
              name="kind"
              value={k}
              checked={kind === k}
              onChange={() => {
                setKind(k);
                setKindMissing(false);
                if (phase === "done") setPhase("idle");
              }}
              className="size-5 shrink-0 accent-accent outline-none"
            />
            {t.kinds[vouchKindKey(k)]}
          </label>
        ))}
        {kindMissing ? (
          <p role="alert" className="flex items-start gap-2 text-sm text-danger">
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            {t.form.kindRequired}
          </p>
        ) : null}
        {duplicate ? (
          <p role="status" className="flex items-start gap-2 text-sm text-fg-muted">
            <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
            {t.form.already}
          </p>
        ) : null}
      </fieldset>

      {wallet.mismatch ? (
        <p className="flex items-start gap-2 text-sm text-warning">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          {fill(t.form.useWallet, { address: shortAddress(sessionWallet) })}
        </p>
      ) : null}

      {pending ? (
        <div className="flex flex-col items-start gap-2">
          {!busy && !error ? <p className="text-sm text-fg-muted">{t.form.pending}</p> : null}
          <Button type="button" variant="outline" onClick={() => check(r, pending)} disabled={busy}>
            {busy ? <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" /> : <RefreshCw aria-hidden />}
            {busy ? t.form.confirming : t.form.checkAgain}
          </Button>
        </div>
      ) : (
        <Button type="submit" className="self-start" disabled={busy || isSelf || duplicate || !wallet.matches}>
          {busy ? <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" /> : <ShieldCheck aria-hidden />}
          {phase === "signing" ? t.form.signing : phase === "confirming" ? t.form.confirming : t.form.submit}
        </Button>
      )}

      <div aria-live="polite">
        {phase === "done" ? (
          <p role="status" className="inline-flex items-center gap-2 text-sm font-bold text-success">
            <CircleCheck aria-hidden className="size-4" />
            {t.form.done}
          </p>
        ) : null}
        {error ? <p className="text-sm text-danger">{error}</p> : null}
      </div>
    </form>
  );
}
