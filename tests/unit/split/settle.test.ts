import { describe, expect, it } from "vitest";
import { settle, shares, type Participant, type Transfer } from "@/lib/split/settle";

const U = 1_000_000n; // 1 USDC in base units
const p = (name: string, paid: bigint, target: string | null = null): Participant => ({ name, paid, target });

/** A small deterministic PRNG (mulberry32), so the random cases are the same on every run. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** paid − share per person after applying the transfers: all zero when the split is settled exactly. */
function finalBalances(ps: Participant[], ts: Transfer[]): bigint[] {
  const total = ps.reduce((s, x) => s + x.paid, 0n);
  const sh = shares(total, ps.length);
  const bal = ps.map((x, i) => x.paid - sh[i]!);
  for (const t of ts) {
    bal[t.from] = bal[t.from]! + t.amount;
    bal[t.to] = bal[t.to]! - t.amount;
  }
  return bal;
}

describe("shares", () => {
  it("total 10 among 3 → 3,333334 + 3,333333 + 3,333333, the remainder to the first, summing exactly", () => {
    const s = shares(10n * U, 3);
    expect(s).toEqual([3_333_334n, 3_333_333n, 3_333_333n]);
    expect(s.reduce((a, b) => a + b, 0n)).toBe(10n * U);
  });

  it("spreads a remainder of several units one by one over the first participants", () => {
    expect(shares(11n, 4)).toEqual([3n, 3n, 3n, 2n]);
    expect(shares(0n, 2)).toEqual([0n, 0n]);
  });
});

describe("settle", () => {
  it("A paid 30, B and C nothing → [C→A 10, B→A 10], in that deterministic order", () => {
    expect(settle([p("A", 30n * U), p("B", 0n), p("C", 0n)])).toEqual([
      { from: 2, to: 0, amount: 10n * U },
      { from: 1, to: 0, amount: 10n * U },
    ]);
  });

  it("everyone paid the same → no transfers", () => {
    expect(settle([p("A", 5n * U), p("B", 5n * U), p("C", 5n * U)])).toEqual([]);
  });

  it("is deterministic: the same input gives the same transfers", () => {
    const ps = [p("A", 7n * U), p("B", 1n), p("C", 0n), p("D", 12n * U + 345n)];
    expect(settle(ps)).toEqual(settle(ps.map((x) => ({ ...x }))));
  });

  it("an uneven total (10 among 3) settles exactly to the micro-unit", () => {
    const ps = [p("A", 10n * U), p("B", 0n), p("C", 0n)];
    const ts = settle(ps);
    expect(ts.reduce((s, t) => s + t.amount, 0n)).toBe(10n * U - 3_333_334n);
    expect(finalBalances(ps, ts)).toEqual([0n, 0n, 0n]);
  });

  it("20 random people (fixed seed) → at most 19 transfers, never 0, and every balance ends at exactly 0", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed);
      const n = seed === 1 ? 20 : 2 + Math.floor(r() * 19);
      const ps = Array.from({ length: n }, (_, i) => p(`P${i}`, r() < 0.3 ? 0n : BigInt(Math.floor(r() * 500_000_000))));
      const ts = settle(ps);
      expect(ts.length).toBeLessThanOrEqual(n - 1);
      for (const t of ts) {
        expect(t.amount > 0n).toBe(true);
        expect(t.from).not.toBe(t.to);
      }
      expect(finalBalances(ps, ts).every((b) => b === 0n)).toBe(true);
    }
  });

  it("never emits a zero transfer, even with one person or nobody paying", () => {
    expect(settle([p("A", 3n)])).toEqual([]);
    expect(settle([p("A", 0n), p("B", 0n)])).toEqual([]);
    expect(settle([])).toEqual([]);
  });
});
