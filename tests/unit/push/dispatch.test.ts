import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const rpc = vi.hoisted(() => vi.fn());
const sendNotification = vi.hoisted(() => vi.fn());
const setVapidDetails = vi.hoisted(() => vi.fn());
const after = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
vi.mock("web-push", () => ({ default: { sendNotification, setVapidDetails } }));
vi.mock("next/server", () => ({ after }));

import { dispatchPendingPush } from "@/lib/push/dispatch";
import { schedulePushDispatch } from "@/lib/push/schedule";

const EP1 = "https://fcm.googleapis.com/fcm/send/aaa-secret-token-1";
const EP2 = "https://updates.push.services.mozilla.com/wpush/v2/bbb-secret-token-2";
const row = (over: Record<string, unknown> = {}) => ({
  notification_id: 1,
  endpoint: EP1,
  p256dh: "p",
  auth: "a",
  title: "Nueva mención",
  body: "Ana te mencionó en #general",
  url: "/c/11111111-1111-4111-8111-111111111111",
  tag: "mention:1",
  ...over,
});

const ENV = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  rpc.mockReset();
  sendNotification.mockReset();
  setVapidDetails.mockReset();
  after.mockReset();
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  process.env.VAPID_PUBLIC_KEY = "pub";
  process.env.VAPID_PRIVATE_KEY = "priv";
  process.env.VAPID_SUBJECT = "mailto:admin@elclublambo.local";
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

describe("dispatchPendingPush", () => {
  it("does nothing without VAPID keys", async () => {
    delete process.env.VAPID_PRIVATE_KEY;
    expect(await dispatchPendingPush()).toEqual({ sent: 0, removed: 0 });
    expect(rpc).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("sends once per claimed row with the safe payload, TTL and urgency", async () => {
    rpc.mockResolvedValueOnce({
      data: [row(), row({ notification_id: 2, endpoint: EP2, tag: "channel_message:2", title: "Nuevo mensaje" })],
      error: null,
    });
    sendNotification.mockResolvedValue({ statusCode: 201 });

    expect(await dispatchPendingPush()).toEqual({ sent: 2, removed: 0 });
    expect(rpc).toHaveBeenCalledWith("claim_push_notifications", { p_limit: 200 });
    expect(setVapidDetails).toHaveBeenCalledWith("mailto:admin@elclublambo.local", "pub", "priv");
    expect(sendNotification).toHaveBeenCalledTimes(2);

    const [sub, payload, opts] = sendNotification.mock.calls[0]!;
    expect(sub).toEqual({ endpoint: EP1, keys: { p256dh: "p", auth: "a" } });
    expect(JSON.parse(payload)).toEqual({
      title: "Nueva mención",
      body: "Ana te mencionó en #general",
      url: "/c/11111111-1111-4111-8111-111111111111",
      tag: "mention:1",
    });
    expect(opts).toEqual({ TTL: 3600, urgency: "high" });
    expect(sendNotification.mock.calls[1]![2]).toEqual({ TTL: 3600, urgency: "normal" });
  });

  it("deletes the subscription on 410 and 404 and keeps going", async () => {
    rpc.mockImplementation(async (name: string) =>
      name === "claim_push_notifications"
        ? { data: [row(), row({ notification_id: 2, endpoint: EP2 }), row({ notification_id: 3, endpoint: EP2 + "x" })], error: null }
        : { data: null, error: null },
    );
    sendNotification
      .mockRejectedValueOnce(Object.assign(new Error("gone"), { statusCode: 410 }))
      .mockRejectedValueOnce(Object.assign(new Error("nf"), { statusCode: 404 }))
      .mockResolvedValueOnce({ statusCode: 201 });

    expect(await dispatchPendingPush()).toEqual({ sent: 1, removed: 2 });
    expect(rpc).toHaveBeenCalledWith("delete_push_subscription_by_endpoint", { p_endpoint: EP1 });
    expect(rpc).toHaveBeenCalledWith("delete_push_subscription_by_endpoint", { p_endpoint: EP2 });
  });

  it("logs other errors without the full endpoint and never throws", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValueOnce({ data: [row()], error: null });
    sendNotification.mockRejectedValueOnce(Object.assign(new Error(`boom ${EP1}`), { statusCode: 500 }));

    await expect(dispatchPendingPush()).resolves.toEqual({ sent: 0, removed: 0 });
    const logged = JSON.stringify(err.mock.calls);
    expect(logged).toContain("fcm.googleapis.com");
    expect(logged).not.toContain("aaa-secret-token-1");
    expect(rpc).not.toHaveBeenCalledWith("delete_push_subscription_by_endpoint", expect.anything());
  });

  it("never throws when the claim fails", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "db down" } });
    await expect(dispatchPendingPush()).resolves.toEqual({ sent: 0, removed: 0 });
    expect(err).toHaveBeenCalled();
    rpc.mockRejectedValueOnce(new Error("network"));
    await expect(dispatchPendingPush()).resolves.toEqual({ sent: 0, removed: 0 });
  });

  it("refuses endpoints outside the allowlist and non-internal urls", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockImplementation(async (name: string) =>
      name === "claim_push_notifications"
        ? {
            data: [
              row({ endpoint: "https://127.0.0.1/x" }),
              row({ notification_id: 2, url: "https://evil.example/phish" }),
              row({ notification_id: 3, url: "//evil.example" }),
            ],
            error: null,
          }
        : { data: null, error: null },
    );
    expect(await dispatchPendingPush()).toEqual({ sent: 0, removed: 1 });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  const fullBatch = (from: number) =>
    Array.from({ length: 200 }, (_, i) => row({ notification_id: from + i, tag: `channel_message:${from + i}` }));
  const claims = () => rpc.mock.calls.filter((c) => c[0] === "claim_push_notifications").length;

  it("keeps claiming while the batch is full, and stops on a partial one (aggregated counts)", async () => {
    rpc
      .mockResolvedValueOnce({ data: fullBatch(1), error: null })
      .mockResolvedValueOnce({ data: [row({ notification_id: 999 })], error: null });
    sendNotification.mockResolvedValue({ statusCode: 201 });

    expect(await dispatchPendingPush()).toEqual({ sent: 201, removed: 0 });
    expect(claims()).toBe(2);
  });

  it("counts distinct notification ids, not rows (several subscriptions per notice)", async () => {
    const dup = Array.from({ length: 200 }, (_, i) => row({ notification_id: 1 + (i % 100), endpoint: EP1 + i }));
    rpc.mockResolvedValueOnce({ data: dup, error: null });
    sendNotification.mockResolvedValue({ statusCode: 201 });

    expect(await dispatchPendingPush()).toEqual({ sent: 200, removed: 0 });
    expect(claims()).toBe(1);
  });

  it("stops after 25 claims even if every batch is full", async () => {
    let n = 0;
    rpc.mockImplementation(async () => ({ data: fullBatch((n++ * 200) + 1), error: null }));
    sendNotification.mockResolvedValue({ statusCode: 201 });

    expect(await dispatchPendingPush()).toEqual({ sent: 25 * 200, removed: 0 });
    expect(claims()).toBe(25);
  });
});

describe("schedulePushDispatch", () => {
  it("schedules the dispatch with after()", () => {
    schedulePushDispatch();
    expect(after).toHaveBeenCalledTimes(1);
    expect(typeof after.mock.calls[0]![0]).toBe("function");
  });

  it("never throws outside a request scope", () => {
    after.mockImplementation(() => {
      throw new Error("`after` was called outside a request scope");
    });
    expect(() => schedulePushDispatch()).not.toThrow();
  });
});
