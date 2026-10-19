import { afterEach, describe, expect, it, vi } from "vitest";

// F5 Task 5 (F5-R7): standalone output only for the preproduction Docker image; Vercel and local dev keep the default.

async function freshConfig() {
  vi.resetModules();
  return (await import("../../next.config")).default;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("next.config output", () => {
  it("is standalone when NEXT_OUTPUT=standalone", async () => {
    vi.stubEnv("NEXT_OUTPUT", "standalone");
    expect((await freshConfig()).output).toBe("standalone");
  });

  it("is the default (undefined) otherwise", async () => {
    vi.stubEnv("NEXT_OUTPUT", "");
    expect((await freshConfig()).output).toBeUndefined();
    vi.stubEnv("NEXT_OUTPUT", "export");
    expect((await freshConfig()).output).toBeUndefined();
  });
});
