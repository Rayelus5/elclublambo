import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({ rpc: h.rpc }) }));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidate }));

import {
  deletePushSubscriptionAction,
  markNotificationsReadAction,
  savePushSubscriptionAction,
  setChannelFollowAction,
} from "@/lib/notifications/actions";

const CH = "11111111-1111-4111-8111-111111111111";
const EP = "https://fcm.googleapis.com/fcm/send/abc";

beforeEach(() => {
  vi.clearAllMocks();
  h.rpc.mockResolvedValue({ data: 1, error: null });
});

describe("markNotificationsReadAction", () => {
  it("marks all with null", async () => {
    expect(await markNotificationsReadAction(null)).toEqual({});
    expect(h.rpc).toHaveBeenCalledWith("mark_notifications_read", { p_ids: null });
  });
  it("passes valid ids and rejects junk", async () => {
    await markNotificationsReadAction([1, 2]);
    expect(h.rpc).toHaveBeenCalledWith("mark_notifications_read", { p_ids: [1, 2] });
    expect(await markNotificationsReadAction([1.5])).toEqual({ error: "invalid_input" });
    expect(await markNotificationsReadAction(["1"] as never)).toEqual({ error: "invalid_input" });
    expect(await markNotificationsReadAction(Array.from({ length: 201 }, (_, i) => i + 1))).toEqual({ error: "invalid_input" });
  });
  it("maps rpc errors", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "forbidden" } });
    expect(await markNotificationsReadAction(null)).toEqual({ error: "forbidden" });
  });
});

describe("setChannelFollowAction", () => {
  it("validates input", async () => {
    expect(await setChannelFollowAction("nope", "all")).toEqual({ error: "invalid_input" });
    expect(await setChannelFollowAction(CH, "loud" as never)).toEqual({ error: "invalid_input" });
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it("calls the rpc", async () => {
    expect(await setChannelFollowAction(CH, "mute")).toEqual({});
    expect(h.rpc).toHaveBeenCalledWith("set_channel_follow", { p_channel: CH, p_level: "mute" });
  });
});

describe("push subscription actions", () => {
  it("rejects a non-allowlisted endpoint before calling the db", async () => {
    expect(await savePushSubscriptionAction({ endpoint: "http://127.0.0.1/x", keys: { p256dh: "a", auth: "b" } })).toEqual({
      error: "invalid_input",
    });
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it("rejects missing keys", async () => {
    expect(await savePushSubscriptionAction({ endpoint: EP, keys: { p256dh: "", auth: "b" } })).toEqual({ error: "invalid_input" });
    expect(await savePushSubscriptionAction(null as never)).toEqual({ error: "invalid_input" });
  });
  it("saves and deletes", async () => {
    expect(await savePushSubscriptionAction({ endpoint: EP, keys: { p256dh: "a", auth: "b" } })).toEqual({});
    expect(h.rpc).toHaveBeenCalledWith("save_push_subscription", { p_endpoint: EP, p_p256dh: "a", p_auth: "b" });
    expect(await deletePushSubscriptionAction(EP)).toEqual({});
    expect(h.rpc).toHaveBeenCalledWith("delete_push_subscription", { p_endpoint: EP });
    expect(await deletePushSubscriptionAction(12 as never)).toEqual({ error: "invalid_input" });
  });
});
