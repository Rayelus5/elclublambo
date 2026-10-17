// @vitest-environment node
import { describe, expect, it, afterAll } from "vitest";
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { must, newUser, opts, serviceKey, skipReason, sleep, up, url, waitFor, type Who } from "./realtime-helpers";

async function listenMember(who: Who, memberId: string, timeoutMs = 5000) {
  const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const ch: RealtimeChannel = who.client.channel(`member:${memberId}`, { config: { private: true } });
  ch.on("broadcast", { event: "*" }, (m) => events.push({ event: m.event, payload: m.payload }));
  const status = await new Promise<string>((resolve) => {
    const t = setTimeout(() => resolve("TIMEOUT"), timeoutMs);
    ch.subscribe((s, err) => {
      if (s === "SUBSCRIBED" || s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") {
        clearTimeout(t);
        resolve(err ? `${s}: ${err.message}` : s);
      }
    });
  });
  return { ch, events, status };
}

describe.skipIf(!up)(`member notification realtime ${up ? "" : `(skipped: ${skipReason})`}`, () => {
  const db = up ? createClient(url!, serviceKey!, opts) : (null as unknown as SupabaseClient);
  const clients: SupabaseClient[] = [];
  const notificationIds: number[] = [];

  afterAll(async () => {
    for (const c of clients) await c.removeAllChannels();
    if (notificationIds.length) await db.from("notifications").delete().in("id", notificationIds);
  });

  it("the owner receives notification_created (id only); another member cannot join member:<owner>", async () => {
    const a = await newUser(db);
    const b = await newUser(db);
    clients.push(a.client, b.client);

    const la = await listenMember(a, a.memberId);
    const lb = await listenMember(b, a.memberId);
    expect(la.status).toBe("SUBSCRIBED");
    expect(lb.status).not.toBe("SUBSCRIBED");
    await b.client.removeChannel(lb.ch); // denied topics must be removed

    const n = must<{ id: number }>(
      await db.from("notifications").insert({ recipient_id: a.memberId, kind: "invite_redeemed" }).select("id").single(),
      "insert notification",
    );
    notificationIds.push(n.id);

    expect(await waitFor(la.events, 5000)).toBeGreaterThan(0);
    const created = la.events.find((e) => e.event === "notification_created");
    expect(created).toBeTruthy();
    expect(created!.payload).toEqual({ id: n.id });

    await sleep(2000);
    expect(lb.events.length).toBe(0);
    await a.client.removeChannel(la.ch);
  }, 40000);
});

describe.skipIf(up)("member notification realtime (skipped)", () => {
  it.skip(skipReason, () => {});
});
