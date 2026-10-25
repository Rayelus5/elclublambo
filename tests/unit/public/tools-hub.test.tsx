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
  it("EN: links Verifiable giveaways, Coming soon cards are not links", async () => {
    render(await ToolsPage({ params: Promise.resolve({ lang: "en" }) } as never));
    expect(screen.getByRole("link", { name: /Verifiable giveaways/ }).getAttribute("href")).toBe("/en/tools/giveaways");
    expect(screen.getAllByRole("link").filter((l) => /ElClub Pay|checker|Vouching/.test(l.textContent ?? ""))).toHaveLength(0);
    expect(screen.getAllByText("Coming soon")).toHaveLength(3);
    expect(screen.getByText(/ElClub Pay/)).toBeTruthy();
  });
  it("ES links to the Spanish URL", async () => {
    render(await ToolsPage({ params: Promise.resolve({ lang: "es" }) } as never));
    expect(screen.getByRole("link", { name: /Sorteos verificables/ }).getAttribute("href")).toBe("/herramientas/sorteos");
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
