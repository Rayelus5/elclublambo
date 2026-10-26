import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeSplit, encodeSplit, MAX_AMOUNT_INPUT, MAX_NAME, MAX_PEOPLE, MAX_SPLIT_FRAGMENT, validTarget, type SplitState } from "@/lib/split/state";

const ADDR = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const STATE: SplitState = {
  v: 1,
  people: [
    { n: "Ana", p: "30", t: ADDR },
    { n: "Bea", p: "0" },
    { n: "Ñandú 🐦", p: "12,5", t: "carlos" },
  ],
};

function plain(json: unknown): string {
  const bytes = new TextEncoder().encode(typeof json === "string" ? json : JSON.stringify(json));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `j1.${btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

afterEach(() => vi.unstubAllGlobals());

describe("split state in the fragment", () => {
  it("round-trips compressed (v1.)", async () => {
    const enc = await encodeSplit(STATE);
    expect(enc.startsWith("v1.")).toBe(true);
    expect(await decodeSplit(enc)).toEqual(STATE);
    expect(await decodeSplit(`#gastos=${enc}`)).toEqual(STATE);
  });

  it("round-trips plain (j1.) without CompressionStream", async () => {
    vi.stubGlobal("CompressionStream", undefined);
    const enc = await encodeSplit(STATE);
    expect(enc.startsWith("j1.")).toBe(true);
    expect(await decodeSplit(`#gastos=${enc}`)).toEqual(STATE);
  });

  it("rejects tampered fragments: 21 people, a 30-character name, an amount of -1, broken JSON", async () => {
    const people21 = Array.from({ length: 21 }, (_, i) => ({ n: `P${i}`, p: "1" }));
    expect(await decodeSplit(plain({ v: 1, people: people21 }))).toBeNull();
    expect(await decodeSplit(plain({ v: 1, people: [{ n: "x".repeat(30), p: "1" }] }))).toBeNull();
    expect(await decodeSplit(plain({ v: 1, people: [{ n: "A", p: "-1" }] }))).toBeNull();
    expect(await decodeSplit(plain("{\"v\":1,\"people\":["))).toBeNull();
  });

  it("rejects the wrong version, a bad target, extra decimals, garbage and an oversized fragment", async () => {
    expect(await decodeSplit(plain({ v: 2, people: [{ n: "A", p: "1" }] }))).toBeNull();
    expect(await decodeSplit(plain({ v: 1, people: [{ n: "A", p: "1", t: "0x123" }] }))).toBeNull();
    expect(await decodeSplit(plain({ v: 1, people: [{ n: "A", p: "1.1234567" }] }))).toBeNull();
    expect(await decodeSplit(plain({ v: 1, people: [] }))).toBeNull();
    expect(await decodeSplit("v1.@@@")).toBeNull();
    expect(await decodeSplit("v1.AAAA")).toBeNull();
    expect(await decodeSplit("x1.AAAA")).toBeNull();
    expect(await decodeSplit(`j1.${"A".repeat(MAX_SPLIT_FRAGMENT + 1)}`)).toBeNull();
  });

  it("rejects a compressed bomb that inflates past the cap", async () => {
    const huge = { v: 1, people: [{ n: "A", p: "1", pad: " ".repeat(200_000) }] };
    const bytes = new TextEncoder().encode(JSON.stringify(huge));
    const stream = new Response(bytes).body!.pipeThrough(new CompressionStream("deflate-raw"));
    const out = new Uint8Array(await new Response(stream).arrayBuffer());
    let bin = "";
    for (const b of out) bin += String.fromCharCode(b);
    const enc = `v1.${btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
    expect(enc.length).toBeLessThan(MAX_SPLIT_FRAGMENT);
    expect(await decodeSplit(enc)).toBeNull();
  });

  it("drops unknown keys and keeps only n, p and t", async () => {
    const got = await decodeSplit(plain({ v: 1, extra: true, people: [{ n: "A", p: "1", x: 1 }] }));
    expect(got).toEqual({ v: 1, people: [{ n: "A", p: "1" }] });
  });

  it("validTarget uses the multisend list's address check: a wrong EIP-55 checksum is rejected", () => {
    expect(validTarget(ADDR)).toBe(true);
    expect(validTarget(ADDR.toLowerCase())).toBe(true);
    expect(validTarget(`0x${ADDR.slice(2).toUpperCase()}`)).toBe(true);
    expect(validTarget("0x90f79bf6EB2c4f870365E785982E1f101E93b906")).toBe(false);
    expect(validTarget("carlos")).toBe(true);
  });

  it("a maxed split (20 people, worst-case names, amounts at maxLength, full addresses) fits the fragment cap, even uncompressed", async () => {
    vi.stubGlobal("CompressionStream", undefined);
    // Control characters are the worst case for JSON: each one becomes \u00XX (6 bytes).
    const name = "\u0001".repeat(MAX_NAME);
    const paid = `${"9".repeat(MAX_AMOUNT_INPUT - 7)},999999`;
    expect(paid).toHaveLength(MAX_AMOUNT_INPUT);
    const state: SplitState = { v: 1, people: Array.from({ length: MAX_PEOPLE }, () => ({ n: name, p: paid, t: ADDR })) };
    const enc = await encodeSplit(state);
    expect(enc.startsWith("j1.")).toBe(true);
    expect(enc.length).toBeLessThanOrEqual(MAX_SPLIT_FRAGMENT);
    expect(await decodeSplit(enc)).toEqual(state);
  });
});
