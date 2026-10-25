import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Metadata } from "next";

vi.mock("server-only", () => ({}));
const connection = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("next/server", () => ({ connection }));
const headersFn = vi.hoisted(() => vi.fn(async () => new Headers()));
vi.mock("next/headers", () => ({ headers: headersFn }));
const hitIpRateLimit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/rate-limit/ip", () => ({ hitIpRateLimit }));
const scanApprovals = vi.hoisted(() => vi.fn());
vi.mock("@/lib/approvals/read", () => ({ scanApprovals }));
const getPublicSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/public-session", () => ({ getPublicSession }));
vi.mock("@/components/approvals/approvals-lazy", () => ({
  ApprovalsLazy: (p: { lang: string; chainId: number; owner: string; scan: { status: string }; sessionWallet: string | null }) => (
    <div data-testid="list" data-lang={p.lang} data-chain={p.chainId} data-owner={p.owner} data-scan={p.scan.status} data-session={p.sessionWallet ?? ""} />
  ),
}));
vi.mock("@/components/approvals/approvals-lookup", () => ({
  ApprovalsLookup: (p: { defaultValue: string; defaultChain: string; error: string | null; action: string; primary: boolean }) => (
    <div data-testid="lookup" data-value={p.defaultValue} data-chain={p.defaultChain} data-error={p.error ?? ""} data-action={p.action} data-primary={String(p.primary)} />
  ),
}));

import { ApprovalsContent } from "@/components/approvals/approvals-content";
import { getDictionary } from "@/lib/i18n";

const es = getDictionary("es");
const en = getDictionary("en");
const OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const SESSION = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

const content = (lang: "es" | "en", sp: Record<string, string> = {}) => ApprovalsContent({ lang, searchParams: Promise.resolve(sp) }).then((el) => render(el));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "testnet");
  hitIpRateLimit.mockResolvedValue("ok");
  scanApprovals.mockResolvedValue({ status: "ok", rows: [], partial: false });
  getPublicSession.mockResolvedValue({ userId: "u1", wallet: SESSION, isMember: false });
});

describe("approvals content", () => {
  it("without ?address=: only the form (the primary CTA), nothing read", async () => {
    await content("es");
    const lookup = screen.getByTestId("lookup");
    expect(lookup.dataset.primary).toBe("true");
    expect(lookup.dataset.action).toBe("/herramientas/aprobaciones");
    expect(screen.queryByTestId("list")).not.toBeInTheDocument();
    expect(hitIpRateLimit).not.toHaveBeenCalled();
    expect(scanApprovals).not.toHaveBeenCalled();
  });

  it("with ?address=: limiter, then the scan on Base by default, the session wallet, then the list", async () => {
    await content("es", { address: OWNER });
    expect(connection).toHaveBeenCalled();
    expect(hitIpRateLimit).toHaveBeenCalledWith("approvals_scan", expect.any(Headers));
    expect(scanApprovals).toHaveBeenCalledWith(84532, OWNER);
    const list = screen.getByTestId("list");
    expect(list.dataset).toMatchObject({ chain: "84532", owner: OWNER, scan: "ok", session: SESSION, lang: "es" });
    expect(screen.getByTestId("lookup").dataset.primary).toBe("false");
  });

  it("?chain=arbitrum scans Arbitrum; ?chain=polygon falls back to Base", async () => {
    const { unmount } = await content("es", { address: OWNER, chain: "arbitrum" });
    expect(scanApprovals).toHaveBeenLastCalledWith(421614, OWNER);
    expect(screen.getByTestId("lookup").dataset.chain).toBe("arbitrum");
    unmount();
    await content("es", { address: OWNER, chain: "polygon" });
    expect(scanApprovals).toHaveBeenLastCalledWith(84532, OWNER);
    expect(screen.getByTestId("lookup").dataset.chain).toBe("base");
  });

  it("rate_limited: the text, no scan", async () => {
    hitIpRateLimit.mockResolvedValue("rate_limited");
    await content("es", { address: OWNER });
    expect(screen.getByRole("alert")).toHaveTextContent(es.approvals.rateLimited);
    expect(es.approvals.rateLimited).toBe("Demasiadas consultas, espera unos minutos.");
    expect(scanApprovals).not.toHaveBeenCalled();
    expect(screen.queryByTestId("list")).not.toBeInTheDocument();
  });

  it("a limiter error lets the scan through; no session is a null session wallet", async () => {
    hitIpRateLimit.mockResolvedValue("error");
    getPublicSession.mockResolvedValue(null);
    await content("es", { address: OWNER });
    expect(scanApprovals).toHaveBeenCalled();
    expect(screen.getByTestId("list").dataset.session).toBe("");
  });

  it("an invalid address is answered next to the field without spending quota", async () => {
    await content("es", { address: "0x12" });
    expect(screen.getByTestId("lookup").dataset.error).toBe("invalid");
    expect(hitIpRateLimit).not.toHaveBeenCalled();
    expect(scanApprovals).not.toHaveBeenCalled();
  });
});

describe("approvals page", () => {
  afterEach(() => {
    vi.doUnmock("@/components/approvals/approvals-content");
    vi.unstubAllEnvs();
  });

  async function loadPage() {
    vi.resetModules();
    vi.doMock("@/components/approvals/approvals-content", () => ({ ApprovalsContent: () => <div data-testid="content" /> }));
    return (await import("@/app/(public)/[lang]/tools/approvals/page")) as unknown as {
      default: (p: { params: Promise<{ lang: string }>; searchParams: Promise<Record<string, string>> }) => Promise<React.ReactElement>;
      generateMetadata: (p: { params: Promise<{ lang: string }>; searchParams: Promise<Record<string, string>> }) => Promise<Metadata>;
      instant: unknown;
    };
  }

  it("is blocking, with the title, the gas notice and noCustody outside the Suspense", async () => {
    const page = await loadPage();
    expect(page.instant).toBe(false);
    render(await page.default({ params: Promise.resolve({ lang: "es" }), searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("heading", { level: 1, name: es.approvals.title })).toBeInTheDocument();
    expect(screen.getByText(es.approvals.gasNotice)).toBeInTheDocument();
    expect(es.approvals.gasNotice).toBe("Retirar un permiso es una transacción: cuesta gas.");
    expect(screen.getByText(es.common.noCustody)).toBeInTheDocument();
  });

  it("metadata: alternates; indexable in production only without ?address=", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://www.elclub.party");
    const page = await loadPage();
    const empty = await page.generateMetadata({ params: Promise.resolve({ lang: "en" }), searchParams: Promise.resolve({}) });
    expect(empty.alternates).toMatchObject({ canonical: "/en/tools/approvals" });
    expect(empty.robots).toMatchObject({ index: true });
    const lookup = await page.generateMetadata({ params: Promise.resolve({ lang: "es" }), searchParams: Promise.resolve({ address: OWNER }) });
    expect(lookup.robots).toMatchObject({ index: false, follow: false });
  });

  it("EN has no Spanish strings", async () => {
    const page = await loadPage();
    render(await page.default({ params: Promise.resolve({ lang: "en" }), searchParams: Promise.resolve({}) }));
    expect(document.body.textContent).not.toMatch(/Retirar|Ilimitada|permiso/);
    const flat = JSON.stringify(en.approvals);
    expect(flat).not.toMatch(/Retirar|Ilimitada|Desconocido|Cuenta normal|permiso|Revisar|Comprobar/);
  });
});
