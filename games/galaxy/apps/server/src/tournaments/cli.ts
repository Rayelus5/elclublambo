import { readFileSync } from 'node:fs';
import { TOURNAMENT_STATES, type TournamentState } from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import { z } from 'zod';
import type { AuditActor } from '../audit';
import type { DB } from '../db/schema';
import { HttpError } from '../errors';
import { cliConfig, inMadrid } from '../season/cli';
import { createTournament, type TournamentDeps, updateTournament } from './admin';
import { readTournamentRow, recordIssues, TOURNAMENT_FIELDS, tournamentsIn, type TournamentRow } from './records';
import { decideCheck, reviewView } from './review';

// The container CLI's tournament commands (skill galaxy-torneo, 2026-11-22): a tournament prepared in a folder of
// ops/launch (`torneo.json`) goes to PRE as a DRAFT, never further. Scheduling it (password, a superadmin when its prizes
// are big or carry money) and everything after (review, results, money) stays in Administración › Torneos. The one
// exception is the review's escape hatch, `tournament-decide`: a run nobody may decide in the panel (a superadmin's own,
// when no other superadmin can) would otherwise hold the results forever.

type Out = (s: string) => void;
const CLI_ACTOR: AuditActor = { id: null, label: 'cli' };

const STATE: Record<TournamentState, string> = {
  draft: 'borrador',
  scheduled: 'programado',
  running: 'en curso',
  review: 'en revisión',
  finished: 'terminado',
  cancelled: 'cancelado',
};

/** Every tournament, drafts too, by start (one whose stored record no longer holds is reported, not hidden). */
async function allTournaments(db: Kysely<DB>, out: Out): Promise<TournamentRow[]> {
  return tournamentsIn(db, TOURNAMENT_STATES, (id, err) => out(`Ojo: el torneo ${id} tiene una ficha que ya no vale (${(err as Error).message})`));
}

/** One tournament by slug, in any state (drafts too), or null. */
async function bySlug(db: Kysely<DB>, slug: string): Promise<TournamentRow | null> {
  const r = await db.selectFrom('galaxy.tournaments').select(TOURNAMENT_FIELDS).where('slug', '=', slug).executeTakeFirst();
  return r ? readTournamentRow(r) : null;
}

/** `tournament-list`: every tournament by start, with its state, dates in Madrid, measure and who is in. */
export async function tournamentList(db: Kysely<DB>, out: Out): Promise<number> {
  const list = await allTournaments(db, out);
  if (list.length === 0) {
    out('No hay torneos');
    return 0;
  }
  const counts = await db
    .selectFrom('galaxy.tournament_entries')
    .select(['tournament_id', sql<number>`count(*)::int`.as('n')])
    .where('left_at', 'is', null)
    .groupBy('tournament_id')
    .execute();
  const entrants = new Map(counts.map((c) => [c.tournament_id, c.n]));
  for (const t of list) {
    const r = t.record;
    out(`${r.slug}  ${r.title}  ${STATE[t.state]}  ${inMadrid(r.startsAt)} → ${inMadrid(r.endsAt)} (Madrid)  ${r.metric}  ${entrants.get(t.id) ?? 0} inscritos  temporada ${r.seasonId}  v${t.version}`);
  }
  return 0;
}

/** `tournament-show <slug>`: one tournament whole, as JSON (its `record` is the shape `tournament-draft` takes). */
export async function tournamentShow(db: Kysely<DB>, slug: string | undefined, out: Out): Promise<number> {
  if (!slug) {
    out('Uso: tournament-show <slug>');
    return 1;
  }
  const t = await bySlug(db, slug);
  if (!t) {
    out(`No hay ningún torneo ${slug}`);
    return 1;
  }
  out(JSON.stringify({ id: t.id, state: t.state, version: t.version, startedSimVersion: t.startedSimVersion, record: t.record }, null, 2));
  return 0;
}

/** The record in a file or stdin: the record itself, or an ops bundle with it under `torneo`. */
function readRecord(source: string): unknown {
  const text = readFileSync(source === '-' ? 0 : source, 'utf8');
  const data = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as Record<string, unknown>;
  return data && typeof data === 'object' && 'torneo' in data ? data['torneo'] : data;
}

const ERRORS: Record<string, string> = {
  tournament_invalid: 'El torneo no vale:',
  tournament_not_draft: 'Ese torneo ya no es un borrador: desprográmalo en Administración › Torneos antes de cambiarlo',
  tournament_conflict: 'Alguien lo ha cambiado a la vez: vuelve a lanzarlo',
  tournament_slug_taken: 'Ya hay un torneo con esa dirección (slug)',
  tournament_not_review: 'Ese torneo no está en revisión',
  tournament_check_not_found: 'Esa partida no está en la revisión de ese torneo',
  tournament_check_decided: 'Esa partida ya está decidida o no necesita una decisión',
};

function printError(err: unknown, out: Out): number {
  if (err instanceof HttpError) {
    out(ERRORS[err.code] ?? `Error: ${err.code}`);
    for (const i of (err.details?.issues ?? []) as { path: string; message: string }[]) out(`  ${i.path || '(raíz)'}: ${i.message}`);
    return 1;
  }
  throw err;
}

/** The problems a record has against what is live, as the panel's «Validar» shows them (none: it can be scheduled). */
export async function tournamentCheck(db: Kysely<DB>, record: unknown): Promise<{ path: string; message: string }[]> {
  const slug = record && typeof record === 'object' ? (record as { slug?: unknown }).slug : undefined;
  const self = typeof slug === 'string' ? await bySlug(db, slug) : null;
  return recordIssues(db, await cliConfig(db), record, new Date(), self?.id ?? null);
}

/**
 * `tournament-draft <torneo.json | -> --reason <motivo>`: saves a tournament as a draft, new or replacing the draft with
 * its slug. It never schedules: that is the panel's, with a password (and a superadmin for big prizes or money).
 */
export async function tournamentDraft(db: Kysely<DB>, source: string | undefined, reason: string | undefined, out: Out): Promise<number> {
  if (!source || !reason || reason.length < 3) {
    out('Uso: tournament-draft <torneo.json | -> --reason <motivo de 3 caracteres o más>');
    return 1;
  }
  let input: unknown;
  try {
    input = readRecord(source);
  } catch (err) {
    out(`No se pudo leer el JSON de ${source}: ${(err as Error).message}`);
    return 1;
  }
  const deps: TournamentDeps = { db, config: await cliConfig(db), now: () => new Date() };
  const slug = input && typeof input === 'object' ? (input as { slug?: unknown }).slug : undefined;
  const old = typeof slug === 'string' ? await bySlug(db, slug) : null;
  try {
    const t = old ? await updateTournament(deps, CLI_ACTOR, old.id, input, old.version, reason) : await createTournament(deps, CLI_ACTOR, input, reason);
    out(`${old ? 'Borrador cambiado' : 'Guardado como borrador'}: ${t.record.slug}  ${t.record.title}  ${inMadrid(t.record.startsAt)} → ${inMadrid(t.record.endsAt)} (Madrid)  v${t.version}`);
    const left = (await recordIssues(db, deps.config, t.record, new Date(), t.id)).filter((i) => i.message === 'tournament_season_closed');
    if (left.length > 0) out('Ojo: su temporada aún es un borrador. Prográmala antes que el torneo');
    out('Para que salga: Administración › Torneos › el borrador › Revisión › «Guardar y programar» (pide tu contraseña)');
    return 0;
  } catch (err) {
    return printError(err, out);
  }
}

const DECISIONS = { accept: 'aceptada', discard: 'descartada' } as const;

/**
 * `tournament-decide <slug> <run> accept|discard --reason <motivo>`: decides a run of a tournament in review that could
 * not be checked (unverifiable, or an error), like the panel's decision but without its staff rule (the server's CLI is
 * the owner's): the way out when the run is a superadmin's and no other superadmin can decide it. Audited as «cli».
 */
export async function tournamentDecide(db: Kysely<DB>, slug: string | undefined, runId: string | undefined, decision: string | undefined, reason: string | undefined, out: Out): Promise<number> {
  if (!slug || !runId || !z.uuid().safeParse(runId).success || (decision !== 'accept' && decision !== 'discard') || !reason || reason.length < 3) {
    out('Uso: tournament-decide <slug> <id de la partida> accept|discard --reason <motivo de 3 caracteres o más>');
    return 1;
  }
  const t = await bySlug(db, slug);
  if (!t) {
    out(`No hay ningún torneo ${slug}`);
    return 1;
  }
  const deps: TournamentDeps = { db, config: await cliConfig(db), now: () => new Date() };
  try {
    await decideCheck(deps, null, CLI_ACTOR, t.id, runId, decision, reason);
  } catch (err) {
    return printError(err, out);
  }
  out(`Partida ${runId} ${DECISIONS[decision]} en ${slug}`);
  const r = await reviewView(deps, t.id);
  if (r.blocking === 0) out('No queda nada pendiente. Los resultados salen al acabar las horas de revisión o con «Publicar ya»');
  else out(`${r.blocking === 1 ? 'Queda 1 partida' : `Quedan ${r.blocking} partidas`} por comprobar o decidir antes de los resultados`);
  return 0;
}
