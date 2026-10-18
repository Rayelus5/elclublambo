// Pure finality-estimate helpers, usable on server and client (the RPC read lives in finality.ts).

/** Seconds until a donation mined at `minedAtSeconds` should be finalized, given the current lag. */
export function finalityEta(minedAtSeconds: number, lagSeconds: number, nowSeconds: number): number {
  return Math.max(0, minedAtSeconds + lagSeconds - nowSeconds);
}

/** "en breve" / "en unos minutos" / "en ~6 h". Deliberately coarse: finality advances in batches. */
export function formatEta(seconds: number): string {
  if (seconds <= 60) return "en breve";
  if (seconds < 30 * 60) return "en unos minutos";
  return `en ~${Math.max(1, Math.round(seconds / 3600))} h`;
}
