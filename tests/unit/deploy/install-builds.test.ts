import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** Keys of the `allowBuilds:` block in pnpm-workspace.yaml, with their true/false value. */
function allowBuilds(): Map<string, string> {
  const out = new Map<string, string>();
  let inside = false;
  for (const line of read("pnpm-workspace.yaml").split("\n")) {
    if (/^allowBuilds:\s*$/.test(line)) {
      inside = true;
      continue;
    }
    if (!inside) continue;
    const m = /^ {2}'?([^':]+)'?: (\S+)\s*$/.exec(line);
    if (!m) break;
    out.set(m[1]!, m[2]!);
  }
  return out;
}

// pnpm 12 fails `install --frozen-lockfile` on CI with ERR_PNPM_IGNORED_BUILDS when a dependency with a build script
// has no allowBuilds decision. The lockfile does not mark build scripts, so the known offenders are pinned by name.
describe("pnpm allowBuilds", () => {
  it("has an explicit true/false decision for keccak (transitive of hardhat; pure-JS fallback exists)", () => {
    expect(read("pnpm-lock.yaml")).toContain("keccak@");
    expect(allowBuilds().get("keccak")).toBe("false");
  });

  it("only holds boolean decisions", () => {
    for (const v of allowBuilds().values()) expect(["true", "false"]).toContain(v);
  });
});
