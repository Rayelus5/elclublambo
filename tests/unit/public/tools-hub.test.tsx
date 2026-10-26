import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ value: null as null | { userId: string } }));
const mine = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/public-session", () => ({ getPublicSession: async () => session.value }));
vi.mock("@/lib/public-giveaways/queries", () => ({ getMyPublicGiveaways: mine }));
vi.mock("@/components/public/public-connect-lazy", () => ({ PublicConnectLazy: () => <button>connect</button> }));

import ToolsPage from "@/app/(public)/[lang]/tools/page";
import { MyGiveaways } from "@/components/public-giveaways/my-giveaways";

const ID = "123e4567-e89b-12d3-a456-426614174000";
beforeEach(() => {
  session.value = null;
  mine.mockReset();
});

describe("tools hub", () => {
  it("EN: links every tool, Vouching included, all «Available» and none «Coming soon»", async () => {
    render(await ToolsPage({ params: Promise.resolve({ lang: "en" }) } as never));
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
    render(await ToolsPage({ params: Promise.resolve({ lang: "en" }) } as never));
    for (const [name, href] of [[/Approvals/, "/en/tools/approvals"], [/Multisend/, "/en/tools/multisend"], [/Gas calculator/, "/en/tools/gas"]] as const) {
      const link = screen.getByRole("link", { name });
      expect(link.getAttribute("href")).toBe(href);
      expect(link).toHaveTextContent("Available");
    }
  });
  it("ES: Aprobaciones, Envío múltiple y Gas están «Disponible» y enlazan a sus rutas", async () => {
    render(await ToolsPage({ params: Promise.resolve({ lang: "es" }) } as never));
    for (const [name, href] of [[/Aprobaciones/, "/herramientas/aprobaciones"], [/Envío múltiple/, "/herramientas/envio-multiple"], [/Calculadora de gas/, "/herramientas/gas"]] as const) {
      const link = screen.getByRole("link", { name });
      expect(link.getAttribute("href")).toBe(href);
      expect(link).toHaveTextContent("Disponible");
    }
    expect(screen.getAllByText("Disponible")).toHaveLength(7);
  });
  it("ES links to the Spanish URL", async () => {
    render(await ToolsPage({ params: Promise.resolve({ lang: "es" }) } as never));
    expect(screen.getByRole("link", { name: /Sorteos verificables/ }).getAttribute("href")).toBe("/herramientas/sorteos");
    expect(screen.getByRole("link", { name: /ElClub Pay/ }).getAttribute("href")).toBe("/herramientas/pay");
    expect(screen.getByRole("link", { name: /Comprobador de tokens/ }).getAttribute("href")).toBe("/herramientas/comprobador");
    const vouches = screen.getByRole("link", { name: /Avales/ });
    expect(vouches.getAttribute("href")).toBe("/herramientas/avales");
    expect(vouches).toHaveTextContent("Disponible");
    expect(screen.queryByText("Próximamente")).toBeNull();
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
