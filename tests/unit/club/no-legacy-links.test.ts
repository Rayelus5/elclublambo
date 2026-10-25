import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// R1: every club link goes through clubPath. A hand-written legacy club path ("/c/…", "/perfil", …) in source is a bug.
const ROOT = process.cwd();
const ALLOW = new Set(["src/lib/club/paths.ts", "src/lib/i18n/public-routing.ts"]);
const LEGACY =
  /(?<!clubPath\()["'`]\/(?:c\/|perfil|settings|u\/|sorteos|dao|mercado|guia|invites|notifications|tickets|moderation|admin|login|invite\/|no-access|banned|bienvenida|donar\/)/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe("no legacy club links", () => {
  it("src and public/sw.js use clubPath instead of hand-written club paths", () => {
    const files = [...walk(join(ROOT, "src")), join(ROOT, "public", "sw.js")];
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(ROOT, file).split(sep).join("/");
      if (ALLOW.has(rel)) continue;
      readFileSync(file, "utf8")
        .split(/\r?\n/)
        .forEach((line, i) => {
          const t = line.trim();
          if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
          if (LEGACY.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it("the service worker falls back to the club home", () => {
    expect(readFileSync(join(ROOT, "public", "sw.js"), "utf8")).toContain('"/foro"');
  });
});
