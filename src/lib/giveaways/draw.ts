// Verifiable giveaway draw (P1-R10), the TS mirror of draw_giveaway in supabase/migrations/20261024200006_giveaways.sql
// (the SQL result is the one that counts; this powers the public verifier). Isomorphic: it runs in the browser.
// Both sides are pinned by tests/fixtures/giveaway-draw.json and tests/integration/giveaway-draw-parity.test.ts.
//   commit     = keccak256(seed)                          seed: 32 bytes, revealed at the draw
//   randomness = sha256(drand signature)                  32 bytes
//   L          = [1 .. n]                                  entry positions
//   r_1        = keccak256(seed ‖ randomness)             64 bytes in
//   prize k = 1 .. m (by rank): i = uint256_be(r_k) mod len(L); the winner is L[i], removed from L (order kept);
//                               r_{k+1} = keccak256(r_k). With L empty the remaining prizes go to nobody.
import { concat, hexToBigInt, keccak256, sha256, type Hex } from "viem";
import { targetRound, verifyBeacon } from "@/lib/giveaways/drand";

const BYTES32 = /^0x[0-9a-f]{64}$/i;
const MAX_PRIZES = 10;

function bytes32(value: string, what: string): Hex {
  const hex = value.startsWith("0x") || value.startsWith("0X") ? `0x${value.slice(2)}` : `0x${value}`;
  if (!BYTES32.test(hex)) throw new Error(`${what} must be 32 bytes of hex`);
  return hex.toLowerCase() as Hex;
}

export function giveawayCommit(seedHex: Hex): Hex {
  return keccak256(bytes32(seedHex, "seed"));
}

/**
 * The winning entry positions (1-based) by prize rank: no repeats, at most min(entryCount, prizeCount). Throws on a
 * malformed seed or randomness (with or without 0x) or counts out of range.
 */
export function drawWinners(seedHex: Hex, randomnessHex: string, entryCount: number, prizeCount: number): number[] {
  const seed = bytes32(seedHex, "seed");
  const randomness = bytes32(randomnessHex, "randomness");
  if (!Number.isSafeInteger(entryCount) || entryCount < 0) throw new Error("entryCount must be a non-negative integer");
  if (!Number.isSafeInteger(prizeCount) || prizeCount < 0 || prizeCount > MAX_PRIZES) throw new Error("prizeCount must be 0..10");

  const remaining = Array.from({ length: entryCount }, (_, i) => i + 1);
  const winners: number[] = [];
  let r = keccak256(concat([seed, randomness]));
  for (let k = 0; k < prizeCount && remaining.length > 0; k++) {
    const i = Number(hexToBigInt(r) % BigInt(remaining.length));
    winners.push(remaining.splice(i, 1)[0]!);
    r = keccak256(r);
  }
  return winners;
}

/** roundOk: the round is targetRound(closesAt), the first drand round after the close (true when closesAt is not given). */
export type GiveawayCheck = { commitOk: boolean; roundOk: boolean; beaconOk: boolean; winnersOk: boolean; winners: number[] };

/**
 * Recomputes a drawn giveaway from its public inputs. `winnerPositions` is the claimed winning position of each prize
 * by rank (null for a prize left without entries); a prize whose role became unavailable still has its position.
 * `randomness`, when given, must equal sha256(signature). `closesAt`, when given, pins the round: it must be
 * targetRound(closesAt), so nobody could pick a later round after seeing it. Never throws.
 */
export function verifyGiveaway(input: {
  commit: string;
  seedReveal: Hex;
  round: bigint;
  signature: string;
  randomness?: string | null;
  entryCount: number;
  winnerPositions: readonly (number | null)[];
  publicKey?: string;
  closesAt?: string | Date;
}): GiveawayCheck {
  let commitOk = false;
  try {
    commitOk = giveawayCommit(input.seedReveal) === input.commit.toLowerCase();
  } catch {
    commitOk = false;
  }

  let roundOk = true;
  if (input.closesAt !== undefined) {
    const close = new Date(input.closesAt);
    roundOk = Number.isFinite(close.getTime()) && targetRound(close) === input.round;
  }

  const claimed = input.randomness == null ? null : input.randomness.replace(/^0x/i, "").toLowerCase();
  const beacon = verifyBeacon(input.round, input.signature, input.publicKey);
  const beaconOk = beacon.ok && (claimed === null || claimed === beacon.randomness);
  // The winners follow sha256(signature) even when the BLS check fails, so each check stands on its own.
  const sig = typeof input.signature === "string" ? input.signature.replace(/^0x/i, "").toLowerCase() : "";
  const randomness = beacon.ok ? beacon.randomness : /^[0-9a-f]{96}$/.test(sig) ? sha256(`0x${sig}`).slice(2) : claimed;

  let winners: number[] = [];
  let winnersOk = false;
  if (randomness) {
    try {
      winners = drawWinners(input.seedReveal, randomness, input.entryCount, input.winnerPositions.length);
      winnersOk = input.winnerPositions.every((w, k) => w === (winners[k] ?? null));
    } catch {
      winners = [];
      winnersOk = false;
    }
  }
  return { commitOk, roundOk, beaconOk, winnersOk, winners };
}
