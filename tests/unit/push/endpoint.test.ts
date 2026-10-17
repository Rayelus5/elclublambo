import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import cases from "../../fixtures/push-endpoints.json";
import { isAllowedPushEndpoint } from "@/lib/push/endpoint";

describe("isAllowedPushEndpoint", () => {
  for (const c of cases) {
    it(`${c.ok ? "accepts" : "rejects"} ${JSON.stringify(c.url)}`, () => {
      expect(isAllowedPushEndpoint(c.url)).toBe(c.ok);
    });
  }

  it("rejects an endpoint over 2048 characters", () => {
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com/" + "a".repeat(2048))).toBe(false);
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com/" + "a".repeat(2000))).toBe(true);
  });

  it("rejects non-strings", () => {
    expect(isAllowedPushEndpoint(undefined as unknown as string)).toBe(false);
    expect(isAllowedPushEndpoint(null as unknown as string)).toBe(false);
  });

  it("rejects a trailing newline (the regex anchors at the very end)", () => {
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com/x\n")).toBe(false);
  });

  it("uses the exact same case table as the pgTAP file (parity)", () => {
    const sql = readFileSync("supabase/tests/350_push_dispatch.test.sql", "utf8");
    const rows = [...sql.matchAll(/^\s*\('([^']*)', (true|false)\),?\s*$/gm)].map((m) => ({
      url: m[1],
      ok: m[2] === "true",
    }));
    expect(rows).toEqual(cases);
  });
});
