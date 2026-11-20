import { DEFAULT_CONTENT } from '@galaxy/sim';
import { describe, expect, test } from 'vitest';
import { configSchemas, opsProblems, type OpsConfigs } from '../src';

// What makes a live config not hold together across keys (docs/CONTENIDO.md B): the CLI's check-config runs it over
// what is live on PRE plus a folder's drafts, and launch-config.test.ts over every folder in ops/. Each problem is one
// Spanish line, so an agent can show it to the owner as it is.

const NOW = Date.parse('2026-11-20T12:00:00.000Z');
const defaults = (): OpsConfigs => ({
  season: configSchemas.season.parse({}),
  events: configSchemas.events.parse({}),
  gacha: configSchemas.gacha.parse({}),
  missions: configSchemas.missions.parse({}),
  content: configSchemas.content.parse(DEFAULT_CONTENT),
});
const reward = { coins: 0, dust: 0, signal: 0, xp: 0, points: 0, eventSignals: 3 };
const event = (id: string, startsAt: string, endsAt: string, eventSignals = 3) =>
  configSchemas.events.parse({ list: [{ id, name: 'Evento', description: 'Uno', startsAt, endsAt, goals: [{ id: `${id}-g`, name: 'Juega', stat: 'runs', target: 1, reward: { ...reward, eventSignals } }] }] }).list[0]!;
const scanner = (id: string, startsAt: string, endsAt: string, value = 'comet') => ({
  id,
  kind: 'event' as const,
  name: 'Escáner',
  pityGroup: `event-${id}`,
  currency: `signal:${id}`,
  featured: { trait: 'phenomenon' as const, value },
  startsAt,
  endsAt,
});
const DEEP = { id: 'deep-scan', kind: 'standard' as const, name: 'Escáner profundo', pityGroup: 'standard', currency: 'signal' };

function withEvent(c: OpsConfigs, e: ReturnType<typeof event>, banners: unknown[]): OpsConfigs {
  return { ...c, events: { list: [e] }, gacha: configSchemas.gacha.parse({ ...c.gacha, banners }) };
}

describe('opsProblems', () => {
  test('la configuración por defecto se sostiene', () => {
    expect(opsProblems(defaults(), NOW)).toEqual([]);
  });

  test('un evento en curso que paga señales sin su escáner, o con otras fechas', () => {
    const c = defaults();
    const e = event('cometas', '2026-11-19T23:00:00.000Z', '2026-11-22T23:00:00.000Z');
    expect(opsProblems(withEvent(c, e, [DEEP]), NOW)).toEqual(['El evento cometas paga señales de evento y no tiene escáner']);
    expect(opsProblems(withEvent(c, e, [DEEP, scanner('cometas', '2026-11-19T23:00:00.000Z', '2026-11-23T23:00:00.000Z')]), NOW)).toEqual([
      'El escáner del evento cometas no tiene exactamente sus mismas fechas',
    ]);
    expect(opsProblems(withEvent(c, e, [DEEP, scanner('cometas', '2026-11-19T23:00:00.000Z', '2026-11-22T23:00:00.000Z')]), NOW)).toEqual([]);
  });

  test('un escáner abierto de un evento que ya no está en la lista', () => {
    const c = defaults();
    const gacha = configSchemas.gacha.parse({ ...c.gacha, banners: [DEEP, scanner('perdido', '2026-11-19T23:00:00.000Z', '2026-11-22T23:00:00.000Z')] });
    expect(opsProblems({ ...c, gacha }, NOW)).toEqual(['El escáner perdido se paga con señales de un evento que no está en la lista']);
  });

  test('lo que ya terminó no cuenta', () => {
    const c = defaults();
    const e = event('pasado', '2026-11-01T23:00:00.000Z', '2026-11-05T23:00:00.000Z');
    expect(opsProblems(withEvent(c, e, [DEEP]), NOW)).toEqual([]);
  });

  test('un evento en curso fuera de la temporada', () => {
    const c = defaults();
    const e = event('fuera', '2026-11-19T23:00:00.000Z', '2026-11-22T23:00:00.000Z', 0);
    const season = { ...c.season, id: 'season-x', startsAt: '2026-11-20T23:00:00.000Z', endsAt: '2026-12-18T23:00:00.000Z' };
    expect(opsProblems({ ...c, season, events: { list: [e] } }, NOW)).toEqual(['El evento fuera no cabe en la temporada season-x']);
  });

  test('una destacada que no puede salir legendaria', () => {
    const c = defaults();
    const e = event('erratas', '2026-11-19T23:00:00.000Z', '2026-11-22T23:00:00.000Z');
    expect(opsProblems(withEvent(c, e, [DEEP, scanner('erratas', '2026-11-19T23:00:00.000Z', '2026-11-22T23:00:00.000Z', 'cometa')]), NOW)).toEqual([
      'La destacada phenomenon=cometa del escáner erratas no puede salir legendaria',
    ]);
  });

  test('sin escáner profundo, ids de misión repetidos o una anomalía que no existe', () => {
    const c = defaults();
    const gacha = configSchemas.gacha.parse({ ...c.gacha, banners: [{ ...DEEP, id: 'otro' }] });
    const dup = c.missions.daily.pool[0]!;
    const missions = { ...c.missions, season: [...c.missions.season, dup] };
    const season = { ...c.season, anomaly: 'nada' };
    expect(opsProblems({ ...c, gacha, missions, season }, NOW)).toEqual([
      'Falta el escáner profundo (deep-scan)',
      `El id de misión ${dup.id} está repetido`,
      'La anomalía nada no existe en el contenido',
    ]);
  });
});
