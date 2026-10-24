import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GuideContent, isComingSoon } from "@/components/guide/guide-content";
import { GUIDE_SECTIONS } from "@/lib/guide/sections";

const SLUGS = GUIDE_SECTIONS.map((s) => s.slug);

function headings() {
  return screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
}

describe("guide: propinas", () => {
  it("is no longer marked as coming soon", () => {
    for (const slug of SLUGS) expect(isComingSoon(slug)).toBe(false);
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

describe("guide: donaciones", () => {
  it("has its subsections and the money reminders", () => {
    render(<GuideContent slug="donaciones" />);
    expect(headings()).toEqual(["Qué es", "Cómo donar", "Qué recibes", "Transparencia"]);
    const text = document.body.textContent ?? "";
    expect(text).toContain("ElClub. no custodia fondos");
    expect(text).toContain("Donar no da derechos económicos");
    expect(text).toContain("Base");
    expect(text).toContain("Arbitrum");
    expect(text).toContain("Mecenas");
    expect(text).toContain("1 USD");
    expect(text).toMatch(/ocultarte/);
    expect(text).toMatch(/saldos de la Safe/);
    expect(text).toMatch(/nota/);
  });
});

describe("guide: sorteos", () => {
  it("has its subsections and explains drand", () => {
    render(<GuideContent slug="sorteos" />);
    expect(headings()).toEqual(["Qué es", "Premios", "Cómo se elige al ganador", "Cómo comprobarlo"]);
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/gratis/);
    expect(text).toMatch(/misma probabilidad/);
    expect(text).toContain("USDC");
    expect(text).toContain("drand");
    expect(text).toMatch(/semilla/);
    expect(text).toContain("ElClub. no custodia fondos");
  });
});

describe("guide: candados", () => {
  it("is about the total donated in USD and the Mecenas role", () => {
    render(<GuideContent slug="candados" />);
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/donado/);
    expect(text).toContain("USD");
    expect(text).toContain("Mecenas");
    expect(text).not.toMatch(/porcentaje|DAO|aportaci/i);
  });
});

describe("guide: redes", () => {
  it("explains the test mode on Base Sepolia and Arbitrum Sepolia, and that the club holds no funds", () => {
    render(<GuideContent slug="redes" />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Base Sepolia");
    expect(text).toContain("Arbitrum Sepolia");
    expect(text).toContain("MODO PRUEBA");
    expect(text).toMatch(/ElClub\. no custodia fondos/);
  });
});

describe("guide: Base and Arbitrum, no fee, no legacy economy", () => {
  it.each(["propinas", "bounties", "donaciones", "redes"] as const)("%s names Base and Arbitrum", (slug) => {
    render(<GuideContent slug={slug} />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Base");
    expect(text).toContain("Arbitrum");
  });
  it.each(SLUGS)("%s mentions neither a fee, shares, withdrawals nor Linea", (slug) => {
    render(<GuideContent slug={slug} />);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/comisión/i);
    expect(text).not.toMatch(/\bLinea\b/);
    expect(text).not.toMatch(/participaciones|retirada|Lineal|Cuadrática/i);
    expect(text).not.toMatch(/se está rehaciendo|se rehace/);
  });
});

describe("guide: encuestas", () => {
  it("has its subsections: 1 member = 1 vote, secret, results from 3 votes", () => {
    render(<GuideContent slug="encuestas" />);
    expect(headings()).toEqual(["Qué es", "Cómo se vota", "Voto secreto", "Resultados"]);
    const text = document.body.textContent ?? "";
    for (const t of ["/encuesta", "Crear encuestas", "1 miembro = 1 voto", "hasta el cierre", "al menos 3", "consultiva", "a nivel de la aplicación", "moderadores ni tesoreros"]) {
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
