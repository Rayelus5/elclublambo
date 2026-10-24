import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { chainsForSet, NETWORKS } from "../../src/lib/economy/networks";
import { buildCsp, headerEnvFromProcess, PUBLIC_RPCS, securityHeaders, type HeaderEnv } from "../../src/lib/security/headers";

// F5 Task 3 (F5-R3/R4, closes security finding S11): a full, static CSP plus the other security headers.

const PROD: HeaderEnv = { supabaseUrl: "https://abc.supabase.co", siteUrl: "https://elclub.party", publicRpcUrls: [], networkSet: "mainnet", dev: false };
const LOCAL: HeaderEnv = { supabaseUrl: "http://127.0.0.1:54321", siteUrl: "http://localhost:3000", publicRpcUrls: [], networkSet: "testnet", dev: false };

function directives(csp: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const part of csp.split(";").map((d) => d.trim()).filter(Boolean)) {
    const [name, ...sources] = part.split(/\s+/);
    out.set(name!, sources);
  }
  return out;
}
const sourcesOf = (csp: string, name: string) => {
  const d = directives(csp).get(name);
  expect(d, `${name} present`).toBeDefined();
  return d!;
};
const header = (env: HeaderEnv, key: string) => securityHeaders(env).find((h) => h.key === key)?.value;

describe("buildCsp", () => {
  it("is strict by default", () => {
    const d = directives(buildCsp(PROD));
    expect(d.get("default-src")).toEqual(["'self'"]);
    expect(d.get("object-src")).toEqual(["'none'"]);
    expect(d.get("base-uri")).toEqual(["'self'"]);
    expect(d.get("form-action")).toEqual(["'self'"]);
    expect(d.get("frame-ancestors")).toEqual(["'none'"]);
    expect(d.get("worker-src")).toEqual(["'self'"]);
    expect(d.get("manifest-src")).toEqual(["'self'"]);
  });

  it("emits the directives in the documented order", () => {
    const names = [...directives(buildCsp(PROD)).keys()];
    expect(names).toEqual([
      "default-src",
      "script-src",
      "style-src",
      "img-src",
      "font-src",
      "connect-src",
      "frame-src",
      "worker-src",
      "manifest-src",
      "object-src",
      "base-uri",
      "form-action",
      "frame-ancestors",
      "upgrade-insecure-requests",
    ]);
  });

  it("connect-src: Supabase (https + wss), the public RPCs of the mainnet set and Reown/WalletConnect", () => {
    const c = sourcesOf(buildCsp(PROD), "connect-src");
    for (const s of [
      "'self'",
      "https://abc.supabase.co",
      "wss://abc.supabase.co",
      "https://mainnet.base.org",
      "https://arb1.arbitrum.io",
      "wss://relay.walletconnect.org",
      "wss://relay.walletconnect.com",
      "https://rpc.walletconnect.org",
      "https://rpc.walletconnect.com",
      "https://api.web3modal.org",
      "https://pulse.walletconnect.org",
      "https://verify.walletconnect.org",
      "https://verify.walletconnect.com",
    ]) {
      expect(c).toContain(s);
    }
  });

  it("connect-src follows the network set: testnet has the Sepolia RPCs, mainnet only its own, never Linea", () => {
    const test = sourcesOf(buildCsp({ ...PROD, networkSet: "testnet" }), "connect-src");
    expect(test).toContain("https://sepolia.base.org");
    expect(test).toContain("https://sepolia-rollup.arbitrum.io");
    expect(test).not.toContain("https://mainnet.base.org");
    expect(test).not.toContain("https://arb1.arbitrum.io");
    expect(test.join(" ")).not.toMatch(/linea/i);
    const main = sourcesOf(buildCsp({ ...PROD, networkSet: "mainnet" }), "connect-src");
    expect(main).toContain("https://mainnet.base.org");
    expect(main).toContain("https://arb1.arbitrum.io");
    expect(main).not.toContain("https://sepolia.base.org");
    expect(main).not.toContain("https://sepolia-rollup.arbitrum.io");
    expect(main.join(" ")).not.toMatch(/linea/i);
  });

  it("PUBLIC_RPCS stays in step with the viem chains of NETWORKS (headers.ts does not import networks.ts)", () => {
    for (const set of ["mainnet", "testnet"] as const) {
      const expected = chainsForSet(set).map((c) => new URL(NETWORKS[c].viemChain.rpcUrls.default.http[0]!).origin);
      expect([...PUBLIC_RPCS[set]].sort()).toEqual(expected.sort());
    }
  });

  it("img-src: Supabase Storage, DiceBear, CoinGecko image hosts, Reown wallet images, data: and blob:", () => {
    const i = sourcesOf(buildCsp(PROD), "img-src");
    for (const s of [
      "'self'",
      "https://abc.supabase.co",
      "https://api.dicebear.com",
      "https://coin-images.coingecko.com",
      "https://assets.coingecko.com",
      "https://api.web3modal.org",
      "data:",
      "blob:",
    ]) {
      expect(i).toContain(s);
    }
  });

  it("font-src allows the AppKit fonts", () => {
    expect(sourcesOf(buildCsp(PROD), "font-src")).toEqual(["'self'", "https://fonts.reown.com"]);
  });

  it("frame-src keeps the 7 explicit https origins and nothing broader", () => {
    const f = sourcesOf(buildCsp(PROD), "frame-src");
    expect(f).toHaveLength(7);
    for (const s of [
      "https://dexscreener.com",
      "https://secure.walletconnect.org",
      "https://secure.walletconnect.com",
      "https://secure-mobile.walletconnect.org",
      "https://secure-mobile.walletconnect.com",
      "https://verify.walletconnect.org",
      "https://verify.walletconnect.com",
    ]) {
      expect(f).toContain(s);
    }
    for (const h of f) expect(h).toMatch(/^https:\/\/[a-z0-9.-]+$/);
  });

  it("never allows a wildcard or a scheme-only source except data:/blob: on img-src", () => {
    for (const [name, sources] of directives(buildCsp(PROD))) {
      for (const s of sources) {
        expect(s, `${name} ${s}`).not.toContain("*");
        if (/^[a-z-]+:$/.test(s)) {
          expect(name).toBe("img-src");
          expect(["data:", "blob:"]).toContain(s);
        }
      }
    }
  });

  it("script-src is 'self' 'unsafe-inline' (no nonces: PPR), plus 'unsafe-eval' only in dev", () => {
    expect(sourcesOf(buildCsp(PROD), "script-src")).toEqual(["'self'", "'unsafe-inline'"]);
    expect(sourcesOf(buildCsp({ ...PROD, dev: true }), "script-src")).toEqual(["'self'", "'unsafe-inline'", "'unsafe-eval'"]);
    expect(sourcesOf(buildCsp(PROD), "style-src")).toEqual(["'self'", "'unsafe-inline'"]);
  });

  it("local http: ws:// twin of Supabase, no upgrade-insecure-requests, no HSTS", () => {
    const csp = buildCsp(LOCAL);
    expect(sourcesOf(csp, "connect-src")).toContain("http://127.0.0.1:54321");
    expect(sourcesOf(csp, "connect-src")).toContain("ws://127.0.0.1:54321");
    expect(sourcesOf(csp, "img-src")).toContain("http://127.0.0.1:54321");
    expect(directives(csp).has("upgrade-insecure-requests")).toBe(false);
    expect(securityHeaders(LOCAL).some((h) => h.key === "Strict-Transport-Security")).toBe(false);
  });

  it("https site: HSTS without preload and upgrade-insecure-requests", () => {
    expect(header(PROD, "Strict-Transport-Security")).toBe("max-age=63072000; includeSubDomains");
    expect(directives(buildCsp(PROD)).get("upgrade-insecure-requests")).toEqual([]);
  });

  it("adds the origin (only) of a browser RPC override", () => {
    const c = sourcesOf(buildCsp({ ...LOCAL, publicRpcUrls: ["http://127.0.0.1:8545/abc"] }), "connect-src");
    expect(c).toContain("http://127.0.0.1:8545");
    expect(c.some((s) => s.includes("/abc"))).toBe(false);
  });

  it("skips malformed, empty and undefined URLs without throwing", () => {
    const env: HeaderEnv = { supabaseUrl: "not a url", siteUrl: undefined, publicRpcUrls: ["not a url", undefined, ""], networkSet: "testnet", dev: false };
    let csp = "";
    expect(() => (csp = buildCsp(env))).not.toThrow();
    expect(csp).not.toContain("not a url");
    expect(csp).not.toContain("undefined");
    expect(directives(csp).has("upgrade-insecure-requests")).toBe(false);
    expect(() => buildCsp({ ...env, supabaseUrl: "" })).not.toThrow();
    expect(() => buildCsp({ ...env, supabaseUrl: undefined })).not.toThrow();
  });

  it("does not duplicate a source", () => {
    const csp = buildCsp({ ...PROD, publicRpcUrls: ["https://mainnet.base.org/", "https://mainnet.base.org"] });
    const c = sourcesOf(csp, "connect-src");
    expect(c.filter((s) => s === "https://mainnet.base.org")).toHaveLength(1);
  });
});

describe("securityHeaders", () => {
  it("sends the other headers with their exact values", () => {
    expect(header(PROD, "X-Content-Type-Options")).toBe("nosniff");
    expect(header(PROD, "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(header(PROD, "Permissions-Policy")).toBe("camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()");
    expect(header(PROD, "X-Frame-Options")).toBe("DENY");
    expect(header(PROD, "Cross-Origin-Opener-Policy")).toBe("same-origin-allow-popups");
    expect(header(PROD, "Content-Security-Policy")).toBe(buildCsp(PROD));
  });
});

describe("headerEnvFromProcess", () => {
  it("reads the public env and NODE_ENV", () => {
    const env = headerEnvFromProcess({
      NODE_ENV: "development",
      NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
      NEXT_PUBLIC_SITE_URL: "https://elclub.party",
      NEXT_PUBLIC_NETWORK_SET: "mainnet",
      NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL: "https://a.example",
      NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL: "https://b.example",
    } as NodeJS.ProcessEnv);
    expect(env).toEqual({
      supabaseUrl: "https://abc.supabase.co",
      siteUrl: "https://elclub.party",
      publicRpcUrls: ["https://a.example", "https://b.example"],
      networkSet: "mainnet",
      dev: true,
    });
    expect(headerEnvFromProcess({ NODE_ENV: "production" } as NodeJS.ProcessEnv).dev).toBe(false);
  });

  it("treats an unset or empty NEXT_PUBLIC_NETWORK_SET as testnet and rejects anything else", () => {
    expect(headerEnvFromProcess({} as NodeJS.ProcessEnv).networkSet).toBe("testnet");
    expect(headerEnvFromProcess({ NODE_ENV: "test", NEXT_PUBLIC_NETWORK_SET: "" } as NodeJS.ProcessEnv).networkSet).toBe("testnet");
    expect(() => headerEnvFromProcess({ NODE_ENV: "test", NEXT_PUBLIC_NETWORK_SET: "linea" } as NodeJS.ProcessEnv)).toThrow();
  });
});

describe("next.config headers()", () => {
  it("applies the security headers to every route", async () => {
    const rules = await nextConfig.headers!();
    const all = rules.find((r) => r.source === "/:path*");
    expect(all).toBeDefined();
    expect(all!.headers).toEqual(securityHeaders(headerEnvFromProcess()));
    const keys = all!.headers.map((h) => h.key);
    for (const k of ["Content-Security-Policy", "X-Content-Type-Options", "Referrer-Policy", "Permissions-Policy", "X-Frame-Options", "Cross-Origin-Opener-Policy"]) {
      expect(keys).toContain(k);
    }
    expect(all!.headers.find((h) => h.key === "Content-Security-Policy")!.value).toMatch(/(^|; )default-src 'self'(;|$)/);
  });
});
