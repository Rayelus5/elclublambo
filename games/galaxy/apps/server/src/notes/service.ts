import { type AdminReleaseNote, compareVersions, RELEASE_NOTES, type ReleaseNote, releaseNoteItemSchema } from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import { z } from 'zod';
import { type AuditActor, writeAudit } from '../audit';
import type { DB } from '../db/schema';
import { inTransaction } from '../db/tx';
import { HttpError } from '../errors';

// «Notas de versión» on the server (plan «notas de versión»): the notes written in the code are the base, and the
// panel's rows (galaxy.release_notes) go over them by id — a row with a code note's id replaces it («Corregida») or hides
// it, a row with a new id adds one («Del panel»). The players read the visible ones, highest version first. Through the
// panel two visible notes never share a version (one change at a time, under a lock); a code note arriving in a deploy
// with a version the panel already used is shown to both and flagged in the panel. Hiding and showing again keep a
// correction; only «revert» takes a code note back to the game's text. Every change is audited.

type Row = { id: string; version: string; date: string; title: string; summary: string; items: unknown; hidden: boolean; updated_at: Date | string; updated_by: string | null };
type Contents = Omit<ReleaseNote, 'id'>;

const itemsSchema = z.array(releaseNoteItemSchema);
const CODE = new Map(RELEASE_NOTES.map((n) => [n.id, n]));

function fromRow(r: Row): ReleaseNote {
  const parsed = itemsSchema.safeParse(r.items);
  return { id: r.id, version: r.version, date: r.date, title: r.title, summary: r.summary, items: parsed.success ? parsed.data : [] };
}

const contents = (n: ReleaseNote) => JSON.stringify([n.version, n.date, n.title, n.summary, n.items]);

async function rows(db: Kysely<DB>): Promise<Row[]> {
  return db
    .selectFrom('galaxy.release_notes as n')
    .leftJoin('galaxy.accounts as a', 'a.id', 'n.updated_by')
    // The day as Postgres has it: read as a Date it would move with the server's time zone.
    .select(['n.id', 'n.version', sql<string>`n.date::text`.as('date'), 'n.title', 'n.summary', 'n.items', 'n.hidden', 'n.updated_at', 'a.username as updated_by'])
    .execute() as Promise<Row[]>;
}

const byVersion = (a: ReleaseNote, b: ReleaseNote) => compareVersions(b.version, a.version) || (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);

/** Every note as the panel sees it: where it comes from, whether it is hidden or clashes, who touched it last. */
export async function adminNotes(db: Kysely<DB>): Promise<AdminReleaseNote[]> {
  const over = new Map((await rows(db)).map((r) => [r.id, r]));
  const out: AdminReleaseNote[] = [];
  for (const note of RELEASE_NOTES) {
    const r = over.get(note.id);
    if (!r) {
      out.push({ ...note, source: 'code', hidden: false, clash: false, updatedAt: null, updatedBy: null });
      continue;
    }
    // A row over a code note is a correction, or only hides it (the row then holds the code's own text).
    const mine = fromRow(r);
    out.push({ ...mine, source: contents(mine) === contents(note) ? 'code' : 'edited', hidden: r.hidden, clash: false, updatedAt: new Date(r.updated_at).toISOString(), updatedBy: r.updated_by });
  }
  for (const r of over.values()) {
    if (CODE.has(r.id)) continue;
    out.push({ ...fromRow(r), source: 'panel', hidden: r.hidden, clash: false, updatedAt: new Date(r.updated_at).toISOString(), updatedBy: r.updated_by });
  }
  const visible = new Map<string, number>();
  for (const n of out) if (!n.hidden) visible.set(n.version, (visible.get(n.version) ?? 0) + 1);
  for (const n of out) n.clash = !n.hidden && (visible.get(n.version) ?? 0) > 1;
  return out.sort(byVersion);
}

/** What the players read: the visible notes, highest version first. */
export async function releaseNotes(db: Kysely<DB>): Promise<ReleaseNote[]> {
  return (await adminNotes(db)).filter((n) => !n.hidden).map(({ id, version, date, title, summary, items }) => ({ id, version, date, title, summary, items }));
}

/** One change at a time, so two admins never give two visible notes the same version. */
async function lock(trx: Kysely<DB>): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtext('galaxy.release_notes'))`.execute(trx);
}

function versionFree(all: readonly AdminReleaseNote[], id: string, version: string): void {
  if (all.some((n) => n.id !== id && !n.hidden && n.version === version)) throw new HttpError(409, 'note_version_taken');
}

const reason = (n: Pick<ReleaseNote, 'version' | 'title'>) => `Nota ${n.version}: ${n.title}`;
const valuesOf = (n: Contents, actor: AuditActor) => ({ version: n.version, date: n.date, title: n.title, summary: n.summary, items: JSON.stringify(n.items), updated_by: actor.id, updated_at: new Date() });

/** A new note, visible at once; never over an existing one (of the code or the panel). */
export async function createNote(db: Kysely<DB>, actor: AuditActor, id: string, note: Contents): Promise<AdminReleaseNote> {
  return inTransaction(db, async (trx) => {
    await lock(trx);
    const all = await adminNotes(trx);
    if (all.some((n) => n.id === id)) throw new HttpError(409, 'note_exists');
    versionFree(all, id, note.version);
    await trx.insertInto('galaxy.release_notes').values({ id, ...valuesOf(note, actor), hidden: false }).execute();
    await writeAudit(trx, { actor, action: 'notes.save', targetType: 'release_note', targetId: id, before: null, after: { id, ...note }, reason: reason(note) });
    return (await adminNotes(trx)).find((n) => n.id === id)!;
  });
}

/** Corrects an existing note (of the code or the panel), hidden or not as it was. */
export async function saveNote(db: Kysely<DB>, actor: AuditActor, id: string, note: Contents): Promise<AdminReleaseNote> {
  return inTransaction(db, async (trx) => {
    await lock(trx);
    const all = await adminNotes(trx);
    const before = all.find((n) => n.id === id);
    if (!before) throw new HttpError(404, 'note_not_found');
    if (!before.hidden) versionFree(all, id, note.version);
    const values = valuesOf(note, actor);
    await trx
      .insertInto('galaxy.release_notes')
      .values({ id, ...values, hidden: before.hidden })
      .onConflict((oc) => oc.column('id').doUpdateSet(values))
      .execute();
    await writeAudit(trx, { actor, action: 'notes.save', targetType: 'release_note', targetId: id, before, after: { id, ...note }, reason: reason(note) });
    return (await adminNotes(trx)).find((n) => n.id === id)!;
  });
}

/** Hides a note from the players (a code note keeps its text, or its correction). */
export async function hideNote(db: Kysely<DB>, actor: AuditActor, id: string): Promise<AdminReleaseNote> {
  return inTransaction(db, async (trx) => {
    await lock(trx);
    const note = (await adminNotes(trx)).find((n) => n.id === id);
    if (!note) throw new HttpError(404, 'note_not_found');
    const values = valuesOf(note, actor);
    await trx
      .insertInto('galaxy.release_notes')
      .values({ id, ...values, hidden: true })
      .onConflict((oc) => oc.column('id').doUpdateSet({ hidden: true, updated_by: actor.id, updated_at: values.updated_at }))
      .execute();
    await writeAudit(trx, { actor, action: 'notes.hide', targetType: 'release_note', targetId: id, before: { hidden: note.hidden }, after: { hidden: true }, reason: reason(note) });
    return (await adminNotes(trx)).find((n) => n.id === id)!;
  });
}

/** Shows a hidden note again, as it was (a correction stays), if no other visible note has taken its version. */
export async function restoreNote(db: Kysely<DB>, actor: AuditActor, id: string): Promise<AdminReleaseNote> {
  return inTransaction(db, async (trx) => {
    await lock(trx);
    const all = await adminNotes(trx);
    const note = all.find((n) => n.id === id);
    if (!note) throw new HttpError(404, 'note_not_found');
    versionFree(all, id, note.version);
    const code = CODE.get(id);
    // A code note hidden with its own text needs no row once shown.
    if (code && contents(note) === contents(code)) await trx.deleteFrom('galaxy.release_notes').where('id', '=', id).execute();
    else await trx.updateTable('galaxy.release_notes').set({ hidden: false, updated_by: actor.id, updated_at: new Date() }).where('id', '=', id).execute();
    await writeAudit(trx, { actor, action: 'notes.restore', targetType: 'release_note', targetId: id, before: { hidden: note.hidden }, after: { hidden: false }, reason: reason(note) });
    return (await adminNotes(trx)).find((n) => n.id === id)!;
  });
}

/** Takes a code note back to the game's own text, shown (its correction and its hiding go). */
export async function revertNote(db: Kysely<DB>, actor: AuditActor, id: string): Promise<AdminReleaseNote> {
  const code = CODE.get(id);
  if (!code) throw new HttpError(409, 'note_not_from_code');
  return inTransaction(db, async (trx) => {
    await lock(trx);
    const all = await adminNotes(trx);
    const note = all.find((n) => n.id === id)!;
    versionFree(all, id, code.version);
    await trx.deleteFrom('galaxy.release_notes').where('id', '=', id).execute();
    await writeAudit(trx, { actor, action: 'notes.revert', targetType: 'release_note', targetId: id, before: note, after: code, reason: reason(code) });
    return (await adminNotes(trx)).find((n) => n.id === id)!;
  });
}

/** Deletes a panel note; the code's are hidden, never deleted. */
export async function deleteNote(db: Kysely<DB>, actor: AuditActor, id: string): Promise<{ ok: true }> {
  if (CODE.has(id)) throw new HttpError(409, 'note_from_code');
  return inTransaction(db, async (trx) => {
    await lock(trx);
    const note = (await adminNotes(trx)).find((n) => n.id === id);
    if (!note) throw new HttpError(404, 'note_not_found');
    await trx.deleteFrom('galaxy.release_notes').where('id', '=', id).execute();
    await writeAudit(trx, { actor, action: 'notes.delete', targetType: 'release_note', targetId: id, before: note, reason: reason(note) });
    return { ok: true as const };
  });
}
