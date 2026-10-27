import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const session = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/public-session", () => ({ getPublicSession: session }));
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({ rpc }) }));

import { savePublicProfileAction } from "@/lib/pay/actions";

const valid = { alias: "rayelus", displayName: "Ray", acceptNetworks: ["base" as const], showMemberBadge: false };
const PROFILE = { alias: "rayelus", displayName: "Ray", address: "0x1", acceptNetworks: ["base"], showMemberBadge: false };

beforeEach(() => {
  vi.clearAllMocks();
  session.mockResolvedValue({ userId: "u1", wallet: "0x1", isMember: false });
  rpc.mockResolvedValue({ data: PROFILE, error: null });
});

describe("savePublicProfileAction", () => {
  it("saves a valid profile with the trimmed name", async () => {
    expect(await savePublicProfileAction({ ...valid, displayName: " Ray " })).toMatchObject({ ok: true });
    expect(rpc).toHaveBeenCalledWith("upsert_public_profile", expect.objectContaining({ p_alias: "rayelus", p_display_name: "Ray" }));
  });

  it("an empty name is saved as null", async () => {
    await savePublicProfileAction({ ...valid, displayName: "" });
    expect(rpc).toHaveBeenCalledWith("upsert_public_profile", expect.objectContaining({ p_display_name: null }));
  });

  it("rejects a name with a bidi or zero-width character, or only whitespace, without calling the RPC", async () => {
    for (const displayName of ["Ra‮y", "​Ray", "　 "]) {
      expect(await savePublicProfileAction({ ...valid, displayName })).toEqual({ ok: false, error: "display_name_invalid" });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps the SQL alias_held refusal", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "alias_held" } });
    expect(await savePublicProfileAction(valid)).toEqual({ ok: false, error: "alias_held" });
  });
});
