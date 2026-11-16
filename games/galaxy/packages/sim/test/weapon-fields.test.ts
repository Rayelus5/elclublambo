import { describe, expect, test } from 'vitest';
import { IDLE, type ProbeInput, spawnEnemy, step, WEAPON_FIELDS, WEAPON_KINDS, type WeaponKind, type WeaponLevel } from '../src/index';
import { quietSim } from './fixtures';

// Which of a level's numbers each kind of weapon reads (the content editor, 2026-11-16, P6): the level table dims the
// rest, so an admin knows which numbers matter. Proved both ways: changing a number the map leaves out changes nothing
// in a run, and changing one it lists changes something — the probe circling among moving and still targets, every
// frame compared.

const LEVEL: WeaponLevel = { damage: 5, cooldown: 0.5, count: 2, pierce: 1, speed: 180, area: 30, duration: 1.5, range: 150, bounces: 2, knockback: 20, interval: 0.3 };
const FIELDS = Object.keys(LEVEL) as (keyof WeaponLevel)[];

/**
 * Numbers a kind reads that this scenario cannot show (its chasers always come close): the homing, mine, field and
 * turret searches (systems/arsenal.ts), the drone's (weapons.ts), the harpoon's reel speed and the mortar's bomblet
 * warning (arsenal-nov.ts).
 */
const BLIND: Partial<Record<WeaponKind, (keyof WeaponLevel)[]>> = {
  drone: ['range'],
  homing: ['range'],
  mine: ['range'],
  field: ['range'],
  turret: ['range'],
  harpoon: ['knockback'],
  mortar: ['interval'],
};

/** Everything a run shows of the weapon at work, tick after tick. */
function fingerprint(kind: WeaponKind, level: WeaponLevel): string {
  const sim = quietSim((c) => {
    c.weapons.push({ id: 'probe-weapon', name: 'Prueba', kind, icon: 'icon-pulse', description: 'x', levels: [level] });
    const dummy = c.enemies.find((e) => e.id === 'dummy')!;
    dummy.hp = 1_000_000;
    dummy.speed = 25;
    // Posts that never move, farther out: where a lobbed or long weapon lands.
    c.enemies.push({ ...dummy, id: 'post', speed: 0 });
  });
  sim.rng.combat.chance = () => false;
  sim.probes[0]!.weapons = [{ id: 'probe-weapon', level: 1, t: 0 }];
  const dummy = sim.content.enemies.find((e) => e.id === 'dummy')!;
  const post = sim.content.enemies.find((e) => e.id === 'post')!;
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const r = 40 + (k % 4) * 35;
    spawnEnemy(sim, dummy, Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r));
    spawnEnemy(sim, post, Math.round(Math.cos(a) * (130 + (k % 3) * 25)), Math.round(Math.sin(a) * (130 + (k % 3) * 25)));
  }
  const frames: string[] = [];
  for (let i = 0; i < 480; i++) {
    const turn = (i / 120) * Math.PI * 2;
    const input: ProbeInput = { ...IDLE, mx: Math.cos(turn), my: Math.sin(turn), aim: Math.round((turn / (Math.PI * 2)) * 256) & 255 };
    step(sim, [input]);
    const en = sim.enemies;
    let row = '';
    for (let e = 0; e < en.top; e++) row += `${en.alive[e]}:${Math.round(en.hp[e]!)}:${Math.round(en.x[e]!)}:${Math.round(en.y[e]!)};`;
    frames.push(row + sim.events.length);
  }
  return frames.join('|');
}

describe.each(WEAPON_KINDS.map((k) => [k]))('%s', (kind) => {
  test('los números que no usa no cambian nada', () => {
    const base = fingerprint(kind, LEVEL);
    const unused = FIELDS.filter((f) => !WEAPON_FIELDS[kind].includes(f));
    const moved = unused.filter((f) => fingerprint(kind, { ...LEVEL, [f]: LEVEL[f] * 2 + 1 }) !== base);
    expect(moved, `${kind} usa también`).toEqual([]);
  });

  test('cada número que lista cambia algo', () => {
    const base = fingerprint(kind, LEVEL);
    expect(WEAPON_FIELDS[kind]).toContain('damage');
    // More or less of it: a range that already reaches everyone matters when it shrinks.
    const idle = WEAPON_FIELDS[kind].filter(
      (f) => !BLIND[kind]?.includes(f) && fingerprint(kind, { ...LEVEL, [f]: LEVEL[f] * 2 + 1 }) === base && fingerprint(kind, { ...LEVEL, [f]: LEVEL[f] * 0.3 }) === base,
    );
    expect(idle, `${kind} no usa`).toEqual([]);
  });
});
