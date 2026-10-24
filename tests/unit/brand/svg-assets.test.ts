import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(process.cwd(), "public", "brand");

function svgs(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? svgs(p) : p.endsWith(".svg") ? [p] : [];
  });
}

const files = svgs(ROOT);

describe("brand SVG assets", () => {
  it("finds the four logos", () => {
    expect(files).toHaveLength(4);
  });

  describe.each(files.map((f) => [f.slice(ROOT.length + 1), f]))("%s", (_name, file) => {
    const text = readFileSync(file, "utf8");

    it("starts with the source comment", () => {
      expect(text.startsWith("<!-- fuente:")).toBe(true);
    });

    it("has real path data on every path", () => {
      const paths = [...text.matchAll(/<path\b[^>]*>/g)].map((m) => m[0]);
      expect(paths.length).toBeGreaterThan(0);
      for (const p of paths) expect(p).toMatch(/\sd="\s*[Mm]/);
    });

    it("carries nothing executable or external", () => {
      expect(text).not.toMatch(/<script|foreignObject|href|\son[a-z]+=/i);
    });
  });
});
