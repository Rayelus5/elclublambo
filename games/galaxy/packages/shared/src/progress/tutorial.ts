import { z } from 'zod';

// The guided tutorial (GDD §12.2; polish phase 3): chapters in the order a new player meets them. The server keeps the
// chapter reached (it only moves forward) and pays, once, the components to repair the antenna on reaching the
// station; the steps inside each chapter live in the client.

export const TUTORIAL_CHAPTERS = ['hub', 'scanner', 'hangar', 'run', 'results', 'station', 'done'] as const;
export type TutorialChapter = (typeof TUTORIAL_CHAPTERS)[number];

export interface TutorialView {
  /** active: the tour runs; skipped: the player left it; done: finished (or an account that already played). */
  status: 'active' | 'skipped' | 'done';
  chapter: TutorialChapter;
  /** The components given on reaching the station's chapter (0 before it, or when there was nothing to give). */
  gift: number;
}

export const tutorialUpdateSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('advance'), chapter: z.enum(TUTORIAL_CHAPTERS) }).strict(),
  z.object({ action: z.literal('skip') }).strict(),
  z.object({ action: z.literal('restart') }).strict(),
]);
export type TutorialUpdate = z.infer<typeof tutorialUpdateSchema>;
