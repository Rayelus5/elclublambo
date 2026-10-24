// @vitest-environment node
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Hex } from "viem";
import { drawWinners, verifyGiveaway } from "@/lib/giveaways/draw";
import fixture from "../fixtures/giveaway-draw.json";
import { must, newUser, opts, serviceKey, skipReason, up, url, type Who } from "./realtime-helpers";

// The SQL side of the giveaway draw (P1-R10): real giveaways go through create_giveaway (random secret seed),
// close_due_giveaways and draw_giveaway with drand round 1000, and the winners SQL stored must be exactly what the TS
// mirror (drawWinners / verifyGiveaway, the public verifier) computes from the revealed seed. The fixture seed itself
// is pinned on the SQL side by supabase/tests/p1_06_giveaways.test.sql (G1 -> fixture.expectedWinners).
// Writes to the local database (giveaways, members, a role); everything it creates is removed afterwards.
describe.skipIf(!up)(`giveaway draw parity: SQL draw_giveaway vs TS drawWinners ${up ? "" : `(skipped: ${skipReason})`}`, () => {
  const db = up ? createClient(url!, serviceKey!, opts) : (null as unknown as SupabaseClient);
  const run = randomUUID().slice(0, 8);
  const created = { giveaways: [] as string[], members: [] as string[], users: [] as string[], roles: [] as string[] };
  let treasurer: Who;
  const entrants: string[] = [];

  beforeAll(async () => {
    treasurer = await newUser(db);
    created.members.push(treasurer.memberId);
    const role = must(
      await db.from("roles").insert({ name: `gw_parity_${run}`, color: "#AAAAAA", position: 1, permissions: 256 }).select("id").single(),
      "insert treasurer role",
    );
    created.roles.push(role.id);
    must(await db.from("member_roles").insert({ member_id: treasurer.memberId, role_id: role.id }).select("member_id").single<{ member_id: string }>(), "grant role");

    for (let i = 0; i < 12; i++) {
      const user = await db.auth.admin.createUser({ email: `gw_parity_${run}_${i}@parity.test`, email_confirm: true });
      if (user.error) throw new Error(`createUser: ${user.error.message}`);
      created.users.push(user.data.user.id);
      const m = must(
        await db
          .from("members")
          .insert({ auth_user_id: user.data.user.id, wallet_address: `0x${randomBytes(20).toString("hex")}`, is_bootstrap: true, status: "active" })
          .select("id")
          .single(),
        "insert member",
      );
      created.members.push(m.id);
      entrants.push(m.id);
    }
  }, 60_000);

  afterAll(async () => {
    if (!up) return;
    // best effort: audit rows may keep a member referenced
    for (const id of created.giveaways) await db.from("giveaways").delete().eq("id", id);
    for (const id of created.roles) await db.from("roles").delete().eq("id", id);
    for (const id of created.members) await db.from("members").delete().eq("id", id);
    for (const id of created.users) await db.auth.admin.deleteUser(id);
  });

  async function drawGiveaway(entries: number, prizes: number) {
    const closesAt = new Date(Date.now() + 3_600_000).toISOString();
    const res = await treasurer.client.rpc("create_giveaway", {
      p_title: `Paridad ${run} ${entries}x${prizes}`,
      p_description: null,
      p_closes_at: closesAt,
      p_prizes: Array.from({ length: prizes }, (_, k) => ({ kind: "custom", label: `Premio ${k + 1}` })),
    });
    expect(res.error).toBeNull();
    const id = (res.data as { id: string }).id;
    created.giveaways.push(id);

    // entries in a known order (positions follow entered_at), then the close moved to the past and the target round to
    // 1000 (the real fixture round): only service-role writes, the draw itself is the production code path
    const t0 = Date.now() - 3_600_000;
    const rows = entrants.slice(0, entries).map((member_id, i) => ({ giveaway_id: id, member_id, entered_at: new Date(t0 + i * 1000).toISOString() }));
    if (rows.length) expect((await db.from("giveaway_entries").insert(rows)).error).toBeNull();
    expect((await db.from("giveaways").update({ closes_at: new Date(Date.now() - 60_000).toISOString(), target_round: fixture.round }).eq("id", id)).error).toBeNull();
    expect((await db.rpc("close_due_giveaways")).error).toBeNull();
    const drawn = await db.rpc("draw_giveaway", { p_id: id, p_round: fixture.round, p_signature: fixture.signature });
    expect(drawn.error).toBeNull();
    expect(drawn.data).toEqual({ status: "drawn" });

    const g = must<{ seed_commit: string; seed_reveal: string; drand_randomness: string; entry_count: number }>(
      await db.from("giveaways").select("seed_commit, seed_reveal, drand_randomness, entry_count").eq("id", id).single(),
      "read giveaway",
    );
    const p = must<{ rank: number; winner_position: number | null }[]>(
      await db.from("giveaway_prizes").select("rank, winner_position").eq("giveaway_id", id).order("rank"),
      "read prizes",
    );
    return { g, positions: p.map((x) => x.winner_position) };
  }

  it.each([
    [7, 3],
    [2, 3],
    [12, 10],
    [1, 1],
  ])("%i entries, %i prizes: SQL winners = TS winners, and the public verifier agrees", async (entries, prizes) => {
    const { g, positions } = await drawGiveaway(entries, prizes);
    expect(g.entry_count).toBe(entries);
    expect(g.drand_randomness).toBe(fixture.randomness);
    const ts = drawWinners(g.seed_reveal as Hex, g.drand_randomness, entries, prizes);
    expect(positions).toEqual(Array.from({ length: prizes }, (_, k) => ts[k] ?? null));
    expect(
      verifyGiveaway({
        commit: g.seed_commit,
        seedReveal: g.seed_reveal as Hex,
        round: BigInt(fixture.round),
        signature: fixture.signature,
        randomness: g.drand_randomness,
        entryCount: g.entry_count,
        winnerPositions: positions,
      }),
    ).toEqual({ commitOk: true, roundOk: true, beaconOk: true, winnersOk: true, winners: ts });
  }, 30_000);

  it("the fixture's expected winners are what TS computes (SQL pins the same seed in p1_06)", () => {
    expect(drawWinners(fixture.seedHex as Hex, fixture.randomness, fixture.entryCount, fixture.prizeCount)).toEqual(fixture.expectedWinners);
  });
});

describe.skipIf(up)("giveaway draw parity (skipped)", () => {
  it.skip(skipReason, () => {});
});
