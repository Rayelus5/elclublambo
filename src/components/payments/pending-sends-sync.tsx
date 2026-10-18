"use client";

import { useEffect } from "react";
import { loadSends, patchSend, removeSend } from "@/lib/payments/pending-sends";
import { attachTxAction, verifyIntentAction } from "@/lib/payments/tip-actions";

/**
 * Next visit after an interrupted send: attach any hash the server was never told about, then verify once. Entries
 * that confirmed or failed are dropped. Silent apart from logging.
 */
export function PendingSendsSync({ memberId }: { memberId: string }) {
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const entry of loadSends(memberId)) {
        if (cancelled) return;
        try {
          if (!entry.feeHash && !entry.mainHash) {
            removeSend(memberId, entry.intentId);
            continue;
          }
          for (const role of ["fee", "main"] as const) {
            const hash = entry[`${role}Hash`];
            if (!hash || entry[`${role}Attached`]) continue;
            const r = await attachTxAction(entry.intentId, role, hash);
            if (r.ok) patchSend(memberId, entry.intentId, { [`${role}Attached`]: true });
            else console.warn("pending-sends: attach failed", entry.intentId, role, r.code);
          }
          // Fee paid but the tip itself never signed: nothing to verify, the dialog offers to resume it.
          if (!entry.mainHash) continue;
          const v = await verifyIntentAction(entry.intentId);
          if (v.status === "confirmed" || v.status === "failed") removeSend(memberId, entry.intentId);
        } catch (e) {
          console.warn("pending-sends: sync failed", entry.intentId, e);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [memberId]);
  return null;
}
