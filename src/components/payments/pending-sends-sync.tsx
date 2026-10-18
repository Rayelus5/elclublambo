"use client";

import { useEffect } from "react";
import { IN_FLIGHT_TTL_MS, loadSends, patchSend, PERMANENT_ATTACH_CODES, remainingMs, removeSend } from "@/lib/payments/pending-sends";
import { attachTxAction, verifyIntentAction } from "@/lib/payments/tip-actions";

/**
 * Next visit after an interrupted send: attach any hash the server was never told about, then verify once. Entries
 * that confirmed or failed are dropped, and so are those that can never complete (intent expired, permanent attach
 * error). Silent apart from logging.
 */
export function PendingSendsSync({ memberId }: { memberId: string }) {
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const entry of loadSends(memberId)) {
        if (cancelled) return;
        try {
          if (!entry.feeHash && !entry.mainHash) {
            // Nothing signed: keep it only while a signature may still be pending in the wallet.
            const pending = typeof entry.inFlight === "number" && Date.now() - entry.inFlight < IN_FLIGHT_TTL_MS;
            if (!pending) removeSend(memberId, entry.intentId);
            continue;
          }
          let permanent = false;
          for (const role of ["fee", "main"] as const) {
            const hash = entry[`${role}Hash`];
            if (!hash || entry[`${role}Attached`]) continue;
            const r = await attachTxAction(entry.intentId, role, hash);
            if (r.ok) patchSend(memberId, entry.intentId, { [`${role}Attached`]: true });
            else if (PERMANENT_ATTACH_CODES.has(r.code)) {
              permanent = true;
              break;
            } else console.warn("pending-sends: attach failed", entry.intentId, role, r.code);
          }
          if (permanent) {
            removeSend(memberId, entry.intentId);
            continue;
          }
          // Fee paid but the tip itself never signed: nothing to verify; the dialog offers to resume it until the
          // intent expires.
          if (!entry.mainHash) {
            if (remainingMs(entry.intent) <= 0) removeSend(memberId, entry.intentId);
            continue;
          }
          const v = await verifyIntentAction(entry.intentId);
          if (v.status === "confirmed" || v.status === "failed" || v.status === "pending_finality") removeSend(memberId, entry.intentId);
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
