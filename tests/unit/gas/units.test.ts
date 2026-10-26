// @vitest-environment node
import { describe, expect, it } from "vitest";
import { convert, formatWei, usdFromWei } from "@/lib/gas/units";

const PRICE = 2000_00000000n; // 2000 USD, 8 decimals

describe("convert", () => {
  it("1 gwei without a price: wei and ETH, USD empty", () => {
    expect(convert("1", "gwei", null)).toEqual({ wei: "1000000000", gwei: "1", eth: "0.000000001", usd: "" });
  });

  it("accepts a decimal comma: 0,5 ETH at 2000 USD is 1000.00 USD", () => {
    const r = convert("0,5", "eth", PRICE);
    expect(r?.usd).toBe("1000.00");
    expect(r?.wei).toBe("500000000000000000");
    expect(r?.gwei).toBe("500000000");
  });

  it("1 wei is 18 decimals of ETH", () => {
    expect(convert("1", "wei", PRICE)?.eth).toBe("0.000000000000000001");
  });

  it("from USD with a price", () => {
    expect(convert("1", "usd", PRICE)).toEqual({ wei: "500000000000000", gwei: "500000", eth: "0.0005", usd: "1.00" });
    expect(convert("12.345", "usd", PRICE)?.usd).toBe("12.34");
  });

  it("rejects invalid input and USD without a price", () => {
    expect(convert("abc", "eth", PRICE)).toBeNull();
    expect(convert("", "eth", PRICE)).toBeNull();
    expect(convert("-1", "eth", PRICE)).toBeNull();
    expect(convert("1.2.3", "eth", PRICE)).toBeNull();
    expect(convert("1e18", "wei", PRICE)).toBeNull();
    expect(convert("1", "usd", null)).toBeNull();
    // More precision than a wei.
    expect(convert("1.5", "wei", PRICE)).toBeNull();
    expect(convert("0.0000000001", "gwei", PRICE)).toBeNull();
    expect(convert("0.0000000000000000001", "eth", PRICE)).toBeNull();
  });

  it("is exact for huge values (no floating point)", () => {
    expect(convert("123456789.123456789123456789", "eth", null)?.wei).toBe("123456789123456789123456789");
  });
});

describe("formatWei / usdFromWei", () => {
  it("formats gwei and ETH truncated to the given decimals", () => {
    expect(formatWei(23_100_000_000_000n, "gwei", 2)).toBe("23100");
    expect(formatWei(23_100_000_000_000n, "eth", 8)).toBe("0.0000231");
    expect(formatWei(23_100_000_000_000n, "eth", 6)).toBe("0.000023");
    expect(formatWei(1_234_567_890n, "gwei", 2)).toBe("1.23");
    expect(formatWei(0n, "eth", 6)).toBe("0");
  });

  it("a non-zero amount below the precision is shown as «< smallest step»", () => {
    expect(formatWei(1n, "eth", 6)).toBe("< 0.000001");
  });

  it("usdFromWei rounds to cents", () => {
    expect(usdFromWei(500_000_000_000_000_000n, PRICE)).toBe("1000.00");
    expect(usdFromWei(23_100_000_000_000n, PRICE)).toBe("0.05");
    expect(usdFromWei(0n, PRICE)).toBe("0.00");
  });
});
