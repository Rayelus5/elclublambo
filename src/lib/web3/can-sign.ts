export type CanSign = { ok: true } | { ok: false; reason: "not_connected" | "wrong_wallet" | "session_mismatch" };

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Only the owner signs (Review Focus 2): the connected wallet must be `owner` and, with a SIWE session, the session's
 * wallet must be `owner` too. Case-insensitive. Pure: the UI shows the reason and never asks for a signature otherwise.
 */
export function canSignFor(owner: string, connected: string | undefined, sessionWallet: string | null): CanSign {
  if (!connected) return { ok: false, reason: "not_connected" };
  if (!same(connected, owner)) return { ok: false, reason: "wrong_wallet" };
  if (sessionWallet !== null && !same(sessionWallet, owner)) return { ok: false, reason: "session_mismatch" };
  return { ok: true };
}
