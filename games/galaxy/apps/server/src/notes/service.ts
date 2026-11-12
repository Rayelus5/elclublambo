import { type AdminReleaseNote, compareVersions, RELEASE_NOTES, type ReleaseNote, releaseNoteItemSchema } from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import { z } from 'zod';
import { type AuditActor, writeAudit } from '../audit';
import type { DB } from '../db/schema';
import { inTransaction } from '../db/tx';
import { HttpError } from '../errors';

// «Notas de versión» on the server (plan «notas de versión»): the notes written in the code are the base, and the
// panel's rows (galaxy.release_notes) go over them by id — a row with a code note's id replaces it («Editada») or hides
// it, a row with a new id adds one («Panel»). The players read the visible ones, highest version first. Every change is
// audited with the note's version and title.

type Row = { id: string; version: string; date: Date | string; title: string; summary: string; items: unknown; hidden: boolean; updated_at: Date | string; updated_by: string | null };

const items = z.array(releaseNoteItemSchema);
const CODE = new Map(RELEASE_NOTES.map((n) => [n.id, n]));
const day = (d: Date | string) => (typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10));

function fromRow(r: Row): ReleaseNote {
  const parsed = items.safeParse(r.items);
  return { id: r.id, version: r.version, date: day(r.date), title: r.title, summary: r.summary, items: parsed.success ? parsed.data : [] };
}

async function rows(db: Kysely<DB>): Promise<Row[]> {
  return db
    .selectFrom('galaxy.release_notes as n')
    .leftJoin('galaxy.accounts as a', 'a.id', 'n.updated_by')
    .select(['n.id', 'n.version', 'n.date', 'n.title', 'n.summary', 'n.items', 'n.hidden', 'n.updated_at', 'a.username as updated_by'])
    .execute() as Promise<Row[]>;
}

const byVersion = (a: ReleaseNote, b: ReleaseNote) => compareVersions(b.version, a.version) || (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);

/** Every note as the panel sees it: where it comes from, whether it is hidden, who touched it last. */
export async function adminNotes(db: Kysely<DB>): Promise<AdminReleaseNote[]> {
  const over = new Map((await rows(db)).map((r) => [r.id, r]));
  const out: AdminReleaseNote[] = [];
  for (const note of RELEASE_NOTES) {
    const r = over.get(note.id);
    if (!r) {
      out.push({ ...note, source: 'code', hidden: false, updatedAt: null, updatedBy: null });
      continue;
    }
    // A row over a code note is a correction, or only hides it (the row then holds the code's own text).
    const mine = fromRow(r);
    const same = JSON.stringify(mine) === JSON.stringify({ id: note.id, version: note.version, date: note.date, title: note.title, summary: note.summary, items: note.items });
    out.push({ ...mine, source: same ? 'code' : 'edited', hidden: r.hidden, updatedAt: new Date(r.updated_at).toISOString(), updatedBy: r.updated_by });
  }
  for (const r of over.values()) {
    if (CODE.has(r.id)) continue;
    out.push({ ...fromRow(r), source: 'panel', hidden: r.hidden, updatedAt: new Date(r.updated_at).toISOString(), updatedBy: r.updated_by });
  }
  return out.sort(byVersion);
}

/** What the players read: the visible notes, highest version first. */
export async function releaseNotes(db: Kysely<DB>): Promise<ReleaseNote[]> {
  return (await adminNotes(db)).filter((n) => !n.hidden).map(({ id, version, date, title, summary, items: list }) => ({ id, version, date, title, summary, items: list }));
}

async function current(db: Kysely<DB>, id: string): Promise<AdminReleaseNote | undefined> {
  return (await adminNotes(db)).find((n) => n.id === id);
}

/** Adds a note or replaces one (of the code or the panel); no other visible note may have its version. */
export async function saveNote(db: Kysely<DB>, actor: AuditActor, id: string, note: Omit<ReleaseNote, 'id'>): Promise<AdminReleaseNote> {
  return inTransaction(db, async (trx) => {
    // One change at a time, so two admins never give two notes the same version.
    await sql`select pg_advisory_xact_lock(hashtext('galaxy.release_notes'))`.execute(trx);
    const all = await adminNotes(trx);
    if (all.some((n) => n.id !== id && !n.hidden && n.version === note.version)) throw new HttpError(409, 'note_version_taken');
    const before = all.find((n) => n.id === id);
    const values = { version: note.version, date: note.date, title: note.title, summary: note.summary, items: JSON.stringify(note.items), hidden: false, updated_by: actor.id, updated_at: new Date() };
    await trx
      .insertInto('galaxy.release_notes')
      .values({ id, ...values })
      .onConflict((oc) => oc.column('id').doUpdateSet(values))
      .execute();
    await writeAudit(trx, { actor, action: 'notes.save', targetType: 'release_note', targetId: id, before: before ?? null, after: { id, ...note }, reason: `Nota ${note.version}: ${note.title}` });
    return (await current(trx, id))!;
  });
}

/** Hides a note from the players (a code note keeps its text, or its correction). */
export async function hideNote(db: Kysely<DB>, actor: AuditActor, id: string): Promise<AdminReleaseNote> {
  return inTransaction(db, async (trx) => {
    const note = await current(trx, id);
    if (!note) throw new HttpError(404, 'note_not_found');
    const values = { version: note.version, date: note.date, title: note.title, summary: note.summary, items: JSON.stringify(note.items), hidden: true, updated_by: actor.id, updated_at: new Date() };
    await trx
      .insertInto('galaxy.release_notes')
      .values({ id, ...values })
      .onConflict((oc) => oc.column('id').doUpdateSet({ hidden: true, updated_by: actor.id, updated_at: values.updated_at }))
      .execute();
    await writeAudit(trx, { actor, action: 'notes.hide', targetType: 'release_note', targetId: id, before: { hidden: note.hidden }, after: { hidden: true }, reason: `Nota ${note.version}: ${note.title}` });
    return (await current(trx, id))!;
  });
}

/** Brings a note back: a code note to the code's own text, a panel note to view. */
export async function restoreNote(db: Kysely<DB>, actor: AuditActor, id: string): Promise<AdminReleaseNote> {
  return inTransaction(db, async (trx) => {
    const note = await current(trx, id);
    if (!note) throw new HttpError(404, 'note_not_found');
    if (CODE.has(id)) await trx.deleteFrom('galaxy.release_notes').where('id', '=', id).execute();
    else await trx.updateTable('galaxy.release_notes').set({ hidden: false, updated_by: actor.id, updated_at: new Date() }).where('id', '=', id).execute();
    await writeAudit(trx, { actor, action: 'notes.restore', targetType: 'release_note', targetId: id, before: note, reason: `Nota ${note.version}: ${note.title}` });
    return (await current(trx, id))!;
  });
}

/** Deletes a panel note; the code's are hidden, never deleted. */
export async function deleteNote(db: Kysely<DB>, actor: AuditActor, id: string): Promise<{ ok: true }> {
  if (CODE.has(id)) throw new HttpError(409, 'note_from_code');
  return inTransaction(db, async (trx) => {
    const note = await current(trx, id);
    if (!note) throw new HttpError(404, 'note_not_found');
    await trx.deleteFrom('galaxy.release_notes').where('id', '=', id).execute();
    await writeAudit(trx, { actor, action: 'notes.delete', targetType: 'release_note', targetId: id, before: note, reason: `Nota ${note.version}: ${note.title}` });
    return { ok: true as const };
  });
}
