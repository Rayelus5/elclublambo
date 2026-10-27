import { beforeEach, describe, expect, it, vi } from "vitest";

const ME = "44444444-4444-4444-8444-444444444444";
const OLD = `${ME}/9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d.png`;
const NEW = `${ME}/1a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d.webp`;
const OTHER = "55555555-5555-4555-8555-555555555555/9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d.png";

const rpc = vi.fn();
let previous: string | null = OLD;
const from = vi.fn(() => {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) b[m] = vi.fn(() => b);
  b.maybeSingle = vi.fn(async () => ({ data: { avatar_path: previous }, error: null }));
  return b;
});
const remove = vi.fn();
const storageFrom = vi.fn(() => ({ remove }));
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({ rpc, from }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ storage: { from: storageFrom } }) }));

import { saveProfileAction, setAvatarAction, setHandleAction, setReceiveNetworksAction } from "@/lib/profile/actions";
import { rpcErrorMessage } from "@/lib/errors";

const input = { displayName: "Ana", bio: "hola", links: ["https://a.com"] };

beforeEach(() => {
  rpc.mockReset();
  remove.mockReset();
  remove.mockResolvedValue({ data: [], error: null });
  revalidatePath.mockReset();
  previous = OLD;
  rpc.mockImplementation(async (fn: string) => (fn === "current_member_id" ? { data: ME, error: null } : { data: null, error: null }));
});

const failWith = (code: string) =>
  rpc.mockImplementation(async (fn: string) =>
    fn === "current_member_id" ? { data: ME, error: null } : { data: null, error: { message: code } },
  );

describe("saveProfileAction", () => {
  it("calls update_profile and revalidates", async () => {
    expect(await saveProfileAction(input)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("update_profile", { p_display_name: "Ana", p_bio: "hola", p_links: ["https://a.com"] });
    expect(revalidatePath).toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/foro/(forum)/u/[address]", "page");
    expect(revalidatePath).toHaveBeenCalledWith("/foro/perfil");
  });

  it.each(["bio_too_long", "links_invalid", "invalid_input", "forbidden"])("maps %s to its Spanish copy", async (code) => {
    failWith(code);
    expect(await saveProfileAction(input)).toEqual({ ok: false, error: rpcErrorMessage(code) });
  });

  it("rejects malformed input without calling the db", async () => {
    // @ts-expect-error hostile input
    expect(await saveProfileAction({ displayName: 1, bio: "", links: "x" })).toEqual({ ok: false, error: rpcErrorMessage("invalid_input") });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("setHandleAction", () => {
  it("returns the stored handle", async () => {
    rpc.mockResolvedValue({ data: "ray_l", error: null });
    expect(await setHandleAction("Ray_L")).toEqual({ ok: true, handle: "ray_l" });
    expect(rpc).toHaveBeenCalledWith("set_handle", { p_handle: "ray_l" });
  });

  it("maps handle_taken to 'Ese nombre ya está en uso'", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "handle_taken" } });
    expect(await setHandleAction("ana")).toEqual({ ok: false, error: "Ese nombre ya está en uso" });
  });

  it.each(["handle_reserved", "handle_cooldown", "handle_invalid"])("maps %s", async (code) => {
    rpc.mockResolvedValue({ data: null, error: { message: code } });
    expect(await setHandleAction("ana")).toEqual({ ok: false, error: rpcErrorMessage(code) });
  });

  it("rejects reserved and look-alike handles before the db", async () => {
    expect(await setHandleAction("Admin ")).toEqual({ ok: false, error: rpcErrorMessage("handle_reserved") });
    expect(await setHandleAction("аdmin")).toEqual({ ok: false, error: rpcErrorMessage("handle_invalid") });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("setAvatarAction", () => {
  it("sets the avatar then deletes the previous own object", async () => {
    expect(await setAvatarAction(NEW)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("set_avatar", { p_path: NEW });
    expect(storageFrom).toHaveBeenCalledWith("avatars");
    expect(remove).toHaveBeenCalledWith([OLD]);
  });

  it("deletes the previous object when clearing", async () => {
    expect(await setAvatarAction(null)).toEqual({ ok: true });
    expect(remove).toHaveBeenCalledWith([OLD]);
  });

  it("does not delete anything when set_avatar fails", async () => {
    failWith("avatar_invalid");
    expect(await setAvatarAction(NEW)).toEqual({ ok: false, error: rpcErrorMessage("avatar_invalid") });
    expect(remove).not.toHaveBeenCalledWith([OLD]);
  });

  it("removes the just-uploaded object when set_avatar fails", async () => {
    failWith("avatar_invalid");
    await setAvatarAction(NEW);
    expect(remove).toHaveBeenCalledWith([NEW]);
  });

  it("never deletes an object outside the caller's folder", async () => {
    previous = OTHER;
    expect(await setAvatarAction(NEW)).toEqual({ ok: true });
    expect(remove).not.toHaveBeenCalled();
  });

  it("does not delete when the path is unchanged", async () => {
    expect(await setAvatarAction(OLD)).toEqual({ ok: true });
    expect(remove).not.toHaveBeenCalled();
  });

  it("a failed cleanup does not fail the action", async () => {
    remove.mockResolvedValue({ data: null, error: { message: "boom" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await setAvatarAction(NEW)).toEqual({ ok: true });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("a thrown cleanup does not fail the action", async () => {
    remove.mockRejectedValue(new Error("net"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await setAvatarAction(NEW)).toEqual({ ok: true });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("setReceiveNetworksAction", () => {
  it("calls set_receive_networks and revalidates", async () => {
    expect(await setReceiveNetworksAction(["arbitrum", "base"])).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("set_receive_networks", { p_networks: ["arbitrum", "base"] });
    expect(revalidatePath).toHaveBeenCalled();
  });

  it.each([[[]], [["linea"]], [["base", "linea"]]])("rejects %j without calling the db", async (list) => {
    // @ts-expect-error hostile input
    expect(await setReceiveNetworksAction(list)).toEqual({ ok: false, error: rpcErrorMessage("invalid_input") });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps a db error", async () => {
    failWith("rate_limited");
    expect(await setReceiveNetworksAction(["base"])).toEqual({ ok: false, error: rpcErrorMessage("rate_limited") });
  });
});
