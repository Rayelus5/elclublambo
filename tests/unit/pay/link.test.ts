import { describe, expect, it } from "vitest";
import { buildPayUrl, parsePayQuery } from "@/lib/pay/link";
import { normalizeAlias } from "@/lib/pay/alias";

const ORIGIN = "https://www.elclub.party";

describe("buildPayUrl", () => {
  it("builds the Spanish and English links without options", () => {
    expect(buildPayUrl(ORIGIN, "es", "rayelus")).toBe("https://www.elclub.party/pay/rayelus");
    expect(buildPayUrl(ORIGIN, "en", "rayelus")).toBe("https://www.elclub.party/en/pay/rayelus");
  });

  it("adds the amount and the asset, with a dot decimal", () => {
    expect(buildPayUrl(ORIGIN, "es", "rayelus", { amount: "12,5", asset: "USDC:84532" })).toBe(
      "https://www.elclub.party/pay/rayelus?amount=12.5&asset=USDC:84532",
    );
    expect(buildPayUrl(ORIGIN, "en", "rayelus", { amount: "5" })).toBe("https://www.elclub.party/en/pay/rayelus?amount=5");
    expect(buildPayUrl(ORIGIN, "en", "rayelus", { asset: "ETH:84532" })).toBe("https://www.elclub.party/en/pay/rayelus?asset=ETH:84532");
  });

  it("ignores a trailing slash on the origin and an empty amount", () => {
    expect(buildPayUrl(`${ORIGIN}/`, "es", "rayelus", { amount: "  " })).toBe("https://www.elclub.party/pay/rayelus");
  });
});

describe("parsePayQuery", () => {
  it("reads a valid amount and asset", () => {
    expect(parsePayQuery(new URLSearchParams("amount=12.5&asset=USDC:84532"))).toEqual({ amount: "12.5", asset: "USDC:84532" });
    expect(parsePayQuery({ amount: "3", asset: "ETH:421614" })).toEqual({ amount: "3", asset: "ETH:421614" });
  });

  it("drops invalid values", () => {
    expect(parsePayQuery(new URLSearchParams("amount=-1&asset=DOGE:1"))).toEqual({ amount: null, asset: null });
    expect(parsePayQuery({ amount: ["1", "2"], asset: "USDC:1" })).toEqual({ amount: null, asset: null });
    expect(parsePayQuery({ amount: "0" })).toEqual({ amount: null, asset: null });
    expect(parsePayQuery({ amount: "1e9" })).toEqual({ amount: null, asset: null });
  });

  it("drops an amount with more decimals than the asset has", () => {
    expect(parsePayQuery({ amount: "1.1234567", asset: "USDC:84532" }).amount).toBeNull();
  });

  it("drops assets of other environments or of networks the recipient does not accept", () => {
    expect(parsePayQuery({ asset: "USDC:8453" }).asset).toBeNull();
    expect(parsePayQuery({ asset: "USDC:421614" }, ["base"]).asset).toBeNull();
    expect(parsePayQuery({ asset: "USDC:84532" }, ["base"]).asset).toBe("USDC:84532");
  });
});

describe("normalizeAlias", () => {
  it("lower-cases and trims", () => {
    expect(normalizeAlias("  Rayelus_1 ")).toEqual({ ok: true, alias: "rayelus_1" });
  });
  it("rejects bad shapes and look-alikes", () => {
    expect(normalizeAlias("ab")).toEqual({ ok: false, error: "alias_invalid" });
    expect(normalizeAlias("a-b-c")).toEqual({ ok: false, error: "alias_invalid" });
    expect(normalizeAlias("rаyelus")).toEqual({ ok: false, error: "alias_invalid" });
  });
  it("rejects reserved words, including route words", () => {
    expect(normalizeAlias("admin")).toEqual({ ok: false, error: "alias_reserved" });
    expect(normalizeAlias("Donar")).toEqual({ ok: false, error: "alias_reserved" });
    expect(normalizeAlias("elclubpay")).toEqual({ ok: false, error: "alias_reserved" });
  });
});
