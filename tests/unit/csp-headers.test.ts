import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

async function csp(): Promise<string> {
  const rules = await nextConfig.headers!();
  const all = rules.filter((r) => r.source === "/:path*" || r.source === "/(.*)");
  expect(all.length).toBeGreaterThan(0);
  const header = all.flatMap((r) => r.headers).find((h) => h.key === "Content-Security-Policy");
  expect(header).toBeDefined();
  return header!.value;
}

describe("Content-Security-Policy header", () => {
  it("applies to every route", async () => {
    const rules = await nextConfig.headers!();
    expect(rules.some((r) => r.source === "/:path*" || r.source === "/(.*)")).toBe(true);
  });

  it("forbids framing the app (clickjacking)", async () => {
    expect(await csp()).toMatch(/(^|;\s*)frame-ancestors 'none'(;|$)/);
  });

  it("allows only DexScreener and the wallet SDK iframes as child frames", async () => {
    const value = await csp();
    const frameSrc = value.split(";").map((d) => d.trim()).find((d) => d.startsWith("frame-src "))!;
    const hosts = frameSrc.split(/\s+/).slice(1);
    expect(hosts).toContain("https://dexscreener.com");
    expect(hosts).toContain("https://secure.walletconnect.org");
    expect(hosts).toContain("https://verify.walletconnect.org");
    // nothing broader than explicit https origins
    for (const h of hosts) expect(h).toMatch(/^https:\/\/[a-z0-9.-]+$/);
  });

  it("does not restrict other resource types (no default-src / script-src)", async () => {
    const value = await csp();
    expect(value).not.toMatch(/default-src|script-src|connect-src/);
  });
});
