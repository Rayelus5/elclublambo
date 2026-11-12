import { TIERS, type GalaxySummary } from '@galaxy/shared';
import { activeSets, type Content, describeRelic, type RelicInput, type RelicSkill, type SetBonus } from '@galaxy/sim';
import { copy } from '../copy/es';

// What a galaxy does as a relic, in words (plan «escáner pro», part D; the owner: «se nos debe abrir otra ventana donde
// se nos explique todas las pasivas/habilidades/potenciadores que tiene dicha galaxia»). Pure: from the galaxy, the
// live content (so a retuned relic reads with its new numbers) and, when it is about to be equipped, the loadout it
// would join — stacking, sets and the echo's copy all depend on the others. Alone, it is told as the only relic.

const h = copy.hangar;
const i = h.skillInfo;
const s = h.sheet;

export type PowerKind = 'family' | 'count' | 'shape' | 'frequency' | 'element' | 'phenomenon' | 'quasar' | 'double' | 'background' | 'power';

export interface SheetPower {
  kind: PowerKind;
  /** What it is (the family's name, «4 proyectiles», «Potencia ×1,3»…). */
  name: string;
  /** What it does. */
  text: string;
  /** A note under it (the echo's copy). */
  detail?: string;
  /** Where it comes from (its trait). */
  from: string;
}

export interface SheetSet {
  key: string;
  name: string;
  description: string;
  bonus: string[];
  /** Equipping it makes this set (it was not active before). */
  fresh: boolean;
}

export interface RelicSheetModel {
  skill: RelicSkill;
  powers: SheetPower[];
  sets: SheetSet[];
  /** Relics of its family before it in the loadout, and what it yields because of them (stacking, GDD §8.6). */
  stacking: { count: number; factor: number } | null;
  /** The relic it would take the place of. */
  replaces: GalaxySummary | null;
  /** Told as the only relic (no loadout given). */
  alone: boolean;
}

export function relicInput(g: GalaxySummary): RelicInput {
  return { id: g.id, seed: g.seed, tier: TIERS.indexOf(g.tier), level: g.level, traits: g.traits };
}

function bonusLines(bonus: SetBonus): string[] {
  const out = (bonus.stats ?? []).map((b) => h.setBonus.stat(b.stat, b.value));
  if (bonus.magnitude) out.push(h.setBonus.magnitude(bonus.magnitude));
  if (bonus.background) out.push(h.setBonus.background(bonus.background));
  return out;
}

export function relicSheet(g: GalaxySummary, content: Content, opts: { loadout?: readonly (GalaxySummary | null)[]; slot?: number } = {}): RelicSheetModel {
  const placed = opts.loadout && opts.slot !== undefined;
  let all: RelicInput[];
  let before: RelicInput[] = [];
  let replaces: GalaxySummary | null = null;
  if (placed) {
    const next = opts.loadout!.map((x) => (x?.id === g.id ? null : x));
    const was = opts.loadout![opts.slot!] ?? null;
    replaces = was && was.id !== g.id ? was : null;
    next[opts.slot!] = g;
    all = next.filter((x): x is GalaxySummary => !!x).map(relicInput);
    before = opts.loadout!.filter((x): x is GalaxySummary => !!x).map(relicInput);
  } else {
    all = [relicInput(g)];
  }
  const skill = describeRelic(relicInput(g), all, content);
  const R = content.relics;
  const powers: SheetPower[] = [];

  powers.push({
    kind: 'family',
    name: h.families[skill.family],
    text: i.family[skill.family],
    from: i.from.family,
    ...(skill.family === 'echo' && skill.copies ? { detail: i.echoCopies(h.families[skill.copies]) } : {}),
  });
  if (skill.family === 'blades' || skill.family === 'ray') powers.push({ kind: 'count', name: s.countName, text: s.count(skill.count), from: s.from.count });
  if (skill.family === 'ray' || skill.family === 'aura') powers.push({ kind: 'shape', name: s.shapeName, text: s.shapes[skill.shape], from: s.from.shape });
  if (skill.frequency !== 1) powers.push({ kind: 'frequency', name: s.frequencyName, text: s.frequency(skill.frequency), from: s.from.frequency });
  if (skill.element) powers.push({ kind: 'element', name: h.elements[skill.element], text: i.element[skill.element], from: i.from.element });
  if (skill.phenomenon) powers.push({ kind: 'phenomenon', name: h.phenomena[skill.phenomenon], text: i.phenomenon[skill.phenomenon], from: i.from.phenomenon });
  if (skill.quasar) powers.push({ kind: 'quasar', name: s.quasarName, text: s.quasar(R.quasar.cooldown, R.quasar.pierce), from: s.from.core });
  if (skill.double && (skill.family === 'ray' || skill.family === 'chaos')) powers.push({ kind: 'double', name: s.doubleName, text: s.double, from: s.from.core });
  if (skill.background) {
    const bg = skill.background;
    powers.push({ kind: 'background', name: s.backgroundName, text: bg.stat === 'vision' ? s.vision(bg.value) : h.setBonus.stat(bg.stat, bg.value), from: s.from.background });
  }
  powers.push({ kind: 'power', name: h.power(skill.magnitude), text: i.power, from: i.from.power });

  // Its sets: those it is part of with this loadout, the new ones marked.
  const was = new Set(activeSets(before, content).map((x) => `${x.id}:${[...x.members].sort().join(',')}`));
  const sets: SheetSet[] = activeSets(all, content)
    .filter((x) => x.members.includes(g.id))
    .map((x) => {
      const key = `${x.id}:${[...x.members].sort().join(',')}`;
      return { key, name: x.name, description: x.description, bonus: bonusLines(x.bonus), fresh: placed ? !was.has(key) : false };
    });

  // Stacking: the relics of its family before it, in slot order.
  let stacking: RelicSheetModel['stacking'] = null;
  if (placed) {
    const familyOf = (r: RelicInput) => describeRelic(r, all, content).family;
    const at = all.findIndex((r) => r.id === g.id);
    const rank = all.slice(0, at + 1).filter((r) => familyOf(r) === skill.family).length;
    if (rank >= R.stacking.from) {
      let factor = 1;
      for (let k = R.stacking.from; k <= rank; k++) factor *= R.stacking.decay;
      stacking = { count: rank - 1, factor };
    }
  }
  return { skill, powers, sets, stacking, replaces, alone: !placed };
}
