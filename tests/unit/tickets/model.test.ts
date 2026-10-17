import { describe, expect, it } from "vitest";
import { linkifyPlainText, validateBody, validateSubject } from "@/lib/tickets/model";

describe("validateSubject", () => {
  it("trims and accepts 3 to 120 characters", () => {
    expect(validateSubject("  Ayuda  ")).toEqual({ ok: true, value: "Ayuda" });
    expect(validateSubject("a".repeat(120))).toMatchObject({ ok: true });
  });
  it.each(["", "  ab ", "a".repeat(121), 42, null])("rejects %j", (v) => {
    expect(validateSubject(v)).toEqual({ ok: false });
  });
});

describe("validateBody", () => {
  it("trims and accepts 1 to 4000 characters", () => {
    expect(validateBody(" hola\n\nmundo ")).toEqual({ ok: true, value: "hola\n\nmundo" });
    expect(validateBody("a".repeat(4000))).toMatchObject({ ok: true });
  });
  it.each(["", "   \n ", "a".repeat(4001), undefined])("rejects %j", (v) => {
    expect(validateBody(v)).toEqual({ ok: false });
  });
});

describe("linkifyPlainText", () => {
  it("returns a single text part when links are not allowed", () => {
    expect(linkifyPlainText("mira https://a.com ya", false)).toEqual([{ type: "text", value: "mira https://a.com ya" }]);
  });
  it("splits http and https urls and keeps trailing punctuation out of them", () => {
    expect(linkifyPlainText("ve a https://a.com/x, o http://b.org.", true)).toEqual([
      { type: "text", value: "ve a " },
      { type: "url", value: "https://a.com/x" },
      { type: "text", value: ", o " },
      { type: "url", value: "http://b.org" },
      { type: "text", value: "." },
    ]);
  });
  it("never links other schemes", () => {
    const parts = linkifyPlainText("javascript:alert(1) ftp://x.com data:text/html,hi", true);
    expect(parts).toEqual([{ type: "text", value: "javascript:alert(1) ftp://x.com data:text/html,hi" }]);
  });
  it("keeps newlines untouched", () => {
    expect(linkifyPlainText("a\n\nb", true)).toEqual([{ type: "text", value: "a\n\nb" }]);
  });
});
