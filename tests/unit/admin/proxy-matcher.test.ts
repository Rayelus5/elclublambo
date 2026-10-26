// @vitest-environment node
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { config } from "@/proxy";

const matches = (url: string) => unstable_doesMiddlewareMatch({ config, url });

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

  it("still runs on pages, APIs and the internal OG images", () => {
    for (const url of ["/", "/herramientas/gas", "/en/tools/gas", "/foro", "/api/team-access", "/es/opengraph-image-1a2b"]) {
      expect(matches(url), url).toBe(true);
    }
  });
});
