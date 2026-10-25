import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Metadata } from "next";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers({ "x-forwarded-for": "203.0.113.7" })) }));
const hitIpRateLimit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/rate-limit/ip", () => ({ hitIpRateLimit }));
const getTokenReport = vi.hoisted(() => vi.fn());
vi.mock("@/lib/checker/token/analyze", () => ({ getTokenReport }));
const getKnownDomains = vi.hoisted(() => vi.fn());
vi.mock("@/lib/checker/link/allowed", () => ({ getKnownDomains }));

import { CheckerContent } from "@/components/checker/checker-content";
import { generateMetadata } from "@/app/(public)/[lang]/tools/checker/page";
import { tokenAlerts } from "@/lib/checker/token/alerts";
import { ok, unknown, type TokenFacts, type TokenReport } from "@/lib/checker/token/types";
import { getDictionary } from "@/lib/i18n";

const ADDR = "0x1234567890abcdef1234567890abcdef12345678";
const es = getDictionary("es").checker;
const en = getDictionary("en").checker;

function facts(over: Partial<TokenFacts> = {}): TokenFacts {
  return {
    chainId: 84532,
    address: ADDR,
    code: ok({ hasCode: true }),
    erc20: ok({ name: "Gato", symbol: "GATO", decimals: 18, totalSupply: "1000000000000000000000" }),
    proxy: ok({ isProxy: false, implementation: null }),
    owner: ok({ owner: null, renounced: true }),
    verification: ok({ verified: true, source: "blockscout", abiFlags: [] }),
    creation: ok({ creator: null, createdAt: "2026-01-01T00:00:00Z", ageDays: 300, ageUnknown: null, isScam: false }),
    market: ok({ pairs: 2, liquidityUsd: 50_000, priceUsd: "0.01", fdv: 100_000, topPairUrl: "https://dexscreener.com/base/0xpair" }),
    ...over,
  };
}
const report = (f: TokenFacts): TokenReport => ({ facts: f, alerts: tokenAlerts(f), checkedAt: "2026-10-25T10:00:00Z" });

const content = (lang: "es" | "en", sp: Record<string, string>) =>
  CheckerContent({ lang, searchParams: Promise.resolve(sp) }).then((el) => render(el));

beforeEach(() => {
  hitIpRateLimit.mockReset().mockResolvedValue("ok");
  getTokenReport.mockReset();
  getKnownDomains.mockReset().mockResolvedValue(["elclub.party", "metamask.io"]);
});

describe("checker page", () => {
  it("without q shows only the form and checks nothing", async () => {
    await content("es", {});
    expect(screen.getByLabelText(es.form.label)).toHaveValue("");
    expect(hitIpRateLimit).not.toHaveBeenCalled();
    expect(getTokenReport).not.toHaveBeenCalled();
  });

  it("unknown sections show «Desconocido» with a reason and never a plain «Sin alertas»", async () => {
    getTokenReport.mockResolvedValue(
      report(
        facts({
          verification: ok({ verified: true, source: "sourcify", abiFlags: null }),
          creation: ok({ creator: null, createdAt: null, ageDays: null, ageUnknown: "timeout", isScam: false }),
          market: unknown("blocked"),
        }),
      ),
    );
    await content("es", { q: ADDR, chain: "84532" });
    expect(getTokenReport).toHaveBeenCalledWith(84532, ADDR);
    // market section, age and privileged functions are all unknown
    expect(screen.getAllByText(es.report.unknown).length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByText(es.report.reasons.blocked).length).toBeGreaterThan(0);
    expect(screen.getAllByText(es.report.reasons.timeout).length).toBeGreaterThan(0);
    expect(screen.getByText(es.report.summary.noAlertsPartial)).toBeInTheDocument();
    expect(screen.queryByText(es.report.summary.noAlertsAll)).not.toBeInTheDocument();
    const unknownList = screen.getByRole("list", { name: es.report.summary.unknownTitle });
    expect(within(unknownList).getByText(new RegExp(es.report.sections.market))).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/segur|safe/i);
    expect(screen.getByText(es.disclaimer)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: new RegExp(es.report.explorer) })).toHaveAttribute(
      "href",
      `https://sepolia.basescan.org/address/${ADDR}`,
    );
  });

  it("creation row: a known creation without creator says «Creador desconocido», not «no creation transaction»", async () => {
    getTokenReport.mockResolvedValue(report(facts()));
    await content("es", { q: ADDR, chain: "84532" });
    expect(screen.getByText(es.report.values.creatorUnknown)).toBeInTheDocument();
    expect(screen.queryByText(es.report.values.ageNone)).not.toBeInTheDocument();
  });

  it("creation row: no creation transaction known at all keeps «Sin transacción de creación conocida»", async () => {
    getTokenReport.mockResolvedValue(report(facts({ creation: ok({ creator: null, createdAt: null, ageDays: null, ageUnknown: null, isScam: false }) })));
    await content("es", { q: ADDR, chain: "84532" });
    expect(screen.getByText(es.report.values.ageNone)).toBeInTheDocument();
    expect(screen.queryByText(es.report.values.creatorUnknown)).not.toBeInTheDocument();
  });

  it("a contract Blockscout has not indexed lists the age under «No pudimos comprobar»", async () => {
    getTokenReport.mockResolvedValue(
      report(facts({ creation: ok({ creator: null, createdAt: null, ageDays: null, ageUnknown: "not_indexed", isScam: false }) })),
    );
    await content("es", { q: ADDR, chain: "84532" });
    const unknownList = screen.getByRole("list", { name: es.report.summary.unknownTitle });
    expect(within(unknownList).getByText(new RegExp(es.report.sections.age))).toBeInTheDocument();
    expect(screen.getAllByText(es.report.reasons.not_indexed).length).toBeGreaterThan(0);
    expect(screen.getByText(es.report.values.creatorUnknown)).toBeInTheDocument();
  });

  it("counts alerts by severity and links DexScreener", async () => {
    getTokenReport.mockResolvedValue(
      report(facts({ verification: ok({ verified: false, source: "blockscout", abiFlags: [] }), owner: ok({ owner: ADDR, renounced: false }) })),
    );
    await content("es", { q: ADDR, chain: "84532" });
    const summary = screen.getByRole("region", { name: es.report.summary.title });
    expect(within(summary).getByTestId("count-medium")).toHaveTextContent("1");
    expect(within(summary).getByTestId("count-info")).toHaveTextContent("1");
    expect(within(summary).getByTestId("count-high")).toHaveTextContent("0");
    expect(screen.getByText(es.alerts.token.unverified.title)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: new RegExp(es.report.dexscreener) })).toHaveAttribute("href", "https://dexscreener.com/base/0xpair");
    expect(screen.getByRole("button", { name: es.report.copyLink })).toBeInTheDocument();
  });

  it("rate_limited shows the message and does not analyze", async () => {
    hitIpRateLimit.mockResolvedValue("rate_limited");
    await content("es", { q: ADDR, chain: "84532" });
    expect(screen.getByText(es.rateLimited)).toBeInTheDocument();
    expect(getTokenReport).not.toHaveBeenCalled();
    expect(getKnownDomains).not.toHaveBeenCalled();
  });

  it("a limiter error does not block the report (fails open)", async () => {
    hitIpRateLimit.mockResolvedValue("error");
    getTokenReport.mockResolvedValue(report(facts()));
    await content("es", { q: ADDR, chain: "84532" });
    expect(getTokenReport).toHaveBeenCalled();
    expect(screen.getByText(es.report.summary.noAlertsAll)).toBeInTheDocument();
  });

  it("an invalid address shows the error next to the field and analyzes nothing", async () => {
    await content("es", { q: "0x1234" });
    const input = screen.getByLabelText(es.form.label);
    expect(input).toHaveAttribute("aria-invalid", "true");
    const err = screen.getByText(es.form.errors.invalid_address);
    expect(input.getAttribute("aria-describedby")).toContain(err.id);
    expect(hitIpRateLimit).not.toHaveBeenCalled();
    expect(getTokenReport).not.toHaveBeenCalled();
  });

  it("a chain outside this build is an error, not a guess", async () => {
    await content("es", { q: ADDR, chain: "8453" });
    expect(screen.getByText(es.form.errors.invalid_chain)).toBeInTheDocument();
    expect(getTokenReport).not.toHaveBeenCalled();
  });

  it("a link gets a local report with its alerts", async () => {
    await content("es", { q: "http://rnetamask.io/login" });
    expect(getKnownDomains).toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: es.report.linkTitle })).toBeInTheDocument();
    expect(screen.getByText(es.alerts.link.not_https.title)).toBeInTheDocument();
    expect(screen.getByText(es.alerts.link.lookalike.title)).toBeInTheDocument();
  });

  it("an unparseable link is an error next to the field", async () => {
    await content("es", { q: "javascript:alert(1)" });
    expect(screen.getByText(es.form.errors.invalid_url)).toBeInTheDocument();
  });

  it("EN shows no Spanish strings", async () => {
    getTokenReport.mockResolvedValue(
      report(
        facts({
          verification: ok({ verified: true, source: "sourcify", abiFlags: ["mint"] }),
          owner: ok({ owner: ADDR, renounced: false }),
          creation: ok({ creator: ADDR, createdAt: null, ageDays: null, ageUnknown: "error", isScam: true }),
          market: unknown("unsupported"),
        }),
      ),
    );
    const { container } = await content("en", { q: ADDR, chain: "421614" });
    const link = await content("en", { q: "http://rnetamask.io" });
    const text = `${container.textContent} ${link.container.textContent}`;
    expect(text).toContain(en.disclaimer);
    for (const s of spanishOnly()) expect(text, s).not.toContain(s);
  });
});

describe("checker metadata", () => {
  const meta = (sp: Record<string, string>) =>
    generateMetadata({ params: Promise.resolve({ lang: "es" }), searchParams: Promise.resolve(sp) } as never) as Promise<Metadata>;

  it("a report (q present) is noindex", async () => {
    expect((await meta({ q: ADDR })).robots).toMatchObject({ index: false, follow: false });
  });

  it("the empty page keeps its canonical", async () => {
    const m = await meta({});
    expect(m.alternates?.canonical).toBeTruthy();
  });
});

/** Spanish fragments (≥ 6 chars) of the checker dictionary that differ from English. */
function spanishOnly(): string[] {
  const out: string[] = [];
  const walk = (a: unknown, b: unknown) => {
    if (typeof a === "string") {
      if (a === b) return;
      for (const frag of a.split(/\{\w+\}/)) if (frag.trim().length >= 6) out.push(frag.trim());
      return;
    }
    if (a && typeof a === "object") for (const k of Object.keys(a)) walk((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]);
  };
  walk(es, en);
  return out;
}
