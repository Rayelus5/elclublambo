// @vitest-environment node
import { describe, expect, it, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { denyView, doc, listen, makeChannels, must, newUser, opts, serviceKey, skipReason, sleep, up, url, waitFor } from "./realtime-helpers";

describe.skipIf(!up)(`message realtime broadcast ${up ? "" : `(skipped: ${skipReason})`}`, () => {
  const db = up ? createClient(url!, serviceKey!, opts) : (null as unknown as SupabaseClient);
  const clients: SupabaseClient[] = [];
  const channelIds: string[] = [];
  const open: Array<{ unsubscribe: () => Promise<unknown> }> = [];

  afterAll(async () => {
    for (const c of clients) await c.removeAllChannels();
    for (const id of channelIds.reverse()) await db.from("channels").delete().eq("id", id);
  });

  async function setup() {
    const a = await newUser(db);
    const b = await newUser(db);
    const c = await newUser(db);
    clients.push(a.client, b.client, c.client);
    const [chat] = await makeChannels(db, ["rt_chat"], channelIds);
    await denyView(db, chat!, c.memberId); // C cannot view the channel
    return { a, b, c, chat: chat! };
  }

  const post = async (who: { client: SupabaseClient }, channel: string, text: string, thread: string | null = null) =>
    must<string>(
      await who.client.rpc("post_message", {
        p_channel: channel,
        p_body: doc(text),
        p_body_text: text,
        p_expanded: false,
        p_thread_root: thread,
        p_quoted: null,
        p_attachments: null,
      }),
      "post_message",
    );

  it("a member with VIEW receives message_created (ids only); a member without VIEW receives nothing", async () => {
    const { a, b, c, chat } = await setup();
    const la = await listen(a, chat);
    const lc = await listen(c, chat);
    open.push(la.ch, lc.ch);
    expect(la.status).toBe("SUBSCRIBED");
    expect(lc.status).not.toBe("SUBSCRIBED");
    await c.client.removeChannel(lc.ch); // denied channels must be removed (spike finding)

    const id = await post(b, chat, "hola equipo");
    expect(await waitFor(la.events, 5000)).toBeGreaterThan(0);
    const created = la.events.find((e) => e.event === "message_created");
    expect(created).toBeTruthy();
    // payload is ids only, never content
    expect(Object.keys(created!.payload).sort()).toEqual(["channel_id", "id", "thread_root_id"]);
    expect(created!.payload).toMatchObject({ id, channel_id: chat, thread_root_id: null });
    expect(JSON.stringify(created!.payload)).not.toContain("hola equipo");

    await sleep(2000);
    expect(lc.events.length).toBe(0);
  }, 40000);

  it("a thread reply emits message_created with thread_root_id and updates the root", async () => {
    const { a, b, chat } = await setup();
    const root = await post(b, chat, "raiz");
    const la = await listen(a, chat);
    open.push(la.ch);
    expect(la.status).toBe("SUBSCRIBED");
    const reply = await post(b, chat, "respuesta", root);
    const end = Date.now() + 5000;
    while (Date.now() < end && !(la.events.some((e) => e.event === "message_created") && la.events.some((e) => e.event === "message_updated"))) {
      await sleep(100);
    }
    expect(la.events.find((e) => e.event === "message_created")!.payload).toMatchObject({ id: reply, thread_root_id: root });
    expect(la.events.find((e) => e.event === "message_updated")!.payload).toMatchObject({ id: root });
  }, 40000);

  it("a member cannot read a message of a channel they cannot view, even knowing its id", async () => {
    const { b, c, chat } = await setup();
    const id = await post(b, chat, "secreto");
    const asC = await c.client.from("messages").select("id, body_text").eq("id", id);
    expect(asC.error).toBeNull();
    expect(asC.data).toEqual([]);
    const asB = await b.client.from("messages").select("id").eq("id", id);
    expect(asB.data).toHaveLength(1);
  }, 30000);

  it("after losing VIEW and resubscribing, a member receives nothing", async () => {
    const { a, b, chat } = await setup();
    const first = await listen(a, chat);
    expect(first.status).toBe("SUBSCRIBED");
    await post(b, chat, "antes");
    expect(await waitFor(first.events, 5000)).toBeGreaterThan(0);

    await denyView(db, chat, a.memberId);
    await a.client.removeChannel(first.ch);
    const again = await listen(a, chat);
    open.push(again.ch);
    expect(again.status).not.toBe("SUBSCRIBED");
    await a.client.removeChannel(again.ch);

    await post(b, chat, "despues");
    await sleep(3000);
    expect(again.events.length).toBe(0);
    const read = await a.client.from("messages").select("id").eq("channel_id", chat);
    expect(read.data).toEqual([]);
  }, 60000);
});

describe.skipIf(up)("message realtime broadcast (skipped)", () => {
  it.skip(skipReason, () => {});
});
