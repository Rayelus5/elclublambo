import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { type ConfigKey, configIssues, generateGalaxy, parseConfig } from '../src';

// The open beta launch config (games/galaxy/ops/launch/2026-11-10/), published on PRE with `cli.js publish-config`:
// every file is a whole, valid key, and they agree with each other (the season's 4 weeks, events inside it, the event
// scanner paid with its event's own signals on the same dates, a featured value a legendary can have).

const DIR = new URL('../../../ops/launch/2026-11-10/', import.meta.url);
const KEYS = ['content', 'season', 'seasonRoute', 'missions', 'achievements', 'boosts', 'events', 'gacha'] as const satisfies readonly ConfigKey[];
const load = <K extends ConfigKey>(key: K) => parseConfig(key, JSON.parse(readFileSync(new URL(`${key}.json`, DIR), 'utf8')));
const DAY = 86_400_000;

test('cada archivo es una clave completa y válida, sin nada que el juego no pueda servir', () => {
  for (const key of KEYS) {
    expect(() => load(key), key).not.toThrow();
    expect(configIssues(key, JSON.parse(readFileSync(new URL(`${key}.json`, DIR), 'utf8'))), key).toEqual([]);
  }
});

test('la Temporada 1 dura 4 semanas desde las 00:00 de Madrid del 10 de noviembre', () => {
  const s = load('season');
  expect(s).toMatchObject({ id: 'season-1', name: 'Temporada 1', startsAt: '2026-11-09T23:00:00.000Z' });
  expect(Date.parse(s.endsAt) - Date.parse(s.startsAt)).toBe(28 * DAY);
});

test('los eventos caben en la temporada y el escáner de cada uno se paga con sus señales en sus fechas', () => {
  const s = load('season');
  const events = load('events').list;
  const banners = load('gacha').banners;
  expect(events.length).toBeGreaterThan(0);
  for (const e of events) {
    expect(Date.parse(e.startsAt)).toBeGreaterThanOrEqual(Date.parse(s.startsAt));
    expect(Date.parse(e.endsAt)).toBeLessThanOrEqual(Date.parse(s.endsAt));
    const signals = e.goals.reduce((n, g) => n + g.reward.eventSignals, 0);
    const banner = banners.find((b) => b.currency === `signal:${e.id}`);
    if (signals > 0) {
      expect(banner, e.id).toBeDefined();
      expect([banner!.startsAt, banner!.endsAt]).toEqual([e.startsAt, e.endsAt]);
    }
  }
  expect(banners.some((b) => b.id === 'deep-scan')).toBe(true);
});

test('la galaxia destacada de cada escáner de evento puede salir legendaria', () => {
  for (const b of load('gacha').banners) {
    if (!b.featured) continue;
    for (let k = 1n; k <= 5n; k++) expect(() => generateGalaxy(k * 7919n, 4, b.featured!)).not.toThrow();
  }
});

test('las misiones sortean 4 al día y 4 a la semana, y hay más donde elegir', () => {
  const m = load('missions');
  expect(m.daily.count).toBe(4);
  expect(m.weekly.count).toBe(4);
  expect(m.daily.pool.length).toBeGreaterThan(m.daily.count);
  expect(m.weekly.pool.length).toBeGreaterThan(m.weekly.count);
  const ids = [...m.daily.pool, ...m.weekly.pool, ...m.season].map((x) => x.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test('cada sector endurece a sus enemigos, del primero al de temporada', () => {
  const hp = load('content').sectors.map((s) => s.enemyHp);
  for (let i = 1; i < hp.length; i++) expect(hp[i]!).toBeGreaterThan(hp[i - 1]!);
});

test('los potenciadores del lanzamiento duran una semana desde el inicio', () => {
  const s = load('season');
  for (const b of load('boosts').list) {
    expect(b.startsAt).toBe(s.startsAt);
    expect(Date.parse(b.endsAt) - Date.parse(b.startsAt)).toBe(7 * DAY);
  }
});
