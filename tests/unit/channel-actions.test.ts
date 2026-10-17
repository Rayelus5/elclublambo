import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
const revalidatePath = vi.hoisted(() => vi.fn());

const remove = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({ rpc }) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: {
      from: (bucket: string) => {
        from(bucket);
        return { remove };
      },
    },
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath }));

import {
  createChannelAction,
  deleteChannelAction,
  moveChannelAction,
  updateChannelAction,
} from "@/lib/channels/actions";

const A = "6f1c1c5e-0000-4000-8000-000000000001";
const B = "6f1c1c5e-0000-4000-8000-000000000002";

beforeEach(() => {
  rpc.mockReset();
  revalidatePath.mockReset();
  remove.mockReset();
  from.mockReset();
});

function expectRevalidated() {
  expect(revalidatePath).toHaveBeenCalledWith("/settings/channels");
  expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
}

describe("createChannelAction", () => {
  it("calls create_channel with trimmed args and revalidates", async () => {
    rpc.mockResolvedValue({ data: B, error: null });
    const res = await createChannelAction({ parentId: A, kind: "text", name: "  general ", topic: "  hola " });
    expect(rpc).toHaveBeenCalledWith("create_channel", {
      p_parent: A,
      p_kind: "text",
      p_name: "general",
      p_topic: "hola",
    });
    expect(res).toEqual({ id: B });
    expectRevalidated();
  });

  it("allows a root category and an empty topic as null", async () => {
    rpc.mockResolvedValue({ data: B, error: null });
    await createChannelAction({ parentId: null, kind: "category", name: "Mercado", topic: "" });
    expect(rpc).toHaveBeenCalledWith("create_channel", {
      p_parent: null,
      p_kind: "category",
      p_name: "Mercado",
      p_topic: null,
    });
  });

  it("validates before calling the rpc", async () => {
    const bad = [
      { parentId: "nope", kind: "text", name: "x", topic: "" },
      { parentId: A, kind: "voice", name: "x", topic: "" },
      { parentId: A, kind: "text", name: "   ", topic: "" },
      { parentId: A, kind: "text", name: "x".repeat(51), topic: "" },
      { parentId: A, kind: "text", name: "x", topic: "t".repeat(301) },
    ] as never[];
    for (const input of bad) expect(await createChannelAction(input)).toEqual({ error: "invalid_input" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps rpc errors to codes and does not revalidate", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "depth_limit" } });
    expect(await createChannelAction({ parentId: A, kind: "forum", name: "x", topic: "" })).toEqual({
      error: "depth_limit",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("updateChannelAction", () => {
  const base = { id: A, name: " Reglas ", topic: "", slowmodeSeconds: 10, ticketsEnabled: false, alphaEnabled: true };

  it("calls update_channel with the right args", async () => {
    rpc.mockResolvedValue({ error: null });
    expect(await updateChannelAction(base)).toEqual({});
    expect(rpc).toHaveBeenCalledWith("update_channel", {
      p_id: A,
      p_name: "Reglas",
      p_topic: null,
      p_slowmode: 10,
      p_tickets: false,
      p_alpha: true,
    });
    expectRevalidated();
  });

  it("rejects slowmode outside 0 or 5..604800 and non-integers", async () => {
    for (const s of [1, 4, 604801, -1, 7.5, Number.NaN]) {
      expect(await updateChannelAction({ ...base, slowmodeSeconds: s })).toEqual({ error: "invalid_input" });
    }
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ error: null });
    expect(await updateChannelAction({ ...base, slowmodeSeconds: 0 })).toEqual({});
    expect(await updateChannelAction({ ...base, slowmodeSeconds: 604800 })).toEqual({});
  });

  it("rejects bad id/name", async () => {
    expect(await updateChannelAction({ ...base, id: "x" })).toEqual({ error: "invalid_input" });
    expect(await updateChannelAction({ ...base, name: "" })).toEqual({ error: "invalid_input" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps rpc errors", async () => {
    rpc.mockResolvedValue({ error: { message: "forbidden" } });
    expect(await updateChannelAction(base)).toEqual({ error: "forbidden" });
  });
});

describe("moveChannelAction", () => {
  it("calls move_channel with parent and index", async () => {
    rpc.mockResolvedValue({ error: null });
    expect(await moveChannelAction({ id: A, parentId: B, index: 2 })).toEqual({});
    expect(rpc).toHaveBeenCalledWith("move_channel", { p_id: A, p_new_parent: B, p_index: 2 });
    expectRevalidated();
  });

  it("supports root parent and append (null index)", async () => {
    rpc.mockResolvedValue({ error: null });
    await moveChannelAction({ id: A, parentId: null, index: null });
    expect(rpc).toHaveBeenCalledWith("move_channel", { p_id: A, p_new_parent: null, p_index: null });
  });

  it("validates ids and index", async () => {
    expect(await moveChannelAction({ id: "x", parentId: null, index: 0 })).toEqual({ error: "invalid_input" });
    expect(await moveChannelAction({ id: A, parentId: "x", index: 0 })).toEqual({ error: "invalid_input" });
    expect(await moveChannelAction({ id: A, parentId: null, index: -1 })).toEqual({ error: "invalid_input" });
    expect(await moveChannelAction({ id: A, parentId: null, index: 1.5 })).toEqual({ error: "invalid_input" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps invalid_tree", async () => {
    rpc.mockResolvedValue({ error: { message: "invalid_tree" } });
    expect(await moveChannelAction({ id: A, parentId: B, index: 0 })).toEqual({ error: "invalid_tree" });
  });
});

describe("deleteChannelAction", () => {
  it("calls delete_channel, removes its storage objects and revalidates", async () => {
    rpc.mockResolvedValue({ data: { paths: ["c/m/a.png", "c/m/b.png"] }, error: null });
    remove.mockResolvedValue({ data: [], error: null });
    expect(await deleteChannelAction(A)).toEqual({});
    expect(rpc).toHaveBeenCalledWith("delete_channel", { p_id: A });
    expect(from).toHaveBeenCalledWith("chat-images");
    expect(remove).toHaveBeenCalledWith(["c/m/a.png", "c/m/b.png"]);
    expectRevalidated();
  });
  it("skips storage when there are no paths", async () => {
    rpc.mockResolvedValue({ data: { paths: [] }, error: null });
    expect(await deleteChannelAction(A)).toEqual({});
    expect(remove).not.toHaveBeenCalled();
  });
  it("tolerates a missing bucket or storage failure but logs it", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: { paths: ["c/m/a.png"] }, error: null });
    remove.mockResolvedValue({ data: null, error: { message: "Bucket not found", statusCode: "404" } });
    expect(await deleteChannelAction(A)).toEqual({});
    expect(log).toHaveBeenCalledTimes(1);
    remove.mockRejectedValue(new Error("boom"));
    expect(await deleteChannelAction(A)).toEqual({});
    expect(log).toHaveBeenCalledTimes(2);
    expectRevalidated();
    log.mockRestore();
  });
  it("removes objects in chunks of 1000", async () => {
    const paths = Array.from({ length: 2500 }, (_, i) => `c/m/${i}.png`);
    rpc.mockResolvedValue({ data: { paths }, error: null });
    remove.mockResolvedValue({ data: [], error: null });
    await deleteChannelAction(A);
    expect(remove).toHaveBeenCalledTimes(3);
    expect(remove.mock.calls.map((c) => c[0].length)).toEqual([1000, 1000, 500]);
  });
  it("does not touch storage when the rpc fails", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "forbidden" } });
    expect(await deleteChannelAction(A)).toEqual({ error: "forbidden" });
    expect(remove).not.toHaveBeenCalled();
  });
  it("rejects non-uuid and maps not_empty", async () => {
    expect(await deleteChannelAction("x")).toEqual({ error: "invalid_input" });
    rpc.mockResolvedValue({ error: { message: "not_empty" } });
    expect(await deleteChannelAction(A)).toEqual({ error: "not_empty" });
  });
});
