import { z } from 'zod';

// «Notas de versión» (plan «notas de versión»): what changed in the game, version by version, for the players. Each
// note has a version (`1.4`), its date, a short title and summary, and its changes grouped by kind. The notes are
// written in the code (entries.ts, with every change a player notices) and the admin panel can add new ones or
// correct and hide those of the code (galaxy.release_notes, by id); the server merges both.

export const NOTE_KINDS = ['nuevo', 'mejora', 'equilibrio', 'arreglo'] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export const releaseNoteItemSchema = z.object({
  kind: z.enum(NOTE_KINDS),
  text: z.string().trim().min(1).max(280),
});

/** A real calendar day, `YYYY-MM-DD` (2026-02-31 is not one). */
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((d) => {
    const t = new Date(`${d}T00:00:00Z`);
    return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
  });

const noteFields = {
  version: z.string().regex(/^\d{1,3}\.\d{1,3}$/),
  date: day,
  title: z.string().trim().min(1).max(80),
  summary: z.string().trim().max(280),
  items: z.array(releaseNoteItemSchema).min(1).max(40),
};

export const noteIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{2,59}$/);

export const releaseNoteSchema = z.object({ id: noteIdSchema, ...noteFields });
export type ReleaseNote = z.infer<typeof releaseNoteSchema>;
export type ReleaseNoteItem = z.infer<typeof releaseNoteItemSchema>;

/** PUT /galaxy/api/admin/notes/:id: an existing note's contents (the id comes from the address). */
export const adminNoteSaveSchema = z.object(noteFields);
/** POST /galaxy/api/admin/notes: a new note, never over an existing one. */
export const adminNoteCreateSchema = z.object({ id: noteIdSchema, ...noteFields });
export const noteIdParamSchema = z.object({ id: noteIdSchema });

/** Where a note comes from, as the panel shows it. */
export type NoteSource = 'code' | 'panel' | 'edited';

export interface ReleaseNotesView {
  notes: ReleaseNote[];
}

export interface AdminReleaseNote extends ReleaseNote {
  source: NoteSource;
  hidden: boolean;
  /** Another visible note has its version (a code note arriving with one the panel already used). */
  clash: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface AdminReleaseNotesView {
  notes: AdminReleaseNote[];
}

/**
 * Where a note goes in «Notas de versión» (the owner, 2026-11-14): the open beta's notes (1.x, until the end of 2026)
 * under «BETA»; from 2027 a version is the year's two digits and its change number through the year (`27.01`,
 * `27.02`… shown «v27.01»), under its year and its month (by the note's date).
 */
export type NoteShelf = { kind: 'beta' } | { kind: 'month'; year: number; month: number };

/** The first year with its own versions (the season 3, January 2027). */
export const FIRST_YEAR_VERSION = 2027;

export function noteShelf(note: { version: string; date: string }): NoteShelf {
  const major = Number(note.version.split('.')[0]);
  if (major < FIRST_YEAR_VERSION % 100) return { kind: 'beta' };
  const month = Number(note.date.slice(5, 7));
  return { kind: 'month', year: 2000 + major, month: month >= 1 && month <= 12 ? month : 1 };
}

/**
 * The version a new note dated `date` takes, after the ones there are: the beta's next 1.x until the end of 2026;
 * from 2027, its year's next change number with two figures (`27.01`, then `27.02`…, never back to 01 in a month).
 */
export function nextNoteVersion(versions: readonly string[], date: string): string {
  const year = Number(date.slice(0, 4));
  if (!(year >= FIRST_YEAR_VERSION)) {
    const beta = versions.filter((v) => Number(v.split('.')[0]) < FIRST_YEAR_VERSION % 100);
    if (beta.length === 0) return '1.0';
    const top = beta.reduce((a, b) => (compareVersions(b, a) > 0 ? b : a));
    const [major = 1, minor = 0] = top.split('.').map(Number);
    return `${major}.${minor + 1}`;
  }
  const yy = year % 100;
  const used = versions.filter((v) => Number(v.split('.')[0]) === yy).map((v) => Number(v.split('.')[1]));
  const next = (used.length > 0 ? Math.max(...used) : 0) + 1;
  return `${yy}.${String(next).padStart(2, '0')}`;
}

/** A version as the players read it: «v1.22», «v27.01». */
export const versionLabel = (version: string): string => `v${version}`;

/** Compares two versions as numbers (`1.10` is after `1.9`): above 0 when `a` is later. */
export function compareVersions(a: string, b: string): number {
  const [am = 0, an = 0] = a.split('.').map(Number);
  const [bm = 0, bn = 0] = b.split('.').map(Number);
  return am - bm || an - bn;
}
