import { render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { Landing } from "@/components/landing/landing";
import { DEMO } from "@/components/landing/giveaway-demo";
import { es } from "@/lib/i18n/dictionaries/es";
import { en } from "@/lib/i18n/dictionaries/en";
import { drawWinners, giveawayCommit } from "@/lib/giveaways/draw";

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
  mockMatchMedia(true);
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

type Tree = { [k: string]: string | Tree };
function strings(tree: Tree, other: Tree, out: string[] = []): string[] {
  for (const [key, value] of Object.entries(tree)) {
    const counterpart = other[key];
    if (typeof value === "string") {
      if (value !== counterpart) out.push(value);
    } else strings(value, counterpart as Tree, out);
  }
  return out;
}

describe("Landing (reduced motion)", () => {
  it("has one h1 and one h2 per block, in the spec's order, without level jumps", () => {
    const { container } = render(<Landing lang="es" />);
    const h1s = screen.getAllByRole("heading", { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent("Herramientas cripto honestas, verificables y gratis.");
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Un sorteo que puedes comprobar",
      "ElClub Pay",
      "Comprobador",
      "Construido en Base · también en Arbitrum",
      "Lo mejor está dentro: un foro privado por invitación",
      "Empieza con un sorteo.",
    ]);
    const levels = [...container.querySelectorAll("h1, h2, h3, h4, h5, h6")].map((h) => Number(h.tagName[1]));
    levels.forEach((level, i) => {
      if (i > 0) expect(level - levels[i - 1]!).toBeLessThanOrEqual(1);
    });
  });

  it("«Crear sorteo» goes to the create page and «Qué es ElClub.» to /start", () => {
    render(<Landing lang="es" />);
    const create = screen.getAllByRole("link", { name: "Crear sorteo" });
    expect(create.length).toBeGreaterThanOrEqual(2);
    for (const link of create) expect(link).toHaveAttribute("href", "/herramientas/sorteos/nuevo");
    const whatIs = screen.getAllByRole("link", { name: "Qué es ElClub." });
    expect(whatIs.length).toBeGreaterThanOrEqual(2);
    for (const link of whatIs) expect(link).toHaveAttribute("href", "/start");
  });

  it("«Próximamente» CTAs are aria-disabled buttons that go nowhere", () => {
    render(<Landing lang="es" />);
    const soon = [
      ...screen.getAllByRole("button", { name: /Crear enlace de pago/ }),
      ...screen.getAllByRole("button", { name: /Comprobar contrato/ }),
    ];
    expect(soon.length).toBeGreaterThanOrEqual(3);
    for (const button of soon) {
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button).toHaveAttribute("type", "button");
      expect(button).toHaveTextContent("Próximamente");
      expect(button.closest("a, form")).toBeNull();
    }
    expect(screen.queryByRole("link", { name: /Crear enlace de pago|Comprobar contrato/ })).toBeNull();
  });

  it("marks Pay and the checker as «Próximamente»", () => {
    render(<Landing lang="es" />);
    for (const name of ["ElClub Pay", "Comprobador"]) {
      expect(within(screen.getByRole("region", { name })).getAllByText("Próximamente").length).toBeGreaterThanOrEqual(1);
    }
  });

  it("the demo shows commit → drand round → winner, and the sample is internally consistent", () => {
    render(<Landing lang="es" />);
    const demo = screen.getByRole("region", { name: "Un sorteo que puedes comprobar" });
    expect(within(demo).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Compromiso",
      "Ronda de drand",
      "Ganador",
    ]);
    expect(demo).toHaveTextContent(DEMO.commit);
    expect(demo).toHaveTextContent(String(DEMO.round));
    expect(within(demo).getByText("Gana")).toBeInTheDocument();
    // The mock is static, but plausible: the real formulas give the same commit and winner.
    expect(giveawayCommit(DEMO.seed)).toBe(DEMO.commit);
    expect(drawWinners(DEMO.seed, DEMO.randomness, DEMO.entries.length, 1)).toEqual([DEMO.winner]);
  });

  it("shows both network logos", () => {
    const { container } = render(<Landing lang="es" />);
    const srcs = [...container.querySelectorAll("img")].map((img) => img.getAttribute("src"));
    expect(srcs).toContain("/brand/networks/base.svg");
    expect(srcs).toContain("/brand/networks/arbitrum.svg");
  });

  it("in English no Spanish string of the landing appears, and links are English", () => {
    const { container } = render(<Landing lang="en" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(en.landing.hero.title);
    const text = container.textContent ?? "";
    const leaks = strings(es.landing as unknown as Tree, en.landing as unknown as Tree).filter((s) => text.includes(s));
    expect(leaks).toEqual([]);
    for (const link of screen.getAllByRole("link", { name: en.landing.create })) {
      expect(link).toHaveAttribute("href", "/en/tools/giveaways/new");
    }
    for (const link of screen.getAllByRole("link", { name: en.landing.whatIs })) {
      expect(link).toHaveAttribute("href", "/en/start");
    }
  });

  it("leaves nothing hidden or moved: every inline opacity is 1 and every inline transform is none", () => {
    const { container } = render(<Landing lang="es" />);
    const offenders = [...container.querySelectorAll<HTMLElement>("[style]")].filter((el) => {
      const { opacity, transform } = el.style;
      return (opacity !== "" && Number(opacity) !== 1) || (transform !== "" && transform !== "none");
    });
    expect(offenders.map((el) => el.getAttribute("style"))).toEqual([]);
  });
});
