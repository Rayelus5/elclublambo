import type { GalaxySummary, HangarView, ProbeCard, SectorCard } from '@galaxy/shared';
import { DEFAULT_CONTENT } from '@galaxy/sim';
import { levelOne } from './probe-cards';

// The hangar's view for tests (the hangar and the workshop): a new account's sectors and probes, two open relic slots.

export const galaxy = (over: Partial<GalaxySummary> = {}): GalaxySummary => ({
  id: 'g1',
  seed: '12345',
  tier: 'legendary',
  finish: 'holo',
  traits: { galaxy_type: 'spiral', arms: '3', palette: 'solar_gold', phenomenon: 'pulsar', size: 'large', core: 'bright', star_density: 'normal', background: 'deep_void' },
  name: 'Kathra',
  designation: 'GX-ABCDEF',
  featured: false,
  level: 1,
  createdAt: '2026-11-06T20:00:00Z',
  ...over,
});

/** A probe card from the default content: locked with no condition unless told otherwise. */
export const card = (id: string, over: Partial<ProbeCard> = {}): ProbeCard => {
  const p = DEFAULT_CONTENT.probes.find((x) => x.id === id)!;
  const w = DEFAULT_CONTENT.weapons.find((x) => x.id === p.weapon)!;
  return { id, name: p.name, description: p.description, sprite: p.sprite, hp: p.hp, speed: p.speed, weapon: { id: w.id, name: w.name, icon: w.icon }, quirk: p.quirk ?? null, unlocked: false, condition: null, progress: 0, ...levelOne(p), ...over };
};

// The test gave Lumen; Bastión is earned (3 runs), Chispa is one run in; the others have their conditions.
export const PROBES: ProbeCard[] = [
  card('lumen', { unlocked: true, progress: 1 }),
  card('bastion', { unlocked: true, condition: { stat: 'runs', value: 3 }, progress: 1 }),
  card('spark', { condition: { stat: 'runs', value: 3 }, progress: 1 / 3 }),
  card('sentinel', { condition: { stat: 'bossKills', value: 3 }, progress: 0 }),
  card('anchor', { condition: { stat: 'maxDepth', value: 4 }, progress: 2 / 4 }),
  card('prism', { condition: { stat: 'extractions', value: 5 }, progress: 1 / 5 }),
  card('comet', { condition: { stat: 'kills', value: 2000 }, progress: 1999 / 2000 }),
  card('echo', { condition: { stat: 'runs', value: 15 }, progress: 1 / 15 }),
];

/** A sector card from the default content: locked with no condition unless told otherwise. */
export const sectorCard = (id: string, over: Partial<SectorCard> = {}): SectorCard => {
  const sec = DEFAULT_CONTENT.sectors.find((x) => x.id === id)!;
  const boss = DEFAULT_CONTENT.bosses.find((b) => b.id === sec.boss)!;
  const fauna = [...new Set(sec.spawns.map((sp) => sp.enemy))].map((e) => DEFAULT_CONTENT.enemies.find((x) => x.id === e)!);
  return {
    id,
    name: sec.name,
    description: sec.description,
    boss: { name: boss.name, title: boss.title, sprite: boss.sprite },
    fauna: fauna.map((e) => ({ id: e.id, name: e.name, sprite: e.sprite })),
    layerSeconds: sec.layerSeconds,
    biome: sec.biome,
    unlocked: false,
    condition: null,
    progress: 0,
    season: sec.season,
    ...over,
  };
};

// A new account: the Nebulosa open, the chain closed, the season open.
export const SECTORS: SectorCard[] = [
  sectorCard('outer-nebula', { unlocked: true, progress: 1 }),
  sectorCard('frost-rings', { condition: { sector: 'outer-nebula', stat: 'bossKills', value: 1 } }),
  sectorCard('hollow-reef', { condition: { sector: 'frost-rings', stat: 'bossKills', value: 1 } }),
  sectorCard('broken-forge', { condition: { sector: 'hollow-reef', stat: 'bossKills', value: 1 } }),
  sectorCard('signal-rift', { unlocked: true, progress: 1 }),
];

export const view = (over: Partial<HangarView> = {}): HangarView => ({
  sectors: SECTORS,
  sector: 'outer-nebula',
  probes: PROBES,
  probe: 'lumen',
  test: { taken: true, probe: 'lumen' },
  slots: 2,
  maxSlots: 6,
  loadout: [null, null],
  daily: { playedSeconds: 0, fullSecondsLeft: 3 * 3600, multiplier: 1, fullHours: 3, resetsAt: '2026-11-07T23:00:00.000Z' },
  runsEnabled: true,
  nextSlot: { slot: 3, condition: { stat: 'runs', value: 5 }, progress: 0.4, dust: 100, ready: false },
  ...over,
});

