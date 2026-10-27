// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

const getPublicGiveaway = vi.hoisted(() => vi.fn());
vi.mock("@/lib/public-giveaways/queries", () => ({ getPublicGiveaway }));

import { GET } from "@/app/(public)/[lang]/tools/giveaways/[id]/entries/route";

const GID = "00000000-0000-4000-8000-000000000001";
const call = (id = GID) => GET(new Request("http://localhost/es/tools/giveaways/x/entries"), { params: Promise.resolve({ lang: "es", id }) });

beforeEach(() => vi.clearAllMocks());

describe("GET entries", () => {
  it("404 while the giveaway is open or cancelled", async () => {
    for (const status of ["open", "cancelled"]) {
      getPublicGiveaway.mockResolvedValue({ id: GID, status, targetRound: 5, entries: [{ position: null, walletAddress: "0xa" }] });
      const res = await call();
      expect(res.status).toBe(404);
      expect(JSON.stringify(await res.json())).not.toContain("0xa");
    }
  });

  it("404 for an unknown giveaway; read without a viewer", async () => {
    getPublicGiveaway.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
    expect(getPublicGiveaway).toHaveBeenCalledWith(GID, null);
  });

  it("the ordered list once closed, cacheable for a minute", async () => {
    getPublicGiveaway.mockResolvedValue({
      id: GID, status: "drawn", targetRound: 77,
      entries: [{ position: 2, walletAddress: "0xb" }, { position: 1, walletAddress: "0xa" }],
    });
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    expect(await res.json()).toEqual({
      giveawayId: GID, targetRound: 77,
      entries: [{ position: 1, address: "0xa" }, { position: 2, address: "0xb" }],
    });
  });

  it("503 when the database fails", async () => {
    getPublicGiveaway.mockRejectedValue(new Error("x"));
    expect((await call()).status).toBe(503);
  });
});
