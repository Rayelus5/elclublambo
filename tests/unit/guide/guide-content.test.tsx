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
    expect(screen.queryByText(/Los sorteos, si llegan/i)).toBeNull();
    expect(screen.queryByText(/llegarán/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/NAV/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/liquidativo/)).not.toBeInTheDocument();
    expect(screen.queryByText(/empezarán desactivadas/)).toBeNull();
    expect(screen.getByText(/primera valoración/)).toBeInTheDocument();
  });
});

describe("guide: retiradas", () => {
  it("explains how to ask for a withdrawal", () => {
    render(<GuideContent slug="fondo" />);
    expect(screen.getByRole("heading", { name: "Cómo pedir una retirada" })).toBeInTheDocument();
    expect(screen.getAllByText(/SuperAdmin/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/14 días/).length).toBeGreaterThan(0);
    expect(screen.getByText(/bloqueadas desde que pides/)).toBeInTheDocument();
    expect(screen.getByText(/se paga en USDC/)).toBeInTheDocument();
    expect(screen.queryByText(/Hoy no se puede retirar nada/)).toBeNull();
  });
  it("no longer says contributions cannot be withdrawn", () => {
    render(<GuideContent slug="dao" />);
    expect(screen.queryByText(/Hoy las aportaciones no se pueden retirar/)).toBeNull();
  });
});

describe("guide: sorteos", () => {
  it("explains how raffles work", () => {
    render(<GuideContent slug="fondo" />);
    expect(screen.getByRole("heading", { name: "Cómo funcionan los sorteos" })).toBeInTheDocument();
    expect(screen.getByText(/sale del fondo y baja su valor sin cambiar el porcentaje de nadie/)).toBeInTheDocument();
    expect(screen.getAllByText(/igualitario/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/SuperAdmin lo activa por red/)).toBeInTheDocument();
    expect(screen.getByText(/compromiso/)).toBeInTheDocument();
    expect(screen.getByText(/primer bloque de Linea posterior al cierre/)).toBeInTheDocument();
    expect(screen.getByText(/Anónimo #/)).toBeInTheDocument();
    expect(screen.getByText(/WETH en lugar de ETH/)).toBeInTheDocument();
    expect(screen.getByText(/se marca como impagado a los 14 días/)).toBeInTheDocument();
    expect(screen.getByText(/primera ejecución del proceso automático tras la hora de cierre/)).toBeInTheDocument();
    expect(screen.getByText(/en un club pequeño puede deducirse quién es un miembro oculto/)).toBeInTheDocument();
  });

  it("does not overclaim the seed's secrecy and says the winner's wallet is visible on-chain", () => {
    render(<GuideContent slug="fondo" />);
    expect(screen.queryByText(/nadie puede ver antes/)).toBeNull();
    expect(screen.getByText(/Ni los miembros ni los tesoreros pueden verla antes del sorteo/)).toBeInTheDocument();
    expect(screen.getByText(/la wallet que recibe el premio se ve en la red/)).toBeInTheDocument();
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
  });
});
