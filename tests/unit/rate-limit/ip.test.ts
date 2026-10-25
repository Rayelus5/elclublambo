import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));

import { clientIp, hitIpRateLimit, ipSubject, normalizeIp } from "@/lib/rate-limit/ip";

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

describe("normalizeIp (final review item 4: one IPv6 /64 is one subject)", () => {
  it("keeps IPv4 as is", () => {
    expect(normalizeIp("1.2.3.4")).toBe("1.2.3.4");
    expect(normalizeIp(" 1.2.3.4 ")).toBe("1.2.3.4");
  });
  it("reduces IPv6 to its /64 prefix, whatever the spelling", () => {
    const p = "2001:db8:1:2::/64";
    expect(normalizeIp("2001:db8:1:2:3:4:5:6")).toBe(p);
    expect(normalizeIp("2001:0DB8:0001:0002:ffff:0:0:1")).toBe(p);
    expect(normalizeIp("2001:db8:1:2::1")).toBe(p);
    expect(normalizeIp("2001:db8:1:2::")).toBe(p);
    expect(normalizeIp("[2001:db8:1:2::abcd]")).toBe(p);
    expect(normalizeIp("2001:db8:1:2::1%eth0")).toBe(p);
    expect(normalizeIp("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(normalizeIp("::1")).toBe("0:0:0:0::/64");
    expect(normalizeIp("2001:db8:1:3::1")).not.toBe(p);
  });
  it("treats IPv4-mapped IPv6 as the IPv4 it carries", () => {
    expect(normalizeIp("::ffff:1.2.3.4")).toBe("1.2.3.4");
    expect(normalizeIp("::FFFF:102:304")).toBe("1.2.3.4");
    expect(normalizeIp("0:0:0:0:0:ffff:1.2.3.4")).toBe("1.2.3.4");
  });
  it("leaves anything else as trimmed lower case", () => {
    expect(normalizeIp(" Not-An-IP ")).toBe("not-an-ip");
  });
  it("ipSubject: rotating the interface id inside one /64 does not escape the limit", () => {
    expect(ipSubject("2001:db8:1:2::1", "k")).toBe(ipSubject("2001:db8:1:2:dead:beef:0:7", "k"));
    expect(ipSubject("2001:db8:1:2::1", "k")).not.toBe(ipSubject("2001:db8:1:3::1", "k"));
    expect(ipSubject("::ffff:1.2.3.4", "k")).toBe(ipSubject("1.2.3.4", "k"));
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
