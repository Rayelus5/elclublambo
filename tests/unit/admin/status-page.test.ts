// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetStatusPageCache, fetchStatusPage, isInternalStatusRequest, statusFetchOrigin } from "@/lib/admin/status-page";

const H = (h: Record<string, string> = {}) => new Headers(h);
const html = () => Promise.resolve(new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }));

beforeEach(() => {
  __resetStatusPageCache();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("statusFetchOrigin", () => {
  it("PRE behind the tunnel (x-forwarded-proto https on a plain-http bind): http on 127.0.0.1, same port", () => {
    expect(statusFetchOrigin(new URL("https://0.0.0.0:3000/herramientas"), {})).toBe("http://127.0.0.1:3000");
  });

  it.each([
    ["http://localhost:3107/x", "http://127.0.0.1:3107"],
    ["https://127.0.0.1:4000/x", "http://127.0.0.1:4000"],
    ["http://[::1]:3000/x", "http://127.0.0.1:3000"],
    ["http://[::]:3000/x", "http://127.0.0.1:3000"],
  ])("loopback / bind %s → %s", (url, origin) => {
    expect(statusFetchOrigin(new URL(url), {})).toBe(origin);
  });

  it("a loopback URL without a port uses PORT, then 3000", () => {
    expect(statusFetchOrigin(new URL("https://0.0.0.0/x"), { PORT: "8080" })).toBe("http://127.0.0.1:8080");
    expect(statusFetchOrigin(new URL("https://0.0.0.0/x"), {})).toBe("http://127.0.0.1:3000");
  });

  it("a real host (Vercel) keeps the request origin", () => {
    expect(statusFetchOrigin(new URL("https://www.elclub.party/herramientas"), {})).toBe("https://www.elclub.party");
  });

  it("INTERNAL_ORIGIN wins when it is a valid http(s) URL; otherwise it is ignored", () => {
    expect(statusFetchOrigin(new URL("https://0.0.0.0:3000/x"), { INTERNAL_ORIGIN: "http://web:3000/" })).toBe("http://web:3000");
    expect(statusFetchOrigin(new URL("https://www.elclub.party/x"), { INTERNAL_ORIGIN: "http://127.0.0.1:3000" })).toBe("http://127.0.0.1:3000");
    expect(statusFetchOrigin(new URL("https://0.0.0.0:3000/x"), { INTERNAL_ORIGIN: "ftp://x" })).toBe("http://127.0.0.1:3000");
    expect(statusFetchOrigin(new URL("https://www.elclub.party/x"), { INTERNAL_ORIGIN: "not a url" })).toBe("https://www.elclub.party");
  });
});

describe("isInternalStatusRequest", () => {
  it("only GET/HEAD on /status with the header set to 1", () => {
    expect(isInternalStatusRequest("/status/es/maintenance", "GET", H({ "x-elclub-status": "1" }))).toBe(true);
    expect(isInternalStatusRequest("/status/es/maintenance", "HEAD", H({ "x-elclub-status": "1" }))).toBe(true);
    expect(isInternalStatusRequest("/status/es/maintenance", "POST", H({ "x-elclub-status": "1" }))).toBe(false);
    expect(isInternalStatusRequest("/herramientas", "GET", H({ "x-elclub-status": "1" }))).toBe(false);
    expect(isInternalStatusRequest("/status/es/maintenance", "GET", H())).toBe(false);
  });
});

describe("fetchStatusPage negative cache", () => {
  const input = { origin: "http://127.0.0.1:3000", lang: "es" as const, kind: "maintenance" as const, acceptLanguage: null };

  it("a failure is remembered for at most 5 s per lang:kind: no refetch and a single log in the window", async () => {
    vi.stubEnv("SITE_STATE_TTL_MS", "5000");
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed"));
    expect(await fetchStatusPage({ ...input, fetcher, now: 0 })).toBeNull();
    expect(await fetchStatusPage({ ...input, fetcher, now: 4999 })).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledTimes(1);
    fetcher.mockImplementation(html);
    expect(await fetchStatusPage({ ...input, fetcher, now: 5000 })).toEqual({ body: "<html></html>", contentType: "text/html" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("another lang:kind is not affected by the failure", async () => {
    vi.stubEnv("SITE_STATE_TTL_MS", "5000");
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError("x")).mockImplementation(html);
    await fetchStatusPage({ ...input, fetcher, now: 0 });
    expect(await fetchStatusPage({ ...input, kind: "unavailable", fetcher, now: 1 })).not.toBeNull();
  });

  it("no negative cache with SITE_STATE_TTL_MS=0", async () => {
    vi.stubEnv("SITE_STATE_TTL_MS", "0");
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed"));
    await fetchStatusPage({ ...input, fetcher, now: 0 });
    await fetchStatusPage({ ...input, fetcher, now: 1 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
