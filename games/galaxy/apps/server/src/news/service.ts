import { createHash } from 'node:crypto';
import {
  type AdminMediaView,
  type AdminNewsPost,
  type AdminNewsView,
  MEDIA_MAX_BYTES,
  type NewsImage,
  type NewsKind,
  type NewsLink,
  type NewsPost,
  type NewsPostInput,
  type NewsSection,
  type NewsView,
} from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import { type AuditActor, writeAudit } from '../audit';
import type { DB } from '../db/schema';
import { inTransaction } from '../db/tx';
import { HttpError } from '../errors';
import { imageInfo } from './image';

// The news board (the owner, 2026-11-14): its cards, shown to everyone while inside their dates and not hidden, and
// the admin's hand on them (create, edit, order, hide, delete a custom one) and on the images uploaded for them. Every
// change is audited. An auto card keeps its kind: its words come from the live game, so its title and text stay empty.

export interface NewsDeps {
  db: Kysely<DB>;
  now: () => Date;
}

const iso = (d: Date | string) => new Date(d).toISOString();

type Row = {
  id: string;
  kind: string;
  section: string;
  title: string;
  body: string;
  image: unknown;
  link: unknown;
  featured: boolean;
  sort: number;
  starts_at: Date | null;
  ends_at: Date | null;
  hidden: boolean;
  updated_at: Date;
};

function post(r: Row): NewsPost {
  return {
    id: r.id,
    kind: r.kind as NewsKind,
    section: r.section as NewsSection,
    title: r.title,
    body: r.body,
    image: (r.image ?? null) as NewsImage | null,
    link: (r.link ?? null) as NewsLink | null,
    featured: r.featured,
    order: r.sort,
    startsAt: r.starts_at ? iso(r.starts_at) : null,
    endsAt: r.ends_at ? iso(r.ends_at) : null,
    updatedAt: iso(r.updated_at),
  };
}

const COLUMNS = ['p.id', 'p.kind', 'p.section', 'p.title', 'p.body', 'p.image', 'p.link', 'p.featured', 'p.sort', 'p.starts_at', 'p.ends_at', 'p.hidden', 'p.updated_at'] as const;
const live = (r: Row, now: Date) => !r.hidden && (!r.starts_at || r.starts_at <= now) && (!r.ends_at || r.ends_at > now);

/** GET /news: the cards on now, by section and order. */
export async function listNews(deps: NewsDeps): Promise<NewsView> {
  const now = deps.now();
  const rows = (await deps.db
    .selectFrom('galaxy.news_posts as p')
    .select(COLUMNS)
    .where('p.hidden', '=', false)
    .where((eb) => eb.or([eb('p.starts_at', 'is', null), eb('p.starts_at', '<=', now)]))
    .where((eb) => eb.or([eb('p.ends_at', 'is', null), eb('p.ends_at', '>', now)]))
    .orderBy('p.section')
    .orderBy('p.sort')
    .orderBy('p.created_at')
    .limit(200)
    .execute()) as Row[];
  return { posts: rows.map(post) };
}

export async function adminNews(deps: NewsDeps): Promise<AdminNewsView> {
  const now = deps.now();
  const rows = (await deps.db
    .selectFrom('galaxy.news_posts as p')
    .leftJoin('galaxy.accounts as a', 'a.id', 'p.created_by')
    .select([...COLUMNS, 'a.username as by'])
    .orderBy('p.section')
    .orderBy('p.sort')
    .orderBy('p.created_at')
    .limit(300)
    .execute()) as (Row & { by: string | null })[];
  return { posts: rows.map((r): AdminNewsPost => ({ ...post(r), hidden: r.hidden, live: live(r, now), by: r.by ?? null })) };
}

async function assetExists(db: Kysely<DB>, image: NewsImage | null): Promise<void> {
  if (image?.kind !== 'asset') return;
  const found = await db.selectFrom('galaxy.media_assets').select('id').where('id', '=', image.id).executeTakeFirst();
  if (!found) throw new HttpError(409, 'media_not_found');
}

const fields = (p: NewsPostInput, auto: boolean) => ({
  section: p.section,
  title: auto ? '' : p.title,
  body: auto ? '' : p.body,
  image: p.image ? JSON.stringify(p.image) : null,
  link: p.link ? JSON.stringify(p.link) : null,
  featured: p.featured,
  starts_at: p.startsAt,
  ends_at: p.endsAt,
});

/** A new custom card, at the end of its section. */
export async function createNews(deps: NewsDeps, actor: AuditActor, p: NewsPostInput & { reason: string }): Promise<{ id: string }> {
  if (p.title.length === 0) throw new HttpError(400, 'invalid_input');
  await assetExists(deps.db, p.image);
  return inTransaction(deps.db, async (trx) => {
    const last = await trx.selectFrom('galaxy.news_posts').select(sql<number>`coalesce(max(sort), -1)::int`.as('n')).where('section', '=', p.section).executeTakeFirst();
    const row = await trx
      .insertInto('galaxy.news_posts')
      .values({ kind: 'custom', ...fields(p, false), sort: (last?.n ?? -1) + 1, created_by: actor.id })
      .returning('id')
      .executeTakeFirstOrThrow();
    await writeAudit(trx, { actor, action: 'news.create', targetType: 'news', targetId: row.id, after: { ...p, reason: undefined }, reason: p.reason });
    return { id: row.id };
  });
}

export async function saveNews(deps: NewsDeps, actor: AuditActor, id: string, p: NewsPostInput & { reason: string }): Promise<{ saved: true }> {
  await assetExists(deps.db, p.image);
  return inTransaction(deps.db, async (trx) => {
    const before = (await trx.selectFrom('galaxy.news_posts as p').select(COLUMNS).where('p.id', '=', id).forUpdate().executeTakeFirst()) as Row | undefined;
    if (!before) throw new HttpError(404, 'news_not_found');
    const auto = before.kind !== 'custom';
    if (!auto && p.title.length === 0) throw new HttpError(400, 'invalid_input');
    // A card moved to another section goes to its end.
    let sort = before.sort;
    if (p.section !== before.section) {
      const last = await trx.selectFrom('galaxy.news_posts').select(sql<number>`coalesce(max(sort), -1)::int`.as('n')).where('section', '=', p.section).executeTakeFirst();
      sort = (last?.n ?? -1) + 1;
    }
    await trx
      .updateTable('galaxy.news_posts')
      .set({ ...fields(p, auto), sort, updated_at: deps.now() })
      .where('id', '=', id)
      .execute();
    await writeAudit(trx, { actor, action: 'news.save', targetType: 'news', targetId: id, before: post(before), after: { ...p, reason: undefined }, reason: p.reason });
    return { saved: true as const };
  });
}

export async function setNewsHidden(deps: NewsDeps, actor: AuditActor, id: string, hidden: boolean, reason: string): Promise<{ hidden: boolean }> {
  return inTransaction(deps.db, async (trx) => {
    const r = await trx.updateTable('galaxy.news_posts').set({ hidden, updated_at: deps.now() }).where('id', '=', id).returning('id').executeTakeFirst();
    if (!r) throw new HttpError(404, 'news_not_found');
    await writeAudit(trx, { actor, action: hidden ? 'news.hide' : 'news.show', targetType: 'news', targetId: id, reason });
    return { hidden };
  });
}

/** Deletes a custom card (an auto one is hidden instead: the game would lose its place). */
export async function deleteNews(deps: NewsDeps, actor: AuditActor, id: string, reason: string): Promise<{ deleted: true }> {
  return inTransaction(deps.db, async (trx) => {
    const r = (await trx.selectFrom('galaxy.news_posts as p').select(COLUMNS).where('p.id', '=', id).forUpdate().executeTakeFirst()) as Row | undefined;
    if (!r) throw new HttpError(404, 'news_not_found');
    if (r.kind !== 'custom') throw new HttpError(409, 'news_auto');
    await trx.deleteFrom('galaxy.news_posts').where('id', '=', id).execute();
    await writeAudit(trx, { actor, action: 'news.delete', targetType: 'news', targetId: id, before: post(r), reason });
    return { deleted: true as const };
  });
}

/** A section's new order: the cards named take 0, 1, 2… (others in it keep theirs, after). */
export async function orderNews(deps: NewsDeps, actor: AuditActor, section: NewsSection, ids: string[]): Promise<{ ordered: number }> {
  return inTransaction(deps.db, async (trx) => {
    const rows = await trx.selectFrom('galaxy.news_posts').select(['id', 'section']).where('section', '=', section).forUpdate().execute();
    const mine = new Set(rows.map((r) => r.id));
    if (ids.some((x) => !mine.has(x)) || new Set(ids).size !== ids.length) throw new HttpError(400, 'invalid_input');
    let k = 0;
    for (const x of ids) await trx.updateTable('galaxy.news_posts').set({ sort: k++ }).where('id', '=', x).execute();
    for (const r of rows) if (!ids.includes(r.id)) await trx.updateTable('galaxy.news_posts').set({ sort: k++ }).where('id', '=', r.id).execute();
    await writeAudit(trx, { actor, action: 'news.order', targetType: 'news', targetId: section, after: { ids }, reason: 'Orden del tablón' });
    return { ordered: rows.length };
  });
}

// ----- Images -----

/** Stores an uploaded image (checked by its bytes); the same image twice is the same asset. */
export async function uploadMedia(deps: NewsDeps, actor: AuditActor, req: { name: string; data: string }): Promise<{ id: string }> {
  const bytes = Buffer.from(req.data, 'base64');
  const info = bytes.length > 0 && bytes.length <= MEDIA_MAX_BYTES ? imageInfo(bytes) : null;
  if (!info) throw new HttpError(400, 'media_invalid');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return inTransaction(deps.db, async (trx) => {
    const have = await trx.selectFrom('galaxy.media_assets').select('id').where('sha256', '=', sha256).executeTakeFirst();
    if (have) return { id: have.id };
    const row = await trx
      .insertInto('galaxy.media_assets')
      .values({ name: req.name, mime: info.mime, bytes: bytes.length, width: info.width, height: info.height, sha256, data: bytes, created_by: actor.id })
      .returning('id')
      .executeTakeFirstOrThrow();
    await writeAudit(trx, { actor, action: 'media.upload', targetType: 'media', targetId: row.id, after: { name: req.name, mime: info.mime, bytes: bytes.length, width: info.width, height: info.height }, reason: 'Imagen del tablón' });
    return { id: row.id };
  });
}

const usesOf = sql<number>`(select count(*)::int from galaxy.news_posts p where p.image->>'kind' = 'asset' and p.image->>'id' = m.id::text)`;

export async function listMedia(deps: NewsDeps): Promise<AdminMediaView> {
  const rows = await deps.db
    .selectFrom('galaxy.media_assets as m')
    .select(['m.id', 'm.name', 'm.mime', 'm.bytes', 'm.width', 'm.height', 'm.created_at', usesOf.as('uses')])
    .orderBy('m.created_at', 'desc')
    .limit(200)
    .execute();
  return {
    assets: rows.map((r) => ({ id: r.id, name: r.name, mime: r.mime, bytes: r.bytes, width: r.width, height: r.height, createdAt: iso(r.created_at), uses: r.uses })),
    totalBytes: rows.reduce((n, r) => n + r.bytes, 0),
  };
}

export async function deleteMedia(deps: NewsDeps, actor: AuditActor, id: string, reason: string): Promise<{ deleted: true }> {
  return inTransaction(deps.db, async (trx) => {
    const r = await trx.selectFrom('galaxy.media_assets as m').select(['m.id', 'm.name', usesOf.as('uses')]).where('m.id', '=', id).forUpdate().executeTakeFirst();
    if (!r) throw new HttpError(404, 'media_not_found');
    if (r.uses > 0) throw new HttpError(409, 'media_in_use');
    await trx.deleteFrom('galaxy.media_assets').where('id', '=', id).execute();
    await writeAudit(trx, { actor, action: 'media.delete', targetType: 'media', targetId: id, before: { name: r.name }, reason });
    return { deleted: true as const };
  });
}

/** An uploaded image's bytes, for GET /media/:id. */
export async function mediaFile(deps: NewsDeps, id: string): Promise<{ mime: string; data: Buffer; sha256: string }> {
  const r = await deps.db.selectFrom('galaxy.media_assets').select(['mime', 'data', 'sha256']).where('id', '=', id).executeTakeFirst();
  if (!r) throw new HttpError(404, 'media_not_found');
  return r;
}
