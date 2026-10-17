// @vitest-environment node
import { describe, expect, it, afterAll } from "vitest";
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { denyView, doc, listen, makeChannels, must, newUser, opts, serviceKey, skipReason, sleep, up, url, waitFor } from "./realtime-helpers";

// Receive authorization of private channel topics (policy on realtime.messages), exercised with real message events.
describe.skipIf(!up)(`private realtime broadcast authorization ${up ? "" : `(skipped: ${skipReason})`}`, () => {
  const db = up ? createClient(url!, serviceKey!, opts) : (null as unknown as SupabaseClient);
  const open: RealtimeChannel[] = [];
  const clients: SupabaseClient[] = [];
  const channelIds: string[] = [];

  afterAll(async () => {
    for (const c of open) await c.unsubscribe();
    for (const c of clients) await c.removeAllChannels();
    for (const id of channelIds.reverse()) await db.from("channels").delete().eq("id", id);
  });

  async function setup() {
    const a = await newUser(db);
    const b = await newUser(db);
    clients.push(a.client, b.client);
    const [visible, hiddenForB] = await makeChannels(db, ["auth_visible", "auth_hidden"], channelIds);
    // Members here are bootstrap (see seed helper), so deny B via member overwrite on the hidden channel.
    await denyView(db, hiddenForB!, b.memberId);
    return { a, b, visible: visible!, hiddenForB: hiddenForB! };
  }

  // A real message insert fires the broadcast trigger (message_created).
  const emit = async (channel: string, author: string) => {
    must(
      await db
        .from("messages")
        .insert({ channel_id: channel, author_id: author, body: doc("x"), body_text: "x", allow_links: false })
        .select("id")
        .single(),
      "insert message",
    );
  };

  it("member who can view receives; member who cannot view does not", async () => {
    const { a, b, hiddenForB } = await setup();
    const la = await listen(a, hiddenForB);
    const lb = await listen(b, hiddenForB);
    open.push(la.ch, lb.ch);
    expect(la.status).toBe("SUBSCRIBED");
    expect(lb.status).not.toBe("SUBSCRIBED");
    await b.client.removeChannel(lb.ch);
    await emit(hiddenForB, a.memberId);
    expect(await waitFor(la.events, 5000)).toBeGreaterThan(0);
    expect(la.events[0]!.payload).toMatchObject({ channel_id: hiddenForB });
    await sleep(3000);
    expect(lb.events.length).toBe(0);
  }, 40000);

  it("B subscribing to a visible channel receives", async () => {
    const { a, b, visible } = await setup();
    const lb = await listen(b, visible);
    open.push(lb.ch);
    expect(lb.status).toBe("SUBSCRIBED");
    await emit(visible, a.memberId);
    expect(await waitFor(lb.events, 5000)).toBeGreaterThan(0);
    expect(lb.events[0]!.payload).toMatchObject({ channel_id: visible });
  }, 30000);

  it("malformed private topics get nothing and do not break a valid join", async () => {
    const { a, visible } = await setup();
    for (const topic of ["channel:zzzz", "room:x", "channel:ZZZZZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZZZZZZZZZ"]) {
      const bad = a.client.channel(topic, { config: { private: true } });
      open.push(bad);
      const st = await new Promise<string>((resolve) => {
        const t = setTimeout(() => resolve("TIMEOUT"), 3000);
        bad.subscribe((s) => {
          if (s === "SUBSCRIBED" || s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") {
            clearTimeout(t);
            resolve(s);
          }
        });
      });
      expect(st).not.toBe("SUBSCRIBED");
      await a.client.removeChannel(bad);
    }
    const la = await listen(a, visible, 20000);
    open.push(la.ch);
    expect(la.status).toBe("SUBSCRIBED");
    await emit(visible, a.memberId);
    expect(await waitFor(la.events, 5000)).toBeGreaterThan(0);
  }, 40000);

  it("clients cannot broadcast on a private channel topic", async () => {
    const { a, b, visible } = await setup();
    const la = await listen(a, visible);
    const lb = await listen(b, visible);
    open.push(la.ch, lb.ch);
    expect(la.status).toBe("SUBSCRIBED");
    expect(lb.status).toBe("SUBSCRIBED");
    await la.ch.send({ type: "broadcast", event: "message_created", payload: { id: "x", channel_id: visible } });
    await sleep(3000);
    expect(lb.events.length).toBe(0);
  }, 30000);
});

describe.skipIf(up)("private realtime broadcast authorization (skipped)", () => {
  it.skip(skipReason, () => {});
});
