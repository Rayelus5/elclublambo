import { type ConfigValue, type PopupContext, type PopupIssue, popupIssues, type PopupRecord, popupRecordSchema, type PopupStoredState } from '@galaxy/shared';
import type { Kysely, Selectable } from 'kysely';
import type { ConfigReader } from '../config/reader';
import type { DB } from '../db/schema';
import { HttpError } from '../errors';

// «Encuestas y avisos» as rows (plan 2026-11-22, part A; GDD §16.5): reading a campaign with its record, and what a
// record is checked against (the live content's subjects, the uploaded images, what gifts can be given). The writes
// live in admin.ts (drafts, publishing, ending) and player.ts (shows and answers).

/** A campaign as the server reads it. */
export interface PopupRow {
  id: string;
  state: PopupStoredState;
  version: number;
  record: PopupRecord;
  /** Its reward needed a superadmin when it was published. */
  big: boolean;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
  publishedAt: string | null;
  publishedBy: string | null;
  endedAt: string | null;
  endedBy: string | null;
}

export const POPUP_FIELDS = [
  'id',
  'kind',
  'title',
  'body',
  'questions',
  'image_media',
  'link',
  'audience',
  'starts_at',
  'ends_at',
  'priority',
  'reward',
  'big',
  'state',
  'version',
  'created_at',
  'created_by',
  'updated_at',
  'updated_by',
  'published_at',
  'published_by',
  'ended_at',
  'ended_by',
] as const;

type Raw = Pick<Selectable<DB['galaxy.popup_campaigns']>, (typeof POPUP_FIELDS)[number]>;

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

/** A stored row as the code reads it (its record checked again: a stored one that no longer holds throws). */
export function readPopupRow(r: Raw): PopupRow {
  const record = popupRecordSchema.parse({
    kind: r.kind,
    title: r.title,
    body: r.body,
    questions: r.questions ?? [],
    imageMedia: r.image_media,
    link: r.link ?? null,
    audience: r.audience ?? { kind: 'all' },
    startsAt: new Date(r.starts_at).toISOString(),
    endsAt: new Date(r.ends_at).toISOString(),
    priority: r.priority,
    reward: r.reward ?? [],
  });
  return {
    id: r.id,
    state: r.state,
    version: r.version,
    record,
    big: r.big,
    createdAt: iso(r.created_at)!,
    createdBy: r.created_by,
    updatedAt: iso(r.updated_at)!,
    updatedBy: r.updated_by,
    publishedAt: iso(r.published_at),
    publishedBy: r.published_by,
    endedAt: iso(r.ended_at),
    endedBy: r.ended_by,
  };
}

/** The columns a record is stored in. */
export function recordColumns(p: PopupRecord) {
  return {
    kind: p.kind,
    title: p.title,
    body: p.body,
    questions: JSON.stringify(p.questions),
    image_media: p.imageMedia,
    link: p.link ? JSON.stringify(p.link) : null,
    audience: JSON.stringify(p.audience),
    starts_at: p.startsAt,
    ends_at: p.endsAt,
    priority: p.priority,
    reward: JSON.stringify(p.reward),
  };
}

/** One campaign by id (locked for update inside a transaction when `lock`), or 404. */
export async function popupById(db: Kysely<DB>, id: string, opts: { lock?: boolean } = {}): Promise<PopupRow> {
  let q = db.selectFrom('galaxy.popup_campaigns').select(POPUP_FIELDS).where('id', '=', id);
  if (opts.lock) q = q.forUpdate();
  const r = await q.executeTakeFirst();
  if (!r) throw new HttpError(404, 'popup_not_found');
  return readPopupRow(r);
}

/** Every campaign, newest start first; one whose stored record no longer holds is skipped and reported. */
export async function allPopups(db: Kysely<DB>, onInvalid?: (id: string, err: unknown) => void): Promise<PopupRow[]> {
  const raw = await db.selectFrom('galaxy.popup_campaigns').select(POPUP_FIELDS).orderBy('starts_at', 'desc').orderBy('id').execute();
  const out: PopupRow[] = [];
  for (const r of raw) {
    try {
      out.push(readPopupRow(r));
    } catch (err) {
      onInvalid?.(r.id, err);
    }
  }
  return out;
}

/** What a record is checked against now: the live content's subjects, its image (uploaded or not) and the gifts. */
export async function popupContext(db: Kysely<DB>, config: ConfigReader, record: unknown, now: Date): Promise<Omit<PopupContext, 'forPublish' | 'now'>> {
  const [content, cosmetics, events] = await Promise.all([config.get('content'), config.get('cosmetics'), config.get('events')]);
  const image = record && typeof record === 'object' && typeof (record as { imageMedia?: unknown }).imageMedia === 'string' ? (record as { imageMedia: string }).imageMedia : null;
  const uuid = image !== null && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(image);
  const media = uuid ? await db.selectFrom('galaxy.media_assets').select('id').where('id', '=', image).executeTakeFirst() : undefined;
  return {
    subjects: { enemy: content.enemies.map((e) => e.id), boss: content.bosses.map((b) => b.id), probe: content.probes.map((p) => p.id), sector: content.sectors.map((s) => s.id) },
    media: media ? [media.id] : [],
    // A reward is paid whenever the player answers: nothing seasonal nor of an event (popupIssues refuses them).
    gifts: { cosmetics, probes: content.probes.map((p) => p.id), events: (events as ConfigValue<'events'>).list.map((e) => ({ id: e.id, endsAt: e.endsAt })), season: { id: '', open: false }, now },
  };
}

/**
 * Every problem of a record against what is live; `forPublish` adds what only publishing needs (its end ahead, a
 * promotion's image). A record that is fine has none.
 */
export async function recordIssues(db: Kysely<DB>, config: ConfigReader, record: unknown, now: Date, forPublish: boolean): Promise<PopupIssue[]> {
  const ctx = await popupContext(db, config, record, now);
  return popupIssues(record, forPublish ? { ...ctx, forPublish: true, now } : { ...ctx, now });
}
