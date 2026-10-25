// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
const hitIpRateLimit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/rate-limit/ip", () => ({ hitIpRateLimit }));
const getKnownDomains = vi.hoisted(() => vi.fn());
vi.mock("@/lib/checker/link/allowed", () => ({ getKnownDomains }));
vi.mock("@x402/core/server", async (importOriginal) => {
  const { FakeFacilitatorClient } = await import("./x402-mocks");
  return { ...(await importOriginal<typeof import("@x402/core/server")>()), HTTPFacilitatorClient: FakeFacilitatorClient };
});

import { GET } from "@/app/api/v1/check/link/route";
import { CHECKER_DISCLAIMER } from "@/lib/checker/api";
import { analyzeLink } from "@/lib/checker/link/analyze";
import { decode, facilitator, paymentSignature, resetFacilitator } from "./x402-mocks";

const KNOWN = ["elclub.party", "github.com"];
const req = (qs: string, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost/api/v1/check/link${qs}`, { headers: { "x-forwarded-for": "203.0.113.7", ...headers } });
const q = (url: string) => `?url=${encodeURIComponent(url)}`;

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("X402_ENABLED", "");
  hitIpRateLimit.mockReset().mockResolvedValue("ok");
  getKnownDomains.mockReset().mockResolvedValue(KNOWN);
  resetFacilitator();
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/v1/check/link — free (x402 off)", () => {
  it("answers the local analysis with version, kind, disclaimer and no-store", async () => {
    const res = await GET(req(q("http://gihtub.com/login")));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      version: 1,
      kind: "link",
      report: analyzeLink("http://gihtub.com/login", KNOWN),
      disclaimer: CHECKER_DISCLAIMER,
    });
    expect(hitIpRateLimit).toHaveBeenCalledWith("api_free", expect.any(Headers));
  });

  it("Review Focus 4: rate_limited → 429 with Retry-After: 3600", async () => {
    hitIpRateLimit.mockResolvedValue("rate_limited");
    const res = await GET(req(q("https://github.com")));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("3600");
    expect(getKnownDomains).not.toHaveBeenCalled();
  });

  it("the limiter failing → 503", async () => {
    hitIpRateLimit.mockResolvedValue("error");
    expect((await GET(req(q("https://github.com")))).status).toBe(503);
  });

  it("bad parameters → 400 { error } before the limiter", async () => {
    for (const qs of ["", "?url=", q("javascript:alert(1)"), q("not a url"), q(`https://a.com/${"x".repeat(5000)}`)]) {
      const res = await GET(req(qs));
      expect(res.status, qs).toBe(400);
      expect(await res.json(), qs).toEqual({ error: "invalid_url" });
    }
    expect(hitIpRateLimit).not.toHaveBeenCalled();
  });

  it("the analyser throwing → 502", async () => {
    getKnownDomains.mockRejectedValue(new Error("boom"));
    const res = await GET(req(q("https://github.com")));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "analysis_failed" });
  });
});

describe("GET /api/v1/check/link — x402 on (Review Focus 5)", () => {
  beforeEach(() => {
    vi.stubEnv("X402_ENABLED", "true");
    vi.stubEnv("X402_NETWORK", "eip155:84532");
  });

  it("without a payment header → 402 with PAYMENT-REQUIRED; the public facilitator by default", async () => {
    const res = await GET(req(q("https://github.com")));
    expect(res.status).toBe(402);
    const pr = decode(res.headers.get("payment-required"));
    expect(pr.accepts[0]).toMatchObject({ scheme: "exact", network: "eip155:84532" });
    expect(facilitator.constructed).toHaveBeenCalledWith(expect.objectContaining({ url: "https://x402.org/facilitator" }));
    expect(getKnownDomains).not.toHaveBeenCalled();
    expect(hitIpRateLimit).not.toHaveBeenCalled();
  });

  it("the 402 resource URL uses the public origin, not the bind address", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://pre.elclub.party");
    const internal = new NextRequest(`http://0.0.0.0:3000/api/v1/check/link${q("https://github.com")}`, { headers: { "x-forwarded-for": "203.0.113.7" } });
    const res = await GET(internal);
    expect(res.status).toBe(402);
    const pr = decode(res.headers.get("payment-required"));
    expect(pr.resource.url.startsWith("https://pre.elclub.party/api/v1/check/link")).toBe(true);
    expect(pr.resource.url).toContain("url=");
  });

  it("the analyser throwing after a verified payment → 502, never settled", async () => {
    const first = await GET(req(q("https://github.com")));
    const sig = paymentSignature(decode(first.headers.get("payment-required")));
    getKnownDomains.mockRejectedValue(new Error("boom"));
    const res = await GET(req(q("https://github.com"), { "payment-signature": sig }));
    expect(res.status).toBe(502);
    expect(facilitator.settle).not.toHaveBeenCalled();
  });

  it("a verified payment → 200, settled once", async () => {
    const first = await GET(req(q("https://github.com")));
    const sig = paymentSignature(decode(first.headers.get("payment-required")));
    const res = await GET(req(q("https://github.com"), { "payment-signature": sig }));
    expect(res.status).toBe(200);
    expect(facilitator.settle).toHaveBeenCalledTimes(1);
  });

  it("an invalid link → 400, no payment asked", async () => {
    const res = await GET(req(q("javascript:alert(1)")));
    expect(res.status).toBe(400);
    expect(res.headers.get("payment-required")).toBeNull();
  });
});
