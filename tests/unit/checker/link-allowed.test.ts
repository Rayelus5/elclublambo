import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: vi.fn() }));
// A plain function (not vi.fn) for the read: vitest reports a throwing/rejecting mock as a test error even when the code under test handles it.
const db = vi.hoisted(() => ({ read: (): Promise<unknown> => Promise.resolve({ data: [], error: null }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => ({ select: () => db.read() }) }) }));

import { getKnownDomains } from "@/lib/checker/link/allowed";
import { CRYPTO_BRANDS } from "@/lib/checker/link/lists";

describe("getKnownDomains", () => {

  it("merges the club list with the brands, without duplicates", async () => {
    db.read = () => Promise.resolve({ data: [{ domain: "github.com" }, { domain: "elclub.party" }], error: null });
    const r = await getKnownDomains();
    expect(r).toContain("github.com");
    for (const b of CRYPTO_BRANDS) expect(r).toContain(b);
    expect(r.filter((d) => d === "elclub.party")).toHaveLength(1);
  });

  it("falls back to the brands when the read fails", async () => {
    db.read = () => Promise.resolve({ data: null, error: { message: "boom" } });
    expect(await getKnownDomains()).toEqual([...CRYPTO_BRANDS]);
  });

  it("falls back to the brands when the client throws", async () => {
    db.read = () => {
      throw new Error("network");
    };
    expect(await getKnownDomains()).toEqual([...CRYPTO_BRANDS]);
  });
});
