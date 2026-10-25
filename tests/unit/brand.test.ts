import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The brand is «ElClub.»: the old "El Club Lambo" / "El Club" names must not come back in these user-facing strings.
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("brand ElClub.", () => {
  it("the root layout's default title is «ElClub.»", () => {
    expect(read("src/app/layout.tsx")).toMatch(/title: "ElClub\."/);
  });
  it("the welcome page says «Bienvenida a ElClub.»", () => {
    const src = read("src/app/foro/(onboarding)/bienvenida/page.tsx");
    expect(src).toContain("Bienvenida a ElClub.");
    expect(src).not.toContain("Bienvenida a El Club<");
  });
  it("the Base Account stub names ElClub.", async () => {
    const { createBaseAccountSDK } = await import("@/lib/web3/stubs/base-account");
    expect(() => createBaseAccountSDK()).toThrow("Base Account no está habilitado en ElClub.");
  });
});
