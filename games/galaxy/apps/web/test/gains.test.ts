import { DEFAULT_CONTENT, type Offer } from '@galaxy/sim';
import { expect, test } from 'vitest';
import { gainLines, gainRows, offerGains } from '../src/arena/hud/gains';

// What a level-up gives (the owner, 2026-11-27: «decir qué supone dicha subida de nivel de cada habilidad en cada
// nivel»): read from the content's own numbers, the gap between the level you have and the one you take.

const c = DEFAULT_CONTENT;
const lines = (o: Offer) => gainLines(offerGains(c, o));
const S = ' '; // a number never parts from its unit

test('un arma que sube de nivel dice qué números cambian', () => {
  // Pulso láser 1 → 2: damage 10 → 12, cooldown 0,55 → 0,5.
  expect(lines({ kind: 'weapon', id: 'pulse', level: 2 })).toEqual([`+20${S}% de daño`, `Se recarga un 9${S}% antes`]);
  // 2 → 3: one more shot.
  expect(lines({ kind: 'weapon', id: 'pulse', level: 3 })).toEqual([`+1 proyectil`]);
});

test('una pasiva dice lo que suma ese nivel, no el total', () => {
  // Amplificador 0,2 → 0,35.
  expect(lines({ kind: 'passive', id: 'amplifier', level: 3 })).toEqual([`+15${S}% de daño`]);
  // Its first level gives its whole first step.
  expect(lines({ kind: 'passive', id: 'armor', level: 1 })).toEqual([`+15${S}% de vida máxima`]);
  expect(lines({ kind: 'passive', id: 'splitter', level: 2 })).toEqual(['+1 proyectil en cada arma']);
  expect(lines({ kind: 'passive', id: 'regen', level: 2 })).toEqual([`+0,3 de vida por segundo`]);
});

test('un arma nueva dice sus números de partida', () => {
  expect(lines({ kind: 'weapon', id: 'pulse', level: 1 })).toEqual(['10 de daño', `cada 0,55${S}s`, '1 proyectil']);
});

test('una evolución dice lo que gana frente a su arma al máximo y su rasgo', () => {
  const evo = c.weapons.find((w) => w.evolution)!;
  const out = lines({ kind: 'evolve', id: evo.id, level: 1 });
  expect(out.length).toBeGreaterThan(0);
  // Its trait first.
  if (evo.special) expect(out[0]).toBe(gainLines([{ kind: 'special', special: evo.special }])[0]);
  // Through everything: no «Atraviesa N enemigos menos» beside it.
  const all = c.weapons.find((w) => w.special === 'pierceAll')!;
  expect(lines({ kind: 'evolve', id: all.id, level: 1 }).some((l) => l.startsWith('Atraviesa') && l.endsWith('menos'))).toBe(false);
});

test('lo que más pesa va primero: más disparos, más daño, antes', () => {
  // Pulso láser 4 → 5: damage, cooldown and one more shot; the shot leads.
  expect(lines({ kind: 'weapon', id: 'pulse', level: 5 })[0]).toBe('+1 proyectil');
});

test('la reparación no lleva línea: su descripción ya lo dice', () => {
  expect(lines({ kind: 'heal', id: 'heal', level: 0 })).toEqual([]);
});

test('cada subida de cada arma, pasiva y evolución del contenido dice algo, sin huecos', () => {
  const bad = (s: string) => /NaN|undefined|Infinity|null/.test(s) || s.trim() === '';
  for (const w of c.weapons) {
    if (w.evolution) {
      const out = lines({ kind: 'evolve', id: w.id, level: 1 });
      expect(out.length, w.id).toBeGreaterThan(0);
      for (const s of out) expect(bad(s), `${w.id}: ${s}`).toBe(false);
      continue;
    }
    for (let level = 1; level <= w.levels.length; level++) {
      const out = lines({ kind: 'weapon', id: w.id, level });
      expect(out.length, `${w.id} ${level}`).toBeGreaterThan(0);
      for (const s of out) expect(bad(s), `${w.id} ${level}: ${s}`).toBe(false);
    }
  }
  for (const p of c.passives)
    for (let level = 1; level <= p.levels.length; level++) {
      const out = lines({ kind: 'passive', id: p.id, level });
      expect(out.length, `${p.id} ${level}`).toBeGreaterThan(0);
      for (const s of out) expect(bad(s), `${p.id} ${level}: ${s}`).toBe(false);
    }
});

// Design C (the owner's pick, 2026-11-27): each number from what you have to what you get.
const rows = (o: Offer) => gainRows(offerGains(c, o)).map((r) => (r.kind === 'trait' ? r.text : [r.label, r.from, r.to]));

test('las filas de antes y después: cada número con lo que tienes y lo que te llevas', () => {
  expect(rows({ kind: 'weapon', id: 'pulse', level: 2 })).toEqual([
    ['Daño', '10', '12'],
    ['Recarga', `0,55${S}s`, `0,5${S}s`],
  ]);
  // A passive: its running total.
  expect(rows({ kind: 'passive', id: 'amplifier', level: 3 })).toEqual([['Daño', `+20${S}%`, `+35${S}%`]]);
  expect(rows({ kind: 'passive', id: 'capacitor', level: 2 })).toEqual([['Recarga de las armas', `−6${S}%`, `−12${S}%`]]);
  // Its first level and a new weapon: only what you get.
  expect(rows({ kind: 'passive', id: 'armor', level: 1 })).toEqual([['Vida máxima', null, `+15${S}%`]]);
  expect(rows({ kind: 'weapon', id: 'orbit', level: 1 })).toEqual([
    ['Daño', null, '8'],
    ['Orbes', null, '2'],
  ]);
  // Each row also says it whole, for screen readers.
  const [first] = gainRows(offerGains(c, { kind: 'weapon', id: 'pulse', level: 2 }));
  expect(first).toMatchObject({ say: `+20${S}% de daño` });
});

test('en las filas, el rasgo de una evolución va primero y no hay flechas de texto', () => {
  const evo = c.weapons.find((w) => w.evolution && w.special)!;
  const out = gainRows(offerGains(c, { kind: 'evolve', id: evo.id, level: 1 }));
  expect(out[0]!.kind).toBe('trait');
  for (const w of c.weapons)
    for (let level = 1; level <= w.levels.length; level++)
      for (const r of gainRows(offerGains(c, { kind: w.evolution ? 'evolve' : 'weapon', id: w.id, level })))
        expect(JSON.stringify(r)).not.toMatch(/[→←›‹➜]|->/);
});
