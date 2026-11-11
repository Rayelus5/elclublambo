import { STAT_KEYS, type StatBonus, type StatKey } from '@galaxy/sim';

// The Laboratorio (GDD §10.6, M4b-2): an upgrade tree with four branches, many small nodes with levels and rising
// costs, paid with star dust and components. The tree is live config (`lab`); `labEffects` turns what an account bought
// into stat bonuses for its runs (one more sim source, so the brakes of §8.6 apply) and the multipliers of the runs'
// pay, the refinery, the antenna, disintegration and fusion. Every multiplier is a fraction added (0.1 = +10 %).
// Two cores (shop and lab plan, F2a): the permanent tree (`nodes`) and the season's (`season`), whose levels are kept by
// season id, so each new season starts it empty. A node may give a little less with each level (`falloff`).

// The node's shape is spelled out here (the registry's `lab` schema validates exactly this; the registry imports the
// default tree from this file, so deriving the type from it would be circular).
export type LabBranch = 'probe' | 'relics' | 'station' | 'extraction';
export type LabEffect =
  | { kind: 'stat'; stat: StatKey }
  | { kind: 'payout'; currency: 'coins' | 'dust' | 'material' }
  | { kind: 'refinery'; field: 'rate' | 'queue' }
  | { kind: 'antenna' }
  | { kind: 'disintegrate' }
  | { kind: 'fusion' };
export interface LabNode {
  id: string;
  branch: LabBranch;
  name: string;
  effect: LabEffect;
  /** What each level adds (a fraction). */
  per: number;
  max: number;
  /** The node that opens it (at level 1), or null for a root. */
  requires: string | null;
  cost: { dust: number; components: number };
  growth: number;
  /** Each level adds `per × falloff^(level − 1)` (1: every level the same). */
  falloff: number;
  /** Where the whiteboard puts it, when not where the layout would (degrees round its core, ring from it). */
  at: { angle: number; ring: number } | null;
}
export interface LabConfig {
  nodes: LabNode[];
  /** The season's tree, renewed every season: only stats and pay (what a run uses). */
  season: LabNode[];
}

export interface LabEffects {
  bonuses: StatBonus[];
  payout: { coins: number; dust: number; material: number };
  refinery: { rate: number; queue: number };
  antenna: number;
  disintegrate: number;
  fusion: number;
}

export const NO_LAB_EFFECTS: LabEffects = { bonuses: [], payout: { coins: 0, dust: 0, material: 0 }, refinery: { rate: 0, queue: 0 }, antenna: 0, disintegrate: 0, fusion: 0 };

const node = (
  id: string,
  branch: LabBranch,
  name: string,
  effect: LabNode['effect'],
  per: number,
  requires: string | null,
  cost: { dust: number; components: number },
): LabNode => ({ id, branch, name, effect, per, max: 5, requires, cost, growth: 1.6, falloff: 1, at: null });

const ROOT = { dust: 40, components: 15 };
const MID = { dust: 60, components: 20 };
const DEEP = { dust: 100, components: 40 };

/** The default tree: four branches of four nodes, a root, two children and one deeper node. */
export const DEFAULT_LAB_NODES: LabNode[] = [
  node('hull', 'probe', 'Blindaje reforzado', { kind: 'stat', stat: 'maxHp' }, 0.02, null, ROOT),
  node('thrusters', 'probe', 'Propulsores', { kind: 'stat', stat: 'speed' }, 0.01, 'hull', MID),
  node('targeting', 'probe', 'Puntería', { kind: 'stat', stat: 'damage' }, 0.02, 'hull', MID),
  node('reactor', 'probe', 'Reactor', { kind: 'stat', stat: 'cooldown' }, 0.01, 'targeting', DEEP),
  node('resonance', 'relics', 'Resonancia', { kind: 'stat', stat: 'elemental' }, 0.03, null, ROOT),
  node('fortune', 'relics', 'Fortuna', { kind: 'stat', stat: 'luck' }, 0.03, 'resonance', MID),
  node('recycling', 'relics', 'Reciclaje', { kind: 'disintegrate' }, 0.04, 'resonance', MID),
  node('stable-fusion', 'relics', 'Fusión estable', { kind: 'fusion' }, 0.04, 'recycling', DEEP),
  node('throughput', 'station', 'Caudal', { kind: 'refinery', field: 'rate' }, 0.05, null, ROOT),
  node('silos', 'station', 'Silos', { kind: 'refinery', field: 'queue' }, 0.1, 'throughput', MID),
  node('receiver', 'station', 'Receptor', { kind: 'antenna' }, 0.05, 'throughput', MID),
  node('salvage', 'station', 'Chatarrería', { kind: 'payout', currency: 'material' }, 0.04, 'silos', DEEP),
  node('magnet', 'extraction', 'Imán', { kind: 'stat', stat: 'pickup' }, 0.04, null, ROOT),
  node('ledger', 'extraction', 'Contabilidad', { kind: 'payout', currency: 'coins' }, 0.02, 'magnet', MID),
  node('sieve', 'extraction', 'Tamiz', { kind: 'payout', currency: 'dust' }, 0.02, 'magnet', MID),
  node('study', 'extraction', 'Estudio', { kind: 'stat', stat: 'xp' }, 0.02, 'ledger', DEEP),
];

/** What reaching `level` of a node costs: its base cost times growth^(level − 1), rounded. */
export function labCost(n: LabNode, level: number): { dust: number; components: number } {
  const f = n.growth ** (Math.max(1, level) - 1);
  return { dust: Math.round(n.cost.dust * f), components: Math.round(n.cost.components * f) };
}

const levelOf = (n: LabNode, levels: Record<string, number>) => Math.max(0, Math.min(n.max, Math.floor(levels[n.id] ?? 0)));

/** What a node gives at `level`: each level adds `per × falloff^(i)` for i from 0 (so falloff 1 is `per × level`). */
export function nodeTotal(n: Pick<LabNode, 'per' | 'falloff' | 'max'>, level: number): number {
  const l = Math.max(0, Math.min(n.max, Math.floor(level)));
  if (n.falloff === 1) return n.per * l;
  return (n.per * (1 - n.falloff ** l)) / (1 - n.falloff);
}

/** What the next level adds (0 at the top). */
export function nodeNextGain(n: Pick<LabNode, 'per' | 'falloff' | 'max'>, level: number): number {
  return level >= n.max ? 0 : n.per * n.falloff ** Math.max(0, Math.floor(level));
}

/** A node's state among the nodes of its own tree (a requirement is always in the same tree). */
export function labNodeStatus(
  n: LabNode,
  levels: Record<string, number>,
  tree: readonly LabNode[] | LabConfig,
): { level: number; max: number; unlocked: boolean; next: { dust: number; components: number } | null } {
  const nodes = 'nodes' in tree ? tree.nodes : tree;
  const level = levelOf(n, levels);
  const parent = n.requires ? nodes.find((x) => x.id === n.requires) : undefined;
  const unlocked = n.requires === null || (parent !== undefined && levelOf(parent, levels) >= 1);
  return { level, max: n.max, unlocked, next: level < n.max ? labCost(n, level + 1) : null };
}

/** One tree's levels into the totals; stat totals are returned by stat (one bonus per tree, the sim diminishes both). */
function addTree(fx: LabEffects, nodes: readonly LabNode[], levels: Record<string, number>): Map<StatKey, number> {
  const stats = new Map<StatKey, number>();
  for (const n of nodes) {
    const total = nodeTotal(n, levelOf(n, levels));
    if (total === 0) continue;
    const e = n.effect;
    if (e.kind === 'stat') stats.set(e.stat, (stats.get(e.stat) ?? 0) + total);
    else if (e.kind === 'payout') fx.payout[e.currency] += total;
    else if (e.kind === 'refinery') fx.refinery[e.field] += total;
    else if (e.kind === 'antenna') fx.antenna += total;
    else if (e.kind === 'disintegrate') fx.disintegrate += total;
    else fx.fusion += total;
  }
  return stats;
}

/**
 * What an account's levels add up to; unknown nodes are ignored and levels are clipped to each node's max. The
 * season's levels count only while a season is open (null: none, or not asked): its stat bonuses come apart from the
 * permanent ones, as another source.
 */
export function labEffects(levels: Record<string, number>, cfg: Pick<LabConfig, 'nodes'> & Partial<Pick<LabConfig, 'season'>>, seasonLevels: Record<string, number> | null = null): LabEffects {
  const fx: LabEffects = structuredClone(NO_LAB_EFFECTS);
  const permanent = addTree(fx, cfg.nodes, levels);
  const season = seasonLevels ? addTree(fx, cfg.season ?? [], seasonLevels) : new Map<StatKey, number>();
  for (const stats of [permanent, season]) {
    for (const stat of STAT_KEYS) if (stats.has(stat)) fx.bonuses.push({ stat, value: stats.get(stat)! });
  }
  return fx;
}
