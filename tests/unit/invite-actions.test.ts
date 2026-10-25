import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
const revalidatePath = vi.hoisted(() => vi.fn());
const headersGet = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({ rpc }) }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: headersGet }) }));

import { createInviteAction, revokeInviteAction } from "@/lib/invites/actions";

function fd(max: string, exp: string) {
  const f = new FormData();
  f.set("max_uses", max);
  f.set("expires_in", exp);
  return f;
}

describe("createInviteAction", () => {
  beforeEach(() => {
    rpc.mockReset();
    revalidatePath.mockReset();
    headersGet.mockReset();
    delete process.env.NEXT_PUBLIC_SITE_URL;
  });

  it("rejects values outside the allowlists without calling the rpc", async () => {
    const bad: Array<[string, string]> = [
      ["2", "24"],
      ["5", "2"],
      ["x", "24"],
      ["", ""],
    ];
    for (const [m, e] of bad) {
      expect(await createInviteAction(fd(m, e))).toEqual({ error: "invalid_input" });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls create_invite and builds the url from host headers", async () => {
    headersGet.mockImplementation((k: string) => (k === "host" ? "localhost:3000" : null));
    rpc.mockResolvedValue({ data: { code: "CODE22" }, error: null });
    const res = await createInviteAction(fd("5", "168"));
    expect(rpc).toHaveBeenCalledWith("create_invite", { p_max_uses: 5, p_expires_in_hours: 168 });
    expect(res).toEqual({ url: "http://localhost:3000/foro/invite/CODE22" });
    expect(revalidatePath).toHaveBeenCalledWith("/invites");
  });

  it("uses x-forwarded-proto and NEXT_PUBLIC_SITE_URL when present", async () => {
    headersGet.mockImplementation(
      (k: string) => ({ host: "club.example", "x-forwarded-proto": "https" })[k] ?? null,
    );
    rpc.mockResolvedValue({ data: { code: "C" }, error: null });
    expect((await createInviteAction(fd("1", "1"))).url).toBe("https://club.example/foro/invite/C");
    process.env.NEXT_PUBLIC_SITE_URL = "https://site.test/";
    expect((await createInviteAction(fd("1", "1"))).url).toBe("https://site.test/foro/invite/C");
  });

  it("maps rpc errors to codes", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "forbidden" } });
    expect(await createInviteAction(fd("5", "24"))).toEqual({ error: "forbidden" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("revokeInviteAction", () => {
  beforeEach(() => {
    rpc.mockReset();
    revalidatePath.mockReset();
  });
  it("revokes with null reason and revalidates", async () => {
    rpc.mockResolvedValue({ error: null });
    const id = "6f1c1c5e-0000-4000-8000-000000000001";
    expect(await revokeInviteAction(id)).toEqual({});
    expect(rpc).toHaveBeenCalledWith("revoke_invite", { p_invite_id: id, p_reason: null });
    expect(revalidatePath).toHaveBeenCalledWith("/invites");
  });
  it("returns the error code", async () => {
    rpc.mockResolvedValue({ error: { message: "invite_not_found" } });
    expect(await revokeInviteAction("6f1c1c5e-0000-4000-8000-000000000001")).toEqual({
      error: "invite_not_found",
    });
  });
  it("rejects a non-uuid id", async () => {
    expect(await revokeInviteAction("nope")).toEqual({ error: "invalid_input" });
    expect(rpc).not.toHaveBeenCalled();
  });
});
