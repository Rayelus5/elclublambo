import { describe, expect, it } from "vitest";
import { keccak256, type Hex } from "viem";
import fixture from "../../fixtures/raffle-draw.json";
import { pickWinner, raffleCommit, raffleRandom, verifyDraw } from "@/lib/treasury/raffle-draw";

type Draw = {
  name: string;
  seed: Hex;
  blockHash: Hex;
  weights: string[];
  commit: Hex;
  random: string;
  winnerPosition: number | null;
};
const draws = fixture.draws as Draw[];
const weightsOf = (d: Draw) => d.weights.map((w) => BigInt(w));

describe("keccak fixture (viem)", () => {
  it("covers the padding boundaries of F4d-R1", () => {
    expect(fixture.keccak.map((k) => k.bytes)).toEqual([0, 3, 64, 135, 136, 137, 272, 300]);
    for (const k of fixture.keccak) expect((k.input.length - 2) / 2).toBe(k.bytes);
  });

  it.each(fixture.keccak)("$note", (k) => {
    expect(keccak256(k.input as Hex)).toBe(k.hash);
  });

  it("holds the two published vectors", () => {
    expect(fixture.keccak[0]).toMatchObject({
      input: "0x",
      hash: "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
    });
    expect(fixture.keccak[1]).toMatchObject({
      input: "0x616263",
      hash: "0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45",
    });
  });
});

describe("pickWinner", () => {
  it("walks the running sum and picks the first position whose sum is > r", () => {
    expect(pickWinner(0n, [0n, 5n, 3n])).toBe(2);
    expect(pickWinner(4n, [0n, 5n, 3n])).toBe(2);
    expect(pickWinner(5n, [0n, 5n, 3n])).toBe(3);
    expect(pickWinner(8n, [0n, 5n, 3n])).toBe(2); // 8 mod 8 = 0
  });

  it("returns null when nobody can win", () => {
    expect(pickWinner(7n, [0n, 0n])).toBeNull();
    expect(pickWinner(1n, [])).toBeNull();
  });
});

describe("draw fixture", () => {
  it("has the five required shapes", () => {
    expect(draws.map((d) => d.name)).toEqual(["equal-3", "weighted-1e18-zero-middle", "single", "all-zero", "empty"]);
    expect(draws.filter((d) => d.winnerPosition === null).map((d) => d.name)).toEqual(["all-zero", "empty"]);
  });

  it.each(draws)("$name gives its commit, random and winner", (d) => {
    expect(raffleCommit(d.seed)).toBe(d.commit);
    const random = raffleRandom(d.seed, d.blockHash);
    expect(random.toString()).toBe(d.random);
    expect(pickWinner(random, weightsOf(d))).toBe(d.winnerPosition);
    expect(verifyDraw({ ...d, weights: weightsOf(d) })).toMatchObject({
      commitOk: true,
      winnerOk: true,
      random,
      position: d.winnerPosition,
    });
  });
});

describe("verifyDraw", () => {
  const d = draws[1]!;

  it("reports the total and r = random mod total", () => {
    const weights = weightsOf(d);
    const total = weights.reduce((a, b) => a + b, 0n);
    const v = verifyDraw({ ...d, weights });
    expect(v.total).toBe(total);
    expect(v.r).toBe(BigInt(d.random) % total);
  });

  it("flags a seed whose hash is not the commit", () => {
    const v = verifyDraw({ ...d, seed: draws[0]!.seed, weights: weightsOf(d) });
    expect(v.commitOk).toBe(false);
  });

  it("flags a wrong winner position", () => {
    const wrong = d.winnerPosition === 1 ? 3 : 1;
    const v = verifyDraw({ ...d, weights: weightsOf(d), winnerPosition: wrong });
    expect(v).toMatchObject({ commitOk: true, winnerOk: false, position: d.winnerPosition });
  });

  it("flags a claimed winner when nobody can win, and accepts null there", () => {
    const zero = draws[3]!;
    expect(verifyDraw({ ...zero, weights: weightsOf(zero) })).toMatchObject({ total: 0n, r: 0n, position: null, winnerOk: true });
    expect(verifyDraw({ ...zero, weights: weightsOf(zero), winnerPosition: 1 }).winnerOk).toBe(false);
  });
});
