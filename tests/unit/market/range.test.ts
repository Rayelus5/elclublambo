import { describe, expect, it } from "vitest";
import { parseRange } from "@/lib/market/format";

describe("parseRange", () => {
  it("defaults to 7 for missing, unknown or repeated values", () => {
    expect(parseRange(undefined)).toBe("7");
    expect(parseRange("x")).toBe("7");
    expect(parseRange(["1", "7"])).toBe("7");
    expect(parseRange("")).toBe("7");
    expect(parseRange("07")).toBe("7");
  });
  it("accepts the four ranges", () => {
    expect(parseRange("1")).toBe("1");
    expect(parseRange("7")).toBe("7");
    expect(parseRange("30")).toBe("30");
    expect(parseRange("365")).toBe("365");
  });
});
