// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
const hitIpRateLimit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/rate-limit/ip", () => ({ hitIpRateLimit }));
const getTokenReport = vi.hoisted(() => vi.fn());
vi.mock("@/lib/checker/token/analyze", () => ({ getTokenReport }));
vi.mock("@x402/core/server", async (importOriginal) => {
  const { FakeFacilitatorClient } = await import("./x402-mocks");
  return { ...(await importOriginal<typeof import("@x402/core/server")>()), HTTPFacilitatorClient: FakeFacilitatorClient };
});

import { GET } from "@/app/api/v1/check/token/route";
import { CHECKER_DISCLAIMER } from "@/lib/checker/api";
import { decode, facilitator, paymentSignature, resetFacilitator } from "./x402-mocks";

const ADDR = "0x1234567890abcdef1234567890ABCDEF12345678";
const REPORT = { facts: { chainId: 84532, address: ADDR.toLowerCase() }, alerts: [], checkedAt: "2026-10-25T10:00:00Z" };

const req = (qs: string, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost/api/v1/check/token${qs}`, { headers: { "x-forwarded-for": "203.0.113.7", ...headers } });

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "testnet");
  vi.stubEnv("X402_ENABLED", "");
  hitIpRateLimit.mockReset().mockResolvedValue("ok");
  getTokenReport.mockReset().mockResolvedValue(REPORT);
  resetFacilitator();
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/v1/check/token — free (x402 off)", () => {
  it("answers the report with version, kind, disclaimer and no-store, after one api_free hit", async () => {
    const res = await GET(req(`?chain=84532&address=${ADDR}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ version: 1, kind: "token", report: REPORT, disclaimer: CHECKER_DISCLAIMER });
    expect(CHECKER_DISCLAIMER).toBe("No es asesoramiento financiero. Comprueba siempre por tu cuenta.");
    expect(hitIpRateLimit).toHaveBeenCalledTimes(1);
    expect(hitIpRateLimit).toHaveBeenCalledWith("api_free", expect.any(Headers));
    expect((hitIpRateLimit.mock.lastCall?.[1] as Headers | undefined)?.get("x-forwarded-for")).toBe("203.0.113.7");
    expect(getTokenReport).toHaveBeenCalledWith(84532, ADDR);
    expect(facilitator.constructed).not.toHaveBeenCalled();
  });

  it("Review Focus 4: rate_limited → 429 with Retry-After: 3600, no analysis", async () => {
    hitIpRateLimit.mockResolvedValue("rate_limited");
    const res = await GET(req(`?chain=84532&address=${ADDR}`));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("3600");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "rate_limited" });
    expect(getTokenReport).not.toHaveBeenCalled();
  });

  it("the limiter failing → 503 (fail closed), no analysis", async () => {
    hitIpRateLimit.mockResolvedValue("error");
    const res = await GET(req(`?chain=84532&address=${ADDR}`));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unavailable" });
    expect(getTokenReport).not.toHaveBeenCalled();
  });

  it("bad parameters → 400 { error } before the limiter", async () => {
    const cases: [string, string][] = [
      [`?address=${ADDR}`, "invalid_chain"],
      [`?chain=abc&address=${ADDR}`, "invalid_chain"],
      [`?chain=1&address=${ADDR}`, "invalid_chain"],
      // A mainnet chain is not served by a testnet build (the page's rule).
      [`?chain=8453&address=${ADDR}`, "invalid_chain"],
      ["?chain=84532", "invalid_address"],
      ["?chain=84532&address=0x123", "invalid_address"],
      [`?chain=84532&address=${ADDR}00`, "invalid_address"],
    ];
    for (const [qs, error] of cases) {
      const res = await GET(req(qs));
      expect(res.status, qs).toBe(400);
      expect(await res.json(), qs).toEqual({ error });
    }
    expect(hitIpRateLimit).not.toHaveBeenCalled();
    expect(getTokenReport).not.toHaveBeenCalled();
  });

  it("the analyser throwing → 502", async () => {
    getTokenReport.mockRejectedValue(new Error("boom"));
    const res = await GET(req(`?chain=84532&address=${ADDR}`));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "analysis_failed" });
  });

  it("mainnet x402 without CDP keys stays free (limiter, no facilitator)", async () => {
    vi.stubEnv("X402_ENABLED", "true");
    vi.stubEnv("X402_NETWORK", "eip155:8453");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await GET(req(`?chain=84532&address=${ADDR}`));
    expect(res.status).toBe(200);
    expect(hitIpRateLimit).toHaveBeenCalledWith("api_free", expect.any(Headers));
    expect(facilitator.constructed).not.toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(" ")).toContain("missing_cdp_keys");
    warn.mockRestore();
  });
});

describe("GET /api/v1/check/token — x402 on (Review Focus 5)", () => {
  beforeEach(() => {
    vi.stubEnv("X402_ENABLED", "true");
    vi.stubEnv("X402_NETWORK", "eip155:84532");
    vi.stubEnv("X402_FACILITATOR_URL", "https://facilitator.test");
  });

  async function paymentRequired() {
    const res = await GET(req(`?chain=84532&address=${ADDR}`));
    expect(res.status).toBe(402);
    return decode(res.headers.get("payment-required"));
  }

  it("without a payment header → 402 with PAYMENT-REQUIRED (exact, Base Sepolia, the club Safe), no analysis, no limiter", async () => {
    const pr = await paymentRequired();
    expect(pr.x402Version).toBe(2);
    expect(pr.accepts[0]).toMatchObject({ scheme: "exact", network: "eip155:84532", payTo: "0x380f2e12081995359e2Ab88E3c31c6b227904234", amount: "10000" });
    expect(facilitator.constructed).toHaveBeenCalledWith(expect.objectContaining({ url: "https://facilitator.test" }));
    expect(getTokenReport).not.toHaveBeenCalled();
    expect(hitIpRateLimit).not.toHaveBeenCalled();
    expect(facilitator.settle).not.toHaveBeenCalled();
  });

  it("a verified payment → 200 with the report, settled once, PAYMENT-RESPONSE set", async () => {
    const sig = paymentSignature(await paymentRequired());
    const res = await GET(req(`?chain=84532&address=${ADDR}`, { "payment-signature": sig }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ version: 1, kind: "token", report: REPORT });
    expect(facilitator.verify).toHaveBeenCalledTimes(1);
    expect(facilitator.settle).toHaveBeenCalledTimes(1);
    expect(res.headers.get("payment-response")).toBeTruthy();
  });

  it("the analyser throwing → 502 and the facilitator never settles", async () => {
    const sig = paymentSignature(await paymentRequired());
    getTokenReport.mockRejectedValue(new Error("boom"));
    const res = await GET(req(`?chain=84532&address=${ADDR}`, { "payment-signature": sig }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "analysis_failed" });
    expect(facilitator.verify).toHaveBeenCalledTimes(1);
    expect(facilitator.settle).not.toHaveBeenCalled();
  });

  it("bad parameters → 400 without asking for payment", async () => {
    const res = await GET(req("?chain=84532&address=0x123"));
    expect(res.status).toBe(400);
    expect(res.headers.get("payment-required")).toBeNull();
    expect(await res.json()).toEqual({ error: "invalid_address" });
  });
});
