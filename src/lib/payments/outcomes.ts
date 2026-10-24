// Which payment outcomes are final (ruling F3-R3). Shared by the server (what fails an intent for good) and the client
// (what ends a payment flow and drops its local ledger entry). Anything else, including every transient read or RPC
// error, leaves the flow pending: the money may already have left the wallet, so a doubt is never shown as a failure.

/**
 * Failure codes that can never get better. The server only ever stores these on a failed intent (fail_intent), and
 * only these end a flow on the client. `not_found` reaches the client only when a read succeeded with no row.
 * `invalid_input` covers rechecks that can never pass (the intent no longer describes its target) and malformed ids;
 * `reverted` is a donation whose transfer stopped verifying (ruling F3d-R6); `platform_not_configured` is a legacy intent
 * charging a fee with no platform address snapshotted, which no retry can fix; `chain_disabled` is an intent on a
 * network this build no longer uses (a Linea leftover, Review Focus 4).
 */
export const DEFINITIVE_FAILURE_CODES: ReadonlySet<string> = new Set([
  "tx_mismatch",
  "tx_failed",
  "tx_too_old",
  "tx_already_used",
  "already_paid",
  "intent_expired",
  "forbidden",
  "not_found",
  "invalid_input",
  "reverted",
  "platform_not_configured",
  "chain_disabled",
]);

export function isDefinitiveFailure(code: string | null | undefined): boolean {
  return typeof code === "string" && DEFINITIVE_FAILURE_CODES.has(code);
}

/** A verification result that ends the flow: credited (or recorded, for a donation) or failed for good. */
export function endsPaymentFlow(r: { status: string; code?: string }): boolean {
  return r.status === "confirmed" || r.status === "pending_finality" || (r.status === "failed" && isDefinitiveFailure(r.code));
}
