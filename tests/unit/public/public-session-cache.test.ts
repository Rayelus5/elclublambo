import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({}) }));
// React's cache() only memoizes inside a server render: check that the session read is wrapped in it (one auth round
// trip per request, however many components ask).
const cached = vi.hoisted(() => ({ fns: [] as unknown[] }));
vi.mock("react", async (orig) => ({
  ...(await orig<typeof import("react")>()),
  cache: (fn: unknown) => {
    cached.fns.push(fn);
    return Object.assign(fn as object, { __cached: true });
  },
}));

import { getPublicSession } from "@/lib/auth/public-session";

describe("getPublicSession", () => {
  it("is wrapped in React cache()", () => {
    expect(cached.fns).toHaveLength(1);
    expect((getPublicSession as unknown as { __cached?: boolean }).__cached).toBe(true);
  });
});
