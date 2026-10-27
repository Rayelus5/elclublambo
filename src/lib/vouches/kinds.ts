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

/**
 * One row per kind with its distinct attesters (Review Focus 5), in the app's order. Kinds outside 1-3 all read «Otro»:
 * their attesters may overlap, so the row shows the largest of them (never an inflated sum).
 */
export function kindRows(counts: ReadonlyArray<{ kind: number; attesters: number }>): Array<{ key: VouchKindKey; attesters: number }> {
  const byKey = new Map<VouchKindKey, number>();
  for (const c of counts) {
    const key = vouchKindKey(c.kind);
    byKey.set(key, Math.max(byKey.get(key) ?? 0, c.attesters));
  }
  const order: VouchKindKey[] = [...VOUCH_KINDS.map(vouchKindKey), "other"];
  return order.filter((k) => (byKey.get(k) ?? 0) > 0).map((key) => ({ key, attesters: byKey.get(key)! }));
}
