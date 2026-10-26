// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

const SA = "0x" + "a".repeat(40);
const OTHER = "0x" + "b".repeat(40);

const s = vi.hoisted(() => ({
  user: null as { id: string; identities?: unknown[] } | null,
  site: null as unknown,
  access: [] as { data: unknown; error: unknown }[],
  accessCalls: 0,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: s.user } }) },
    rpc: async (name: string) => {
      if (name !== "my_maintenance_access") return { data: "active", error: null };
      s.accessCalls++;
      return s.access.shift() ?? { data: "none", error: null };
    },
    from: () => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.maybeSingle = async () => ({ data: { welcome_completed_at: "2026-10-18T00:00:00Z" }, error: null });
      return q;
    },
  }),
}));

vi.mock("@/lib/admin/site-state", async (importOriginal) => ({ ...(await importOriginal<object>()), getSiteState: async () => s.site }));

import { proxy } from "@/proxy";
import { __resetAccessCache } from "@/lib/admin/access";
import { __resetStatusPageCache } from "@/lib/admin/status-page";
import { OPEN_STATE, type SiteState } from "@/lib/admin/state";

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";

const NOW = new Date("2030-01-01T00:00:00Z");

const state = (over: { maintenance?: Partial<SiteState["maintenance"]>; switches?: Partial<SiteState["switches"]> } = {}): SiteState => ({
  switches: { ...OPEN_STATE.switches, ...over.switches },
  maintenance: { ...OPEN_STATE.maintenance, ...over.maintenance },
});
const MAINTENANCE = state({ maintenance: { enabled: true } });

const req = (path: string, init: { method?: string; headers?: Record<string, string>; origin?: string } = {}) =>
  proxy(new NextRequest(`${init.origin ?? "http://localhost:3000"}${path}`, { method: init.method ?? "GET", headers: init.headers }));

const member = (wallet: string) => ({
  id: `u-${wallet.slice(2, 6)}`,
  identities: [{ provider: "web3", identity_data: { custom_claims: { address: wallet } } }],
});

const rewriteOf = (res: Response) => res.headers.get("x-middleware-rewrite") ?? "";

// The proxy fetches the status page from its own origin. By default that fetch fails, so the tests above the
// "real 503" block exercise the fallback (the rewrite); that block answers it.
const fetchMock = vi.fn<typeof fetch>();
const HTML = "<!DOCTYPE html><html><body><h1>Volvemos enseguida</h1></body></html>";
const htmlOk = () => Promise.resolve(new Response(HTML, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  s.user = null;
  s.site = OPEN_STATE;
  s.access = [];
  s.accessCalls = 0;
  __resetAccessCache();
  __resetStatusPageCache();
  fetchMock.mockReset();
  fetchMock.mockRejectedValue(new TypeError("fetch failed"));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://www.elclub.party");
  vi.stubEnv("SUPER_ADMIN_WALLET", SA);
  vi.stubEnv("SITE_STATE_TTL_MS", "0");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("proxy: maintenance", () => {
  it("rewrites an anonymous page load to the Spanish maintenance page with 503", async () => {
    s.site = MAINTENANCE;
    const res = await req("/herramientas");
    expect(res.status).toBe(503);
    expect(new URL(rewriteOf(res)).pathname).toBe("/status/es/maintenance");
    expect(res.headers.get("retry-after")).toBe("3600");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
  });

  it("uses the English maintenance page under /en", async () => {
    s.site = MAINTENANCE;
    const res = await req("/en/tools");
    expect(res.status).toBe(503);
    expect(new URL(rewriteOf(res)).pathname).toBe("/status/en/maintenance");
  });

  it("derives Retry-After from returnAt", async () => {
    s.site = state({ maintenance: { enabled: true, returnAt: new Date(NOW.getTime() + 120_500).toISOString() } });
    const res = await req("/");
    expect(res.headers.get("retry-after")).toBe("121");
  });

  it("answers JSON 503 to the API", async () => {
    s.site = MAINTENANCE;
    const res = await req("/api/v1/check/token");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "maintenance" });
    expect(res.headers.get("retry-after")).toBe("3600");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
  });

  it("answers JSON 503 to a non-read method on a page", async () => {
    s.site = MAINTENANCE;
    const res = await req("/herramientas", { method: "POST" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "maintenance" });
  });

  it("lets the crons through", async () => {
    s.site = MAINTENANCE;
    const res = await req("/api/cron/dao", { method: "POST" });
    expect(res.status).not.toBe(503);
    expect(rewriteOf(res)).toBe("");
  });

  it("closes the club too (no login redirect during maintenance)", async () => {
    s.site = MAINTENANCE;
    const res = await req("/foro/login");
    expect(res.status).toBe(503);
  });

  it("is not opened by a forged banner cookie nor a forged x-pathname", async () => {
    s.site = MAINTENANCE;
    const res = await req("/herramientas", { headers: { cookie: "elclub-mnt=1", "x-pathname": "/api/cron/x" } });
    expect(res.status).toBe(503);
  });

  it.each([
    ["off", OPEN_STATE],
    ["on", MAINTENANCE],
  ])("404s a direct /status visit with maintenance %s", async (_label, site) => {
    s.site = site;
    const res = await req("/status/es/maintenance");
    expect(res.status).toBe(404);
  });

  it("lets the SUPER_ADMIN_WALLET in even when the rpc fails, and sets the banner cookie", async () => {
    s.site = MAINTENANCE;
    s.user = member(SA);
    s.access = [{ data: null, error: { message: "boom" } }];
    const res = await req("/herramientas", { headers: { cookie: "ecl_welcomed=" + member(SA).id } });
    expect(res.status).not.toBe(503);
    expect(res.headers.get("set-cookie")).toContain("elclub-mnt=1");
  });

  it("lets a granted team wallet in, and closes again once the grant is gone (positive cache 5 s)", async () => {
    s.site = MAINTENANCE;
    s.user = member(OTHER);
    s.access = [
      { data: "granted", error: null },
      { data: "none", error: null },
    ];
    const first = await req("/herramientas");
    expect(first.status).not.toBe(503);
    expect(first.headers.get("set-cookie")).toContain("elclub-mnt=1");
    vi.setSystemTime(NOW.getTime() + 5000);
    const second = await req("/herramientas");
    expect(second.status).toBe(503);
    expect(s.accessCalls).toBe(2);
  });

  it("does not ask for access when there is no maintenance, and clears a stale banner cookie", async () => {
    s.user = member(OTHER);
    const res = await req("/herramientas", { headers: { cookie: "elclub-mnt=1" } });
    expect(s.accessCalls).toBe(0);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/elclub-mnt=;/);
  });

  it("does not ask for access for an anonymous visitor", async () => {
    s.site = MAINTENANCE;
    await req("/herramientas");
    expect(s.accessCalls).toBe(0);
  });

  it("gates a direct /es URL once it has been redirected to its canonical URL", async () => {
    s.site = MAINTENANCE;
    const res = await req("/es/tools/gas");
    expect(res.status).toBe(503);
    expect(new URL(rewriteOf(res)).pathname).toBe("/status/es/maintenance");
  });
});

describe("proxy: tool switches", () => {
  const GAS_OFF = state({ switches: { gas: false } });

  it("rewrites a switched-off tool page to the unavailable page with 503 and no Retry-After", async () => {
    s.site = GAS_OFF;
    const res = await req("/herramientas/gas");
    expect(res.status).toBe(503);
    expect(new URL(rewriteOf(res)).pathname).toBe("/status/es/unavailable");
    expect(res.headers.get("retry-after")).toBeNull();
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
  });

  it("lets an in-app navigation (RSC: 1) through", async () => {
    s.site = GAS_OFF;
    const res = await req("/herramientas/gas", { headers: { rsc: "1" } });
    expect(res.status).not.toBe(503);
  });

  it("cuts the checker API with a JSON 503", async () => {
    s.site = state({ switches: { checkerApi: false } });
    const res = await req("/api/v1/check/link");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unavailable" });
    expect(res.headers.get("retry-after")).toBeNull();
  });

  it("a direct /es URL of a switched-off tool 308s to its canonical URL, which is then cut", async () => {
    s.site = GAS_OFF;
    const first = await req("/es/tools/gas");
    expect(first.status).toBe(308);
    const location = new URL(first.headers.get("location")!);
    expect(location.pathname).toBe("/herramientas/gas");
    const second = await req(location.pathname);
    expect(second.status).toBe(503);
    expect(new URL(rewriteOf(second)).pathname).toBe("/status/es/unavailable");
  });
});

describe("proxy: real 503 status pages (self-fetch)", () => {
  it("maintenance: fetches /status/es/maintenance from its own origin and answers it with 503 and the headers", async () => {
    s.site = MAINTENANCE;
    fetchMock.mockImplementation(htmlOk);
    const res = await req("/herramientas", { headers: { "accept-language": "es-ES,es;q=0.9", cookie: "elclub-mnt=1" } });
    expect(res.status).toBe(503);
    expect(await res.text()).toBe(HTML);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    expect(res.headers.get("retry-after")).toBe("3600");
    expect(rewriteOf(res)).toBe("");
    expect(res.headers.get("set-cookie")).toMatch(/elclub-mnt=;/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("http://127.0.0.1:3000/status/es/maintenance");
    const headers = new Headers(init?.headers);
    expect(headers.get("x-elclub-status")).toBe("1");
    expect(headers.get("accept-language")).toBe("es-ES,es;q=0.9");
    expect(init?.cache).toBe("no-store");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("unavailable: 503 with the page, no-store, noindex and no Retry-After", async () => {
    s.site = state({ switches: { gas: false } });
    fetchMock.mockImplementation(htmlOk);
    const res = await req("/en/tools/gas");
    expect(res.status).toBe(503);
    expect(await res.text()).toBe(HTML);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    expect(res.headers.get("retry-after")).toBeNull();
    expect(String(fetchMock.mock.calls[0]![0])).toBe("http://127.0.0.1:3000/status/en/unavailable");
  });

  it("HEAD: same status and headers, no body", async () => {
    s.site = MAINTENANCE;
    fetchMock.mockImplementation(htmlOk);
    const res = await req("/herramientas", { method: "HEAD" });
    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("retry-after")).toBe("3600");
    expect(await res.text()).toBe("");
  });

  it("caches the page up to 5 s per language and kind", async () => {
    vi.stubEnv("SITE_STATE_TTL_MS", "5000");
    s.site = MAINTENANCE;
    fetchMock.mockImplementation(htmlOk);
    await req("/herramientas");
    vi.setSystemTime(NOW.getTime() + 4000);
    const cached = await req("/donar");
    expect(cached.status).toBe(503);
    expect(await cached.text()).toBe(HTML);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await req("/en");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.setSystemTime(NOW.getTime() + 5000);
    await req("/herramientas");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("never caches with SITE_STATE_TTL_MS=0 (e2e)", async () => {
    s.site = MAINTENANCE;
    fetchMock.mockImplementation(htmlOk);
    await req("/herramientas");
    await req("/herramientas");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["a network failure", () => Promise.reject(new TypeError("fetch failed"))],
    ["a non-2xx answer", () => Promise.resolve(new Response("nope", { status: 404 }))],
  ])("falls back to the rewrite on %s, with one log", async (_label, impl) => {
    s.site = MAINTENANCE;
    fetchMock.mockImplementation(impl as () => Promise<Response>);
    const res = await req("/herramientas");
    expect(new URL(rewriteOf(res)).pathname).toBe("/status/es/maintenance");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(console.error).mock.calls[0]![0])).toBe("[status-page] fetch failed");
  });

  it("lets its own /status fetch through, ungated, during maintenance", async () => {
    s.site = MAINTENANCE;
    const res = await req("/status/es/maintenance", { headers: { "x-elclub-status": "1" } });
    expect(res.status).toBe(200);
    expect(rewriteOf(res)).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("PRE behind the tunnel (https://0.0.0.0:3000): fetches over http on 127.0.0.1 and answers 503", async () => {
    s.site = MAINTENANCE;
    fetchMock.mockImplementation(htmlOk);
    const res = await req("/herramientas", { origin: "https://0.0.0.0:3000" });
    expect(res.status).toBe(503);
    expect(String(fetchMock.mock.calls[0]![0])).toBe("http://127.0.0.1:3000/status/es/maintenance");
  });

  it("a real host fetches its own origin; INTERNAL_ORIGIN overrides it", async () => {
    s.site = MAINTENANCE;
    fetchMock.mockImplementation(htmlOk);
    await req("/herramientas", { origin: "https://www.elclub.party" });
    expect(String(fetchMock.mock.calls[0]![0])).toBe("https://www.elclub.party/status/es/maintenance");
    vi.stubEnv("INTERNAL_ORIGIN", "http://web:3000");
    await req("/herramientas", { origin: "https://0.0.0.0:3000" });
    expect(String(fetchMock.mock.calls[1]![0])).toBe("http://web:3000/status/es/maintenance");
  });

  it("the internal header ungates neither another path nor a POST", async () => {
    s.site = MAINTENANCE;
    fetchMock.mockImplementation(htmlOk);
    const page = await req("/herramientas", { headers: { "x-elclub-status": "1" } });
    expect(page.status).toBe(503);
    const post = await req("/status/es/maintenance", { method: "POST", headers: { "x-elclub-status": "1" } });
    expect(post.status).toBe(404);
  });

  it("still 404s /status without the internal header (or with another value)", async () => {
    expect((await req("/status/en/unavailable")).status).toBe(404);
    expect((await req("/status/en/unavailable", { headers: { "x-elclub-status": "yes" } })).status).toBe(404);
  });
});
