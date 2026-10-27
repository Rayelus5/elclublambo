import { render, screen } from "@testing-library/react";
import { use } from "react";
import { describe, expect, it, vi } from "vitest";

const never = new Promise<never>(() => {});
vi.mock("@/components/landing/landing-live", () => ({
  LandingLive: () => {
    use(never);
    return null;
  },
}));
vi.mock("@/components/landing/intro-gate", () => ({ IntroGate: () => null }));

import PublicHome from "@/app/(public)/[lang]/page";

describe("landing page", () => {
  it("its Suspense fallback is already the #main target («Saltar» and the gate's focus land there)", async () => {
    const ui = await PublicHome({ params: Promise.resolve({ lang: "es" }) } as Parameters<typeof PublicHome>[0]);
    render(ui);
    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", "main");
    expect(main).toHaveAttribute("tabindex", "-1");
  });
});
