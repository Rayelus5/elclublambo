"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, Loader2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/config";
import { localizedPath } from "@/lib/i18n/routes";
import { recordRevocationAction } from "@/lib/vouches/actions";
import type { VouchChainId } from "@/lib/vouches/eas";
import { vouchKindKey } from "@/lib/vouches/kinds";
import type { GivenVouch } from "@/lib/vouches/types";
import { useVouchWrite } from "@/lib/vouches/use-vouch-write";
import { PENDING_DELAYS_MS, recordUntilSettled, writeErrorText } from "./vouch-flow";

type RowState = { phase: "idle" | "busy" | "revoked"; error: string | null };
const IDLE: RowState = { phase: "idle", error: null };

/**
 * «Tus avales»: the session's non-revoked vouches, each with «Retirar» (outline). EAS only lets the attester revoke; the
 * revocation hash is recorded on the server with the same back-off as a new vouch.
 */
export function GivenVouches({
  lang,
  t,
  given,
  chainId,
  retryDelaysMs = PENDING_DELAYS_MS,
}: {
  lang: Lang;
  t: Dictionary["vouches"];
  given: GivenVouch[];
  chainId: VouchChainId;
  retryDelaysMs?: readonly number[];
}) {
  const router = useRouter();
  const { revoke } = useVouchWrite();
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const set = (uid: string, s: RowState) => setRows((prev) => ({ ...prev, [uid]: s }));

  async function withdraw(uid: string) {
    if (rows[uid]?.phase === "busy") return;
    set(uid, { phase: "busy", error: null });
    let hash: `0x${string}`;
    try {
      hash = await revoke(uid as `0x${string}`);
    } catch (err) {
      if (alive.current) set(uid, { phase: "idle", error: writeErrorText(err, t.form) });
      return;
    }
    const res = await recordUntilSettled(() => recordRevocationAction({ chainId, txHash: hash }), retryDelaysMs, () => alive.current);
    if (res === null) return;
    if (res === "pending") return set(uid, { phase: "idle", error: t.form.pending });
    if (!res.ok) return set(uid, { phase: "idle", error: t.form.errors[res.error] ?? t.form.errors.unknown });
    set(uid, { phase: "revoked", error: null });
    router.refresh();
  }

  if (given.length === 0) return <p className="text-sm text-fg-muted">{t.given.empty}</p>;

  const lookup = localizedPath(lang, "vouches");
  return (
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
                  <a href={localizedPath(lang, "pay", { target: g.recipientAlias })} className="text-accent underline-offset-4 hover:underline">
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
                <Button type="button" variant="outline" onClick={() => withdraw(g.uid)} disabled={s.phase === "busy"}>
                  {s.phase === "busy" ? <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" /> : <Undo2 aria-hidden />}
                  {s.phase === "busy" ? t.given.revoking : t.given.revoke}
                </Button>
              )}
              <div aria-live="polite">{s.error ? <p className="text-sm text-danger">{s.error}</p> : null}</div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
