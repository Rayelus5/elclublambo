import { describe, expect, it } from "vitest";
import { formatBps, formatParticipaciones, formatShares, formatToken, formatUsd, formatUsdc, formatUsdPrecise } from "@/lib/treasury/format";

describe("treasury format", () => {
  it("formats USD6 values with grouped thousands and at most two decimals (truncated)", () => {
    expect(formatUsd(0n)).toBe("0 USD");
    expect(formatUsd(2_500_000_000n)).toBe("2.500 USD");
    expect(formatUsd(1_234_567_891n)).toBe("1.234,56 USD");
    expect(formatUsd(5_000_000n)).toBe("5 USD");
    expect(formatUsd(10_000n)).toBe("0,01 USD");
    expect(formatUsd(9_999n)).toBe("0 USD");
  });
  it("formats the value per participación with up to 4 decimals (truncated), all 6 if that would hide a non-zero value", () => {
    expect(formatUsdPrecise(1_255_000n)).toBe("1,255 USD");
    expect(formatUsdPrecise(1_234_567n)).toBe("1,2345 USD");
    expect(formatUsdPrecise(2_000_000n)).toBe("2 USD");
    expect(formatUsdPrecise(1_234_000_000n)).toBe("1.234 USD");
    expect(formatUsdPrecise(42n)).toBe("0,000042 USD");
    expect(formatUsdPrecise(0n)).toBe("0 USD");
  });
  it("formats token amounts by their decimals (WETH has 18 like ETH)", () => {
    expect(formatToken(10n ** 18n, "ETH")).toBe("1 ETH");
    expect(formatToken(1_500n * 10n ** 18n, "WETH")).toBe("1.500 WETH");
    expect(formatToken(25n * 10n ** 16n, "ETH")).toBe("0,25 ETH");
    expect(formatToken(5_000_000n, "USDC")).toBe("5 USDC");
  });
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

describe("formatParticipaciones", () => {
  const U = 10n ** 18n;
  it("prints whole, fractional (2 decimals, truncated), singular and tiny values", () => {
    expect(formatParticipaciones(5n * U)).toBe("5 participaciones");
    expect(formatParticipaciones(U)).toBe("1 participación");
    expect(formatParticipaciones(U / 2n)).toBe("0,5 participaciones");
    expect(formatParticipaciones(12_345n * U + (U * 129n) / 1000n)).toBe("12.345,12 participaciones");
    expect(formatParticipaciones(U / 1000n)).toBe("< 0,01 participaciones");
    expect(formatParticipaciones(0n)).toBe("0 participaciones");
  });
});
