import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/economy/config", () => ({ getEconomyConfig: async () => ({ minFeeBps: 100 }) }));

import { GuideContent, isComingSoon } from "@/components/guide/guide-content";

describe("guide: propinas", () => {
  it("is no longer marked as coming soon", () => {
    expect(isComingSoon("propinas")).toBe(false);
    expect(isComingSoon("bounties")).toBe(true);
  });
  it("warns that ETH tips need a plain wallet", () => {
    render(<GuideContent slug="propinas" />);
    expect(
      screen.getByText(/Las propinas en ETH deben enviarse desde una wallet normal \(EOA\); las smart wallets \(Safe, cuentas ERC-4337\) no se pueden verificar todavía\./),
    ).toBeInTheDocument();
  });
});
