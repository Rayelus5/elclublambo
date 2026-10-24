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

describe("guide: DAO, fund and raffles while the DAO is rebuilt (P0)", () => {
  it("are not coming soon", () => {
    expect(isComingSoon("fondo")).toBe(false);
  });
  it.each(["dao", "fondo"] as const)("%s says it is being rebuilt on Base and Arbitrum", (slug) => {
    render(<GuideContent slug={slug} />);
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/se está rehaciendo/);
    expect(text).toContain("Base");
    expect(text).toContain("Arbitrum");
    expect(text).not.toMatch(/comisión/i);
  });
  it("the fund section says raffles are being rebuilt too", () => {
    render(<GuideContent slug="fondo" />);
    expect(document.body.textContent).toMatch(/Los sorteos también se están rehaciendo/);
  });
  it("locked channels no longer offer a donate button", () => {
    render(<GuideContent slug="candados" />);
    expect(document.body.textContent).not.toMatch(/botón para donar/);
  });
});

describe("guide: Base and Arbitrum, no fee (P0)", () => {
  it.each(["propinas", "bounties", "redes"] as const)("%s names Base and Arbitrum", (slug) => {
    render(<GuideContent slug={slug} />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Base");
    expect(text).toContain("Arbitrum");
  });
  it.each(["propinas", "bounties", "dao", "fondo", "encuestas", "candados", "redes"] as const)(
    "%s mentions neither a fee nor Linea",
    (slug) => {
      render(<GuideContent slug={slug} />);
      const text = document.body.textContent ?? "";
      expect(text).not.toMatch(/comisión/i);
      expect(text).not.toMatch(/\bLinea\b/);
    },
  );
  it("redes explains the test mode on Base Sepolia and Arbitrum Sepolia, and that the club holds no funds", () => {
    render(<GuideContent slug="redes" />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Base Sepolia");
    expect(text).toContain("Arbitrum Sepolia");
    expect(text).toContain("MODO PRUEBA");
    expect(text).toMatch(/ElClub\. no custodia fondos/);
  });
});

describe("guide: encuestas", () => {
  it("has its subsections and the key explanations", () => {
    expect(isComingSoon("encuestas")).toBe(false);
    render(<GuideContent slug="encuestas" />);
    for (const h of ["Qué es", "Cómo se vota", "Cuánto pesa tu voto", "Voto secreto", "Resultados"]) {
      expect(screen.getByRole("heading", { name: h })).toBeInTheDocument();
    }
    const text = document.body.textContent ?? "";
    for (const t of [
      "/encuesta",
      "Crear encuestas",
      "1 persona, 1 voto",
      "Lineal",
      "Cuadrática",
      "participaciones sin bloquear",
      "Fondo del club",
      "hasta el cierre",
      "al menos 3",
      "al menos 5",
      "% del peso",
      "consultiva",
      "a nivel de la aplicación",
      "moderadores ni tesoreros",
    ]) {
      expect(text, t).toContain(t);
    }
    expect(text).not.toMatch(/imposible para nadie/i);
    expect(text).not.toMatch(/no queda nada/i);
    expect(text).toMatch(/sellan a nivel de la aplicación/);
    // Below the floor the card still shows "N votantes": no percentage is published, not "no number" (M6).
    expect(text).toContain("no se publica ningún porcentaje");
    expect(text).not.toContain("ningún número");
  });
});
