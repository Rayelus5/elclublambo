import { randomUUID } from "node:crypto";
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { buildLoginMessage, generateNonce } from "@/lib/web3/siwe";

try {
  process.loadEnvFile(".env.local");
} catch {
  /* env may come from the shell */
}

export const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

export const up = await reachable();
export const skipReason = "Supabase local is not reachable (run `pnpm db:start`)";

export const opts = { auth: { persistSession: false, autoRefreshToken: false } };

export function must<T = { id: string }>(res: { data: unknown; error: { message: string } | null }, what: string): T {
  if (res.error || res.data === null) throw new Error(`${what}: ${res.error?.message ?? "no data"}`);
  return res.data as T;
}

export type Who = { client: SupabaseClient; memberId: string };

/** Signs a fresh wallet user in, makes it an active bootstrap member and points realtime at its JWT. */
export async function newUser(db: SupabaseClient): Promise<Who> {
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
  await client.realtime.setAuth(res.data.session.access_token);
  return { client, memberId: member.id };
}

/** Subscribes privately to a channel topic; resolves with the status and every broadcast event received. */
export async function listen(who: Who, channelId: string, timeoutMs = 5000) {
  const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const ch: RealtimeChannel = who.client.channel(`channel:${channelId}`, { config: { private: true } });
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

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(events: unknown[], ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end && events.length === 0) await sleep(100);
  return events.length;
}

export function doc(text: string) {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

/** Creates a category with one text channel per name; returns channel ids (category id is tracked for cleanup). */
export async function makeChannels(db: SupabaseClient, names: string[], cleanup: string[]) {
  const cat = must(
    await db.from("channels").insert({ kind: "category", name: `rt_cat_${randomUUID().slice(0, 6)}` }).select("id").single(),
    "category",
  );
  cleanup.push(cat.id);
  const ids: string[] = [];
  for (const name of names) {
    const ch = must(
      await db
        .from("channels")
        .insert({ parent_id: cat.id, kind: "text", name: `${name}_${randomUUID().slice(0, 6)}` })
        .select("id")
        .single(),
      "channel",
    );
    ids.push(ch.id);
  }
  return ids;
}

export async function denyView(db: SupabaseClient, channelId: string, memberId: string) {
  must(
    await db
      .from("permission_overwrites")
      .insert({ channel_id: channelId, target_type: "member", target_id: memberId, allow: "0", deny: "1" })
      .select(),
    "deny overwrite",
  );
}
