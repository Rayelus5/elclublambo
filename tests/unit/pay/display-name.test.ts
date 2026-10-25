import { describe, expect, it } from "vitest";
import { normalizeDisplayName } from "@/lib/pay/display-name";

describe("normalizeDisplayName", () => {
  it("empty input is no name", () => {
    expect(normalizeDisplayName("")).toEqual({ ok: true, name: null });
  });

  it("trims Unicode whitespace and keeps 1..40 characters", () => {
    expect(normalizeDisplayName("　 Ray  ")).toEqual({ ok: true, name: "Ray" });
    expect(normalizeDisplayName("ñ".repeat(40))).toEqual({ ok: true, name: "ñ".repeat(40) });
    expect(normalizeDisplayName("n".repeat(41))).toEqual({ ok: false });
  });

  it("rejects input that is only whitespace after a Unicode trim", () => {
    for (const s of ["   ", "　", "  ", " "]) expect(normalizeDisplayName(s)).toEqual({ ok: false });
  });

  it("rejects bidi controls and zero-width characters anywhere", () => {
    for (const c of ["​", "‌", "‍", "‎", "‏", "‪", "‫", "‬", "‭", "‮", "⁦", "⁧", "⁨", "⁩", "﻿"]) {
      expect(normalizeDisplayName(`Ra${c}y`)).toEqual({ ok: false });
      expect(normalizeDisplayName(`${c}Ray`)).toEqual({ ok: false });
    }
  });

  it("rejects control characters", () => {
    expect(normalizeDisplayName("a\u0007b")).toEqual({ ok: false });
    expect(normalizeDisplayName("a\nb")).toEqual({ ok: false });
  });
});
