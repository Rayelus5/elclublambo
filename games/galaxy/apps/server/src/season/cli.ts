import { readFileSync } from 'node:fs';
import { currentSeason } from '@galaxy/shared';
import type { Kysely } from 'kysely';
import type { AuditActor } from '../audit';
import { type ConfigService, createConfigService } from '../config/service';
import type { DB } from '../db/schema';
import { HttpError } from '../errors';
import { allSeasons, createSeasonStore, extendSeason, saveSeasonDraft, scheduleSeason, seasonAwareConfig, seasonContext, type SeasonRow, unscheduleSeason } from './records';

// The container CLI's season commands (plan «temporadas como fichas», 2026-11-21; docs/CONTENIDO.md B): seasons are
// records now, prepared as drafts and scheduled; they start and end on their own. The panel's «Temporadas» does the
// same with a form; these are for operating PRE (and the night a season has to change).

type Out = (s: string) => void;
const CLI_ACTOR: AuditActor = { id: null, label: 'cli' };

/**
 * The live config as the CLI reads it: once any season is a record, through the seasons (the old keys can no longer be
 * published); before that (a database that never imported), the old keys as they are.
 */
export async function cliConfig(db: Kysely<DB>): Promise<ConfigService> {
  const base = createConfigService(db);
  const any = await db.selectFrom('galaxy.seasons').select('id').limit(1).executeTakeFirst();
  return any ? seasonAwareConfig(base, createSeasonStore(db, { ttlMs: 0 }), () => new Date()) : base;
}

const madrid = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** An instant as Madrid reads it: 23/11/2026 00:00. */
export const inMadrid = (iso: string) => madrid.format(new Date(iso)).replace(',', '');
const STATE: Record<SeasonRow['state'], string> = { draft: 'borrador', scheduled: 'programada', closed: 'cerrada' };

function line(s: SeasonRow, open: boolean): string {
  return `${s.id}  ${s.name}  ${STATE[s.state]}${open ? ' (abierta)' : ''}  ${inMadrid(s.startsAt)} → ${inMadrid(s.endsAt)} (Madrid)  v${s.version}`;
}

/** `season-list`: every season, drafts too, by start, marking the open one. */
export async function seasonList(db: Kysely<DB>, out: Out): Promise<number> {
  const list = await allSeasons(db);
  if (list.length === 0) {
    out('No hay temporadas como fichas todavía (el servidor las importa al arrancar)');
    return 0;
  }
  const open = currentSeason(list, Date.now());
  for (const s of list) out(line(s, s.id === open?.id));
  return 0;
}

/** `season-show <id>`: one season whole, as JSON (the shape `season-import` takes). */
export async function seasonShow(db: Kysely<DB>, id: string | undefined, out: Out): Promise<number> {
  if (!id) {
    out('Uso: season-show <id>');
    return 1;
  }
  const s = (await allSeasons(db)).find((x) => x.id === id);
  if (!s) {
    out(`No hay ninguna temporada ${id}`);
    return 1;
  }
  const { state, version, announcedAt, ...record } = s;
  out(JSON.stringify({ state, version, announcedAt, record }, null, 2));
  return 0;
}

/** The record in a file or stdin: the record itself, or an ops bundle with it under `temporada`. */
function readRecord(source: string): unknown {
  const text = readFileSync(source === '-' ? 0 : source, 'utf8');
  const data = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as Record<string, unknown>;
  return data && typeof data === 'object' && 'temporada' in data ? data['temporada'] : data;
}

function printIssues(err: unknown, out: Out): number {
  if (err instanceof HttpError) {
    const issues = (err.details?.issues ?? []) as { path: string; message: string }[];
    const text: Record<string, string> = {
      season_invalid: 'La temporada no vale:',
      season_overlap: 'Esas fechas se solapan con otra temporada programada o cerrada',
      season_not_found: 'No hay ninguna temporada con ese id',
      season_not_draft: 'Esa temporada no es un borrador (desprográmala antes de cambiarla)',
      season_started: 'Esa temporada ya ha empezado: no se puede desprogramar',
    };
    out(text[err.code] ?? `Error: ${err.code}`);
    for (const i of issues) out(`  ${i.path || '(raíz)'}: ${i.message}`);
    return 1;
  }
  throw err;
}

/** `season-import <archivo.json | -> --reason <motivo>`: saves a season as a draft (new, or replacing its draft). */
export async function seasonImport(db: Kysely<DB>, source: string | undefined, reason: string | undefined, out: Out): Promise<number> {
  if (!source || !reason || reason.length < 3) {
    out('Uso: season-import <archivo.json | -> --reason <motivo de 3 caracteres o más>');
    return 1;
  }
  let input: unknown;
  try {
    input = readRecord(source);
  } catch (err) {
    out(`No se pudo leer el JSON de ${source}: ${(err as Error).message}`);
    return 1;
  }
  try {
    const s = await saveSeasonDraft(db, input, await seasonContext(await cliConfig(db)), CLI_ACTOR, reason);
    out(`Guardada como borrador: ${line(s, false)}`);
    out(`Para que empiece sola: season-schedule ${s.id} --reason <motivo>`);
    return 0;
  } catch (err) {
    return printIssues(err, out);
  }
}

/** `season-schedule <id> --reason <motivo>`: a draft starts on its own at its date. */
export async function seasonSchedule(db: Kysely<DB>, id: string | undefined, reason: string | undefined, out: Out): Promise<number> {
  if (!id || !reason || reason.length < 3) {
    out('Uso: season-schedule <id> --reason <motivo de 3 caracteres o más>');
    return 1;
  }
  try {
    const s = await scheduleSeason(db, id, await seasonContext(await cliConfig(db)), CLI_ACTOR, reason);
    out(`Programada: ${line(s, false)}`);
    if (Date.parse(s.startsAt) <= Date.now()) out('Ojo: su inicio ya pasó, así que está abierta desde ahora');
    return 0;
  } catch (err) {
    return printIssues(err, out);
  }
}

/** `season-unschedule <id> --reason <motivo>`: a scheduled season that has not started goes back to draft. */
export async function seasonUnschedule(db: Kysely<DB>, id: string | undefined, reason: string | undefined, out: Out): Promise<number> {
  if (!id || !reason || reason.length < 3) {
    out('Uso: season-unschedule <id> --reason <motivo de 3 caracteres o más>');
    return 1;
  }
  try {
    const s = await unscheduleSeason(db, id, CLI_ACTOR, reason, new Date());
    out(`Vuelve a borrador: ${line(s, false)}`);
    return 0;
  } catch (err) {
    return printIssues(err, out);
  }
}

/** `season-extend <id> <fin ISO> --reason <motivo> [--move-next]`: moves a scheduled season's end. */
export async function seasonExtend(db: Kysely<DB>, id: string | undefined, endsAt: string | undefined, reason: string | undefined, moveNext: boolean, out: Out): Promise<number> {
  if (!id || !endsAt || !Number.isFinite(Date.parse(endsAt)) || !reason || reason.length < 3) {
    out('Uso: season-extend <id> <fin en ISO, p. ej. 2026-12-30T23:00:00.000Z> --reason <motivo> [--move-next]');
    return 1;
  }
  try {
    const s = await extendSeason(db, id, new Date(endsAt).toISOString(), { moveNext }, CLI_ACTOR, reason, new Date());
    out(`Nuevo fin: ${line(s, false)}`);
    return 0;
  } catch (err) {
    return printIssues(err, out);
  }
}
