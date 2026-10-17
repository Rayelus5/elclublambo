// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { doc, makeChannels, must, newUser, opts, serviceKey, skipReason, up, url } from "./realtime-helpers";

// The chat-images policies through the real Storage API (F2b final fixes): the uploader can upload (INSERT ... RETURNING
// needs the SELECT policy too) and read a draft; another viewer of the channel reads the object only once a message
// they can view references it.
describe.skipIf(!up)(`chat-images storage policies ${up ? "" : `(skipped: ${skipReason})`}`, () => {
  const db = up ? createClient(url!, serviceKey!, opts) : (null as unknown as SupabaseClient);
  const channelIds: string[] = [];
  const paths: string[] = [];
  let roleId: string | null = null;

  afterAll(async () => {
    if (paths.length > 0) await db.storage.from("chat-images").remove(paths);
    for (const id of channelIds.reverse()) await db.from("channels").delete().eq("id", id);
    if (roleId) await db.from("roles").delete().eq("id", roleId);
  });

  // 1x1 transparent PNG
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  );

  it("uploader uploads and reads the draft; another viewer only reads it once it is posted", async () => {
    const a = await newUser(db);
    const b = await newUser(db);
    const role = must(
      await db
        .from("roles")
        .insert({ name: `t_attach_${randomUUID().slice(0, 6)}`, color: "#AAAAAA", position: 60, permissions: "1024" })
        .select("id")
        .single(),
      "role",
    );
    roleId = role.id;
    must(await db.from("member_roles").insert({ member_id: a.memberId, role_id: role.id }).select(), "grant");
    const [channel] = await makeChannels(db, ["storage"], channelIds);

    const path = `${channel}/${a.memberId}/${randomUUID()}.png`;
    paths.push(path);
    const up1 = await a.client.storage.from("chat-images").upload(path, png, { contentType: "image/png" });
    expect(up1.error).toBeNull();

    const own = await a.client.storage.from("chat-images").createSignedUrl(path, 60);
    expect(own.error).toBeNull();
    const draft = await b.client.storage.from("chat-images").createSignedUrl(path, 60);
    expect(draft.data?.signedUrl ?? null).toBeNull();
    expect(draft.error).not.toBeNull();

    const posted = await a.client.rpc("post_message", {
      p_channel: channel,
      p_body: doc("con imagen"),
      p_body_text: "con imagen",
      p_expanded: false,
      p_thread_root: null,
      p_quoted: null,
      p_attachments: [{ path, mime: "image/png", size: png.length, width: 1, height: 1 }],
    });
    expect(posted.error).toBeNull();

    const shared = await b.client.storage.from("chat-images").createSignedUrl(path, 60);
    expect(shared.error).toBeNull();
    const res = await fetch(shared.data!.signedUrl);
    expect(res.status).toBe(200);
  }, 30000);
});

describe.skipIf(up)("chat-images storage policies (skipped)", () => {
  it.skip(skipReason, () => {});
});
