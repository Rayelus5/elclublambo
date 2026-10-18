import { describe, expect, it } from "vitest";
import { formatBps, formatShares, formatUsdc } from "@/lib/treasury/format";

describe("treasury format", () => {
  it("formats USDC with a decimal comma and grouped thousands", () => {
    expect(formatUsdc(0n)).toBe("0 USDC");
    expect(formatUsdc(20_000_000n)).toBe("20 USDC");
    expect(formatUsdc(1_234_567_500_000n)).toBe("1.234.567,5 USDC");
    expect(formatUsdc(1_500_000n)).toBe("1,5 USDC");
  });
  it("formats basis points as a percentage with a decimal comma", () => {
    expect(formatBps(0)).toBe("0 %");
    expect(formatBps(20)).toBe("0,2 %");
    expect(formatBps(100)).toBe("1 %");
    expect(formatBps(1234)).toBe("12,34 %");
    expect(formatBps(10_000)).toBe("100 %");
  });
  it("shows shares compactly without float rounding of huge values", () => {
    expect(formatShares(0n)).toBe("0");
    expect(formatShares(999n)).toBe("999");
    expect(formatShares(12_345n)).toBe("12.345");
    expect(formatShares(20_000_000_000_000_000_000n)).toBe("2,0·10¹⁹");
    expect(formatShares(1_234_567_890_123_456_789n)).toBe("1,2·10¹⁸");
  });
});
