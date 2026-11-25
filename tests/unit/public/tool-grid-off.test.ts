// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

// The hub and the landing read the switches from the tagged cache, without connection(): they are part of the static
// shell, so a visit (or a crawler) costs no function run.
vi.mock("next/server", () => ({
  connection: async () => {
    throw new Error("the switches must not be read at request time");
  },
}));
vi.mock("@/lib/admin/site-state-cached", async () => {
  const { OPEN_STATE } = await import("@/lib/admin/state");
  return { getCachedSiteState: async () => ({ ...OPEN_STATE, switches: { ...OPEN_STATE.switches, gas: false, registration: false } }) };
});

import { offTools } from "@/components/public/tool-grid";

describe("offTools", () => {
  it("lists the tools switched off from the cached state (registration is no tool)", async () => {
    expect([...(await offTools())]).toEqual(["gas"]);
  });
});
