import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ControlledTransaction, Kysely } from 'kysely';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { runCli } from '../../src/cli';
import { createDb } from '../../src/db';
import type { DB } from '../../src/db/schema';
import { liveNotices } from '../../src/mail/service';
import { testEnv } from '../helpers';

// Publishing live config and title notices from the container CLI (open beta launch): with no admin account left
// after the wipe, the launch config goes live from files, validated like the panel's and audited as «cli».
// The local DB is the user's: everything here runs on one transaction that is rolled back when the file ends.

let db: Kysely<DB>;
let trx: ControlledTransaction<DB>;
const dir = mkdtempSync(join(tmpdir(), 'galaxy-cli-'));
const file = (name: string, data: unknown) => {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(data));
  return path;
};
const cli = async (argv: string[]) => {
  const lines: string[] = [];
  const code = await runCli(argv, { db: trx, env: testEnv(), out: (s) => lines.push(s) });
  return { code, out: lines.join('\n') };
};
const live = async (key: string) => trx.selectFrom('galaxy.game_config_active').select(['version', 'data']).where('key', '=', key).executeTakeFirst();

beforeAll(async () => {
  db = createDb(testEnv().DATABASE_URL, { max: 1 });
  trx = await db.startTransaction().execute();
});
afterAll(async () => {
  await trx.rollback().execute();
  await db.destroy();
});

test('publish-config publica una clave validada, con su versión siguiente, y lo audita como cli', async () => {
  const before = (await live('boosts'))?.version ?? 0;
  const boost = { id: 'lanzamiento', name: 'Lanzamiento', currency: 'coins', factor: 1.5, startsAt: '2026-11-09T23:00:00.000Z', endsAt: '2026-11-16T23:00:00.000Z' };
  const r = await cli(['publish-config', 'boosts', file('boosts.json', { list: [boost] }), '--reason', 'Lanzamiento de la beta abierta']);
  expect(r.code, r.out).toBe(0);
  expect(r.out).toContain(`boosts v${before + 1}`);
  const now = await live('boosts');
  expect(now?.version).toBe(before + 1);
  expect((now?.data as { list: unknown[] }).list).toEqual([boost]);
  const audit = await trx.selectFrom('galaxy.admin_audit_log').select(['actor_label', 'action', 'reason']).where('target_id', '=', 'boosts').orderBy('id', 'desc').executeTakeFirstOrThrow();
  expect(audit).toEqual({ actor_label: 'cli', action: 'config.published', reason: 'Lanzamiento de la beta abierta' });
});

test('un JSON que no valida no publica nada y dice dónde falla', async () => {
  const before = (await live('boosts'))?.version ?? 0;
  const r = await cli(['publish-config', 'boosts', file('bad.json', { list: [{ id: 'x', name: 'X', currency: 'coins', factor: 99, startsAt: '2026-11-09T23:00:00.000Z', endsAt: '2026-11-10T23:00:00.000Z' }] }), '--reason', 'prueba']);
  expect(r.code).toBe(1);
  expect(r.out).toMatch(/factor/);
  expect((await live('boosts'))?.version ?? 0).toBe(before);
  expect((await cli(['publish-config', 'nada', file('x.json', {}), '--reason', 'prueba'])).code).toBe(1);
  expect((await cli(['publish-config', 'boosts', file('y.json', { list: [] })])).code).toBe(1);
});

test('la ruta de temporada (seasonRoute, con mayúscula) también se publica', async () => {
  const r = await cli(['publish-config', 'seasonRoute', file('route.json', { currency: { name: 'Esquirlas', perPoint: 0.5, dustRate: 2 } }), '--reason', 'Ruta de 4 semanas']);
  expect(r.code, r.out).toBe(0);
  expect((await live('seasonRoute'))?.version).toBeGreaterThan(0);
});

test('show-config imprime lo vivo de una clave (con su versión, o solo los datos), sin publicar nada', async () => {
  const boost = { id: 'para-leer', name: 'Para leer', currency: 'dust', factor: 2, startsAt: '2026-12-10T23:00:00.000Z', endsAt: '2026-12-13T23:00:00.000Z' };
  expect((await cli(['publish-config', 'boosts', file('read.json', { list: [boost] }), '--reason', 'Para leerla'])).code).toBe(0);
  const version = (await live('boosts'))!.version;
  const r = await cli(['show-config', 'boosts']);
  expect(r.code, r.out).toBe(0);
  expect(JSON.parse(r.out)).toEqual({ key: 'boosts', version, data: { list: [boost] } });
  const data = await cli(['show-config', 'boosts', '--data']);
  expect(JSON.parse(data.out)).toEqual({ list: [boost] });
  expect((await live('boosts'))!.version).toBe(version);
  expect((await cli(['show-config', 'nada'])).code).toBe(1);
  expect((await cli(['show-config'])).code).toBe(1);
});

test('publish-config --dry-run valida contra lo vivo y dice qué cambiaría, sin publicar ni auditar', async () => {
  const kept = { id: 'se-queda', name: 'Se queda', currency: 'coins', factor: 1.5, startsAt: '2026-12-10T23:00:00.000Z', endsAt: '2026-12-13T23:00:00.000Z' };
  expect((await cli(['publish-config', 'boosts', file('base.json', { list: [kept] }), '--reason', 'Base de la prueba'])).code).toBe(0);
  const version = (await live('boosts'))!.version;
  const audits = async () => (await trx.selectFrom('galaxy.admin_audit_log').select('id').where('target_id', '=', 'boosts').execute()).length;
  const before = await audits();
  const added = { ...kept, id: 'nuevo', name: 'Nuevo' };
  const r = await cli(['publish-config', 'boosts', file('dry.json', { list: [kept, added] }), '--dry-run']);
  expect(r.code, r.out).toBe(0);
  expect(r.out).toContain(`boosts v${version} → v${version + 1}`);
  expect(r.out).toContain('list (+nuevo)');
  expect((await live('boosts'))!.version).toBe(version);
  expect(await audits()).toBe(before);
  // What would not validate says where, and publishes nothing either.
  const bad = await cli(['publish-config', 'boosts', file('dry-bad.json', { list: [{ ...kept, factor: 99 }] }), '--dry-run']);
  expect(bad.code).toBe(1);
  expect(bad.out).toMatch(/factor/);
  // The same as what is live: nothing would change.
  const same = await cli(['publish-config', 'boosts', file('dry-same.json', { list: [kept] }), '--dry-run']);
  expect(same.code).toBe(0);
  expect(same.out).toContain('Sin cambios');
  expect((await live('boosts'))!.version).toBe(version);
});

test('draft-config parte de lo vivo: conserva lo publicado y añade lo que trae el código, o solo los ids pedidos', async () => {
  const mine = { id: 'mio', name: 'Mío', currency: 'coins', factor: 1.2, startsAt: '2026-12-10T23:00:00.000Z', endsAt: '2026-12-13T23:00:00.000Z' };
  expect((await cli(['publish-config', 'boosts', file('mine.json', { list: [mine] }), '--reason', 'Lo vivo de la prueba'])).code).toBe(0);
  // The code's default boosts list is empty: the live one stays as it is.
  const r = await cli(['draft-config', 'boosts', 'list']);
  expect(r.code, r.out).toBe(0);
  expect(JSON.parse(r.out)).toEqual({ list: [mine] });
  // A list of things with ids gains the defaults' entries it lacks; an id the defaults lack is refused.
  const weapons = await cli(['draft-config', 'content', 'weapons,passives']);
  expect(weapons.code, weapons.out).toBe(0);
  const draft = JSON.parse(weapons.out) as { weapons: { id: string }[]; passives: { id: string }[] };
  expect(draft.weapons.map((w) => w.id)).toContain('pulse');
  expect(Object.keys(draft)).toEqual(['weapons', 'passives']);
  expect((await cli(['draft-config', 'content', 'weapons', '--ids', 'no-existe'])).code).toBe(1);
  expect((await cli(['draft-config', 'content', 'nada'])).code).toBe(1);
  expect((await cli(['draft-config', 'nada', 'list'])).code).toBe(1);
});

test('check-config comprueba un lote de claves sobre lo vivo, entre ellas, sin publicar nada', async () => {
  const at = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
  const [starts, ends] = [at(-1), at(2)];
  const season = { id: 'season-chk', name: 'Temporada de prueba', startsAt: at(-10), endsAt: at(20), anomaly: null };
  const reward = { coins: 0, dust: 0, signal: 0, xp: 0, points: 0, eventSignals: 3 };
  const event = { id: 'chk-evento', name: 'Evento', description: 'De prueba', startsAt: starts, endsAt: ends, goals: [{ id: 'chk-g', name: 'Juega', stat: 'runs', target: 1, reward }] };
  const deep = { id: 'deep-scan', kind: 'standard', name: 'Escáner profundo', pityGroup: 'standard', currency: 'signal' };
  const banner = { id: 'chk-evento', kind: 'event', name: 'Escáner de prueba', pityGroup: 'event-chk-evento', currency: 'signal:chk-evento', featured: { trait: 'phenomenon', value: 'comet' }, startsAt: starts, endsAt: ends };
  const versions = async () => Promise.all(['season', 'events', 'gacha'].map(async (k) => (await live(k))?.version ?? 0));
  const before = await versions();
  const ok = await cli(['check-config', file('ok.json', { season, events: { list: [event] }, gacha: { banners: [deep, banner] } })]);
  expect(ok.code, ok.out).toBe(0);
  expect(ok.out).toMatch(/season .*→/);
  expect(ok.out).toContain('events');
  expect(ok.out).toContain('Se sostiene');
  // The event's scanner missing: each key alone is valid, together they are not.
  const half = await cli(['check-config', file('half.json', { season, events: { list: [event] }, gacha: { banners: [deep] } })]);
  expect(half.code).toBe(1);
  expect(half.out).toContain('El evento chk-evento paga señales de evento y no tiene escáner');
  // A featured value no legendary can have, and a key that does not validate.
  const typo = await cli(['check-config', file('typo.json', { season, events: { list: [event] }, gacha: { banners: [deep, { ...banner, featured: { trait: 'phenomenon', value: 'cometa' } }] } })]);
  expect(typo.code).toBe(1);
  expect(typo.out).toContain('no puede salir legendaria');
  const bad = await cli(['check-config', file('bad-key.json', { boosts: { list: [{ id: 'x', name: 'X', currency: 'coins', factor: 99, startsAt: starts, endsAt: ends }] } })]);
  expect(bad.code).toBe(1);
  expect(bad.out).toMatch(/factor/);
  expect((await cli(['check-config', file('stray.json', { nada: {} })])).code).toBe(1);
  expect(await versions()).toEqual(before);
});

test('notice crea un aviso de la pantalla de título, vivo desde ahora los días pedidos, y lo audita', async () => {
  const r = await cli(['notice', 'Arranca la Beta Abierta', '--tone', 'info', '--days', '14', '--reason', 'Lanzamiento']);
  expect(r.code, r.out).toBe(0);
  const notices = await liveNotices(trx, new Date());
  expect(notices.find((n) => n.text === 'Arranca la Beta Abierta')).toMatchObject({ tone: 'info' });
  const row = await trx.selectFrom('galaxy.title_notices').select(['ends_at']).where('text', '=', 'Arranca la Beta Abierta').executeTakeFirstOrThrow();
  expect(Math.abs(new Date(row.ends_at).getTime() - (Date.now() + 14 * 86_400_000))).toBeLessThan(60_000);
  expect((await cli(['notice', '', '--reason', 'x'])).code).toBe(1);
});
