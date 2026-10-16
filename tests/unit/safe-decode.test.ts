import { describe, expect, it } from "vitest";
import { safeDecode } from "@/lib/auth/safe-decode";

describe("safeDecode", () => {
  it("decodes valid percent-encoding", () => {
    expect(safeDecode("ab%20cd")).toBe("ab cd");
  });
  it("returns the raw input when malformed", () => {
    expect(safeDecode("%E0%A4%A")).toBe("%E0%A4%A");
    expect(safeDecode("%")).toBe("%");
  });
  it("leaves plain codes untouched", () => {
    expect(safeDecode("Zm9vYmFyLV8")).toBe("Zm9vYmFyLV8");
  });
});
