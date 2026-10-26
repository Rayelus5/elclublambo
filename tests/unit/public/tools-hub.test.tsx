import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ value: null as null | { userId: string } }));
const mine = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/public-session", () => ({ getPublicSession: async () => session.value }));
vi.mock("@/lib/public-giveaways/queries", () => ({ getMyPublicGiveaways: mine }));
vi.mock("@/components/public/public-connect-lazy", () => ({ PublicConnectLazy: () => <button>connect</button> }));

import { ToolGrid } from "@/components/public/tool-grid";
import type { ToolKey } from "@/lib/admin/state";
import { colors, contrastRatio } from "@/styles/tokens";
import { MyGiveaways } from "@/components/public-giveaways/my-giveaways";

const ID = "123e4567-e89b-12d3-a456-426614174000";
beforeEach(() => {
  session.value = null;
  mine.mockReset();
});

const NONE: ReadonlySet<ToolKey> = new Set();
const renderGrid = (lang: "es" | "en", off: ReadonlySet<ToolKey> = NONE) => render(<ToolGrid lang={lang} off={off} />);

describe("tools hub", () => {
  it("EN: links every tool, Vouching included, all «Available» and none «Coming soon»", async () => {
    renderGrid("en");
    expect(screen.getByRole("link", { name: /Verifiable giveaways/ }).getAttribute("href")).toBe("/en/tools/giveaways");
    expect(screen.getByRole("link", { name: /ElClub Pay/ }).getAttribute("href")).toBe("/en/tools/pay");
    expect(screen.getByRole("link", { name: /Token and link checker/ }).getAttribute("href")).toBe("/en/tools/checker");
    const vouches = screen.getByRole("link", { name: /Vouching/ });
    expect(vouches.getAttribute("href")).toBe("/en/tools/vouches");
    expect(vouches).toHaveTextContent("Available");
    expect(screen.queryByText("Coming soon")).toBeNull();
    expect(screen.getAllByText("Available")).toHaveLength(7);
  });
  it("EN: Approvals, Multisend and Gas are «Available» and link to their routes", async () => {
    renderGrid("en");
    for (const [name, href] of [[/Approvals/, "/en/tools/approvals"], [/Multisend/, "/en/tools/multisend"], [/Gas calculator/, "/en/tools/gas"]] as const) {
      const link = screen.getByRole("link", { name });
      expect(link.getAttribute("href")).toBe(href);
      expect(link).toHaveTextContent("Available");
    }
  });
  it("ES: Aprobaciones, Envío múltiple y Gas están «Disponible» y enlazan a sus rutas", async () => {
    renderGrid("es");
    for (const [name, href] of [[/Aprobaciones/, "/herramientas/aprobaciones"], [/Envío múltiple/, "/herramientas/envio-multiple"], [/Calculadora de gas/, "/herramientas/gas"]] as const) {
      const link = screen.getByRole("link", { name });
      expect(link.getAttribute("href")).toBe(href);
      expect(link).toHaveTextContent("Disponible");
    }
    expect(screen.getAllByText("Disponible")).toHaveLength(7);
  });
  it("ES links to the Spanish URL", async () => {
    renderGrid("es");
    expect(screen.getByRole("link", { name: /Sorteos verificables/ }).getAttribute("href")).toBe("/herramientas/sorteos");
    expect(screen.getByRole("link", { name: /ElClub Pay/ }).getAttribute("href")).toBe("/herramientas/pay");
    expect(screen.getByRole("link", { name: /Comprobador de tokens/ }).getAttribute("href")).toBe("/herramientas/comprobador");
    const vouches = screen.getByRole("link", { name: /Avales/ });
    expect(vouches.getAttribute("href")).toBe("/herramientas/avales");
    expect(vouches).toHaveTextContent("Disponible");
    expect(screen.queryByText("Próximamente")).toBeNull();
  });
  it("EN: a tool switched off has no link, reads «Not available right now», and the other six stay linked", () => {
    renderGrid("en", new Set<ToolKey>(["gas"]));
    expect(screen.queryByRole("link", { name: /Gas calculator/ })).toBeNull();
    const card = screen.getByText("Gas calculator").closest("li")!;
    expect(card).toHaveTextContent("Not available right now");
    expect(card).not.toHaveTextContent(/\bAvailable\b/);
    expect(card.querySelector("a")).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(6);
    expect(screen.getAllByText("Available")).toHaveLength(6);
  });
  it("a switched-off card keeps its texts at AA: no fade stacked on the muted description (Task 8 minor)", () => {
    renderGrid("en", new Set<ToolKey>(["gas"]));
    const card = screen.getByText("Gas calculator").closest("li")!;
    const texts = [screen.getByText("What a transaction costs right now on Base and Arbitrum."), screen.getByText("Gas calculator"), screen.getByText("Not available right now")];
    // Neither the text nor any box up to the card fades it.
    for (const t of texts) {
      for (let el: HTMLElement | null = t; el && el !== card.parentElement; el = el.parentElement) {
        expect(el.className.split(/\s+/).some((c) => c.startsWith("opacity-"))).toBe(false);
      }
    }
    expect(texts[0]!.className.split(/\s+/)).toContain("text-fg-muted");
    expect(contrastRatio(colors.fgMuted, colors.surface)).toBeGreaterThanOrEqual(4.5);
  });
  it("ES: a tool switched off reads «No disponible ahora»", () => {
    renderGrid("es", new Set<ToolKey>(["gas"]));
    expect(screen.queryByRole("link", { name: /Calculadora de gas/ })).toBeNull();
    expect(screen.getByText("Calculadora de gas").closest("li")).toHaveTextContent("No disponible ahora");
    expect(screen.getAllByText("Disponible")).toHaveLength(6);
  });
});

describe("MyGiveaways", () => {
  it("renders nothing without a session", async () => {
    const out = await MyGiveaways({ lang: "en" });
    expect(out).toBeNull();
    expect(mine).not.toHaveBeenCalled();
  });
  it("lists my giveaways with status and link", async () => {
    session.value = { userId: "u" };
    mine.mockResolvedValue([{ id: ID, title: "Cap", status: "open", closesAt: "2030-01-01T00:00:00Z", entryCount: 2, prizeCount: 1 }]);
    render(await MyGiveaways({ lang: "en" }));
    expect(screen.getByText("My giveaways")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Cap/ }).getAttribute("href")).toBe(`/en/tools/giveaways/${ID}`);
    expect(screen.getByText("Open")).toBeTruthy();
  });
});
