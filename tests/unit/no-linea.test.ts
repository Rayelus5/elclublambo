import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// P0: the app runs on Base and Arbitrum. "Linea" may only remain in the legacy islands (the paused DAO, its polls and
// treasury code), the alpha contract check (still on Linea mainnet) and the readiness check that forbids Linea env vars.
const ROOT = join(process.cwd(), "src");
const EXEMPT = [
  /^src\/lib\/legacy\//,
  /^src\/lib\/treasury\//,
  /^src\/components\/treasury\//,
  /^src\/app\/\(forum\)\/dao\//,
  /^src\/lib\/polls\//,
  /^src\/lib\/chat\/linea\.ts$/,
  /^src\/components\/chat\/alpha-[^/]*\.tsx$/,
  /^src\/app\/api\/cron\/dao\//,
  /^src\/lib\/deploy\/readiness\.ts$/,
  /^src\/lib\/chat\/alpha\.ts$/,
  /^src\/lib\/chat\/model\.ts$/,
];
/** Single exempt lines: the alpha error copy. */
const EXEMPT_LINE = /^\s*not_a_contract:/;
const LINEA = /\bLinea\b/;
/** Module specifiers are paths, not copy: `from "…"`, `import("…")`, `vi.mock("…")`. */
const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\bmock\s*\(\s*)(["'])[^"']*\2/g;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return files(p);
    return /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe("no Linea outside the legacy islands (P0)", () => {
  it("finds no 'Linea' in src/**/*.ts(x)", () => {
    const hits: string[] = [];
    for (const abs of files(ROOT)) {
      const rel = relative(process.cwd(), abs).split(sep).join("/");
      if (EXEMPT.some((re) => re.test(rel))) continue;
      readFileSync(abs, "utf8")
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (EXEMPT_LINE.test(line)) return;
          if (LINEA.test(line.replace(SPECIFIER, ""))) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(hits).toEqual([]);
  });

  it("ignores module specifiers and still catches copy", () => {
    const strip = (l: string) => l.replace(SPECIFIER, "");
    expect(LINEA.test(strip(`import { x } from "@/lib/legacy/Linea";`))).toBe(false);
    expect(LINEA.test(strip(`const t = "Red Linea";`))).toBe(true);
    expect(LINEA.test("Lineal según participación")).toBe(false);
  });
});
