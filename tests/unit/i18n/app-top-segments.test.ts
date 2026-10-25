// @vitest-environment node
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_TOP_SEGMENTS, isUnknownTopSegment } from "@/lib/i18n/public-routing";

const ROOT = process.cwd();

// Metadata files at the app root and the URL they are served at.
const METADATA: Record<string, string> = {
  "robots.ts": "robots.txt",
  "robots.txt": "robots.txt",
  "sitemap.ts": "sitemap.xml",
  "sitemap.xml": "sitemap.xml",
  "favicon.ico": "favicon.ico",
  "manifest.ts": "manifest.webmanifest",
  "manifest.webmanifest": "manifest.webmanifest",
  "manifest.json": "manifest.json",
};

/** Static top-level URL segments of src/app: route groups flattened; dynamic, private and slot folders ignored. */
function scanApp(dir: string, out: Set<string>, atRoot: boolean): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (/^\(.+\)$/.test(e.name)) scanApp(join(dir, e.name), out, atRoot);
      else if (!/^[_@[]/.test(e.name)) out.add(e.name);
    } else if (atRoot && METADATA[e.name]) out.add(METADATA[e.name]!);
  }
}

// What the proxy matcher leaves out (src/proxy.ts config.matcher): never reaches the proxy.
const MATCHER_EXCLUDED = /^(?:favicon\.ico|sw\.js)$|\.(?:svg|png|jpg|jpeg|gif|webp|ico)$/;

function scan(): string[] {
  const out = new Set<string>();
  scanApp(join(ROOT, "src", "app"), out, true);
  for (const e of readdirSync(join(ROOT, "public"), { withFileTypes: true })) {
    if (e.isFile() && !MATCHER_EXCLUDED.test(e.name)) out.add(e.name);
  }
  return [...out].sort();
}

describe("APP_TOP_SEGMENTS", () => {
  it("matches the static top-level segments of src/app and public/", () => {
    expect([...APP_TOP_SEGMENTS].sort()).toEqual(scan());
  });
});

describe("isUnknownTopSegment", () => {
  it.each(["/xx", "/foo", "/manifest.json", "/wp-admin", "/pay"])("%s is unknown", (p) => {
    expect(isUnknownTopSegment(p)).toBe(true);
  });

  it.each(["/", "/en", "/es", "/start", "/herramientas", "/donar", "/login", "/c", "/sorteos", "/robots.txt", "/sitemap.xml", "/api", "/out"])(
    "%s is known",
    (p) => {
      expect(isUnknownTopSegment(p)).toBe(false);
    },
  );

  it("only decides single-segment paths", () => {
    expect(isUnknownTopSegment("/xx/yy")).toBe(false);
    expect(isUnknownTopSegment("/c/missing")).toBe(false);
  });
});
