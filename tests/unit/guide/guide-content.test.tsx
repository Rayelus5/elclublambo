import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/economy/config", () => ({ getEconomyConfig: async () => ({ minFeeBps: 100 }) }));

import { GuideContent, isComingSoon } from "@/components/guide/guide-content";

describe("guide: propinas", () => {
  it("is no longer marked as coming soon", () => {
    expect(isComingSoon("propinas")).toBe(false);
    expect(isComingSoon("bounties")).toBe(false);
    expect(isComingSoon("dao")).toBe(false);
    expect(isComingSoon("candados")).toBe(false);
  });
  it("warns that ETH tips need a plain wallet", () => {
    render(<GuideContent slug="propinas" />);
    expect(
      screen.getByText(/Las propinas en ETH deben enviarse desde una wallet normal \(EOA\); las smart wallets \(Safe, cuentas ERC-4337\) no se pueden verificar todavía\./),
    ).toBeInTheDocument();
  });
});

describe("guide: bounties", () => {
  it("explains when there is no unpaid mark because payment is impossible (F3-R1)", () => {
    render(<GuideContent slug="bounties" />);
    expect(
      screen.getByText(/Si no puedes pagar porque moderación retiró el bounty, quien lo resolvió ya no está en el club o el bounty es de otra red, no hay marca de impagado mientras dure\./),
    ).toBeInTheDocument();
  });
});

describe("guide: fondo", () => {
  it("is not coming soon", () => {
    expect(isComingSoon("fondo")).toBe(false);
  });
  it("explains the NAV, the club fund, the risk notice and what arrives later", () => {
    render(<GuideContent slug="fondo" />);
    expect(screen.getByRole("heading", { name: "Cómo se valora el fondo" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Fondo del club" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Riesgo" })).toBeInTheDocument();
    expect(
      screen.getByText(
        /Entiendo que es una donación sin esperar nada a cambio, que el fondo se invierte con riesgo y que las retiradas dependen de la disponibilidad y de la decisión del tesorero\./,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/retiradas y los sorteos llegarán más adelante/i)).toBeInTheDocument();
    expect(screen.getAllByText(/NAV/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/liquidativo/)).not.toBeInTheDocument();
    expect(screen.getByText(/empezarán desactivadas/)).toBeInTheDocument();
    expect(screen.getByText(/primera valoración/)).toBeInTheDocument();
  });
});
