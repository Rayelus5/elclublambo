import { describe, expect, it } from "vitest";
import fixture from "../../fixtures/handles.json";
import { HANDLE_RE, normalizeHandle, RESERVED_HANDLES } from "@/lib/members/handle";

describe("normalizeHandle (parity with SQL fixture)", () => {
  for (const c of fixture.cases) {
    it(`${JSON.stringify(c.input)}`, () => {
      const r = normalizeHandle(c.input);
      if ("result" in c) expect(r).toEqual({ ok: true, handle: c.result });
      else expect(r).toEqual({ ok: false, error: c.error });
    });
  }

  it("rejects every reserved handle, in any case", () => {
    expect(RESERVED_HANDLES).toEqual(fixture.reserved);
    for (const h of fixture.reserved) {
      expect(normalizeHandle(h.toUpperCase())).toEqual({ ok: false, error: "handle_reserved" });
    }
  });

  it("rejects dashes, dots and accents", () => {
    for (const s of ["a-b-c", "a.b.c", "ñandú", "ab c"]) {
      expect(normalizeHandle(s)).toEqual({ ok: false, error: "handle_invalid" });
    }
  });

  it("exposes the format regex", () => {
    expect(HANDLE_RE.test("ray_l")).toBe(true);
    expect(HANDLE_RE.test("Ray")).toBe(false);
  });
});
