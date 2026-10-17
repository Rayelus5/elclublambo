// @vitest-environment node
import { describe, expect, it, afterAll } from "vitest";
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { makeChannels, must, newUser, opts, serviceKey, skipReason, sleep, up, url, waitFor, type Who } from "./realtime-helpers";

async function listenTicket(who: Who, ticketId: string, timeoutMs = 5000) {
  const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const ch: RealtimeChannel = who.client.channel(`ticket:${ticketId}`, { config: { private: true } });
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

describe.skipIf(!up)(`ticket realtime ${up ? "" : `(skipped: ${skipReason})`}`, () => {
  const db = up ? createClient(url!, serviceKey!, opts) : (null as unknown as SupabaseClient);
  const clients: SupabaseClient[] = [];
  const cleanup: string[] = [];

  afterAll(async () => {
    for (const c of clients) await c.removeAllChannels();
    // deleting the category cascades to channels, tickets and ticket messages
    if (cleanup.length) await db.from("channels").delete().in("id", cleanup);
  });

  it("author and staff receive ticket events (ids only); a third member cannot join the topic", async () => {
    const author = await newUser(db);
    const staff = await newUser(db);
    const outsider = await newUser(db);
    const root = await newUser(db); // stays bootstrap: sponsors the demoted members
    clients.push(author.client, staff.client, outsider.client, root.client);
    // Bootstrap members hold ADMINISTRATOR: make the three plain active members so only the overwrite grants staff.
    must(await db.from("members").update({ is_bootstrap: false, invited_by_member_id: root.memberId }).eq("id", outsider.memberId).select("id").single(), "demote outsider");
    must(await db.from("members").update({ is_bootstrap: false, invited_by_member_id: root.memberId }).eq("id", author.memberId).select("id").single(), "demote author");

    const [channelId] = await makeChannels(db, ["tk"], cleanup);
    must(await db.from("channels").update({ tickets_enabled: true }).eq("id", channelId).select("id").single(), "enable tickets");

    // staff = a role with MANAGE_TICKETS via an allow overwrite for this staff member in the channel only
    must(await db.from("members").update({ is_bootstrap: false, invited_by_member_id: root.memberId }).eq("id", staff.memberId).select("id").single(), "demote staff");
    must(
      await db
        .from("permission_overwrites")
        .insert({ channel_id: channelId, target_type: "member", target_id: staff.memberId, allow: "16384", deny: "0" })
        .select(),
      "staff overwrite",
    );

    const opened = await author.client.rpc("open_ticket", { p_channel: channelId, p_subject: "Ayuda con mi acceso", p_body: "hola" });
    expect(opened.error).toBeNull();
    const ticketId = opened.data as string;

    const la = await listenTicket(author, ticketId);
    const ls = await listenTicket(staff, ticketId);
    // The outsider is subscribed BEFORE any event and stays subscribed until the end of the test: a live socket
    // (its own member topic, which it may join) must see nothing of the ticket, and its attempt to join the ticket
    // topic must have been denied and must stay denied while the events happen.
    const lo = await listenTicket(outsider, ticketId);
    const bystander = outsider.client.channel(`member:${outsider.memberId}`, { config: { private: true } });
    const bystanderEvents: Array<{ event: string; payload: Record<string, unknown> }> = [];
    bystander.on("broadcast", { event: "*" }, (m) => bystanderEvents.push({ event: m.event, payload: m.payload }));
    const bystanderStatus = await new Promise<string>((resolve) => {
      const t = setTimeout(() => resolve("TIMEOUT"), 5000);
      bystander.subscribe((s) => {
        if (s === "SUBSCRIBED" || s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") {
          clearTimeout(t);
          resolve(s);
        }
      });
    });
    expect(la.status).toBe("SUBSCRIBED");
    expect(ls.status).toBe("SUBSCRIBED");
    expect(lo.status).not.toBe("SUBSCRIBED");
    expect(bystanderStatus).toBe("SUBSCRIBED");

    const posted = await staff.client.rpc("post_ticket_message", { p_ticket: ticketId, p_body: "Lo revisamos" });
    expect(posted.error).toBeNull();

    expect(await waitFor(la.events, 5000)).toBeGreaterThan(0);
    expect(await waitFor(ls.events, 5000)).toBeGreaterThan(0);
    await sleep(1000);
    for (const l of [la, ls]) {
      const created = l.events.filter((e) => e.event === "ticket_message_created");
      expect(created).toHaveLength(1);
      expect(created[0]!.payload).toEqual({ id: posted.data, ticket_id: ticketId });
      // a post only moves last_message_at: exactly one event per post, no extra ticket_updated
      expect(l.events.filter((e) => e.event === "ticket_updated")).toHaveLength(0);
    }

    const closed = await staff.client.rpc("set_ticket_status", { p_ticket: ticketId, p_status: "closed" });
    expect(closed.error).toBeNull();
    await sleep(2000);
    // both the author and the staff listener receive ticket_updated, ids only, once
    for (const l of [la, ls]) {
      const updated = l.events.filter((e) => e.event === "ticket_updated");
      expect(updated).toHaveLength(1);
      expect(updated[0]!.payload).toEqual({ id: ticketId, ticket_id: ticketId });
    }

    // the outsider's live socket saw nothing, and its ticket join is still not joined
    expect(bystanderEvents).toEqual([]);
    expect(lo.events).toEqual([]);
    expect(lo.ch.state).not.toBe("joined");
    await outsider.client.removeChannel(lo.ch); // denied topics must be removed
    await outsider.client.removeChannel(bystander);
    await author.client.removeChannel(la.ch);
    await staff.client.removeChannel(ls.ch);
  }, 60000);
});

describe.skipIf(up)("ticket realtime (skipped)", () => {
  it.skip(skipReason, () => {});
});
