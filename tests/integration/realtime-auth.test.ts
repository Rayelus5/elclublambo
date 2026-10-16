// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it, afterAll } from "vitest";
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { buildLoginMessage, generateNonce } from "@/lib/web3/siwe";

try {
  process.loadEnvFile(".env.local");
} catch {
  /* env may come from the shell */
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function reachable(): Promise<boolean> {
  if (!url || !anon || !serviceKey) return false;
  try {
    const r = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: anon },
      signal: AbortSignal.timeout(2000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

const up = await reachable();
const skipReason = "Supabase local is not reachable (run `pnpm db:start`)";

const opts = { auth: { persistSession: false, autoRefreshToken: false } };

function must<T = { id: string }>(res: { data: unknown; error: { message: string } | null }, what: string): T {
  if (res.error || res.data === null) throw new Error(`${what}: ${res.error?.message ?? "no data"}`);
  return res.data as T;
}

type Who = { client: SupabaseClient; memberId: string };

async function newUser(db: SupabaseClient): Promise<Who> {
  const account = privateKeyToAccount(generatePrivateKey());
  const message = buildLoginMessage({
    address: account.address,
    chainId: 59141,
    nonce: generateNonce(),
    domain: "localhost:3000",
    uri: "http://localhost:3000/login",
  });
  const signature = await account.signMessage({ message });
  const client = createClient(url!, anon!, opts);
  const res = await client.auth.signInWithWeb3({ chain: "ethereum", message, signature });
  if (res.error || !res.data.session) throw new Error(`signin: ${res.error?.message}`);
  const member = must(
    await db
      .from("members")
      .insert({
        auth_user_id: res.data.user!.id,
        wallet_address: account.address.toLowerCase(),
        is_bootstrap: true,
        status: "active",
      })
      .select("id")
      .single(),
    "insert member",
  );
  // Make realtime use this user's JWT for authorization.
  await client.realtime.setAuth(res.data.session.access_token);
  return { client, memberId: member.id };
}

/** Subscribes privately; resolves with status and collected events. */
async function listen(who: Who, channelId: string) {
  const events: Array<{ event: string; payload: unknown }> = [];
  const ch: RealtimeChannel = who.client.channel(`channel:${channelId}`, { config: { private: true } });
  ch.on("broadcast", { event: "message_created" }, (m) => events.push({ event: m.event, payload: m.payload }));
  const status = await new Promise<string>((resolve) => {
    const t = setTimeout(() => resolve("TIMEOUT"), 5000);
    ch.subscribe((s, err) => {
      if (s === "SUBSCRIBED" || s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") {
        clearTimeout(t);
        resolve(err ? `${s}: ${err.message}` : s);
      }
    });
  });
  return { ch, events, status };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(events: unknown[], ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end && events.length === 0) await sleep(100);
  return events.length;
}

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
    const everyone = must(await db.from("roles").select("id").eq("is_everyone", true).single(), "everyone");
    void everyone;
    const cat = must(
      await db.from("channels").insert({ kind: "category", name: `spike_cat_${randomUUID().slice(0, 6)}` }).select("id").single(),
      "category",
    );
    channelIds.push(cat.id);
    const mk = async (name: string) => {
      const ch = must(
        await db
          .from("channels")
          .insert({ parent_id: cat.id, kind: "text", name: `${name}_${randomUUID().slice(0, 6)}` })
          .select("id")
          .single(),
        "channel",
      );
      return ch.id;
    };
    const visible = await mk("spike_visible");
    const hiddenForB = await mk("spike_hidden");
    // Members here are bootstrap (see seed helper), so deny B via member overwrite on hidden channel.
    must(
      await db
        .from("permission_overwrites")
        .insert({ channel_id: hiddenForB, target_type: "member", target_id: b.memberId, allow: "0", deny: "1" })
        .select(),
      "deny overwrite",
    );
    return { a, b, visible, hiddenForB };
  }

  const emit = async (channel: string) => {
    const r = await db.rpc("_spike_emit", { p_channel: channel });
    expect(r.error).toBeNull();
  };

  it("member who can view receives; member who cannot view does not", async () => {
    const { a, b, hiddenForB } = await setup();
    const la = await listen(a, hiddenForB);
    const lb = await listen(b, hiddenForB);
    open.push(la.ch, lb.ch);
    console.log("[spike] A status:", la.status, "| B (denied) status:", lb.status);
    expect(la.status).toBe("SUBSCRIBED");
    await emit(hiddenForB);
    expect(await waitFor(la.events, 3000)).toBeGreaterThan(0);
    expect(la.events[0]!.payload).toMatchObject({ channel_id: hiddenForB });
    await sleep(3000);
    expect(lb.events.length).toBe(0);
  }, 30000);

  it("B subscribing to a visible channel receives", async () => {
    const { b, visible } = await setup();
    const lb = await listen(b, visible);
    open.push(lb.ch);
    expect(lb.status).toBe("SUBSCRIBED");
    await emit(visible);
    expect(await waitFor(lb.events, 3000)).toBeGreaterThan(0);
  }, 30000);

  it("observes: losing VIEW while subscribed (not asserted)", async () => {
    const { a, visible } = await setup();
    const la = await listen(a, visible);
    open.push(la.ch);
    expect(la.status).toBe("SUBSCRIBED");
    await emit(visible);
    expect(await waitFor(la.events, 3000)).toBeGreaterThan(0);
    must(
      await db
        .from("permission_overwrites")
        .insert({ channel_id: visible, target_type: "member", target_id: a.memberId, allow: "0", deny: "1" })
        .select(),
      "revoke",
    );
    la.events.length = 0;
    await emit(visible);
    const still = await waitFor(la.events, 3000);
    console.log("[spike] after VIEW revoked, same subscription received:", still > 0);
    // Resubscribe: must now be denied.
    await la.ch.unsubscribe();
    const again = await listen(a, visible);
    open.push(again.ch);
    console.log("[spike] resubscribe status after revoke:", again.status);
    await emit(visible);
    const afterResub = await waitFor(again.events, 3000);
    console.log("[spike] resubscribed after revoke received:", afterResub > 0);
    expect(afterResub).toBe(0);
  }, 40000);
});

describe.skipIf(up)("private realtime broadcast authorization (skipped)", () => {
  it.skip(skipReason, () => {});
});
