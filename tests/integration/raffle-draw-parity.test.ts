// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { verifyDraw } from "@/lib/treasury/raffle-draw";
import fixture from "../fixtures/raffle-draw.json";
import { anon, opts, serviceKey, skipReason, up, url } from "./realtime-helpers";

// The SQL side of tests/fixtures/raffle-draw.json: every draw goes through the real raffle_draw_preview (plpgsql
// keccak256 + weighted walk) and must give exactly the commit, random and winner the TS mirror (viem) gives.
// Read-only: raffle_draw_preview is immutable and writes nothing.
describe.skipIf(!up)(`raffle draw parity: SQL raffle_draw_preview vs TS verifyDraw ${up ? "" : `(skipped: ${skipReason})`}`, () => {
  const db = up ? createClient(url!, serviceKey!, opts) : (null as unknown as SupabaseClient);

  it.each(fixture.draws)("$name matches the fixture on both sides", async (d) => {
    const { data, error } = await db.rpc("raffle_draw_preview", {
      p_seed: d.seed,
      p_block_hash: d.blockHash,
      p_weights: d.weights, // decimal strings: 10^18-scale weights must not pass through a JS number
    });
    expect(error).toBeNull();
    expect(data).toEqual({ commit: d.commit, random: d.random, winnerPosition: d.winnerPosition });

    const ts = verifyDraw({
      commit: d.commit as `0x${string}`,
      seed: d.seed as `0x${string}`,
      blockHash: d.blockHash as `0x${string}`,
      weights: d.weights.map((w) => BigInt(w)),
      winnerPosition: d.winnerPosition,
    });
    expect({ commitOk: ts.commitOk, random: ts.random.toString(), position: ts.position, winnerOk: ts.winnerOk }).toEqual({
      commitOk: true,
      random: d.random,
      position: d.winnerPosition,
      winnerOk: true,
    });
  });

  it("is not callable with the anon key", async () => {
    const a = createClient(url!, anon!, opts);
    const d = fixture.draws[0]!;
    const { data, error } = await a.rpc("raffle_draw_preview", { p_seed: d.seed, p_block_hash: d.blockHash, p_weights: d.weights });
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });
});

describe.skipIf(up)("raffle draw parity (skipped)", () => {
  it.skip(skipReason, () => {});
});
