// Verifiable raffle draw, the TS mirror of the SQL in 20261019400001_raffle_draw_math.sql (the SQL result is the
// one that counts; this powers the public verifier). Isomorphic on purpose: no server-only, it runs in the browser.
// Both sides are pinned by tests/fixtures/raffle-draw.json.
//   commit = keccak256(seed)                                   seed: 32 bytes
//   random = uint256(keccak256(seed ‖ drawBlockHash))           64 bytes in, read big-endian
//   r      = random mod total weight
//   winner = first 1-based position whose running sum of weights is > r (weight 0 never wins; total 0 → null)
import { concat, hexToBigInt, keccak256, type Hex } from "viem";

export function raffleCommit(seed: Hex): Hex {
  return keccak256(seed);
}

export function raffleRandom(seed: Hex, blockHash: Hex): bigint {
  return hexToBigInt(keccak256(concat([seed, blockHash])));
}

export function pickWinner(random: bigint, weights: readonly bigint[]): number | null {
  const total = weights.reduce((a, w) => a + w, 0n);
  if (total <= 0n) return null;
  const r = random % total;
  let sum = 0n;
  for (let i = 0; i < weights.length; i++) {
    sum += weights[i]!;
    if (sum > r) return i + 1;
  }
  return null;
}

export type DrawCheck = {
  commitOk: boolean;
  random: bigint;
  total: bigint;
  r: bigint;
  position: number | null;
  winnerOk: boolean;
};

export function verifyDraw(i: {
  commit: Hex;
  seed: Hex;
  blockHash: Hex;
  weights: readonly bigint[];
  winnerPosition: number | null;
}): DrawCheck {
  const commitOk = raffleCommit(i.seed).toLowerCase() === i.commit.toLowerCase();
  const random = raffleRandom(i.seed, i.blockHash);
  const total = i.weights.reduce((a, w) => a + w, 0n);
  const r = total > 0n ? random % total : 0n;
  const position = pickWinner(random, i.weights);
  return { commitOk, random, total, r, position, winnerOk: position === i.winnerPosition };
}
