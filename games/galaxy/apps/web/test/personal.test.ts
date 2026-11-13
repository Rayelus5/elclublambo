import { expect, test } from 'vitest';
import { isPersonal } from '../src/arena/personal';

// In a group run each player's own moments are theirs (Nov plan A2): a teammate's hit, level-up, pickup or dash
// never flashes, shakes or sounds on my screen; the world's events (kills, the boss, the beacon) are everyone's.
test('el daño de un compañero no es mío', () => {
  expect(isPersonal({ t: 'hurt', probe: 1, amount: 3 }, 0)).toBe(false);
  expect(isPersonal({ t: 'hurt', probe: 0, amount: 3 }, 0)).toBe(true);
});

test('subir de nivel, recoger y el acelerón de otro tampoco', () => {
  expect(isPersonal({ t: 'levelUp', probe: 2, level: 5 }, 0)).toBe(false);
  expect(isPersonal({ t: 'pickup', probe: 1, kind: 'coin', value: 1 }, 0)).toBe(false);
  expect(isPersonal({ t: 'dash', probe: 1, kind: 'quirk', fx: 0, fy: 0, tx: 1, ty: 1, ticks: 0 }, 0)).toBe(false);
  expect(isPersonal({ t: 'levelUp', probe: 1, level: 5 }, 1)).toBe(true);
});

test('la anomalía de la reliquia de otro tampoco suena en mi pantalla', () => {
  const anomaly = { t: 'anomaly' as const, what: 'blink' as const, fx: 0, fy: 0, tx: 70, ty: 0, radius: 0, targets: [] as number[] };
  expect(isPersonal({ ...anomaly, probe: 1 }, 0)).toBe(false);
  expect(isPersonal({ ...anomaly, probe: 0 }, 0)).toBe(true);
});

test('lo que pasa en el mundo es de todos', () => {
  expect(isPersonal({ t: 'bossDown', x: 0, y: 0 }, 0)).toBe(true);
  expect(isPersonal({ t: 'kill', x: 0, y: 0, enemy: 'swarmer', elite: false }, 3)).toBe(true);
});
