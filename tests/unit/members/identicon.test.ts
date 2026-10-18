import { describe, expect, it } from "vitest";
import { identicon } from "@/lib/members/identicon";

const A = "0x1234567890abcdef1234567890abcdef12345678";
const B = "0xfedcba0987654321fedcba0987654321fedcba09";

describe("identicon", () => {
  it("is deterministic and case-insensitive", () => {
    expect(identicon(A)).toEqual(identicon(A));
    expect(identicon("0x1234567890ABCDEF1234567890ABCDEF12345678")).toEqual(identicon(A));
  });
  it("differs between wallets", () => {
    expect(identicon(A)).not.toEqual(identicon(B));
  });
  it("is a mirrored 5x5 grid with a valid hue", () => {
    for (const w of [A, B]) {
      const { cells, hue } = identicon(w);
      expect(cells).toHaveLength(25);
      for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) expect(cells[r * 5 + c]).toBe(cells[r * 5 + 4 - c]);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });
});
