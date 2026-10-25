import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Metadata } from "next";

vi.mock("server-only", () => ({}));
const connection = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("next/server", () => ({ connection }));
const getPublicSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/public-session", () => ({ getPublicSession }));
const q = vi.hoisted(() => ({ getVouchesFor: vi.fn(), getVouchesGivenBy: vi.fn(), getVouchAvailability: vi.fn() }));
vi.mock("@/lib/vouches/queries", () => q);
const getPublicProfileView = vi.hoisted(() => vi.fn());
vi.mock("@/lib/pay/queries", () => ({ getPublicProfileView }));
vi.mock("@/components/public/public-connect-lazy", () => ({
  PublicConnectLazy: (p: { variant?: string; next: string }) => <div data-testid="public-connect" data-variant={p.variant} data-next={p.next} />,
}));
vi.mock("@/components/vouches/vouch-form", () => ({
  VouchForm: (p: { defaultRecipient: string; given: unknown[] }) => <div data-testid="vouch-form" data-recipient={p.defaultRecipient} data-given={p.given.length} />,
}));
vi.mock("@/components/vouches/given-vouches", () => ({ GivenVouches: () => <div data-testid="given-vouches" /> }));
vi.mock("@/components/vouches/refresh-button", () => ({ RefreshButton: () => <button type="button">refresh</button> }));
vi.mock("@/components/vouches/vouch-lookup", () => ({
  VouchLookup: (p: { defaultValue: string; error: string | null }) => <div data-testid="lookup" data-value={p.defaultValue} data-error={p.error ?? ""} />,
}));

import { VouchesContent } from "@/components/vouches/vouches-content";
import { getDictionary } from "@/lib/i18n";
import type { VouchesSummary } from "@/lib/vouches/types";

const es = getDictionary("es").vouches;
const en = getDictionary("en").vouches;
const ME = "0x1111111111111111111111111111111111111111";
const TO = "0x3333333333333333333333333333333333333333";
const UID = `0x${"ab".repeat(32)}`;
const summary: VouchesSummary = {
  total: 1,
  counts: [{ kind: 3, attesters: 1 }],
  items: [{ uid: UID, chainId: 84532, kind: 3, attester: ME, attesterAlias: null, attestedAt: "2026-10-20T10:00:00Z", txHash: `0x${"c".repeat(64)}` }],
};

const content = (lang: "es" | "en", sp: Record<string, string> = {}) => VouchesContent({ lang, searchParams: Promise.resolve(sp) }).then((el) => render(el));

beforeEach(() => {
  vi.clearAllMocks();
  getPublicSession.mockResolvedValue({ userId: "u1", wallet: ME, isMember: false });
  q.getVouchAvailability.mockResolvedValue({ chainId: 84532, registered: true });
  q.getVouchesFor.mockResolvedValue(summary);
  q.getVouchesGivenBy.mockResolvedValue([]);
  getPublicProfileView.mockResolvedValue(null);
});

describe("vouches tool content", () => {
  it("registered: the form (recipient prefilled with the looked-up address) and the given list, after connection()", async () => {
    await content("es", { address: TO });
    expect(connection).toHaveBeenCalled();
    expect(screen.getByTestId("vouch-form").dataset.recipient).toBe(TO);
    expect(screen.getByTestId("given-vouches")).toBeInTheDocument();
    expect(q.getVouchesGivenBy).toHaveBeenCalledWith(ME);
    expect(screen.getByText(`${es.kinds.reliable_trade} · 1`)).toBeInTheDocument();
  });

  it("looking up your own address does not prefill the form with it", async () => {
    await content("es", { address: ME });
    expect(screen.getByTestId("vouch-form").dataset.recipient).toBe("");
  });

  it("schema not registered (Review Focus 1): the unavailable text, no form, and the lookup still works", async () => {
    q.getVouchAvailability.mockResolvedValue({ chainId: 84532, registered: false });
    await content("es", { address: TO });
    expect(screen.getByText(es.unavailable)).toBeInTheDocument();
    expect(es.unavailable).toBe("Los avales aún no están disponibles en esta red.");
    expect(screen.queryByTestId("vouch-form")).not.toBeInTheDocument();
    expect(screen.queryByTestId("given-vouches")).not.toBeInTheDocument();
    expect(q.getVouchesFor).toHaveBeenCalledWith(TO);
    expect(screen.getByText(`${es.kinds.reliable_trade} · 1`)).toBeInTheDocument();
  });

  it("network unknown (RPC down): «try later», no form", async () => {
    q.getVouchAvailability.mockResolvedValue({ chainId: 84532, registered: null });
    await content("es");
    expect(screen.getByText(es.networkUnknown)).toBeInTheDocument();
    expect(es.networkUnknown).toBe("No se pudo comprobar la red, prueba más tarde.");
    expect(screen.queryByTestId("vouch-form")).not.toBeInTheDocument();
  });

  it("no session: connect lead and an outline PublicConnect, no form, no chain read", async () => {
    getPublicSession.mockResolvedValue(null);
    await content("es", { address: TO });
    expect(screen.getByText(es.connectLead)).toBeInTheDocument();
    const connect = screen.getByTestId("public-connect");
    expect(connect.dataset.variant).toBe("outline");
    expect(connect.dataset.next).toBe(`/herramientas/avales?address=${TO}`);
    expect(screen.queryByTestId("vouch-form")).not.toBeInTheDocument();
    expect(q.getVouchAvailability).not.toHaveBeenCalled();
  });

  it("an alias resolves through Pay; an unknown alias says so", async () => {
    getPublicProfileView.mockResolvedValue({ alias: "rayelus", displayName: null, address: TO, acceptNetworks: [], isMember: true });
    const { unmount } = await content("es", { address: "@Rayelus" });
    expect(getPublicProfileView).toHaveBeenCalledWith("rayelus");
    expect(q.getVouchesFor).toHaveBeenCalledWith(TO);
    expect(document.body.textContent).not.toMatch(/miembro/i);
    unmount();

    getPublicProfileView.mockResolvedValue(null);
    q.getVouchesFor.mockClear();
    await content("es", { address: "nadie_aqui" });
    expect(screen.getByTestId("lookup").dataset.error).toBe("notFound");
    expect(q.getVouchesFor).not.toHaveBeenCalled();
  });

  it("an invalid lookup is answered next to the field, without reading anything", async () => {
    await content("es", { address: "0x12" });
    expect(screen.getByTestId("lookup").dataset.error).toBe("invalid");
    expect(q.getVouchesFor).not.toHaveBeenCalled();
    expect(getPublicProfileView).not.toHaveBeenCalled();
  });

  it("a failed read of the vouches shows an error, not an empty list", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    q.getVouchesFor.mockRejectedValue(new Error("db down"));
    await content("es", { address: TO });
    expect(screen.getByRole("alert")).toHaveTextContent(es.summary.loadFailed);
    expect(screen.queryByText(es.summary.empty)).not.toBeInTheDocument();
  });

  it("EN has no Spanish strings", async () => {
    getPublicSession.mockResolvedValue(null);
    await content("en", { address: TO });
    expect(screen.getByText(en.connectLead)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Avalar|Retirar|aval/);
    expect(en.form.submit).not.toBe("Avalar");
    expect(en.given.revoke).not.toBe("Retirar");
    expect(screen.getByTestId("public-connect").dataset.next).toBe(`/en/tools/vouches?address=${TO}`);
  });
});

describe("vouches page", () => {
  afterEach(() => {
    vi.doUnmock("@/components/vouches/vouches-content");
    vi.unstubAllEnvs();
  });

  async function loadPage() {
    vi.resetModules();
    vi.doMock("@/components/vouches/vouches-content", () => ({ VouchesContent: () => <div data-testid="content" /> }));
    return (await import("@/app/(public)/[lang]/tools/vouches/page")) as unknown as {
      default: (p: { params: Promise<{ lang: string }>; searchParams: Promise<Record<string, string>> }) => Promise<React.ReactElement>;
      generateMetadata: (p: { params: Promise<{ lang: string }>; searchParams: Promise<Record<string, string>> }) => Promise<Metadata>;
      instant: unknown;
    };
  }

  it("is blocking, with the title, the lead and the notice outside the Suspense", async () => {
    const page = await loadPage();
    expect(page.instant).toBe(false);
    render(await page.default({ params: Promise.resolve({ lang: "es" }), searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("heading", { level: 1, name: es.title })).toBeInTheDocument();
    expect(screen.getByText(es.lead)).toBeInTheDocument();
    expect(screen.getByText(es.notice)).toBeInTheDocument();
    expect(es.notice).toBe("Un aval es público y permanente en la cadena. Puedes retirarlo, pero el historial queda. ElClub. no verifica identidades.");
  });

  it("metadata: alternates; indexable in production only without ?address=", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://www.elclub.party");
    const page = await loadPage();
    const empty = await page.generateMetadata({ params: Promise.resolve({ lang: "en" }), searchParams: Promise.resolve({}) });
    expect(empty.alternates).toEqual({
      canonical: "/en/tools/vouches",
      languages: { es: "/herramientas/avales", en: "/en/tools/vouches", "x-default": "/herramientas/avales" },
    });
    expect(empty.robots).toMatchObject({ index: true });
    expect(empty.title).toBe(en.metaTitle);
    const lookup = await page.generateMetadata({ params: Promise.resolve({ lang: "es" }), searchParams: Promise.resolve({ address: TO }) });
    expect(lookup.robots).toMatchObject({ index: false, follow: false });
  });
});
