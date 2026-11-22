import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { type ConfigKey, type ConfigValue, configIssues, configSchemas, isConfigKey, mergeDraft, normalizeSeasonRecord, opsProblems, parseConfig, type SeasonRecordData, seasonConfigOf, seasonRecordIssues, tournamentIssues } from '../src';

// The live config published on PRE with `cli.js publish-config` (games/galaxy/ops, docs/CONTENIDO.md):
// - ops/launch/<yyyy-mm-dd>[-slug]/: what was (or will be) published, one file per key with the top-level fields it
//   replaces; the folder's date is the day it is published. The folders fold in order the way the server publishes
//   (mergeDraft over what was live), and every one must leave a game that holds together: each file valid over what
//   was live before it, opsProblems empty (config/ops-checks.ts, what check-config also runs on PRE), and the season
//   and event dates it brings on Madrid midnights. Edits made by hand in the panel are not in these folders: on PRE
//   the CLI's check-config runs the same checks over what is really live.
// - ops/plantillas/<name>/: drafts to start a new season or event from, each checked alone over the defaults.
// - Seasons as records (plan «temporadas como fichas», 2026-11-21): a folder may carry `temporada.json`, a whole season
//   (dates, rules, route, missions, lab tree) that is imported and scheduled, never published as keys. From the first
//   one on, every season that counts is checked: the old key's season ends where the first record starts.
// - Tournaments (skill galaxy-torneo, 2026-11-22): a folder may carry `torneo.json`, one tournament that goes to PRE as a
//   draft with `tournament-draft` (scheduled later in the panel). It must hold, with its season among the folders'
//   records when it is one of them (check-config checks it against the real ones on PRE).
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
  /** The folder's season record (`temporada.json`), if it brings one. */
  record?: unknown;
  /** The folder's tournament (`torneo.json`), if it brings one. */
  tournament?: unknown;
}
interface Stage extends Folder {
  /** The folder's day at 00:00 in Madrid (22:00–23:00 UTC the day before): what still runs from then on counts. */
  at: number;
  before: Live;
  live: Live;
  /** Every season record up to this folder (a later one with the same id replaces it). */
  records: SeasonRecordData[];
}

function read(dir: URL, name: string): Folder {
  const drafts: Drafts = {};
  const strays: string[] = [];
  let record: unknown;
  let tournament: unknown;
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.json')) continue;
    const key = file.slice(0, -'.json'.length);
    if (file === 'temporada.json') record = JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
    else if (file === 'torneo.json') tournament = JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
    else if (isConfigKey(key)) drafts[key] = JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
    else strays.push(file);
  }
  return { name, drafts, strays, record, tournament };
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
  let records: SeasonRecordData[] = [];
  return list.map((f) => {
    const before = live;
    const next: Live = { ...before };
    for (const key of Object.keys(f.drafts) as ConfigKey[]) {
      (next as Record<ConfigKey, unknown>)[key] = parseConfig(key, mergeDraft(key, before[key] ?? defaults(key), f.drafts[key]));
    }
    live = next;
    if (f.record !== undefined && seasonRecordIssues(f.record).length === 0) {
      const r = normalizeSeasonRecord(f.record);
      records = [...records.filter((x) => x.id !== r.id), r];
    }
    return { ...f, at: Date.parse(`${f.name.slice(0, 10)}T00:00:00Z`) - 2 * 3_600_000, before, live, records };
  });
}

/**
 * Every season that counts with records: the old key's season (cut where the first record starts: from then on the
 * records rule) and each record. Undefined while there is none, so the old single-season checks apply.
 */
function seasonsOf(live: Live, records: SeasonRecordData[]): NonNullable<Parameters<typeof opsProblems>[0]['seasons']> | undefined {
  if (records.length === 0) return undefined;
  const legacy = get(live, 'season');
  const first = Math.min(...records.map((r) => Date.parse(r.startsAt)));
  const out: NonNullable<Parameters<typeof opsProblems>[0]['seasons']> = [];
  if (!records.some((r) => r.id === legacy.id) && Date.parse(legacy.startsAt) < first) {
    const endsAt = new Date(Math.min(Date.parse(legacy.endsAt), first)).toISOString();
    out.push({ season: { ...legacy, endsAt }, missions: get(live, 'missions').season });
  }
  for (const r of records) out.push({ season: seasonConfigOf(r), missions: r.missions });
  return out;
}

const get = <K extends ConfigKey>(live: Live, key: K): ConfigValue<K> => (live[key] ?? defaults(key)) as ConfigValue<K>;

const madrid = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const madridMidnight = (iso: string) => madrid.format(new Date(iso)) === '00:00:00';

/** The checks every published state must pass (events and scanners counted from `at` on). */
function holdsTogether(name: string, live: Live, at: number, own: Drafts, records: SeasonRecordData[] = [], record?: unknown, tournament?: unknown) {
  const season = get(live, 'season');

  if (tournament !== undefined) {
    test(`${name}: su torneo (torneo.json) vale con el contenido de entonces y cabe en su temporada`, () => {
      const id = (tournament as { seasonId?: unknown }).seasonId;
      const home = records.find((r) => r.id === id);
      const content = get(live, 'content');
      expect(
        tournamentIssues(tournament, {
          // A season of these folders is checked here; any other, by check-config against PRE.
          season: home ? { id: home.id, state: 'scheduled', startsAt: home.startsAt, endsAt: home.endsAt } : undefined,
          sectors: content.sectors.map((x) => x.id),
          probes: content.probes.map((p) => p.id),
        }),
      ).toEqual([]);
    });
  }

  test(`${name}: se sostiene entre claves (lo mismo que comprueba check-config en PRE)`, () => {
    const all = { season, events: get(live, 'events'), gacha: get(live, 'gacha'), missions: get(live, 'missions'), content: get(live, 'content'), seasons: seasonsOf(live, records) };
    expect(opsProblems(all, at)).toEqual([]);
  });

  if (record !== undefined) {
    test(`${name}: su temporada (temporada.json) vale con el laboratorio y el contenido de entonces`, () => {
      expect(seasonRecordIssues(record, { labNodes: get(live, 'lab').nodes, anomalies: get(live, 'content').anomalies.map((a) => a.id) })).toEqual([]);
    });
  }

  test(`${name}: la temporada y los eventos que trae empiezan y acaban a medianoche de Madrid`, () => {
    const dates: string[] = [];
    if (own.season) dates.push(season.startsAt, season.endsAt);
    if (own.events) for (const e of get(live, 'events').list.filter((x) => Date.parse(x.endsAt) > at)) dates.push(e.startsAt, e.endsAt);
    for (const d of dates) expect(madridMidnight(d), d).toBe(true);
  });
}

const launches = fold(folders('launch', () => true));
const templates = folders('plantillas', () => true);

test('hay carpetas de lanzamiento, con nombre <aaaa-mm-dd>[-slug] en minúsculas, y plantillas de temporada, de evento y de torneo', () => {
  expect(launches.length).toBeGreaterThan(0);
  // A folder with another name would still be checked here, but sorts out of order: its name is the publish day.
  for (const l of launches) expect(l.name, l.name).toMatch(FOLDER);
  expect(templates.map((t) => t.name)).toEqual(expect.arrayContaining(['evento', 'temporada', 'torneo']));
});

describe.each(launches)('ops/launch/$name', (stage) => {
  test('cada archivo es una clave de configuración y vale sobre lo que había publicado', () => {
    expect(stage.strays).toEqual([]);
    for (const [key, draft] of Object.entries(stage.drafts) as [ConfigKey, unknown][]) {
      expect(configIssues(key, mergeDraft(key, stage.before[key] ?? defaults(key), draft)), key).toEqual([]);
    }
  });
  holdsTogether(stage.name, stage.live, stage.at, stage.drafts, stage.records, stage.record, stage.tournament);
});

describe.each(templates)('ops/plantillas/$name', (t) => {
  test('cada archivo es una clave de configuración y vale sobre los valores por defecto', () => {
    expect(t.strays).toEqual([]);
    for (const [key, draft] of Object.entries(t.drafts) as [ConfigKey, unknown][]) {
      expect(configIssues(key, mergeDraft(key, defaults(key), draft)), key).toEqual([]);
    }
  });
  const folded = fold([t])[0]!;
  holdsTogether(t.name, folded.live, -Infinity, t.drafts, folded.records, t.record, t.tournament);
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
