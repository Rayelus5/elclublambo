import { render, screen } from "@testing-library/react";
import type { Metadata } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const getPublicProfileView = vi.hoisted(() => vi.fn());
vi.mock("@/lib/pay/queries", () => ({ getPublicProfileView }));
const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
);
vi.mock("next/navigation", () => ({ notFound, useRouter: () => ({ push: vi.fn() }) }));
// The widget is client-only (AppKit); a stub exposes what the page hands it.
vi.mock("@/components/pay/pay-widget-lazy", () => ({
  PayWidgetLazy: (p: { accept: string[]; initialAmount: string | null; initialAsset: string | null; to: string }) => (
    <div data-testid="widget" data-accept={p.accept.join(",")} data-amount={p.initialAmount ?? ""} data-asset={p.initialAsset ?? ""} data-to={p.to} />
  ),
}));

import { PayPageContent } from "@/components/pay/pay-page-content";
import { generateMetadata } from "@/app/(public)/[lang]/pay/[target]/page";
import { getDictionary } from "@/lib/i18n";

const en = getDictionary("en").pay.page;
const es = getDictionary("es").pay.page;
const ADDR = "0x2222222222222222222222222222222222222222";

const content = (lang: string, target: string, sp: Record<string, string> = {}) =>
  PayPageContent({ params: Promise.resolve({ lang, target }), searchParams: Promise.resolve(sp) });
const meta = (lang: string, target: string) =>
  generateMetadata({ params: Promise.resolve({ lang, target }), searchParams: Promise.resolve({}) } as never) as Promise<Metadata>;

beforeEach(() => {
  getPublicProfileView.mockReset();
  notFound.mockClear();
});

describe("pay page", () => {
  it("an address without a profile shows the warning, the full address and every network", async () => {
    getPublicProfileView.mockResolvedValue({ alias: null, displayName: null, address: ADDR, acceptNetworks: ["base", "arbitrum"], isMember: false });
    render(await content("en", ADDR));
    expect(screen.getByText(en.noProfileTitle)).toBeInTheDocument();
    expect(screen.getByText(en.noProfileText)).toBeInTheDocument();
    expect(screen.getByText(ADDR)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en.copyAddress })).toBeInTheDocument();
    expect(screen.getByTestId("widget").dataset.accept).toBe("base,arbitrum");
    expect(screen.getByTestId("widget").dataset.to).toBe(ADDR);
  });

  it("an alias shows its name and member badge, no warning, and only its networks", async () => {
    getPublicProfileView.mockResolvedValue({ alias: "rayelus", displayName: "Rayelus", address: ADDR, acceptNetworks: ["base"], isMember: true });
    render(await content("es", "rayelus"));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("@rayelus");
    expect(screen.getByText("Rayelus")).toBeInTheDocument();
    expect(screen.getByText(es.memberBadge)).toBeInTheDocument();
    expect(screen.queryByText(es.noProfileTitle)).not.toBeInTheDocument();
    expect(screen.getByText(ADDR)).toBeInTheDocument();
    expect(screen.getByTestId("widget").dataset.accept).toBe("base");
  });

  it("passes the amount and asset of the link to the widget", async () => {
    getPublicProfileView.mockResolvedValue({ alias: "rayelus", displayName: null, address: ADDR, acceptNetworks: ["base", "arbitrum"], isMember: false });
    render(await content("en", "rayelus", { amount: "5", asset: "USDC:84532" }));
    expect(screen.getByTestId("widget").dataset.amount).toBe("5");
    expect(screen.getByTestId("widget").dataset.asset).toBe("USDC:84532");
  });

  it("an unknown alias is a not-found (the proxy fails open on a read error)", async () => {
    getPublicProfileView.mockResolvedValue(null);
    await expect(content("en", "nobody")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("an invalid target is a not-found without reading", async () => {
    await expect(content("en", "Not-Valid!")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getPublicProfileView).not.toHaveBeenCalled();
  });

  it("a read error on an address shows the error state: no widget and no false no-profile warning (D22)", async () => {
    getPublicProfileView.mockRejectedValue(new Error("db down"));
    render(await content("en", ADDR));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Pay 0x2222…2222");
    expect(screen.getByRole("alert")).toHaveTextContent(en.loadFailed);
    expect(screen.getByRole("link", { name: en.retry }).getAttribute("href")).toBe(`/en/pay/${ADDR}`);
    expect(screen.queryByTestId("widget")).not.toBeInTheDocument();
    expect(screen.queryByText(en.noProfileTitle)).not.toBeInTheDocument();
  });

  it("a read error on an alias shows an error state, not a payment form", async () => {
    getPublicProfileView.mockRejectedValue(new Error("db down"));
    render(await content("en", "rayelus"));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Pay @rayelus");
    expect(screen.getByRole("alert")).toHaveTextContent(en.loadFailed);
    expect(screen.getByRole("link", { name: en.retry }).getAttribute("href")).toBe("/en/pay/rayelus");
    expect(screen.queryByTestId("widget")).not.toBeInTheDocument();
  });
});

describe("pay page metadata", () => {
  it("is noindex with a per-language title and alternates", async () => {
    const m = await meta("es", "rayelus");
    expect(m.title).toBe("Pagar a @rayelus");
    expect(m.robots).toMatchObject({ index: false, follow: false });
    expect(m.alternates?.canonical).toMatch(/\/pay\/rayelus$/);
    expect((await meta("en", "rayelus")).title).toBe("Pay @rayelus");
  });

  it("an address title is shortened", async () => {
    expect((await meta("en", ADDR)).title).toBe("Pay 0x2222…2222");
  });
});
