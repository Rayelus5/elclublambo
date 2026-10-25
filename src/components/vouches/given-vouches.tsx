"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, Info, Loader2, RefreshCw, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { shortAddress } from "@/lib/auth/wallet";
import type { Dictionary } from "@/lib/i18n";
import { fill } from "@/lib/i18n/fill";
import type { Lang } from "@/lib/i18n/config";
import { localizedPath } from "@/lib/i18n/routes";
import { recordRevocationAction } from "@/lib/vouches/actions";
import type { VouchChainId } from "@/lib/vouches/eas";
import { vouchKindKey } from "@/lib/vouches/kinds";
import type { GivenVouch } from "@/lib/vouches/types";
import { useSessionWalletMatch } from "@/lib/vouches/use-session-wallet";
import { useVouchWrite } from "@/lib/vouches/use-vouch-write";
import { isFinalVouchError, PENDING_DELAYS_MS, recordUntilSettled, sentAtNow, writeErrorText } from "./vouch-flow";

type Sent = { hash: `0x${string}`; sentAt: number };
/** `sent` is a signed revocation the server has not recorded yet: the row then only offers to check it again. */
type RowState = {
  phase: "idle" | "busy" | "revoked";
  error: string | null;
  sent: Sent | null;
};
const IDLE: RowState = { phase: "idle", error: null, sent: null };

/**
 * «Tus avales»: the session's non-revoked vouches, each with «Retirar» (outline, disabled while the connected wallet is
 * not the session's). EAS only lets the attester revoke; the revocation hash is recorded on the server with the same
 * back-off as a new vouch, and a hash still pending is checked again, never signed twice.
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
  const router = useRouter();
  const { revoke } = useVouchWrite(sessionWallet);
  const wallet = useSessionWalletMatch(sessionWallet);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const set = (uid: string, s: RowState) => setRows((prev) => ({ ...prev, [uid]: s }));

  async function check(uid: string, sent: Sent) {
    set(uid, { phase: "busy", error: null, sent });
    const res = await recordUntilSettled(
      () => recordRevocationAction({ chainId, txHash: sent.hash }),
      retryDelaysMs,
      () => alive.current,
    );
    if (res === null) return;
    if (res === "pending") return set(uid, { phase: "idle", error: t.form.pending, sent });
    if (!res.ok) {
      const keep = isFinalVouchError(res.error, sent.sentAt) ? null : sent;
      return set(uid, {
        phase: "idle",
        error: t.form.errors[res.error] ?? t.form.errors.unknown,
        sent: keep,
      });
    }
    set(uid, { phase: "revoked", error: null, sent: null });
    router.refresh();
  }

  async function withdraw(uid: string) {
    const row = rows[uid] ?? IDLE;
    if (row.phase === "busy" || !wallet.matches) return;
    if (row.sent) return check(uid, row.sent);
    set(uid, { phase: "busy", error: null, sent: null });
    let hash: `0x${string}`;
    try {
      hash = await revoke(uid as `0x${string}`);
    } catch (err) {
      if (alive.current)
        set(uid, {
          phase: "idle",
          error: writeErrorText(err, t.form),
          sent: null,
        });
      return;
    }
    await check(uid, { hash, sentAt: sentAtNow() });
  }

  if (given.length === 0) return <p className="text-sm text-fg-muted">{t.given.empty}</p>;

  const lookup = localizedPath(lang, "vouches");
  return (
    <div className="flex flex-col gap-4">
      {wallet.mismatch ? (
        <p className="flex items-start gap-2 text-sm text-warning">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          {fill(t.form.useWallet, { address: shortAddress(sessionWallet) })}
        </p>
      ) : null}
      <ul className="flex flex-col divide-y divide-border">
        {given.map((g) => {
          const s = rows[g.uid] ?? IDLE;
          return (
            <li key={g.uid} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-base font-bold text-fg">{t.kinds[vouchKindKey(g.kind)]}</span>
                <span className="text-sm text-fg-muted">
                  {t.given.to}{" "}
                  {g.recipientAlias ? (
                    <a
                      href={localizedPath(lang, "pay", {
                        target: g.recipientAlias,
                      })}
                      className="text-accent underline-offset-4 hover:underline"
                    >
                      @{g.recipientAlias}
                    </a>
                  ) : (
                    <a href={`${lookup}?address=${g.recipient}`} className="font-mono break-all text-accent underline-offset-4 hover:underline">
                      {g.recipient}
                    </a>
                  )}
                </span>
              </div>
              <div className="flex flex-col items-start gap-1 sm:items-end">
                {s.phase === "revoked" ? (
                  <p role="status" className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-success">
                    <CircleCheck aria-hidden className="size-4" />
                    {t.given.revoked}
                  </p>
                ) : (
                  <Button type="button" variant="outline" onClick={() => withdraw(g.uid)} disabled={s.phase === "busy" || !wallet.matches}>
                    {s.phase === "busy" ? (
                      <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" />
                    ) : s.sent ? (
                      <RefreshCw aria-hidden />
                    ) : (
                      <Undo2 aria-hidden />
                    )}
                    {s.phase === "busy" ? t.given.revoking : s.sent ? t.form.checkAgain : t.given.revoke}
                  </Button>
                )}
                <div aria-live="polite">{s.error ? <p className="text-sm text-danger">{s.error}</p> : null}</div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
