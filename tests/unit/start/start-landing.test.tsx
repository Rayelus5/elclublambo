import { render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { StartLanding } from "@/components/start/start-landing";
import { en } from "@/lib/i18n/dictionaries/en";
import { es } from "@/lib/i18n/dictionaries/es";

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
    const { container } = render(<StartLanding lang="es" t={es.start} />);
    const h1s = screen.getAllByRole("heading", { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent("ElClub.");
    const levels = [...container.querySelectorAll("h1, h2, h3, h4, h5, h6")].map((h) => Number(h.tagName[1]));
    levels.forEach((level, i) => {
      if (i > 0) expect(level - levels[i - 1]!).toBeLessThanOrEqual(1);
    });
  });

  it("shows the hero copy", () => {
    render(<StartLanding lang="es" t={es.start} />);
    expect(screen.getByText("El foro privado para quien se toma cripto en serio.")).toBeInTheDocument();
    expect(screen.getByText(/Solo con invitación\. Sin ruido\. Construido en Base y Arbitrum\./)).toBeInTheDocument();
  });

  it("says Base and Arbitrum, never Linea (P0)", () => {
    render(<StartLanding lang="es" t={es.start} />);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/Linea/);
    expect(text).toContain("Base y Arbitrum");
  });

  it("presents every feature as an h3", () => {
    render(<StartLanding lang="es" t={es.start} />);
    const inside = screen.getByRole("region", { name: "Qué hay dentro" });
    const names = within(inside)
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent);
    expect(names).toHaveLength(9);
    for (const word of ["inicio con buscador", "Canales", "Alphas", "Bounties", "Propinas", "Donaciones", "Sorteos", "Mercado", "Moderación"]) {
      expect(names.some((n) => n?.includes(word))).toBe(true);
    }
  });

  it("explains the wallet step: free, no gas, no funds moved", () => {
    render(<StartLanding lang="es" t={es.start} />);
    const steps = screen.getByRole("region", { name: "Cómo se entra" });
    expect(steps).toHaveTextContent(/MetaMask/);
    expect(steps).toHaveTextContent(/OKX/);
    expect(steps).toHaveTextContent(/no cuesta gas/);
    expect(steps).toHaveTextContent(/ni mueve fondos/);
  });

  it("links the open tools to the localized tools hub, above the disabled invitation request", () => {
    render(<StartLanding lang="es" t={es.start} />);
    expect(screen.getByRole("heading", { level: 2, name: /¿Aún sin invitación\? Prueba las herramientas abiertas/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver las herramientas" })).toHaveAttribute("href", "/herramientas");
  });

  it("reflects what the club has now: search, Mecenas, drand prizes, one member one vote, fee-free tips", () => {
    render(<StartLanding lang="es" t={es.start} />);
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/Ctrl\+K/);
    expect(text).toMatch(/rol Mecenas/);
    expect(text).toMatch(/premios de rol, de objeto o en USDC/);
    expect(text).toMatch(/un miembro, un voto/i);
    expect(text).toMatch(/Sin comisión de la plataforma/);
    expect(text).not.toMatch(/voto secreto/i);
  });

  it("says donations have no economic rights, next to the feature and in the footer", () => {
    render(<StartLanding lang="es" t={es.start} />);
    expect(screen.getAllByText(/Donar no da derechos económicos/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Dona en Base o Arbitrum a la Safe del club\. Sin retorno, con transparencia/)).toBeInTheDocument();
    expect(screen.getAllByText("Mecenas").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Safe").length).toBeGreaterThanOrEqual(1);
  });

  it("explains raffles with drand, with no commit-reveal, shares or treasury leftovers", () => {
    render(<StartLanding lang="es" t={es.start} />);
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/drand/);
    expect(text).not.toMatch(/commit-reveal/i);
    expect(text).not.toMatch(/participaciones|2-de-3|Tesorería/);
  });

  it("offers «Solicitar invitación» disabled as «Próximamente», and tells invitees what to do", () => {
    render(<StartLanding lang="es" t={es.start} />);
    const button = screen.getByRole("button", { name: /Solicitar invitación/ });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveTextContent("Próximamente");
    expect(
      screen.getByText(/Abre el enlace que te pasaron en tu navegador de preferencia \(con tu wallet instalada\) y desde ahí inicia sesión\./),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /iniciar sesión|entrar/i })).toBeNull();
  });

  it("has no FAQ", () => {
    render(<StartLanding lang="es" t={es.start} />);
    expect(screen.queryByText(/preguntas frecuentes|FAQ/i)).toBeNull();
  });

  it("leaves nothing hidden or moved: every inline opacity is 1 and every inline transform is none", () => {
    const { container } = render(<StartLanding lang="es" t={es.start} />);
    const offenders = [...container.querySelectorAll<HTMLElement>("[style]")].filter((el) => {
      const { opacity, transform } = el.style;
      return (opacity !== "" && Number(opacity) !== 1) || (transform !== "" && transform !== "none");
    });
    expect(offenders.map((el) => el.getAttribute("style"))).toEqual([]);
  });

  it("renders in English for /en: English headings, no Spanish copy, tools link under /en", () => {
    const { container } = render(<StartLanding lang="en" t={en.start} />);
    expect(screen.getByText("The private forum for people serious about crypto.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "What's inside" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "How to get in" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See the tools" })).toHaveAttribute("href", "/en/tools");
    const button = screen.getByRole("button", { name: /Request an invitation/ });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveTextContent("Coming soon");
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/Solicitar|Próximamente|Qué hay dentro|Cómo se entra|Desliza|Gracias|Sorteo|Contrato verificado/);
    expect(text).not.toMatch(/[¿¡]/);
  });
});
