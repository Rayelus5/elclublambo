import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));

import { clientIp, hitIpRateLimit, ipSubject } from "@/lib/rate-limit/ip";

const h = (o: Record<string, string>) => new Headers(o);

describe("clientIp (P4-R6)", () => {
  it("uses the first x-forwarded-for entry", () => {
    expect(clientIp(h({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }), {})).toBe("1.2.3.4");
  });
  it("uses TRUSTED_IP_HEADER when set", () => {
    const headers = h({ "cf-connecting-ip": "5.6.7.8", "x-forwarded-for": "1.2.3.4" });
    expect(clientIp(headers, { TRUSTED_IP_HEADER: "cf-connecting-ip" })).toBe("5.6.7.8");
  });
  it("returns null without usable headers", () => {
    expect(clientIp(h({}), {})).toBeNull();
    expect(clientIp(h({ "x-forwarded-for": "  , " }), {})).toBeNull();
  });
});

describe("ipSubject", () => {
  it("never contains the IP and is stable per key", () => {
    const a = ipSubject("1.2.3.4", "k1");
    expect(a).toMatch(/^ip:[0-9a-f]{32}$/);
    expect(a).not.toContain("1.2.3.4");
    expect(ipSubject("1.2.3.4", "k1")).toBe(a);
    expect(ipSubject("1.2.3.4", "k2")).not.toBe(a);
    expect(ipSubject("1.2.3.5", "k1")).not.toBe(a);
  });
  it("is ip:unknown without an IP or without a key (no throw)", () => {
    expect(ipSubject(null, "k1")).toBe("ip:unknown");
    expect(ipSubject("1.2.3.4", "")).toBe("ip:unknown");
    expect(ipSubject("1.2.3.4", undefined)).toBe("ip:unknown");
  });
});

describe("hitIpRateLimit", () => {
  it("maps rpc results", async () => {
    rpc.mockResolvedValueOnce({ error: null });
    await expect(hitIpRateLimit("api_free", h({ "x-forwarded-for": "1.2.3.4" }))).resolves.toBe("ok");
    expect(rpc).toHaveBeenCalledWith("ip_rate_limit_hit", { p_subject: expect.stringMatching(/^ip:/), p_bucket: "api_free" });
    rpc.mockResolvedValueOnce({ error: { message: "rate_limited" } });
    await expect(hitIpRateLimit("checker_web", h({}))).resolves.toBe("rate_limited");
    rpc.mockResolvedValueOnce({ error: { message: "boom" } });
    await expect(hitIpRateLimit("checker_web", h({}))).resolves.toBe("error");
    rpc.mockRejectedValueOnce(new Error("net"));
    await expect(hitIpRateLimit("checker_web", h({}))).resolves.toBe("error");
  });
});
