// @vitest-environment node
import { describe, expect, it } from "vitest";
import { keccak256, type Hex } from "viem";
import { drawWinners, giveawayCommit, verifyGiveaway } from "@/lib/giveaways/draw";
import fixture from "../../fixtures/giveaway-draw.json";

const SEED = fixture.seedHex as Hex;
const RND = fixture.randomness;

describe("giveawayCommit", () => {
  it("is keccak256 of the 32 seed bytes", () => {
    expect(giveawayCommit(SEED)).toBe(keccak256(SEED));
  });
});

describe("drawWinners (P1-R10)", () => {
  it("matches the shared fixture (SQL draw_giveaway gives the same, tests/integration/giveaway-draw-parity)", () => {
    expect(fixture.expectedWinners).not.toBeNull();
    expect(drawWinners(SEED, RND, fixture.entryCount, fixture.prizeCount)).toEqual(fixture.expectedWinners);
  });

  it("is deterministic and accepts the randomness with or without 0x", () => {
    const a = drawWinners(SEED, RND, 50, 10);
    expect(drawWinners(SEED, `0x${RND}`, 50, 10)).toEqual(a);
    expect(drawWinners(SEED, RND, 50, 10)).toEqual(a);
  });

  it("never repeats a position and stays inside 1..n", () => {
    for (const n of [1, 2, 3, 7, 10, 25]) {
      const w = drawWinners(SEED, RND, n, 10);
      expect(new Set(w).size).toBe(w.length);
      expect(w.length).toBe(Math.min(n, 10));
      for (const p of w) expect(p >= 1 && p <= n).toBe(true);
    }
  });

  it("with 2 entries and 3 prizes gives 2 winners; with 0 entries none", () => {
    expect(drawWinners(SEED, RND, 2, 3)).toHaveLength(2);
    expect(drawWinners(SEED, RND, 2, 3).sort()).toEqual([1, 2]);
    expect(drawWinners(SEED, RND, 0, 3)).toEqual([]);
    expect(drawWinners(SEED, RND, 5, 0)).toEqual([]);
  });

  it("the first winner of the m-prize draw is the winner of the 1-prize draw (prizes by rank, chained hashes)", () => {
    expect(drawWinners(SEED, RND, 40, 5)[0]).toBe(drawWinners(SEED, RND, 40, 1)[0]);
    expect(drawWinners(SEED, RND, 40, 5).slice(0, 3)).toEqual(drawWinners(SEED, RND, 40, 3));
  });

  it("another seed or randomness changes the draw", () => {
    const other = `0x${"11".repeat(32)}` as Hex;
    expect(drawWinners(other, RND, 1000, 3)).not.toEqual(drawWinners(SEED, RND, 1000, 3));
    expect(drawWinners(SEED, "22".repeat(32), 1000, 3)).not.toEqual(drawWinners(SEED, RND, 1000, 3));
  });

  it("throws on malformed inputs", () => {
    expect(() => drawWinners("0x12" as Hex, RND, 3, 1)).toThrow();
    expect(() => drawWinners(SEED, "abc", 3, 1)).toThrow();
    expect(() => drawWinners(SEED, RND, -1, 1)).toThrow();
    expect(() => drawWinners(SEED, RND, 1.5, 1)).toThrow();
    expect(() => drawWinners(SEED, RND, 3, 11)).toThrow();
  });
});

describe("verifyGiveaway", () => {
  const winners = fixture.expectedWinners ?? [];
  const base = {
    commit: keccak256(SEED),
    seedReveal: SEED,
    round: BigInt(fixture.round),
    signature: fixture.signature,
    randomness: RND,
    entryCount: fixture.entryCount,
    winnerPositions: winners as (number | null)[],
  };

  it("all checks pass for the fixture", () => {
    expect(verifyGiveaway(base)).toEqual({ commitOk: true, beaconOk: true, winnersOk: true, winners });
  });

  it("flags a wrong commit, a beacon of another round and different winners independently", () => {
    expect(verifyGiveaway({ ...base, commit: keccak256("0x00") })).toMatchObject({ commitOk: false, beaconOk: true, winnersOk: true });
    expect(verifyGiveaway({ ...base, round: 1001n })).toMatchObject({ commitOk: true, beaconOk: false });
    expect(verifyGiveaway({ ...base, randomness: "00".repeat(32) })).toMatchObject({ beaconOk: false });
    const swapped = [...winners].reverse();
    expect(verifyGiveaway({ ...base, winnerPositions: swapped })).toMatchObject({ commitOk: true, beaconOk: true, winnersOk: false });
  });

  it("prizes left without entries are null in the claimed list", () => {
    const two = drawWinners(SEED, RND, 2, 3);
    expect(verifyGiveaway({ ...base, entryCount: 2, winnerPositions: [...two, null] })).toMatchObject({ winnersOk: true, winners: two });
    expect(verifyGiveaway({ ...base, entryCount: 2, winnerPositions: [...two, 1] })).toMatchObject({ winnersOk: false });
  });

  it("never throws on a malformed reveal: every check is false", () => {
    expect(verifyGiveaway({ ...base, seedReveal: "0x12" as Hex })).toEqual({ commitOk: false, beaconOk: true, winnersOk: false, winners: [] });
  });
});
