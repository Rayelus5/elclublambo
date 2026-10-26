// «Repartir gastos» (P6-R4): equal shares and a greedy settlement, in USDC base units (6 decimals). Pure.

/** `target` is where the person gets paid: an address or an ElClub Pay alias. */
export type Participant = { name: string; paid: bigint; target: string | null };
/** `from` pays `amount` to `to` (indices into the participants). */
export type Transfer = { from: number; to: number; amount: bigint };

/** `total` split into `n` equal shares; the remainder goes one base unit at a time to the first participants. */
export function shares(total: bigint, n: number): bigint[] {
  if (n <= 0) return [];
  const count = BigInt(n);
  const base = total / count;
  const rest = Number(total % count);
  return Array.from({ length: n }, (_, i) => (i < rest ? base + 1n : base));
}

/** The index with the largest value > 0 in `xs`; a tie goes to the later index. -1 when none is > 0. */
function largest(xs: readonly bigint[]): number {
  let best = -1;
  for (let i = 0; i < xs.length; i++) if (xs[i]! > 0n && (best < 0 || xs[i]! >= xs[best]!)) best = i;
  return best;
}

/**
 * Who pays whom so everyone ends at exactly paid − share. Greedy: the largest debtor pays the largest creditor the
 * smaller of the two amounts, so each transfer clears at least one of them (at most n − 1 transfers; the last one
 * clears both). Ties go to the later index, so the result is deterministic. Never a transfer of 0. The amounts sum
 * exactly to the debts: the balances add up to 0 by construction of `shares`.
 */
export function settle(ps: readonly Participant[]): Transfer[] {
  const total = ps.reduce((s, x) => s + x.paid, 0n);
  const sh = shares(total, ps.length);
  const credit = ps.map((x, i) => x.paid - sh[i]!);
  const debt = credit.map((b) => -b);
  const out: Transfer[] = [];
  for (;;) {
    const from = largest(debt);
    const to = largest(credit);
    if (from < 0 || to < 0) return out;
    const amount = debt[from]! < credit[to]! ? debt[from]! : credit[to]!;
    out.push({ from, to, amount });
    debt[from] = debt[from]! - amount;
    credit[from] = -debt[from]!;
    credit[to] = credit[to]! - amount;
    debt[to] = -credit[to]!;
  }
}
