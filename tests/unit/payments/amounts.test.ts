import { describe, expect, it } from "vitest";
import { TIP_LIMITS, TOKEN_DECIMALS, feeFor, formatAmount, parseAmount } from "@/lib/payments/amounts";

describe("parseAmount", () => {
  it("accepts comma and dot decimals", () => {
    expect(parseAmount("12,5", "USDC")).toBe(12500000n);
    expect(parseAmount("12.5", "USDC")).toBe(12500000n);
    expect(parseAmount("0,000001", "USDC")).toBe(1n);
    expect(parseAmount("0,00001", "ETH")).toBe(10n ** 13n);
    expect(parseAmount(" 3 ", "USDC")).toBe(3000000n);
    expect(parseAmount("100", "ETH")).toBe(100n * 10n ** 18n);
  });
  it("rejects invalid input", () => {
    for (const t of ["", "  ", "-1", "1,2,3", "abc", "1e3", ",", "1,", ".5", "+1", "0x10"]) {
      expect(parseAmount(t, "USDC")).toBeNull();
    }
  });
  it("rejects more decimals than the token has", () => {
    expect(parseAmount("0,0000001", "USDC")).toBeNull();
    expect(parseAmount("0,0000000000000000001", "ETH")).toBeNull();
    expect(parseAmount("0,000000000000000001", "ETH")).toBe(1n);
  });
});

describe("formatAmount", () => {
  it("formats with Spanish comma and no trailing zeros", () => {
    expect(formatAmount(12500000n, "USDC")).toBe("12,5");
    expect(formatAmount(1n, "USDC")).toBe("0,000001");
    expect(formatAmount(10n ** 13n, "ETH")).toBe("0,00001");
    expect(formatAmount(0n, "USDC")).toBe("0");
  });
  it("round-trips with parseAmount", () => {
    for (const [t, tok] of [["12,5", "USDC"], ["0,001", "ETH"], ["99999,999999", "USDC"], ["7", "ETH"]] as const) {
      expect(formatAmount(parseAmount(t, tok)!, tok)).toBe(t);
    }
  });
  // Parity with public._format_token_amount (migration 20261018600001) and pgTAP 600 cases
  // ('10 USDC' notice, '0,0125 ETH' anonymous notice) plus the formatter's documented examples.
  it.each([
    [10000000n, "USDC", "10"],
    [12500000n, "USDC", "12,5"],
    [1n, "USDC", "0,000001"],
    [10000n, "USDC", "0,01"],
    [12500000000000000n, "ETH", "0,0125"],
    [1000000000000000n, "ETH", "0,001"],
    [10n ** 13n, "ETH", "0,00001"],
    [100n * 10n ** 18n, "ETH", "100"],
  ] as const)("%s %s -> %s", (units, token, text) => {
    expect(formatAmount(units, token)).toBe(text);
  });
});

describe("feeFor", () => {
  it("rounds up", () => {
    expect(feeFor(10000000n, 260)).toBe(260000n);
    expect(feeFor(10001n, 1)).toBe(2n);
    expect(feeFor(10000n, 0)).toBe(0n);
    expect(feeFor(10000n, 5000)).toBe(5000n);
  });
});

describe("limits", () => {
  it("match the global constraints", () => {
    expect(TOKEN_DECIMALS).toEqual({ ETH: 18, USDC: 6 });
    expect(TIP_LIMITS.USDC).toEqual({ min: 10000n, max: 100000n * 10n ** 6n });
    expect(TIP_LIMITS.ETH).toEqual({ min: 10n ** 13n, max: 100n * 10n ** 18n });
  });
});
