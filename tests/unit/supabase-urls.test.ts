import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authCookieName, resolveServerSupabaseUrl, toPublicSupabaseUrl } from "../../src/lib/supabase/urls";

// fix/pre-supabase-red-interna: PRE's server reaches its self-hosted Supabase over the Docker network
// (SUPABASE_INTERNAL_URL) instead of the public pre-api URL, which goes out through Cloudflare and dies when the ISP
// blocks Cloudflare IPs (LaLiga). The browser keeps the public URL; production leaves the variable unset.

const PUBLIC = "https://pre-api.elclub.party";
const INTERNAL = "http://kong:8000";

describe("resolveServerSupabaseUrl", () => {
  it("uses the internal URL when set", () => {
    expect(resolveServerSupabaseUrl(PUBLIC, INTERNAL)).toBe(INTERNAL);
  });

  it("falls back to the public URL when unset or blank (production, local dev)", () => {
    expect(resolveServerSupabaseUrl(PUBLIC, undefined)).toBe(PUBLIC);
    expect(resolveServerSupabaseUrl(PUBLIC, "")).toBe(PUBLIC);
    expect(resolveServerSupabaseUrl(PUBLIC, "  ")).toBe(PUBLIC);
  });
});

describe("authCookieName", () => {
  it("is supabase-js's default storage key for the public URL, so browser and server share the session cookie", () => {
    expect(authCookieName(PUBLIC)).toBe("sb-pre-api-auth-token");
    expect(authCookieName("https://abcdefghijklmnop.supabase.co")).toBe("sb-abcdefghijklmnop-auth-token");
    expect(authCookieName("http://127.0.0.1:54321")).toBe("sb-127-auth-token");
  });
});

describe("toPublicSupabaseUrl", () => {
  const signed = `${INTERNAL}/storage/v1/object/sign/chat-images/a/b.png?token=x`;

  it("rewrites a URL minted with the internal origin to the public one (signed image URLs reach the browser)", () => {
    expect(toPublicSupabaseUrl(signed, PUBLIC, INTERNAL)).toBe(`${PUBLIC}/storage/v1/object/sign/chat-images/a/b.png?token=x`);
  });

  it("leaves the URL alone without an internal URL or when it does not start with it", () => {
    expect(toPublicSupabaseUrl(signed, PUBLIC, undefined)).toBe(signed);
    const pub = `${PUBLIC}/storage/v1/object/sign/x?token=y`;
    expect(toPublicSupabaseUrl(pub, PUBLIC, INTERNAL)).toBe(pub);
  });

  it("tolerates a trailing slash on either base", () => {
    expect(toPublicSupabaseUrl(signed, `${PUBLIC}/`, `${INTERNAL}/`)).toBe(`${PUBLIC}/storage/v1/object/sign/chat-images/a/b.png?token=x`);
  });
});

describe("server clients use the server URL and the public cookie name", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", PUBLIC);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
    vi.stubEnv("SUPABASE_INTERNAL_URL", INTERNAL);
    vi.doMock("server-only", () => ({}));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("server-only");
    vi.doUnmock("@supabase/ssr");
    vi.doUnmock("@supabase/supabase-js");
    vi.doUnmock("next/headers");
    vi.doUnmock("next/server");
  });

  it("createServerClient", async () => {
    const createServerClient = vi.fn(() => ({}));
    vi.doMock("@supabase/ssr", () => ({ createServerClient }));
    vi.doMock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
    vi.doMock("next/server", () => ({ connection: async () => {} }));
    const mod = await import("../../src/lib/supabase/server");
    await mod.createServerClient();
    const [url, key, options] = createServerClient.mock.calls[0] as unknown as [string, string, { cookieOptions?: { name?: string } }];
    expect(url).toBe(INTERNAL);
    expect(key).toBe("anon");
    expect(options.cookieOptions?.name).toBe("sb-pre-api-auth-token");
  });

  it("createAdminClient", async () => {
    const createClient = vi.fn(() => ({}));
    vi.doMock("@supabase/supabase-js", () => ({ createClient }));
    const mod = await import("../../src/lib/supabase/admin");
    mod.createAdminClient();
    expect((createClient.mock.calls[0] as unknown as [string])[0]).toBe(INTERNAL);
  });

  it("the proxy builds its client the same way (text check: it needs a full request to run)", () => {
    const proxy = readFileSync(join(process.cwd(), "src/proxy.ts"), "utf8");
    expect(proxy).toMatch(/createServerClient\(\s*serverSupabaseUrl\(\)/);
    expect(proxy).toMatch(/cookieOptions:\s*\{\s*name:\s*authCookieName\(/);
  });
});
