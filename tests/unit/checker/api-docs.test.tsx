import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const connection = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("next/server", () => ({ connection }));
const x402Config = vi.hoisted(() => vi.fn());
vi.mock("@/lib/checker/x402", () => ({ x402Config }));

import { ApiDocsBody, ApiDocsStatus } from "@/components/checker/api-docs";

const ORIGIN = "https://www.elclub.party";

beforeEach(() => {
  connection.mockClear();
  x402Config.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("API docs body", () => {
  it("ES: both endpoints with curl examples against the absolute origin, the response shape and the free limit", () => {
    render(<ApiDocsBody lang="es" />);
    expect(screen.getAllByText(/GET \/api\/v1\/check\/token\?chain=<id>&address=<0x…>/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/GET \/api\/v1\/check\/link\?url=<encoded>/).length).toBeGreaterThanOrEqual(1);
    const code = Array.from(document.querySelectorAll("pre")).map((p) => p.textContent ?? "");
    expect(code.some((c) => c.startsWith(`curl "${ORIGIN}/api/v1/check/token?chain=`))).toBe(true);
    expect(code.some((c) => c.startsWith(`curl "${ORIGIN}/api/v1/check/link?url=`))).toBe(true);
    expect(code.some((c) => /version/.test(c) && /kind/.test(c) && /report/.test(c) && /disclaimer/.test(c))).toBe(true);
    expect(screen.getByText(/60 consultas por hora/)).toBeTruthy();
    expect(screen.getByText(/429/)).toBeTruthy();
  });
  it("the curl example uses this build's first chain (Base Sepolia on a testnet build, Base on mainnet)", () => {
    vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "testnet");
    const { unmount } = render(<ApiDocsBody lang="es" />);
    const curl = () => Array.from(document.querySelectorAll("pre")).map((p) => p.textContent ?? "").find((c) => c.startsWith("curl") && c.includes("/check/token?")) ?? "";
    expect(curl()).toContain("chain=84532&");
    unmount();
    vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "mainnet");
    render(<ApiDocsBody lang="es" />);
    expect(curl()).toContain("chain=8453&");
  });
  it("the limits apply when charging is off (they do not contradict the paid status)", () => {
    render(<ApiDocsBody lang="es" />);
    expect(screen.getByText(/Cuando el cobro está desactivado/)).toBeTruthy();
  });
  it("EN: the response notes the disclaimer is in Spanish, and the limit is for when charging is off", () => {
    render(<ApiDocsBody lang="en" />);
    expect(screen.getByText(/disclaimer.*Spanish|Spanish.*disclaimer|in Spanish/i)).toBeTruthy();
    expect(screen.getByText(/When charging is off/)).toBeTruthy();
  });
  it("code blocks scroll inside their own box", () => {
    render(<ApiDocsBody lang="en" />);
    for (const pre of document.querySelectorAll("pre")) {
      expect(pre.className).toMatch(/overflow-x-auto/);
      expect(pre.className).toMatch(/font-mono/);
    }
  });
  it("EN: documents the free limit in English", () => {
    render(<ApiDocsBody lang="en" />);
    expect(screen.getByText(/60 requests per hour/)).toBeTruthy();
  });
});

describe("API docs status (read per request)", () => {
  it("free when x402 is off, and says charging may be disabled", async () => {
    x402Config.mockReturnValue({ enabled: false, reason: "disabled" });
    render(await ApiDocsStatus({ lang: "es" }));
    expect(connection).toHaveBeenCalled();
    expect(screen.getByText(/Gratis/)).toBeTruthy();
    expect(screen.getByText(/El cobro puede estar desactivado/)).toBeTruthy();
    expect(screen.queryByText(/x402/)).toBeNull();
  });
  it("x402 on Base Sepolia: network, price and the client hint", async () => {
    x402Config.mockReturnValue({ enabled: true, network: "eip155:84532", price: "$0.01", payTo: "0x1", facilitator: "public", facilitatorUrl: "https://x402.org/facilitator" });
    render(await ApiDocsStatus({ lang: "es" }));
    expect(screen.getByText(/Base Sepolia/)).toBeTruthy();
    expect(screen.getByText(/\$0\.01/)).toBeTruthy();
    expect(screen.getByText(/@x402\/fetch/)).toBeTruthy();
    expect(screen.getByText(/El cobro puede estar desactivado/)).toBeTruthy();
  });
  it("x402 on Base mainnet (EN)", async () => {
    x402Config.mockReturnValue({ enabled: true, network: "eip155:8453", price: "$0.05", payTo: "0x1", facilitator: "cdp" });
    render(await ApiDocsStatus({ lang: "en" }));
    expect(screen.getByText(/Base \(/)).toBeTruthy();
    expect(screen.getByText(/\$0\.05/)).toBeTruthy();
    expect(screen.getByText(/Charging may be disabled/)).toBeTruthy();
  });
});
