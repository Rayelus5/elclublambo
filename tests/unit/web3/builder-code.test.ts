import { describe, expect, it, vi } from "vitest";
import { ERC8021_MARKER, builderCodeSuffix, dataSuffixFor } from "@/lib/web3/builder-code";

const REAL = "0x62635f747478756c7962760b0080218021802180218021802180218021";

describe("builderCodeSuffix (ERC-8021 schema 0)", () => {
  it("matches the ox Attribution.toDataSuffix vector", () => {
    expect(builderCodeSuffix(["baseapp", "morpho"])).toBe(
      "0x626173656170702c6d6f7270686f0e0080218021802180218021802180218021",
    );
  });
  it("encodes a single code as codes || length || 0x00 || marker", () => {
    expect(builderCodeSuffix(["bc_ttxulybv"])).toBe(REAL);
    expect(ERC8021_MARKER).toBe("0x80218021802180218021802180218021");
  });
  it("rejects codes outside the allowed format", () => {
    expect(() => builderCodeSuffix(["a,b"])).toThrow();
    expect(() => builderCodeSuffix([""])).toThrow();
    expect(() => builderCodeSuffix(["x".repeat(33)])).toThrow();
  });
});

describe("dataSuffixFor", () => {
  it("returns the suffix on the base chains", () => {
    expect(dataSuffixFor(84532, "bc_ttxulybv")).toBe(REAL);
    expect(dataSuffixFor(8453, "bc_ttxulybv")).toBe(REAL);
  });
  it("returns undefined on Arbitrum or with an empty code", () => {
    expect(dataSuffixFor(42161, "bc_ttxulybv")).toBeUndefined();
    expect(dataSuffixFor(421614, "bc_ttxulybv")).toBeUndefined();
    expect(dataSuffixFor(84532, "")).toBeUndefined();
  });
  it("logs and returns undefined on a malformed code instead of breaking the payment (readiness enforces it in PRO)", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(dataSuffixFor(84532, "not a code!")).toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});
