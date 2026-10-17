export type TriState = "inherit" | "allow" | "deny";

export function getState(allow: bigint, deny: bigint, bit: bigint): TriState {
  if ((allow & bit) !== 0n) return "allow";
  if ((deny & bit) !== 0n) return "deny";
  return "inherit";
}

export function cycleState(s: TriState): TriState {
  return s === "inherit" ? "allow" : s === "allow" ? "deny" : "inherit";
}

export function setState(allow: bigint, deny: bigint, bit: bigint, s: TriState): { allow: bigint; deny: bigint } {
  const a = allow & ~bit;
  const d = deny & ~bit;
  return { allow: s === "allow" ? a | bit : a, deny: s === "deny" ? d | bit : d };
}
