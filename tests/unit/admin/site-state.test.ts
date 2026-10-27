import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPEN_STATE } from "../../../src/lib/admin/state";
import { getSiteState, invalidateSiteState, siteStateTtlMs } from "../../../src/lib/admin/site-state";

const BODY = { switches: { gas: false }, maintenance: { enabled: true } };
const ok = () => Promise.resolve(new Response(JSON.stringify(BODY), { status: 200 }));
const asFetch = (f: unknown) => f as typeof fetch;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  vi.stubEnv("SUPABASE_INTERNAL_URL", "");
  vi.stubEnv("SITE_STATE_TTL_MS", "");
  invalidateSiteState();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("getSiteState", () => {
  it("caches within the TTL and sends apikey to the rpc", async () => {
    const f = vi.fn(ok);
    const a = await getSiteState({ fetcher: asFetch(f) });
    await getSiteState({ fetcher: asFetch(f) });
    expect(f).toHaveBeenCalledTimes(1);
    expect(a.switches.gas).toBe(false);
    expect(a.maintenance.enabled).toBe(true);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://sb.test/rest/v1/rpc/site_state");
    expect((init.headers as Record<string, string>).apikey).toBe("anon-key");
    expect(init.method).toBe("POST");
  });

  it("refetches after the TTL", async () => {
    const f = vi.fn(ok);
    await getSiteState({ fetcher: asFetch(f) });
    vi.advanceTimersByTime(5001);
    await getSiteState({ fetcher: asFetch(f) });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("with TTL 0 every call fetches", async () => {
    vi.stubEnv("SITE_STATE_TTL_MS", "0");
    expect(siteStateTtlMs()).toBe(0);
    const f = vi.fn(ok);
    await getSiteState({ fetcher: asFetch(f) });
    await getSiteState({ fetcher: asFetch(f) });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("concurrent calls share one fetch", async () => {
    const f = vi.fn(ok);
    await Promise.all([1, 2, 3].map(() => getSiteState({ fetcher: asFetch(f) })));
    expect(f).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["rejection", () => Promise.reject(new Error("boom"))],
    ["500", () => Promise.resolve(new Response("x", { status: 500 }))],
    ["broken json", () => Promise.resolve(new Response("{nope", { status: 200 }))],
  ])("%s gives OPEN_STATE, logs once and is cached", async (_n, impl) => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = vi.fn(impl);
    expect(await getSiteState({ fetcher: asFetch(f) })).toEqual(OPEN_STATE);
    expect(await getSiteState({ fetcher: asFetch(f) })).toEqual(OPEN_STATE);
    expect(f).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalledTimes(1);
  });

  it("a hanging fetch is aborted by a 1500 ms signal", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const f = vi.fn(
      (_u: string, init: RequestInit) =>
        new Promise<Response>((_res, rej) => {
          init.signal?.addEventListener("abort", () => rej(new Error("aborted")));
        }),
    );
    const p = getSiteState({ fetcher: asFetch(f) });
    await vi.advanceTimersByTimeAsync(1500);
    expect(await p).toEqual(OPEN_STATE);
    expect(timeout).toHaveBeenCalledWith(1500);
  });
});

describe("siteStateTtlMs", () => {
  it("defaults to 5000 and ignores junk", () => {
    expect(siteStateTtlMs({})).toBe(5000);
    expect(siteStateTtlMs({ SITE_STATE_TTL_MS: "abc" })).toBe(5000);
    expect(siteStateTtlMs({ SITE_STATE_TTL_MS: "250" })).toBe(250);
  });
});
