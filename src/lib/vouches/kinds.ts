/** Vouch kinds the app signs (P5-R2). Anything else read from the chain is shown as "other". */
export const VOUCH_KINDS = [1, 2, 3] as const;
export type VouchKind = (typeof VOUCH_KINDS)[number];

export function isVouchKind(n: unknown): n is VouchKind {
  return typeof n === "number" && (VOUCH_KINDS as readonly number[]).includes(n);
}

export type VouchKindKey = "in_person" | "worked_together" | "reliable_trade" | "other";

const KEYS: Record<VouchKind, VouchKindKey> = { 1: "in_person", 2: "worked_together", 3: "reliable_trade" };

export function vouchKindKey(n: number): VouchKindKey {
  return isVouchKind(n) ? KEYS[n] : "other";
}
