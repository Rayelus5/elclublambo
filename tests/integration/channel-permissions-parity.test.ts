import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { computeChannelPermissions } from "@/lib/permissions/channel";
import { cases, toInput, type ParityCase } from "../fixtures/channel-cases";

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

function must<T = { id: string }>(res: { data: unknown; error: { message: string } | null }, what: string): T {
  if (res.error || res.data === null) throw new Error(`${what}: ${res.error?.message ?? "no data"}`);
  return res.data as T;
}

type Cleanup = { memberId?: string; userId?: string; roleIds: string[]; channelIds: string[] };

async function seed(db: SupabaseClient, c: ParityCase, run: string, cleanup: Cleanup) {
  const tag = `parity_${run}_${c.name}`.slice(0, 40);

  const user = await db.auth.admin.createUser({ email: `${tag}@parity.test`, email_confirm: true });
  if (user.error) throw new Error(`createUser: ${user.error.message}`);
  cleanup.userId = user.data.user.id;

  const wallet = `0x${randomBytes(20).toString("hex")}`;
  const member = must(
    await db
      .from("members")
      .insert({
        auth_user_id: user.data.user.id,
        wallet_address: wallet,
        is_bootstrap: true,
        status: c.member.active ? "active" : "banned",
      })
      .select("id")
      .single(),
    "insert member",
  );
  cleanup.memberId = member.id;

  const everyone = must(
    await db.from("roles").select("id").eq("is_everyone", true).single(),
    "everyone role",
  );

  const roleIds = new Map<string, string>();
  for (const r of c.roles) {
    const row = must(
      await db
        .from("roles")
        .insert({ name: `${tag}_${r.key}`, color: "#AAAAAA", position: 1, permissions: r.permissions })
        .select("id")
        .single(),
      "insert role",
    );
    roleIds.set(r.key, row.id);
    cleanup.roleIds.push(row.id);
  }
  for (const k of c.member.roleKeys) {
    must(
      await db.from("member_roles").insert({ member_id: member.id, role_id: roleIds.get(k)! }).select(),
      "member_roles",
    );
  }

  if (BigInt(c.member.penaltyDeny) !== 0n || BigInt(c.member.penaltyAllow ?? "0") !== 0n) {
    must(
      await db
        .from("member_permission_overrides")
        .insert({
          member_id: member.id,
          allow: c.member.penaltyAllow ?? "0",
          deny: c.member.penaltyDeny,
        })
        .select(),
      "penalty",
    );
  }

  let parent: string | null = null;
  let leaf = "";
  for (let idx = 0; idx < c.path.length; idx++) {
    const node = c.path[idx]!;
    const kind = idx === 0 ? "category" : idx === c.path.length - 1 ? "text" : "forum";
    const ch: { id: string } = must(
      await db
        .from("channels")
        .insert({ parent_id: parent, kind, name: `${node.key}_${run}` })
        .select("id")
        .single(),
      "insert channel",
    );
    cleanup.channelIds.push(ch.id);
    parent = ch.id;
    leaf = ch.id;

    const rows: Array<{ channel_id: string; target_type: string; target_id: string; allow: string; deny: string }> = [];
    if (node.everyone) {
      rows.push({ channel_id: ch.id, target_type: "role", target_id: everyone.id, ...node.everyone });
    }
    for (const r of node.roles ?? []) {
      rows.push({
        channel_id: ch.id,
        target_type: "role",
        target_id: roleIds.get(r.roleKey)!,
        allow: r.allow,
        deny: r.deny,
      });
    }
    if (node.member) {
      rows.push({ channel_id: ch.id, target_type: "member", target_id: member.id, ...node.member });
    }
    if (rows.length > 0) must(await db.from("permission_overwrites").insert(rows).select(), "overwrites");
  }
  return { memberId: member.id, channelId: leaf };
}

async function cleanupAll(db: SupabaseClient, cl: Cleanup) {
  for (const id of [...cl.channelIds].reverse()) await db.from("channels").delete().eq("id", id);
  for (const id of cl.roleIds) await db.from("roles").delete().eq("id", id);
  if (cl.memberId) await db.from("members").delete().eq("id", cl.memberId);
  if (cl.userId) await db.auth.admin.deleteUser(cl.userId);
}

describe.skipIf(!up)(`channel_permissions sql/ts parity ${up ? "" : `(skipped: ${skipReason})`}`, () => {
  const db = up
    ? createClient(url!, serviceKey!, { auth: { persistSession: false, autoRefreshToken: false } })
    : (null as unknown as SupabaseClient);
  const run = randomUUID().slice(0, 8);

  for (const c of cases) {
    it(c.name, async () => {
      const cleanup: Cleanup = { roleIds: [], channelIds: [] };
      try {
        const { memberId, channelId } = await seed(db, c, run, cleanup);
        const res = await db.rpc("channel_permissions", { p_member: memberId, p_channel: channelId });
        expect(res.error).toBeNull();
        const sql = BigInt(res.data as number);
        expect(sql).toBe(BigInt(c.expected));
        expect(computeChannelPermissions(toInput(c))).toBe(sql);
      } finally {
        await cleanupAll(db, cleanup);
      }
    });
  }

  it("returns 0 for a missing channel", async () => {
    const cleanup: Cleanup = { roleIds: [], channelIds: [] };
    try {
      const { memberId } = await seed(db, cases[0]!, run + "x", cleanup);
      const res = await db.rpc("channel_permissions", { p_member: memberId, p_channel: randomUUID() });
      expect(res.error).toBeNull();
      expect(BigInt(res.data as number)).toBe(0n);
    } finally {
      await cleanupAll(db, cleanup);
    }
  });

  afterAll(async () => {
    /* per-case cleanup already ran */
  });
});

describe.skipIf(up)("channel_permissions sql/ts parity (skipped)", () => {
  it.skip(skipReason, () => {});
});
