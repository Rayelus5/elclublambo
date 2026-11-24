// @vitest-environment node
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { config } from "@/proxy";

const matches = (url: string, headers: Record<string, string> = {}) => unstable_doesMiddlewareMatch({ config, url, headers });
const ID = "3f1c0b9e-1111-4c4c-8888-000000000001";

/** Every file in public/, as the URL Next serves it at. */
function publicFiles(dir = join(process.cwd(), "public")): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? publicFiles(join(dir, e.name)) : ["/" + relative(join(process.cwd(), "public"), join(dir, e.name)).split("\\").join("/")],
  );
}

describe("proxy matcher (M1)", () => {
  it("skips Next's own assets and the real files of public/", () => {
    const files = publicFiles();
    expect(files).toContain("/sw.js");
    expect(files).toContain("/brand/networks/base.svg");
    for (const url of ["/_next/static/chunks/app.js", "/_next/image?url=%2Fx.png&w=64&q=75", "/favicon.ico", ...files]) {
      expect(matches(url), url).toBe(false);
    }
  });

  it("gates an extension-suffixed URL of a dynamic route (maintenance, switches and the login gate apply)", () => {
    for (const url of [
      "/foro/canales/general.png",
      "/foro/x.png",
      "/en/pay/x.png",
      "/pay/ana.svg",
      "/herramientas/gas.jpg",
      "/brand/x.png",
      "/x.webp",
      "/sw.js/x",
      "/favicon.ico.png",
    ]) {
      expect(matches(url), url).toBe(true);
    }
  });

  it("still runs on pages and APIs", () => {
    for (const url of ["/", "/herramientas/gas", "/en/tools/gas", "/foro", "/foro/c/x", "/api/team-access", "/api/v1/check/token", "/api"]) {
      expect(matches(url), url).toBe(true);
    }
  });
});

// Each <Link> in view prefetches its route (1-2 requests per link): running the whole proxy on each one multiplied the
// Middleware invocations by 8-24 per visit. The prefetches skip it; the navigation itself (no prefetch header) does not.
describe("proxy matcher: what skips the proxy (Active CPU)", () => {
  it.each(["1", "2", "3"])("skips the router's prefetches of pages (next-router-prefetch: %s)", (value) => {
    for (const url of ["/", "/herramientas/gas", "/en/tools", "/foro", "/foro/c/x", `/herramientas/sorteos/${ID}`]) {
      expect(matches(url, { "next-router-prefetch": value }), url).toBe(false);
      expect(matches(url, { rsc: "1" }), `${url} (navigation)`).toBe(true);
    }
  });

  it("skips a browser prefetch hint (purpose: prefetch)", () => {
    expect(matches("/herramientas", { purpose: "prefetch" })).toBe(false);
  });

  it("still runs on a Server Action, even with a forged prefetch header (maintenance and switches gate actions)", () => {
    const prefetch = { "next-router-prefetch": "1" };
    expect(matches("/herramientas/sorteos/nuevo", { ...prefetch, "next-action": "7f00aa" })).toBe(true);
    expect(matches("/foro/c/x", { ...prefetch, "content-type": "multipart/form-data; boundary=x" })).toBe(true);
    expect(matches("/donar", { ...prefetch, "content-type": "application/x-www-form-urlencoded" })).toBe(true);
  });

  it("always runs on the APIs, prefetch header or not", () => {
    for (const url of ["/api/team-access", "/api/v1/check/token", "/api/v1/check/link", "/api/cronx"]) {
      expect(matches(url, { "next-router-prefetch": "1" }), url).toBe(true);
    }
  });

  it("skips the cron route: it authenticates itself (bearer CRON_SECRET) and the gates let it through anyway", () => {
    expect(matches("/api/cron/dao")).toBe(false);
    expect(matches("/api/cron")).toBe(false);
  });

  it("skips robots.txt and sitemap.xml (static files, never gated)", () => {
    expect(matches("/robots.txt")).toBe(false);
    expect(matches("/sitemap.xml")).toBe(false);
    expect(matches("/robots.txt/x")).toBe(true);
  });

  it("skips the share cards of the public tree (served cached by the CDN), but only there", () => {
    for (const url of [
      "/es/opengraph-image-g96pxp",
      "/en/twitter-image-g96pxp",
      "/es/start/opengraph-image-emtjnu",
      `/es/tools/giveaways/${ID}/opengraph-image-1km1ej`,
      `/en/tools/giveaways/${ID}/twitter-image-1km1ej`,
      "/es/pay/rayelus/opengraph-image-x2so5w",
      "/en/pay/rayelus/twitter-image",
    ]) {
      expect(matches(url), url).toBe(false);
    }
    for (const url of ["/foro/c/opengraph-image", "/opengraph-image", "/es/opengraph-image-g96pxp/x", "/es/opengraph-imagex"]) {
      expect(matches(url), url).toBe(true);
    }
  });
});
