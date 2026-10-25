import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import fixture from "../../fixtures/public-aliases.json";

const ROOT = join(__dirname, "..", "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/** Every quoted word of the first `array[...]` literal that follows `marker`. */
function arrayAfter(sql: string, marker: string): string[] {
  const start = sql.indexOf(marker);
  expect(start, `marker ${marker} not found`).toBeGreaterThanOrEqual(0);
  const open = sql.indexOf("array[", start);
  const close = sql.indexOf("]", open);
  return [...sql.slice(open, close).matchAll(/'([^']*)'/g)].map((m) => m[1] ?? "");
}

describe("public alias reserved list (one list, SQL and TS)", () => {
  it("adds the P3-R3 route words to the club reserved handles", () => {
    const handles = JSON.parse(read("tests/fixtures/handles.json")) as { reserved: string[] };
    const routeWords = ["pay", "tx", "tools", "herramientas", "start", "donar", "donate", "en", "es", "elclubpay"];
    expect(fixture.reserved).toEqual([...handles.reserved, ...routeWords]);
  });

  it("the migration's v_reserved equals the fixture", () => {
    const sql = read("supabase/migrations/20261025200001_public_profiles.sql");
    expect(arrayAfter(sql, "v_reserved constant text[]")).toEqual(fixture.reserved);
  });

  it("the pgTAP test checks the same list", () => {
    const sql = read("supabase/tests/p3_01_public_profiles.test.sql");
    expect(arrayAfter(sql, "the same list as tests/fixtures/public-aliases.json")).toEqual(fixture.reserved);
  });
});
