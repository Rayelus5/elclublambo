// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { extractMentions } from "@/lib/chat/content";
import { mentionCases, type MentionCase } from "../fixtures/mention-cases";
import { makeChannels, must, newUser, opts, serviceKey, skipReason, up, url, type Who } from "./realtime-helpers";

// The SQL side of tests/fixtures/mention-parity.json: every body goes through the real post_message RPC (no TS
// sanitizing in between, like a direct PostgREST call) and must store exactly the mentions the TS walk finds.
describe.skipIf(!up)(`mention parity: SQL _insert_mentions vs TS extractMentions ${up ? "" : `(skipped: ${skipReason})`}`, () => {
  const db = up ? createClient(url!, serviceKey!, opts) : (null as unknown as SupabaseClient);
  const channelIds: string[] = [];
  let roleId = "";
  let author: Who;
  let channel = "";
  let cases: MentionCase[] = [];

  beforeAll(async () => {
    author = await newUser(db);
    const role = must(
      await db
        .from("roles")
        .insert({ name: `t_parity_${randomUUID().slice(0, 6)}`, color: "#AAAAAA", position: 61, permissions: "0" })
        .select("id")
        .single(),
      "role",
    );
    roleId = role.id;
    [channel] = (await makeChannels(db, ["parity"], channelIds)) as [string];
    cases = mentionCases({ member: author.memberId, role: roleId });
  }, 30000);

  afterAll(async () => {
    for (const id of channelIds.reverse()) await db.from("channels").delete().eq("id", id);
    if (roleId) await db.from("roles").delete().eq("id", roleId);
  });

  it("every fixture case stores the expected mentions, and the same number the TS walk finds", async () => {
    const results: Array<{ name: string; sql: number; ts: number; expected: number; error?: string }> = [];
    for (const c of cases) {
      const res = await author.client.rpc("post_message", {
        p_channel: channel,
        p_body: c.body,
        p_body_text: "",
        p_expanded: false,
        p_thread_root: null,
        p_quoted: null,
        p_attachments: [],
      });
      let sql = -1;
      if (!res.error) {
        const rows = await db.from("message_mentions").select("kind").eq("message_id", res.data as string);
        sql = rows.data?.length ?? -1;
      }
      results.push({ name: c.name, sql, ts: extractMentions(c.body).length, expected: c.expected, error: res.error?.message });
    }
    expect(results).toEqual(results.map((r) => ({ name: r.name, sql: r.expected, ts: r.expected, expected: r.expected, error: undefined })));
  }, 60000);
});

describe.skipIf(up)("mention parity (skipped)", () => {
  it.skip(skipReason, () => {});
});
