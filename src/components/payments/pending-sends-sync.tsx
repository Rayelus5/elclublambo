"use client";

import { useEffect } from "react";
import type { ChainId } from "@/lib/economy/networks";
import { IN_FLIGHT_TTL_MS, loadSends, patchSend, PERMANENT_ATTACH_CODES, pruneUnsupportedSends, removeSend } from "@/lib/payments/pending-sends";
import { endsPaymentFlow } from "@/lib/payments/outcomes";
import { attachTxAction, verifyIntentAction } from "@/lib/payments/tip-actions";

/**
 * Next visit after an interrupted send: attach a hash the server was never told about, then verify once. Leftovers
 * that can never complete here (fee era, disabled chain) are dropped first (Review Focus 4). Entries that confirmed or
 * failed for good (F3-R3: a definitive code, never a transient error) are dropped, and so are those with a permanent
 * attach error. Silent apart from logging.
 */
export function PendingSendsSync({ memberId, enabledChainIds }: { memberId: string; enabledChainIds: readonly ChainId[] }) {
  const enabledKey = enabledChainIds.join(",");
  useEffect(() => {
    let cancelled = false;
    pruneUnsupportedSends(memberId, enabledKey === "" ? [] : (enabledKey.split(",").map(Number) as ChainId[]));
    void (async () => {
      for (const entry of loadSends(memberId)) {
        if (cancelled) return;
        try {
          if (!entry.mainHash) {
            // Nothing signed: keep it only while a signature may still be pending in the wallet.
            const pending = typeof entry.inFlight === "number" && Date.now() - entry.inFlight < IN_FLIGHT_TTL_MS;
            if (!pending) removeSend(memberId, entry.intentId);
            continue;
          }
          if (!entry.mainAttached) {
            const r = await attachTxAction(entry.intentId, "main", entry.mainHash);
            if (r.ok) patchSend(memberId, entry.intentId, { mainAttached: true });
            else if (PERMANENT_ATTACH_CODES.has(r.code)) {
              removeSend(memberId, entry.intentId);
              continue;
            } else console.warn("pending-sends: attach failed", entry.intentId, r.code);
          }
          const v = await verifyIntentAction(entry.intentId);
          if (endsPaymentFlow(v)) removeSend(memberId, entry.intentId);
        } catch (e) {
          console.warn("pending-sends: sync failed", entry.intentId, e);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [memberId, enabledKey]);
  return null;
}
