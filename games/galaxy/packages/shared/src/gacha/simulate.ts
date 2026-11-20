import { drawPull, type GachaConfig, legendaryChance, type PityState } from './rules';
import { FINISHES, type Finish, LEGENDARY, TIERS } from './types';

// The admin's gacha simulator (GDD §16.6; M6b): many pulls of a banner with a config that may not be published yet,
// so its real rates (the rising luck included) can be checked before players meet them. Pure and deterministic for a
// seed; it runs in the browser.

export interface GachaSimulation {
  pulls: number;
  /** Pulls of each tier, common to mythic. */
  tiers: number[];
  finishes: Record<Finish, number>;
  /** Average pulls per legendary (or mythic). */
  legendaryEvery: number;
  /** The most pulls in a row without a legendary (or mythic). */
  longestWithout: number;
}

const MASK = (1n << 64n) - 1n;

/**
 * The rates each tier should have in the long run (common → mythic): the mythic its own chance on every pull; a
 * legendary or a mythic once per cycle of the pity curve (a mythic resets it too), so the legendary gets that rate
 * minus the mythic's; the others share the rest in proportion.
 */
export function expectedTierRates(cfg: GachaConfig): number[] {
  const pity = cfg.standard;
  const m = cfg.mythic;
  let survive = 1;
  let expectedPulls = 0;
  for (let n = 1; n <= pity.hard && survive > 0; n++) {
    expectedPulls += survive;
    survive *= (1 - m) * (1 - legendaryChance(n, pity));
  }
  const top = 1 / expectedPulls;
  const others = cfg.tiers.base.slice(0, 4);
  const sum = others.reduce((a, b) => a + b, 0);
  return [...others.map((p) => (p / sum) * (1 - top)), top - m, m];
}

export function simulateGacha(cfg: GachaConfig, bannerId: string, pulls: number, seed: bigint): GachaSimulation {
  const banner = cfg.banners.find((b) => b.id === bannerId) ?? cfg.banners[0]!;
  let state: PityState = { sinceLegendary: 0, sinceFeatured: 0, welcome: false };
  const tiers = TIERS.map(() => 0);
  const finishes = Object.fromEntries(FINISHES.map((f) => [f, 0])) as Record<Finish, number>;
  let legendaries = 0;
  let gap = 0;
  let longest = 0;
  for (let i = 0; i < pulls; i++) {
    const pullSeed = (seed * 6364136223846793005n + BigInt(i + 1) * 1442695040888963407n) & MASK;
    const out = drawPull(pullSeed, state, banner, cfg);
    tiers[out.tier]! += 1;
    finishes[out.finish] += 1;
    gap += 1;
    if (out.tier >= LEGENDARY) {
      legendaries += 1;
      longest = Math.max(longest, gap);
      gap = 0;
    }
    state = out.state;
  }
  longest = Math.max(longest, gap);
  return { pulls, tiers, finishes, legendaryEvery: legendaries ? pulls / legendaries : pulls, longestWithout: longest };
}
