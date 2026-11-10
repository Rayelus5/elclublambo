import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { type ConfigKey, type ConfigValue, configIssues, configSchemas, isConfigKey, mergeDraft, opsProblems, parseConfig } from '../src';

// The live config published on PRE with `cli.js publish-config` (games/galaxy/ops, docs/CONTENIDO.md):
// - ops/launch/<yyyy-mm-dd>[-slug]/: what was (or will be) published, one file per key with the top-level fields it
//   replaces; the folder's date is the day it is published. The folders fold in order the way the server publishes
//   (mergeDraft over what was live), and every one must leave a game that holds together: each file valid over what
//   was live before it, opsProblems empty (config/ops-checks.ts, what check-config also runs on PRE), and the season
//   and event dates it brings on Madrid midnights. Edits made by hand in the panel are not in these folders: on PRE
//   the CLI's check-config runs the same checks over what is really live.
// - ops/plantillas/<name>/: drafts to start a new season or event from, each checked alone over the defaults.
// The open beta launch (2026-11-10) also keeps its own promises (4 weeks, 4 + 4 missions, harder sectors, a week of
// boosts).

const OPS = new URL('../../../ops/', import.meta.url);
const FOLDER = /^\d{4}-\d{2}-\d{2}(-[a-z0-9-]+)?$/;
const DAY = 86_400_000;

type Live = { [K in ConfigKey]?: ConfigValue<K> };
type Drafts = Partial<Record<ConfigKey, unknown>>;
interface Folder {
  name: string;
  drafts: Drafts;
  /** Files whose name is not a config key (`event.json` for `events.json`). */
  strays: string[];
}
interface Stage extends Folder {
  /** The folder's day at 00:00 in Madrid (22:00–23:00 UTC the day before): what still runs from then on counts. */
  at: number;
  before: Live;
  live: Live;
}

function read(dir: URL, name: string): Folder {
  const drafts: Drafts = {};
  const strays: string[] = [];
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.json')) continue;
    const key = file.slice(0, -'.json'.length);
    if (isConfigKey(key)) drafts[key] = JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
    else strays.push(file);
  }
  return { name, drafts, strays };
}

function folders(sub: 'launch' | 'plantillas', named: (name: string) => boolean): Folder[] {
  const root = new URL(`${sub}/`, OPS);
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && named(d.name))
    .map((d) => d.name)
    .sort()
    .map((name) => read(new URL(`${name}/`, root), name));
}

/** What a key is before anything is published: its schema's defaults (the server serves these at version 0). */
function defaults<K extends ConfigKey>(key: K): ConfigValue<K> {
  const schema = configSchemas[key];
  const empty = schema.safeParse({});
  return (empty.success ? empty.data : schema.parse(undefined)) as ConfigValue<K>;
}

/** Each folder's files over what was live before it, in folder order, the way `publish-config` publishes them. */
function fold(list: Folder[], start: Live = {}): Stage[] {
  let live = start;
  return list.map((f) => {
    const before = live;
    const next: Live = { ...before };
    for (const key of Object.keys(f.drafts) as ConfigKey[]) {
      (next as Record<ConfigKey, unknown>)[key] = parseConfig(key, mergeDraft(key, before[key] ?? defaults(key), f.drafts[key]));
    }
    live = next;
    return { ...f, at: Date.parse(`${f.name.slice(0, 10)}T00:00:00Z`) - 2 * 3_600_000, before, live };
  });
}

const get = <K extends ConfigKey>(live: Live, key: K): ConfigValue<K> => (live[key] ?? defaults(key)) as ConfigValue<K>;

const madrid = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const madridMidnight = (iso: string) => madrid.format(new Date(iso)) === '00:00:00';

/** The checks every published state must pass (events and scanners counted from `at` on). */
function holdsTogether(name: string, live: Live, at: number, own: Drafts) {
  const season = get(live, 'season');

  test(`${name}: se sostiene entre claves (lo mismo que comprueba check-config en PRE)`, () => {
    const all = { season, events: get(live, 'events'), gacha: get(live, 'gacha'), missions: get(live, 'missions'), content: get(live, 'content') };
    expect(opsProblems(all, at)).toEqual([]);
  });

  test(`${name}: la temporada y los eventos que trae empiezan y acaban a medianoche de Madrid`, () => {
    const dates: string[] = [];
    if (own.season) dates.push(season.startsAt, season.endsAt);
    if (own.events) for (const e of get(live, 'events').list.filter((x) => Date.parse(x.endsAt) > at)) dates.push(e.startsAt, e.endsAt);
    for (const d of dates) expect(madridMidnight(d), d).toBe(true);
  });
}

const launches = fold(folders('launch', () => true));
const templates = folders('plantillas', () => true);

test('hay carpetas de lanzamiento, con nombre <aaaa-mm-dd>[-slug] en minúsculas, y plantillas de temporada y de evento', () => {
  expect(launches.length).toBeGreaterThan(0);
  // A folder with another name would still be checked here, but sorts out of order: its name is the publish day.
  for (const l of launches) expect(l.name, l.name).toMatch(FOLDER);
  expect(templates.map((t) => t.name)).toEqual(expect.arrayContaining(['evento', 'temporada']));
});

describe.each(launches)('ops/launch/$name', (stage) => {
  test('cada archivo es una clave de configuración y vale sobre lo que había publicado', () => {
    expect(stage.strays).toEqual([]);
    for (const [key, draft] of Object.entries(stage.drafts) as [ConfigKey, unknown][]) {
      expect(configIssues(key, mergeDraft(key, stage.before[key] ?? defaults(key), draft)), key).toEqual([]);
    }
  });
  holdsTogether(stage.name, stage.live, stage.at, stage.drafts);
});

describe.each(templates)('ops/plantillas/$name', (t) => {
  test('cada archivo es una clave de configuración y vale sobre los valores por defecto', () => {
    expect(t.strays).toEqual([]);
    for (const [key, draft] of Object.entries(t.drafts) as [ConfigKey, unknown][]) {
      expect(configIssues(key, mergeDraft(key, defaults(key), draft)), key).toEqual([]);
    }
  });
  const live = fold([t])[0]!.live;
  holdsTogether(t.name, live, -Infinity, t.drafts);
});

describe('el lanzamiento de la beta abierta (2026-11-10)', () => {
  const launch = launches.find((s) => s.name === '2026-11-10')!;
  const live = launch.live;

  test('la Temporada 1 dura 4 semanas desde las 00:00 de Madrid del 10 de noviembre', () => {
    const s = get(live, 'season');
    expect(s).toMatchObject({ id: 'season-1', name: 'Temporada 1', startsAt: '2026-11-09T23:00:00.000Z' });
    expect(Date.parse(s.endsAt) - Date.parse(s.startsAt)).toBe(28 * DAY);
    expect(get(live, 'events').list.length).toBeGreaterThan(0);
  });

  test('las misiones sortean 4 al día y 4 a la semana, y hay más donde elegir', () => {
    const m = get(live, 'missions');
    expect(m.daily.count).toBe(4);
    expect(m.weekly.count).toBe(4);
    expect(m.daily.pool.length).toBeGreaterThan(m.daily.count);
    expect(m.weekly.pool.length).toBeGreaterThan(m.weekly.count);
  });

  test('cada sector endurece a sus enemigos, del primero al de temporada', () => {
    const hp = get(live, 'content').sectors.map((s) => s.enemyHp);
    for (let i = 1; i < hp.length; i++) expect(hp[i]!).toBeGreaterThan(hp[i - 1]!);
  });

  test('los potenciadores del lanzamiento duran una semana desde el inicio', () => {
    const s = get(live, 'season');
    for (const b of get(live, 'boosts').list) {
      expect(b.startsAt).toBe(s.startsAt);
      expect(Date.parse(b.endsAt) - Date.parse(b.startsAt)).toBe(7 * DAY);
    }
  });
});
