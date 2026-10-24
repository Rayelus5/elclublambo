import { render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { StartLanding } from "@/components/start/start-landing";

function mockMatchMedia(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("prefers-reduced-motion") ? reduce : false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeAll(() => {
  globalThis.IntersectionObserver ??= class {
    readonly root = null;
    readonly rootMargin = "";
    readonly thresholds = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
});

describe("StartLanding with reduced motion", () => {
  beforeAll(() => mockMatchMedia(true));

  it("has one h1 «ElClub.» and a heading hierarchy without jumps", () => {
    const { container } = render(<StartLanding />);
    const h1s = screen.getAllByRole("heading", { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent("ElClub.");
    const levels = [...container.querySelectorAll("h1, h2, h3, h4, h5, h6")].map((h) => Number(h.tagName[1]));
    levels.forEach((level, i) => {
      if (i > 0) expect(level - levels[i - 1]!).toBeLessThanOrEqual(1);
    });
  });

  it("shows the hero copy", () => {
    render(<StartLanding />);
    expect(screen.getByText("El foro privado para quien se toma cripto en serio.")).toBeInTheDocument();
    expect(screen.getByText(/Solo con invitación\. Sin ruido\. Construido en Base y Arbitrum\./)).toBeInTheDocument();
  });

  it("says Base and Arbitrum, never Linea (P0)", () => {
    render(<StartLanding />);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/Linea/);
    expect(text).toContain("Base y Arbitrum");
  });

  it("presents every feature as an h3", () => {
    render(<StartLanding />);
    const inside = screen.getByRole("region", { name: "Qué hay dentro" });
    const names = within(inside)
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent);
    expect(names).toHaveLength(8);
    for (const word of ["Canales", "Alphas", "Bounties", "Propinas", "Tesorería", "Sorteos", "Mercado", "Moderación"]) {
      expect(names.some((n) => n?.includes(word))).toBe(true);
    }
  });

  it("explains the wallet step: free, no gas, no funds moved", () => {
    render(<StartLanding />);
    const steps = screen.getByRole("region", { name: "Cómo se entra" });
    expect(steps).toHaveTextContent(/MetaMask/);
    expect(steps).toHaveTextContent(/OKX/);
    expect(steps).toHaveTextContent(/no cuesta gas/);
    expect(steps).toHaveTextContent(/ni mueve fondos/);
  });

  it("warns that the treasury is not an investment, next to the feature and in the footer", () => {
    render(<StartLanding />);
    expect(screen.getAllByText(/no son una inversión ni prometen rentabilidad/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/2-de-3/).length).toBeGreaterThanOrEqual(1);
  });

  it("offers «Solicitar invitación» disabled as «Próximamente», and tells invitees what to do", () => {
    render(<StartLanding />);
    const button = screen.getByRole("button", { name: /Solicitar invitación/ });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveTextContent("Próximamente");
    expect(
      screen.getByText(/Abre el enlace que te pasaron en tu navegador de preferencia \(con tu wallet instalada\) y desde ahí inicia sesión\./),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /iniciar sesión|entrar/i })).toBeNull();
  });

  it("has no FAQ", () => {
    render(<StartLanding />);
    expect(screen.queryByText(/preguntas frecuentes|FAQ/i)).toBeNull();
  });

  it("leaves nothing hidden or moved: every inline opacity is 1 and every inline transform is none", () => {
    const { container } = render(<StartLanding />);
    const offenders = [...container.querySelectorAll<HTMLElement>("[style]")].filter((el) => {
      const { opacity, transform } = el.style;
      return (opacity !== "" && Number(opacity) !== 1) || (transform !== "" && transform !== "none");
    });
    expect(offenders.map((el) => el.getAttribute("style"))).toEqual([]);
  });
});
