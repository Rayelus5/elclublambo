import { z } from 'zod';

// Config drafts on the server (the content editor, 2026-11-16, P2): a change to the run content (and the sectors and
// probes keys that go with a new sector or probe) is kept as a draft any admin can resume, try in a test run and
// publish. A draft holds only the top-level fields it changes, per key, made on the versions that were live when each
// key was first touched.

/** The keys a draft may change. */
export const DRAFT_KEYS = ['content', 'sectors', 'probes'] as const;
export type DraftKey = (typeof DRAFT_KEYS)[number];
export const DRAFT_STATUSES = ['open', 'published', 'discarded'] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

export const draftTitleSchema = z.string().trim().min(1).max(80);

export const createDraftSchema = z.object({ title: draftTitleSchema }).strict();

/** Sets one top-level field of a key (`value: null` drops it from the draft: back to what is live). */
export const setDraftFieldSchema = z
  .object({
    key: z.enum(DRAFT_KEYS),
    field: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,40}$/),
    value: z.unknown(),
    revision: z.number().int().min(0),
  })
  .strict();

export const renameDraftSchema = z.object({ title: draftTitleSchema, revision: z.number().int().min(0) }).strict();

const side = z.enum(['mine', 'live']);
/** Per key, per field, per entity id / property / '*': whose side wins a conflict. */
export const rebaseDraftSchema = z.object({ resolutions: z.partialRecord(z.enum(DRAFT_KEYS), z.record(z.string(), z.record(z.string(), side))).default({}) }).strict();

export const publishDraftSchema = z.object({ reason: z.string().trim().min(3).max(500), password: z.string().min(1).max(200) }).strict();

export interface DraftSummary {
  id: string;
  title: string;
  status: DraftStatus;
  revision: number;
  /** The keys and fields it changes. */
  fields: { key: DraftKey; field: string }[];
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  /** Something it changes was published again since it was made: it must be rebased before publishing. */
  stale: boolean;
}

export interface DraftView extends DraftSummary {
  data: Partial<Record<DraftKey, Record<string, unknown>>>;
  baseVersions: Partial<Record<DraftKey, number>>;
  /** The versions it was published as (once published). */
  publishedVersions: Partial<Record<DraftKey, number>> | null;
}

export interface DraftConflict {
  key: DraftKey;
  field: string;
  id?: string;
}

export interface DraftCheck {
  /** Each key's problems, merged over what is live, as a publish would see it. */
  issues: { key: DraftKey; path: string; message: string }[];
  /** What both the draft and a later publish changed (rebase to choose). */
  conflicts: DraftConflict[];
  stale: boolean;
}
