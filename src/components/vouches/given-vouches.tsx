"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, Loader2, RefreshCw, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/config";
import { localizedPath } from "@/lib/i18n/routes";
import { recordRevocationAction, refreshVouchAction } from "@/lib/vouches/actions";
import type { VouchChainId } from "@/lib/vouches/eas";
import { vouchKindKey } from "@/lib/vouches/kinds";
import type { GivenVouch } from "@/lib/vouches/types";
import { useSessionWalletMatch } from "@/lib/vouches/use-session-wallet";
import { useVouchWrite } from "@/lib/vouches/use-vouch-write";
import { RefreshButton } from "./refresh-button";
import {
  clearSent,
  noStored,
  parseSent,
  readSentRaw,
  recordUntilSettled,
  sentAtNow,
  subscribeStorage,
  writeErrorKind,
  writeSent,
  type Sent,
} from "@/lib/web3/signing";
import { isFinalVouchError, PENDING_DELAYS_MS, writeErrorText } from "./vouch-flow";

type Hash = `0x${string}`;

/** Per uid, a revocation this browser signed and the server has not recorded yet (see `writeSent`). */
const revokeKey = (uid: string) => `elclub:vouch-revoke:${uid.toLowerCase()}`;

/**
 * «Tus avales»: the session's non-revoked vouches, each with «Retirar» (outline, disabled while the connected wallet is
 * not the session's; the form above warns about it, once per page) and «Actualizar» (ghost). EAS only lets the attester
 * revoke; the revocation hash is stored and recorded on the server with the same back-off as a new vouch, and a hash
 * still pending is checked again, never signed twice. A revoke that cannot go through (already revoked elsewhere, a
 * reverted tx) re-reads the chain, so a stale row leaves the list instead of blocking it. The confirmation lives here,
 * outside the rows, so it survives the refresh that takes the row away.
 */
export function GivenVouches({
  lang,
  t,
  given,
  chainId,
  sessionWallet,
  retryDelaysMs = PENDING_DELAYS_MS,
}: {
  lang: Lang;
  t: Dictionary["vouches"];
  given: GivenVouch[];
  chainId: VouchChainId;
  sessionWallet: `0x${string}`;
  retryDelaysMs?: readonly number[];
}) {
  const { revoke } = useVouchWrite(sessionWallet);
  const wallet = useSessionWalletMatch(sessionWallet);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div aria-live="polite">
        {notice ? (
          <p role="status" className="inline-flex items-center gap-2 text-sm font-bold text-success">
            <CircleCheck aria-hidden className="size-4" />
            {notice}
          </p>
        ) : null}
      </div>
      {given.length === 0 ? (
        <p className="text-sm text-fg-muted">{t.given.empty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {given.map((g) => (
            <GivenRow
              key={g.uid}
              lang={lang}
              t={t}
              vouch={g}
              chainId={chainId}
              canSign={wallet.matches}
              revoke={revoke}
              retryDelaysMs={retryDelaysMs}
              onStart={() => setNotice(null)}
              onGone={setNotice}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function GivenRow({
  lang,
  t,
  vouch,
  chainId,
  canSign,
  revoke,
  retryDelaysMs,
  onStart,
  onGone,
}: {
  lang: Lang;
  t: Dictionary["vouches"];
  vouch: GivenVouch;
  chainId: VouchChainId;
  canSign: boolean;
  revoke: (uid: Hash) => Promise<Hash>;
  retryDelaysMs: readonly number[];
  onStart: () => void;
  onGone: (text: string) => void;
}) {
  const router = useRouter();
  const uid = vouch.uid;
  const key = revokeKey(uid);
  const [phase, setPhase] = useState<"idle" | "busy" | "gone">("idle");
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState<Sent | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  // The snapshot is the raw string (stable between renders); parsed here.
  const sent = parseSent(useSyncExternalStore(subscribeStorage, () => readSentRaw(key), noStored)) ?? local;

  function gone(state: "revoked" | "removed") {
    setPhase("gone");
    onGone(state === "revoked" ? t.given.revoked : t.given.removed);
    router.refresh();
  }

  /** The revoke did not go through: maybe the chain already has it revoked (or forgot it). Otherwise `text` stays. */
  async function reconcile(text: string) {
    let r: Awaited<ReturnType<typeof refreshVouchAction>> | null = null;
    try {
      r = await refreshVouchAction(uid);
    } catch {
      // Treated as still active.
    }
    if (!alive.current) return;
    if (r?.ok && r.state !== "active") return gone(r.state);
    setError(text);
    setPhase("idle");
  }

  async function check(s: Sent) {
    setError(null);
    setPhase("busy");
    const res = await recordUntilSettled(() => recordRevocationAction({ chainId, txHash: s.hash }), retryDelaysMs, () => alive.current);
    if (res === null) return;
    if (res === "pending") {
      setError(t.form.pending);
      setPhase("idle");
      return;
    }
    if (res.ok) {
      clearSent(key);
      setLocal(null);
      return gone("revoked");
    }
    if (isFinalVouchError(res.error, s.sentAt)) {
      clearSent(key);
      setLocal(null);
    }
    const text = t.form.errors[res.error] ?? t.form.errors.unknown;
    if (res.error === "tx_failed") return reconcile(text);
    setError(text);
    setPhase("idle");
  }

  async function withdraw() {
    if (phase !== "idle" || !canSign) return;
    onStart();
    if (sent) return check(sent);
    setError(null);
    setPhase("busy");
    let hash: Hash;
    try {
      hash = await revoke(uid as Hash);
    } catch (err) {
      if (!alive.current) return;
      // A failed estimate is what EAS answers to a uid already revoked (AlreadyRevoked): ask the chain.
      if (writeErrorKind(err) === "failed") return reconcile(writeErrorText(err, t.form));
      setError(writeErrorText(err, t.form));
      setPhase("idle");
      return;
    }
    const s: Sent = { hash, sentAt: sentAtNow() };
    writeSent(key, s);
    setLocal(s);
    await check(s);
  }

  const busy = phase === "busy";
  const lookup = localizedPath(lang, "vouches");
  return (
    <li className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-base font-bold text-fg">{t.kinds[vouchKindKey(vouch.kind)]}</span>
        <span className="text-sm text-fg-muted">
          {t.given.to}{" "}
          {vouch.recipientAlias ? (
            <a href={localizedPath(lang, "pay", { target: vouch.recipientAlias })} className="text-accent underline-offset-4 hover:underline">
              @{vouch.recipientAlias}
            </a>
          ) : (
            <a href={`${lookup}?address=${vouch.recipient}`} className="font-mono break-all text-accent underline-offset-4 hover:underline">
              {vouch.recipient}
            </a>
          )}
        </span>
      </div>
      {phase === "gone" ? null : (
        <div className="flex flex-col items-start gap-1 sm:items-end">
          <div className="flex flex-wrap items-start gap-2 sm:justify-end">
            <RefreshButton uid={uid} t={t} onChanged={gone} />
            <Button type="button" variant="outline" onClick={withdraw} disabled={busy || !canSign}>
              {busy ? <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" /> : sent ? <RefreshCw aria-hidden /> : <Undo2 aria-hidden />}
              {busy ? t.given.revoking : sent ? t.form.checkAgain : t.given.revoke}
            </Button>
          </div>
          <div aria-live="polite">{error ? <p className="text-sm text-danger">{error}</p> : null}</div>
        </div>
      )}
    </li>
  );
}
