// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The landing and the tools hub read the switches through this cache, so both are part of the static shell instead of
// being rendered on every request. Administración's actions expire the tag (updateTag) right after a change.
const cache = vi.hoisted(() => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock("next/cache", () => cache);

import { OPEN_STATE } from "@/lib/admin/state";
import { getCachedSiteState, SITE_STATE_TAG } from "@/lib/admin/site-state-cached";

const BODY = { switches: { gas: false }, maintenance: { enabled: false } };

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  vi.stubEnv("SUPABASE_INTERNAL_URL", "");
  cache.cacheLife.mockReset();
  cache.cacheTag.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getCachedSiteState", () => {
  it("is tagged for Administración's actions and kept for hours when the read works", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(BODY), { status: 200 })));
    const state = await getCachedSiteState();
    expect(state.switches.gas).toBe(false);
    expect(cache.cacheTag).toHaveBeenCalledWith(SITE_STATE_TAG);
    expect(cache.cacheLife).toHaveBeenCalledTimes(1);
    expect(cache.cacheLife).toHaveBeenCalledWith("hours");
  });

  // A-R16 kept the switches out of the build for a reason: the preproduction Docker build stalled its prerender on this
  // read (a "use cache" fill timed out after ~50 s). No network at build time: the open state, for minutes, and the first
  // request after that renders the page again with the real switches.
  it("reads nothing while `next build` prerenders: the open state, for minutes", async () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(await getCachedSiteState()).toEqual(OPEN_STATE);
    expect(fetcher).not.toHaveBeenCalled();
    expect(cache.cacheLife).toHaveBeenCalledWith("minutes");
    expect(cache.cacheTag).toHaveBeenCalledWith(SITE_STATE_TAG);
  });

  it("opens everything but only for minutes when the read fails, so a blip does not stick", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    expect(await getCachedSiteState()).toEqual(OPEN_STATE);
    expect(cache.cacheLife).toHaveBeenCalledTimes(1);
    expect(cache.cacheLife).toHaveBeenCalledWith("minutes");
  });
});
