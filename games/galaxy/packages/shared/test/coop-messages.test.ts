import { expect, test } from 'vitest';
import { COOP_MARKS, COOP_SUM_EVERY, coopClientMessageSchema, DEFAULT_ACHIEVEMENTS, DEFAULT_WEEKLY, MISSION_STATS } from '../src';

// The play socket's quick marks (multiplayer plan, phase 6c): four kinds at a point of the world, nothing else.

test('un aviso rápido lleva su tipo y un punto del mundo, y nada más', () => {
  expect(COOP_MARKS).toEqual(['here', 'help', 'beacon', 'danger']);
  expect(coopClientMessageSchema.safeParse({ t: 'mark', kind: 'help', x: 120, y: -40 }).success).toBe(true);
  expect(coopClientMessageSchema.safeParse({ t: 'mark', kind: 'boom', x: 0, y: 0 }).success).toBe(false);
  expect(coopClientMessageSchema.safeParse({ t: 'mark', kind: 'here', x: 1.5, y: 0 }).success).toBe(false);
  expect(coopClientMessageSchema.safeParse({ t: 'mark', kind: 'here', x: 0, y: 9_000_000 }).success).toBe(false);
  expect(coopClientMessageSchema.safeParse({ t: 'mark', kind: 'here', x: 0, y: 0, text: 'hola' }).success).toBe(false);
});

test('la huella de un cliente lleva un tick múltiplo del intervalo y un hexadecimal corto', () => {
  expect(COOP_SUM_EVERY).toBe(300);
  expect(coopClientMessageSchema.safeParse({ t: 'sum', tick: 300, h: '9a3f00c1' }).success).toBe(true);
  expect(coopClientMessageSchema.safeParse({ t: 'sum', tick: 0, h: '9a3f00c1' }).success).toBe(false);
  expect(coopClientMessageSchema.safeParse({ t: 'sum', tick: 300, h: 'NOT-HEX' }).success).toBe(false);
  expect(coopClientMessageSchema.safeParse({ t: 'sum', tick: 300, h: 'a'.repeat(33) }).success).toBe(false);
});

test('las misiones y los logros cuentan las partidas en grupo y las reanimaciones (fase 7)', () => {
  expect(MISSION_STATS).toContain('coopRuns');
  expect(MISSION_STATS).toContain('revives');
  expect(DEFAULT_WEEKLY.find((m) => m.stat === 'coopRuns')).toMatchObject({ id: 'w-group3', target: 3 });
  expect(DEFAULT_ACHIEVEMENTS.filter((a) => a.stat === 'coopRuns' || a.stat === 'revives').map((a) => a.id)).toEqual(['a-group10', 'a-revive25']);
});
