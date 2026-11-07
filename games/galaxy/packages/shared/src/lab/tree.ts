import { STAT_KEYS, type StatBonus, type StatKey } from '@galaxy/sim';

// The Laboratorio (GDD §10.6, M4b-2): an upgrade tree with four branches, many small nodes with levels and rising
// costs, paid with star dust and components. The tree is live config (`lab`); `labEffects` turns what an account bought
// into stat bonuses for its runs (one more sim source, so the brakes of §8.6 apply) and the multipliers of the runs'
// pay, the refinery, the antenna, disintegration and fusion. Every multiplier is a fraction added (0.1 = +10 %).

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
}
export interface LabConfig {
  nodes: LabNode[];
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
): LabNode => ({ id, branch, name, effect, per, max: 5, requires, cost, growth: 1.6 });

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

export function labNodeStatus(
  n: LabNode,
  levels: Record<string, number>,
  cfg: LabConfig,
): { level: number; max: number; unlocked: boolean; next: { dust: number; components: number } | null } {
  const level = levelOf(n, levels);
  const parent = n.requires ? cfg.nodes.find((x) => x.id === n.requires) : undefined;
  const unlocked = n.requires === null || (parent !== undefined && levelOf(parent, levels) >= 1);
  return { level, max: n.max, unlocked, next: level < n.max ? labCost(n, level + 1) : null };
}

/** What an account's levels add up to; unknown nodes are ignored and levels are clipped to each node's max. */
export function labEffects(levels: Record<string, number>, cfg: LabConfig): LabEffects {
  const stats = new Map<StatKey, number>();
  const fx: LabEffects = structuredClone(NO_LAB_EFFECTS);
  for (const n of cfg.nodes) {
    const total = n.per * levelOf(n, levels);
    if (total === 0) continue;
    const e = n.effect;
    if (e.kind === 'stat') stats.set(e.stat, (stats.get(e.stat) ?? 0) + total);
    else if (e.kind === 'payout') fx.payout[e.currency] += total;
    else if (e.kind === 'refinery') fx.refinery[e.field] += total;
    else if (e.kind === 'antenna') fx.antenna += total;
    else if (e.kind === 'disintegrate') fx.disintegrate += total;
    else fx.fusion += total;
  }
  fx.bonuses = STAT_KEYS.filter((k) => stats.has(k)).map((stat) => ({ stat, value: stats.get(stat)! }));
  return fx;
}
