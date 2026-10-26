import { render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { Landing } from "@/components/landing/landing";
import { DEMO } from "@/components/landing/giveaway-demo";
import { es } from "@/lib/i18n/dictionaries/es";
import { en } from "@/lib/i18n/dictionaries/en";
import { drawWinners, giveawayCommit } from "@/lib/giveaways/draw";
import type { ToolKey } from "@/lib/admin/state";

const NONE: ReadonlySet<ToolKey> = new Set();

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
    const { container } = render(<Landing lang="es" off={NONE} />);
    const h1s = screen.getAllByRole("heading", { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent("Herramientas cripto gratis y seguras");
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Un sorteo en la blockchain",
      "ElClub Pay",
      "Comprobador",
      "Avales",
      "Más herramientas",
      "Construido en Base y Arbitrum",
      "Un foro privado por invitación",
      "Empieza gratis",
    ]);
    const levels = [...container.querySelectorAll("h1, h2, h3, h4, h5, h6")].map((h) => Number(h.tagName[1]));
    levels.forEach((level, i) => {
      if (i > 0) expect(level - levels[i - 1]!).toBeLessThanOrEqual(1);
    });
  });

  it("«Crear sorteo» goes to the create page and «Qué es ElClub.» to /start", () => {
    render(<Landing lang="es" off={NONE} />);
    const create = screen.getAllByRole("link", { name: "Crear sorteo" });
    expect(create.length).toBeGreaterThanOrEqual(2);
    for (const link of create) expect(link).toHaveAttribute("href", "/herramientas/sorteos/nuevo");
    const whatIs = screen.getAllByRole("link", { name: "Qué es ElClub." });
    expect(whatIs.length).toBeGreaterThanOrEqual(2);
    for (const link of whatIs) expect(link).toHaveAttribute("href", "/start");
  });

  it("«Crear enlace de pago» is a link to the Pay tool, without «Próximamente»", () => {
    for (const [lang, href, name] of [["es", "/herramientas/pay", /Crear enlace de pago/], ["en", "/en/tools/pay", /Create payment link/]] as const) {
      const { unmount } = render(<Landing lang={lang} off={NONE} />);
      const links = screen.getAllByRole("link", { name });
      expect(links.length).toBeGreaterThanOrEqual(2);
      for (const link of links) {
        expect(link).toHaveAttribute("href", href);
        expect(link).not.toHaveTextContent(/Próximamente|Coming soon/);
      }
      unmount();
    }
  });

  it("«Comprobar contrato» is a link to the checker, without «Próximamente»", () => {
    for (const [lang, href, name] of [["es", "/herramientas/comprobador", /Comprobar contrato/], ["en", "/en/tools/checker", /Check contract/]] as const) {
      const { unmount } = render(<Landing lang={lang} off={NONE} />);
      const links = screen.getAllByRole("link", { name });
      expect(links.length).toBeGreaterThanOrEqual(1);
      for (const link of links) {
        expect(link).toHaveAttribute("href", href);
        expect(link).not.toHaveTextContent(/Próximamente|Coming soon/);
      }
      expect(screen.queryByRole("button", { name })).toBeNull();
      unmount();
    }
  });

  it("the vouches teaser links to the tool, without «Próximamente» or the brand fill", () => {
    for (const [lang, href, region, name] of [
      ["es", "/herramientas/avales", "Avales", /Ver avales/],
      ["en", "/en/tools/vouches", "Vouches", /See vouches/],
    ] as const) {
      const { unmount } = render(<Landing lang={lang} off={NONE} />);
      const block = screen.getByRole("region", { name: region });
      expect(within(block).getByRole("link", { name })).toHaveAttribute("href", href);
      expect(block).not.toHaveTextContent(/Próximamente|Coming soon/);
      expect(block.querySelector(".bg-accent-fill")).toBeNull();
      unmount();
    }
  });

  it("one «More tools» block links to the hub, without the brand fill and without tool cards", () => {
    for (const [lang, href, region, name, lead] of [
      ["es", "/herramientas", "Más herramientas", /Ver herramientas/, "Revisa permisos, envía USDC a varios y calcula el gas."],
      ["en", "/en/tools", "More tools", /See tools/, en.landing.moreTools.lead],
    ] as const) {
      const { unmount } = render(<Landing lang={lang} off={NONE} />);
      const blocks = screen.getAllByRole("region", { name: region });
      expect(blocks).toHaveLength(1);
      const block = blocks[0]!;
      expect(block).toHaveTextContent(lead);
      const links = within(block).getAllByRole("link");
      expect(links).toHaveLength(1);
      expect(links[0]).toHaveAccessibleName(name);
      expect(links[0]).toHaveAttribute("href", href);
      expect(block.querySelector(".bg-accent-fill")).toBeNull();
      expect(block.querySelectorAll("li, article")).toHaveLength(0);
      unmount();
    }
  });

  it("the «More tools» block comes right after the vouches teaser", () => {
    render(<Landing lang="es" off={NONE} />);
    const vouches = screen.getByRole("region", { name: "Avales" });
    expect(vouches.nextElementSibling).toBe(screen.getByRole("region", { name: "Más herramientas" }));
  });

  it("no tool on the landing is marked «Próximamente» / «Coming soon»", () => {
    for (const lang of ["es", "en"] as const) {
      const { container, unmount } = render(<Landing lang={lang} off={NONE} />);
      expect(container.textContent).not.toMatch(/Próximamente|Coming soon/);
      unmount();
    }
  });

  it("the checker block is live and Pay is live", () => {
    render(<Landing lang="es" off={NONE} />);
    expect(within(screen.getByRole("region", { name: "Comprobador" })).queryByText("Próximamente")).toBeNull();
    expect(within(screen.getByRole("region", { name: "ElClub Pay" })).queryByText("Próximamente")).toBeNull();
  });

  it("the demo shows commit → drand round → winner, and the sample is internally consistent", () => {
    render(<Landing lang="es" off={NONE} />);
    const demo = screen.getByRole("region", { name: "Un sorteo en la blockchain" });
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
    const { container } = render(<Landing lang="es" off={NONE} />);
    const srcs = [...container.querySelectorAll("img")].map((img) => img.getAttribute("src"));
    expect(srcs).toContain("/brand/networks/base.svg");
    expect(srcs).toContain("/brand/networks/arbitrum.svg");
  });

  it("in English no Spanish string of the landing appears, and links are English", () => {
    const { container } = render(<Landing lang="en" off={NONE} />);
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
    const { container } = render(<Landing lang="es" off={NONE} />);
    const offenders = [...container.querySelectorAll<HTMLElement>("[style]")].filter((el) => {
      const { opacity, transform } = el.style;
      return (opacity !== "" && Number(opacity) !== 1) || (transform !== "" && transform !== "none");
    });
    expect(offenders.map((el) => el.getAttribute("style"))).toEqual([]);
  });
});

describe("Landing with tools switched off (A-R16)", () => {
  const hrefs = (container: HTMLElement) => [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));

  it("with nothing off it keeps every tool link", () => {
    const { container } = render(<Landing lang="es" off={NONE} />);
    expect(hrefs(container)).toEqual(
      expect.arrayContaining(["/herramientas/sorteos/nuevo", "/herramientas/pay", "/herramientas/comprobador", "/herramientas/avales", "/herramientas"]),
    );
    expect(container.querySelectorAll("a.bg-accent-fill")).toHaveLength(2);
  });

  it("«vouches» off: no link to /herramientas/avales and no vouches block", () => {
    const { container } = render(<Landing lang="es" off={new Set<ToolKey>(["vouches"])} />);
    expect(hrefs(container)).not.toContain("/herramientas/avales");
    expect(screen.queryByRole("region", { name: "Avales" })).toBeNull();
  });

  it("«giveaways» off: no create link, no demo and no brand fill left", () => {
    const { container } = render(<Landing lang="es" off={new Set<ToolKey>(["giveaways"])} />);
    expect(hrefs(container)).not.toContain("/herramientas/sorteos/nuevo");
    expect(screen.queryByRole("region", { name: "Un sorteo en la blockchain" })).toBeNull();
    expect(container.querySelectorAll("a.bg-accent-fill")).toHaveLength(0);
    expect(screen.getAllByRole("link", { name: "Qué es ElClub." }).length).toBeGreaterThanOrEqual(2);
  });

  it("«pay» off: no Pay block and no payment link; «checker» off: no checker block", () => {
    const { container, unmount } = render(<Landing lang="es" off={new Set<ToolKey>(["pay"])} />);
    expect(hrefs(container)).not.toContain("/herramientas/pay");
    expect(screen.queryByRole("region", { name: "ElClub Pay" })).toBeNull();
    expect(screen.getByRole("region", { name: "Comprobador" })).toBeInTheDocument();
    unmount();
    const second = render(<Landing lang="es" off={new Set<ToolKey>(["checker"])} />);
    expect(hrefs(second.container)).not.toContain("/herramientas/comprobador");
    expect(screen.queryByRole("region", { name: "Comprobador" })).toBeNull();
    expect(screen.getByRole("region", { name: "ElClub Pay" })).toBeInTheDocument();
  });

  it("«More tools» stays with approvals and multisend off, and goes when gas is off too", () => {
    const { unmount } = render(<Landing lang="es" off={new Set<ToolKey>(["approvals", "multisend"])} />);
    expect(screen.getByRole("region", { name: "Más herramientas" })).toBeInTheDocument();
    unmount();
    render(<Landing lang="es" off={new Set<ToolKey>(["approvals", "multisend", "gas"])} />);
    expect(screen.queryByRole("region", { name: "Más herramientas" })).toBeNull();
  });
});
