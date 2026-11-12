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

const noteFields = {
  version: z.string().regex(/^\d{1,3}\.\d{1,3}$/),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().trim().min(1).max(80),
  summary: z.string().trim().max(280),
  items: z.array(releaseNoteItemSchema).min(1).max(40),
};

export const noteIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{2,59}$/);

export const releaseNoteSchema = z.object({ id: noteIdSchema, ...noteFields });
export type ReleaseNote = z.infer<typeof releaseNoteSchema>;
export type ReleaseNoteItem = z.infer<typeof releaseNoteItemSchema>;

/** PUT /galaxy/api/admin/notes/:id: the note's contents (the id comes from the address). */
export const adminNoteSaveSchema = z.object(noteFields);
export const noteIdParamSchema = z.object({ id: noteIdSchema });

/** Where a note comes from, as the panel shows it. */
export type NoteSource = 'code' | 'panel' | 'edited';

export interface ReleaseNotesView {
  notes: ReleaseNote[];
}

export interface AdminReleaseNote extends ReleaseNote {
  source: NoteSource;
  hidden: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface AdminReleaseNotesView {
  notes: AdminReleaseNote[];
}

/** Compares two versions as numbers (`1.10` is after `1.9`): above 0 when `a` is later. */
export function compareVersions(a: string, b: string): number {
  const [am = 0, an = 0] = a.split('.').map(Number);
  const [bm = 0, bn = 0] = b.split('.').map(Number);
  return am - bm || an - bn;
}
